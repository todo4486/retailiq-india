// API integration layer. Every call to the Flask backend goes through here.
import type {
  BasketNetwork, Customer, CustomerOverview, CustomerPoint, Dataset, DatasetProfile, EtlRun, Members, OlapResult,
  OlapState, OverviewData, Paged, ProductAssociations, PublicSummary, Report, RowsResponse, RuleProduct, RulesResponse, Schema,
  Status, TableDetail,
} from "./types";

export class ApiFailure extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiFailure("The RetailIQ API is not reachable. Start the backend with scripts/start.sh.", 0, "offline");
  }
  // The session has ended: AuthContext sends the user back to sign in.
  if (response.status === 401 && !path.startsWith("/auth/login")) {
    window.dispatchEvent(new Event("riq:unauthenticated"));
  }
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (!response.ok) {
      throw new ApiFailure("The RetailIQ API is not reachable. Start the backend with scripts/start.sh.", response.status, "offline");
    }
  }
  if (!response.ok) {
    throw new ApiFailure(body?.error?.message ?? `Request failed (${response.status}).`, response.status, body?.error?.code ?? "error");
  }
  return body as T;
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type UploadProgress = (fraction: number) => void;

// XMLHttpRequest rather than fetch, because it reports real upload progress.
function uploadFile(file: File, onProgress?: UploadProgress) {
  return new Promise<Dataset>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/datasets");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onerror = () => reject(new ApiFailure("The upload failed. Check that the API is running.", 0, "offline"));
    request.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // handled below
      }
      if (request.status === 401) window.dispatchEvent(new Event("riq:unauthenticated"));
      if (request.status >= 200 && request.status < 300) resolve(body as Dataset);
      else reject(new ApiFailure(body?.error?.message ?? `Upload failed (${request.status}).`, request.status, body?.error?.code ?? "error"));
    };
    request.send(form);
  });
}

export const api = {
  me: () => request<{ user: { id: number; name: string; email: string } | null }>("/auth/me"),
  login: (email: string, password: string, remember: boolean) =>
    post<{ id: number; name: string; email: string }>("/auth/login", { email, password, remember }),
  register: (name: string, email: string, password: string) =>
    post<{ id: number; name: string; email: string }>("/auth/register", { name, email, password }),
  logout: () => post("/auth/logout", {}),
  updateName: (name: string) =>
    request<{ id: number; name: string; email: string }>("/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  forgotPassword: (email: string) => post("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => post("/auth/reset-password", { token, password }),
  publicSummary: () => request<PublicSummary | null>("/public/summary"),

  status: () => request<Status>("/status"),
  overview: (from?: string, to?: string, compare?: string) => request<OverviewData>(`/overview${qs({ from, to, compare })}`),

  span: () => request<{ from: string; to: string }>("/span"),

  datasets: () => request<Dataset[]>("/datasets"),
  upload: uploadFile,
  deleteDataset: (id: string) => request(`/datasets/${id}`, { method: "DELETE" }),
  updateDataset: (id: string, body: { roles?: Record<string, string>; inr_rate?: number }) =>
    request<Dataset>(`/datasets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  profile: (id: string) => request<DatasetProfile>(`/datasets/${id}/profile`),
  rows: (id: string, params: { search?: string; sort?: string; dir?: string; page?: number; size?: number; filters?: string; view?: string }) =>
    request<RowsResponse>(`/datasets/${id}/rows${qs(params)}`),

  startEtl: (datasetId: string) => post<{ run_id: number }>("/etl/runs", { dataset_id: datasetId }),
  etlRun: (id: number) => request<EtlRun>(`/etl/runs/${id}`),
  etlHistory: () => request<EtlRun[]>("/etl/runs"),

  schema: () => request<Schema>("/warehouse/schema"),
  table: (name: string, page: number, sort?: string, dir?: string) =>
    request<TableDetail>(`/warehouse/tables/${name}${qs({ page, size: 8, sort, dir })}`),

  olapMembers: () => request<Members>("/olap/members"),
  olap: (operation: string, state: OlapState | null, args?: Record<string, unknown>) =>
    post<OlapResult>("/olap/execute", { operation, state, args }),

  customerOverview: () => request<CustomerOverview>("/customers/overview"),
  customerPoints: () => request<CustomerPoint[]>("/customers/points"),
  customers: (params: { segment?: string; search?: string; sort?: string; dir?: string; page?: number }) =>
    request<Paged & { customers: Customer[] }>(`/customers/list${qs(params)}`),
  cluster: (k: number) => post<{ customers: number; k: number }>("/customers/cluster", { k }),

  rules: (params: { sort?: string; dir?: string; search?: string; product?: number; page?: number }) =>
    request<RulesResponse>(`/basket/rules${qs(params)}`),
  ruleProducts: () => request<RuleProduct[]>("/basket/products"),
  productAssociations: (id: number) => request<ProductAssociations>(`/basket/products/${id}`),
  network: (limit = 36) => request<BasketNetwork>(`/basket/network${qs({ limit })}`),
  runApriori: (body: { min_support: number; min_confidence: number; min_lift: number; max_len: number; city: string | null; level: string; multi_item_only: boolean }) =>
    post<{ rules: number; baskets: number; frequent_itemsets: number }>("/basket/run", body),

  report: (type: string, from?: string, to?: string) => request<Report>(`/reports/${type}${qs({ from, to })}`),
  reportExportUrl: (type: string, format: "csv" | "pdf", from?: string, to?: string) => `/api/reports/${type}${qs({ from, to, format })}`,
};
