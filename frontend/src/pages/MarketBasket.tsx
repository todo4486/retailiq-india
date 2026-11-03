import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bar } from "../components/charts";
import { Button, EmptyState, ErrorState, Eyebrow, Field, Ledger, LoadingBar, LoadingBlock, Notice, Page, PageHero, Pagination, SectionHead, SortHeader } from "../components/ui";
import { Select } from "../components/Select";
import { EASE, RevealSection } from "../motion/primitives";
import { api } from "../services/api";
import { dateTime, int, pct, titleCase } from "../services/format";
import { useStatus } from "../services/StatusContext";
import type { Association, BasketNetwork, ProductAssociations, RuleProduct } from "../services/types";
import { useAsync, useDebounced } from "../services/useAsync";

const short = (name: string, max = 26) => {
  const text = titleCase(name);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Whole-catalogue view: products on a circle, chords showing the strongest pair rules.
function NetworkMap({ network, onSelect }: { network: BasketNetwork; onSelect: (id: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const size = 760;
  const centre = size / 2;
  const radius = 215;
  const positions = useMemo(() => {
    const map = new Map<number, { x: number; y: number; angle: number }>();
    // Order nodes so connected products sit near each other, which keeps chords short.
    const order: number[] = [];
    const neighbours = new Map<number, number[]>();
    network.edges.forEach((e) => {
      neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target]);
      neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source]);
    });
    const visit = (id: number) => {
      if (order.includes(id)) return;
      order.push(id);
      (neighbours.get(id) ?? []).forEach(visit);
    };
    network.nodes.forEach((n) => visit(n.id));
    order.forEach((id, index) => {
      const angle = (index / order.length) * Math.PI * 2 - Math.PI / 2;
      map.set(id, { x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle), angle });
    });
    return map;
  }, [network, centre]);
  const maxLift = Math.max(1, ...network.edges.map((e) => e.lift));
  const linked = (id: number) => hover == null || id === hover || network.edges.some((e) => (e.source === hover && e.target === id) || (e.target === hover && e.source === id));

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[760px] min-w-[620px]" role="group" aria-label="Network of the products most strongly associated with each other">
      {network.edges.map((edge, index) => {
        const a = positions.get(edge.source)!;
        const b = positions.get(edge.target)!;
        const on = hover != null && (edge.source === hover || edge.target === hover);
        return (
          <motion.path
            key={`${edge.source}-${edge.target}`}
            d={`M${a.x},${a.y} Q${centre},${centre} ${b.x},${b.y}`}
            fill="none"
            stroke={on ? "#D58A52" : "#315C46"}
            strokeWidth={0.75 + (edge.lift / maxLift) * 3}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1, opacity: hover == null ? 0.5 : on ? 1 : 0.07 }}
            transition={{ pathLength: { duration: 1.1, ease: EASE, delay: 0.1 + index * 0.025 }, opacity: { duration: 0.15 } }}
            className={on ? "dash-flow" : ""}
          />
        );
      })}
      {network.nodes.map((node) => {
        const p = positions.get(node.id)!;
        const leftSide = Math.cos(p.angle) < 0;
        const degrees = (p.angle * 180) / Math.PI;
        return (
          <motion.g
            key={node.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${titleCase(node.name)}`}
            className="cursor-pointer outline-none"
            onClick={() => onSelect(node.id)}
            onKeyDown={(e) => { if (e.key === "Enter") onSelect(node.id); }}
            onMouseEnter={() => setHover(node.id)}
            onMouseLeave={() => setHover(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: linked(node.id) ? 1 : 0.25 }}
            transition={{ duration: 0.3 }}
          >
            <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={hover === node.id ? 5 : 3.5} fill={hover === node.id ? "#D58A52" : "#191919"} />
            <text
              transform={`translate(${p.x},${p.y}) rotate(${leftSide ? degrees + 180 : degrees}) translate(${leftSide ? -10 : 10},0)`}
              textAnchor={leftSide ? "end" : "start"}
              dominantBaseline="middle"
              fontSize={10}
              fontFamily="IBM Plex Mono"
              fill="#191919"
            >
              {short(node.name, 25)}
            </text>
          </motion.g>
        );
      })}
    </svg>
  );
}

// One-product view: the selected product at the centre, its partners around it.
function FocusMap({ data, onSelect }: { data: ProductAssociations; onSelect: (id: number) => void }) {
  const shown = data.associations.slice(0, 12);
  const size = 620;
  const c = size / 2;
  const maxLift = Math.max(1, ...shown.map((a) => a.lift));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <svg viewBox={`0 0 ${size} ${size - 70}`} className="mx-auto w-full max-w-[640px] min-w-[520px]" role="group" aria-label={`Products associated with ${titleCase(data.name)}`}>
      {shown.map((partner, index) => {
        const angle = (index / shown.length) * Math.PI * 2 - Math.PI / 2;
        const distance = 205 - 55 * (partner.lift / maxLift);
        const x = c + distance * Math.cos(angle) * 1.15;
        const y = (size - 70) / 2 + distance * Math.sin(angle);
        const leftSide = Math.cos(angle) < -0.1;
        const on = hover === partner.id;
        return (
          <motion.g key={`${data.id}-${partner.id}`} role="button" tabIndex={0} aria-label={`Select ${titleCase(partner.name)}, lift ${partner.lift.toFixed(1)}`} className="cursor-pointer outline-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45, delay: 0.15 + index * 0.05 }}
            onClick={() => onSelect(partner.id)} onKeyDown={(e) => { if (e.key === "Enter") onSelect(partner.id); }}
            onMouseEnter={() => setHover(partner.id)} onMouseLeave={() => setHover(null)}>
            <motion.line x1={c} y1={(size - 70) / 2} x2={x} y2={y} stroke={on ? "#D58A52" : "#315C46"} strokeWidth={1 + (partner.lift / maxLift) * 5} initial={{ pathLength: 0 }} animate={{ pathLength: 1, opacity: on ? 1 : 0.55 }} transition={{ duration: 0.7, ease: EASE, delay: index * 0.05 }} />
            <circle cx={x} cy={y} r={on ? 6 : 4.5} fill={on ? "#D58A52" : "#191919"} />
            <text x={x + (leftSide ? -9 : 9)} y={y - 1} textAnchor={leftSide ? "end" : "start"} fontSize={10.5} fontFamily="Manrope Variable" fontWeight={600} fill="#191919">{short(partner.name, 24)}</text>
            <text x={x + (leftSide ? -9 : 9)} y={y + 12} textAnchor={leftSide ? "end" : "start"} fontSize={9.5} fontFamily="IBM Plex Mono" fill="#85847F">lift {partner.lift.toFixed(1)}</text>
          </motion.g>
        );
      })}
      <rect x={c - 88} y={(size - 70) / 2 - 24} width={176} height={48} fill="#315C46" />
      <foreignObject x={c - 84} y={(size - 70) / 2 - 22} width={168} height={44}>
        <div className="flex h-full items-center justify-center text-center text-[11.5px] leading-[1.2] font-semibold text-paper">{short(data.name, 44)}</div>
      </foreignObject>
    </svg>
  );
}

function ProductPicker({ products, value, onSelect }: { products: RuleProduct[]; value: number | null; onSelect: (id: number | null) => void }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products).slice(0, 80);
  }, [products, query]);
  return (
    <div>
      <Field label={`Find an item (${int(products.length)} in rules)`}>
        <input className="field" type="search" placeholder="e.g. atta" value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <ul className="mt-2 max-h-[440px] overflow-y-auto border-y border-rule" aria-label="Products">
        {matches.map((product) => (
          <li key={product.id}>
            <button
              onClick={() => onSelect(product.id === value ? null : product.id)}
              aria-pressed={product.id === value}
              className={`flex w-full items-baseline justify-between gap-3 border-b border-rule px-1.5 py-1.5 text-left text-[12.5px] transition-colors last:border-0 ${product.id === value ? "bg-accent text-paper" : "hover:bg-card"}`}
            >
              <span className="truncate font-medium">{titleCase(product.name)}</span>
              <span className={`num shrink-0 text-[10.5px] ${product.id === value ? "text-paper/80" : "text-muted"}`}>{product.rules} rules</span>
            </button>
          </li>
        ))}
        {!matches.length && <li className="px-1.5 py-6 text-[13px] text-muted">No product in the current rules matches “{query}”.</li>}
      </ul>
    </div>
  );
}

function Sentence({ items, name }: { items: Association[]; name: string }) {
  const best = items.find((i) => i.confidence_to != null);
  if (!best) return null;
  return (
    <p className="mb-4 max-w-3xl border-l-2 border-accent2 pl-3 text-[clamp(1.05rem,1.6vw,1.35rem)] leading-snug font-medium tracking-[-0.015em]">
      Customers who purchase {titleCase(name)} may also purchase {titleCase(best.name)}: {pct(best.confidence_to)} of baskets with the first also contain the second, {best.lift.toFixed(1)} times more than chance predicts.
    </p>
  );
}

function AssociationList({ items, name, onSelect }: { items: Association[]; name: string; onSelect: (id: number) => void }) {
  if (!items.length) return <p className="py-6 text-[14px] text-muted">{titleCase(name)} appears only in rules with several products on one side. Those are listed below.</p>;
  const maxLift = Math.max(1, ...items.map((a) => a.lift));
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr><th>Associated product</th><th>Strength</th><th className="right">Support</th><th className="right">Confidence →</th><th className="right">← Confidence</th><th className="right">Lift</th></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="max-w-[300px] truncate"><button className="underline decoration-rule underline-offset-2 hover:text-accent" onClick={() => onSelect(item.id)}>{titleCase(item.name)}</button></td>
              <td className="w-24 min-w-20"><Bar share={item.lift / maxLift} /></td>
              <td className="right">{pct(item.support)}</td>
              <td className="right">{item.confidence_to == null ? "—" : pct(item.confidence_to)}</td>
              <td className="right">{item.confidence_from == null ? "—" : pct(item.confidence_from)}</td>
              <td className="right font-medium">{item.lift.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] leading-snug text-muted">
        Confidence → is the chance of buying the listed product given {titleCase(name)}. ← is the reverse. A dash means that direction fell below minimum confidence.
      </p>
    </div>
  );
}

export default function MarketBasket() {
  const location = useLocation();
  const { dataVersion } = useStatus();
  const [version, setVersion] = useState(0);
  const members = useAsync(() => api.olapMembers(), [dataVersion]);
  const products = useAsync(() => api.ruleProducts(), [dataVersion, version]);
  const network = useAsync(() => api.network(36), [dataVersion, version]);

  const [selected, setSelected] = useState<number | null>(null);
  const focus = useAsync(() => (selected ? api.productAssociations(selected) : Promise.resolve(null)), [selected, version]);

  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [sort, setSort] = useState("lift");
  const [dir, setDir] = useState("desc");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [debounced, sort, dir, selected]);
  const rules = useAsync(
    () => api.rules({ sort, dir, search: debounced, product: selected ?? undefined, page }),
    [sort, dir, debounced, selected, page, dataVersion, version],
  );

  // Apriori parameters, in percent where the UI shows percent.
  const [support, setSupport] = useState("1");
  const [confidence, setConfidence] = useState("30");
  const [lift, setLift] = useState("1");
  const [maxLen, setMaxLen] = useState("3");
  const [city, setCity] = useState("");
  const [level, setLevel] = useState("product");
  const [multiOnly, setMultiOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const run = rules.data?.run;
  const syncedRun = useRef<string | null>(null);
  useEffect(() => {
    if (run && syncedRun.current !== run.ran_at) {
      syncedRun.current = run.ran_at;
      setSupport(String(+(run.params.min_support * 100).toFixed(3)));
      setConfidence(String(+(run.params.min_confidence * 100).toFixed(2)));
      setLift(String(run.params.min_lift));
      setMaxLen(String(run.params.max_len));
      setCity(run.params.city ?? "");
      setLevel(run.params.level ?? "product");
      setMultiOnly(Boolean(run.params.multi_item_only));
    }
  }, [run]);

  const execute = () => {
    setRunning(true);
    setMessage(null);
    api.runApriori({
      min_support: Number(support) / 100, min_confidence: Number(confidence) / 100, min_lift: Number(lift),
      max_len: Number(maxLen), city: city || null, level, multi_item_only: multiOnly,
    }).then((result) => {
      setMessage({
        tone: result.rules ? "success" : "error",
        text: result.rules
          ? `Apriori found ${int(result.frequent_itemsets)} frequent itemsets and ${int(result.rules)} rules in ${int(result.baskets)} baskets.`
          : `Apriori found no rules in ${int(result.baskets)} baskets at these thresholds. Lower the minimum support or confidence.`,
      });
      setSelected(null);
      setVersion((v) => v + 1);
    }).catch((e: Error) => setMessage({ tone: "error", text: e.message })).finally(() => setRunning(false));
  };

  const handled = useRef<unknown>(null);
  useEffect(() => {
    const auto = (location.state as { autoRun?: number } | null)?.autoRun;
    if (auto && handled.current !== auto) {
      handled.current = auto;
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const toggleSort = (column: string) => {
    if (sort === column) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(column); setDir("desc"); }
  };

  if (rules.error && !rules.data) {
    return <Page><div className="pt-14"><ErrorState error={rules.error} onRetry={rules.reload} /></div></Page>;
  }

  const hasRules = (rules.data?.total ?? 0) > 0 || Boolean(debounced) || Boolean(selected);

  return (
    <Page>
      <PageHero
        label="Data mining / Apriori"
        title={"What sells\nwith what."}
        intro="Apriori searches every basket for product sets that occur together more often than chance predicts, then turns them into rules you can test by support, confidence and lift."
        aside={run && (
          <Ledger items={[
            { label: "Baskets", value: int(run.metrics.baskets) },
            { label: "Frequent itemsets", value: int(run.metrics.frequent_itemsets) },
            { label: "Rules", value: int(run.metrics.rules) },
            { label: "Scope", value: `${run.params.city ?? "All cities"}${run.params.multi_item_only ? ", multi-item baskets" : ""}` },
            { label: "Items", value: run.params.level === "category" ? "Categories" : "Products" },
            { label: "Last run", value: `${dateTime(run.ran_at)} · ${run.duration}s` },
          ]} />
        )}
      />

      <RevealSection aria-label="Apriori parameters" className="border-y border-ink py-3">
        <div className="grid grid-cols-2 items-end gap-x-3 gap-y-3 md:grid-cols-4 xl:grid-cols-8">
          <Field label="Min support %"><input className="field" type="number" min="0.2" max="100" step="0.1" value={support} onChange={(e) => setSupport(e.target.value)} /></Field>
          <Field label="Min confidence %"><input className="field" type="number" min="1" max="100" step="5" value={confidence} onChange={(e) => setConfidence(e.target.value)} /></Field>
          <Field label="Min lift"><input className="field" type="number" min="0" step="0.5" value={lift} onChange={(e) => setLift(e.target.value)} /></Field>
          <Field label="Max itemset size">
            <Select className="" value={maxLen} onChange={(e) => setMaxLen(e.target.value)}>{[2, 3, 4].map((v) => <option key={v}>{v}</option>)}</Select>
          </Field>
          <Field label="City">
            <Select className="" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">All cities</option>
              {members.data?.city.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Items">
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="product">Products</option>
              <option value="category">Categories</option>
            </Select>
          </Field>
          <label className="flex h-[34px] cursor-pointer items-center gap-2 border border-rule bg-card px-2.5 text-[12px]" title="Mine only baskets with two or more items. Support then means share of multi-item baskets.">
            <input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} className="size-3.5 accent-accent" />
            Multi-item baskets only
          </label>
          <Button variant="primary" busy={running} onClick={execute}>{running ? "Mining" : "Run Apriori"}</Button>
        </div>
      </RevealSection>
      <LoadingBar active={running} />
      {message && <div className="mt-3"><Notice tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Notice></div>}
      {run?.params.multi_item_only && (
        <p className="mt-3 max-w-3xl text-[12.5px] leading-snug text-muted">
          These rules come from the {int(run.metrics.baskets)} baskets with two or more items, so support is a share of those baskets. Most orders in this dataset contain a single item, which on their own make every pair look rarer than chance.
        </p>
      )}

      {!rules.data ? <LoadingBlock height={480} /> : !hasRules ? (
        <div className="mt-8">
          <EmptyState title="No association rules" body="The latest run found none, or Apriori has not run on this warehouse. Lower the minimum support or confidence, then run it." />
        </div>
      ) : (
        <>
          <RevealSection className="mt-10 grid grid-cols-12 md:gap-x-10 gap-y-8">
            <div className="col-span-12 lg:col-span-3">
              {products.data && <ProductPicker products={products.data} value={selected} onSelect={setSelected} />}
              {selected && <Button variant="quiet" className="mt-3 w-full" onClick={() => setSelected(null)}>Back to the full map</Button>}
            </div>
            <div className="col-span-12 min-w-0 lg:col-span-9">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-ink pt-3 pb-2">
                <div>
                  <Eyebrow className="mb-1">Association map</Eyebrow>
                  <h2 className="section-title">{focus.data ? titleCase(focus.data.name) : "The strongest product links"}</h2>
                </div>
                <p className="max-w-sm text-[12px] leading-snug text-muted">
                  {focus.data ? "Closer and thicker means higher lift. Click a product to move to it." : `The ${int(network.data?.edges.length)} strongest of ${int(network.data?.total_pairs)} product pairs. Thicker means higher lift. Click a product to explore it.`}
                </p>
              </div>
              <div className="overflow-x-auto">
                {selected ? (
                  focus.loading && !focus.data ? <LoadingBlock height={480} /> : focus.error ? <Notice tone="error">{focus.error.message}</Notice> : focus.data && (
                    focus.data.associations.length ? <FocusMap data={focus.data} onSelect={setSelected} /> : <p className="py-16 text-center text-[14px] text-muted">No single-product rules for this item. See the rules below.</p>
                  )
                ) : network.data && network.data.nodes.length ? <NetworkMap network={network.data} onSelect={setSelected} /> : (
                  <p className="py-16 text-center text-[14px] text-muted">No single-product pairs in the current rules.</p>
                )}
              </div>
              {selected && focus.data && <Sentence items={focus.data.associations} name={focus.data.name} />}
              {selected && focus.data && <AssociationList items={focus.data.associations} name={focus.data.name} onSelect={setSelected} />}
            </div>
          </RevealSection>

          <RevealSection className="mt-16">
            <SectionHead index="Rules" title={selected && focus.data ? `Rules involving ${titleCase(focus.data.name)}` : "All association rules"} aside={
              <Field label="Search products" className="w-full sm:w-72">
                <input className="field" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
            } />
            <LoadingBar active={rules.loading} />
            {rules.data.rules.length ? (
              <>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>If bought</th><th aria-hidden></th><th>Then bought</th><th>Strength</th>
                        <SortHeader label="Support" right active={sort === "support"} dir={dir} onClick={() => toggleSort("support")} />
                        <SortHeader label="Confidence" right active={sort === "confidence"} dir={dir} onClick={() => toggleSort("confidence")} />
                        <SortHeader label="Lift" right active={sort === "lift"} dir={dir} onClick={() => toggleSort("lift")} />
                      </tr>
                    </thead>
                    <tbody>
                      {rules.data.rules.map((rule) => (
                        <tr key={rule.id}>
                          <td className="min-w-[200px] !font-sans !text-[12.5px]">{rule.antecedents.map(titleCase).join(" + ")}</td>
                          <td className="text-accent2">→</td>
                          <td className="min-w-[200px] !font-sans !text-[12.5px] font-semibold">{rule.consequents.map(titleCase).join(" + ")}</td>
                          <td className="w-24 min-w-20"><Bar share={rule.confidence} /></td>
                          <td className="right">{pct(rule.support, 2)}</td>
                          <td className="right">{pct(rule.confidence)}</td>
                          <td className="right font-medium">{rule.lift.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} pageSize={25} total={rules.data.total} onPage={setPage} />
                <p className="mt-2 text-[12px] leading-snug text-muted">Strength bar shows confidence. Lift above 1 means the products occur together more often than if they were independent.</p>
              </>
            ) : <p className="border-t border-rule py-8 text-[14px] text-muted">No rules match this search.</p>}
          </RevealSection>
        </>
      )}
    </Page>
  );
}
