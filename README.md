# RetailIQ India

An animated retail intelligence platform for the Indian market: real ETL into a MySQL star schema, all five OLAP operations, K-Means customer segmentation and Apriori market basket analysis, with local authentication and every amount in rupees.

The default data is **synthetic**. It is simulated by `backend/scripts/generate_india_data.py` and does not represent the sales of any company. Reliance Retail, DMart, Tata Neu and others are named only as industry context. There is no partnership, integration or access to their data.

## Run it

Everything is installed on this Mac. From the project folder:

```bash
scripts/start.sh
```

Open <http://localhost:5173>, choose **Create account**, and register. No account is pre-created. Press Ctrl+C in that terminal to stop the API and web server. MySQL keeps running in the background; stop it with:

```bash
scripts/mysql.sh stop
```

On a new machine, run `scripts/setup.sh` once first. It installs Python and npm packages, sets up MySQL in `.mysql/` without admin rights, downloads the UCI dataset, generates the synthetic data and loads it into the warehouse. The bundled MySQL is for Apple Silicon Macs. Elsewhere, set `RETAILIQ_SKIP_MYSQL=1`, create a database and user yourself, and fill in `backend/.env`:

```
RETAILIQ_DB_HOST=127.0.0.1
RETAILIQ_DB_PORT=3306
RETAILIQ_DB_USER=retailiq
RETAILIQ_DB_PASSWORD=your-password
RETAILIQ_DB_NAME=retailiq
```

**Forgot password:** this local install has no email service, so the reset link is printed in the terminal running `scripts/start.sh`.

Keyboard: `/` opens the command palette, `1` to `7` switch pages.

## Project structure

```
backend/
  app.py                  Flask application, sessions, error handling
  api/                    Routes: auth_routes (and the login guard), data_routes, analytics_routes
  db/schema.py            Star schema, marts, users, and the upgrade from the first version
  etl/                    extract, transform, load, mappings, pipeline
  warehouse/olap.py       The five OLAP operations, compiled to SQL
  warehouse/catalog.py    Schema inspection through INFORMATION_SCHEMA
  mining/rfm.py           RFM + K-Means (scikit-learn)
  mining/apriori.py       Apriori and rules (MLxtend)
  services/auth.py        Registration, login, lockout, password reset
  services/inr.py         Indian number and rupee formatting
  services/overview.py    Dashboard KPIs and Signals & Observations
  services/reports.py     The five reports, CSV export
  services/pdf.py         PDF export
  scripts/                generate_india_data.py, load_demo.py, convert_uci_xlsx.py
frontend/src/
  motion/                 Shared motion system, intro loader, hero and login canvases
  pages/                  Landing, Auth, and one file per module
  components/             Navigation, palette, Select, ClusterCanvas, PipelineFlow, shared UI
  services/               API, auth and status contexts, types, ₹ formatting
```

## The motion system

| Tool | Used for |
|---|---|
| Motion | Page transitions, nav underline, text reveals, KPI count-ups, dropdowns, palette, star schema, basket network |
| GSAP ScrollTrigger | The public landing page: parallax, the pipeline rail, and the revenue line drawn with scroll |
| Canvas | Hero flow, login field, ETL particles, customer map |
| CSS | Table row entrances, hover lines, grid drift |

Lottie is not used: nothing here needed it, and the brief asks not to add libraries unnecessarily. Plotly from the first version was replaced by a custom canvas so that points can glide between layouts.

**The ETL animation is not decorative.** `components/PipelineFlow.tsx` emits particles for a segment only while that stage is reported as running, and rejected particles fall only when a Transform step has actually removed rows. With no run in progress, nothing moves.

Canvas loops stop when off screen, and the particle and customer-map loops stop when finished. `prefers-reduced-motion` is respected by Motion, GSAP's media query, CSS and the canvases.

## What the ETL produces on the synthetic data

The raw file is deliberately dirty: duplicates, walk-in customers, mixed date formats, prices such as `Rs. 1,299` and `₹1,299`, credit notes and invalid rows.

| Step | Rows removed | Rows left |
|---|---:|---:|
| Source rows | | 2,73,795 |
| Remove duplicate transactions | 3,993 | 2,69,802 |
| Standardise date formats | 273 | 2,69,529 |
| Convert numerical columns | 136 | 2,69,393 |
| Reverse cancelled purchases | 1,298 | 2,68,095 |
| Remove invalid transactions | 2,548 | 2,65,547 |

Revenue in `FACT_SALES` is ₹36,64,95,674 across 87,918 orders, 5,511 identified customers, 90 products and 12 cities, from January 2024 to September 2026. Load checks this inside its transaction: row count and revenue must match Transform and no fact row may be orphaned, or MySQL rolls back.

## Decisions to be ready to explain

1. **The patterns in the synthetic data were put there.** Customer behaviour types, shopping missions and seasons are written into the generator. K-Means and Apriori never see those labels and rediscover the structure, but this shows the algorithms work, **not** anything about the Indian market. Say so if asked. The generator uses a fixed seed, so it always produces the same file.
2. **Two columns beyond the brief.** `FACT_SALES.Sale_ID` is the primary key, because `Transaction_ID` repeats on each line of an invoice. `DIM_CUSTOMER.Source_Customer_Code` keeps the original ID. `DIM_DATE.Day` is kept for daily drill-down.
3. **`Customer_Segment` comes from mining.** K-Means writes each customer's segment back into `DIM_CUSTOMER`.
4. **Walk-in sales.** Lines with no customer number stay under `Customer_ID = 0`, the standard "unknown member". They count in revenue and orders but not in customer counts or RFM.
5. **Cancelled purchases are reversed.** Deleting only a credit note would leave the original sale inflating revenue, so each is matched to an earlier purchase with the same customer, product and quantity, and both go. Partial returns have no exact match, so those purchases remain.
6. **Dates are read day-first** unless in ISO format, so 03/04/2025 means 3 April.
7. **Everything is stored in rupees.** Imported data has a conversion rate in Data Explorer, under Column roles. The UCI dataset is included as real data, at an approximate 75 rupees per pound that you can change. Its geography is by country, so its "City" column holds country names.
8. **Segment names work best at k=5.** Names are assigned from each centroid, in priority order. At other k values some labels, such as "Hibernating", fit less exactly. Silhouette is about 0.43 at k=5.

## Authentication

Passwords are stored only as salted PBKDF2-SHA256 hashes (600,000 iterations), and `werkzeug` compares a re-hash of each attempt. Sessions use a signed, HttpOnly, SameSite=Lax cookie. Without "Remember me" the cookie ends with the browser, and after 12 hours at most. With it, 30 days. Login gives the same error for an unknown email and a wrong password, and five failures lock that email and address for five minutes (held in memory, so a restart clears it). Reset tokens are random, single-use, valid for 30 minutes and stored only as hashes. Using one signs out older sessions.

This is suitable for a local student project. A real deployment would also need HTTPS with `SESSION_COOKIE_SECURE`, an email service for resets, and a shared store for login lockouts.

## Viva guide

**Why a star schema?** Facts hold measures at one grain, one product line on one invoice. Dimensions describe who, what, when and where. Queries need one join per dimension, which keeps OLAP SQL simple and fast. See `db/schema.py`.

**Surrogate keys.** Warehouse-owned integers that replace source codes, created in `_build_star` in `etl/transform.py`. They shield the warehouse from source changes and make joins cheaper. `Date_ID` is a readable YYYYMMDD key.

**ETL.** Every step's counts are on the Warehouse page. Dimensions load first so that foreign keys have parents.

**OLAP** (`warehouse/olap.py`). In OLAP Studio, press **Show executed SQL** to see the query behind any view.

| Operation | What changes in the SQL | Try it |
|---|---|---|
| Roll-up | `GROUP BY` a coarser level | Month to quarter |
| Drill-down | `GROUP BY` a finer level, plus a filter if a member was chosen | Click West, then Maharashtra |
| Slice | `WHERE` on one dimension | Year = 2025 |
| Dice | `WHERE` on two or more dimensions | 2025 + Mumbai + Electronics |
| Pivot | Axes swap in the `GROUP BY` | Region by year |

Why are totals separate queries? Average order value cannot be summed from cells, because one order may span several cells.

**RFM and K-Means** (`mining/rfm.py`). Recency, frequency and monetary are computed by SQL. They are log-transformed because they are skewed, then z-scored so that no feature dominates the Euclidean distance. K-Means alternates between assigning points to the nearest centroid and moving centroids to the mean. The Choosing k section shows the elbow and silhouette for k = 2 to 8.

**Apriori** (`mining/apriori.py`). Every subset of a frequent itemset must be frequent, so candidates with an infrequent subset are pruned before counting.

- Support(A→B) = P(A and B)
- Confidence(A→B) = P(B given A)
- Lift(A→B) = Confidence / P(B). Above 1 means positive association, 1 means independent.

Worked example from this data: Whole Wheat Atta → Basmati Rice has support 6.1%, confidence 44.1% and lift 5.97. Of the baskets with atta, 44.1% also have basmati rice, about six times what chance predicts.

## Using another dataset

Upload a CSV in **Data Explorer**, or drop it on the pipeline in **Warehouse**, which uploads and processes it immediately. Headers such as `Order ID`, `SKU`, `Qty`, `Order Date`, `Price`, `Client ID`, `City`, `State` and `Department` are recognised automatically, and others can be mapped by hand. Common Indian cities get their state and region from a lookup. Running ETL replaces the warehouse contents, in one transaction. To go back, select RetailIQ India (synthetic) and run ETL again.
