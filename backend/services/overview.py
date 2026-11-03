"""
Overview dashboard: KPIs, charts and Signals & Observations.

Every number here, including every sentence of every signal, is computed by SQL on the star
schema when the page asks for it. If the data changes, the sentences change.
"""
import calendar
import datetime as dt
from concurrent.futures import ThreadPoolExecutor

from db.connection import one, rows
from errors import ApiError, WarehouseEmpty
from etl.pipeline import latest_success
from mining.apriori import get_rules
from mining.rfm import segment_summary
from services.inr import inr_short

# The dashboard needs about a dozen aggregations over FACT_SALES. Running them side by side,
# each on its own pooled connection, makes the page load several times faster.
_pool = ThreadPoolExecutor(max_workers=8)
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]


def _month_index(text):
    try:
        year, month = str(text).split("-")
        year, month = int(year), int(month)
        if not 1 <= month <= 12:
            raise ValueError
        return year * 12 + month - 1
    except ValueError:
        raise ApiError(f"Invalid month '{text}'. Use YYYY-MM.")


def _month_text(index):
    return f"{index // 12}-{index % 12 + 1:02d}"


def _date_bounds(start_index, end_index):
    start = start_index // 12 * 10000 + (start_index % 12 + 1) * 100 + 1
    year, month = end_index // 12, end_index % 12 + 1
    end = year * 10000 + month * 100 + calendar.monthrange(year, month)[1]
    return start, end


def data_span():
    span = one("SELECT MIN(Date) AS first_date, MAX(Date) AS last_date FROM DIM_DATE")
    if not span or not span["first_date"]:
        raise WarehouseEmpty()
    return span["first_date"], span["last_date"]


def span():
    """The months the warehouse covers. Cheap, because DIM_DATE is small."""
    first, last = data_span()
    return {"from": first[:7], "to": last[:7], "first_date": first, "last_date": last}


def _kpis(start, end):
    row = one(
        """
        SELECT COALESCE(SUM(Revenue), 0) AS revenue,
               COUNT(DISTINCT Transaction_ID) AS orders,
               COUNT(DISTINCT NULLIF(Customer_ID, 0)) AS customers,
               COALESCE(SUM(Quantity), 0) AS units
        FROM FACT_SALES WHERE Date_ID BETWEEN :s AND :e
        """,
        {"s": start, "e": end},
    )
    row["aov"] = row["revenue"] / row["orders"] if row["orders"] else 0
    return row


def _monthly(start, end):
    return {r["month"]: r for r in rows(
        """
        SELECT DATE_FORMAT(d.Date, '%Y-%m') AS month, SUM(f.Revenue) AS revenue,
               COUNT(DISTINCT f.Transaction_ID) AS orders
        FROM FACT_SALES f JOIN DIM_DATE d ON f.Date_ID = d.Date_ID
        WHERE f.Date_ID BETWEEN :s AND :e
        GROUP BY DATE_FORMAT(d.Date, '%Y-%m')
        """,
        {"s": start, "e": end},
    )}


def _change(current, previous):
    return (current - previous) / previous if previous else None


def _repeat_customers(start, end):
    """Customers with two or more orders in the window, and their share of identified revenue."""
    spend = rows(
        """
        SELECT SUM(Revenue) AS revenue, COUNT(DISTINCT Transaction_ID) AS orders FROM FACT_SALES
        WHERE Date_ID BETWEEN :s AND :e AND Customer_ID <> 0
        GROUP BY Customer_ID ORDER BY SUM(Revenue) DESC
        """,
        {"s": start, "e": end},
    )
    if len(spend) < 10:
        return None
    total = sum(r["revenue"] for r in spend)
    repeat = [r for r in spend if r["orders"] >= 2]
    top_count = max(1, round(len(spend) * 0.10))
    return {
        "customers": len(spend), "repeat": len(repeat),
        "repeat_share": sum(r["revenue"] for r in repeat) / total if total else 0,
        "top_count": top_count, "top_share": sum(r["revenue"] for r in spend[:top_count]) / total if total else 0,
    }


def _category_revenue(start, end):
    return rows(
        """
        SELECT p.Category AS category, SUM(f.Revenue) AS revenue, SUM(f.Quantity) AS quantity,
               COUNT(DISTINCT f.Transaction_ID) AS orders
        FROM FACT_SALES f JOIN DIM_PRODUCT p ON f.Product_ID = p.Product_ID
        WHERE f.Date_ID BETWEEN :s AND :e GROUP BY p.Category ORDER BY revenue DESC
        """,
        {"s": start, "e": end},
    )


def _city_revenue(start, end):
    return rows(
        """
        SELECT g.City AS city, g.State AS state, g.Region AS region, SUM(f.Revenue) AS revenue,
               COUNT(DISTINCT f.Transaction_ID) AS orders
        FROM FACT_SALES f JOIN DIM_GEOGRAPHY g ON f.Geography_ID = g.Geography_ID
        WHERE f.Date_ID BETWEEN :s AND :e GROUP BY g.City, g.State, g.Region ORDER BY revenue DESC
        """,
        {"s": start, "e": end},
    )


def _top_products(start, end):
    return rows(
        """
        SELECT p.Product_ID AS id, p.Product_Name AS name, p.Category AS category,
               SUM(f.Revenue) AS revenue, SUM(f.Quantity) AS quantity
        FROM FACT_SALES f JOIN DIM_PRODUCT p ON f.Product_ID = p.Product_ID
        WHERE f.Date_ID BETWEEN :s AND :e
        GROUP BY p.Product_ID, p.Product_Name, p.Category ORDER BY revenue DESC LIMIT 8
        """,
        {"s": start, "e": end},
    )


def _quarterly_growth():
    """Revenue for every quarter, for the year-on-year comparison. Not limited by the date range."""
    data = rows(
        """
        SELECT d.Year AS year, d.Quarter AS quarter, SUM(f.Revenue) AS revenue,
               COUNT(DISTINCT d.Month) AS months
        FROM FACT_SALES f JOIN DIM_DATE d ON f.Date_ID = d.Date_ID
        GROUP BY d.Year, d.Quarter ORDER BY d.Year, d.Quarter
        """
    )
    years = sorted({r["year"] for r in data})
    table = []
    for quarter in [1, 2, 3, 4]:
        point = {"quarter": f"Q{quarter}"}
        for row in data:
            if row["quarter"] == quarter:
                point[str(row["year"])] = row["revenue"]
        table.append(point)
    return {"years": [str(y) for y in years], "quarters": table}


def _category_seasonality():
    """The category and calendar month with the strongest concentration of annual demand."""
    data = rows(
        """
        SELECT p.Category AS category, d.Month AS month, SUM(f.Revenue) / COUNT(DISTINCT d.Year) AS revenue
        FROM FACT_SALES f JOIN DIM_PRODUCT p ON f.Product_ID = p.Product_ID
        JOIN DIM_DATE d ON f.Date_ID = d.Date_ID
        GROUP BY p.Category, d.Month
        """
    )
    totals, best = {}, {}
    for row in data:
        totals.setdefault(row["category"], []).append(row)
    for category, months in totals.items():
        if len(months) < 12:  # a meaningful seasonal pattern needs the whole calendar
            continue
        average = sum(m["revenue"] for m in months) / 12
        peak = max(months, key=lambda m: m["revenue"])
        best[category] = {"category": category, "month": peak["month"], "ratio": peak["revenue"] / average if average else 0}
    return max(best.values(), key=lambda b: b["ratio"]) if best else None


def _category_change(start, end, previous_bounds):
    """The category that grew most against the comparison window."""
    if not previous_bounds:
        return None
    now = {r["category"]: r["revenue"] for r in _category_revenue(start, end)}
    before = {r["category"]: r["revenue"] for r in _category_revenue(*previous_bounds)}
    changes = [{"category": c, "change": _change(now[c], before[c]), "now": now[c]} for c in now if before.get(c)]
    return max(changes, key=lambda c: c["change"]) if changes else None


def _signals(current, previous, label_previous, partial, cities, categories, repeat, seasonal, riser):
    signals = []
    if previous and previous["revenue"]:
        change = _change(current["revenue"], previous["revenue"])
        signals.append({
            "topic": "Revenue", "tone": "positive" if change >= 0 else "negative",
            "headline": f"Revenue {'rose' if change >= 0 else 'fell'} {abs(change):.1%} against {label_previous}.",
            "evidence": f"{inr_short(current['revenue'])} now, {inr_short(previous['revenue'])} before."
                        + (" The latest month is incomplete, which understates this period." if partial else ""),
        })
    if cities and current["revenue"]:
        top = cities[0]
        evidence = f"{inr_short(top['revenue'])} from {top['city']}, {top['state']}."
        if len(cities) > 1:
            evidence += f" {cities[1]['city']} follows at {inr_short(cities[1]['revenue'])}."
        signals.append({"topic": "Cities", "tone": "neutral",
                        "headline": f"{top['city']} contributes the highest revenue, at {top['revenue'] / current['revenue']:.1%}.",
                        "evidence": evidence})
    if categories and current["revenue"]:
        leader = categories[0]
        signals.append({"topic": "Category", "tone": "neutral",
                        "headline": f"{leader['category']} leads all categories with {inr_short(leader['revenue'])}.",
                        "evidence": f"{leader['revenue'] / current['revenue']:.1%} of revenue in this period."})
    if riser and riser["change"] is not None:
        verb = "grew fastest" if riser["change"] >= 0 else "declined least"
        signals.append({"topic": "Momentum", "tone": "positive" if riser["change"] >= 0 else "neutral",
                        "headline": f"{riser['category']} {verb}, {riser['change']:+.1%} against {label_previous}.",
                        "evidence": f"{inr_short(riser['now'])} in this period."})
    if repeat:
        signals.append({
            "topic": "Customers", "tone": "neutral",
            "headline": f"Repeat customers contribute {repeat['repeat_share']:.1%} of identified revenue.",
            "evidence": f"{repeat['repeat']:,} of {repeat['customers']:,} identified customers ordered twice or more. "
                        f"The top 10% alone contribute {repeat['top_share']:.1%}.",
        })
    if seasonal and seasonal["ratio"] >= 1.2:
        signals.append({
            "topic": "Seasonality", "tone": "neutral",
            "headline": f"{seasonal['category']} demand peaks in {MONTH_NAMES[seasonal['month'] - 1]}.",
            "evidence": f"That month runs at {seasonal['ratio']:.1f} times the category's monthly average, across all years held.",
        })
    segments = segment_summary()
    if segments:
        top = segments[0]
        signals.append({
            "topic": "Segments", "tone": "neutral",
            "headline": f"{top['segment']} are {top['customer_share']:.1%} of customers and {top['revenue_share']:.1%} of revenue.",
            "evidence": f"K-Means on RFM across the full dataset. Average lifetime spend {inr_short(top['avg_monetary'])}.",
        })
    found = get_rules(page_size=200)
    pairs = found["rules"]
    multi_only = bool(found["run"] and found["run"]["params"].get("multi_item_only"))
    pair = next((r for r in pairs if len(r["antecedents"]) == 1 and len(r["consequents"]) == 1), None)
    if pair:
        signals.append({
            "topic": "Baskets", "tone": "neutral",
            "headline": f"Customers who buy {pair['antecedents'][0]} often also buy {pair['consequents'][0]}.",
            "evidence": f"Lift {pair['lift']:.1f}, confidence {pair['confidence']:.0%}, support {pair['support']:.1%} "
                        f"(Apriori, {'multi-item baskets only' if multi_only else 'full dataset'}).",
        })
    return signals


def public_summary():
    run = latest_success()
    if not run or run["kind"] != "synthetic":
        return None
    first, last = data_span()
    start, end = _date_bounds(_month_index(first[:7]), _month_index(last[:7]))
    monthly = _monthly(start, end)
    kpis = _kpis(start, end)
    cities = one("SELECT COUNT(*) AS n FROM DIM_GEOGRAPHY")["n"]
    return {"dataset": run["dataset_name"], "revenue": kpis["revenue"], "orders": kpis["orders"], "customers": kpis["customers"],
            "cities": cities, "from": first[:7], "to": last[:7],
            "series": [{"month": m, "revenue": monthly[m]["revenue"]} for m in sorted(monthly)]}


def overview(from_month=None, to_month=None, compare="previous"):
    first, last = data_span()
    first_index = _month_index(first[:7])
    last_index = _month_index(last[:7])
    start_index = _month_index(from_month) if from_month else first_index
    end_index = _month_index(to_month) if to_month else last_index
    if start_index > end_index:
        raise ApiError("The start month must not be after the end month.")
    start, end = _date_bounds(start_index, end_index)
    length = end_index - start_index + 1

    # Comparison window: the same number of months, directly before or one year before.
    offset = {"previous": length, "year": 12}.get(compare)
    comparison, prev_bounds = None, None
    if offset:
        prev_start_index, prev_end_index = start_index - offset, end_index - offset
        if prev_end_index >= first_index:
            # Clamp to data actually held; a part-covered window is reported as such.
            prev_start_index = max(prev_start_index, first_index)
            prev_bounds = _date_bounds(prev_start_index, prev_end_index)
            comparison = {"from": _month_text(prev_start_index), "to": _month_text(prev_end_index),
                          "months": prev_end_index - prev_start_index + 1, "expected_months": length}

    jobs = {
        "current": _pool.submit(_kpis, start, end),
        "monthly": _pool.submit(_monthly, start, end),
        "products": _pool.submit(_top_products, start, end),
        "categories": _pool.submit(_category_revenue, start, end),
        "cities": _pool.submit(_city_revenue, start, end),
        "repeat": _pool.submit(_repeat_customers, start, end),
        "growth": _pool.submit(_quarterly_growth),
        "seasonal": _pool.submit(_category_seasonality),
        "riser": _pool.submit(_category_change, start, end, prev_bounds),
    }
    if prev_bounds:
        jobs["previous"] = _pool.submit(_kpis, *prev_bounds)
        jobs["prev_monthly"] = _pool.submit(_monthly, *prev_bounds)
    results = {name: job.result() for name, job in jobs.items()}
    current, monthly = results["current"], results["monthly"]
    previous = results.get("previous")
    prev_monthly = results.get("prev_monthly", {})

    series = []
    for index in range(start_index, end_index + 1):
        month = _month_text(index)
        point = {"month": month, "revenue": monthly.get(month, {}).get("revenue", 0),
                 "orders": monthly.get(month, {}).get("orders", 0), "compare": None, "compare_month": None}
        if offset:
            prev_month = _month_text(index - offset)
            if prev_month in prev_monthly:
                point["compare"] = prev_monthly[prev_month]["revenue"]
                point["compare_month"] = prev_month
        series.append(point)

    # A month is partial when the data stops before the month's last calendar day.
    last_date = dt.date.fromisoformat(last[:10])
    partial = None
    # A couple of quiet days at the month's end do not make it partial.
    if _month_text(end_index) == last[:7] and last_date.day < calendar.monthrange(last_date.year, last_date.month)[1] - 2:
        partial = {"month": last[:7], "through_day": last_date.day}

    # Likewise, a dataset that starts late in its first month has a partial first month.
    first_date = dt.date.fromisoformat(first[:10])
    partial_first = None
    if _month_text(start_index) == first[:7] and first_date.day > 3:
        partial_first = {"month": first[:7], "from_day": first_date.day}

    label = "the previous period" if compare == "previous" else "the same period a year earlier"
    run = latest_success()
    return {
        "range": {"from": _month_text(start_index), "to": _month_text(end_index)},
        "span": {"from": first[:7], "to": last[:7], "first_date": first, "last_date": last},
        "data_kind": run["kind"] if run else None,
        "compare": compare,
        "comparison": comparison,
        "partial_month": partial,
        "partial_first_month": partial_first,
        "kpis": current,
        "previous_kpis": previous,
        "series": series,
        "top_products": results["products"],
        "cities": results["cities"],
        "categories": results["categories"],
        "growth": results["growth"],
        "segments": segment_summary(),
        "signals": _signals(current, previous, label, bool(partial), results["cities"], results["categories"],
                            results["repeat"], results["seasonal"], results["riser"]),
    }
