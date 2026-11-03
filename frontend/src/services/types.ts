// Shapes returned by the Flask API.
export interface Status {
  database: string;
  dataset: string | null;
  dataset_id: string | null;
  currency: string;
  data_kind: "synthetic" | "imported" | "real" | null;
  data_notice: { notice: string; source: string | null; credit: string | null } | null;
  fact_rows: number;
  last_sync: string | null;
  etl_running: boolean;
  running_run_id: number | null;
  last_status: string | null;
}

export interface Kpis { revenue: number; orders: number; customers: number; units: number; aov: number }
export interface SeriesPoint { month: string; revenue: number; orders: number; compare: number | null; compare_month: string | null }
export interface TopProduct { id: number; name: string; category: string; revenue: number; quantity: number }
export interface Segment {
  segment: string; cluster_id: number; customers: number; avg_recency: number; avg_frequency: number; avg_monetary: number;
  revenue: number; customer_share: number; revenue_share: number; min_recency: number; max_recency: number;
  min_monetary: number; max_monetary: number;
}
export interface Signal { topic: string; tone: "positive" | "negative" | "neutral"; headline: string; evidence: string }
export interface CityRow { city: string; state: string; region: string; revenue: number; orders: number }
export interface CategoryRow { category: string; revenue: number; quantity: number; orders: number }
export interface PublicSummary {
  dataset: string; revenue: number; orders: number; customers: number; cities: number; from: string; to: string;
  series: { month: string; revenue: number }[];
}
export interface OverviewData {
  range: { from: string; to: string };
  span: { from: string; to: string; first_date: string; last_date: string };
  data_kind: "synthetic" | "imported" | "real" | null;
  cities: CityRow[];
  categories: CategoryRow[];
  growth: { years: string[]; quarters: Record<string, number | string>[] };
  compare: string;
  comparison: { from: string; to: string; months: number; expected_months: number } | null;
  partial_month: { month: string; through_day: number } | null;
  partial_first_month: { month: string; from_day: number } | null;
  kpis: Kpis;
  previous_kpis: Kpis | null;
  series: SeriesPoint[];
  top_products: TopProduct[];
  segments: Segment[];
  signals: Signal[];
}

export interface Dataset {
  id: string; name: string; filename: string; rows: number; columns: number; size: number; added_at: string;
  roles: Record<string, string>; builtin: boolean; kind: "synthetic" | "imported" | "real"; inr_rate: number; source?: string; note?: string; credit?: string;
}
export interface ColumnProfile {
  name: string; type: string; missing: number; missing_pct: number; unique: number;
  stats?: Record<string, number | string>;
  top_values?: { value: string; count: number }[];
}
export interface Quality {
  total: number; duplicates: number; missing_cells: number; rows_with_missing: number; missing_required: number;
  invalid: number; valid: number | null; invalid_breakdown: { rule: string; count: number }[]; rules_applied: boolean;
}
export interface DatasetProfile {
  rows: number; columns: ColumnProfile[]; quality: Quality; role_labels: Record<string, string>;
  required_roles: string[]; missing_roles: string[]; dataset: Dataset;
}
export interface RowsResponse { columns: string[]; rows: Record<string, string | null>[]; total: number; page: number; page_size: number }

export interface StageBase { status: "pending" | "running" | "done" | "failed"; detail: string; seconds: number | null; records?: number }
export interface TransformStep { name: string; detail: string; rows_in: number; rows_out: number; removed: number }
export interface LoadReport { tables: Record<string, number>; revenue_source: number; revenue_warehouse: number; orphan_rows: number }
export interface EtlRun {
  run_id: number; dataset_id: string; dataset_name: string; currency: string; kind: string;
  status: "running" | "success" | "partial" | "failed"; started_at: string; finished_at: string | null; error: string | null;
  stages: {
    extract: StageBase & { total?: number };
    transform: StageBase & { steps: TransformStep[] };
    load: StageBase & { progress: number; report?: LoadReport };
    marts: StageBase;
  };
}

export interface SchemaColumn { name: string; type: string; primary: boolean; nullable: boolean; foreign: { table: string; column: string } | null }
export interface SchemaTable { name: string; kind: "fact" | "dimension"; rows: number; columns: SchemaColumn[] }
export interface Schema { tables: SchemaTable[] }
export interface TableDetail { name: string; columns: SchemaColumn[]; rows: Record<string, string | number | null>[]; total: number; page: number; page_size: number }

export type Measure = "revenue" | "quantity" | "transactions" | "aov";
export interface Axis { dim: string; level: string }
export interface OlapState {
  rows: Axis;
  columns: Axis | null;
  filters: Record<string, (string | number)[]>;
  measure: Measure;
  drill_path: { level: string; added: string[] }[];
}
export interface OlapRow { member: string; total: number; cells: Record<string, number> }
export interface OlapResult {
  state: OlapState; rows: OlapRow[]; columns: string[]; column_totals: Record<string, number>; grand_total: number | null;
  total_rows: number; total_columns: number; sql: string[]; elapsed_ms: number; can_roll_up: boolean; can_drill_down: boolean;
  operation: string;
}
export interface Members {
  year: number[]; quarter: number[]; month: number[]; category: string[]; region: string[]; state: string[]; city: string[];
  hierarchies: Record<string, string[]>;
}

export interface MiningRun<M, P> { ran_at: string; duration: number; params: P; metrics: M }
export interface KMeansMetrics {
  customers: number; inertia: number; silhouette: number;
  diagnostics: { k: number; inertia: number; silhouette: number }[];
  centroids: Record<string, number[]>;
}
export interface CustomerOverview { run: MiningRun<KMeansMetrics, { k: number }> | null; segments: Segment[]; identified_customers: number }
export interface CustomerPoint { id: number; name: string; r: number; f: number; m: number; segment: string }
export interface Customer { id: number; code: string; name: string; city: string; recency: number; frequency: number; monetary: number; segment: string }
export interface Paged { total: number; page: number; page_size: number }

export interface Rule {
  id: number; antecedent_ids: number[]; consequent_ids: number[]; antecedents: string[]; consequents: string[];
  support: number; confidence: number; lift: number; leverage: number;
}
export interface AprioriParams { min_support: number; min_confidence: number; min_lift: number; max_len: number; city: string | null; level?: "product" | "category"; multi_item_only?: boolean }
export interface AprioriMetrics { baskets: number; products: number; frequent_itemsets: number; rules: number; multi_item_baskets?: number }
export interface RulesResponse extends Paged { rules: Rule[]; run: MiningRun<AprioriMetrics, AprioriParams> | null }
export interface RuleProduct { id: number; name: string; rules: number; max_lift: number }
export interface Association { id: number; name: string; support: number; lift: number; confidence_to: number | null; confidence_from: number | null }
export interface ProductAssociations { id: number; name: string; associations: Association[] }
export interface BasketNetwork {
  nodes: { id: number; name: string }[];
  edges: { source: number; target: number; lift: number; support: number }[];
  total_pairs: number;
}

export type ValueFormat = "money" | "int" | "pct" | "dec1" | "dec2" | "dec3";
export interface Report {
  type: string; title: string; currency: string; dataset: string; data_kind: string; data_notice: string; data_source?: string | null; generated_at: string;
  range: { from: string; to: string };
  summary: { label: string; value: number; format: ValueFormat }[];
  findings: string[];
  chart: { kind: "line" | "bar"; title: string; x: string; y: string; format: ValueFormat; limit?: number };
  columns: { key: string; label: string; format?: ValueFormat }[];
  rows: Record<string, string | number>[];
  note?: string;
}
