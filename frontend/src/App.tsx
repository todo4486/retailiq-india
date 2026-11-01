import { AnimatePresence, motion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { NAV_ITEMS, TopNav } from "./components/TopNav";
import { LoadingBlock, Page, PageHero } from "./components/ui";
import { IntroLoader } from "./motion/IntroLoader";
import { EASE } from "./motion/primitives";
import { RequireAuth } from "./services/AuthContext";
import { StatusProvider, useStatus } from "./services/StatusContext";

const Landing = lazy(() => import("./pages/Landing"));
const Overview = lazy(() => import("./pages/Overview"));
const DataExplorer = lazy(() => import("./pages/DataExplorer"));
const Warehouse = lazy(() => import("./pages/Warehouse"));
const OlapStudio = lazy(() => import("./pages/OlapStudio"));
const CustomerIntelligence = lazy(() => import("./pages/CustomerIntelligence"));
const MarketBasket = lazy(() => import("./pages/MarketBasket"));
const Reports = lazy(() => import("./pages/Reports"));
const LoginPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/Auth").then((m) => ({ default: m.ResetPasswordPage })));

function NotFound() {
  return <Page><PageHero label="404" title="No such page." intro="Press / to open the command palette and find what you need." /></Page>;
}

// The signed-in frame: navigation, page transitions, shortcuts and the command palette.
function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const outlet = useOutlet();
  const { offline } = useStatus();
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Global keyboard shortcuts: "/" opens the palette, 1 to 7 switch pages.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (/^[1-7]$/.test(event.key)) {
        navigate(NAV_ITEMS[Number(event.key) - 1].to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // Scroll to a #section after navigation, otherwise return to the top.
  useEffect(() => {
    if (location.hash) {
      const timer = setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 500);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => window.scrollTo(0, 0), 180);
    return () => clearTimeout(timer);
  }, [location.pathname, location.hash]);

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav onOpenPalette={() => setPaletteOpen(true)} />
      {offline && <div className="bg-danger px-4 py-1.5 text-center text-[12.5px] text-paper" role="alert">{offline}</div>}
      <div className="relative flex-1">
        {/* A thin line sweeps across on every page change. */}
        <motion.div
          key={`sweep-${location.pathname}`}
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 origin-left bg-accent"
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 1, opacity: 0 }}
          transition={{ scaleX: { duration: 0.55, ease: EASE }, opacity: { duration: 0.25, delay: 0.5 } }}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            <Suspense fallback={<LoadingBlock label="Loading module" height={480} />}>{outlet}</Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
      <footer className="border-t border-rule">
        <div className="eyebrow mx-auto flex max-w-[1520px] flex-wrap justify-between gap-2 px-4 py-4 sm:px-8">
          <span>RetailIQ India / Data warehousing and data mining</span>
          <span>Press / for commands</span>
        </div>
      </footer>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}

export default function App() {
  return (
    <>
      <IntroLoader />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<RequireAuth><StatusProvider><AppShell /></StatusProvider></RequireAuth>}>
            <Route path="/overview" element={<Overview />} />
            <Route path="/explorer" element={<DataExplorer />} />
            <Route path="/warehouse" element={<Warehouse />} />
            <Route path="/olap" element={<OlapStudio />} />
            <Route path="/customers" element={<CustomerIntelligence />} />
            <Route path="/basket" element={<MarketBasket />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/404" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
