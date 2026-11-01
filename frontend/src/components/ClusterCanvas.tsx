// The customer map: every customer is a point, coloured by its real K-Means cluster. Points glide to
// their new position when the axes or clusters change, then the canvas stops drawing until needed.
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { compact, int, money } from "../services/format";
import type { CustomerPoint } from "../services/types";
import { segmentColor, TooltipBox } from "./charts";

type Key = "r" | "f" | "m";
const PAD = { left: 78, right: 12, top: 8, bottom: 46 };
const INK = "#191919", MUTED = "#85847F", RULE = "#DDDDD5";

function niceTicks(min: number, max: number, log: boolean) {
  if (log) {
    const ticks: number[] = [];
    for (let e = Math.floor(Math.log10(Math.max(min, 1))); e <= Math.ceil(Math.log10(max)); e++) {
      ticks.push(10 ** e);
    }
    return ticks;
  }
  const step = 10 ** Math.floor(Math.log10((max - min) / 4 || 1));
  const best = [1, 2, 5, 10].map((m) => m * step).find((s) => (max - min) / s <= 6) ?? step * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / best) * best; t <= max; t += best) ticks.push(t);
  return ticks;
}

export function ClusterCanvas({ points, xKey, yKey, xTitle, yTitle, xLog, yLog, selected, onPick }: {
  points: CustomerPoint[]; xKey: Key; yKey: Key; xTitle: string; yTitle: string; xLog: boolean; yLog: boolean;
  selected: string | null; onPick: (segment: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [tip, setTip] = useState<{ point: CustomerPoint; x: number; y: number } | null>(null);

  // Mutable drawing state lives in a ref, so a tween does not re-render React.
  const state = useRef({
    width: 0, height: 0, frame: 0, from: new Float32Array(0) as Float32Array, to: new Float32Array(0) as Float32Array, now: new Float32Array(0) as Float32Array, started: 0,
    hover: -1, seen: false,
    axis: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
  });
  const props = useRef({ points, xKey, yKey, xTitle, yTitle, xLog, yLog, selected });
  props.current = { points, xKey, yKey, xTitle, yTitle, xLog, yLog, selected };

  const draw = () => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const s = state.current;
    const p = props.current;
    const { width, height } = s;
    ctx.clearRect(0, 0, width, height);
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const sx = (v: number) => PAD.left + (p.xLog ? (Math.log10(Math.max(v, 1)) - Math.log10(Math.max(s.axis.xMin, 1))) / (Math.log10(s.axis.xMax) - Math.log10(Math.max(s.axis.xMin, 1)) || 1) : (v - s.axis.xMin) / (s.axis.xMax - s.axis.xMin || 1)) * plotW;
    const sy = (v: number) => PAD.top + plotH - (p.yLog ? (Math.log10(Math.max(v, 1)) - Math.log10(Math.max(s.axis.yMin, 1))) / (Math.log10(s.axis.yMax) - Math.log10(Math.max(s.axis.yMin, 1)) || 1) : (v - s.axis.yMin) / (s.axis.yMax - s.axis.yMin || 1)) * plotH;

    ctx.font = `11px "IBM Plex Mono", monospace`;
    ctx.lineWidth = 1;
    const format = (key: Key, v: number) => (key === "m" ? `₹${compact(v)}` : compact(v));
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    niceTicks(s.axis.yMin, s.axis.yMax, p.yLog).forEach((t) => {
      if (t < s.axis.yMin || t > s.axis.yMax) return;
      const y = sy(t);
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(width - PAD.right, y);
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(format(p.yKey, t), PAD.left - 7, y);
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    niceTicks(s.axis.xMin, s.axis.xMax, p.xLog).forEach((t) => {
      if (t < s.axis.xMin || t > s.axis.xMax) return;
      const x = sx(t);
      ctx.fillStyle = MUTED;
      ctx.fillText(format(p.xKey, t), x, height - PAD.bottom + 7);
    });
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(PAD.left, height - PAD.bottom);
    ctx.lineTo(width - PAD.right, height - PAD.bottom);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(p.xTitle, PAD.left + plotW / 2, height - 16);
    ctx.save();
    ctx.translate(14, PAD.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(p.yTitle, 0, -5);
    ctx.restore();

    // Larger or selected points are drawn last, so they stay on top.
    const n = p.points.length;
    for (let i = 0; i < n; i++) {
      const point = p.points[i];
      const dim = p.selected && point.segment !== p.selected;
      if (!dim) continue;
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = segmentColor(point.segment);
      ctx.beginPath();
      ctx.arc(s.now[i * 2], s.now[i * 2 + 1], 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < n; i++) {
      const point = p.points[i];
      if (p.selected && point.segment !== p.selected) continue;
      ctx.globalAlpha = 0.68;
      ctx.fillStyle = segmentColor(point.segment);
      ctx.beginPath();
      ctx.arc(s.now[i * 2], s.now[i * 2 + 1], p.selected ? 3 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (s.hover >= 0 && s.hover < n) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.now[s.hover * 2], s.now[s.hover * 2 + 1], 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const layout = (animateIn: boolean) => {
    const s = state.current;
    const p = props.current;
    if (!s.width || !p.points.length) return;
    const xs = p.points.map((d) => d[p.xKey]);
    const ys = p.points.map((d) => d[p.yKey]);
    s.axis = { xMin: p.xLog ? 1 : 0, xMax: Math.max(...xs) * 1.02, yMin: p.yLog ? Math.max(Math.min(...ys), 1) : 0, yMax: Math.max(...ys) * 1.15 };
    const plotW = s.width - PAD.left - PAD.right;
    const plotH = s.height - PAD.top - PAD.bottom;
    const scale = (v: number, min: number, max: number, log: boolean) =>
      log ? (Math.log10(Math.max(v, 1)) - Math.log10(Math.max(min, 1))) / (Math.log10(max) - Math.log10(Math.max(min, 1)) || 1) : (v - min) / (max - min || 1);
    const target: Float32Array = new Float32Array(p.points.length * 2);
    p.points.forEach((d, i) => {
      target[i * 2] = PAD.left + scale(d[p.xKey], s.axis.xMin, s.axis.xMax, p.xLog) * plotW;
      target[i * 2 + 1] = PAD.top + plotH - scale(d[p.yKey], s.axis.yMin, s.axis.yMax, p.yLog) * plotH;
    });
    cancelAnimationFrame(s.frame);
    if (reduced || !animateIn) {
      s.now = target;
      s.to = target;
      draw();
      return;
    }
    // First appearance rises from the baseline; later changes glide from where points are.
    if (s.now.length !== target.length) {
      s.from = target.map((v, i) => (i % 2 ? PAD.top + plotH : v));
    } else {
      s.from = s.now.slice();
    }
    s.to = target;
    s.now = s.from.slice();
    s.started = performance.now();
    const tick = (time: number) => {
      const t = Math.min((time - s.started) / 850, 1);
      const eased = 1 - (1 - t) ** 4;
      for (let i = 0; i < s.now.length; i++) {
        s.now[i] = s.from[i] + (s.to[i] - s.from[i]) * eased;
      }
      draw();
      if (t < 1) s.frame = requestAnimationFrame(tick);
    };
    s.frame = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element || !host.current) return;
    const s = state.current;
    const resize = () => {
      const box = host.current!.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      s.width = box.width;
      s.height = box.height;
      element.width = box.width * ratio;
      element.height = box.height * ratio;
      element.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (s.seen) {
        s.now = new Float32Array(0);
        layout(false);
      }
    };
    resize();
    const resizer = new ResizeObserver(resize);
    resizer.observe(host.current);
    // The points rise into place the first time the map is seen.
    const screen = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !s.seen) {
        s.seen = true;
        layout(true);
      }
    }, { threshold: 0.15 });
    screen.observe(host.current);
    return () => {
      resizer.disconnect();
      screen.disconnect();
      cancelAnimationFrame(s.frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.current.seen) layout(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, xKey, yKey]);

  useEffect(() => {
    if (state.current.seen) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const nearest = (event: React.PointerEvent | React.MouseEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    const s = state.current;
    let best = -1, distance = 144;
    for (let i = 0; i < points.length; i++) {
      if (selected && points[i].segment !== selected) continue;
      const dx = s.now[i * 2] - x, dy = s.now[i * 2 + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < distance) {
        distance = d;
        best = i;
      }
    }
    return { index: best, x, y };
  };

  return (
    <div ref={host} className="relative h-full w-full">
      <canvas
        ref={canvas}
        className="block h-full w-full cursor-crosshair"
        role="img"
        aria-label={`Scatter plot of ${points.length} customers, ${yTitle} against ${xTitle}, coloured by K-Means cluster. The segment list beside it gives the same selection by keyboard.`}
        onPointerMove={(event) => {
          const { index, x, y } = nearest(event);
          if (state.current.hover !== index) {
            state.current.hover = index;
            draw();
          }
          setTip(index >= 0 ? { point: points[index], x, y } : null);
        }}
        onPointerLeave={() => {
          state.current.hover = -1;
          setTip(null);
          draw();
        }}
        onClick={(event) => {
          const { index } = nearest(event);
          if (index >= 0) onPick(points[index].segment);
        }}
      />
      {tip && (
        <div className="pointer-events-none absolute z-10 w-56" style={{ left: Math.min(tip.x + 14, (host.current?.clientWidth ?? 0) - 230), top: Math.max(tip.y - 96, 4) }}>
          <TooltipBox
            title={tip.point.name}
            rows={[
              { label: tip.point.segment, value: "", color: segmentColor(tip.point.segment) },
              { label: "Recency", value: `${int(tip.point.r)} days` },
              { label: "Frequency", value: `${int(tip.point.f)} orders` },
              { label: "Monetary", value: money(tip.point.m) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
