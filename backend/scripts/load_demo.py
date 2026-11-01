"""Load the synthetic Indian dataset into an empty warehouse. Called by scripts/setup.sh."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db.connection import scalar  # noqa: E402
from db.schema import create_all, migrate_if_needed  # noqa: E402
from etl.pipeline import latest_run, start_run  # noqa: E402
from services import datasets  # noqa: E402

migrate_if_needed()
create_all()
datasets.ensure_builtin()
if scalar("SELECT COUNT(*) FROM FACT_SALES"):
    print("The warehouse already holds data. Nothing to do.")
    sys.exit(0)
meta = datasets.get_meta(datasets.INDIA_ID)
start_run(meta["id"], meta["name"], meta["path"], meta["roles"], meta["kind"], meta["inr_rate"], background=False)
run = latest_run()
print(run["status"], run["stages"]["load"]["detail"], run["stages"]["marts"]["detail"])
