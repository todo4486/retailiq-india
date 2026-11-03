import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { EASE } from "../motion/primitives";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { dateTime, int } from "../services/format";
import { useStatus } from "../services/StatusContext";

export const NAV_ITEMS = [
  { to: "/overview", label: "Overview" },
  { to: "/explorer", label: "Data Explorer" },
  { to: "/warehouse", label: "Warehouse" },
  { to: "/olap", label: "OLAP Studio" },
  { to: "/customers", label: "Customer Intelligence" },
  { to: "/basket", label: "Market Basket" },
  { to: "/reports", label: "Reports" },
];

function ProfileMenu() {
  const { user, signOut, setUser } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const save = () => {
    api.updateName(name).then((next) => {
      setUser(next);
      setSaved("Saved");
    }).catch((error: Error) => setSaved(error.message));
  };
  const leave = () => {
    signOut().finally(() => navigate("/login", { replace: true }));
  };
  const initials = (user?.name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  return (
    <div ref={box} className="relative">
      <motion.button
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`User profile: ${user?.name}`}
        className="num flex size-7 items-center justify-center bg-ink text-[11px] text-paper transition-colors hover:bg-accent"
      >
        {initials}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE }}
            style={{ transformOrigin: "top right" }}
            className="absolute top-9 right-0 z-40 w-72 border border-ink bg-card p-3"
          >
            <div className="eyebrow">Signed in as</div>
            <div className="num mt-0.5 truncate text-[12px]">{user?.email}</div>
            <label className="mt-3 block">
              <span className="eyebrow">Name</span>
              <input className="field mt-1" value={name} onChange={(e) => { setName(e.target.value); setSaved(null); }} />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={save} className="h-8 border border-ink px-3 text-[12px] font-semibold transition-colors hover:bg-ink hover:text-paper">Save</button>
              <button onClick={leave} className="h-8 border border-rule px-3 text-[12px] font-semibold text-danger transition-colors hover:border-danger">Sign out</button>
              {saved && <span className="num truncate text-[11px] text-muted">{saved}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusIndicator() {
  const { status, offline } = useStatus();
  let color = "bg-muted";
  let text = "Connecting";
  if (offline) {
    color = "bg-danger";
    text = "API offline";
  } else if (status?.etl_running) {
    color = "bg-accent2 pulse-dot";
    text = "ETL running";
  } else if (status && !status.dataset) {
    color = "bg-accent2";
    text = "No data loaded";
  } else if (status) {
    color = "bg-accent";
    text = status.data_kind === "synthetic" ? "Synthetic data" : status.data_kind === "real" ? "Real data" : status.dataset ?? "";
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={status ? `${status.dataset ?? "No dataset"}: ${int(status.fact_rows)} fact rows in MySQL` : undefined}>
      <span className={`inline-block size-1.5 shrink-0 ${color}`} aria-hidden />
      <span className="num truncate text-[11px] text-ink">{text}</span>
    </span>
  );
}

export function TopNav({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { status } = useStatus();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);

  return (
    <nav className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-[2px]" aria-label="Primary">
      <div className="mx-auto flex h-12 max-w-[1520px] items-center justify-between gap-6 px-4 sm:px-8">
        <Link to="/overview" className="text-[14px] font-extrabold tracking-[0.14em]">RETAILIQ</Link>

        <div className="hidden items-center gap-5 nav:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `group relative whitespace-nowrap py-1 text-[13px] font-medium tracking-[-0.01em] transition-colors hover:text-ink ${isActive ? "text-ink" : "text-muted"}`}>
              {({ isActive }) => (
                <>
                  {item.label}
                  {/* A hover line, and one shared underline that glides between pages. */}
                  <span className="absolute inset-x-0 -bottom-[3px] h-px origin-left scale-x-0 bg-muted transition-transform duration-300 group-hover:scale-x-100" aria-hidden />
                  {isActive && <motion.span layoutId="nav-underline" className="absolute inset-x-0 -bottom-[13px] h-0.5 bg-accent" transition={{ type: "spring", stiffness: 380, damping: 34 }} aria-hidden />}
                </>
              )}
            </NavLink>
          ))}
        </div>

        <div className="flex min-w-0 items-center gap-3.5">
          <div className="hidden max-w-[150px] sm:block"><StatusIndicator /></div>
          <span className="num hidden text-[11px] whitespace-nowrap text-muted 2xl:inline" title="Last synchronization">
            Synced {dateTime(status?.last_sync)}
          </span>
          <button
            onClick={onOpenPalette}
            className="num hidden h-6 w-6 items-center justify-center border border-rule text-[12px] text-muted transition-colors hover:border-ink hover:text-ink sm:flex"
            aria-label="Open command palette (press /)"
            title="Command palette"
          >
            /
          </button>
          <ProfileMenu />
          <button className="num flex h-7 items-center border border-ink px-2 text-[11px] nav:hidden" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
            {menu ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div
            className="overflow-hidden border-t border-rule bg-paper nav:hidden"
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            <div className="px-4 pb-4 sm:px-8">
              {NAV_ITEMS.map((item, index) => (
                <motion.div key={item.to} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, delay: index * 0.03, ease: EASE }}>
                  <NavLink to={item.to} className={({ isActive }) => `flex items-baseline gap-3 border-b border-rule py-2.5 text-lg font-medium tracking-tight ${isActive ? "text-accent" : ""}`}>
                    <span className="num text-[11px] text-muted">{index + 1}</span>
                    {item.label}
                  </NavLink>
                </motion.div>
              ))}
              <div className="pt-3 sm:hidden"><StatusIndicator /></div>
              <div className="num pt-1 text-[11px] text-muted">Synced {dateTime(status?.last_sync)}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
