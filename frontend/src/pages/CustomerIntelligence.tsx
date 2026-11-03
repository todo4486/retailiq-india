import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bar as RBar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceDot, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Bar, GRID, segmentColor, TooltipBox } from "../components/charts";
import { ClusterCanvas } from "../components/ClusterCanvas";
import { Button, EmptyState, ErrorState, Eyebrow, Field, Ledger, LoadingBar, LoadingBlock, Notice, Page, PageHero, Pagination, SectionHead, SortHeader } from "../components/ui";
import { Select } from "../components/Select";
import { InViewChart, RevealSection } from "../motion/primitives";
import { api } from "../services/api";
import { dateTime, int, money, moneyShort, pct } from "../services/format";
import { useStatus } from "../services/StatusContext";
import type { Segment } from "../services/types";
import { useAsync, useDebounced } from "../services/useAsync";

const AXES = [
  { id: "r", label: "Recency (days)", log: false },
  { id: "f", label: "Frequency (orders)", log: true },
  { id: "m", label: "Monetary (spend)", log: true },
] as const;
type AxisId = (typeof AXES)[number]["id"];

const SEGMENT_NOTES: Record<string, string> = {
  Champions: "Bought recently, buy often, spend the most.",
  "Loyal Customers": "Regular and recent buyers with solid spend.",
  "Potential Loyalists": "Recent buyers who have not yet returned often.",
  "At Risk": "Worthwhile past buyers who have gone quiet.",
  "Occasional Customers": "Long gone, bought rarely, spent little.",
  Hibernating: "The longest time since a purchase.",
  "Recent Newcomers": "Very recent, with little history so far.",
  "Big Spenders": "High spend on relatively few orders.",
};

function Comparison({ title, segments, value, format }: { title: string; segments: Segment[]; value: (s: Segment) => number; format: (v: number) => string }) {
  return (
    <div className="min-w-0">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <div style={{ height: segments.length * 30 + 8 }}>
        <InViewChart>
          <BarChart data={segments.map((s) => ({ segment: s.segment, value: value(s) }))} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="segment" hide />
            <Tooltip cursor={{ fill: "rgba(25,25,25,0.05)" }} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox title={payload[0].payload.segment} rows={[{ label: title, value: format(Number(payload[0].value)) }]} />
            ) : null} />
            <RBar dataKey="value" barSize={14} animationDuration={400} label={{ position: "right", formatter: (v: number) => format(v), fontSize: 11, fontFamily: "IBM Plex Mono", fill: "#191919" }}>
              {segments.map((s) => <Cell key={s.segment} fill={segmentColor(s.segment)} />)}
            </RBar>
          </BarChart>
        </InViewChart>
      </div>
    </div>
  );
}

function DiagnosticChart({ title, data, dataKey, k, format }: { title: string; data: { k: number; inertia: number; silhouette: number }[]; dataKey: "inertia" | "silhouette"; k: number; format: (v: number) => string }) {
  const selected = data.find((d) => d.k === k);
  return (
    <div className="min-w-0">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <div className="h-[150px]">
        <InViewChart>
          <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="k" {...AXIS} tickMargin={6} />
            <YAxis width={44} {...AXIS} domain={["auto", "auto"]} tickFormatter={format} />
            <Tooltip cursor={{ stroke: "#191919" }} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox title={`k = ${payload[0].payload.k}`} rows={[{ label: title, value: format(Number(payload[0].value)) }]} />
            ) : null} />
            <Line dataKey={dataKey} stroke="#315C46" strokeWidth={2} dot={{ r: 2.5, fill: "#315C46" }} animationDuration={400} />
            {selected && <ReferenceDot x={selected.k} y={selected[dataKey]} r={5} fill="#D58A52" stroke="#FFF" strokeWidth={2} />}
          </LineChart>
        </InViewChart>
      </div>
    </div>
  );
}

export default function CustomerIntelligence() {
  const location = useLocation();
  const { status, dataVersion } = useStatus();
  const currency = status?.currency ?? "₹";
  const overview = useAsync(() => api.customerOverview(), [dataVersion]);
  const points = useAsync(() => api.customerPoints(), [dataVersion]);

  const [k, setK] = useState(5);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [xAxis, setXAxis] = useState<AxisId>("r");
  const [yAxis, setYAxis] = useState<AxisId>("m");

  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [sort, setSort] = useState("monetary");
  const [dir, setDir] = useState("desc");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [selected, debounced, sort, dir]);
  const customers = useAsync(
    () => api.customers({ segment: selected ?? undefined, search: debounced, sort, dir, page }),
    [selected, debounced, sort, dir, page, overview.data],
  );

  const run = overview.data?.run;
  useEffect(() => { if (run) setK(run.params.k); }, [run]);

  const execute = (value: number) => {
    setRunning(true);
    setMessage(null);
    api.cluster(value)
      .then((res) => {
        setMessage({ tone: "success", text: `K-Means finished: ${int(res.customers)} customers in ${res.k} clusters.` });
        setSelected(null);
        return Promise.all([overview.reload(), points.reload()]);
      })
      .catch((e: Error) => setMessage({ tone: "error", text: e.message }))
      .finally(() => setRunning(false));
  };

  // Run requested from the command palette.
  const handled = useRef<unknown>(null);
  useEffect(() => {
    const auto = (location.state as { autoRun?: number } | null)?.autoRun;
    if (auto && handled.current !== auto) {
      handled.current = auto;
      execute(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const segments = overview.data?.segments ?? [];
  const xSpec = AXES.find((a) => a.id === xAxis)!;
  const ySpec = AXES.find((a) => a.id === yAxis)!;
  const toggleSort = (column: string) => {
    if (sort === column) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(column); setDir(column === "name" || column === "city" || column === "recency" ? "asc" : "desc"); }
  };

  const maxCustomers = Math.max(1, ...segments.map((s) => s.customers));

  if (overview.error) {
    return <Page><div className="pt-14"><ErrorState error={overview.error} onRetry={overview.reload} /></div></Page>;
  }
  if (!overview.data) return <Page><LoadingBlock height={520} /></Page>;

  return (
    <Page>
      <PageHero
        label="Data mining / RFM and K-Means"
        title={"Who actually\nbuys, and how."}
        intro="Each customer is reduced to three numbers: how recently, how often and how much. K-Means then groups them by behaviour, on normalised values, with no hand-set thresholds."
        aside={
          <div>
            <div className="flex items-end gap-2 pb-3">
              <Field label="Clusters (k)" className="w-28">
                <Select className="" value={k} onChange={(e) => setK(Number(e.target.value))} disabled={running}>
                  {[2, 3, 4, 5, 6, 7, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </Field>
              <Button variant="primary" className="flex-1" busy={running} onClick={() => execute(k)}>{running ? "Clustering" : "Run K-Means"}</Button>
            </div>
            {run && (
              <Ledger items={[
                { label: "Customers", value: int(run.metrics.customers) },
                { label: "Silhouette", value: run.metrics.silhouette.toFixed(3) },
                { label: "Inertia", value: int(run.metrics.inertia) },
                { label: "Last run", value: `${dateTime(run.ran_at)} · ${run.duration}s` },
              ]} />
            )}
          </div>
        }
      />
      {message && <div className="-mt-4 mb-8"><Notice tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Notice></div>}

      {!segments.length ? (
        overview.data.identified_customers === 0 ? (
          <EmptyState
            title="This dataset has no customer identifiers"
            body="RFM needs to know which orders belong to the same customer. The loaded data has no customer IDs (marketplace reports such as the Amazon.in seller export omit them), so every sale belongs to the unknown member and K-Means cannot run. Load the synthetic dataset or the UCI dataset in Warehouse to explore customer segments."
          />
        ) : (
          <EmptyState
            title="No clusters yet"
            body="This warehouse has no customer segments yet. Run K-Means to compute them."
            action={<Button variant="primary" busy={running} onClick={() => execute(k)}>Run K-Means</Button>}
          />
        )
      ) : (
        <>
          <RevealSection className="grid grid-cols-12 md:gap-x-10 gap-y-10">
            <div className="col-span-12 min-w-0 lg:col-span-8">
              <SectionHead index="01 / Clusters" title="Customer map" />
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <Field label="Horizontal" className="w-44">
                  <Select className="" value={xAxis} onChange={(e) => setXAxis(e.target.value as AxisId)}>
                    {AXES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </Select>
                </Field>
                <Field label="Vertical" className="w-44">
                  <Select className="" value={yAxis} onChange={(e) => setYAxis(e.target.value as AxisId)}>
                    {AXES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </Select>
                </Field>
                <p className="pb-1.5 text-[12px] text-muted">Click a point to select its cluster. Frequency and spend use log scales. Points glide when you change axes or re-cluster.</p>
              </div>
              <div className="h-[420px] sm:h-[520px]">
                {points.data ? (
                  <ClusterCanvas points={points.data} xKey={xAxis} yKey={yAxis} xTitle={xSpec.label} yTitle={ySpec.label} xLog={xSpec.log} yLog={ySpec.log} selected={selected} onPick={(s) => setSelected((c) => (c === s ? null : s))} />
                ) : <LoadingBlock height={420} label="Loading customers" />}
              </div>
            </div>

            <div className="col-span-12 min-w-0 lg:col-span-4">
              <SectionHead index="02 / Segments" title="Distribution" />
              <div role="group" aria-label="Filter by segment">
                <button
                  onClick={() => setSelected(null)}
                  aria-pressed={!selected}
                  className={`mb-1 h-7 border px-2.5 text-[12px] font-medium transition-colors ${!selected ? "border-ink bg-ink text-paper" : "border-rule hover:border-muted"}`}
                >
                  All segments
                </button>
                {segments.map((segment) => {
                  const active = selected === segment.segment;
                  return (
                    <button
                      key={segment.segment}
                      onClick={() => setSelected(active ? null : segment.segment)}
                      aria-pressed={active}
                      className={`block w-full border-b border-rule px-2 py-3 text-left transition-colors first:border-t ${active ? "bg-card outline outline-1 -outline-offset-1 outline-ink" : "hover:bg-card"}`}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.015em]">
                          <span className="inline-block size-2.5 shrink-0" style={{ background: segmentColor(segment.segment) }} aria-hidden />
                          <span className="truncate">{segment.segment}</span>
                        </span>
                        <span className="num text-[13px]">{int(segment.customers)}</span>
                      </span>
                      <span className="mt-2 block"><Bar share={segment.customers / maxCustomers} color={segmentColor(segment.segment)} /></span>
                      <span className="mt-1.5 block text-[12px] leading-snug text-muted">{SEGMENT_NOTES[segment.segment]}</span>
                      <span className="num mt-1 block text-[11px] text-muted">{pct(segment.customer_share)} of customers · {pct(segment.revenue_share)} of revenue</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </RevealSection>

          <RevealSection className="mt-16">
            <SectionHead index="03 / Comparison" title="Segment comparison" />
            <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-[auto_1fr_1fr_1fr]">
              <div className="hidden md:block">
                <Eyebrow className="mb-2">Segment</Eyebrow>
                {segments.map((s) => <div key={s.segment} className="flex h-[30px] items-center text-[13px] font-medium whitespace-nowrap">{s.segment}</div>)}
              </div>
              <Comparison title="Average lifetime spend" segments={segments} value={(s) => s.avg_monetary} format={(v) => moneyShort(v, currency)} />
              <Comparison title="Average orders" segments={segments} value={(s) => s.avg_frequency} format={(v) => v.toFixed(1)} />
              <Comparison title="Average days since last order" segments={segments} value={(s) => s.avg_recency} format={(v) => `${Math.round(v)}d`} />
            </div>
          </RevealSection>

          <RevealSection className="mt-16">
            <SectionHead index="04 / Customers" title={selected ?? "All clustered customers"} aside={
              <Field label="Search name, ID or city" className="w-full sm:w-72">
                <input className="field" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
            } />
            <LoadingBar active={customers.loading} />
            {customers.error ? <Notice tone="error">{customers.error.message}</Notice> : customers.data && (customers.data.customers.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <SortHeader label="Customer" active={sort === "name"} dir={dir} onClick={() => toggleSort("name")} />
                        <SortHeader label="City" active={sort === "city"} dir={dir} onClick={() => toggleSort("city")} />
                        <th>Segment</th>
                        <SortHeader label="Recency" right active={sort === "recency"} dir={dir} onClick={() => toggleSort("recency")} />
                        <SortHeader label="Frequency" right active={sort === "frequency"} dir={dir} onClick={() => toggleSort("frequency")} />
                        <SortHeader label="Monetary" right active={sort === "monetary"} dir={dir} onClick={() => toggleSort("monetary")} />
                      </tr>
                    </thead>
                    <tbody>
                      {customers.data.customers.map((customer) => (
                        <tr key={customer.id}>
                          <td className="whitespace-nowrap">{customer.name}</td>
                          <td className="whitespace-nowrap">{customer.city}</td>
                          <td className="whitespace-nowrap">
                            <span className="mr-1.5 inline-block size-2" style={{ background: segmentColor(customer.segment) }} aria-hidden />
                            {customer.segment}
                          </td>
                          <td className="right">{int(customer.recency)} d</td>
                          <td className="right">{int(customer.frequency)}</td>
                          <td className="right">{money(customer.monetary, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} pageSize={25} total={customers.data.total} onPage={setPage} />
              </>
            ) : <p className="border-t border-rule py-8 text-[14px] text-muted">No customers match this search.</p>)}
          </RevealSection>

          {run && (
            <RevealSection className="mt-16">
              <SectionHead index="05 / Model" title="Choosing k" />
              <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-[1fr_1fr_minmax(0,300px)]">
                <DiagnosticChart title="Inertia (elbow)" data={run.metrics.diagnostics} dataKey="inertia" k={run.params.k} format={(v) => int(v)} />
                <DiagnosticChart title="Silhouette score" data={run.metrics.diagnostics} dataKey="silhouette" k={run.params.k} format={(v) => v.toFixed(2)} />
                <p className="text-[13px] leading-relaxed text-muted">
                  Inertia always falls as k grows, so look for the bend. Silhouette measures how well separated the clusters are. The orange point marks the current k. Features are log-transformed and z-scored before clustering, and names are assigned from each cluster's centroid.
                </p>
              </div>
            </RevealSection>
          )}
        </>
      )}
    </Page>
  );
}
