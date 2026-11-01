import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, ErrorState, Eyebrow, Field, Ledger, LoadingBar, LoadingBlock, Notice, Page, PageHero, Pagination, SectionHead, SortHeader } from "../components/ui";
import { Select } from "../components/Select";
import { CountUp, MaskReveal, RevealSection } from "../motion/primitives";
import { api } from "../services/api";
import { dateTime, fileSize, int, pct } from "../services/format";
import { useStatus } from "../services/StatusContext";
import type { ColumnProfile, DatasetProfile, Quality } from "../services/types";
import { useAsync, useDebounced } from "../services/useAsync";

interface FilterSpec { column: string; op: string; value: string }

const OPERATORS = [
  { id: "contains", label: "contains" },
  { id: "equals", label: "equals" },
  { id: "not_equals", label: "does not equal" },
  { id: "gt", label: "greater than" },
  { id: "lt", label: "less than" },
  { id: "empty", label: "is empty" },
  { id: "not_empty", label: "is not empty" },
];
const VIEWS = [
  { id: "all", label: "All records" },
  { id: "duplicates", label: "Duplicates" },
  { id: "any_missing", label: "Missing values" },
  { id: "invalid", label: "Invalid" },
];

function UploadZone({ onUploaded, focusSignal }: { onUploaded: (id: string) => void; focusSignal?: unknown }) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal) input.current?.click();
  }, [focusSignal]);

  const send = (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    api.upload(file, setProgress)
      .then((meta) => onUploaded(meta.id))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <button
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files[0]); }}
        className={`flex w-full items-center justify-between gap-4 border border-dashed px-3 py-4 text-left transition-colors ${dragging ? "border-accent bg-accent/5" : "border-muted hover:border-ink"}`}
      >
        <span>
          <span className="block text-[14px] font-semibold tracking-tight">{busy ? (progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Reading the file") : "Upload a CSV"}</span>
          <span className="block text-[12px] text-muted">Drop a file here or click to browse. 200 MB limit.</span>
        </span>
        <span className="num text-lg" aria-hidden>{busy ? "…" : "↑"}</span>
      </button>
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" aria-label="CSV file" onChange={(e) => { send(e.target.files?.[0]); e.target.value = ""; }} />
      {busy && (
        <div className="mt-1 h-0.5 bg-rule">
          <motion.div className="h-0.5 origin-left bg-accent" animate={{ scaleX: progress }} initial={{ scaleX: 0 }} transition={{ duration: 0.2 }} />
        </div>
      )}
      {error && <div className="mt-2"><Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice></div>}
    </div>
  );
}

function QualityReport({ quality }: { quality: Quality }) {
  const total = Math.max(quality.total, 1);
  const parts = [
    { label: "Valid", value: quality.valid ?? 0, color: "#315C46" },
    { label: "Duplicates", value: quality.duplicates, color: "#D58A52" },
    { label: "Invalid", value: quality.invalid, color: "#A23B5A" },
  ];
  const figures = [
    { label: "Total records", value: quality.total, note: "Rows in the source file" },
    { label: "Duplicate records", value: quality.duplicates, note: "Identical in every column" },
    { label: "Missing values", value: quality.missing_cells, note: `Blank cells, across ${int(quality.rows_with_missing)} rows` },
    { label: "Invalid entries", value: quality.invalid, note: "Fail a transaction rule" },
    { label: "Valid records", value: quality.valid, note: quality.valid == null ? "Map the required columns" : pct(quality.valid / total) + " of the file" },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-5">
        {figures.map((figure) => (
          <div key={figure.label} className="lift border-t border-rule pt-2">
            <Eyebrow>{figure.label}</Eyebrow>
            {figure.value == null ? <div className="num mt-3 text-[clamp(1.35rem,2.3vw,2.1rem)] leading-none">—</div> : <CountUp value={figure.value} format={int} className="num mt-3 block text-[clamp(1.35rem,2.3vw,2.1rem)] leading-none tracking-[-0.03em]" />}
            <div className="mt-2 text-[12px] leading-snug text-muted">{figure.note}</div>
          </div>
        ))}
      </div>
      {quality.rules_applied && (
        <div className="mt-8 grid grid-cols-12 md:gap-x-10 gap-y-6">
          <div className="col-span-12 lg:col-span-7">
            <Eyebrow className="mb-2">Composition of the file</Eyebrow>
            <MaskReveal>
              <div className="flex h-5 w-full gap-0.5" role="img" aria-label={parts.map((p) => `${p.label}: ${int(p.value)}`).join(", ")}>
                {parts.filter((p) => p.value > 0).map((p) => (
                  <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, minWidth: 3, background: p.color }} title={`${p.label}: ${int(p.value)}`} />
                ))}
              </div>
            </MaskReveal>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
              {parts.map((p) => (
                <span key={p.label} className="flex items-center gap-1.5">
                  <span className="inline-block size-2" style={{ background: p.color }} aria-hidden />
                  {p.label} <span className="num text-muted">{pct(p.value / total)}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 max-w-xl text-[12.5px] leading-relaxed text-muted">
              A record is valid if it is not a duplicate, has every required field and passes the transaction rules. A record can break several rules, so these counts overlap. ETL then applies further steps, such as removing postage lines and reversing cancelled purchases.
            </p>
          </div>
          <div className="col-span-12 lg:col-span-5">
            <Eyebrow className="mb-2">Invalid entries by rule</Eyebrow>
            <table className="data-table">
              <tbody>
                {quality.invalid_breakdown.map((rule) => (
                  <tr key={rule.rule}>
                    <td className="!font-sans !text-[13px]">{rule.rule}</td>
                    <td className="right">{int(rule.count)}</td>
                  </tr>
                ))}
                <tr><td className="!font-sans !text-[13px]">Missing a required field</td><td className="right">{int(quality.missing_required)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnStats({ column }: { column: ColumnProfile }) {
  const stats = column.stats;
  if (stats && "mean" in stats) {
    const f = (v: number | string) => Number(v).toLocaleString("en-GB", { maximumFractionDigits: 2 });
    return <span>min {f(stats.min)} · q1 {f(stats.q1)} · median {f(stats.median)} · q3 {f(stats.q3)} · max {f(stats.max)} · mean {f(stats.mean)} · sd {f(stats.std)}</span>;
  }
  if (stats && "min" in stats) return <span>{String(stats.min)} to {String(stats.max)}</span>;
  if (column.top_values?.length) {
    return <span className="block truncate">{column.top_values.slice(0, 3).map((t) => `${t.value} (${int(t.count)})`).join(" · ")}</span>;
  }
  return <span>—</span>;
}

function ColumnMapping({ profile, onSaved }: { profile: DatasetProfile; onSaved: () => void }) {
  const [roles, setRoles] = useState(profile.dataset.roles);
  const [rate, setRate] = useState(String(profile.dataset.inr_rate));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  useEffect(() => { setRoles(profile.dataset.roles); setRate(String(profile.dataset.inr_rate)); }, [profile.dataset]);

  const save = () => {
    setSaving(true);
    api.updateDataset(profile.dataset.id, { roles, inr_rate: Number(rate) })
      .then(() => { setMessage({ tone: "success", text: "Mapping saved. The quality report has been recalculated." }); onSaved(); })
      .catch((e: Error) => setMessage({ tone: "error", text: e.message }))
      .finally(() => setSaving(false));
  };

  return (
    <div>
      <p className="mb-4 max-w-2xl text-[13.5px] leading-relaxed text-muted">
        ETL needs to know what each column means. Common retail headers are matched automatically. Required fields are marked with an asterisk. Without a category, state or region column, RetailIQ derives those values from its documented rules. All money is stored in rupees: if this file is in another currency, enter its rate to the rupee. Ambiguous dates are read day-first.
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4 xl:grid-cols-6">
        {Object.entries(profile.role_labels).map(([role, label]) => (
          <Field key={role} label={`${label}${profile.required_roles.includes(role) ? " *" : ""}`}>
            <Select className="" value={roles[role] ?? ""} onChange={(e) => setRoles((r) => ({ ...r, [role]: e.target.value }))}>
              <option value="">Not mapped</option>
              {profile.columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </Select>
          </Field>
        ))}
        <Field label="₹ per source currency unit">
          <input className="field" type="number" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={save} busy={saving}>Save mapping</Button>
        {message && <Notice tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Notice>}
      </div>
    </div>
  );
}

export default function DataExplorer() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, refresh } = useStatus();
  const datasets = useAsync(() => api.datasets(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const datasetId = selected ?? status?.dataset_id ?? datasets.data?.[0]?.id ?? null;
  const profile = useAsync(() => (datasetId ? api.profile(datasetId) : Promise.resolve(null)), [datasetId]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [sort, setSort] = useState<string | undefined>();
  const [dir, setDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [view, setView] = useState("all");
  const [filters, setFilters] = useState<FilterSpec[]>([]);
  const [etlError, setEtlError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const activeFilters = filters.filter((f) => f.column && (f.value || f.op === "empty" || f.op === "not_empty"));
  const filterKey = JSON.stringify(activeFilters);
  useEffect(() => setPage(1), [debouncedSearch, sort, dir, view, filterKey, datasetId]);

  const records = useAsync(
    () => (datasetId ? api.rows(datasetId, { search: debouncedSearch, sort, dir, page, size: 25, filters: filterKey, view }) : Promise.resolve(null)),
    [datasetId, debouncedSearch, sort, dir, page, filterKey, view],
  );

  const meta = profile.data?.dataset;
  const columns = profile.data?.columns ?? [];
  const typeOf = (name: string) => columns.find((c) => c.name === name)?.type ?? "";

  const runEtl = () => {
    if (!datasetId) return;
    setStarting(true);
    setEtlError(null);
    api.startEtl(datasetId)
      .then(() => { refresh(); navigate("/warehouse"); })
      .catch((e: Error) => setEtlError(e.message))
      .finally(() => setStarting(false));
  };

  const remove = () => {
    if (!meta || !window.confirm(`Delete the uploaded dataset “${meta.name}”? Data already loaded into the warehouse is not affected.`)) return;
    api.deleteDataset(meta.id).then(() => { setSelected(null); datasets.reload(); });
  };

  const toggleSort = (column: string) => {
    if (sort === column) {
      if (dir === "asc") setDir("desc");
      else { setSort(undefined); setDir("asc"); }
    } else {
      setSort(column);
      setDir("asc");
    }
  };

  const focusUpload = (location.state as { focusUpload?: number } | null)?.focusUpload;

  return (
    <Page>
      <PageHero
        label="Source data / Data Explorer"
        title={"See the data\nas it arrived."}
        intro="Inspect a raw CSV before it reaches the warehouse: its shape, its blanks, its duplicates, and every value that would fail a transaction rule."
        aside={
          <div className="space-y-3">
            <Field label="Dataset">
              <Select className="" value={datasetId ?? ""} onChange={(e) => setSelected(e.target.value)}>
                {datasets.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <UploadZone focusSignal={focusUpload} onUploaded={(id) => { datasets.reload(); setSelected(id); }} />
          </div>
        }
      />

      {datasets.data && !datasets.data.length ? (
        <p className="border-t border-rule py-10 text-muted">No datasets yet. Upload a retail CSV to begin.</p>
      ) : profile.error ? <ErrorState error={profile.error} onRetry={profile.reload} /> : !profile.data || !meta ? <LoadingBlock label="Profiling the dataset" height={420} /> : (
        <>
          <RevealSection className="grid grid-cols-12 md:gap-x-10 gap-y-6 border-t border-ink pt-3 pb-12">
            <div className="col-span-12 lg:col-span-8">
              <Eyebrow>Dimensions</Eyebrow>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-5 text-[clamp(2rem,5vw,4.25rem)] leading-none font-medium tracking-[-0.04em]">
                <span><span className="num">{int(profile.data.rows)}</span> <span className="text-[0.4em] tracking-tight text-muted">rows</span></span>
                <span className="text-muted" aria-hidden>×</span>
                <span><span className="num">{columns.length}</span> <span className="text-[0.4em] tracking-tight text-muted">columns</span></span>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button variant="primary" busy={starting} disabled={profile.data.missing_roles.length > 0 || status?.etl_running} onClick={runEtl}>
                  {status?.etl_running ? "ETL is running" : "Run ETL on this dataset →"}
                </Button>
                {!meta.builtin && <Button variant="quiet" onClick={remove}>Delete dataset</Button>}
              </div>
              {profile.data.missing_roles.length > 0 && (
                <p className="mt-2 text-[13px] text-danger">Map these columns before running ETL: {profile.data.missing_roles.join(", ")}.</p>
              )}
              {meta.note && <p className="mt-3 max-w-xl text-[12.5px] leading-snug text-muted">{meta.note}</p>}
              {etlError && <div className="mt-2"><Notice tone="error">{etlError}</Notice></div>}
            </div>
            <div className="col-span-12 lg:col-span-4">
              <Ledger items={[
                { label: "File", value: meta.filename },
                { label: "Size", value: fileSize(meta.size) },
                { label: "Added", value: dateTime(meta.added_at) },
                { label: "Type", value: meta.kind === "synthetic" ? "Synthetic demo data" : "Imported data" },
                { label: "Source", value: meta.source ? <a className="underline underline-offset-2 hover:text-accent" href={meta.source} target="_blank" rel="noreferrer">UCI repository</a> : meta.builtin ? "Generated locally" : "Uploaded" },
              ]} />
            </div>
          </RevealSection>

          <RevealSection id="quality" className="scroll-mt-16 pb-14">
            <SectionHead index="01 / Quality" title="Data-quality report" />
            <QualityReport quality={profile.data.quality} />
          </RevealSection>

          <RevealSection className="pb-14">
            <SectionHead index="02 / Records" title="Dataset preview" />
            <div className="grid grid-cols-12 items-end gap-x-3 gap-y-3 pb-3">
              <Field label="Search all columns" className="col-span-12 md:col-span-5">
                <input className="field" type="search" placeholder="e.g. atta or Mumbai" value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
              <div className="col-span-12 md:col-span-7">
                <span className="eyebrow mb-1 block">Show</span>
                <div className="flex flex-wrap" role="group" aria-label="Record view">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setView(v.id)}
                      aria-pressed={view === v.id}
                      className={`relative -ml-px h-[34px] border border-rule bg-card px-3 text-[12.5px] font-medium transition-colors first:ml-0 ${view === v.id ? "text-paper" : "hover:text-accent"}`}
                    >
                      {view === v.id && <motion.span layoutId="explorer-view" className="absolute inset-0 bg-ink" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                      <span className="relative">{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5 pb-3">
              {filters.map((filter, index) => {
                const change = (patch: Partial<FilterSpec>) => setFilters((all) => all.map((f, i) => (i === index ? { ...f, ...patch } : f)));
                const noValue = filter.op === "empty" || filter.op === "not_empty";
                return (
                  <div key={index} className="grid grid-cols-12 gap-1.5">
                    <Select className="col-span-5 md:col-span-3" aria-label="Filter column" value={filter.column} onChange={(e) => change({ column: e.target.value })}>
                      {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </Select>
                    <Select className="col-span-7 md:col-span-3" aria-label="Filter operator" value={filter.op} onChange={(e) => change({ op: e.target.value })}>
                      {OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                    <input className="field col-span-9 md:col-span-4" aria-label="Filter value" disabled={noValue} placeholder={noValue ? "" : "Value"} value={filter.value} onChange={(e) => change({ value: e.target.value })} />
                    <Button variant="quiet" className="col-span-3 md:col-span-2" onClick={() => setFilters((all) => all.filter((_, i) => i !== index))}>Remove</Button>
                  </div>
                );
              })}
              <Button variant="quiet" onClick={() => setFilters((all) => [...all, { column: columns[0]?.name ?? "", op: "contains", value: "" }])}>+ Add column filter</Button>
            </div>
            <LoadingBar active={records.loading} />

            {records.error ? <Notice tone="error">{records.error.message}</Notice> : records.data && (
              records.data.rows.length ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {records.data.columns.map((c) => (
                            <SortHeader key={c} label={c} active={sort === c} dir={dir} onClick={() => toggleSort(c)} right={["integer", "decimal"].includes(typeOf(c))} />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {records.data.rows.map((row, index) => (
                          <tr key={index}>
                            {records.data!.columns.map((c) => (
                              <td key={c} className={`max-w-[280px] truncate whitespace-nowrap ${["integer", "decimal"].includes(typeOf(c)) ? "right" : ""}`}>
                                {row[c] == null ? <span className="text-accent2">missing</span> : row[c]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={page} pageSize={25} total={records.data.total} onPage={setPage} />
                </>
              ) : <p className="border-t border-rule py-10 text-[14px] text-muted">No records match this search and these filters.</p>
            )}
          </RevealSection>

          <RevealSection className="pb-14">
            <SectionHead index="03 / Columns" title="Column types and statistics" />
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Column</th><th>Type</th><th className="right">Missing</th><th className="right">%</th><th className="right">Unique</th><th>Statistics or top values</th></tr>
                </thead>
                <tbody>
                  {columns.map((column) => (
                    <tr key={column.name}>
                      <td className="font-medium whitespace-nowrap">{column.name}</td>
                      <td className="text-accent">{column.type}</td>
                      <td className={`right ${column.missing ? "text-accent2" : "text-muted"}`}>{int(column.missing)}</td>
                      <td className="right text-muted">{pct(column.missing_pct)}</td>
                      <td className="right">{int(column.unique)}</td>
                      <td className="max-w-[560px] text-muted"><ColumnStats column={column} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RevealSection>

          <RevealSection>
            <SectionHead index="04 / Mapping" title="Column roles" />
            <ColumnMapping profile={profile.data} onSaved={() => { profile.reload(); records.reload(); }} />
          </RevealSection>
        </>
      )}
    </Page>
  );
}
