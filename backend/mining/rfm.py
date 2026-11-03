"""
Customer segmentation: RFM analysis + K-Means clustering.

VIVA NOTES
----------
RFM describes each customer with three numbers, computed from FACT_SALES:
  Recency   = days between the customer's last purchase and the snapshot date
              (one day after the last date in the warehouse). Lower is better.
  Frequency = number of distinct invoices.
  Monetary  = total revenue.

K-Means partitions n points into k clusters to minimise the within-cluster sum of
squared distances (inertia):
  1. Choose k starting centroids (scikit-learn uses k-means++ to spread them out).
  2. Assign each point to its nearest centroid by Euclidean distance.
  3. Move each centroid to the mean of its points.
  4. Repeat 2-3 until assignments stop changing.
n_init=10 repeats this from 10 starts and keeps the lowest-inertia result, because
K-Means only finds a local optimum.

Normalisation is essential because K-Means uses distance. Monetary spans hundreds of
rupees to several lakh while Recency spans about 1 to 1,000 days, so raw Monetary would dominate. Two steps:
  * log(1+x) reduces the heavy right skew of Frequency and Monetary (and Recency).
  * z-score standardisation (x - mean) / std gives each feature equal weight.

Choosing k: the elbow curve shows inertia falling as k grows, and the silhouette score
(-1 to 1) measures how well separated clusters are. Both are stored for the UI.
"""
import datetime as dt
import json
import time
import warnings

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from sqlalchemy import text

from db.connection import engine, one, rows
from errors import ApiError, WarehouseEmpty

MIN_K, MAX_K = 2, 8
RANDOM_STATE = 42

# numpy's Apple Accelerate build emits false overflow warnings from matmul inside k-means++.
# The inertia and silhouette values stored below are finite and reproducible.
warnings.filterwarnings("ignore", message=".*encountered in matmul", category=RuntimeWarning)

# K-Means returns unnamed cluster numbers. Names are assigned from the centroids, in
# priority order: each name takes the remaining cluster that maximises its score.
# r, f, m are centroid z-scores, with r flipped so that higher always means better.
_NAMING_RULES = [
    ("Champions", lambda r, f, m: r + f + m),
    ("Occasional Customers", lambda r, f, m: -(r + f + m)),
    # Of what remains, the most lapsed cluster has gone quiet: it is the one to win back.
    ("At Risk", lambda r, f, m: -r),
    ("Loyal Customers", lambda r, f, m: f + m),
    ("Potential Loyalists", lambda r, f, m: r - f),
    ("Hibernating", lambda r, f, m: -r),
    ("Recent Newcomers", lambda r, f, m: r),
    ("Big Spenders", lambda r, f, m: m - f),
]


def compute_rfm():
    """Compute RFM directly from the warehouse. The Unknown customer (0) is excluded."""
    data = pd.read_sql_query(
        text("""
            SELECT f.Customer_ID,
                   DATEDIFF((SELECT DATE_ADD(MAX(Date), INTERVAL 1 DAY) FROM DIM_DATE), MAX(d.Date)) AS Recency_Days,
                   COUNT(DISTINCT f.Transaction_ID) AS Frequency,
                   SUM(f.Revenue) AS Monetary
            FROM FACT_SALES f
            JOIN DIM_DATE d ON f.Date_ID = d.Date_ID
            WHERE f.Customer_ID <> 0
            GROUP BY f.Customer_ID
        """),
        engine(),
    )
    data = data.astype({"Recency_Days": int, "Frequency": int, "Monetary": float})
    # Each customer's home city: where they placed the most invoices.
    visits = pd.read_sql_query(
        text("""
            SELECT f.Customer_ID, g.City, COUNT(DISTINCT f.Transaction_ID) AS visits
            FROM FACT_SALES f JOIN DIM_GEOGRAPHY g ON f.Geography_ID = g.Geography_ID
            WHERE f.Customer_ID <> 0 GROUP BY f.Customer_ID, g.City
        """),
        engine(),
    )
    home = visits.sort_values("visits", ascending=False).drop_duplicates("Customer_ID").set_index("Customer_ID")["City"]
    return data.assign(Home_City=data["Customer_ID"].map(home))


def _name_clusters(centroids_z):
    """Map cluster number -> segment name using the centroid profile."""
    remaining = list(range(len(centroids_z)))
    names = {}
    for name, score in _NAMING_RULES[: len(centroids_z)]:
        best = max(remaining, key=lambda c: score(-centroids_z[c][0], centroids_z[c][1], centroids_z[c][2]))
        names[best] = name
        remaining.remove(best)
    return names


def run_clustering(k=5):
    if not MIN_K <= k <= MAX_K:
        raise ApiError(f"k must be between {MIN_K} and {MAX_K}.")
    started = time.time()
    rfm = compute_rfm()
    if rfm.empty:
        raise ApiError("No identified customers are available to cluster.", status=409, code="no_customers")
    if len(rfm) <= k:
        raise ApiError(f"Only {len(rfm)} customers exist, too few for k={k}.")

    # Step 1: normalise (log transform, then z-score).
    features = np.log1p(rfm[["Recency_Days", "Frequency", "Monetary"]].to_numpy(dtype=float))
    scaled = StandardScaler().fit_transform(features)

    # Step 2: elbow and silhouette diagnostics for each candidate k.
    diagnostics = []
    for candidate in range(MIN_K, min(MAX_K, len(rfm) - 1) + 1):
        model = KMeans(n_clusters=candidate, n_init=10, random_state=RANDOM_STATE).fit(scaled)
        silhouette = silhouette_score(
            scaled, model.labels_, sample_size=min(2000, len(scaled)), random_state=RANDOM_STATE
        )
        diagnostics.append({"k": candidate, "inertia": round(float(model.inertia_), 2),
                            "silhouette": round(float(silhouette), 4)})

    # Step 3: the actual clustering at the chosen k.
    model = KMeans(n_clusters=k, n_init=10, random_state=RANDOM_STATE).fit(scaled)
    rfm["Cluster_ID"] = model.labels_

    # Step 4: interpret the clusters by their centroid profiles.
    names = _name_clusters(model.cluster_centers_)
    rfm["Segment"] = rfm["Cluster_ID"].map(names)

    # Step 5: persist the result as a data mart.
    records = rfm[["Customer_ID", "Recency_Days", "Frequency", "Monetary", "Cluster_ID", "Segment", "Home_City"]]
    records = records.assign(Monetary=records["Monetary"].round(2)).astype(object).values.tolist()
    selected = next(d for d in diagnostics if d["k"] == k)
    metrics = {
        "customers": len(rfm), "inertia": selected["inertia"], "silhouette": selected["silhouette"],
        "diagnostics": diagnostics,
        "centroids": {names[i]: [round(float(v), 3) for v in c] for i, c in enumerate(model.cluster_centers_)},
    }
    with engine().begin() as conn:
        conn.execute(text("DELETE FROM CUSTOMER_RFM"))
        conn.exec_driver_sql(
            "INSERT INTO CUSTOMER_RFM (Customer_ID, Recency_Days, Frequency, Monetary, Cluster_ID, Segment, Home_City) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            [tuple(r) for r in records],
        )
        # The mining result becomes a dimension attribute, usable by the warehouse.
        conn.execute(text("""
            UPDATE DIM_CUSTOMER c JOIN CUSTOMER_RFM r ON c.Customer_ID = r.Customer_ID
            SET c.Customer_Segment = r.Segment
        """))
        conn.execute(text("DELETE FROM MINING_RUNS WHERE Kind='kmeans'"))
        conn.execute(
            text("INSERT INTO MINING_RUNS VALUES ('kmeans', :t, :d, :p, :m)"),
            {"t": dt.datetime.now(), "d": round(time.time() - started, 2), "p": json.dumps({"k": k}),
             "m": json.dumps(metrics)},
        )
    return {"customers": len(rfm), "k": k}


def run_info(kind):
    row = one("SELECT * FROM MINING_RUNS WHERE Kind=:k", {"k": kind})
    if not row:
        return None
    return {"ran_at": row["Ran_At"], "duration": row["Duration"], "params": json.loads(row["Params"]),
            "metrics": json.loads(row["Metrics"])}


def segment_summary():
    """Per-segment averages, plus each segment's share of customers and revenue."""
    summary = rows("""
        SELECT Segment AS segment, Cluster_ID AS cluster_id, COUNT(*) AS customers,
               AVG(Recency_Days) AS avg_recency, AVG(Frequency) AS avg_frequency,
               AVG(Monetary) AS avg_monetary, SUM(Monetary) AS revenue,
               MIN(Recency_Days) AS min_recency, MAX(Recency_Days) AS max_recency,
               MIN(Monetary) AS min_monetary, MAX(Monetary) AS max_monetary
        FROM CUSTOMER_RFM GROUP BY Segment, Cluster_ID ORDER BY SUM(Monetary) DESC
    """)
    total_customers = sum(s["customers"] for s in summary) or 1
    total_revenue = sum(s["revenue"] for s in summary) or 1
    for s in summary:
        s["customer_share"] = s["customers"] / total_customers
        s["revenue_share"] = s["revenue"] / total_revenue
    return summary


def get_overview():
    if not one("SELECT 1 AS ok FROM FACT_SALES LIMIT 1"):
        raise WarehouseEmpty()
    identified = one("SELECT COUNT(*) AS n FROM DIM_CUSTOMER WHERE Customer_ID <> 0")["n"]
    return {"run": run_info("kmeans"), "segments": segment_summary(), "identified_customers": identified}


def get_points():
    return rows("""
        SELECT r.Customer_ID AS id, c.Customer_Name AS name, r.Recency_Days AS r, r.Frequency AS f,
               r.Monetary AS m, r.Segment AS segment
        FROM CUSTOMER_RFM r JOIN DIM_CUSTOMER c ON r.Customer_ID = c.Customer_ID
    """)


_CUSTOMER_SORTS = {"recency": "r.Recency_Days", "frequency": "r.Frequency", "monetary": "r.Monetary",
                   "name": "c.Customer_Name", "city": "r.Home_City"}


def get_customers(segment=None, search="", sort="monetary", direction="desc", page=1, page_size=25):
    where, params = ["1=1"], {}
    if segment:
        where.append("r.Segment = :segment")
        params["segment"] = segment
    if search:
        where.append("(c.Customer_Name LIKE :q OR c.Source_Customer_Code LIKE :q OR r.Home_City LIKE :q)")
        params["q"] = f"%{search}%"
    order = _CUSTOMER_SORTS.get(sort, "r.Monetary")
    order_dir = "ASC" if direction == "asc" else "DESC"
    clause = " AND ".join(where)
    base = f"FROM CUSTOMER_RFM r JOIN DIM_CUSTOMER c ON r.Customer_ID = c.Customer_ID WHERE {clause}"
    total = one(f"SELECT COUNT(*) AS n {base}", params)["n"]
    params.update(limit=int(page_size), offset=(max(page, 1) - 1) * int(page_size))
    found = rows(
        f"""SELECT r.Customer_ID AS id, c.Source_Customer_Code AS code, c.Customer_Name AS name, r.Home_City AS city,
                   r.Recency_Days AS recency, r.Frequency AS frequency, r.Monetary AS monetary, r.Segment AS segment
            {base} ORDER BY {order} {order_dir}, r.Customer_ID LIMIT :limit OFFSET :offset""",
        params,
    )
    return {"total": total, "page": page, "page_size": page_size, "customers": found}
