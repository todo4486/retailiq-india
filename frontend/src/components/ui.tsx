// Small shared building blocks: buttons, states, labels, pagination.
import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { EASE, TextLines } from "../motion/primitives";
import { int } from "../services/format";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

type ButtonProps = HTMLMotionProps<"button"> & { variant?: "primary" | "line" | "quiet"; busy?: boolean; children?: ReactNode };

export function Button({ variant = "line", busy, children, className = "", disabled, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-accent text-paper border-accent hover:bg-[#274a38] disabled:bg-rule disabled:border-rule disabled:text-muted",
    line: "bg-transparent text-ink border-ink hover:bg-ink hover:text-paper disabled:border-rule disabled:text-muted disabled:hover:bg-transparent",
    quiet: "bg-transparent text-muted border-rule hover:text-ink hover:border-muted disabled:text-rule disabled:hover:border-rule",
  }[variant];
  return (
    <motion.button
      whileHover={disabled || busy ? undefined : { y: -1.5 }}
      whileTap={disabled || busy ? undefined : { scale: 0.975 }}
      transition={{ duration: 0.18, ease: EASE }}
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex h-[34px] items-center justify-center gap-2 border px-3.5 text-[12.5px] font-semibold tracking-[-0.005em] whitespace-nowrap transition-colors duration-150 ${styles} ${className}`}
    >
      {busy && (
        <span className="flex gap-0.5" aria-hidden>
          {[0, 1, 2].map((dot) => (
            <motion.span key={dot} className="size-1 bg-current" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15 }} />
          ))}
        </span>
      )}
      {children}
    </motion.button>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="eyebrow mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function LoadingBar({ active }: { active: boolean }) {
  return (
    <div className="h-px w-full overflow-hidden bg-transparent" role={active ? "progressbar" : undefined} aria-label={active ? "Loading" : undefined}>
      {active && <div className="loading-bar h-px w-1/4 bg-accent" />}
    </div>
  );
}

export function LoadingBlock({ label = "Loading from the warehouse", height = 280 }: { label?: string; height?: number }) {
  return (
    <div className="flex flex-col justify-center" style={{ minHeight: height }} role="status">
      <div className="mx-auto w-48">
        <LoadingBar active />
        <div className="eyebrow mt-3 text-center">{label}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-t border-rule py-14">
      <h3 className="text-xl font-medium tracking-tight">{title}</h3>
      {body && <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error & { code?: string }; onRetry?: () => void }) {
  if (error.code === "warehouse_empty") {
    return (
      <EmptyState
        title="The warehouse is empty"
        body="Run the ETL pipeline to clean a dataset and load it into the star schema. Every analytical page reads from there."
        action={<Link to="/warehouse" className="inline-flex h-[34px] items-center bg-accent px-3.5 text-[12.5px] font-semibold text-paper hover:bg-[#274a38]">Open the ETL pipeline</Link>}
      />
    );
  }
  return (
    <div className="border-t-2 border-danger py-8" role="alert">
      <Eyebrow className="!text-danger">Error</Eyebrow>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed">{error.message}</p>
      {onRetry && <Button className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Notice({ tone, children, onDismiss }: { tone: "success" | "error" | "info"; children: ReactNode; onDismiss?: () => void }) {
  const color = { success: "border-accent text-accent", error: "border-danger text-danger", info: "border-muted text-ink" }[tone];
  return (
    <div className={`flex items-start justify-between gap-4 border-l-2 bg-card px-3 py-2 text-[13px] leading-snug ${color}`} role={tone === "error" ? "alert" : "status"}>
      <div>{children}</div>
      {onDismiss && <button onClick={onDismiss} aria-label="Dismiss" className="text-muted hover:text-ink">×</button>}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <span className="num text-xs text-muted">{int(start)}–{int(end)} of {int(total)}</span>
      <div className="flex gap-1.5">
        <Button variant="quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="quiet" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function SortHeader({ label, active, dir, onClick, right }: { label: string; active: boolean; dir: string; onClick: () => void; right?: boolean }) {
  return (
    <th className={right ? "right" : ""} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={onClick} className={`uppercase tracking-[0.06em] hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}{active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-[1520px] px-4 pb-24 sm:px-8">{children}</main>;
}

export function PageHero({ label, title, intro, aside }: { label: string; title: string; intro?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="grid grid-cols-12 gap-y-6 pt-10 md:gap-x-8 pb-10 sm:pt-14 sm:pb-14">
      <div className="col-span-12 lg:col-span-8">
        <Eyebrow className="mb-5">{label}</Eyebrow>
        <TextLines className="display" lines={title.split("\n")} delay={0.05} />
        {intro && (
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.3 }} className="mt-6 max-w-[38rem] text-[17px] leading-relaxed text-muted">
            {intro}
          </motion.p>
        )}
      </div>
      {aside && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.35 }} className="col-span-12 self-end lg:col-span-4">
          {aside}
        </motion.div>
      )}
    </header>
  );
}

export function SectionHead({ index, title, aside }: { index?: string; title: string; aside?: ReactNode }) {
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-3 pb-5">
      <motion.span
        className="absolute inset-x-0 top-0 h-px origin-left bg-ink"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1, ease: EASE }}
      />
      <div>
        {index && <Eyebrow className="mb-1.5">{index}</Eyebrow>}
        <TextLines as="h2" inView className="section-title" lines={[title]} />
      </div>
      {aside}
    </div>
  );
}

export function Ledger({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="text-[12.5px]">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4 border-b border-rule py-1.5 first:border-t">
          <dt className="eyebrow shrink-0">{item.label}</dt>
          <dd className="num min-w-0 truncate text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
