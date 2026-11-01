"""Warehouse catalog: reads the schema of the star from MySQL's own metadata."""
from db.connection import one, rows
from db.schema import STAR_TABLES
from errors import ApiError


def _columns(table):
    return rows(
        """
        SELECT c.COLUMN_NAME AS name, c.COLUMN_TYPE AS type, c.COLUMN_KEY AS col_key, c.IS_NULLABLE AS nullable,
               k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
          ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
         AND k.REFERENCED_TABLE_NAME IS NOT NULL
        WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = :t
        ORDER BY c.ORDINAL_POSITION
        """,
        {"t": table},
    )


def _present_columns(table):
    return [{
        "name": c["name"], "type": c["type"], "primary": c["col_key"] == "PRI", "nullable": c["nullable"] == "YES",
        "foreign": {"table": c["ref_table"].upper(), "column": c["ref_column"]} if c["ref_table"] else None,
    } for c in _columns(table)]


def schema():
    tables = []
    for table in STAR_TABLES:
        tables.append({
            "name": table,
            "kind": "fact" if table.startswith("FACT") else "dimension",
            "rows": one(f"SELECT COUNT(*) AS n FROM {table}")["n"],
            "columns": _present_columns(table),
        })
    return {"tables": tables}


def table_detail(table, page=1, page_size=10, sort=None, direction="asc"):
    if table not in STAR_TABLES:  # whitelist: table names cannot be bound as parameters
        raise ApiError("Unknown table.", status=404, code="not_found")
    columns = _present_columns(table)
    names = [c["name"] for c in columns]
    order = sort if sort in names else names[0]
    order_dir = "DESC" if direction == "desc" else "ASC"
    page = max(int(page), 1)
    page_size = min(max(int(page_size), 1), 100)
    sample = rows(
        f"SELECT * FROM {table} ORDER BY {order} {order_dir} LIMIT :l OFFSET :o",
        {"l": page_size, "o": (page - 1) * page_size},
    )
    return {
        "name": table, "columns": columns, "rows": sample,
        "total": one(f"SELECT COUNT(*) AS n FROM {table}")["n"], "page": page, "page_size": page_size,
    }
