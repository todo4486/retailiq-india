import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { PipelineFlow } from "../components/PipelineFlow";
import { Select } from "../components/Select";
import { Button, Eyebrow, ErrorState, Field, LoadingBlock, Notice, Page, PageHero, Pagination, SectionHead, SortHeader } from "../components/ui";
import { CountUp, EASE, RevealSection } from "../motion/primitives";
import { api } from "../services/api";
import { dateTime, fileSize, int, money } from "../services/format";
import { useStatus } from "../services/StatusContext";
import type { EtlRun, SchemaTable, StageBase } from "../services/types";
import { useAsync } from "../services/useAsync";

// ------------------------------------------------------------------ ETL pipeline

const STATUS_TEXT: Record<string, string> = { pending: "Waiting", running: "Running", done: "Complete", failed: "Failed" };

function StageBlock({ index, name, description, stage, progress }: { index: string; name: string; description: string; stage?: StageBase; progress?: number }) {
  const status = stage?.status ?? "pending";
  const active = status === "running";
  const barColor = status === "failed" ? "bg-danger" : "bg-accent";
  const fraction = status === "pending" ? 0 : status === "done" ? 1 : progress ?? 0;
  return (
    <div className="lift min-w-0 flex-1">
      <div className="h-0.5 w-full overflow-hidden bg-rule">
        {active && progress == null ? (
          <div className="loading-bar h-0.5 w-1/4 bg-accent" />
        ) : (
          <motion.div className={`h-0.5 origin-left ${barColor}`} initial={false} animate={{ scaleX: fraction }} transition={{ duration: 0.35, ease: "easeOut" }} />
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 pt-2">
        <Eyebrow>{index}</Eyebrow>
        <span className={`num flex items-center gap-1.5 text-[11px] ${status === "failed" ? "text-danger" : status === "done" ? "text-accent" : status === "running" ? "text-accent2" : "text-muted"}`}>
          {active && <span className="pulse-dot inline-block size-1.5 bg-accent2" aria-hidden />}
          {STATUS_TEXT[status]}
        </span>
      </div>
      <h3 className="mt-3 text-[clamp(1.5rem,3vw,2.75rem)] leading-none font-medium tracking-[-0.035em]">{name}</h3>
      <p className="mt-2 text-[13px] leading-snug text-muted">{description}</p>
      <CountUp value={stage?.records ?? 0} format={int} className="num mt-4 block text-[clamp(1.25rem,2.2vw,1.9rem)] leading-none tracking-[-0.03em]" />
      <div className="eyebrow mt-1">records processed{stage?.seconds != null ? ` · ${stage.seconds}s` : ""}</div>
      {stage?.detail && <p className={`mt-3 text-[12.5px] leading-snug ${status === "failed" ? "text-danger" : "text-ink"}`}>{stage.detail}</p>}
    </div>
  );
}

function Arrow() {
  return <div className="num hidden shrink-0 pt-14 text-2xl text-muted lg:block" aria-hidden>→</div>;
}

function RejectedLedger({ run }: { run: EtlRun }) {
  const steps = run.stages.transform.steps;
  const rejected = steps.reduce((sum, step) => sum + step.removed, 0);
  const source = steps[0]?.rows_in ?? run.stages.extract.records ?? 0;
  const kept = steps.length ? steps[steps.length - 1].rows_out : 0;
  if (!steps.length) return null;
  return (
    <div className="mt-8 grid grid-cols-3 gap-x-6 border-y border-rule py-4">
      <div><Eyebrow>Source rows</Eyebrow><CountUp value={source} format={int} className="num mt-1 block text-[clamp(1.1rem,2.2vw,1.8rem)] tracking-[-0.03em]" /></div>
      <div><Eyebrow>Moved forward</Eyebrow><CountUp value={kept} format={int} className="num mt-1 block text-[clamp(1.1rem,2.2vw,1.8rem)] tracking-[-0.03em] text-accent" /></div>
      <div><Eyebrow>Rejected</Eyebrow><CountUp value={rejected} format={int} className="num mt-1 block text-[clamp(1.1rem,2.2vw,1.8rem)] tracking-[-0.03em] text-accent2" /></div>
    </div>
  );
}

function TransformLedger({ run }: { run: EtlRun }) {
  const steps = run.stages.transform.steps;
  if (!steps.length) return null;
  const start = steps[0].rows_in || 1;
  return (
    <div className="mt-10">
      <Eyebrow className="mb-2">Transform ledger: what each step did to the data</Eyebrow>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>#</th><th>Step</th><th>Detail</th><th className="right">Rows in</th><th className="right">Removed</th><th className="right">Rows out</th></tr></thead>
          <tbody>
            {steps.map((step, index) => (
              <tr key={step.name}>
                <td className="text-muted">{String(index + 1).padStart(2, "0")}</td>
                <td className="!font-sans !text-[13px] font-medium whitespace-nowrap">{step.name}</td>
                <td className="min-w-[280px] !font-sans !text-[12.5px] text-muted">{step.detail}</td>
                <td className="right">{int(step.rows_in)}</td>
                <td className={`right ${step.removed ? "text-accent2" : "text-muted"}`}>{step.removed ? `−${int(step.removed)}` : "0"}</td>
                <td className="right">
                  {int(step.rows_out)}
                  <div className="mt-1 ml-auto h-0.5 w-24 bg-rule">
                    <motion.div className="h-0.5 origin-left bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: step.rows_out / start }} transition={{ duration: 0.7, ease: EASE }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LoadSummary({ run }: { run: EtlRun }) {
  const report = run.stages.load.report;
  if (!report) return null;
  const matched = Math.abs(report.revenue_source - report.revenue_warehouse) < 0.01;
  return (
    <div className="mt-10 grid grid-cols-12 gap-y-6 md:gap-x-10">
      <div className="col-span-12 md:col-span-6">
        <Eyebrow className="mb-2">Rows loaded into MySQL</Eyebrow>
        <table className="data-table">
          <tbody>
            {Object.entries(report.tables).map(([table, count]) => (
              <tr key={table}><td>{table}</td><td className="right">{int(count)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="col-span-12 md:col-span-6">
        <Eyebrow className="mb-2">Reconciliation inside the load transaction</Eyebrow>
        <table className="data-table">
          <tbody>
            <tr><td>Revenue after Transform</td><td className="right">{money(report.revenue_source, "₹", 2)}</td></tr>
            <tr><td>SUM(Revenue) in FACT_SALES</td><td className="right">{money(report.revenue_warehouse, "₹", 2)}</td></tr>
            <tr><td>Fact rows with a missing dimension</td><td className="right">{int(report.orphan_rows)}</td></tr>
            <tr><td>Result</td><td className={`right ${matched ? "text-accent" : "text-danger"}`}>{matched && !report.orphan_rows ? "Reconciled" : "Mismatch"}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Pipeline() {
  const { status, refresh } = useStatus();
  const datasets = useAsync(() => api.datasets(), []);
  const history = useAsync(() => api.etlHistory(), []);
  const [selected, setSelected] = useState<string>("");
  const [run, setRun] = useState<EtlRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [incoming, setIncoming] = useState<{ name: string; size: number; progress: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const polling = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const latest = history.data?.[0];
  const datasetId = selected || status?.dataset_id || datasets.data?.[0]?.id || "";

  const follow = (runId: number) => {
    if (polling.current) window.clearInterval(polling.current);
    const poll = () => {
      api.etlRun(runId).then((next) => {
        setRun(next);
        if (next.status !== "running" && polling.current) {
          window.clearInterval(polling.current);
          polling.current = null;
          refresh();
          history.reload();
        }
      }).catch((e: Error) => setError(e.message));
    };
    poll();
    polling.current = window.setInterval(poll, 400);
  };

  // Follow a run already in progress, started from another page or the command palette.
  useEffect(() => {
    if (status?.running_run_id && (!run || run.run_id !== status.running_run_id) && !polling.current) {
      follow(status.running_run_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.running_run_id]);

  useEffect(() => () => { if (polling.current) window.clearInterval(polling.current); }, []);

  const shown = run ?? latest ?? null;
  const running = shown?.status === "running" || status?.etl_running;

  const startFor = (id: string) => {
    setStarting(true);
    setError(null);
    return api.startEtl(id)
      .then((res) => { refresh(); follow(res.run_id); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStarting(false));
  };

  // A CSV dropped here enters the Extract stage: a real upload, then a real ETL run.
  const acceptFile = (file?: File | null) => {
    if (!file || running) return;
    setError(null);
    setRun(null);
    setIncoming({ name: file.name, size: file.size, progress: 0 });
    api.upload(file, (fraction) => setIncoming((current) => current && { ...current, progress: fraction }))
      .then(async (meta) => {
        await datasets.reload();
        setSelected(meta.id);
        const required = ["invoice", "quantity", "date", "unit_price"];
        const missing = required.filter((role) => !meta.roles[role]);
        if (missing.length || (!meta.roles.stock_code && !meta.roles.description)) {
          setError(`“${file.name}” was uploaded, but its columns could not all be matched. Map them in Data Explorer, then run ETL.`);
          return;
        }
        await startFor(meta.id);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setIncoming(null));
  };

  return (
    <section>
      <SectionHead
        index="01 / Pipeline"
        title="Extract → Transform → Load"
        aside={
          <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
            <Field label="Dataset" className="min-w-56 flex-1">
              <Select value={datasetId} disabled={Boolean(running)} onChange={(e) => setSelected(e.target.value)}>
                {datasets.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Button variant="primary" busy={starting || Boolean(running)} disabled={!datasetId} onClick={() => startFor(datasetId)}>
              {running ? "ETL running" : "Run ETL"}
            </Button>
          </div>
        }
      />
      {error && <div className="mb-4"><Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice></div>}
      {shown && !run && (
        <p className="num mb-4 text-[12px] text-muted">
          Showing run #{shown.run_id}, {shown.dataset_name}, finished {dateTime(shown.finished_at)}.
        </p>
      )}
      <AnimatePresence>
        {shown?.status === "success" && run && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-4">
            <Notice tone="success">ETL finished. The warehouse and mining marts now reflect {shown.dataset_name}.</Notice>
          </motion.div>
        )}
      </AnimatePresence>
      {shown?.status === "partial" && <div className="mb-4"><Notice tone="error">The warehouse loaded, but refreshing the mining marts failed: {shown.error}</Notice></div>}
      {shown?.status === "failed" && <div className="mb-4"><Notice tone="error">ETL failed and MySQL rolled back, so the previous warehouse is intact. {shown.error}</Notice></div>}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files[0]); }}
        className={`relative mb-6 border bg-card px-3 pt-2 pb-1 transition-colors ${dragging ? "border-accent" : "border-rule"}`}
      >
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
          <AnimatePresence mode="wait">
            {incoming ? (
              // The file travels into the Extract stage as its bytes really arrive.
              <motion.div key="incoming" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }} transition={{ duration: 0.4, ease: EASE }} className="flex min-w-0 items-center gap-3">
                <span className="num truncate border border-ink bg-paper px-2 py-1 text-[11.5px]">{incoming.name} · {fileSize(incoming.size)}</span>
                <span className="num text-[11.5px] text-muted">{incoming.progress < 1 ? `Uploading ${Math.round(incoming.progress * 100)}%` : "Reading the file"}</span>
              </motion.div>
            ) : shown ? (
              <motion.span key="current" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }} transition={{ duration: 0.4, ease: EASE }} className="num truncate text-[11.5px] text-muted">
                {shown.status === "running" ? "Processing" : "Last run"}: {shown.dataset_name}
              </motion.span>
            ) : <span key="none" className="num text-[11.5px] text-muted">No run yet</span>}
          </AnimatePresence>
          <button onClick={() => fileInput.current?.click()} disabled={Boolean(running) || Boolean(incoming)} className="num text-[11.5px] text-accent underline underline-offset-2 disabled:text-muted disabled:no-underline">
            Drop a CSV here, or click to upload and process it
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" aria-label="CSV file for ETL" onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <PipelineFlow run={shown} />
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-6">
        <StageBlock index="Stage 1" name="Extract" description="Read the CSV with Pandas, as text, in chunks." stage={shown?.stages.extract}
          progress={shown?.stages.extract.status === "running" && shown.stages.extract.total ? (shown.stages.extract.records ?? 0) / shown.stages.extract.total : undefined} />
        <Arrow />
        <StageBlock index="Stage 2" name="Transform" description="Deduplicate, standardise, validate, calculate revenue, assign keys." stage={shown?.stages.transform}
          progress={shown?.stages.transform.status === "running" ? shown.stages.transform.steps.length / 10 : undefined} />
        <Arrow />
        <StageBlock index="Stage 3" name="Load" description="Write the star schema to MySQL in one transaction, then reconcile." stage={shown?.stages.load} progress={shown?.stages.load.status === "running" ? shown.stages.load.progress : undefined} />
      </div>

      {shown && <RejectedLedger run={shown} />}

      {shown && shown.stages.marts.status !== "pending" && (
        <p className={`num mt-4 text-[12px] ${shown.stages.marts.status === "failed" ? "text-danger" : "text-muted"}`}>
          Mining marts: {shown.stages.marts.status === "running" ? "recomputing K-Means and Apriori on the new warehouse" : shown.stages.marts.detail}
        </p>
      )}
      {!shown && !history.loading && (
        <p className="mt-8 border-t border-rule pt-4 text-[14px] text-muted">No ETL run has happened yet. Choose a dataset and run the pipeline to populate the warehouse.</p>
      )}
      {shown && <TransformLedger run={shown} />}
      {shown && <LoadSummary run={shown} />}

      {history.data && history.data.length > 1 && (
        <div className="mt-10">
          <Eyebrow className="mb-2">Run history</Eyebrow>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Run</th><th>Dataset</th><th>Status</th><th>Started</th><th>Finished</th><th className="right">Fact rows</th></tr></thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.run_id}>
                    <td>#{h.run_id}</td>
                    <td>{h.dataset_name}</td>
                    <td className={h.status === "success" ? "text-accent" : h.status === "running" ? "text-accent2" : "text-danger"}>{h.status}</td>
                    <td>{dateTime(h.started_at)}</td>
                    <td>{dateTime(h.finished_at)}</td>
                    <td className="right">{h.stages.load.report ? int(h.stages.load.report.tables.FACT_SALES) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ star schema

const BOX_W = 232;
const ROW_H = 21;
const HEAD_H = 40;
const POSITIONS: Record<string, { x: number; y: number }> = {
  DIM_CUSTOMER: { x: 18, y: 14 },
  DIM_PRODUCT: { x: 650, y: 14 },
  DIM_DATE: { x: 18, y: 368 },
  DIM_GEOGRAPHY: { x: 650, y: 368 },
  FACT_SALES: { x: 334, y: 150 },
};

function TableBox({ table, selected, highlighted, dimmed, order, onSelect, onHover }: {
  table: SchemaTable; selected: boolean; highlighted: boolean; dimmed: boolean; order: number; onSelect: () => void; onHover: (name: string | null) => void;
}) {
  const { x, y } = POSITIONS[table.name];
  const height = HEAD_H + table.columns.length * ROW_H + 6;
  const isFact = table.kind === "fact";
  return (
    <g transform={`translate(${x},${y})`}>
      <motion.g
        role="button"
        tabIndex={0}
        aria-label={`Inspect table ${table.name}`}
        aria-pressed={selected}
        className="cursor-pointer outline-none"
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
        onMouseEnter={() => onHover(table.name)}
        onMouseLeave={() => onHover(null)}
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        animate={{ opacity: dimmed ? 0.35 : 1 }}
        whileHover={{ y: -3 }}
        transition={{ duration: 0.5, ease: EASE, delay: isFact ? 0 : 0.15 + order * 0.08 }}
      >
        <rect width={BOX_W} height={height} fill="#FFFFFF" stroke={selected || highlighted ? "#191919" : "#DDDDD5"} strokeWidth={selected ? 2 : 1} style={{ transition: "stroke 150ms" }} />
        <rect width={BOX_W} height={HEAD_H} fill={isFact ? "#315C46" : selected ? "#191919" : "#F5F4EF"} style={{ transition: "fill 150ms" }} />
        <text x={12} y={18} fontSize={13} fontWeight={700} fontFamily="Manrope Variable" fill={isFact || selected ? "#F5F4EF" : "#191919"} letterSpacing="-0.01em">{table.name}</text>
        <text x={12} y={32} fontSize={10} fontFamily="IBM Plex Mono" fill={isFact || selected ? "#F5F4EF" : "#85847F"} opacity={0.85}>{isFact ? "fact" : "dimension"} · {int(table.rows)} rows</text>
        {table.columns.map((column, index) => (
          <g key={column.name} transform={`translate(0,${HEAD_H + index * ROW_H + 15})`}>
            <text x={12} fontSize={11.5} fontFamily="IBM Plex Mono" fill={column.primary ? "#191919" : column.foreign ? "#315C46" : "#85847F"} fontWeight={column.primary ? 500 : 400}>{column.name}</text>
            {(column.primary || column.foreign) && (
              <text x={BOX_W - 12} textAnchor="end" fontSize={9.5} fontFamily="IBM Plex Mono" fill={column.primary ? "#D58A52" : "#315C46"}>{column.primary ? "PK" : "FK"}</text>
            )}
          </g>
        ))}
      </motion.g>
    </g>
  );
}

function StarSchema() {
  const { dataVersion } = useStatus();
  const schema = useAsync(() => api.schema(), [dataVersion]);
  const [selected, setSelected] = useState("FACT_SALES");
  const [hover, setHover] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const [dir, setDir] = useState("asc");
  useEffect(() => { setPage(1); setSort(undefined); setDir("asc"); }, [selected]);
  const detail = useAsync(() => api.table(selected, page, sort, dir), [selected, page, sort, dir, dataVersion]);

  if (schema.error) return <ErrorState error={schema.error} onRetry={schema.reload} />;
  if (!schema.data) return <LoadingBlock label="Reading the schema from MySQL" />;

  const tables = schema.data.tables;
  const fact = tables.find((t) => t.kind === "fact")!;
  const factX = POSITIONS.FACT_SALES.x;
  const factY = POSITIONS.FACT_SALES.y;
  const links = fact.columns.filter((c) => c.foreign).map((column) => {
    const rowIndex = fact.columns.indexOf(column);
    const target = POSITIONS[column.foreign!.table];
    const targetTable = tables.find((t) => t.name === column.foreign!.table)!;
    const pkIndex = targetTable.columns.findIndex((c) => c.primary);
    const leftSide = target.x < factX;
    const fromX = leftSide ? factX : factX + BOX_W;
    const fromY = factY + HEAD_H + rowIndex * ROW_H + 11;
    const toX = leftSide ? target.x + BOX_W : target.x;
    const toY = target.y + HEAD_H + pkIndex * ROW_H + 11;
    const mid = (fromX + toX) / 2;
    return { table: column.foreign!.table, column: column.name, path: `M${fromX},${fromY} C${mid},${fromY} ${mid},${toY} ${toX},${toY}`, fromX, fromY, toX, toY, leftSide };
  });
  const focus = hover ?? selected;
  const isLinked = (table: string) => focus === "FACT_SALES" || table === focus;
  const selectedMeta = tables.find((t) => t.name === selected)!;
  const hoverMeta = hover ? tables.find((t) => t.name === hover) : null;

  const toggleSort = (column: string) => {
    if (sort === column) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(column); setDir("asc"); }
    setPage(1);
  };

  return (
    <div className="grid grid-cols-12 gap-y-8 md:gap-x-10">
      <div className="relative col-span-12 min-w-0 xl:col-span-7">
        <div className="overflow-x-auto">
          <svg viewBox="0 0 900 590" className="w-full min-w-[680px]" role="group" aria-label="Star schema: FACT_SALES connected to four dimension tables">
            {links.map((link, index) => {
              const on = isLinked(link.table);
              const strong = on && focus !== "FACT_SALES";
              return (
                <g key={link.column} opacity={on ? 1 : 0.25} style={{ transition: "opacity 150ms" }}>
                  <motion.path
                    d={link.path}
                    fill="none"
                    stroke={strong ? "#191919" : "#315C46"}
                    strokeWidth={strong ? 2 : 1.25}
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, ease: EASE, delay: 0.25 + index * 0.1 }}
                  />
                  {/* A moving dash shows the highlighted relationship. */}
                  {strong && <path d={link.path} fill="none" stroke="#D58A52" strokeWidth={2} className="dash-flow" />}
                  {/* Crow's foot on the many side (fact), single bar on the one side (dimension). */}
                  <g stroke="#315C46" strokeWidth={1.25}>
                    <line x1={link.fromX} y1={link.fromY} x2={link.fromX + (link.leftSide ? -9 : 9)} y2={link.fromY - 5} />
                    <line x1={link.fromX} y1={link.fromY} x2={link.fromX + (link.leftSide ? -9 : 9)} y2={link.fromY + 5} />
                    <line x1={link.toX + (link.leftSide ? 6 : -6)} y1={link.toY - 5} x2={link.toX + (link.leftSide ? 6 : -6)} y2={link.toY + 5} />
                  </g>
                </g>
              );
            })}
            {tables.map((table, index) => (
              <TableBox
                key={table.name}
                table={table}
                order={index}
                selected={selected === table.name}
                highlighted={focus === table.name}
                dimmed={Boolean(hover) && hover !== table.name && hover !== "FACT_SALES" && table.kind !== "fact"}
                onSelect={() => setSelected(table.name)}
                onHover={setHover}
              />
            ))}
          </svg>
        </div>
        <AnimatePresence>
          {hoverMeta && (
            <motion.div
              key={hoverMeta.name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="pointer-events-none absolute top-2 left-1/2 z-10 hidden w-64 -translate-x-1/2 border border-ink bg-card p-2.5 md:block"
            >
              <div className="eyebrow !text-ink">{hoverMeta.name}</div>
              <div className="num mt-1 text-[11px] text-muted">{int(hoverMeta.rows)} rows · {hoverMeta.columns.length} columns</div>
              <div className="num mt-1 text-[11px]">
                {hoverMeta.kind === "fact"
                  ? `Measures one sale line. Linked to ${links.length} dimensions.`
                  : `Key ${hoverMeta.columns.find((c) => c.primary)?.name}, referenced by FACT_SALES.`}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          One-to-many relationships run from each dimension's primary key to a foreign key in FACT_SALES. Counts and columns are read live from MySQL's INFORMATION_SCHEMA. Hover to trace a relationship, click to inspect a table.
        </p>
      </div>

      <div className="col-span-12 min-w-0 xl:col-span-5">
        <div className="flex flex-wrap gap-1 pb-3 xl:hidden">
          {tables.map((t) => <Button key={t.name} variant={t.name === selected ? "line" : "quiet"} onClick={() => setSelected(t.name)}>{t.name}</Button>)}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={selected} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.22, ease: EASE }}>
            <Eyebrow>{selectedMeta.kind} table</Eyebrow>
            <h3 className="mt-1 text-[clamp(1.5rem,2.6vw,2.25rem)] leading-tight font-medium tracking-[-0.03em]">{selected}</h3>
            <p className="num mt-0.5 text-[12px] text-muted">{int(selectedMeta.rows)} rows · {selectedMeta.columns.length} columns</p>
            <table className="data-table mt-4">
              <thead><tr><th>Column</th><th>Type</th><th>Key</th></tr></thead>
              <tbody>
                {selectedMeta.columns.map((column) => (
                  <tr key={column.name}>
                    <td className="font-medium">{column.name}</td>
                    <td className="text-muted">{column.type}</td>
                    <td>
                      {column.primary && <span className="text-accent2">PK</span>}
                      {column.foreign && (
                        <button className="text-accent underline underline-offset-2" onClick={() => setSelected(column.foreign!.table)}>FK → {column.foreign.table}</button>
                      )}
                      {!column.primary && !column.foreign && <span className="text-rule">·</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="col-span-12 min-w-0">
        <Eyebrow className="mb-2">Sample records from {selected}</Eyebrow>
        {detail.error ? <Notice tone="error">{detail.error.message}</Notice> : !detail.data ? <LoadingBlock height={160} /> : detail.data.rows.length === 0 ? (
          <p className="border-t border-rule py-8 text-[14px] text-muted">This table is empty. Run the ETL pipeline to load it.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>{detail.data.columns.map((c) => <SortHeader key={c.name} label={c.name} active={sort === c.name} dir={dir} onClick={() => toggleSort(c.name)} />)}</tr>
                </thead>
                <tbody key={`${selected}-${page}-${sort}-${dir}`}>
                  {detail.data.rows.map((row, index) => (
                    <tr key={index}>{detail.data!.columns.map((c) => <td key={c.name} className="max-w-[320px] truncate whitespace-nowrap">{/price|revenue/i.test(c.name) ? money(Number(row[c.name]), "₹", 2) : String(row[c.name] ?? "")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={8} total={detail.data.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

export default function Warehouse() {
  return (
    <Page>
      <PageHero
        label="Data warehousing / ETL and star schema"
        title={"From raw rows\nto a star."}
        intro="Each run cleans the source file for real, loads it into MySQL inside a single transaction, and proves the result by reconciling revenue and foreign keys before it commits."
      />
      <Pipeline />
      <RevealSection id="schema" className="mt-20 scroll-mt-16">
        <SectionHead index="02 / Schema" title="Star schema" />
        <StarSchema />
      </RevealSection>
    </Page>
  );
}
