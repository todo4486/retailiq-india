"""
Market basket analysis: the Apriori algorithm, using MLxtend.

VIVA NOTES
----------
Each invoice is a basket: the set of products bought together. For a rule A -> B:
  Support(A -> B)    = P(A and B)      share of all baskets containing both.
  Confidence(A -> B) = P(B | A)        of the baskets containing A, the share also containing B.
  Lift(A -> B)       = Confidence / P(B)  how much A raises the chance of B.
                       Lift > 1 positive association, = 1 independent, < 1 negative.

Apriori finds frequent itemsets level by level, using the downward-closure property:
every subset of a frequent itemset must itself be frequent. So:
  1. Count single items and keep those with support >= min_support (L1).
  2. Join L(k) with itself to generate candidates of size k+1 (C(k+1)).
  3. Prune any candidate that has an infrequent subset, without counting it.
  4. Scan the baskets to count the survivors and keep the frequent ones (L(k+1)).
  5. Repeat until no candidates remain, then derive rules from the frequent itemsets.

Example: if {Atta} is infrequent, {Atta, Cooking Oil} is never counted. This pruning is what
makes Apriori feasible with thousands of products.
"""
import datetime as dt
import json
import time
import warnings

import numpy as np
import pandas as pd
from mlxtend.frequent_patterns import apriori, association_rules
from scipy import sparse
from sqlalchemy import text

from db.connection import engine, one, rows
from errors import ApiError, WarehouseEmpty
from mining.rfm import run_info

DEFAULTS = {"min_support": 0.01, "min_confidence": 0.3, "min_lift": 1.0, "max_len": 3, "city": None}
MIN_SUPPORT_FLOOR = 0.002  # lower values make the number of itemsets explode


def _baskets(city):
    """Read (basket, product) pairs from the warehouse, optionally for one city."""
    sql = "SELECT DISTINCT f.Transaction_ID, f.Product_ID FROM FACT_SALES f"
    params = {}
    if city:
        sql += " JOIN DIM_GEOGRAPHY g ON f.Geography_ID = g.Geography_ID WHERE g.City = :city"
        params["city"] = city
    return pd.read_sql_query(text(sql), engine(), params=params)


def _one_hot(pairs):
    """
    Build the basket x product boolean matrix Apriori expects. It is stored sparsely:
    100,000 baskets x 90 products is 9 million cells, of which only a few percent are set.
    """
    baskets = pairs["Transaction_ID"].astype("category")
    products = pairs["Product_ID"].astype("category")
    matrix = sparse.csr_matrix(
        (np.ones(len(pairs), dtype=bool), (baskets.cat.codes, products.cat.codes)),
        shape=(baskets.cat.categories.size, products.cat.categories.size),
    )
    # MLxtend requires string column names on sparse frames; rule generation converts them back.
    columns = [str(c) for c in products.cat.categories]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)  # pandas note about bool sparse fill values
        return pd.DataFrame.sparse.from_spmatrix(matrix, columns=columns)


def run_apriori(min_support=None, min_confidence=None, min_lift=None, max_len=None, city=None):
    params = {
        "min_support": float(DEFAULTS["min_support"] if min_support is None else min_support),
        "min_confidence": float(DEFAULTS["min_confidence"] if min_confidence is None else min_confidence),
        "min_lift": float(DEFAULTS["min_lift"] if min_lift is None else min_lift),
        "max_len": int(DEFAULTS["max_len"] if max_len is None else max_len),
        "city": city or None,
    }
    if not MIN_SUPPORT_FLOOR <= params["min_support"] <= 1:
        raise ApiError(f"Minimum support must be between {MIN_SUPPORT_FLOOR} and 1.")
    if not 0 < params["min_confidence"] <= 1:
        raise ApiError("Minimum confidence must be above 0 and at most 1.")
    if not 2 <= params["max_len"] <= 4:
        raise ApiError("Maximum itemset size must be between 2 and 4.")

    started = time.time()
    pairs = _baskets(params["city"])
    if pairs.empty:
        raise ApiError("No baskets match this selection.", status=409, code="no_baskets")
    one_hot = _one_hot(pairs)

    # Frequent itemsets by the level-wise search described above.
    frequent = apriori(one_hot, min_support=params["min_support"], use_colnames=True,
                       max_len=params["max_len"], low_memory=True)

    rule_rows = []
    if len(frequent) and frequent["itemsets"].map(len).max() >= 2:
        # Rule generation: keep rules above minimum confidence, then filter by lift.
        found = association_rules(frequent, num_itemsets=len(one_hot), metric="confidence",
                                  min_threshold=params["min_confidence"])
        found = found[found["lift"] >= params["min_lift"]].sort_values("lift", ascending=False)
        names = {r["Product_ID"]: r["Product_Name"] for r in rows("SELECT Product_ID, Product_Name FROM DIM_PRODUCT")}
        for rule_id, rule in enumerate(found.itertuples(index=False), start=1):
            ante = sorted(int(i) for i in rule.antecedents)
            cons = sorted(int(i) for i in rule.consequents)
            rule_rows.append((
                rule_id, json.dumps(ante), json.dumps(cons), json.dumps([names[i] for i in ante]),
                json.dumps([names[i] for i in cons]), float(rule.support), float(rule.confidence),
                float(rule.lift), float(rule.leverage),
            ))

    metrics = {"baskets": int(len(one_hot)), "products": int(one_hot.shape[1]),
               "frequent_itemsets": int(len(frequent)), "rules": len(rule_rows)}
    with engine().begin() as conn:
        conn.execute(text("DELETE FROM ASSOCIATION_RULES"))
        if rule_rows:
            conn.exec_driver_sql(
                "INSERT INTO ASSOCIATION_RULES (Rule_ID, Antecedent_IDs, Consequent_IDs, Antecedent_Names, "
                "Consequent_Names, Support, Confidence, Lift, Leverage) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                rule_rows,
            )
        conn.execute(text("DELETE FROM MINING_RUNS WHERE Kind='apriori'"))
        conn.execute(
            text("INSERT INTO MINING_RUNS VALUES ('apriori', :t, :d, :p, :m)"),
            {"t": dt.datetime.now(), "d": round(time.time() - started, 2), "p": json.dumps(params),
             "m": json.dumps(metrics)},
        )
    return {"rules": len(rule_rows), **metrics}


def _present(rule):
    return {
        "id": rule["Rule_ID"],
        "antecedent_ids": json.loads(rule["Antecedent_IDs"]), "consequent_ids": json.loads(rule["Consequent_IDs"]),
        "antecedents": json.loads(rule["Antecedent_Names"]), "consequents": json.loads(rule["Consequent_Names"]),
        "support": rule["Support"], "confidence": rule["Confidence"], "lift": rule["Lift"], "leverage": rule["Leverage"],
    }


_RULE_SORTS = {"lift": "Lift", "support": "Support", "confidence": "Confidence", "leverage": "Leverage"}


def get_rules(sort="lift", direction="desc", search="", product_id=None, page=1, page_size=25):
    if not one("SELECT 1 AS ok FROM FACT_SALES LIMIT 1"):
        raise WarehouseEmpty()
    where, params = ["1=1"], {}
    if search:
        where.append("(Antecedent_Names LIKE :q OR Consequent_Names LIKE :q)")
        params["q"] = f"%{search}%"
    if product_id:
        # Rules this product appears in, on either side.
        where.append("(JSON_CONTAINS(Antecedent_IDs, :pid) OR JSON_CONTAINS(Consequent_IDs, :pid))")
        params["pid"] = str(int(product_id))
    clause = " AND ".join(where)
    total = one(f"SELECT COUNT(*) AS n FROM ASSOCIATION_RULES WHERE {clause}", params)["n"]
    order = _RULE_SORTS.get(sort, "Lift")
    order_dir = "ASC" if direction == "asc" else "DESC"
    params.update(limit=int(page_size), offset=(max(page, 1) - 1) * int(page_size))
    found = rows(
        f"SELECT * FROM ASSOCIATION_RULES WHERE {clause} ORDER BY {order} {order_dir}, Rule_ID LIMIT :limit OFFSET :offset",
        params,
    )
    return {"total": total, "page": page, "page_size": page_size, "rules": [_present(r) for r in found],
            "run": run_info("apriori")}


def rule_products():
    """Every product that appears in at least one rule, with its strongest lift."""
    seen = {}
    for rule in rows("SELECT Antecedent_IDs, Consequent_IDs, Antecedent_Names, Consequent_Names, Lift FROM ASSOCIATION_RULES"):
        ids = json.loads(rule["Antecedent_IDs"]) + json.loads(rule["Consequent_IDs"])
        labels = json.loads(rule["Antecedent_Names"]) + json.loads(rule["Consequent_Names"])
        for pid, label in zip(ids, labels):
            item = seen.setdefault(pid, {"id": pid, "name": label, "rules": 0, "max_lift": 0.0})
            item["rules"] += 1
            item["max_lift"] = max(item["max_lift"], rule["Lift"])
    return sorted(seen.values(), key=lambda p: -p["rules"])


def associations_for(product_id):
    """
    Products associated with one product, using its pair rules (one item on each side).
    Both directions are returned because confidence is asymmetric while lift is not.
    """
    pid = int(product_id)
    name = one("SELECT Product_Name AS n FROM DIM_PRODUCT WHERE Product_ID=:p", {"p": pid})
    if not name:
        raise ApiError("Product not found.", status=404, code="not_found")
    params = {"pid": str(pid)}
    pair_rules = rows("""
        SELECT * FROM ASSOCIATION_RULES
        WHERE JSON_LENGTH(Antecedent_IDs) = 1 AND JSON_LENGTH(Consequent_IDs) = 1
          AND (JSON_CONTAINS(Antecedent_IDs, :pid) OR JSON_CONTAINS(Consequent_IDs, :pid))
        ORDER BY Lift DESC
    """, params)
    partners = {}
    for raw in pair_rules:
        rule = _present(raw)
        outgoing = rule["antecedent_ids"][0] == pid
        other_id = rule["consequent_ids"][0] if outgoing else rule["antecedent_ids"][0]
        other_name = rule["consequents"][0] if outgoing else rule["antecedents"][0]
        partner = partners.setdefault(other_id, {
            "id": other_id, "name": other_name, "support": rule["support"], "lift": rule["lift"],
            "confidence_to": None, "confidence_from": None,
        })
        partner["confidence_to" if outgoing else "confidence_from"] = rule["confidence"]
    return {"id": pid, "name": name["n"], "associations": sorted(partners.values(), key=lambda p: -p["lift"])}


def network(limit=40):
    """The strongest pair rules, de-duplicated into undirected edges for the map."""
    pair_rules = rows("""
        SELECT Antecedent_IDs, Consequent_IDs, Antecedent_Names, Consequent_Names, Support, Lift
        FROM ASSOCIATION_RULES
        WHERE JSON_LENGTH(Antecedent_IDs) = 1 AND JSON_LENGTH(Consequent_IDs) = 1
        ORDER BY Lift DESC
    """)
    edges, nodes = {}, {}
    for rule in pair_rules:
        a, b = json.loads(rule["Antecedent_IDs"])[0], json.loads(rule["Consequent_IDs"])[0]
        nodes[a], nodes[b] = json.loads(rule["Antecedent_Names"])[0], json.loads(rule["Consequent_Names"])[0]
        key = (min(a, b), max(a, b))
        if key not in edges:
            edges[key] = {"source": key[0], "target": key[1], "lift": rule["Lift"], "support": rule["Support"]}
    top = sorted(edges.values(), key=lambda e: -e["lift"])[:limit]
    used = {e["source"] for e in top} | {e["target"] for e in top}
    return {"nodes": [{"id": i, "name": nodes[i]} for i in sorted(used)], "edges": top,
            "total_pairs": len(edges)}
