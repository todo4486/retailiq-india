"""Reports: builds each report from the warehouse, then exports it as JSON, CSV or PDF."""
import calendar
import csv
import datetime as dt
import io

from db.connection import one, rows
from errors import ApiError, WarehouseEmpty
from etl.pipeline import latest_success
from mining.apriori import get_rules
from mining.rfm import run_info, segment_summary
from services.datasets import notice_for
from services.inr import format_inr, format_number
from services.overview import _date_bounds, _month_index, data_span

REPORT_TYPES = {
    "sales": "Revenue",
    "products": "Product Performance",
    "cities": "City-wise Sales",
    "customers": "Customer Segmentation",
    "basket": "Market Basket Analysis",
}
NOTICES = {
    "synthetic": "SYNTHETIC DEMONSTRATION DATA. NOT THE SALES OF ANY REAL COMPANY.",
    "imported": "IMPORTED DATASET, VALUES IN INR.",
}


def _money(value):
    return format_inr(value, 2)


def _range_clause(from_month, to_month):
    first, last = data_span()
    start_month = from_month or first[:7]
    end_month = to_month or last[:7]
    start, end = _date_bounds(_month_index(start_month), _month_index(end_month))
    if start > end:
        raise ApiError("The start month must not be after the end month.")
    return start, end, start_month, end_month


def _sales(start, end):
    monthly = rows(
        """
        SELECT DATE_FORMAT(d.Date, '%Y-%m') AS month, SUM(f.Revenue) AS revenue, SUM(f.Quantity) AS quantity,
               COUNT(DISTINCT f.Transaction_ID) AS orders,
               COUNT(DISTINCT NULLIF(f.Customer_ID, 0)) AS customers
        FROM FACT_SALES f JOIN DIM_DATE d ON f.Date_ID = d.Date_ID
        WHERE f.Date_ID BETWEEN :s AND :e GROUP BY DATE_FORMAT(d.Date, '%Y-%m') ORDER BY month
        """,
        {"s": start, "e": end},
    )
    for r in monthly:
        r["aov"] = r["revenue"] / r["orders"] if r["orders"] else 0
    total = one(
        """SELECT COALESCE(SUM(Revenue),0) AS revenue, COUNT(DISTINCT Transaction_ID) AS orders,
           COUNT(DISTINCT NULLIF(Customer_ID,0)) AS customers, COALESCE(SUM(Quantity),0) AS quantity
           FROM FACT_SALES WHERE Date_ID BETWEEN :s AND :e""",
        {"s": start, "e": end},
    )
    findings = []
    if monthly:
        # A month the data stops part-way through must not be ranked against complete months.
        _, last_date = data_span()
        last = dt.date.fromisoformat(last_date[:10])
        partial_month = None
        if last.day < calendar.monthrange(last.year, last.month)[1] - 2:
            partial_month = last_date[:7]
        first_date, _ = data_span()
        starts_late = dt.date.fromisoformat(first_date[:10]).day > 3
        partial_first = first_date[:7] if starts_late else None
        complete = [r for r in monthly if r["month"] not in (partial_month, partial_first)] or monthly
        peak = max(complete, key=lambda r: r["revenue"])
        low = min(complete, key=lambda r: r["revenue"])
        findings = [
            f"Revenue totalled {_money(total['revenue'])} across {format_number(total['orders'])} orders.",
            f"The strongest complete month was {peak['month']} at {_money(peak['revenue'])}.",
            f"The weakest complete month was {low['month']} at {_money(low['revenue'])}.",
        ]
        if partial_first and any(r["month"] == partial_first for r in monthly):
            findings.append(f"{partial_first} is incomplete: the data starts on day {dt.date.fromisoformat(first_date[:10]).day}.")
        if partial_month and any(r["month"] == partial_month for r in monthly):
            findings.append(f"{partial_month} is incomplete: the data ends on day {last.day}.")
    return {
        "summary": [
            {"label": "Revenue", "value": total["revenue"], "format": "money"},
            {"label": "Orders", "value": total["orders"], "format": "int"},
            {"label": "Customers", "value": total["customers"], "format": "int"},
            {"label": "Average order value", "value": total["revenue"] / total["orders"] if total["orders"] else 0, "format": "money"},
        ],
        "findings": findings,
        "chart": {"kind": "line", "title": "Monthly revenue", "x": "month", "y": "revenue", "format": "money"},
        "columns": [
            {"key": "month", "label": "Month"}, {"key": "revenue", "label": "Revenue", "format": "money"},
            {"key": "quantity", "label": "Units", "format": "int"}, {"key": "orders", "label": "Orders", "format": "int"},
            {"key": "customers", "label": "Customers", "format": "int"}, {"key": "aov", "label": "Avg order value", "format": "money"},
        ],
        "rows": monthly,
    }


def _products(start, end):
    products = rows(
        """
        SELECT p.Stock_Code AS code, p.Product_Name AS product, p.Category AS category, SUM(f.Revenue) AS revenue,
               SUM(f.Quantity) AS quantity, COUNT(DISTINCT f.Transaction_ID) AS orders
        FROM FACT_SALES f JOIN DIM_PRODUCT p ON f.Product_ID = p.Product_ID
        WHERE f.Date_ID BETWEEN :s AND :e GROUP BY p.Product_ID, p.Stock_Code, p.Product_Name, p.Category
        ORDER BY revenue DESC
        """,
        {"s": start, "e": end},
    )
    total = sum(p["revenue"] for p in products) or 1
    for p in products:
        p["share"] = p["revenue"] / total
    findings, count80, running = [], 0, 0.0
    for p in products:
        running += p["revenue"]
        count80 += 1
        if running >= 0.8 * total:
            break
    if products:
        findings = [
            f"{products[0]['product']} leads at {_money(products[0]['revenue'])} ({products[0]['share']:.1%} of revenue).",
            f"{count80} of {len(products)} products ({count80 / len(products):.1%}) produce 80% of revenue.",
            f"The top 10 products account for {sum(p['revenue'] for p in products[:10]) / total:.1%} of revenue.",
        ]
    return {
        "summary": [
            {"label": "Products sold", "value": len(products), "format": "int"},
            {"label": "Revenue", "value": sum(p["revenue"] for p in products), "format": "money"},
            {"label": "Units", "value": sum(p["quantity"] for p in products), "format": "int"},
            {"label": "Products to 80%", "value": count80, "format": "int"},
        ],
        "findings": findings,
        "chart": {"kind": "bar", "title": "Top 10 products by revenue", "x": "product", "y": "revenue", "format": "money", "limit": 10},
        "columns": [
            {"key": "code", "label": "Code"}, {"key": "product", "label": "Product"}, {"key": "category", "label": "Category"},
            {"key": "revenue", "label": "Revenue", "format": "money"}, {"key": "quantity", "label": "Units", "format": "int"},
            {"key": "orders", "label": "Orders", "format": "int"}, {"key": "share", "label": "Share", "format": "pct"},
        ],
        "rows": products,
    }


def _customers(_start, _end):
    segments = segment_summary()
    run = run_info("kmeans")
    findings = []
    if segments and run:
        top = segments[0]
        findings = [
            f"{top['segment']} are {top['customer_share']:.1%} of customers and {top['revenue_share']:.1%} of revenue.",
            f"K-Means used k={run['params']['k']} with a silhouette score of {run['metrics']['silhouette']:.3f}.",
            f"{format_number(run['metrics']['customers'])} identified customers were clustered on normalised RFM values.",
        ]
    data = [{
        "segment": s["segment"], "customers": s["customers"], "customer_share": s["customer_share"],
        "revenue": s["revenue"], "revenue_share": s["revenue_share"], "avg_monetary": s["avg_monetary"],
        "avg_frequency": s["avg_frequency"], "avg_recency": s["avg_recency"],
    } for s in segments]
    return {
        "summary": [
            {"label": "Customers", "value": sum(s["customers"] for s in segments), "format": "int"},
            {"label": "Segments", "value": len(segments), "format": "int"},
            {"label": "Revenue", "value": sum(s["revenue"] for s in segments), "format": "money"},
            {"label": "Silhouette", "value": run["metrics"]["silhouette"] if run else 0, "format": "dec3"},
        ],
        "findings": findings,
        "chart": {"kind": "bar", "title": "Revenue by segment", "x": "segment", "y": "revenue", "format": "money"},
        "columns": [
            {"key": "segment", "label": "Segment"}, {"key": "customers", "label": "Customers", "format": "int"},
            {"key": "customer_share", "label": "% customers", "format": "pct"}, {"key": "revenue", "label": "Revenue", "format": "money"},
            {"key": "revenue_share", "label": "% revenue", "format": "pct"}, {"key": "avg_monetary", "label": "Avg lifetime spend", "format": "money"},
            {"key": "avg_frequency", "label": "Avg orders", "format": "dec1"}, {"key": "avg_recency", "label": "Avg recency (d)", "format": "dec1"},
        ],
        "rows": data,
        "note": "Segments describe the full dataset and are not affected by the date range.",
    }


def _cities(start, end):
    data = rows(
        """
        SELECT g.City AS city, g.State AS state, g.Region AS region, SUM(f.Revenue) AS revenue, SUM(f.Quantity) AS quantity,
               COUNT(DISTINCT f.Transaction_ID) AS orders, COUNT(DISTINCT NULLIF(f.Customer_ID,0)) AS customers
        FROM FACT_SALES f JOIN DIM_GEOGRAPHY g ON f.Geography_ID = g.Geography_ID
        WHERE f.Date_ID BETWEEN :s AND :e GROUP BY g.City, g.State, g.Region ORDER BY revenue DESC
        """,
        {"s": start, "e": end},
    )
    total = sum(r["revenue"] for r in data) or 1
    for r in data:
        r["share"] = r["revenue"] / total
        r["aov"] = r["revenue"] / r["orders"] if r["orders"] else 0
    findings = []
    if data:
        findings.append(f"{data[0]['city']} produces {data[0]['share']:.1%} of revenue, at {_money(data[0]['revenue'])}.")
        if len(data) > 1:
            findings.append(f"{data[1]['city']} is the next largest market at {_money(data[1]['revenue'])}.")
        big = [r for r in data if r["orders"] >= 20]
        if big:
            best = max(big, key=lambda r: r["aov"])
            findings.append(f"{best['city']} has the highest average order value, at {_money(best['aov'])}.")
    return {
        "summary": [
            {"label": "Cities", "value": len(data), "format": "int"},
            {"label": "Revenue", "value": sum(r["revenue"] for r in data), "format": "money"},
            {"label": "Top city share", "value": data[0]["share"] if data else 0, "format": "pct"},
            {"label": "Orders", "value": sum(r["orders"] for r in data), "format": "int"},
        ],
        "findings": findings,
        "chart": {"kind": "bar", "title": "Revenue by city", "x": "city", "y": "revenue", "format": "money", "limit": 12},
        "columns": [
            {"key": "city", "label": "City"}, {"key": "state", "label": "State"}, {"key": "region", "label": "Region"},
            {"key": "revenue", "label": "Revenue", "format": "money"}, {"key": "share", "label": "Share", "format": "pct"},
            {"key": "orders", "label": "Orders", "format": "int"}, {"key": "customers", "label": "Customers", "format": "int"},
            {"key": "aov", "label": "Avg order value", "format": "money"},
        ],
        "rows": data,
    }


def _basket(_start, _end):
    found = get_rules(page_size=500)
    run = found["run"]
    data = [{
        "antecedent": " + ".join(r["antecedents"]), "consequent": " + ".join(r["consequents"]),
        "label": f"{' + '.join(r['antecedents'])[:28]} → {' + '.join(r['consequents'])[:28]}",
        "support": r["support"], "confidence": r["confidence"], "lift": r["lift"],
    } for r in found["rules"]]
    findings = []
    if data and run:
        findings = [
            f"Strongest rule: {data[0]['antecedent']} → {data[0]['consequent']}, lift {data[0]['lift']:.1f}.",
            f"Customers buying the first also buy the second {data[0]['confidence']:.0%} of the time.",
            f"Apriori produced {format_number(found['total'])} rules from {format_number(run['metrics']['baskets'])} "
            f"{'multi-item ' if run['params'].get('multi_item_only') else ''}baskets "
            f"at {run['params']['min_support']:.1%} minimum support"
            f"{', mining product categories' if run['params'].get('level') == 'category' else ''}.",
        ]
    return {
        "summary": [
            {"label": "Rules", "value": found["total"], "format": "int"},
            {"label": "Baskets", "value": run["metrics"]["baskets"] if run else 0, "format": "int"},
            {"label": "Frequent itemsets", "value": run["metrics"]["frequent_itemsets"] if run else 0, "format": "int"},
            {"label": "Highest lift", "value": data[0]["lift"] if data else 0, "format": "dec1"},
        ],
        "findings": findings,
        "chart": {"kind": "bar", "title": "Strongest rules by lift", "x": "label", "y": "lift", "format": "dec1", "limit": 10},
        "columns": [
            {"key": "antecedent", "label": "If bought"}, {"key": "consequent", "label": "Then bought"},
            {"key": "support", "label": "Support", "format": "pct"}, {"key": "confidence", "label": "Confidence", "format": "pct"},
            {"key": "lift", "label": "Lift", "format": "dec2"},
        ],
        "rows": data,
        "note": "Rules describe the most recent Apriori run and are not affected by the date range.",
    }


_BUILDERS = {"sales": _sales, "products": _products, "cities": _cities, "customers": _customers, "basket": _basket}


def build_report(report_type, from_month=None, to_month=None):
    if report_type not in _BUILDERS:
        raise ApiError("Unknown report.", status=404, code="not_found")
    run = latest_success()
    if not run:
        raise WarehouseEmpty()
    start, end, start_month, end_month = _range_clause(from_month, to_month)
    report = _BUILDERS[report_type](start, end)
    report.update(
        type=report_type, title=REPORT_TYPES[report_type], currency="₹",
        dataset=run["dataset_name"], data_kind=run["kind"],
        data_notice=notice_for(run["dataset_id"], run["kind"])["notice"].upper(),
        data_source=notice_for(run["dataset_id"], run["kind"])["source"],
        generated_at=dt.datetime.now().isoformat(timespec="seconds"),
        range={"from": start_month, "to": end_month},
    )
    return report


def format_value(value, kind, _currency="₹"):
    if value is None:
        return ""
    if kind == "money":
        return format_inr(value, 2)
    if kind == "int":
        return format_number(value)
    if kind == "pct":
        return f"{value * 100:.1f}%"
    if kind == "dec1":
        return format_number(value, 1)
    if kind == "dec2":
        return format_number(value, 2)
    if kind == "dec3":
        return f"{value:.3f}"
    return str(value)


def to_csv(report):
    """Money columns are labelled in INR. Values stay plain numbers, so spreadsheets can sum them."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([f"{c['label']} (INR)" if c.get("format") == "money" else c["label"] for c in report["columns"]])
    for row in report["rows"]:
        writer.writerow([round(row[c["key"]], 2) if c.get("format") == "money" else row.get(c["key"]) for c in report["columns"]])
    return buffer.getvalue()
