import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar as RBar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Bar, GRID, Legend, PALETTE, segmentColor, TooltipBox } from "../components/charts";
import { Select } from "../components/Select";
import { Button, ErrorState, Eyebrow, Field, Ledger, LoadingBar, LoadingBlock, Page, SectionHead } from "../components/ui";
import { CountUp, EASE, InViewChart, Reveal, RevealSection, TextLines } from "../motion/primitives";
import { api } from "../services/api";
import { compact, dateTime, int, money, moneyShort, monthLabel, monthsBetween, monthShort, pct, signedPct, titleCase } from "../services/format";
import { useStatus } from "../services/StatusContext";
import type { OverviewData } from "../services/types";
import { useAsync } from "../services/useAsync";

const PRESETS = [
  { id: "3", label: "3M" },
  { id: "6", label: "6M" },
  { id: "12", label: "12M" },
  { id: "all", label: "All" },
];

function Metric({ label, value, format, change, previous }: { label: string; value: number; format: (v: number) => string; change: number | null; previous?: string }) {
  return (
    <div className="lift border-t border-ink pt-2.5 pb-1">
      <Eyebrow>{label}</Eyebrow>
      <CountUp value={value} format={format} className="num mt-4 block text-[clamp(1.5rem,2.9vw,2.85rem)] leading-none tracking-[-0.04em]" />
      <div className="num mt-2.5 flex min-h-4 flex-wrap gap-x-2 text-[11.5px] text-muted">
        {change != null && <span className={change >= 0 ? "text-accent" : "text-danger"}>{signedPct(change)}</span>}
        {previous && <span>was {previous}</span>}
      </div>
    </div>
  );
}

const change = (now: number, before: number | undefined) => (before ? (now - before) / before : null);
const rupeeAxis = (v: number) => (v === 0 ? "₹0" : `₹${compact(v)}`);

function RevenueChart({ data }: { data: OverviewData }) {
  const hasCompare = data.series.some((p) => p.compare != null);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Legend items={[
          { label: "Revenue", color: "#315C46" },
          ...(hasCompare ? [{ label: data.compare === "year" ? "A year earlier" : "Previous period", color: "#D58A52", dashed: true }] : []),
        ]} />
        {data.partial_month && <span className="num text-[11px] text-muted">{monthLabel(data.partial_month.month)} has data to day {data.partial_month.through_day} only</span>}
      </div>
      <div className="h-[320px] sm:h-[420px]">
        <InViewChart>
          <LineChart data={data.series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="month" tickFormatter={monthShort} {...AXIS} tickMargin={10} minTickGap={24} />
            <YAxis width={66} tickFormatter={rupeeAxis} {...AXIS} />
            <Tooltip
              cursor={{ stroke: "#191919", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as OverviewData["series"][number];
                return (
                  <TooltipBox
                    title={monthLabel(point.month)}
                    rows={[
                      { label: "Revenue", value: money(point.revenue), color: "#315C46" },
                      ...(point.compare != null ? [{ label: monthLabel(point.compare_month!), value: money(point.compare), color: "#D58A52" }] : []),
                      { label: "Orders", value: int(point.orders) },
                    ]}
                    footer={point.compare ? `${signedPct((point.revenue - point.compare) / point.compare)} change` : undefined}
                  />
                );
              }}
            />
            {data.partial_month && <ReferenceLine x={data.partial_month.month} stroke="#85847F" strokeDasharray="2 3" />}
            {hasCompare && <Line type="monotone" dataKey="compare" stroke="#D58A52" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} animationDuration={1100} activeDot={{ r: 4, stroke: "#FFF", strokeWidth: 2 }} />}
            <Line type="monotone" dataKey="revenue" stroke="#315C46" strokeWidth={2} dot={{ r: 2.5, fill: "#315C46", strokeWidth: 0 }} activeDot={{ r: 5, stroke: "#FFF", strokeWidth: 2 }} animationDuration={1300} />
          </LineChart>
        </InViewChart>
      </div>
    </>
  );
}

// Rows that glide to their new rank and width when a filter changes.
function RankedBars({ rows }: { rows: { key: string; label: string; value: number; note: string }[] }) {
  const peak = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol>
      {rows.map((row) => (
        <motion.li key={row.key} layout="position" transition={{ duration: 0.6, ease: EASE }} className="border-b border-rule py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[14px] font-medium tracking-[-0.01em]">{row.label}</span>
            <span className="num shrink-0 text-[13px]"><CountUp value={row.value} format={(v) => moneyShort(v)} /></span>
          </div>
          <div className="mt-1.5"><Bar share={row.value / peak} /></div>
          {row.note && <div className="num mt-1 text-[11px] text-muted">{row.note}</div>}
        </motion.li>
      ))}
    </ol>
  );
}

function GrowthChart({ data }: { data: OverviewData }) {
  const { years, quarters } = data.growth;
  const colors = years.map((_, index) => (index === years.length - 1 ? PALETTE[0] : index === years.length - 2 ? PALETTE[1] : "#C9C8BF"));
  return (
    <>
      <div className="mb-3"><Legend items={years.map((year, index) => ({ label: year, color: colors[index] }))} /></div>
      <div className="h-[300px]">
        <InViewChart>
          <BarChart data={quarters} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="quarter" {...AXIS} tickMargin={8} />
            <YAxis width={66} tickFormatter={rupeeAxis} {...AXIS} />
            <Tooltip cursor={{ fill: "rgba(25,25,25,0.05)" }} content={({ active, payload, label }) => active && payload?.length ? (
              <TooltipBox title={label} rows={payload.map((p) => ({ label: String(p.dataKey), value: money(Number(p.value)), color: String(p.fill) }))} />
            ) : null} />
            {years.map((year, index) => <RBar key={year} dataKey={year} fill={colors[index]} maxBarSize={34} animationDuration={1000} animationBegin={index * 120} />)}
          </BarChart>
        </InViewChart>
      </div>
    </>
  );
}

export default function Overview() {
  const { status, dataVersion } = useStatus();
  const [preset, setPreset] = useState("12");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [compare, setCompare] = useState("year");
  const span = useAsync(() => api.span(), [dataVersion]);

  // A newly loaded dataset may cover different dates, so a custom range does not carry over.
  useEffect(() => setCustom(null), [dataVersion]);

  const range = useMemo(() => {
    if (custom) return custom;
    if (!span.data) return null;
    if (preset === "all") return { from: span.data.from, to: span.data.to };
    const months = monthsBetween(span.data.from, span.data.to);
    return { from: months[Math.max(months.length - Number(preset), 0)], to: span.data.to };
  }, [custom, preset, span.data]);

  const result = useAsync(
    () => (range ? api.overview(range.from, range.to, compare) : Promise.resolve(null)),
    [range?.from, range?.to, compare, dataVersion],
  );
  const { data, loading } = result;
  const error = span.error ?? result.error;
  const reload = () => { span.reload(); result.reload(); };

  const allMonths = data ? monthsBetween(data.span.from, data.span.to) : [];
  const prev = data?.previous_kpis;
  const maxProduct = data?.top_products[0]?.revenue ?? 1;
  const partialCompare = data?.comparison && data.comparison.months < data.comparison.expected_months;
  const total = data?.kpis.revenue || 1;

  return (
    <Page>
      <header className="grid grid-cols-12 gap-y-8 pt-10 pb-10 sm:pt-14 sm:pb-16 md:gap-x-8">
        <div className="col-span-12 xl:col-span-9">
          <Eyebrow className="mb-5">Retail intelligence / Overview</Eyebrow>
          <TextLines className="display" lines={["Retail performance,", "decoded."]} delay={0.05} />
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.35 }} className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
            A clearer view of India’s retail economy through data.
          </motion.p>
        </div>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.4 }} className="col-span-12 self-end md:col-span-6 xl:col-span-3">
          <Ledger items={[
            { label: "Active dataset", value: status?.dataset ?? "None" },
            { label: "Reporting period", value: data ? `${monthShort(data.range.from)} – ${monthShort(data.range.to)}` : "—" },
            { label: "Status", value: status?.etl_running ? "ETL running" : status?.dataset ? "Synchronized" : "Not loaded" },
            { label: "Fact rows", value: int(status?.fact_rows) },
            { label: "Last sync", value: dateTime(status?.last_sync) },
          ]} />
        </motion.div>
      </header>

      {data?.data_kind === "synthetic" && (
        <Reveal y={8}>
          <p className="mb-10 border-l-2 border-accent2 bg-card px-3 py-2 text-[13px] leading-snug">
            <strong className="font-semibold">Synthetic demonstration data.</strong> These figures are simulated and do not represent the sales of any real company, or actual market data.
          </p>
        </Reveal>
      )}

      {error && !data ? <ErrorState error={error} onRetry={reload} /> : !data ? <LoadingBlock height={520} /> : (
        <>
          {error && <ErrorState error={error} onRetry={reload} />}
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4 lg:gap-x-8">
            <Metric label="Total revenue" value={data.kpis.revenue} format={(v) => moneyShort(v)} change={change(data.kpis.revenue, prev?.revenue)} previous={prev ? moneyShort(prev.revenue) : undefined} />
            <Metric label="Total orders" value={data.kpis.orders} format={int} change={change(data.kpis.orders, prev?.orders)} previous={prev ? int(prev.orders) : undefined} />
            <Metric label="Unique customers" value={data.kpis.customers} format={int} change={change(data.kpis.customers, prev?.customers)} previous={prev ? int(prev.customers) : undefined} />
            <Metric label="Average order value" value={data.kpis.aov} format={(v) => money(v)} change={change(data.kpis.aov, prev?.aov)} previous={prev ? money(prev.aov) : undefined} />
          </section>

          <RevealSection className="mt-16">
            <SectionHead index="01 / Revenue" title="Monthly revenue trend" />
            <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <span className="eyebrow mb-1 block">Range</span>
                <div className="relative flex" role="group" aria-label="Date range presets">
                  {PRESETS.map((p) => {
                    const on = !custom && preset === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => { setCustom(null); setPreset(p.id); }}
                        aria-pressed={on}
                        className={`num relative -ml-px h-[34px] w-11 border border-rule bg-card text-[12px] transition-colors first:ml-0 ${on ? "text-paper" : "hover:text-accent"}`}
                      >
                        {on && <motion.span layoutId="range-pill" className="absolute inset-0 bg-ink" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                        <span className="relative">{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label="From" className="w-32">
                <Select value={data.range.from} onChange={(e) => setCustom({ from: e.target.value, to: e.target.value > data.range.to ? e.target.value : data.range.to })}>
                  {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </Select>
              </Field>
              <Field label="To" className="w-32">
                <Select value={data.range.to} onChange={(e) => setCustom({ from: e.target.value < data.range.from ? e.target.value : data.range.from, to: e.target.value })}>
                  {allMonths.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </Select>
              </Field>
              <Field label="Compare with" className="w-48">
                <Select value={compare} onChange={(e) => setCompare(e.target.value)}>
                  <option value="previous">Previous period</option>
                  <option value="year">Same period last year</option>
                  <option value="none">No comparison</option>
                </Select>
              </Field>
              <div className="w-40 pb-4"><LoadingBar active={loading} /></div>
            </div>
            {data.compare !== "none" && !data.comparison && (
              <p className="mb-3 text-[13px] text-muted">The dataset has no earlier data to compare this range against. Choose a shorter range to see a comparison.</p>
            )}
            {partialCompare && (
              <p className="mb-3 text-[13px] text-muted">
                The comparison window covers only {data.comparison!.months} of {data.comparison!.expected_months} months, because the dataset starts in {monthLabel(data.span.from)}.
              </p>
            )}
            <RevenueChart data={data} />
          </RevealSection>

          <section className="mt-20 grid grid-cols-12 gap-y-16 md:gap-x-12">
            <RevealSection className="col-span-12 lg:col-span-5">
              <SectionHead index="02 / Cities" title="City-wise revenue" aside={<Link to="/reports?type=cities" className="text-[13px] font-semibold text-accent hover:underline">Report →</Link>} />
              <RankedBars rows={data.cities.map((c) => ({ key: c.city, label: c.city, value: c.revenue, note: `${c.state}, ${c.region} · ${pct(c.revenue / total)}` }))} />
            </RevealSection>
            <RevealSection className="col-span-12 lg:col-span-7" transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}>
              <SectionHead index="03 / Categories" title="Category performance" aside={<Link to="/olap" className="text-[13px] font-semibold text-accent hover:underline">Analyse →</Link>} />
              <RankedBars rows={data.categories.map((c) => ({ key: c.category, label: c.category, value: c.revenue, note: `${pct(c.revenue / total)} of revenue · ${int(c.orders)} orders · ${int(c.quantity)} units` }))} />
            </RevealSection>
          </section>

          <section className="mt-20 grid grid-cols-12 gap-y-16 md:gap-x-12">
            <RevealSection className="col-span-12 lg:col-span-7">
              <SectionHead index="04 / Products" title="Top-performing products" aside={<Link to="/reports?type=products" className="text-[13px] font-semibold text-accent hover:underline">Report →</Link>} />
              <ol>
                {data.top_products.map((product, index) => (
                  <motion.li key={product.id} layout="position" transition={{ duration: 0.55, ease: EASE }} className="grid grid-cols-[28px_1fr_auto] items-baseline gap-x-3 border-b border-rule py-3">
                    <span className="num text-[11px] text-muted">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-medium tracking-[-0.01em]">{titleCase(product.name)}</div>
                      <div className="mt-1.5 max-w-md"><Bar share={product.revenue / maxProduct} /></div>
                    </div>
                    <div className="text-right">
                      <div className="num text-[14px]">{moneyShort(product.revenue)}</div>
                      <div className="num text-[11px] text-muted">{int(product.quantity)} units</div>
                    </div>
                  </motion.li>
                ))}
              </ol>
            </RevealSection>

            <RevealSection className="col-span-12 lg:col-span-5" transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}>
              <SectionHead index="05 / Customers" title="Customer distribution" aside={<Link to="/customers" className="text-[13px] font-semibold text-accent hover:underline">Explore →</Link>} />
              {data.segments.length ? (
                <>
                  <div className="eyebrow mb-2 grid grid-cols-[1fr_72px_72px] gap-2"><span>Segment</span><span className="text-right">Customers</span><span className="text-right">Revenue</span></div>
                  {data.segments.map((segment) => (
                    <div key={segment.segment} className="border-t border-rule py-3">
                      <div className="grid grid-cols-[1fr_72px_72px] items-baseline gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-[14.5px] font-medium tracking-[-0.01em]">
                          <span className="inline-block size-2 shrink-0" style={{ background: segmentColor(segment.segment) }} aria-hidden />
                          <span className="truncate">{segment.segment}</span>
                        </span>
                        <span className="num text-right text-[13px]">{pct(segment.customer_share)}</span>
                        <span className="num text-right text-[13px]">{pct(segment.revenue_share)}</span>
                      </div>
                      <div className="mt-2 flex flex-col gap-[3px]" aria-hidden>
                        <div className="opacity-40"><Bar share={segment.customer_share} color={segmentColor(segment.segment)} /></div>
                        <Bar share={segment.revenue_share} color={segmentColor(segment.segment)} />
                      </div>
                    </div>
                  ))}
                  <p className="mt-3 text-[12px] leading-snug text-muted">Pale bar: share of customers. Solid bar: share of revenue. Full dataset, identified customers only.</p>
                </>
              ) : (
                <div className="py-8">
                  <p className="text-sm text-muted">Segments have not been computed for this warehouse.</p>
                  <Link to="/customers"><Button className="mt-3">Run K-Means</Button></Link>
                </div>
              )}
            </RevealSection>
          </section>

          <RevealSection className="mt-20">
            <SectionHead index="06 / Growth" title="Sales growth comparison" aside={<span className="eyebrow">Revenue by quarter, all years held</span>} />
            <GrowthChart data={data} />
          </RevealSection>

          <section className="mt-20">
            <SectionHead index="07 / Signals" title="Signals & Observations" aside={<span className="eyebrow">Calculated from {monthShort(data.range.from)} – {monthShort(data.range.to)}</span>} />
            <div className="grid grid-cols-1 gap-x-12 md:grid-cols-2">
              {data.signals.map((signal, index) => (
                <motion.article
                  key={signal.topic}
                  initial={{ opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-6% 0px" }}
                  transition={{ duration: 0.7, ease: EASE, delay: (index % 2) * 0.08 }}
                  className="lift grid grid-cols-[28px_1fr] gap-x-3 border-b border-rule py-5"
                >
                  <span className="num pt-1.5 text-[11px] text-muted">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="eyebrow mb-1.5">{signal.topic}</div>
                    <h3 className={`text-[clamp(1.1rem,1.7vw,1.45rem)] leading-[1.22] font-medium tracking-[-0.02em] ${signal.tone === "negative" ? "text-danger" : signal.tone === "positive" ? "text-accent" : ""}`}>
                      {signal.headline}
                    </h3>
                    <p className="num mt-2 text-[12px] leading-relaxed text-muted">{signal.evidence}</p>
                  </div>
                </motion.article>
              ))}
            </div>
          </section>
        </>
      )}
    </Page>
  );
}
