"""
LOAD stage: write the star schema into MySQL.

Dimensions load before the fact table so every foreign key has a parent row.
The whole load is one database transaction. If anything fails MySQL rolls back, and
analysts keep querying the previous warehouse until the new one commits.
"""
from sqlalchemy import text

from db.connection import engine

BATCH_ROWS = 5000

_TABLES = [
    ("DIM_CUSTOMER", "dim_customer"),
    ("DIM_PRODUCT", "dim_product"),
    ("DIM_DATE", "dim_date"),
    ("DIM_GEOGRAPHY", "dim_geography"),
    ("FACT_SALES", "fact"),
]


def _insert(conn, table, frame, on_batch):
    columns = list(frame.columns)
    sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))})"
    records = frame.astype(object).values.tolist()
    for start in range(0, len(records), BATCH_ROWS):
        batch = [tuple(r) for r in records[start:start + BATCH_ROWS]]
        conn.exec_driver_sql(sql, batch)
        on_batch(len(batch))


def load_star(tables, on_progress=None):
    """Replace the warehouse contents, reconcile them with the source, then commit."""
    total = sum(len(tables[key]) for _, key in _TABLES)
    written = 0
    loaded = {}

    with engine().begin() as conn:
        # Children first when clearing: derived marts, then facts, then dimensions.
        for table in ["CUSTOMER_RFM", "ASSOCIATION_RULES", "MINING_RUNS", "FACT_SALES",
                      "DIM_CUSTOMER", "DIM_PRODUCT", "DIM_DATE", "DIM_GEOGRAPHY"]:
            conn.execute(text(f"DELETE FROM {table}"))

        for table, key in _TABLES:
            def on_batch(count):
                nonlocal written
                written += count
                if on_progress:
                    on_progress(written, total, table)

            _insert(conn, table, tables[key], on_batch)
            loaded[table] = int(conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar())

        # Reconciliation: what the database now holds must equal what Transform produced.
        db_revenue = float(conn.execute(text("SELECT COALESCE(SUM(Revenue), 0) FROM FACT_SALES")).scalar())
        expected = float(tables["fact"]["Revenue"].sum())
        orphans = int(conn.execute(text("""
            SELECT COUNT(*) FROM FACT_SALES f
            LEFT JOIN DIM_CUSTOMER c ON f.Customer_ID = c.Customer_ID
            LEFT JOIN DIM_PRODUCT p ON f.Product_ID = p.Product_ID
            LEFT JOIN DIM_DATE d ON f.Date_ID = d.Date_ID
            LEFT JOIN DIM_GEOGRAPHY g ON f.Geography_ID = g.Geography_ID
            WHERE c.Customer_ID IS NULL OR p.Product_ID IS NULL OR d.Date_ID IS NULL OR g.Geography_ID IS NULL
        """)).scalar())
        if loaded["FACT_SALES"] != len(tables["fact"]) or abs(db_revenue - expected) > 0.01 or orphans:
            # Raising inside the transaction rolls everything back.
            raise RuntimeError(
                f"Reconciliation failed: {loaded['FACT_SALES']} of {len(tables['fact'])} rows, "
                f"revenue {db_revenue:.2f} vs {expected:.2f}, {orphans} orphan rows."
            )

    return {"tables": loaded, "revenue_source": round(expected, 2), "revenue_warehouse": round(db_revenue, 2),
            "orphan_rows": orphans}
