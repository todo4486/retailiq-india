"""
OLAP engine: all five operations, executed as SQL on the star schema.

VIVA NOTES
----------
A cube's cells hold measures, addressed by dimension members. Each dimension has a
concept hierarchy:
    time:      year > quarter > month > day
    product:   category > product
    geography: region > state > city

The cube view is described by a "state":
    rows      {dim, level}        the dimension on the row axis
    columns   {dim, level}|None   an optional dimension on the column axis (cross-tab)
    filters   {attribute: [values]}
    measure   revenue | quantity | transactions | aov
    drill_path                    drills already made, so roll-up can retrace them

The operations are pure functions from one state to the next, and execute_state()
compiles any state into one SQL GROUP BY. In SQL terms:
    ROLL-UP    group by a coarser level        GROUP BY year     (was GROUP BY month)
    DRILL-DOWN group by a finer level          GROUP BY month    (was GROUP BY year)
    SLICE      fix ONE dimension               WHERE year = 2025
    DICE       fix SEVERAL dimensions          WHERE year = 2025 AND city = 'Mumbai' AND ...
    PIVOT      swap the axes                   GROUP BY category, year -> year, category

Average order value cannot be added up from cells, because an order may span
several cells. So row and column totals come from their own GROUP BY queries instead
of summing the cross-tab.
"""
import copy
import time

import pandas as pd
from sqlalchemy import text

from db.connection import engine, one
from errors import ApiError, WarehouseEmpty

HIERARCHIES = {
    "time": ["year", "quarter", "month", "day"],
    "product": ["category", "product"],
    "geography": ["region", "state", "city"],
}

# level -> SQL expression (whitelisted, so nothing from the client reaches the SQL text).
LEVEL_SQL = {
    "year": "CAST(d.Year AS CHAR)",
    "quarter": "CONCAT(d.Year, '-Q', d.Quarter)",
    "month": "DATE_FORMAT(d.Date, '%Y-%m')",
    "day": "DATE_FORMAT(d.Date, '%Y-%m-%d')",
    "category": "p.Category",
    "product": "p.Product_Name",
    "region": "g.Region",
    "state": "g.State",
    "city": "g.City",
}

MEASURE_SQL = {
    "revenue": "SUM(f.Revenue)",
    "quantity": "SUM(f.Quantity)",
    "transactions": "COUNT(DISTINCT f.Transaction_ID)",
    "aov": "SUM(f.Revenue) / COUNT(DISTINCT f.Transaction_ID)",
}

# attribute -> (SQL column, value type, owning dimension)
FILTERS = {
    "year": ("d.Year", int, "time"),
    "quarter": ("d.Quarter", int, "time"),
    "month": ("d.Month", int, "time"),
    "day": ("d.Date", str, "time"),
    "category": ("p.Category", str, "product"),
    "product": ("p.Product_Name", str, "product"),
    "region": ("g.Region", str, "geography"),
    "state": ("g.State", str, "geography"),
    "city": ("g.City", str, "geography"),
}

JOINS = {
    "time": "JOIN DIM_DATE d ON f.Date_ID = d.Date_ID",
    "product": "JOIN DIM_PRODUCT p ON f.Product_ID = p.Product_ID",
    "geography": "JOIN DIM_GEOGRAPHY g ON f.Geography_ID = g.Geography_ID",
}

MAX_ROWS = 500
MAX_COLUMNS = 12


def default_state():
    return {
        "rows": {"dim": "time", "level": "month"},
        "columns": None,
        "filters": {},
        "measure": "revenue",
        "drill_path": [],
    }


def _validate(state):
    merged = default_state()
    merged.update({k: v for k, v in (state or {}).items() if k in merged})
    for axis in ["rows", "columns"]:
        spec = merged[axis]
        if spec is None:
            continue
        if spec.get("dim") not in HIERARCHIES or spec.get("level") not in HIERARCHIES[spec["dim"]]:
            raise ApiError(f"Invalid {axis} axis.")
    if merged["measure"] not in MEASURE_SQL:
        raise ApiError("Unknown measure.")
    if merged["columns"] and merged["columns"]["dim"] == merged["rows"]["dim"]:
        raise ApiError("Rows and columns must use different dimensions.")
    clean = {}
    for attribute, values in (merged["filters"] or {}).items():
        if attribute not in FILTERS:
            raise ApiError(f"Unknown filter: {attribute}")
        if not isinstance(values, list):
            values = [values]
        try:
            converted = [FILTERS[attribute][1](v) for v in values]
        except (TypeError, ValueError):
            raise ApiError(f"Invalid value for {attribute}.")
        if converted:
            clean[attribute] = converted
    merged["filters"] = clean
    return merged


# ---------------------------------------------------------------- the five operations

def roll_up(state, _args):
    """
    ROLL-UP: climb the hierarchy to a coarser level.
    If the current view came from a drill-down, that drill is undone (filter included).
    """
    state = copy.deepcopy(state)
    if state["drill_path"]:
        last = state["drill_path"].pop()
        state["rows"]["level"] = last["level"]
        for attribute in last["added"]:
            state["filters"].pop(attribute, None)
        return state
    levels = HIERARCHIES[state["rows"]["dim"]]
    position = levels.index(state["rows"]["level"])
    if position == 0:
        raise ApiError(f"{levels[0].title()} is already the top of the {state['rows']['dim']} hierarchy.")
    state["rows"]["level"] = levels[position - 1]
    return state


def drill_down(state, args):
    """
    DRILL-DOWN: descend to a finer level.
    With a member (e.g. 2011-Q2) the view also narrows to that member. Without one,
    every member is expanded to the next level.
    """
    state = copy.deepcopy(state)
    levels = HIERARCHIES[state["rows"]["dim"]]
    level = state["rows"]["level"]
    position = levels.index(level)
    if position == len(levels) - 1:
        raise ApiError(f"{level.title()} is already the finest level of the {state['rows']['dim']} hierarchy.")

    added = {}
    member = args.get("member")
    if member is not None:
        member = str(member)
        if level == "year":
            added["year"] = [int(member)]
        elif level == "quarter":
            year, quarter = member.split("-Q")
            added.update(year=[int(year)], quarter=[int(quarter)])
        elif level == "month":
            year, month = member.split("-")
            added.update(year=[int(year)], month=[int(month)])
        else:
            added[level] = [member]
    # Only attributes this drill newly introduces may be removed again by roll-up.
    state["drill_path"].append({"level": level, "added": [a for a in added if a not in state["filters"]]})
    state["filters"].update(added)
    state["rows"]["level"] = levels[position + 1]
    return state


def slice_cube(state, args):
    """SLICE: fix a single dimension attribute to one value, giving a sub-cube."""
    attribute, value = args.get("attribute"), args.get("value")
    if attribute not in FILTERS or value in (None, ""):
        raise ApiError("A slice needs one attribute and one value.")
    state = copy.deepcopy(state)
    state["filters"] = {attribute: [value]}
    state["drill_path"] = []
    return state


def dice(state, args):
    """DICE: select a sub-cube by restricting two or more dimensions at once."""
    filters = {a: v for a, v in (args.get("filters") or {}).items() if v not in (None, "", [])}
    dimensions = {FILTERS[a][2] for a in filters if a in FILTERS}
    if len(dimensions) < 2:
        raise ApiError("A dice restricts at least two different dimensions. For one dimension, use slice.")
    state = copy.deepcopy(state)
    state["filters"] = filters
    state["drill_path"] = []
    return state


def pivot(state, args):
    """
    PIVOT: rotate the analytical perspective. The same aggregates are re-arranged by
    swapping the axes, or by moving a new dimension onto the column axis.
    """
    state = copy.deepcopy(state)
    state["drill_path"] = []
    target_rows, target_cols = args.get("rows"), args.get("columns", "swap")
    if target_rows is None and target_cols == "swap":
        if state["columns"]:
            state["rows"], state["columns"] = state["columns"], state["rows"]
        else:
            # No column axis yet: the next dimension in turn becomes the column axis.
            order = list(HIERARCHIES)
            next_dim = order[(order.index(state["rows"]["dim"]) + 1) % len(order)]
            state["columns"] = {"dim": next_dim, "level": HIERARCHIES[next_dim][0]}
        return state
    if target_rows:
        previous_rows = state["rows"]
        state["rows"] = {"dim": target_rows, "level": HIERARCHIES.get(target_rows, ["?"])[0]}
        # The dimension moving onto the rows may already be on the columns: rotate them.
        if state["columns"] and state["columns"]["dim"] == target_rows:
            state["rows"], state["columns"] = state["columns"], previous_rows
    if target_cols in (None, "none"):
        state["columns"] = None
    elif target_cols != "swap":
        state["columns"] = {"dim": target_cols, "level": HIERARCHIES.get(target_cols, ["?"])[0]}
    return state


def set_view(state, args):
    """Direct changes from the top selectors: axes, level or measure."""
    state = copy.deepcopy(state)
    if "measure" in args:
        state["measure"] = args["measure"]
    if "rows" in args:
        state["rows"] = args["rows"]
        state["drill_path"] = []
    if "columns" in args:
        state["columns"] = args["columns"]
    if "filters" in args:
        state["filters"] = args["filters"]
        state["drill_path"] = []
    return state


def reset(_state, _args):
    return default_state()


OPERATIONS = {
    "roll_up": roll_up, "drill_down": drill_down, "slice": slice_cube, "dice": dice,
    "pivot": pivot, "view": set_view, "reset": reset,
}


# ---------------------------------------------------------------- compile and execute

def _where(filters):
    """Build a WHERE clause with bound parameters. Values are never pasted into SQL."""
    clauses, params = [], {}
    for attribute, values in filters.items():
        names = []
        for index, value in enumerate(values):
            name = f"{attribute}_{index}"
            params[name] = value
            names.append(f":{name}")
        clauses.append(f"{FILTERS[attribute][0]} IN ({', '.join(names)})")
    return ("WHERE " + " AND ".join(clauses)) if clauses else "", params


def _dims_used(state, group_levels):
    dims = {FILTERS[a][2] for a in state["filters"]}
    dims.update(dim for dim, _ in group_levels)
    return [d for d in HIERARCHIES if d in dims]


def _build_sql(state, group_levels):
    """group_levels is a list of (dim, level). An empty list gives the grand total."""
    measure = MEASURE_SQL[state["measure"]]
    select = [f"{LEVEL_SQL[level]} AS {'member' if i == 0 else 'col_member'}"
              for i, (_, level) in enumerate(group_levels)]
    select.append(f"{measure} AS value")
    joins = "\n".join(JOINS[d] for d in _dims_used(state, group_levels))
    where, params = _where(state["filters"])
    group = f"GROUP BY {', '.join(LEVEL_SQL[l] for _, l in group_levels)}" if group_levels else ""
    sql = f"SELECT {', '.join(select)}\nFROM FACT_SALES f\n{joins}\n{where}\n{group}"
    return "\n".join(line for line in sql.split("\n") if line.strip()), params


def _display_sql(sql, params):
    """Render bound values into the SQL text for display in the UI only."""
    for name in sorted(params, key=len, reverse=True):
        value = params[name]
        sql = sql.replace(f":{name}", repr(value) if isinstance(value, str) else str(value))
    return sql


def _read(sql, params):
    # Bound names use text(); literal colons cannot occur in the whitelisted expressions.
    return pd.read_sql_query(text(sql), engine(), params=params)


def _is_time(spec):
    return spec["dim"] == "time"


def execute_state(state):
    if not one("SELECT 1 AS ok FROM FACT_SALES LIMIT 1"):
        raise WarehouseEmpty()
    started = time.time()
    row_axis, col_axis = state["rows"], state["columns"]
    row_level = (row_axis["dim"], row_axis["level"])

    row_sql, params = _build_sql(state, [row_level])
    row_totals = _read(row_sql, params)
    grand_sql, _ = _build_sql(state, [])
    grand = _read(grand_sql, params)["value"].iloc[0] if len(row_totals) else None

    # Time reads naturally in order; other dimensions rank by the measure.
    if _is_time(row_axis):
        row_totals = row_totals.sort_values("member")
    else:
        row_totals = row_totals.sort_values("value", ascending=False)
    total_rows = len(row_totals)
    row_totals = row_totals.head(MAX_ROWS)

    executed = [_display_sql(row_sql, params)]
    columns, column_totals, cells = [], {}, {}
    total_columns = 0
    if col_axis:
        col_level = (col_axis["dim"], col_axis["level"])
        # Column totals as their own query: AOV cannot be summed from cells.
        col_sql, _ = _build_sql(state, [col_level])
        col_totals = _read(col_sql, params)
        total_columns = len(col_totals)
        if _is_time(col_axis):
            col_totals = col_totals.sort_values("member")
        else:
            col_totals = col_totals.sort_values("value", ascending=False)
        col_totals = col_totals.head(MAX_COLUMNS)
        columns = [str(c) for c in col_totals["member"]]
        column_totals = {str(m): float(v or 0) for m, v in zip(col_totals["member"], col_totals["value"])}

        cross_sql, _ = _build_sql(state, [row_level, col_level])
        cross = _read(cross_sql, params)
        executed = [_display_sql(cross_sql, params), executed[0], _display_sql(col_sql, params)]
        keep_rows, keep_cols = set(row_totals["member"].astype(str)), set(columns)
        for row in cross.itertuples(index=False):
            member, col_member = str(row.member), str(row.col_member)
            if member in keep_rows and col_member in keep_cols:
                cells.setdefault(member, {})[col_member] = float(row.value or 0)

    result_rows = [
        {"member": str(m), "total": float(v or 0), "cells": cells.get(str(m), {})}
        for m, v in zip(row_totals["member"], row_totals["value"])
    ]
    levels = HIERARCHIES[row_axis["dim"]]
    position = levels.index(row_axis["level"])
    return {
        "state": state,
        "rows": result_rows,
        "columns": columns,
        "column_totals": column_totals,
        "grand_total": float(grand) if grand is not None and pd.notna(grand) else None,
        "total_rows": total_rows,
        "total_columns": total_columns,
        "sql": executed,
        "elapsed_ms": round((time.time() - started) * 1000),
        "can_roll_up": position > 0 or bool(state["drill_path"]),
        "can_drill_down": position < len(levels) - 1,
    }


def execute_operation(operation, state, args):
    if operation not in OPERATIONS:
        raise ApiError(f"Unknown OLAP operation: {operation}")
    current = _validate(state)
    next_state = _validate(OPERATIONS[operation](current, args or {}))
    result = execute_state(next_state)
    result["operation"] = operation
    return result


def members():
    """Dimension members for the filter controls, read from the warehouse."""
    read = lambda sql: [r[0] for r in pd.read_sql_query(text(sql), engine()).itertuples(index=False)]
    if not one("SELECT 1 AS ok FROM FACT_SALES LIMIT 1"):
        raise WarehouseEmpty()
    return {
        "year": [int(v) for v in read("SELECT DISTINCT Year FROM DIM_DATE ORDER BY 1")],
        "quarter": [int(v) for v in read("SELECT DISTINCT Quarter FROM DIM_DATE ORDER BY 1")],
        "month": [int(v) for v in read("SELECT DISTINCT Month FROM DIM_DATE ORDER BY 1")],
        "category": read("SELECT DISTINCT Category FROM DIM_PRODUCT ORDER BY 1"),
        "region": read("SELECT DISTINCT Region FROM DIM_GEOGRAPHY ORDER BY 1"),
        "state": read("SELECT DISTINCT State FROM DIM_GEOGRAPHY ORDER BY 1"),
        "city": read("SELECT DISTINCT City FROM DIM_GEOGRAPHY ORDER BY 1"),
        "hierarchies": HIERARCHIES,
    }
