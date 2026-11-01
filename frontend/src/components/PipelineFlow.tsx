// The animated ETL strip. Particles are driven only by the real run: a segment carries particles
// only while its stage is really running, and rejected particles fall only when a Transform step
// has really removed rows. If nothing is running, nothing moves.
import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import type { EtlRun } from "../services/types";

const GREEN = "#315C46", ORANGE = "#D58A52", RULE = "#DDDDD5", INK = "#191919", MUTED = "#85847F";

interface Particle { from: number; to: number; t: number; speed: number; rejected: boolean; wobble: number }

export function PipelineFlow({ run, height = 128 }: { run: EtlRun | null; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(run);
  const reduced = useReducedMotion();
  const seenRemoved = useRef<number>(-1);
  const seenRunId = useRef<number | null>(null);
  latest.current = run;

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ctx = context;
    let width = 0, frame = 0, spawn = 0, last = performance.now(), running = false;
    const particles: Particle[] = [];

    const resize = () => {
      const box = element.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      element.width = box.width * ratio;
      element.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint();
    };

    // Node positions: source file, Extract, Transform, Load, warehouse. Bin sits below Transform.
    const nodes = () => {
      const y = 46;
      return [0.03, 0.2, 0.5, 0.8, 0.97].map((f) => ({ x: width * f, y }));
    };
    const bin = () => ({ x: width * 0.5, y: height - 16 });

    function paint() {
      const n = nodes();
      const current = latest.current;
      const status = (key: "extract" | "transform" | "load") => current?.stages[key].status ?? "pending";
      ctx.clearRect(0, 0, width, height);
      const segments: [number, number, string][] = [[0, 1, status("extract")], [1, 2, status("transform")], [2, 3, status("load")], [3, 4, status("load")]];
      segments.forEach(([a, b, s]) => {
        ctx.strokeStyle = s === "done" ? GREEN : s === "failed" ? "#A83A3A" : RULE;
        ctx.lineWidth = s === "done" ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(n[a].x, n[a].y);
        ctx.lineTo(n[b].x, n[b].y);
        ctx.stroke();
      });
      const b = bin();
      ctx.strokeStyle = RULE;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(n[2].x, n[2].y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);

      particles.forEach((p) => {
        if (p.t < 0) return; // a rejected particle waiting for its turn to fall
        const from = n[p.from];
        const to = p.rejected ? b : n[p.to];
        const x = from.x + (to.x - from.x) * p.t + (p.rejected ? Math.sin(p.t * 9 + p.wobble) * 7 * p.t : 0);
        const y = from.y + (to.y - from.y) * (p.rejected ? p.t * p.t : p.t) + (p.rejected ? 0 : Math.sin(p.t * 12 + p.wobble) * 3);
        ctx.fillStyle = p.rejected ? ORANGE : GREEN;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      });

      n.forEach((node, index) => {
        const stage = index >= 1 && index <= 3 ? status((["extract", "transform", "load"] as const)[index - 1]) : "";
        ctx.fillStyle = stage === "done" ? GREEN : stage === "running" ? ORANGE : stage === "failed" ? "#A83A3A" : "#F5F4EF";
        ctx.strokeStyle = stage === "pending" || stage === "" ? INK : ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(node.x - 5, node.y - 5, 10, 10);
        ctx.fill();
        ctx.stroke();
      });
      ctx.fillStyle = MUTED;
      ctx.font = `10px "IBM Plex Mono", monospace`;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";
      ["CSV", "EXTRACT", "TRANSFORM", "LOAD", "MYSQL"].forEach((label, index) => {
        ctx.textAlign = index === 0 ? "left" : index === 4 ? "right" : "center";
        const x = index === 0 ? n[0].x - 5 : index === 4 ? n[4].x + 5 : n[index].x;
        ctx.fillText(label, x, n[index].y - 15);
      });
      ctx.textAlign = "center";
      ctx.fillStyle = current && current.stages.transform.steps.some((s) => s.removed) ? ORANGE : MUTED;
      ctx.fillText("REJECTED", b.x, b.y + 12);
    }

    const emit = () => {
      const current = latest.current;
      if (!current || current.status !== "running") return;
      const { extract, transform, load, marts } = current.stages;
      if (extract.status === "running") particles.push({ from: 0, to: 1, t: 0, speed: 1.1, rejected: false, wobble: Math.random() * 6 });
      else if (transform.status === "running") particles.push({ from: 1, to: 2, t: 0, speed: 0.8, rejected: false, wobble: Math.random() * 6 });
      else if (load.status === "running") {
        particles.push({ from: 2, to: 3, t: 0, speed: 0.75, rejected: false, wobble: Math.random() * 6 });
        if (Math.random() < 0.7) particles.push({ from: 3, to: 4, t: 0, speed: 0.9, rejected: false, wobble: Math.random() * 6 });
      } else if (marts.status === "running") particles.push({ from: 3, to: 4, t: 0, speed: 0.6, rejected: false, wobble: Math.random() * 6 });
    };

    const tick = (now: number) => {
      const delta = Math.min(now - last, 50) / 1000;
      last = now;
      const current = latest.current;

      // Each real Transform removal releases a fall of rejected particles, scaled to its size.
      if (current) {
        if (seenRunId.current !== current.run_id) {
          seenRunId.current = current.run_id;
          seenRemoved.current = current.status === "running" ? 0 : -1;
        }
        const removed = current.stages.transform.steps.reduce((sum, s) => sum + s.removed, 0);
        if (seenRemoved.current >= 0 && removed > seenRemoved.current) {
          const count = Math.min(26, 4 + Math.round(Math.sqrt(removed - seenRemoved.current) / 4));
          for (let i = 0; i < count; i++) {
            particles.push({ from: 2, to: 2, t: -i * 0.06, speed: 0.75, rejected: true, wobble: Math.random() * 6 });
          }
          seenRemoved.current = removed;
        }
      }

      spawn += delta;
      if (spawn > 0.07 && particles.length < 140) {
        spawn = 0;
        emit();
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].t += particles[i].speed * delta;
        if (particles[i].t >= 1) particles.splice(i, 1);
      }
      paint();

      // The loop stops by itself when the run has finished and the last particle has landed.
      if (current?.status === "running" || particles.length) frame = requestAnimationFrame(tick);
      else running = false;
    };

    const ensureRunning = () => {
      if (reduced) {
        paint();
        return;
      }
      if (!running) {
        running = true;
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const poll = window.setInterval(() => {
      if (latest.current?.status === "running") ensureRunning();
      else if (!running) paint();
    }, 300);
    document.fonts?.ready.then(paint);
    ensureRunning();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearInterval(poll);
    };
  }, [height, reduced]);

  return (
    <canvas
      ref={canvas}
      className="block w-full"
      style={{ height }}
      role="img"
      aria-label={run ? `ETL flow for ${run.dataset_name}. Status: ${run.status}.` : "ETL flow. No run yet."}
    />
  );
}
