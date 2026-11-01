"""Central configuration. Values come from backend/.env (created by scripts/setup.sh)."""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

DB_HOST = os.getenv("RETAILIQ_DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("RETAILIQ_DB_PORT", "3307"))
DB_USER = os.getenv("RETAILIQ_DB_USER", "retailiq")
DB_PASSWORD = os.getenv("RETAILIQ_DB_PASSWORD", "")
DB_NAME = os.getenv("RETAILIQ_DB_NAME", "retailiq")

STORAGE_DIR = BACKEND_DIR / "storage" / "datasets"
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# The UCI file converted by scripts/convert_uci_xlsx.py; registered automatically at start-up.
UCI_CSV = PROJECT_DIR / "data" / "online_retail.csv"
# The synthetic Indian demo data made by scripts/generate_india_data.py; the default dataset.
INDIA_CSV = PROJECT_DIR / "data" / "retailiq_india_synthetic.csv"

MAX_UPLOAD_BYTES = 200 * 1024 * 1024
API_PORT = int(os.getenv("RETAILIQ_API_PORT", "5050"))


def secret_key():
    """Signs session cookies. Generated once per install and never sent to the frontend."""
    configured = os.getenv("RETAILIQ_SECRET_KEY")
    if configured:
        return configured
    path = BACKEND_DIR / ".secret_key"
    if not path.exists():
        path.write_text(secrets.token_hex(32))
        path.chmod(0o600)
    return path.read_text().strip()
