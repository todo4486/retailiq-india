// Chart theme: the validated categorical palette and a tooltip shared by every chart.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { EASE } from "../motion/primitives";

// Fixed order, validated for colour-blind separation. Identity is also shown by labels and legends.
export const PALETTE = ["#315C46", "#D58A52", "#4A8FC2", "#A23B5A", "#9A9A2E", "#7558A6", "#35B0A0", "#8A5A3C"];

// A segment keeps its colour whatever k is or however it ranks.
const SEGMENT_ORDER = ["Champions", "At Risk", "Loyal Customers", "Occasional Customers", "Potential Loyalists", "Hibernating", "Recent Newcomers", "Big Spenders"];
export const segmentColor = (segment: string) => PALETTE[Math.max(SEGMENT_ORDER.indexOf(segment), 0) % PALETTE.length];

export const AXIS = { tick: { fontSize: 11, fontFamily: "IBM Plex Mono", fill: "#85847F" }, axisLine: false, tickLine: false };
export const GRID = { stroke: "#DDDDD5", strokeWidth: 1, vertical: false };

export function TooltipBox({ title, rows, footer }: { title?: ReactNode; rows: { label: ReactNode; value: ReactNode; color?: string; dashed?: boolean }[]; footer?: ReactNode }) {
  return (
    <div className="tooltip-in max-w-xs border border-ink bg-card px-3 py-2 text-[12px] shadow-[3px_3px_0_rgba(25,25,25,0.08)]">
      {title && <div className="eyebrow mb-1.5 !text-ink">{title}</div>}
      {rows.map((row, index) => (
        <div key={index} className="flex items-baseline justify-between gap-5 py-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            {row.color && <span className="inline-block h-2 w-2 shrink-0" style={{ background: row.color }} aria-hidden />}
            <span className="truncate">{row.label}</span>
          </span>
          <span className="num whitespace-nowrap">{row.value}</span>
        </div>
      ))}
      {footer && <div className="eyebrow mt-1.5 border-t border-rule pt-1.5">{footer}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[12px] text-ink">
          {item.dashed ? (
            <svg width="16" height="8" aria-hidden><line x1="0" y1="4" x2="16" y2="4" stroke={item.color} strokeWidth="2" strokeDasharray="4 3" /></svg>
          ) : (
            <span className="inline-block size-2.5" style={{ background: item.color }} aria-hidden />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}

// A thin horizontal bar used inside tables and lists.
export function Bar({ share, color = "#315C46" }: { share: number; color?: string }) {
  return (
    <div className="h-1 w-full bg-rule/60">
      <motion.div
        className="h-1 origin-left"
        style={{ background: color }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: Math.max(Math.min(share, 1), 0) }}
        transition={{ duration: 0.8, ease: EASE }}
      />
    </div>
  );
}
