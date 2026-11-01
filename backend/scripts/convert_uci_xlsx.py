"""
Convert the UCI "Online Retail.xlsx" download into data/online_retail.csv.

UCI distributes the dataset as Excel, and the ETL pipeline's Extract stage reads CSV.
The file is converted unchanged: no rows are cleaned here, that is the ETL's job.

Usage: python scripts/convert_uci_xlsx.py <input.xlsx> <output.csv>
"""
import sys

import pandas as pd


def main(source, target):
    frame = pd.read_excel(source, dtype={"InvoiceNo": str, "StockCode": str, "Description": str})
    # Excel stores the customer number as a float (17850.0) because the column has blanks.
    frame["CustomerID"] = frame["CustomerID"].astype("Int64")
    frame.to_csv(target, index=False, date_format="%Y-%m-%d %H:%M:%S")
    print(f"{len(frame)} rows written to {target}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
