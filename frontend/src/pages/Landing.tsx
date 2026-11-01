// The public front page. GSAP drives the scroll-linked motion here, where animation is the story.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FlowCanvas } from "../motion/FlowCanvas";
import { CountUp, EASE, Reveal, TextLines } from "../motion/primitives";
import { api } from "../services/api";
import { useAuth } from "../services/AuthContext";
import { int, monthLabel, moneyShort } from "../services/format";
import type { PublicSummary } from "../services/types";

gsap.registerPlugin(ScrollTrigger);

const CHIPS = [
  { text: "Lift = Confidence ÷ P(B)", top: "7%", left: "44%", depth: -40 },
  { text: "GROUP BY city, quarter", top: "11%", left: "78%", depth: -80 },
  { text: "R · F · M → z-score", top: "91%", left: "72%", depth: -60 },
  { text: "FK Geography_ID", top: "88%", left: "36%", depth: -30 },
];
const CATEGORIES = ["Grocery", "FMCG", "Electronics", "Fashion", "Pharmaceuticals", "Home Appliances", "Personal Care", "E-commerce"];
const CONTEXT = ["Reliance Retail", "DMart", "Tata Neu", "Croma", "BigBasket", "Blinkit", "Zepto", "Nykaa", "Flipkart"];
const CITY_NAMES = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Nagpur", "Surat"];
const STAGES = [
  { name: "Extract", text: "A raw CSV is read as it arrived, with its duplicates, blanks and mixed date formats intact." },
  { name: "Transform", text: "Records are deduplicated and validated, day-first dates and “Rs. 1,299” prices are standardised, and revenue is calculated." },
  { name: "Load", text: "A star schema is written to MySQL in one transaction. Revenue and foreign keys are reconciled before it commits." },
];
const METHODS = [
  { name: "Roll-up", text: "Daily sales climb to monthly, quarterly, yearly." },
  { name: "Drill-down", text: "A year opens into quarters, months and days." },
  { name: "Slice", text: "Fix one dimension, such as Year = 2025." },
  { name: "Dice", text: "Fix several: 2025, Mumbai, Electronics." },
  { name: "Pivot", text: "Rotate product, geography and time." },
];

function PublicNav({ signedIn }: { signedIn: boolean }) {
  return (
    <nav className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex h-14 max-w-[1520px] items-center justify-between px-4 sm:px-8">
        <Link to="/" className="text-[14px] font-extrabold tracking-[0.14em]">RETAILIQ <span className="font-medium text-muted">INDIA</span></Link>
        <div className="flex items-center gap-4 text-[13px] font-semibold">
          {signedIn ? (
            <Link to="/overview" className="bg-accent px-3.5 py-2 text-paper transition-colors hover:bg-[#274a38]">Open workspace</Link>
          ) : (
            <>
              <Link to="/login" className="hover:text-accent">Sign in</Link>
              <Link to="/register" className="bg-ink px-3.5 py-2 text-paper transition-colors hover:bg-accent">Create account</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

// Draws the demo dataset's real monthly revenue as the reader scrolls past it.
function RevenueLine({ summary }: { summary: PublicSummary }) {
  const path = useRef<SVGPathElement>(null);
  const { d, peak } = useMemo(() => {
    const width = 1000, height = 220;
    const max = Math.max(...summary.series.map((p) => p.revenue));
    const points = summary.series.map((p, i) => [(i / Math.max(summary.series.length - 1, 1)) * width, height - (p.revenue / max) * (height - 14)]);
    return { d: points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" "), peak: max };
  }, [summary]);

  useEffect(() => {
    const element = path.current;
    if (!element) return;
    const context = gsap.context(() => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        const length = element.getTotalLength();
        gsap.fromTo(element, { strokeDasharray: length, strokeDashoffset: length }, {
          strokeDashoffset: 0, ease: "none",
          scrollTrigger: { trigger: element, start: "top 88%", end: "top 30%", scrub: 0.6 },
        });
      });
    });
    return () => context.revert();
  }, [d]);

  return (
    <figure>
      <svg viewBox="0 0 1000 224" className="w-full" role="img" aria-label={`Monthly revenue in the synthetic dataset, from ${monthLabel(summary.from)} to ${monthLabel(summary.to)}. The highest month reached ${moneyShort(peak)}.`} preserveAspectRatio="none">
        <line x1="0" x2="1000" y1="220" y2="220" stroke="#191919" />
        <path ref={path} d={d} fill="none" stroke="#315C46" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="num mt-2 flex flex-wrap justify-between gap-2 text-[11.5px] text-muted">
        <span>{monthLabel(summary.from)}</span>
        <span>Monthly revenue, synthetic dataset. Peak {moneyShort(peak)}.</span>
        <span>{monthLabel(summary.to)}</span>
      </figcaption>
    </figure>
  );
}

function Figure({ label, value, format }: { label: string; value: number; format: (v: number) => string }) {
  return (
    <div className="border-t border-ink pt-2.5">
      <div className="eyebrow">{label}</div>
      <CountUp value={value} format={format} className="num mt-3 block text-[clamp(1.5rem,3.2vw,3rem)] leading-none tracking-[-0.04em]" />
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="eyebrow mb-4">{children}</div>;
}

export default function Landing() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<PublicSummary | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "RetailIQ India: retail intelligence, reimagined";
    api.publicSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  useLayoutEffect(() => {
    const context = gsap.context(() => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        // Parallax: the grid, the hero visual and each formula chip move at different speeds.
        gsap.to("[data-grid]", { yPercent: 12, ease: "none", scrollTrigger: { trigger: "[data-hero]", start: "top top", end: "bottom top", scrub: true } });
        gsap.to("[data-hero-copy]", { y: -60, ease: "none", scrollTrigger: { trigger: "[data-hero]", start: "top top", end: "bottom top", scrub: true } });
        gsap.utils.toArray<HTMLElement>("[data-chip]").forEach((chip) => {
          gsap.to(chip, { y: Number(chip.dataset.chip), ease: "none", scrollTrigger: { trigger: "[data-hero]", start: "top top", end: "bottom top", scrub: true } });
        });
        gsap.fromTo("[data-chip]", { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.8, stagger: 0.14, delay: 1.1, ease: "power3.out" });

        // The pipeline: a line grows down the section and each stage lights up as it is reached.
        gsap.fromTo("[data-rail]", { scaleY: 0 }, { scaleY: 1, ease: "none", transformOrigin: "top", scrollTrigger: { trigger: "[data-pipeline]", start: "top 62%", end: "bottom 62%", scrub: 0.5 } });
        gsap.utils.toArray<HTMLElement>("[data-stage]").forEach((stage) => {
          gsap.fromTo(stage, { opacity: 0.16, x: 22 }, { opacity: 1, x: 0, ease: "power2.out", scrollTrigger: { trigger: stage, start: "top 76%", end: "top 48%", scrub: 0.4 } });
        });

        // OLAP operations rise in sequence.
        gsap.from("[data-method]", { y: 36, opacity: 0, stagger: 0.09, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: "[data-methods]", start: "top 78%" } });
        // The city list slides sideways with the scroll, at its own speed.
        gsap.fromTo("[data-cities]", { x: 80 }, { x: -80, ease: "none", scrollTrigger: { trigger: "[data-cities]", start: "top bottom", end: "bottom top", scrub: true } });
      });
    }, root);
    return () => context.revert();
  }, []);

  return (
    <div ref={root} className="overflow-x-hidden">
      <PublicNav signedIn={Boolean(user)} />

      <header data-hero className="relative min-h-screen overflow-hidden">
        <div data-grid className="absolute inset-0 overflow-hidden opacity-70" aria-hidden><div className="grid-lines grid-drift" /></div>
        <div className="relative mx-auto grid max-w-[1520px] grid-cols-12 items-center px-4 pt-24 pb-10 sm:px-8 md:gap-x-8 lg:min-h-screen lg:pt-16">
          <div data-hero-copy className="col-span-12 lg:col-span-7">
            <div className="eyebrow mb-6">Retail intelligence / India</div>
            <TextLines
              delay={1.15}
              lines={["Retail intelligence,", "reimagined for India."]}
              className="text-[clamp(2.5rem,6.3vw,6.1rem)] leading-[1.0] font-medium tracking-[-0.045em]"
            />
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE, delay: 1.55 }}
              className="mt-7 max-w-xl text-[17px] leading-relaxed text-muted"
            >
              A working data warehouse and mining laboratory for Indian retail: from a messy transaction export to star schemas, OLAP cubes, customer clusters and basket rules, in rupees.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 1.7 }} className="mt-8 flex flex-wrap gap-2.5">
              <Link to={user ? "/overview" : "/register"} className="inline-flex h-12 items-center bg-accent px-6 text-[14px] font-semibold text-paper transition-all hover:-translate-y-0.5 hover:bg-[#274a38]">
                {user ? "Open workspace" : "Start analysing"} →
              </Link>
              {!user && <Link to="/login" className="inline-flex h-12 items-center border border-ink px-6 text-[14px] font-semibold transition-all hover:-translate-y-0.5 hover:bg-ink hover:text-paper">Sign in</Link>}
            </motion.div>
          </div>
          <div className="relative col-span-12 mt-10 h-[440px] lg:col-span-5 lg:mt-0 lg:h-[560px]">
            <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.1, delay: 1.3 }}>
              <FlowCanvas />
            </motion.div>
          </div>
        </div>
        {CHIPS.map((chip) => (
          <span
            key={chip.text}
            data-chip={chip.depth}
            className="num absolute hidden border border-rule bg-paper px-2 py-1 text-[11px] text-muted opacity-0 xl:block"
            style={{ top: chip.top, left: chip.left }}
            aria-hidden
          >
            {chip.text}
          </span>
        ))}
      </header>

      {summary && (
        <section className="mx-auto max-w-[1520px] px-4 py-20 sm:px-8">
          <Reveal>
            <SectionLabel>Live from this installation’s warehouse</SectionLabel>
            <TextLines as="h2" inView lines={["A demonstration you can audit."]} className="section-title" />
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
              These figures come from a clearly labelled synthetic dataset of Indian retail transactions, generated for demonstration. They do not represent the sales of any company.
            </p>
          </Reveal>
          <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4 lg:gap-x-8">
            <Figure label="Synthetic revenue" value={summary.revenue} format={(v) => moneyShort(v)} />
            <Figure label="Orders" value={summary.orders} format={int} />
            <Figure label="Customers" value={summary.customers} format={int} />
            <Figure label="Cities" value={summary.cities} format={int} />
          </div>
          <div className="mt-12"><RevenueLine summary={summary} /></div>
        </section>
      )}

      <section data-pipeline className="mx-auto grid max-w-[1520px] grid-cols-12 px-4 py-24 sm:px-8 md:gap-x-8">
        <div className="col-span-12 lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <SectionLabel>01 / Data warehousing</SectionLabel>
            <TextLines as="h2" inView lines={["Messy exports in.", "A star schema out."]} className="text-[clamp(2rem,4.4vw,4rem)] leading-[1.03] font-medium tracking-[-0.04em]" />
          </div>
        </div>
        <div className="relative col-span-12 mt-10 pl-8 lg:col-span-7 lg:mt-0">
          <span className="absolute top-0 bottom-0 left-0 w-px bg-rule" aria-hidden />
          <span data-rail className="absolute top-0 bottom-0 left-0 w-0.5 bg-accent" aria-hidden />
          {STAGES.map((stage, index) => (
            <article key={stage.name} data-stage className="py-14 first:pt-0">
              <div className="eyebrow">Stage {index + 1}</div>
              <h3 className="mt-2 text-[clamp(2rem,4vw,3.5rem)] leading-none font-medium tracking-[-0.04em]">{stage.name}</h3>
              <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-muted">{stage.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-rule bg-card py-24">
        <div className="mx-auto max-w-[1520px] px-4 sm:px-8">
          <SectionLabel>02 / Analytical processing</SectionLabel>
          <TextLines as="h2" inView lines={["Five ways to turn the cube."]} className="text-[clamp(2rem,4.4vw,4rem)] leading-[1.03] font-medium tracking-[-0.04em]" />
          <div data-methods className="mt-12 grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-5">
            {METHODS.map((method, index) => (
              <article key={method.name} data-method className="lift border-t border-rule py-5">
                <div className="num text-[11px] text-muted">{String(index + 1).padStart(2, "0")}</div>
                <h3 className="mt-5 text-[22px] font-medium tracking-[-0.025em]">{method.name}</h3>
                <p className="mt-2 text-[14px] leading-snug text-muted">{method.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1520px] grid-cols-12 gap-y-12 px-4 py-24 sm:px-8 md:gap-x-8">
        <div className="col-span-12 lg:col-span-6">
          <SectionLabel>03 / Customer intelligence</SectionLabel>
          <TextLines as="h2" inView lines={["Who keeps coming back."]} className="section-title" />
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-muted">
            K-Means groups customers by how recently, how often and how much they buy, on normalised values. Champions, Loyal Customers, Potential Loyalists, At Risk and Occasional Customers are named from each cluster’s centre, not from fixed thresholds.
          </p>
        </div>
        <div className="col-span-12 lg:col-span-6">
          <SectionLabel>04 / Market basket</SectionLabel>
          <TextLines as="h2" inView lines={["What sells with what."]} className="section-title" />
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-muted">
            Customers who buy atta may also buy cooking oil. Apriori finds such pairs in the transactions and measures them by support, confidence and lift, so that an association is a number you can check.
          </p>
        </div>
      </section>

      <section className="overflow-hidden border-t border-rule py-24">
        <div className="mx-auto max-w-[1520px] px-4 sm:px-8">
          <SectionLabel>05 / The Indian market</SectionLabel>
          <TextLines as="h2" inView lines={["Built around how India shops."]} className="section-title" />
        </div>
        <div data-cities className="mt-10 whitespace-nowrap text-[clamp(2.5rem,7vw,6.5rem)] leading-none font-medium tracking-[-0.045em] text-rule" aria-label={`Cities covered: ${CITY_NAMES.join(", ")}`}>
          {CITY_NAMES.join(" · ")}
        </div>
        <div className="mx-auto mt-14 grid max-w-[1520px] grid-cols-12 gap-y-8 px-4 sm:px-8 md:gap-x-8">
          <Reveal className="col-span-12 md:col-span-5">
            <div className="eyebrow mb-2">Retail categories</div>
            <p className="text-[18px] leading-snug font-medium tracking-[-0.015em]">{CATEGORIES.join(", ")}.</p>
          </Reveal>
          <Reveal delay={0.1} className="col-span-12 md:col-span-7">
            <div className="eyebrow mb-2">Industry context</div>
            <p className="text-[18px] leading-snug font-medium tracking-[-0.015em]">{CONTEXT.join(", ")}.</p>
            <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted">
              These businesses are named only as examples of the Indian retail landscape. RetailIQ has no partnership or integration with them, and no access to their data.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="bg-accent text-paper">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-end justify-between gap-8 px-4 py-20 sm:px-8">
          <TextLines as="h2" inView lines={["Open the warehouse."]} className="text-[clamp(2.25rem,6vw,5.5rem)] leading-none font-medium tracking-[-0.045em]" />
          <Link to={user ? "/overview" : "/register"} className="inline-flex h-12 items-center bg-paper px-6 text-[14px] font-semibold text-ink transition-transform hover:-translate-y-0.5">
            {user ? "Open workspace" : "Create an account"} →
          </Link>
        </div>
      </section>
      <footer className="eyebrow mx-auto flex max-w-[1520px] flex-wrap justify-between gap-2 px-4 py-5 sm:px-8">
        <span>RetailIQ India / Academic data warehousing and data mining project</span>
        <span>All amounts in Indian Rupees (₹)</span>
      </footer>
    </div>
  );
}
