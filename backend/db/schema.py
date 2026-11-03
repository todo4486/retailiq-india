"""
Database models: the star schema and the supporting tables.

STAR SCHEMA (viva notes)
------------------------
A star schema has one central FACT table holding numeric measures at a fixed grain,
surrounded by denormalised DIMENSION tables that describe those measures.

  Grain of FACT_SALES : one product line on one invoice.
  Measures            : Quantity, Unit_Price, Revenue (all money in rupees).
  Dimensions          : who (customer), what (product), when (date), where (geography).

Design decisions beyond the brief:
  * FACT_SALES.Sale_ID is a surrogate primary key, because Transaction_ID (the invoice
    number) repeats across the lines of one invoice.
  * Customer_ID = 0 is the conventional "unknown member": walk-in sales with no customer
    number. Their revenue is real, so they stay in the warehouse but are excluded from
    customer analytics.
  * DIM_CUSTOMER.Customer_Segment is filled in by K-Means, so a mining result becomes a
    dimension attribute.
"""
from sqlalchemy import text

from db.connection import engine, one

STAR_TABLES = ["FACT_SALES", "DIM_CUSTOMER", "DIM_PRODUCT", "DIM_DATE", "DIM_GEOGRAPHY"]

DDL = [
    """
    CREATE TABLE IF NOT EXISTS DIM_CUSTOMER (
        Customer_ID          INT          NOT NULL,
        Source_Customer_Code VARCHAR(64)  NOT NULL,
        Customer_Name        VARCHAR(255) NOT NULL,
        Customer_Segment     VARCHAR(64)  NOT NULL,
        PRIMARY KEY (Customer_ID),
        KEY idx_customer_code (Source_Customer_Code),
        KEY idx_customer_segment (Customer_Segment)
    ) ENGINE=InnoDB
    """,
    """
    CREATE TABLE IF NOT EXISTS DIM_PRODUCT (
        Product_ID   INT          NOT NULL,
        Stock_Code   VARCHAR(255) NOT NULL,
        Product_Name VARCHAR(255) NOT NULL,
        Category     VARCHAR(100) NOT NULL,
        PRIMARY KEY (Product_ID),
        KEY idx_product_category (Category)
    ) ENGINE=InnoDB
    """,
    """
    CREATE TABLE IF NOT EXISTS DIM_DATE (
        Date_ID INT      NOT NULL,
        Date    DATE     NOT NULL,
        Day     TINYINT  NOT NULL,
        Month   TINYINT  NOT NULL,
        Quarter TINYINT  NOT NULL,
        Year    SMALLINT NOT NULL,
        PRIMARY KEY (Date_ID),
        UNIQUE KEY idx_date (Date),
        KEY idx_date_ymq (Year, Quarter, Month)
    ) ENGINE=InnoDB
    """,
    """
    CREATE TABLE IF NOT EXISTS DIM_GEOGRAPHY (
        Geography_ID INT          NOT NULL,
        -- Accent- and case-sensitive, so MySQL and Pandas agree on what counts as the same place.
        City         VARCHAR(100) COLLATE utf8mb4_0900_as_cs NOT NULL,
        State        VARCHAR(100) COLLATE utf8mb4_0900_as_cs NOT NULL,
        Region       VARCHAR(100) NOT NULL,
        PRIMARY KEY (Geography_ID),
        UNIQUE KEY idx_geo_city_state (City, State),
        KEY idx_geo_state (State),
        KEY idx_geo_region (Region)
    ) ENGINE=InnoDB
    """,
    """
    CREATE TABLE IF NOT EXISTS FACT_SALES (
        Sale_ID        BIGINT        NOT NULL,
        Transaction_ID VARCHAR(64)   NOT NULL,
        Customer_ID    INT           NOT NULL,
        Product_ID     INT           NOT NULL,
        Date_ID        INT           NOT NULL,
        Geography_ID   INT           NOT NULL,
        Quantity       INT           NOT NULL,
        Unit_Price     DECIMAL(14,2) NOT NULL,
        Revenue        DECIMAL(18,2) NOT NULL,
        PRIMARY KEY (Sale_ID),
        KEY idx_fact_tx (Transaction_ID),
        CONSTRAINT fk_fact_customer  FOREIGN KEY (Customer_ID)  REFERENCES DIM_CUSTOMER (Customer_ID),
        CONSTRAINT fk_fact_product   FOREIGN KEY (Product_ID)   REFERENCES DIM_PRODUCT (Product_ID),
        CONSTRAINT fk_fact_date      FOREIGN KEY (Date_ID)      REFERENCES DIM_DATE (Date_ID),
        CONSTRAINT fk_fact_geography FOREIGN KEY (Geography_ID) REFERENCES DIM_GEOGRAPHY (Geography_ID)
    ) ENGINE=InnoDB
    """,
    # Data-mart table written by K-Means (mining/rfm.py).
    """
    CREATE TABLE IF NOT EXISTS CUSTOMER_RFM (
        Customer_ID  INT           NOT NULL,
        Recency_Days INT           NOT NULL,
        Frequency    INT           NOT NULL,
        Monetary     DECIMAL(18,2) NOT NULL,
        Cluster_ID   INT           NOT NULL,
        Segment      VARCHAR(64)   NOT NULL,
        Home_City    VARCHAR(100)  NOT NULL,
        PRIMARY KEY (Customer_ID),
        KEY idx_rfm_segment (Segment),
        CONSTRAINT fk_rfm_customer FOREIGN KEY (Customer_ID) REFERENCES DIM_CUSTOMER (Customer_ID)
    ) ENGINE=InnoDB
    """,
    # Data-mart table written by Apriori (mining/apriori.py).
    """
    CREATE TABLE IF NOT EXISTS ASSOCIATION_RULES (
        Rule_ID           INT    NOT NULL,
        Antecedent_IDs    JSON   NOT NULL,
        Consequent_IDs    JSON   NOT NULL,
        Antecedent_Names  JSON   NOT NULL,
        Consequent_Names  JSON   NOT NULL,
        Support           DOUBLE NOT NULL,
        Confidence        DOUBLE NOT NULL,
        Lift              DOUBLE NOT NULL,
        Leverage          DOUBLE NOT NULL,
        PRIMARY KEY (Rule_ID)
    ) ENGINE=InnoDB
    """,
    # One row per mining execution: parameters, quality metrics, timing.
    """
    CREATE TABLE IF NOT EXISTS MINING_RUNS (
        Kind     VARCHAR(16) NOT NULL,
        Ran_At   DATETIME    NOT NULL,
        Duration DOUBLE      NOT NULL,
        Params   JSON        NOT NULL,
        Metrics  JSON        NOT NULL,
        PRIMARY KEY (Kind)
    ) ENGINE=InnoDB
    """,
    # Audit trail of every ETL execution.
    """
    CREATE TABLE IF NOT EXISTS ETL_RUNS (
        Run_ID       INT NOT NULL AUTO_INCREMENT,
        Dataset_ID   VARCHAR(64)  NOT NULL,
        Dataset_Name VARCHAR(255) NOT NULL,
        Data_Kind    VARCHAR(16)  NOT NULL,
        Status       VARCHAR(16)  NOT NULL,
        Started_At   DATETIME     NOT NULL,
        Finished_At  DATETIME     NULL,
        Stages       JSON         NOT NULL,
        Error        TEXT         NULL,
        PRIMARY KEY (Run_ID)
    ) ENGINE=InnoDB
    """,
    # Application accounts. These live beside the warehouse, not in it.
    """
    CREATE TABLE IF NOT EXISTS USERS (
        User_ID       INT NOT NULL AUTO_INCREMENT,
        Name          VARCHAR(120) NOT NULL,
        Email         VARCHAR(255) NOT NULL,
        Password_Hash VARCHAR(255) NOT NULL,
        Session_Epoch INT          NOT NULL DEFAULT 0,
        Created_At    DATETIME     NOT NULL,
        PRIMARY KEY (User_ID),
        UNIQUE KEY idx_user_email (Email)
    ) ENGINE=InnoDB
    """,
    """
    CREATE TABLE IF NOT EXISTS PASSWORD_RESETS (
        Token_Hash CHAR(64) NOT NULL,
        User_ID    INT      NOT NULL,
        Expires_At DATETIME NOT NULL,
        PRIMARY KEY (Token_Hash),
        CONSTRAINT fk_reset_user FOREIGN KEY (User_ID) REFERENCES USERS (User_ID) ON DELETE CASCADE
    ) ENGINE=InnoDB
    """,
]


def migrate_if_needed():
    """
    The first version of the warehouse had a country-level geography and pound values. A warehouse
    can always be rebuilt from its source by ETL, so old tables are dropped rather than converted.
    """
    current = one("""
        SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DIM_GEOGRAPHY' AND COLUMN_NAME = 'City'
    """)
    existing = one("""
        SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DIM_GEOGRAPHY'
    """)
    keyed = one("""
        SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DIM_GEOGRAPHY' AND INDEX_NAME = 'idx_geo_city_state'
    """)
    # Earlier versions keyed geography by country, then by city alone.
    if existing["n"] and (not current["n"] or not keyed["n"]):
        with engine().begin() as conn:
            for table in ["CUSTOMER_RFM", "ASSOCIATION_RULES", "MINING_RUNS", "ETL_RUNS", "FACT_SALES",
                          "DIM_CUSTOMER", "DIM_PRODUCT", "DIM_DATE", "DIM_GEOGRAPHY"]:
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


def create_all():
    """Create every table if it is missing. Safe to call repeatedly."""
    with engine().begin() as conn:
        for statement in DDL:
            conn.execute(text(statement))
