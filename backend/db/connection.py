"""MySQL access helpers built on a pooled SQLAlchemy engine."""
import datetime as dt
from decimal import Decimal
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text

import config

_engine = None


def engine():
    global _engine
    if _engine is None:
        url = (
            f"mysql+pymysql://{quote_plus(config.DB_USER)}:{quote_plus(config.DB_PASSWORD)}"
            f"@{config.DB_HOST}:{config.DB_PORT}/{config.DB_NAME}?charset=utf8mb4"
        )
        _engine = create_engine(url, pool_pre_ping=True, pool_size=8, max_overflow=8)
    return _engine


def _clean(value):
    """Convert driver types into JSON-friendly Python values."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    return value


def rows(sql, params=None):
    """Run a SELECT and return a list of plain dictionaries."""
    with engine().connect() as conn:
        result = conn.execute(text(sql), params or {})
        return [{k: _clean(v) for k, v in row._mapping.items()} for row in result]


def one(sql, params=None):
    found = rows(sql, params)
    return found[0] if found else None


def scalar(sql, params=None):
    with engine().connect() as conn:
        return _clean(conn.execute(text(sql), params or {}).scalar())


def execute(sql, params=None):
    with engine().begin() as conn:
        conn.execute(text(sql), params or {})
