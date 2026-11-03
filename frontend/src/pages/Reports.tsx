import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar as RBar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TooltipBox } from "../components/charts";
import { Button, ErrorState, Eyebrow, Field, LoadingBar, LoadingBlock, Page, PageHero } from "../components/ui";
import { Select } from "../components/Select";
import { InViewChart } from "../motion/primitives";
import { api } from "../services/api";
import { compact, dateTime, formatValue, monthLabel, monthsBetween, titleCase } from "../services/format";
import { useStatus } from "../services/StatusContext";
import type { Report } from "../services/types";
import { useAsync } from "../services/useAsync";

const TYPES = [
  { id: "sales", label: "Revenue", note: "Revenue, orders and customers by month." },
  { id: "products", label: "Product Performance", note: "Every product, ranked, with its revenue share." },
  { id: "cities", label: "City-wise Sales", note: "Each city's size and order value." },
  { id: "customers", label: "Customer Segmentation", note: "K-Means segments compared." },
  { id: "basket", label: "Market Basket Analysis", note: "Apriori rules with support, confidence and lift." },
];

function ReportChart({ report }: { report: Report }) {
  const { chart, currency } = report;
  const data = report.rows.slice(0, chart.limit ?? report.rows.length);
  const tick = (v: number) => (chart.format === "money" ? (v === 0 ? "₹0" : `₹${compact(v)}`) : compact(v));
  const tooltip = ({ active, payload }: { active?: boolean; payload?: readonly { value?: unknown; payload?: Record<string, unknown> }[] }) =>
    active && payload?.length ? (
      <TooltipBox title={String(payload[0].payload?.[chart.x])} rows={[{ label: chart.title, value: formatValue(payload[0].value, chart.format, currency) }]} />
    ) : null;
  if (chart.kind === "line") {
    return (
      <div className="h-[300px]">
        <InViewChart>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey={chart.x} {...AXIS} tickMargin={8} minTickGap={18} />
            <YAxis width={58} {...AXIS} tickFormatter={tick} />
            <Tooltip cursor={{ stroke: "#191919" }} content={tooltip} />
            <Line dataKey={chart.y} stroke="#315C46" strokeWidth={2} dot={{ r: 2.5, fill: "#315C46" }} animationDuration={400} />
          </LineChart>
        </InViewChart>
      </div>
    );
  }
  return (
    <div style={{ height: data.length * 28 + 34 }}>
      <InViewChart>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#DDDDD5" horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={tick} minTickGap={32} />
          <YAxis type="category" dataKey={chart.x} width={230} interval={0} {...AXIS} tick={{ ...AXIS.tick, fill: "#191919", fontSize: 10.5 }} tickFormatter={(v: string) => (v.length > 34 ? `${v.slice(0, 33)}…` : v)} />
          <Tooltip cursor={{ fill: "rgba(25,25,25,0.05)" }} content={tooltip} />
          <RBar dataKey={chart.y} fill="#315C46" barSize={14} animationDuration={400} />
        </BarChart>
      </InViewChart>
    </div>
  );
}

function ReportBody({ report }: { report: Report }) {
  const [limit, setLimit] = useState(30);
  useEffect(() => setLimit(30), [report]);
  return (
    <article className="border border-rule bg-card p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>RetailIQ India / Analytical report</Eyebrow>
          {report.data_notice && (
            <div className={`num mt-1 max-w-2xl text-[11px] leading-snug ${report.data_kind === "synthetic" ? "text-accent2" : "text-accent"}`}>
              {report.data_notice}
              {report.data_source && <> <a className="underline underline-offset-2" href={report.data_source} target="_blank" rel="noreferrer">SOURCE</a></>}
            </div>
          )}
          <h2 className="mt-2 text-[clamp(1.75rem,3.6vw,3.25rem)] leading-[1.02] font-medium tracking-[-0.035em]">{report.title}</h2>
        </div>
        <dl className="num text-right text-[11.5px] leading-relaxed text-muted">
          <div>Dataset: {report.dataset}</div>
          <div>Range: {report.range.from} to {report.range.to}</div>
          <div>Generated: {dateTime(report.generated_at)}</div>
        </dl>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
        {report.summary.map((item) => (
          <div key={item.label} className="border-t border-ink pt-2">
            <Eyebrow>{item.label}</Eyebrow>
            <div className="num mt-2 text-[clamp(1rem,1.55vw,1.4rem)] leading-tight tracking-[-0.03em]">{formatValue(item.value, item.format, report.currency)}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-12 md:gap-x-10 gap-y-6">
        <div className="col-span-12 lg:col-span-4">
          <Eyebrow className="mb-2">Findings</Eyebrow>
          {report.findings.length ? (
            <ul className="space-y-2.5">
              {report.findings.map((finding) => (
                <li key={finding} className="border-t border-rule pt-2.5 text-[14.5px] leading-snug font-medium tracking-[-0.01em]">{finding}</li>
              ))}
            </ul>
          ) : <p className="text-[14px] text-muted">No findings for this selection.</p>}
        </div>
        <div className="col-span-12 min-w-0 lg:col-span-8">
          <Eyebrow className="mb-2">{report.chart.title}</Eyebrow>
          {report.rows.length ? <ReportChart report={report} /> : <p className="py-10 text-[14px] text-muted">No data in this range.</p>}
        </div>
      </div>
      {report.note && <p className="mt-5 text-[12.5px] text-muted">{report.note}</p>}

      <div className="mt-8">
        <Eyebrow className="mb-2">Detail</Eyebrow>
        <div className="max-h-[520px] overflow-auto">
          <table className="data-table [&_th]:!bg-card">
            <thead>
              <tr>{report.columns.map((c) => <th key={c.key} className={c.format ? "right" : ""}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {report.rows.slice(0, limit).map((row, index) => (
                <tr key={index}>
                  {report.columns.map((c) => {
                    const value = row[c.key];
                    const isName = !c.format && typeof value === "string" && value === value.toUpperCase() && /[A-Z]{3}/.test(value) && value.length > 5;
                    return <td key={c.key} className={`${c.format ? "right" : "max-w-[300px] truncate"}`}>{c.format ? formatValue(value, c.format, report.currency) : isName ? titleCase(String(value)) : String(value)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <span className="num text-xs text-muted">{Math.min(limit, report.rows.length).toLocaleString("en-GB")} of {report.rows.length.toLocaleString("en-GB")} rows</span>
          {limit < report.rows.length && <Button variant="quiet" onClick={() => setLimit((l) => l + 100)}>Show more</Button>}
        </div>
      </div>
    </article>
  );
}

export default function Reports() {
  const { dataVersion } = useStatus();
  const [params, setParams] = useSearchParams();
  const type = TYPES.some((t) => t.id === params.get("type")) ? params.get("type")! : "sales";
  const [from, setFrom] = useState<string | undefined>();
  const [to, setTo] = useState<string | undefined>();
  const [stamp, setStamp] = useState(0);
  const report = useAsync(() => api.report(type, from, to), [type, from, to, stamp, dataVersion]);
  const span = useAsync(() => api.span(), [dataVersion]);
  const months = span.data ? monthsBetween(span.data.from, span.data.to) : [];
  const usesRange = type !== "customers" && type !== "basket";

  return (
    <Page>
      <PageHero
        label="Reporting / Analytical reports"
        title={"Findings, ready\nto hand in."}
        intro="Every report is generated from the warehouse when you open it, with its charts, numbers and date. Export it as CSV for analysis or PDF for submission."
      />
      <div className="grid grid-cols-12 md:gap-x-10 gap-y-8">
        <div className="col-span-12 lg:col-span-3">
          <nav aria-label="Reports" className="lg:sticky lg:top-16">
            <ul>
              {TYPES.map((item, index) => (
                <li key={item.id}>
                  <button
                    onClick={() => setParams({ type: item.id })}
                    aria-current={item.id === type}
                    className={`grid w-full grid-cols-[24px_1fr] gap-x-1 border-b border-rule py-3 text-left transition-colors first:border-t ${item.id === type ? "border-b-ink text-ink" : "text-muted hover:text-ink"}`}
                  >
                    <span className="num pt-0.5 text-[11px]">{index + 1}</span>
                    <span>
                      <span className={`block text-[15px] tracking-[-0.015em] ${item.id === type ? "font-semibold" : "font-medium"}`}>{item.label}</span>
                      {item.id === type && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{item.note}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Field label="From">
                <Select className="" disabled={!usesRange} value={from ?? span.data?.from ?? ""} onChange={(e) => setFrom(e.target.value)}>
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </Select>
              </Field>
              <Field label="To">
                <Select className="" disabled={!usesRange} value={to ?? span.data?.to ?? ""} onChange={(e) => setTo(e.target.value)}>
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a className={`inline-flex h-[34px] items-center justify-center bg-accent text-[12.5px] font-semibold text-paper transition-colors hover:bg-[#274a38] ${report.data ? "" : "pointer-events-none opacity-40"}`} href={api.reportExportUrl(type, "pdf", from, to)} download>Export PDF</a>
              <a className={`inline-flex h-[34px] items-center justify-center border border-ink text-[12.5px] font-semibold transition-colors hover:bg-ink hover:text-paper ${report.data ? "" : "pointer-events-none opacity-40"}`} href={api.reportExportUrl(type, "csv", from, to)} download>Export CSV</a>
            </div>
            <Button variant="quiet" className="mt-2 w-full" busy={report.loading} onClick={() => setStamp((s) => s + 1)}>Regenerate</Button>
          </nav>
        </div>
        <div className="col-span-12 min-w-0 lg:col-span-9">
          <LoadingBar active={report.loading} />
          {report.error ? <ErrorState error={report.error} onRetry={report.reload} /> : !report.data ? <LoadingBlock height={520} label="Generating the report" /> : <ReportBody report={report.data} />}
        </div>
      </div>
    </Page>
  );
}
