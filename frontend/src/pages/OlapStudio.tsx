import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bar as RBar, BarChart, CartesianGrid, Cell, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, Legend, PALETTE, TooltipBox } from "../components/charts";
import { Button, ErrorState, Eyebrow, Field, LoadingBar, LoadingBlock, Notice, Page } from "../components/ui";
import { Select } from "../components/Select";
import { CountUp, InViewChart, RevealSection, TextLines } from "../motion/primitives";
import { api } from "../services/api";
import { compact, int, money } from "../services/format";
import { useStatus } from "../services/StatusContext";
import type { Measure, Members, OlapResult, OlapRow, OlapState } from "../services/types";
import { useAsync } from "../services/useAsync";

const MEASURES: { id: Measure; label: string }[] = [
  { id: "revenue", label: "Revenue" },
  { id: "quantity", label: "Quantity" },
  { id: "transactions", label: "Transactions" },
  { id: "aov", label: "Average order value" },
];
const DIM_LABEL: Record<string, string> = { time: "Time", product: "Product", geography: "Geography" };
const OP_LABEL: Record<string, string> = {
  roll_up: "Roll-up", drill_down: "Drill-down", slice: "Slice", dice: "Dice", pivot: "Pivot", view: "View", reset: "Reset",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function measureText(measure: Measure, value: number | null | undefined, currency: string, short = false) {
  if (value == null) return "—";
  if (measure === "revenue" || measure === "aov") {
    if (short) return `${currency}${compact(value)}`;
    return money(value, currency);
  }
  return short ? compact(value) : int(value);
}

function filterText(attribute: string, value: string | number) {
  if (attribute === "quarter") return `Q${value}`;
  if (attribute === "month") return MONTH_NAMES[Number(value) - 1];
  return String(value);
}

function CubeChart({ result, currency, onDrill }: { result: OlapResult; currency: string; onDrill: (member: string) => void }) {
  const { state, rows, columns } = result;
  const measure = state.measure;
  const isTime = state.rows.dim === "time";
  const additive = measure !== "aov";

  if (columns.length) {
    // Cross-tab. Up to 7 column members are named; the rest fold into "Other".
    const named = columns.slice(0, 7);
    const shownRows = rows.slice(0, isTime ? 60 : 16);
    const data = shownRows.map((row) => {
      const point: Record<string, number | string> = { member: row.member };
      let used = 0;
      named.forEach((c) => {
        point[c] = row.cells[c] ?? 0;
        used += row.cells[c] ?? 0;
      });
      if (additive) point.Other = Math.max(row.total - used, 0);
      return point;
    });
    const hasOther = additive && data.some((d) => Number(d.Other) > 0.005);
    const series = hasOther ? [...named, "Other"] : named;
    const color = (name: string, index: number) => (name === "Other" ? "#C9C8BF" : PALETTE[index]);
    return (
      <>
        <div className="mb-3"><Legend items={series.map((s, i) => ({ label: s, color: color(s, i) }))} /></div>
        <div className="h-[460px]">
          <InViewChart>
            {additive ? (
              <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="member" {...AXIS} tickMargin={8} interval={isTime ? "preserveStartEnd" : 0} minTickGap={18} tickFormatter={(v: string) => (v.length > 13 ? `${v.slice(0, 12)}…` : v)} />
                <YAxis width={60} {...AXIS} tickFormatter={(v: number) => measureText(measure, v, currency, true)} />
                <Tooltip cursor={{ fill: "rgba(25,25,25,0.05)" }} content={({ active, payload, label }) => active && payload?.length ? (
                  <TooltipBox title={label} rows={[...payload].reverse().map((p) => ({ label: String(p.dataKey), value: measureText(measure, Number(p.value), currency), color: String(p.fill) }))} />
                ) : null} />
                {series.map((s, i) => <RBar key={s} dataKey={s} stackId="cube" fill={color(s, i)} stroke="#F5F4EF" strokeWidth={1} isAnimationActive animationDuration={350} maxBarSize={72} />)}
              </BarChart>
            ) : (
              <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="member" {...AXIS} tickMargin={8} interval={isTime ? "preserveStartEnd" : 0} minTickGap={18} tickFormatter={(v: string) => (v.length > 13 ? `${v.slice(0, 12)}…` : v)} />
                <YAxis width={60} {...AXIS} tickFormatter={(v: number) => measureText(measure, v, currency, true)} />
                <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                  <TooltipBox title={label} rows={payload.map((p) => ({ label: String(p.dataKey), value: measureText(measure, Number(p.value), currency), color: String(p.stroke) }))} />
                ) : null} />
                {series.map((s, i) => <Line key={s} dataKey={s} stroke={color(s, i)} strokeWidth={2} dot={{ r: 2.5 }} animationDuration={350} />)}
              </LineChart>
            )}
          </InViewChart>
        </div>
      </>
    );
  }

  const clickable = result.can_drill_down;
  const onBar = (row: { member?: string }) => {
    if (clickable && row.member) onDrill(row.member);
  };

  if (isTime) {
    const data = rows.slice(-400);
    return (
      <div className="h-[460px]">
        <InViewChart>
          <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="member" {...AXIS} tickMargin={8} minTickGap={22} />
            <YAxis width={60} {...AXIS} tickFormatter={(v: number) => measureText(measure, v, currency, true)} />
            <Tooltip cursor={{ fill: "rgba(25,25,25,0.05)" }} content={({ active, payload }) => active && payload?.length ? (
              <TooltipBox title={payload[0].payload.member} rows={[{ label: cap(measureLabel(measure)), value: measureText(measure, Number(payload[0].value), currency) }]} footer={clickable ? "Click to drill down" : undefined} />
            ) : null} />
            <RBar dataKey="total" fill="#315C46" onClick={onBar} cursor={clickable ? "pointer" : "default"} maxBarSize={80} animationDuration={350} />
          </BarChart>
        </InViewChart>
      </div>
    );
  }

  const data = rows.slice(0, 16);
  return (
    <div style={{ height: Math.max(data.length * 29 + 30, 200) }}>
      <InViewChart>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#DDDDD5" horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(v: number) => measureText(measure, v, currency, true)} />
          <YAxis type="category" dataKey="member" width={190} interval={0} {...AXIS} tick={{ ...AXIS.tick, fill: "#191919" }} tickFormatter={(v: string) => (v.length > 30 ? `${v.slice(0, 29)}…` : v)} />
          <Tooltip cursor={{ fill: "rgba(25,25,25,0.05)" }} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={payload[0].payload.member} rows={[{ label: cap(measureLabel(measure)), value: measureText(measure, Number(payload[0].value), currency) }]} footer={clickable ? "Click to drill down" : undefined} />
          ) : null} />
          <RBar dataKey="total" barSize={15} onClick={onBar} cursor={clickable ? "pointer" : "default"} animationDuration={350}>
            {data.map((d) => <Cell key={d.member} fill="#315C46" />)}
          </RBar>
        </BarChart>
      </InViewChart>
    </div>
  );
}

const measureLabel = (measure: Measure) => MEASURES.find((m) => m.id === measure)!.label;

function ResultTable({ result, currency, onDrill }: { result: OlapResult; currency: string; onDrill: (member: string) => void }) {
  const [limit, setLimit] = useState(50);
  useEffect(() => setLimit(50), [result]);
  const { rows, columns, state, column_totals: totals, grand_total: grand } = result;
  const peak = useMemo(() => Math.max(1, ...rows.flatMap((r: OlapRow) => Object.values(r.cells))), [rows]);
  const label = `${cap(state.rows.level)}`;
  const m = state.measure;
  return (
    <>
      <div className="max-h-[560px] overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{label}{columns.length ? ` / ${cap(state.columns!.level)}` : ""}</th>
              {columns.map((c) => <th key={c} className="right">{c.length > 18 ? `${c.slice(0, 17)}…` : c}</th>)}
              <th className="right">{columns.length ? "Row total" : measureLabel(m)}</th>
              {!columns.length && m !== "aov" && <th className="right">Share</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row) => (
              <tr key={row.member}>
                <td className="max-w-[320px] truncate">
                  {result.can_drill_down ? (
                    <button className="text-left underline decoration-rule underline-offset-2 hover:text-accent hover:decoration-accent" onClick={() => onDrill(row.member)} title={`Drill into ${row.member}`}>
                      {row.member}
                    </button>
                  ) : row.member}
                </td>
                {columns.map((c) => {
                  const value = row.cells[c];
                  // Heat tint on cross-tab cells. The number stays readable on every shade.
                  return (
                    <td key={c} className="right" style={value ? { background: `rgba(49,92,70,${(0.22 * value) / peak})` } : undefined}>
                      {value == null ? <span className="text-rule">·</span> : measureText(m, value, currency)}
                    </td>
                  );
                })}
                <td className="right font-medium">{measureText(m, row.total, currency)}</td>
                {!columns.length && m !== "aov" && <td className="right text-muted">{grand ? `${((row.total / grand) * 100).toFixed(1)}%` : ""}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="sticky bottom-0 bg-paper">
              <td className="border-t border-ink py-2 font-medium">Grand total</td>
              {columns.map((c) => <td key={c} className="right border-t border-ink py-2 font-medium">{measureText(m, totals[c], currency)}</td>)}
              <td className="right border-t border-ink py-2 font-medium">{measureText(m, grand, currency)}</td>
              {!columns.length && m !== "aov" && <td className="border-t border-ink" />}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <span className="num text-xs text-muted">
          {int(Math.min(limit, rows.length))} of {int(result.total_rows)} rows
          {result.total_columns > columns.length && columns.length > 0 ? ` · top ${columns.length} of ${result.total_columns} columns` : ""}
        </span>
        {limit < rows.length && <Button variant="quiet" onClick={() => setLimit((l) => l + 100)}>Show more rows</Button>}
      </div>
    </>
  );
}

function OpButton({ title, description, onClick, disabled }: { title: string; description: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="lift group flex-1 border border-rule bg-card px-2.5 py-2 text-left transition-colors hover:border-ink disabled:opacity-40 disabled:hover:border-rule"
    >
      <span className="block text-[13px] font-semibold tracking-[-0.01em]">{title}</span>
      <span className="num mt-0.5 block text-[10.5px] leading-tight text-muted">{description}</span>
    </button>
  );
}

function PanelSection({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-rule py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold tracking-[-0.01em]">{title}</h3>
        <span className="num truncate text-[10.5px] text-muted">{hint}</span>
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

export default function OlapStudio() {
  const location = useLocation();
  const { status, dataVersion } = useStatus();
  const currency = status?.currency ?? "₹";
  const members = useAsync(() => api.olapMembers(), [dataVersion]);

  const [result, setResult] = useState<OlapResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<(Error & { code?: string }) | null>(null);
  const [opMessage, setOpMessage] = useState<string | null>(null);
  const [log, setLog] = useState<{ operation: string; text: string; state: OlapState }[]>([]);
  const [showSql, setShowSql] = useState(false);
  const stateRef = useRef<OlapState | null>(null);
  const handledNav = useRef<unknown>(null);

  // Local panel inputs.
  const [sliceAttr, setSliceAttr] = useState("year");
  const [sliceValue, setSliceValue] = useState("");
  const [dice, setDice] = useState<Record<string, string>>({});

  const execute = useCallback(async (operation: string, args?: Record<string, unknown>, text?: string, baseState?: OlapState | null) => {
    setBusy(true);
    try {
      const next = await api.olap(operation, baseState === undefined ? stateRef.current : baseState, args);
      stateRef.current = next.state;
      setResult(next);
      setFailure(null);
      setOpMessage(null);
      if (operation !== "view" || text) {
        setLog((entries) => [...entries.slice(-11), { operation, text: text ?? OP_LABEL[operation], state: next.state }]);
      }
    } catch (error) {
      const reason = error as Error & { code?: string };
      if (reason.code === "warehouse_empty" || !stateRef.current) setFailure(reason);
      else setOpMessage(reason.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    execute("view", {}, undefined, stateRef.current);
  }, [execute, dataVersion]);

  // Commands sent from the palette.
  useEffect(() => {
    const nav = location.state as { operation?: string; at?: number } | null;
    if (nav?.operation && nav.at !== handledNav.current && result) {
      handledNav.current = nav.at;
      execute(nav.operation);
    }
  }, [location.state, execute, result]);

  const m: Members | null = members.data;
  const state = result?.state;
  const hierarchies = m?.hierarchies ?? { time: [], product: [], geography: [] };

  const drill = (member: string) => execute("drill_down", { member }, `Drill-down into ${member}`);

  const sliceOptions = (attribute: string): (string | number)[] => {
    if (!m) return [];
    return (m as unknown as Record<string, (string | number)[]>)[attribute] ?? [];
  };

  const applyDice = () => {
    const filters: Record<string, (string | number)[]> = {};
    Object.entries(dice).forEach(([attribute, value]) => {
      if (value) filters[attribute] = [value];
    });
    const text = Object.entries(filters).map(([a, v]) => `${cap(a)} = ${filterText(a, v[0])}`).join(", ");
    execute("dice", { filters }, `Dice: ${text}`);
  };

  const setAxis = (axis: "rows" | "columns", dim: string, level?: string) => {
    if (axis === "columns" && !dim) {
      execute("view", { columns: null });
      return;
    }
    if (!state) return;
    const spec = { dim, level: level ?? hierarchies[dim][0] };
    if (axis === "rows") {
      // Two axes cannot share a dimension, so the column axis moves out of the way.
      const columns = state.columns?.dim === dim ? null : state.columns;
      execute("view", { rows: spec, columns });
    } else {
      execute("view", { columns: spec });
    }
  };

  if (failure) {
    return <Page><div className="pt-14"><ErrorState error={failure} onRetry={() => execute("view", {}, undefined, null)} /></div></Page>;
  }

  const filters = state ? Object.entries(state.filters) : [];

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-8 pb-6">
        <div>
          <Eyebrow className="mb-3">Analytical processing / OLAP Studio</Eyebrow>
          <TextLines className="text-[clamp(2.25rem,5vw,4.5rem)] leading-none font-medium tracking-[-0.04em]" lines={["Turn the cube."]} />
        </div>
        {result && (
          <div className="text-right">
            <Eyebrow>{state && measureLabel(state.measure)}, current view</Eyebrow>
            <CountUp value={result.grand_total ?? 0} format={(v) => measureText(result.state.measure, v, currency)} className="num mt-1 block text-[clamp(1.5rem,3vw,2.5rem)] leading-none tracking-[-0.03em]" />
          </div>
        )}
      </header>

      {/* Top: dimension selectors */}
      <RevealSection aria-label="Dimensions" className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-ink py-3 md:grid-cols-5">
        <Field label="Measure" className="col-span-2 md:col-span-1">
          <Select className="" value={state?.measure ?? "revenue"} onChange={(e) => execute("view", { measure: e.target.value })}>
            {MEASURES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </Select>
        </Field>
        <Field label="Rows">
          <Select className="" value={state?.rows.dim ?? "time"} onChange={(e) => setAxis("rows", e.target.value)}>
            {Object.keys(hierarchies).map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
          </Select>
        </Field>
        <Field label="Row level">
          <Select className="" value={state?.rows.level ?? "month"} onChange={(e) => setAxis("rows", state!.rows.dim, e.target.value)}>
            {(hierarchies[state?.rows.dim ?? "time"] ?? []).map((l) => <option key={l} value={l}>{cap(l)}</option>)}
          </Select>
        </Field>
        <Field label="Columns">
          <Select className="" value={state?.columns?.dim ?? ""} onChange={(e) => setAxis("columns", e.target.value)}>
            <option value="">None</option>
            {Object.keys(hierarchies).filter((d) => d !== state?.rows.dim).map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
          </Select>
        </Field>
        <Field label="Column level">
          <Select className="" disabled={!state?.columns} value={state?.columns?.level ?? ""} onChange={(e) => setAxis("columns", state!.columns!.dim, e.target.value)}>
            {!state?.columns && <option value="">—</option>}
            {state?.columns && hierarchies[state.columns.dim].map((l) => <option key={l} value={l}>{cap(l)}</option>)}
          </Select>
        </Field>
      </RevealSection>
      <LoadingBar active={busy} />

      <div className="grid grid-cols-12 md:gap-x-10 gap-y-8 pt-5">
        {/* Centre: visualization */}
        <RevealSection className="col-span-12 min-w-0 xl:col-span-9" aria-label="Cube visualization">
          <div className="mb-4 flex min-h-7 flex-wrap items-center gap-2">
            <span className="eyebrow">Filters</span>
            {filters.length === 0 && <span className="num text-[12px] text-muted">None: the whole cube</span>}
            {filters.flatMap(([attribute, values]) => values.map((value) => (
              <button
                key={`${attribute}-${value}`}
                onClick={() => {
                  const remaining = { ...state!.filters };
                  remaining[attribute] = remaining[attribute].filter((v) => v !== value);
                  if (!remaining[attribute].length) delete remaining[attribute];
                  execute("view", { filters: remaining });
                }}
                className="num flex h-6 items-center gap-1.5 border border-accent bg-accent/8 px-2 text-[11.5px] text-accent transition-colors hover:bg-accent hover:text-paper"
                title="Remove this filter"
              >
                {cap(attribute)} = {filterText(attribute, value)} <span aria-hidden>×</span>
              </button>
            )))}
          </div>
          {opMessage && <div className="mb-3"><Notice tone="info" onDismiss={() => setOpMessage(null)}>{opMessage}</Notice></div>}
          {!result ? <LoadingBlock height={460} /> : result.rows.length === 0 ? (
            <div className="flex h-[460px] flex-col justify-center border-y border-rule text-center">
              <h3 className="text-xl font-medium tracking-tight">No sales match these filters</h3>
              <p className="mt-2 text-sm text-muted">This combination of dimension members is empty in the warehouse.</p>
              <div className="mt-4"><Button onClick={() => execute("view", { filters: {} }, "Filters cleared")}>Clear filters</Button></div>
            </div>
          ) : (
            <CubeChart result={result} currency={currency} onDrill={drill} />
          )}
        </RevealSection>

        {/* Right: operations */}
        <aside className="col-span-12 xl:col-span-3" aria-label="OLAP operations">
          <div className="flex gap-1.5 pb-3.5">
            <OpButton title="Roll-up" description="Coarser level" disabled={!result?.can_roll_up || busy} onClick={() => execute("roll_up")} />
            <OpButton title="Drill-down" description="Finer level" disabled={!result?.can_drill_down || busy} onClick={() => execute("drill_down")} />
          </div>
          <PanelSection title="Slice" hint="One dimension">
            <div className="grid grid-cols-2 gap-1.5">
              <Select className="" aria-label="Slice attribute" value={sliceAttr} onChange={(e) => { setSliceAttr(e.target.value); setSliceValue(""); }}>
                {["year", "quarter", "month", "category", "region", "state", "city"].map((a) => <option key={a} value={a}>{cap(a)}</option>)}
              </Select>
              <Select className="" aria-label="Slice value" value={sliceValue} onChange={(e) => setSliceValue(e.target.value)}>
                <option value="">Value</option>
                {sliceOptions(sliceAttr).map((v) => <option key={v} value={v}>{filterText(sliceAttr, v)}</option>)}
              </Select>
            </div>
            <Button className="mt-1.5 w-full" disabled={!sliceValue || busy} onClick={() => execute("slice", { attribute: sliceAttr, value: sliceValue }, `Slice: ${cap(sliceAttr)} = ${filterText(sliceAttr, sliceValue)}`)}>
              Apply slice
            </Button>
          </PanelSection>
          <PanelSection title="Dice" hint="Two or more dimensions">
            <div className="grid grid-cols-2 gap-1.5">
              {["year", "quarter", "category", "region", "state", "city"].map((attribute) => (
                <Select
                  key={attribute}
                  className=""
                  aria-label={`Dice ${attribute}`}
                  value={dice[attribute] ?? ""}
                  onChange={(e) => setDice((d) => ({ ...d, [attribute]: e.target.value }))}
                >
                  <option value="">{cap(attribute)}: any</option>
                  {sliceOptions(attribute).map((v) => <option key={v} value={v}>{filterText(attribute, v)}</option>)}
                </Select>
              ))}
            </div>
            <Button className="mt-1.5 w-full" disabled={busy || !Object.values(dice).some(Boolean)} onClick={applyDice}>Apply dice</Button>
          </PanelSection>
          <PanelSection title="Pivot" hint="Rotate the perspective">
            <div className="grid grid-cols-3 gap-1.5">
              {Object.keys(hierarchies).map((d) => (
                <Button key={d} variant="quiet" className="!px-1 text-[11.5px]" disabled={busy || state?.rows.dim === d} onClick={() => execute("pivot", { rows: d }, `Pivot: rows to ${DIM_LABEL[d]}`)}>
                  {DIM_LABEL[d]}
                </Button>
              ))}
            </div>
            <Button className="mt-1.5 w-full" disabled={busy} onClick={() => execute("pivot", {}, state?.columns ? "Pivot: swap axes" : "Pivot: add column axis")}>
              {state?.columns ? "Swap rows and columns" : "Add column axis"}
            </Button>
          </PanelSection>
          <div className="flex gap-1.5 border-t border-rule pt-3.5">
            <Button variant="quiet" className="flex-1" disabled={log.length < 2 || busy} onClick={() => {
              const earlier = log[log.length - 2];
              setLog((entries) => entries.slice(0, -1));
              stateRef.current = earlier.state;
              execute("view", {}, undefined, earlier.state);
            }}>Undo</Button>
            <Button variant="quiet" className="flex-1" disabled={busy} onClick={() => { setDice({}); setSliceValue(""); execute("reset", {}, "Reset"); }}>Reset</Button>
          </div>
        </aside>
      </div>

      {/* Bottom: detail table */}
      {result && result.rows.length > 0 && (
        <RevealSection className="mt-10 border-t border-ink pt-3" aria-label="Analytical result">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Analytical result</h2>
            <div className="num flex flex-wrap items-center gap-x-4 text-[11.5px] text-muted">
              <span>{result.elapsed_ms} ms on MySQL</span>
              <button className="text-ink underline underline-offset-2 hover:text-accent" onClick={() => setShowSql((v) => !v)} aria-expanded={showSql}>
                {showSql ? "Hide SQL" : "Show executed SQL"}
              </button>
            </div>
          </div>
          {showSql && (
            <div className="mb-4 space-y-2">
              {result.sql.map((sql, index) => (
                <pre key={index} className="overflow-x-auto border border-rule bg-card p-3 font-mono text-[11.5px] leading-relaxed">{sql}</pre>
              ))}
            </div>
          )}
          <ResultTable result={result} currency={currency} onDrill={drill} />
        </RevealSection>
      )}

      {log.length > 0 && (
        <RevealSection className="mt-8" aria-label="Operation history">
          <Eyebrow className="mb-2">Operation history</Eyebrow>
          <ol className="num flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
            {log.map((entry, index) => (
              <li key={index} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted" aria-hidden>→</span>}
                <span className={index === log.length - 1 ? "text-ink" : "text-muted"}>{entry.text}</span>
              </li>
            ))}
          </ol>
        </RevealSection>
      )}
    </Page>
  );
}
