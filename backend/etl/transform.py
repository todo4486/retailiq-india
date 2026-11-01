"""
TRANSFORM stage: turn raw CSV text into clean facts and conformed dimensions.

Every step records rows in, rows out and rows removed. Those numbers come straight
from the data and are what the ETL page displays. Nothing here is simulated.
"""
import numpy as np
import pandas as pd

from etl.mappings import categorize_series, geography_for, non_merchandise_mask
from services.inr import format_inr

UNKNOWN_CUSTOMER_ID = 0


def _mode(values: pd.Series):
    counts = values.value_counts()
    return counts.index[0] if len(counts) else None


def parse_dates(values: pd.Series) -> pd.Series:
    """
    Parse mixed date formats. "mixed" format examines every value separately, which is slow,
    but sales data repeats timestamps heavily, so each distinct value is parsed only once.
    """
    distinct = pd.Series(values.dropna().unique(), dtype=object).astype(str)
    # ISO dates are unambiguous. Anything else is read day-first, the Indian convention,
    # so 03/04/2025 means 3 April rather than March 4.
    is_iso = distinct.str.match(r"^\d{4}-\d{2}-\d{2}")
    parsed = pd.Series(pd.NaT, index=distinct.index, dtype="datetime64[ns]")
    if is_iso.any():
        parsed[is_iso] = pd.to_datetime(distinct[is_iso], errors="coerce", format="ISO8601")
    if (~is_iso).any():
        parsed[~is_iso] = pd.to_datetime(distinct[~is_iso], errors="coerce", format="mixed", dayfirst=True)
    return values.map(dict(zip(distinct, parsed))).astype("datetime64[ns]")


def parse_quantity(values: pd.Series) -> pd.Series:
    return pd.to_numeric(values.str.replace(",", ""), errors="coerce")


def parse_price(values: pd.Series) -> pd.Series:
    """Tolerates currency marks and separators, e.g. "Rs. 1,29,900.00" or "₹1,299"."""
    stripped = values.str.replace(r"(?i)rs\.?|inr", "", regex=True)
    return pd.to_numeric(stripped.str.replace(r"[^0-9.\-]", "", regex=True), errors="coerce")


def _standardize_columns(raw, roles):
    """Rename source columns to internal role names; absent optional roles become NaN."""
    df = pd.DataFrame(index=raw.index)
    for role in ["invoice", "stock_code", "description", "quantity", "date", "unit_price",
                 "customer_id", "customer_name", "city", "state", "country", "region", "category"]:
        source = roles.get(role)
        if source:
            values = raw[source].astype("string").str.strip()
            df[role] = values.mask(values.isin(["", "nan", "NaN", "NULL", "null", "None", "N/A", "n/a"]))
        else:
            df[role] = pd.Series(pd.NA, index=raw.index, dtype="string")
    return df


def _reverse_cancellations(df):
    """
    A cancellation (invoice prefixed "C" or a negative quantity) means an earlier purchase
    was undone. Deleting only the cancellation line would leave the original purchase
    inflating revenue: UCI contains an order of 80,995 units cancelled minutes later.

    So each cancellation is paired one-to-one with an earlier purchase that has the same
    customer, the same product and the same quantity, and both lines are removed.
    The pairing uses cumcount so that two cancellations can never consume one purchase.
    Partial returns have no exact match; only the cancellation line is dropped for those.
    """
    is_cancel = df["invoice"].str.upper().str.startswith("C", na=False) | (df["quantity"] < 0)
    key = ["customer_id", "product_code", "abs_qty"]
    work = df.assign(abs_qty=df["quantity"].abs(), _row=np.arange(len(df)))
    known = work["customer_id"].notna()

    cancels = work[is_cancel & known].sort_values("date")
    buys = work[~is_cancel & known & (work["quantity"] > 0)].sort_values("date", ascending=False)
    cancels = cancels.assign(_n=cancels.groupby(key).cumcount())
    buys = buys.assign(_n=buys.groupby(key).cumcount())

    pairs = cancels[key + ["_n", "date"]].merge(
        buys[key + ["_n", "date", "_row"]], on=key + ["_n"], suffixes=("_cancel", "_buy")
    )
    pairs = pairs[pairs["date_buy"] <= pairs["date_cancel"]]
    reversed_rows = np.zeros(len(df), dtype=bool)
    reversed_rows[pairs["_row"].to_numpy()] = True
    return is_cancel.to_numpy(), reversed_rows


def transform(raw, roles, on_step=None, inr_rate=1.0):
    """Return ({fact, dim_customer, dim_product, dim_date, dim_geography}, step log)."""
    steps = []

    def record(name, detail, before, after):
        step = {"name": name, "detail": detail, "rows_in": int(before), "rows_out": int(after),
                "removed": int(before - after)}
        steps.append(step)
        if on_step:
            on_step(step, steps)

    # 1. Map headers to warehouse roles.
    df = _standardize_columns(raw, roles)
    record("Standardise columns", "Mapped source headers to warehouse roles and blanked null markers.", len(df), len(df))

    # 2. Remove duplicate transactions: lines identical in every mapped column.
    before = len(df)
    df = df.drop_duplicates(ignore_index=True)
    record("Remove duplicate transactions", "Dropped lines identical in every field.", before, len(df))

    # 3. Standardise dates to a single datetime type.
    before = len(df)
    df["date"] = parse_dates(df["date"])
    df = df[df["date"].notna()].reset_index(drop=True)
    record("Standardise date formats", "Parsed dates into ISO datetimes and dropped unparseable values.", before, len(df))

    # 4. Convert numeric columns.
    before = len(df)
    df["quantity"] = parse_quantity(df["quantity"])
    df["unit_price"] = parse_price(df["unit_price"])
    df = df[df["quantity"].notna() & df["unit_price"].notna()].reset_index(drop=True)
    df["quantity"] = df["quantity"].astype("int64")
    # Monetary values are always held in rupees. Imported data in another currency is converted.
    df["unit_price"] = (df["unit_price"].astype("float64") * float(inr_rate)).round(2)
    detail = "Cast quantity to integer and price to decimal; dropped non-numeric values."
    if float(inr_rate) != 1:
        detail += f" Converted prices to INR at {float(inr_rate):g} per source unit."
    record("Convert numerical columns", detail, before, len(df))

    # 5. Handle missing values.
    before = len(df)
    df = df[df["invoice"].notna()]
    # The product key falls back to the name when the source has no product code.
    df["product_code"] = df["stock_code"].str.upper().fillna(df["description"])
    df = df[df["product_code"].notna()]
    # A blank description is filled from another line with the same product code.
    names = df.dropna(subset=["description"]).groupby("product_code")["description"].agg(_mode)
    df["description"] = df["description"].fillna(df["product_code"].map(names)).fillna(df["product_code"])
    df["description"] = df["description"].str.replace(r"\s+", " ", regex=True)
    df["customer_id"] = df["customer_id"].str.replace(r"\.0$", "", regex=True)
    missing_customers = int(df["customer_id"].isna().sum())
    df["city"] = df["city"].fillna(df["country"]).fillna("Unspecified").str.strip().str.title().where(
        df["city"].notna(), df["country"].fillna("Unspecified")
    )
    df = df.reset_index(drop=True)
    record(
        "Handle missing values",
        f"Dropped lines with no invoice or product. {missing_customers:,} lines without a customer number "
        "were kept and assigned to the Unknown customer.",
        before, len(df),
    )

    # 6. Reverse cancelled purchases.
    before = len(df)
    is_cancel, is_reversed = _reverse_cancellations(df)
    df = df[~is_reversed].reset_index(drop=True)
    is_cancel = is_cancel[~is_reversed]
    record("Reverse cancelled purchases", "Removed purchases later cancelled in full (same customer, product and quantity).", before, len(df))

    # 7. Remove invalid transactions.
    before = len(df)
    df = df[~is_cancel]
    df = df[(df["quantity"] > 0) & (df["unit_price"] > 0)].reset_index(drop=True)
    record("Remove invalid transactions", "Removed cancellation lines and lines with quantity or unit price of zero or below.", before, len(df))

    # 8. Remove non-product lines (postage, bank charges, manual adjustments).
    before = len(df)
    df = df[~non_merchandise_mask(df["product_code"], df["description"])].reset_index(drop=True)
    record("Remove non-merchandise lines", "Removed postage, fees, manual adjustments and gift vouchers.", before, len(df))

    if df.empty:
        raise ValueError("No valid transactions remain after cleaning. Check the column mapping.")

    # 9. Calculate the revenue measure.
    df["revenue"] = (df["quantity"] * df["unit_price"]).round(2)
    record("Calculate revenue", f"Revenue = Quantity x Unit_Price. Total = {format_inr(df['revenue'].sum(), 2)}.", len(df), len(df))

    # 10. Build conformed dimensions and assign surrogate keys.
    tables = _build_star(df)
    record(
        "Create customer and product identifiers",
        f"Assigned surrogate keys to {len(tables['dim_customer']) - 1:,} customers and "
        f"{len(tables['dim_product']):,} products.",
        len(df), len(df),
    )
    return tables, steps


def _build_star(df):
    """
    Build the dimensions, then replace each natural key in the facts with a surrogate key.

    Surrogate keys are small integers owned by the warehouse. They isolate it from
    changes in source codes and make the fact table's joins fast.
    """
    # DIM_PRODUCT: one row per stock code; the most frequent spelling names the product.
    product = df.groupby("product_code", sort=True).agg(
        Product_Name=("description", _mode), Source_Category=("category", _mode)
    ).reset_index()
    product["Product_ID"] = np.arange(1, len(product) + 1)
    derived = categorize_series(product["Product_Name"])
    product["Category"] = product["Source_Category"].astype(object).where(product["Source_Category"].notna(), derived)
    dim_product = product.rename(columns={"product_code": "Stock_Code"})[
        ["Product_ID", "Stock_Code", "Product_Name", "Category"]
    ]

    # DIM_CUSTOMER: a customer's country is the one they most often buy from.
    known = df[df["customer_id"].notna()]
    customer = known.groupby("customer_id", sort=True).agg(
        Source_Name=("customer_name", _mode)
    ).reset_index()
    customer["Customer_ID"] = np.arange(1, len(customer) + 1)
    # The UCI customers are anonymised, so the name is built from the source number.
    customer["Customer_Name"] = customer["Source_Name"].astype(object).where(
        customer["Source_Name"].notna(), "Customer " + customer["customer_id"].astype(str)
    )
    dim_customer = customer.rename(columns={"customer_id": "Source_Customer_Code"})[
        ["Customer_ID", "Source_Customer_Code", "Customer_Name"]
    ]
    # Filled in by K-Means (mining/rfm.py), which writes each customer's segment back here.
    dim_customer = dim_customer.assign(Customer_Segment="Unclassified")
    unknown = pd.DataFrame([{
        "Customer_ID": UNKNOWN_CUSTOMER_ID, "Source_Customer_Code": "UNKNOWN",
        "Customer_Name": "Walk-in or unidentified", "Customer_Segment": "Unidentified",
    }])
    dim_customer = pd.concat([unknown, dim_customer], ignore_index=True)

    # DIM_DATE: one row per calendar day that has sales; Date_ID is the smart key YYYYMMDD.
    days = pd.Series(df["date"].dt.normalize().unique()).sort_values()
    dim_date = pd.DataFrame({
        "Date_ID": days.dt.strftime("%Y%m%d").astype(int),
        "Date": days.dt.strftime("%Y-%m-%d"),
        "Day": days.dt.day, "Month": days.dt.month, "Quarter": days.dt.quarter, "Year": days.dt.year,
    }).reset_index(drop=True)

    # DIM_GEOGRAPHY: one row per city. Source state and region win; otherwise the lookup in mappings.py.
    geo = df.groupby("city", sort=True).agg(Source_State=("state", _mode), Source_Region=("region", _mode)).reset_index()
    geo["Geography_ID"] = np.arange(1, len(geo) + 1)
    lookup = geo["city"].map(geography_for)
    geo["State"] = geo["Source_State"].astype(object).where(geo["Source_State"].notna(), lookup.str[0])
    geo["Region"] = geo["Source_Region"].astype(object).where(geo["Source_Region"].notna(), lookup.str[1])
    dim_geography = geo.rename(columns={"city": "City"})[["Geography_ID", "City", "State", "Region"]]

    # FACT_SALES: swap natural keys for surrogate keys.
    fact = pd.DataFrame({
        "Sale_ID": np.arange(1, len(df) + 1),
        "Transaction_ID": df["invoice"].astype(str),
        "Customer_ID": df["customer_id"].map(dict(zip(customer["customer_id"], customer["Customer_ID"])))
        .fillna(UNKNOWN_CUSTOMER_ID).astype(int),
        "Product_ID": df["product_code"].map(dict(zip(product["product_code"], product["Product_ID"]))).astype(int),
        "Date_ID": df["date"].dt.strftime("%Y%m%d").astype(int),
        "Geography_ID": df["city"].map(dict(zip(geo["city"], geo["Geography_ID"]))).astype(int),
        "Quantity": df["quantity"],
        "Unit_Price": df["unit_price"],
        "Revenue": df["revenue"],
    })
    return {"fact": fact, "dim_customer": dim_customer, "dim_product": dim_product,
            "dim_date": dim_date, "dim_geography": dim_geography}
