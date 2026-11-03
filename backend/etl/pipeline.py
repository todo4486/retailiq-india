"""
ETL orchestration: EXTRACT -> TRANSFORM -> LOAD, followed by a refresh of the mining marts.

The pipeline runs on a background thread and writes its progress to ETL_RUNS after each
step. The frontend polls that row, so the progress on screen is the real progress.
"""
import datetime as dt
import json
import threading
import time
import traceback

from db.connection import execute, one, rows
from errors import ApiError
from etl.extract import extract_csv
from etl.load import load_star
from etl.mappings import missing_roles
from etl.transform import transform
from services.inr import format_inr

_lock = threading.Lock()


def _new_stages():
    return {
        "extract": {"status": "pending", "records": 0, "detail": "", "seconds": None},
        "transform": {"status": "pending", "records": 0, "detail": "", "seconds": None, "steps": []},
        "load": {"status": "pending", "records": 0, "detail": "", "seconds": None, "progress": 0},
        "marts": {"status": "pending", "detail": "", "seconds": None},
    }


def _save(run_id, stages, status="running", error=None, finished=False):
    execute(
        "UPDATE ETL_RUNS SET Stages=:s, Status=:st, Error=:e, Finished_At=:f WHERE Run_ID=:id",
        {"s": json.dumps(stages), "st": status, "e": error, "id": run_id,
         "f": dt.datetime.now() if finished else None},
    )


def _run(run_id, path, roles, inr_rate):
    stages = _new_stages()
    current = "extract"
    last_save = [0.0]

    def throttled_save():
        if time.time() - last_save[0] > 0.3:
            last_save[0] = time.time()
            _save(run_id, stages)

    try:
        # EXTRACT
        started = time.time()
        stages["extract"]["status"] = "running"
        with open(path, "rb") as handle:
            stages["extract"]["total"] = sum(1 for _ in handle) - 1
        _save(run_id, stages)

        def on_extract(count):
            stages["extract"]["records"] = count
            throttled_save()

        raw = extract_csv(path, on_extract)
        stages["extract"].update(
            status="done", records=len(raw), seconds=round(time.time() - started, 2),
            detail=f"Read {len(raw):,} rows and {raw.shape[1]} columns from CSV with Pandas.",
        )

        # TRANSFORM
        current = "transform"
        started = time.time()
        stages["transform"]["status"] = "running"
        _save(run_id, stages)

        def on_step(step, steps):
            stages["transform"]["steps"] = steps
            stages["transform"]["records"] = step["rows_out"]
            _save(run_id, stages)

        tables, _steps = transform(raw, roles, on_step, inr_rate)
        fact_rows = len(tables["fact"])
        stages["transform"].update(
            status="done", records=fact_rows, seconds=round(time.time() - started, 2),
            detail=f"{fact_rows:,} clean fact rows from {len(raw):,} source rows.",
        )
        del raw

        # LOAD
        current = "load"
        started = time.time()
        stages["load"]["status"] = "running"
        _save(run_id, stages)

        def on_load(written, total, table):
            stages["load"].update(records=written, progress=round(written / total, 4), detail=f"Writing {table}")
            throttled_save()

        report = load_star(tables, on_load)
        stages["load"].update(
            status="done", records=sum(report["tables"].values()), progress=1,
            seconds=round(time.time() - started, 2), report=report,
            detail=f"Committed to MySQL. Revenue reconciled at {format_inr(report['revenue_warehouse'], 2)}; "
                   f"{report['orphan_rows']} orphan rows.",
        )
        del tables

        # DERIVED MARTS: the data changed, so the mining results are recomputed.
        current = "marts"
        started = time.time()
        stages["marts"]["status"] = "running"
        _save(run_id, stages)
        from mining.apriori import run_apriori
        from mining.rfm import run_clustering

        # Small datasets get a smaller k. Below three customers, clustering has no meaning.
        customers = one("SELECT COUNT(*) AS n FROM DIM_CUSTOMER WHERE Customer_ID <> 0")["n"]
        if customers >= 3:
            cluster = run_clustering(min(5, customers - 1))
            cluster_text = f"K-Means segmented {cluster['customers']:,} customers into {cluster['k']} clusters."
        else:
            cluster_text = ("K-Means skipped: this dataset has no customer identifiers." if not customers
                            else f"K-Means skipped: only {customers} identified customers.")
        basket = run_apriori()
        basket_text = f"Apriori produced {basket['rules']:,} association rules."
        has_multi = bool(basket.get("multi_item_baskets"))
        if not basket["rules"] and not has_multi:
            basket_text = "Apriori found no rules: every order contains a single product, so there are no co-purchases to mine."
        if not basket["rules"] and has_multi:
            # Marketplace orders are mostly single items. Mine only the multi-item baskets instead,
            # where support means "share of baskets with two or more items".
            basket = run_apriori(min_support=0.005, min_confidence=0.2, multi_item_only=True)
            basket_text = (f"Apriori found no rules across all baskets, so it mined the {basket['baskets']:,} "
                           f"multi-item baskets: {basket['rules']:,} rules.")
        if not basket["rules"] and has_multi:
            # Still nothing: climb the product hierarchy and mine categories.
            basket = run_apriori(min_support=0.02, min_confidence=0.2, level="category", multi_item_only=True)
            basket_text = f"Apriori mined product categories in multi-item baskets: {basket['rules']:,} rules."
        stages["marts"].update(
            status="done", seconds=round(time.time() - started, 2),
            detail=f"{cluster_text} {basket_text}",
        )
        _save(run_id, stages, status="success", finished=True)
    except Exception as exc:  # the run is recorded as failed instead of disappearing
        traceback.print_exc()
        stages[current]["status"] = "failed"
        stages[current]["detail"] = str(exc)
        # A failed mining refresh leaves a good warehouse behind, so it is reported as partial.
        status = "partial" if current == "marts" else "failed"
        _save(run_id, stages, status=status, error=str(exc), finished=True)
    finally:
        _lock.release()


def start_run(dataset_id, dataset_name, path, roles, kind="imported", inr_rate=1.0, background=True):
    """Begin an ETL run. Only one may execute at a time."""
    missing = missing_roles(roles)
    if missing:
        raise ApiError("Map these required columns before running ETL: " + ", ".join(missing))
    if not _lock.acquire(blocking=False):
        raise ApiError("An ETL run is already in progress.", status=409, code="etl_busy")
    try:
        execute(
            "INSERT INTO ETL_RUNS (Dataset_ID, Dataset_Name, Data_Kind, Status, Started_At, Stages) "
            "VALUES (:d, :n, :k, 'running', :t, :s)",
            {"d": dataset_id, "n": dataset_name, "k": kind, "t": dt.datetime.now(),
             "s": json.dumps(_new_stages())},
        )
        run_id = one("SELECT MAX(Run_ID) AS id FROM ETL_RUNS")["id"]
    except Exception:
        _lock.release()
        raise
    if background:
        threading.Thread(target=_run, args=(run_id, path, roles, inr_rate), daemon=True).start()
    else:
        _run(run_id, path, roles, inr_rate)
    return run_id


def _present(row):
    if not row:
        return None
    return {
        "run_id": row["Run_ID"], "dataset_id": row["Dataset_ID"], "dataset_name": row["Dataset_Name"],
        "currency": "₹", "kind": row["Data_Kind"], "status": row["Status"], "started_at": row["Started_At"],
        "finished_at": row["Finished_At"], "error": row["Error"], "stages": json.loads(row["Stages"]),
    }


def get_run(run_id):
    return _present(one("SELECT * FROM ETL_RUNS WHERE Run_ID=:id", {"id": run_id}))


def latest_run():
    return _present(one("SELECT * FROM ETL_RUNS ORDER BY Run_ID DESC LIMIT 1"))


def latest_success():
    return _present(one(
        "SELECT * FROM ETL_RUNS WHERE Status IN ('success','partial') ORDER BY Run_ID DESC LIMIT 1"
    ))


def history(limit=10):
    return [_present(r) for r in rows("SELECT * FROM ETL_RUNS ORDER BY Run_ID DESC LIMIT :l", {"l": limit})]


def mark_interrupted_runs():
    """A server restart kills the worker thread, so stale 'running' rows must be closed."""
    execute(
        "UPDATE ETL_RUNS SET Status='failed', Error='Interrupted by a server restart', Finished_At=NOW() "
        "WHERE Status='running'"
    )
