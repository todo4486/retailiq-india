import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EASE } from "../motion/primitives";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { useStatus } from "../services/StatusContext";
import { NAV_ITEMS } from "./TopNav";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { status, refresh } = useStatus();
  const { signOut } = useAuth();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const pages = NAV_ITEMS.map((item, index) => ({
      id: item.to, group: "Go to", label: item.label, hint: String(index + 1),
      run: () => { navigate(item.to); onClose(); },
    }));
    const go = (to: string, state?: unknown) => { navigate(to, { state }); onClose(); };
    const actions: Command[] = [
      {
        id: "etl", group: "Run", label: "Re-run ETL on the active dataset", hint: status?.dataset ?? "",
        run: () => {
          api.startEtl(status?.dataset_id ?? "india-synthetic").then(() => { refresh(); go("/warehouse"); }).catch((e: Error) => setFeedback(e.message));
        },
      },
      { id: "kmeans", group: "Run", label: "Run K-Means clustering", run: () => go("/customers", { autoRun: Date.now() }) },
      { id: "apriori", group: "Run", label: "Run Apriori", run: () => go("/basket", { autoRun: Date.now() }) },
      { id: "upload", group: "Data", label: "Upload a CSV dataset", run: () => go("/explorer", { focusUpload: Date.now() }) },
      { id: "quality", group: "Data", label: "Open the data-quality report", run: () => go("/explorer#quality") },
      { id: "schema", group: "Warehouse", label: "Inspect the star schema", run: () => go("/warehouse#schema") },
      ...[["sales", "revenue"], ["products", "product performance"], ["cities", "city-wise sales"], ["customers", "customer segmentation"], ["basket", "market basket"]].map(([type, label]) => ({
        id: `report-${type}`, group: "Reports", label: `Open the ${label} report`,
        run: () => go(`/reports?type=${type}`),
      })),
      ...[["roll_up", "Roll-up"], ["drill_down", "Drill-down"], ["pivot", "Pivot"]].map(([op, label]) => ({
        id: `olap-${op}`, group: "OLAP", label: `${label} the current cube`,
        run: () => go("/olap", { operation: op, at: Date.now() }),
      })),
      { id: "signout", group: "Account", label: "Sign out", run: () => { onClose(); signOut().finally(() => navigate("/login", { replace: true })); } },
    ];
    return [...pages, ...actions];
  }, [navigate, onClose, refresh, signOut, status]);

  const matches = commands.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setFeedback(null);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      matches[active]?.run();
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[12vh]"
          onMouseDown={onClose}
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="w-full max-w-xl border border-ink bg-card"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search pages and actions"
              className="h-12 w-full border-b border-rule bg-transparent px-4 text-[15px] outline-none"
              aria-label="Search commands"
            />
            {feedback && <div className="border-b border-rule px-4 py-2 text-[13px] text-danger" role="alert">{feedback}</div>}
            <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
              {matches.map((command, index) => (
                <motion.li
                  key={command.id}
                  role="option"
                  aria-selected={index === active}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index, 8) * 0.016 }}
                >
                  <button
                    onMouseEnter={() => setActive(index)}
                    onClick={command.run}
                    className={`flex w-full items-baseline justify-between gap-4 px-4 py-2 text-left text-[13.5px] ${index === active ? "bg-accent text-paper" : ""}`}
                  >
                    <span className="flex items-baseline gap-3">
                      <span className={`eyebrow w-16 shrink-0 ${index === active ? "!text-paper/70" : ""}`}>{command.group}</span>
                      {command.label}
                    </span>
                    {command.hint && <span className="num truncate text-[11px] opacity-60">{command.hint}</span>}
                  </button>
                </motion.li>
              ))}
              {!matches.length && <li className="px-4 py-6 text-sm text-muted">No commands match “{query}”.</li>}
            </ul>
            <div className="eyebrow flex flex-wrap gap-x-4 border-t border-rule px-4 py-2">
              <span>↑↓ select</span><span>↵ run</span><span>esc close</span><span>1–7 pages</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
