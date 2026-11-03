"""
Download the public datasets RetailIQ uses, and prepare each as one CSV in data/.

Sources are Kaggle (public datasets download without a login), the UCI Machine Learning
Repository, and the completejourney package on GitHub. The files are not stored in this
repository: this script fetches them, so their authors stay credited at the source.

Usage: python scripts/fetch_datasets.py <project root>
"""
import sys
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

KAGGLE = "https://www.kaggle.com/api/v1/datasets/download/"
COMPLETE_JOURNEY = "https://github.com/bradleyboehmke/completejourney/raw/master/data/"

# output file -> (folder name, [(download URL, saved file name)], function building the CSV from the folder)
SOURCES = {}


def source(output, reference=None, folder=None, downloads=None):
    """A Kaggle reference implies one zip download; other sources list their URLs."""
    def register(function):
        if reference:
            SOURCES[output] = (f"kaggle-{reference.split('/')[1]}", [(KAGGLE + reference, "archive.zip")], function)
        else:
            SOURCES[output] = (folder, downloads, function)
        return function
    return register


@source("amazon_india_sales_2022.csv", "thedevastator/unlock-profits-with-e-commerce-sales-data")
def amazon_orders(folder):
    # Used unchanged: ETL handles its statuses, line totals and state spellings.
    return pd.read_csv(folder / "Amazon Sale Report.csv", dtype=str, low_memory=False)


@source("india_ecommerce_orders_2018.csv", "benroshan/ecommerce-data")
def ecommerce_orders(folder):
    # The order header (date, customer, place) and the order lines are separate files.
    # Joining them on Order ID gives one row per order line.
    orders = pd.read_csv(folder / "List of Orders.csv", dtype=str).dropna(how="all")
    details = pd.read_csv(folder / "Order Details.csv", dtype=str).dropna(how="all")
    return details.merge(orders, on="Order ID", how="left")


@source("india_retail_sales_2023_2025.csv", "abirambharathisa/india-retail-sales-dataset-2023-2025")
def retail_sales(folder):
    return pd.read_csv(folder / "sales_data.csv", dtype=str)


@source("uci_online_retail_ii.csv", folder="uci-online-retail-ii",
        downloads=[("https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip", "online_retail_ii.zip")])
def online_retail_ii(folder):
    # Two sheets, one per year (December 2009 to December 2011). Customer numbers are floats
    # in Excel because the column has blanks, so they are turned back into whole numbers.
    sheets = pd.read_excel(folder / "online_retail_II.xlsx", sheet_name=None,
                           dtype={"Invoice": str, "StockCode": str, "Description": str})
    frame = pd.concat(sheets.values(), ignore_index=True)
    frame["Customer ID"] = frame["Customer ID"].astype("Int64")
    frame["InvoiceDate"] = pd.to_datetime(frame["InvoiceDate"]).dt.strftime("%Y-%m-%d %H:%M:%S")
    return frame


@source("kroger_complete_journey_2017.csv", folder="completejourney",
        downloads=[(COMPLETE_JOURNEY + name, name) for name in ["transactions.rds", "products.rda"]])
def complete_journey(folder):
    """
    84.51° (Kroger's data-science company) Complete Journey 2.0: a year of grocery purchases by
    2,469 households, distributed as CC0 R data by the completejourney package.

    Modelling choices:
      * Product grain is the product type (e.g. "Fluid Milk White Only"), not the 68,509 SKUs,
        so association rules are readable. Lines of different SKUs of one type in the same basket
        are combined, quantities and sales summed, so no purchase is lost or mistaken for a duplicate.
      * Store locations are not published, so each store is its own geography member.
      * Prices are in US dollars; RetailIQ converts them to rupees at the dataset's rate.
    """
    import warnings
    import rdata

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # rdata notes the R classes it maps to plain data frames
        lines = rdata.read_rds(folder / "transactions.rds")
        products = next(iter(rdata.read_rda(folder / "products.rda").values()))
    products = products[["product_id", "department", "product_category", "product_type"]].astype(object)
    frame = lines.astype({"product_id": str}).merge(products, on="product_id", how="left")
    kind = frame["product_type"].where(frame["product_type"].notna(), frame["product_category"])
    kind = kind.where(kind.notna(), frame["department"]).fillna("Unclassified")
    # Some type names are reused across categories. Those get their category in front, so every
    # name says what it is.
    categories_per_type = frame.groupby(kind)["product_category"].nunique()
    reused = kind.map(categories_per_type) > 1
    kind = kind.where(~reused, frame["product_category"].fillna(frame["department"]).astype(str) + ": " + kind.astype(str))
    lines = pd.DataFrame({
        "Basket_ID": frame["basket_id"].astype(str),
        # Seconds since 1970 (UTC) to a calendar date.
        "Date": pd.to_datetime(frame["transaction_timestamp"], unit="s").dt.strftime("%Y-%m-%d"),
        "Household_ID": frame["household_id"].astype(str),
        "Product_Type": kind.astype(str).str.strip().str.title(),
        "Department": frame["department"].fillna("Unclassified").astype(str).str.title(),
        "Quantity": frame["quantity"].round().astype("Int64"),
        "Sales_Value_USD": frame["sales_value"].round(2),
        "Store": "Store " + frame["store_id"].astype(str),
        "Store_Location": "Location not published",
        "Country": "United States",
    })
    keys = ["Basket_ID", "Date", "Household_ID", "Product_Type", "Department", "Store", "Store_Location", "Country"]
    combined = lines.groupby(keys, sort=False, dropna=False).agg(Quantity=("Quantity", "sum"), Sales_Value_USD=("Sales_Value_USD", "sum"))
    combined["Sales_Value_USD"] = combined["Sales_Value_USD"].round(2)
    return combined.reset_index()


def fetch(root, output, folder_name, downloads, build):
    target = root / "data" / output
    if target.exists():
        print(f"{output}: already present")
        return
    folder = root / "data" / "raw" / folder_name
    folder.mkdir(parents=True, exist_ok=True)
    for url, name in downloads:
        saved = folder / name
        if not saved.exists():
            print(f"{output}: downloading {url}")
            urllib.request.urlretrieve(url, saved)
        if name.endswith(".zip"):
            with zipfile.ZipFile(saved) as bundle:
                bundle.extractall(folder)
    frame = build(folder)
    frame.to_csv(target, index=False)
    print(f"{output}: {len(frame):,} rows written")


def main(root):
    root = Path(root).resolve()
    for output, (folder_name, downloads, build) in SOURCES.items():
        try:
            fetch(root, output, folder_name, downloads, build)
        except Exception as error:  # one unavailable source must not stop the others
            print(f"{output}: could not be prepared ({error})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2])
