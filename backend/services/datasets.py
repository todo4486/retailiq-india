"""
Data Explorer service: dataset registry, profiling, data-quality report and record search.

This works on the RAW source file, before ETL. The point is to see the data as it
arrived: its duplicates, blanks and invalid values.
"""
import datetime as dt
import json
import re
import threading
import uuid
from collections import OrderedDict

import numpy as np
import pandas as pd

import config
from errors import ApiError
from etl.extract import extract_csv
from etl.mappings import NOT_SOLD_STATUS, REQUIRED_ROLES, ROLE_LABELS, detect_roles, missing_roles
from etl.transform import parse_dates, parse_price, parse_quantity

INDIA_ID = "india-synthetic"
UCI_ID = "uci-online-retail"
AMAZON_ID = "amazon-india-2022"
ECOMMERCE_ID = "india-ecommerce-2018"
RETAIL_SALES_ID = "india-retail-sales-2023"
KROGER_ID = "kroger-complete-journey-2017"
UCI_II_ID = "uci-online-retail-ii"
_frames = OrderedDict()  # small LRU cache: parsing 540k rows takes a second or two
_profiles = {}
_CACHE_SIZE = 2
_profile_lock = threading.Lock()


def _meta_path(dataset_id):
    if not re.fullmatch(r"[a-z0-9-]+", dataset_id or ""):
        raise ApiError("Invalid dataset id.", status=404, code="not_found")
    return config.STORAGE_DIR / f"{dataset_id}.json"


def _write_meta(meta):
    _meta_path(meta["id"]).write_text(json.dumps(meta, indent=2))


_BUILTINS = [
    {
        "id": INDIA_ID, "path": config.INDIA_CSV, "name": "RetailIQ India (synthetic)", "kind": "synthetic", "inr_rate": 1.0,
        "order": 0,
        "note": "Simulated by scripts/generate_india_data.py. It does not represent the sales of any real company.",
        "notice": "Synthetic demonstration data. Not the sales of any real company.",
    },
    {
        "id": AMAZON_ID, "path": config.AMAZON_CSV, "name": "Amazon.in seller orders 2022 (real)", "kind": "real",
        "inr_rate": 1.0, "order": 1, "source": "https://www.kaggle.com/datasets/thedevastator/unlock-profits-with-e-commerce-sales-data",
        "credit": "Anil Sharma, data.world (https://data.world/anilsharma87), via Kaggle user thedevastator",
        "notice": "Real data: Amazon.in orders of an Indian apparel seller, 31 March to 29 June 2022. "
                  "Source: Kaggle (thedevastator), original author Anil Sharma on data.world.",
        "note": "Real marketplace order lines in rupees, shared publicly on Kaggle with credit to the original author. "
                "There are no customer IDs, so RFM and K-Means cannot run on it.",
        # Style is the design: one product across its sizes. Amount is the line total.
        "roles": {"invoice": "Order ID", "date": "Date", "status": "Status", "stock_code": "Style", "category": "Category",
                  "quantity": "Qty", "line_amount": "Amount", "city": "ship-city", "state": "ship-state"},
    },
    {
        "id": ECOMMERCE_ID, "path": config.ECOMMERCE_CSV, "name": "Indian e-commerce orders 2018-19 (shared on Kaggle)",
        "kind": "imported", "inr_rate": 1.0, "order": 2, "source": "https://www.kaggle.com/datasets/benroshan/ecommerce-data",
        "credit": "Kaggle user benroshan. The uploader states the original author is unknown.",
        "notice": "Indian e-commerce orders, April 2018 to March 2019, shared on Kaggle (benroshan, CC0) as real data. "
                  "The original author is unknown, so its origin cannot be verified.",
        "note": "A small set of order lines with customer names, Indian cities and states. Its uploader says it came from "
                "a university course and that the original author is unknown. Treat it as unverified.",
        # Sub-category is the product; Amount is the line total; the customer is known only by name.
        "roles": {"invoice": "Order ID", "date": "Order Date", "customer_id": "CustomerName", "customer_name": "CustomerName",
                  "stock_code": "Sub-Category", "category": "Category", "quantity": "Quantity", "line_amount": "Amount",
                  "city": "City", "state": "State"},
    },
    {
        "id": RETAIL_SALES_ID, "path": config.RETAIL_SALES_CSV, "name": "India Retail Sales 2023-25 (synthetic, Kaggle)",
        "kind": "synthetic", "inr_rate": 1.0, "order": 3,
        "source": "https://www.kaggle.com/datasets/abirambharathisa/india-retail-sales-dataset-2023-2025",
        "credit": "Kaggle user abirambharathisa (CC0)",
        "notice": "Synthetic demonstration data by Kaggle user abirambharathisa (CC0). Not the sales of any real company.",
        "note": "A synthetic dataset by another author: 20,000 single-product orders from about 4,000 customers in 17 cities, "
                "January 2023 to December 2025. Revenue uses its sales column, which is net of discount.",
        "roles": {"invoice": "order_id", "date": "order_date", "customer_id": "customer_id", "description": "product",
                  "category": "category", "quantity": "quantity", "line_amount": "sales", "city": "city", "region": "region"},
    },
    {
        "id": UCI_ID, "path": config.UCI_CSV, "name": "UCI Online Retail (real, UK)", "kind": "imported", "inr_rate": 75.0,
        "order": 4, "source": "https://archive.ics.uci.edu/dataset/352/online+retail",
        "notice": "Real data: UCI Online Retail, UK transactions 2010 to 2011, converted to rupees at an approximate rate.",
        "note": "Real UK transactions from 2010 to 2011, priced in pounds. Converted at an approximate rate of "
                "75 rupees per pound, which you can change. Geography is by country, not Indian city.",
    },
    {
        "id": KROGER_ID, "path": config.KROGER_CSV, "name": "Kroger shoppers 2017 (real, 84.51° Complete Journey)",
        "kind": "real", "inr_rate": 65.0, "order": 5,
        "source": "https://github.com/bradleyboehmke/completejourney",
        "credit": "84.51° (Kroger) Complete Journey 2.0 source files, distributed under CC0 by the completejourney R package "
                  "(Brad Boehmke and Steven Mortimer)",
        "notice": "Real data: a year of grocery purchases by 2,469 Kroger shopper households, 2017. Source: 84.51° "
                  "Complete Journey, via the completejourney package (CC0). Converted from US dollars at about ₹65 per dollar.",
        "note": "Real US supermarket baskets from Kroger's data-science company 84.51°. Households are anonymised and store "
                "locations are not published, so each store is its own geography member. Products are grouped by product "
                "type. Prices are in US dollars, converted at an approximate 2017 rate you can change.",
        "roles": {"invoice": "Basket_ID", "date": "Date", "customer_id": "Household_ID", "stock_code": "Product_Type",
                  "description": "Product_Type", "category": "Department", "quantity": "Quantity",
                  "line_amount": "Sales_Value_USD", "city": "Store", "state": "Store_Location", "region": "Country"},
    },
    {
        "id": UCI_II_ID, "path": config.UCI_II_CSV, "name": "UCI Online Retail II 2009-11 (real, UK)",
        "kind": "real", "inr_rate": 75.0, "order": 6, "source": "https://archive.ics.uci.edu/dataset/502/online+retail+ii",
        "credit": "Daqing Chen, UCI Machine Learning Repository (CC BY 4.0)",
        "notice": "Real data: UCI Online Retail II, a UK online gift retailer, December 2009 to December 2011 (CC BY 4.0). "
                  "Converted from pounds at about ₹75 per pound.",
        "note": "The two-year version of the UCI dataset above: about 10.7 lakh lines from a UK-based online gift wholesaler. "
                "Priced in pounds, converted at an approximate rate you can change. Geography is by country.",
    },
]


def ensure_builtin():
    """Register the bundled CSV files on start-up, if the setup script has produced them."""
    for spec in _BUILTINS:
        path = spec["path"]
        if not path.exists():
            continue
        existing = _meta_path(spec["id"])
        if existing.exists() and "notice" in json.loads(existing.read_text()):
            continue
        header = pd.read_csv(path, nrows=0, dtype=str)
        with open(path, "rb") as handle:
            line_count = sum(1 for _ in handle) - 1
        meta = {**spec, "path": str(path), "filename": path.name, "rows": line_count, "columns": len(header.columns),
                "size": path.stat().st_size, "added_at": dt.datetime.now().isoformat(timespec="seconds"),
                "roles": spec.get("roles") or detect_roles(header.columns), "builtin": True}
        _write_meta(meta)


def notice_for(dataset_id, kind):
    """The data-origin statement shown on dashboards, reports and PDFs."""
    try:
        meta = get_meta(dataset_id)
        if meta.get("notice"):
            return {"notice": meta["notice"], "source": meta.get("source"), "credit": meta.get("credit")}
    except ApiError:
        pass
    text = {"synthetic": "Synthetic demonstration data. Not the sales of any real company."}.get(kind, "Imported dataset. Values in INR.")
    return {"notice": text, "source": None, "credit": None}


def list_datasets():
    metas = [json.loads(p.read_text()) for p in config.STORAGE_DIR.glob("*.json")]
    return sorted(metas, key=lambda m: (m.get("order", 9), m["added_at"]))


def get_meta(dataset_id):
    path = _meta_path(dataset_id)
    if not path.exists():
        raise ApiError("Dataset not found.", status=404, code="not_found")
    return json.loads(path.read_text())


def save_upload(file_storage):
    name = file_storage.filename or "upload.csv"
    if not name.lower().endswith(".csv"):
        raise ApiError("Upload a file with a .csv extension.")
    dataset_id = uuid.uuid4().hex[:12]
    path = config.STORAGE_DIR / f"{dataset_id}.csv"
    file_storage.save(path)
    try:
        frame = extract_csv(path)
    except Exception as exc:
        if path.exists():
            path.unlink()
        message = "The file has no data rows." if "no data" in str(exc).lower() else f"This file could not be read as CSV: {exc}"
        raise ApiError(message)
    meta = {
        "id": dataset_id, "name": re.sub(r"\.csv$", "", name, flags=re.I), "filename": name, "path": str(path),
        "rows": len(frame), "columns": frame.shape[1], "size": path.stat().st_size,
        "added_at": dt.datetime.now().isoformat(timespec="seconds"),
        "roles": detect_roles(frame.columns), "builtin": False, "kind": "imported", "inr_rate": 1.0,
        "note": "Imported by you. Enter a conversion rate if its prices are not in rupees.",
    }
    _write_meta(meta)
    _remember(dataset_id, frame)
    return meta


def delete_dataset(dataset_id):
    meta = get_meta(dataset_id)
    if meta.get("builtin"):
        raise ApiError("The built-in dataset cannot be deleted.")
    for path in [_meta_path(dataset_id), config.STORAGE_DIR / f"{dataset_id}.csv"]:
        if path.exists():
            path.unlink()
    _frames.pop(dataset_id, None)
    _profiles.pop(dataset_id, None)


def update_settings(dataset_id, roles=None, inr_rate=None):
    meta = get_meta(dataset_id)
    if roles is not None:
        columns = set(_frame(dataset_id).columns)
        unknown = [c for c in roles.values() if c and c not in columns]
        if unknown:
            raise ApiError(f"Unknown columns: {', '.join(unknown)}")
        meta["roles"] = {k: v for k, v in roles.items() if v}
        _profiles.pop(dataset_id, None)
    if inr_rate is not None:
        try:
            rate = float(inr_rate)
        except (TypeError, ValueError):
            raise ApiError("The conversion rate must be a number.")
        if rate <= 0:
            raise ApiError("The conversion rate must be above zero.")
        meta["inr_rate"] = rate
    _write_meta(meta)
    return meta


def _remember(dataset_id, frame):
    _frames[dataset_id] = frame
    _frames.move_to_end(dataset_id)
    while len(_frames) > _CACHE_SIZE:
        _frames.popitem(last=False)


def _frame(dataset_id):
    if dataset_id not in _frames:
        _remember(dataset_id, extract_csv(get_meta(dataset_id)["path"]))
    _frames.move_to_end(dataset_id)
    return _frames[dataset_id]


# ------------------------------------------------------------------ profiling

_ID_NAME = re.compile(r"(^|[^a-z])(id|no|code|sku|number|key)$|id$|code$|no$", re.I)


def _infer_type(series, name, id_columns):
    values = series.dropna()
    if values.empty:
        return "empty"
    if name in id_columns or _ID_NAME.search(name):
        return "identifier"
    numeric = pd.to_numeric(values, errors="coerce")
    if numeric.notna().mean() >= 0.98:
        return "integer" if (numeric.dropna() % 1 == 0).all() else "decimal"
    sample = values.head(1000)
    if parse_dates(sample).notna().mean() >= 0.98:
        return "datetime"
    if values.nunique() <= max(200, 0.02 * len(values)):
        return "categorical"
    return "text"


def _column_profile(frame, name, id_columns):
    series = frame[name]
    missing = int(series.isna().sum())
    kind = _infer_type(series, name, id_columns)
    values = series.dropna()
    profile = {"name": name, "type": kind, "missing": missing, "missing_pct": missing / max(len(series), 1),
               "unique": int(values.nunique())}
    if kind in ("integer", "decimal"):
        numeric = pd.to_numeric(values, errors="coerce").dropna()
        profile["stats"] = {
            "mean": float(numeric.mean()), "std": float(numeric.std()) if len(numeric) > 1 else 0.0,
            "min": float(numeric.min()), "q1": float(numeric.quantile(0.25)), "median": float(numeric.median()),
            "q3": float(numeric.quantile(0.75)), "max": float(numeric.max()),
            "non_numeric": int(len(values) - len(numeric)),
        }
    elif kind == "datetime":
        parsed = parse_dates(values)
        profile["stats"] = {"min": str(parsed.min()), "max": str(parsed.max()), "unparseable": int(parsed.isna().sum())}
    if kind in ("categorical", "text", "identifier"):
        top = values.value_counts().head(5)
        profile["top_values"] = [{"value": str(k), "count": int(v)} for k, v in top.items()]
    return profile


def _quality_masks(frame, roles):
    """The rules a record must pass. They mirror the ETL Transform stage's first filters."""
    n = len(frame)
    false = np.zeros(n, dtype=bool)
    duplicates = frame.duplicated(keep="first").to_numpy()
    usable = not missing_roles(roles)
    missing_required, invalid = false.copy(), false.copy()
    breakdown = []
    if usable:
        for role in REQUIRED_ROLES:
            missing_required |= frame[roles[role]].isna().to_numpy()
        # The same parsers as ETL, so this report and the pipeline agree on what is numeric.
        quantity = parse_quantity(frame[roles["quantity"]])
        price_column = roles.get("unit_price") or roles["line_amount"]
        price = parse_price(frame[price_column])
        if not roles.get("unit_price"):
            price = (price / quantity).where(quantity > 0)
        dates = parse_dates(frame[roles["date"]])
        cancelled = frame[roles["invoice"]].astype("string").str.upper().str.startswith("C", na=False).to_numpy()
        if roles.get("status"):
            cancelled |= frame[roles["status"]].str.contains(NOT_SOLD_STATUS.pattern, case=False, regex=True, na=False).to_numpy()
        rules = [
            ("Cancelled, returned or not sold", cancelled),
            ("Quantity zero or negative", (quantity <= 0).to_numpy()),
            ("Unit price zero or negative", (price <= 0).to_numpy()),
            ("Non-numeric quantity", (quantity.isna() & frame[roles["quantity"]].notna()).to_numpy()),
            ("Non-numeric price", (price.isna() & frame[price_column].notna() & (quantity > 0)).to_numpy()),
            ("Unparseable date", (dates.isna() & frame[roles["date"]].notna()).to_numpy()),
        ]
        for label, mask in rules:
            invalid |= mask
            breakdown.append({"rule": label, "count": int(mask.sum())})
    return {"duplicates": duplicates, "missing": missing_required, "invalid": invalid}, breakdown, usable


def get_profile(dataset_id):
    meta = get_meta(dataset_id)
    # The page requests the profile and the rows together, so only one thread builds it.
    with _profile_lock:
        if dataset_id not in _profiles:
            _profiles[dataset_id] = _build_profile(dataset_id, meta)
    return {**_profiles[dataset_id], "dataset": meta}


def _build_profile(dataset_id, meta):
    frame = _frame(dataset_id)
    roles = meta.get("roles", {})
    id_columns = {roles.get(r) for r in ("invoice", "stock_code", "customer_id")} - {None}
    masks, breakdown, usable = _quality_masks(frame, roles)
    valid = ~(masks["duplicates"] | masks["missing"] | masks["invalid"])
    profile = {
        "rows": len(frame),
        "columns": [_column_profile(frame, c, id_columns) for c in frame.columns],
        "quality": {
            "total": len(frame),
            "duplicates": int(masks["duplicates"].sum()),
            "missing_cells": int(frame.isna().sum().sum()),
            "rows_with_missing": int(frame.isna().any(axis=1).sum()),
            "missing_required": int(masks["missing"].sum()),
            "invalid": int(masks["invalid"].sum()),
            "valid": int(valid.sum()) if usable else None,
            "invalid_breakdown": breakdown,
            "rules_applied": usable,
        },
        "role_labels": ROLE_LABELS,
        "required_roles": REQUIRED_ROLES,
        "missing_roles": missing_roles(roles),
    }
    return profile


def _apply_filter(frame, spec, types):
    column, op, value = spec.get("column"), spec.get("op", "contains"), spec.get("value", "")
    if column not in frame.columns:
        raise ApiError(f"Unknown column: {column}")
    series = frame[column]
    if op == "empty":
        return series.isna()
    if op == "not_empty":
        return series.notna()
    if op == "contains":
        return series.str.contains(str(value), case=False, regex=False, na=False)
    if op == "equals":
        return series.str.lower() == str(value).lower()
    if op == "not_equals":
        return series.str.lower() != str(value).lower()
    if op in ("gt", "lt"):
        if types.get(column) == "datetime":
            left, right = parse_dates(series), pd.to_datetime(value, errors="coerce")
            if pd.isna(right):
                raise ApiError(f"'{value}' is not a valid date.")
        else:
            left, right = pd.to_numeric(series, errors="coerce"), pd.to_numeric(value, errors="coerce")
            if pd.isna(right):
                raise ApiError(f"'{value}' is not a number.")
        return left > right if op == "gt" else left < right
    raise ApiError(f"Unknown filter operator: {op}")


def get_rows(dataset_id, search="", sort=None, direction="asc", page=1, page_size=50, filters=None, view="all"):
    meta = get_meta(dataset_id)
    frame = _frame(dataset_id)
    profile = get_profile(dataset_id)
    types = {c["name"]: c["type"] for c in profile["columns"]}

    mask = pd.Series(True, index=frame.index)
    if view in ("duplicates", "missing", "invalid"):
        masks, _, _ = _quality_masks(frame, meta.get("roles", {}))
        mask &= masks[view]
    elif view == "any_missing":
        mask &= frame.isna().any(axis=1)
    for spec in filters or []:
        mask &= _apply_filter(frame, spec, types)
    if search:
        hit = pd.Series(False, index=frame.index)
        for column in frame.columns:
            hit |= frame[column].str.contains(search, case=False, regex=False, na=False)
        mask &= hit

    subset = frame[mask]
    if sort:
        if sort not in frame.columns:
            raise ApiError(f"Unknown column: {sort}")
        ascending = direction != "desc"
        kind = types.get(sort)
        if kind in ("integer", "decimal"):
            key = lambda s: pd.to_numeric(s, errors="coerce")
        elif kind == "datetime":
            key = parse_dates
        else:
            key = None
        subset = subset.sort_values(sort, ascending=ascending, key=key, na_position="last", kind="stable")

    page = max(int(page), 1)
    page_size = min(max(int(page_size), 1), 200)
    window = subset.iloc[(page - 1) * page_size: page * page_size]
    records = window.astype(object).where(window.notna(), None).to_dict(orient="records")
    return {"columns": list(frame.columns), "rows": records, "total": len(subset), "page": page, "page_size": page_size}
