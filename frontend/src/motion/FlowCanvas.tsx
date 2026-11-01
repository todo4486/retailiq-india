// The hero visual: rupees moving from city stores, through customers, into a warehouse and out to
// analysis. It is a drawn map of what RetailIQ really does, not decoration. Runs only while on screen.
import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Surat", "Nagpur"];
const SEGMENTS = ["Champions", "Loyal", "Potential", "At Risk", "Occasional"];
const OUTPUTS = ["OLAP", "RFM", "Apriori", "Reports"];
const GREEN = "#315C46";
const ORANGE = "#D58A52";
const RULE = "#DDDDD5";
const INK = "#191919";
const MUTED = "#85847F";

interface Point { x: number; y: number }
interface Particle { path: Point[]; t: number; speed: number; rupee: boolean }

const bezier = (a: Point, b: Point, t: number) => {
  const mid = (a.x + b.x) / 2;
  const u = 1 - t;
  const x = u ** 3 * a.x + 3 * u * u * t * mid + 3 * u * t * t * mid + t ** 3 * b.x;
  const y = u ** 3 * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * b.y;
  return { x, y };
};

export function FlowCanvas({ className = "" }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const ctx = context;

    let width = 0, height = 0, frame = 0, visible = true;
    let hover = -1;
    let cityNodes: Point[] = [], segmentNodes: Point[] = [], outputNodes: Point[] = [], hub: Point = { x: 0, y: 0 };
    const particles: Particle[] = [];

    const resize = () => {
      const box = element.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      element.width = width * ratio;
      element.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const top = 26, bottom = height - 14;
      const spread = (count: number, index: number, a = top, b = bottom) => a + ((b - a) * (index + 0.5)) / count;
      const narrow = width < 560;
      const cityX = narrow ? 66 : 92;
      cityNodes = CITIES.map((_, i) => ({ x: cityX, y: spread(CITIES.length, i) }));
      segmentNodes = SEGMENTS.map((_, i) => ({ x: width * 0.42, y: spread(SEGMENTS.length, i, height * 0.16, height * 0.84) }));
      hub = { x: width * 0.66, y: height / 2 };
      outputNodes = OUTPUTS.map((_, i) => ({ x: width - (narrow ? 58 : 84), y: spread(OUTPUTS.length, i, height * 0.2, height * 0.8) }));
      if (reduced) draw();
    };

    const route = (cityIndex: number) => {
      const city = cityNodes[cityIndex];
      const segment = segmentNodes[(cityIndex * 7) % SEGMENTS.length];
      const output = outputNodes[Math.floor(Math.random() * OUTPUTS.length)];
      return [city, segment, hub, output];
    };

    const line = (a: Point, b: Point, color: string, alpha: number, lineWidth = 1) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      const mid = (a.x + b.x) / 2;
      ctx.bezierCurveTo(mid, a.y, mid, b.y, b.x, b.y);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    function draw() {
      ctx.clearRect(0, 0, width, height);
      cityNodes.forEach((city, index) => {
        const segment = segmentNodes[(index * 7) % SEGMENTS.length];
        const active = hover === index;
        line(city, segment, active ? GREEN : RULE, active ? 1 : 0.9, active ? 1.5 : 1);
        if (active) line(segment, hub, GREEN, 1, 1.5);
      });
      segmentNodes.forEach((segment) => line(segment, hub, RULE, 0.9));
      outputNodes.forEach((output) => line(hub, output, RULE, 0.9));

      ctx.textBaseline = "middle";
      ctx.font = `${width < 560 ? 9.5 : 11}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "right";
      cityNodes.forEach((city, index) => {
        ctx.fillStyle = hover === index ? GREEN : INK;
        ctx.fillText(CITIES[index], city.x - 9, city.y);
        ctx.beginPath();
        ctx.arc(city.x, city.y, hover === index ? 3.5 : 2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.textAlign = "center";
      segmentNodes.forEach((segment, index) => {
        ctx.fillStyle = "#F5F4EF";
        ctx.fillRect(segment.x - 34, segment.y - 8, 68, 16);
        ctx.fillStyle = MUTED;
        ctx.fillText(SEGMENTS[index], segment.x, segment.y);
      });
      // The warehouse: a solid block with the fact table's name.
      const blockHeight = Math.min(height * 0.5, 170);
      ctx.fillStyle = GREEN;
      ctx.fillRect(hub.x - 7, hub.y - blockHeight / 2, 14, blockHeight);
      ctx.fillStyle = INK;
      ctx.fillText("FACT_SALES", hub.x, hub.y - blockHeight / 2 - 11);
      ctx.textAlign = "left";
      outputNodes.forEach((output, index) => {
        ctx.fillStyle = INK;
        ctx.fillText(OUTPUTS[index], output.x + 9, output.y);
        ctx.beginPath();
        ctx.arc(output.x, output.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = MUTED;
      ctx.font = `10px "IBM Plex Mono", monospace`;
      ctx.textAlign = "right";
      ctx.fillText("STORES", cityNodes[0].x + 2, 10);
      ctx.textAlign = "center";
      ctx.fillText("CUSTOMERS", segmentNodes[0].x, 10);
      ctx.fillText("ANALYSIS", outputNodes[0].x + 12, 10);

      particles.forEach((particle) => {
        const leg = Math.min(Math.floor(particle.t), particle.path.length - 2);
        const position = bezier(particle.path[leg], particle.path[leg + 1], particle.t - leg);
        if (particle.rupee) {
          ctx.fillStyle = ORANGE;
          ctx.font = `600 11px "IBM Plex Mono", monospace`;
          ctx.textAlign = "center";
          ctx.fillText("₹", position.x, position.y);
        } else {
          ctx.fillStyle = GREEN;
          ctx.beginPath();
          ctx.arc(position.x, position.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    let last = performance.now();
    let spawn = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible) {
        last = now;
        return;
      }
      const delta = Math.min(now - last, 50) / 1000;
      last = now;
      spawn += delta;
      if (spawn > 0.11 && particles.length < 70) {
        spawn = 0;
        const city = hover >= 0 && Math.random() < 0.6 ? hover : Math.floor(Math.random() * CITIES.length);
        particles.push({ path: route(city), t: 0, speed: 0.45 + Math.random() * 0.3, rupee: Math.random() < 0.22 });
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].t += particles[i].speed * delta;
        if (particles[i].t >= particles[i].path.length - 1) particles.splice(i, 1);
      }
      draw();
    };

    const onMove = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const y = event.clientY - box.top;
      const x = event.clientX - box.left;
      if (x > width * 0.4) {
        hover = -1;
        return;
      }
      let nearest = -1, best = 16;
      cityNodes.forEach((node, index) => {
        const distance = Math.abs(node.y - y);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      });
      hover = nearest;
    };
    const onLeave = () => {
      hover = -1;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const screen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    screen.observe(element);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    if (reduced) draw();
    else frame = requestAnimationFrame(tick);
    document.fonts?.ready.then(() => reduced && draw());

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      screen.disconnect();
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  return <canvas ref={canvas} className={`block h-full w-full ${className}`} role="img" aria-label="Diagram: sales from twelve Indian cities flow through customers into the FACT_SALES warehouse table, then out to OLAP, RFM, Apriori and reports." />;
}

// The login panel's field: a transaction ledger rendered as ticks that breathe around the pointer.
export function LedgerField({ color = "#F5F4EF" }: { color?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ctx = context;
    let width = 0, height = 0, frame = 0, visible = true;
    let pointerX = -999, pointerY = -999;
    const GAP = 13;

    const resize = () => {
      const box = element.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      element.width = width * ratio;
      element.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (let x = GAP; x < width; x += GAP) {
        for (let y = GAP; y < height; y += GAP * 1.6) {
          const wave = Math.sin(x * 0.012 + time * 0.00045) + Math.cos(y * 0.016 - time * 0.00035);
          const distance = Math.hypot(x - pointerX, y - pointerY);
          const lift = Math.max(0, 1 - distance / 170);
          const size = 1.5 + (wave + 2) * 1.5 + lift * 8;
          ctx.globalAlpha = 0.07 + (wave + 2) * 0.035 + lift * 0.4;
          ctx.beginPath();
          ctx.moveTo(x, y - size / 2);
          ctx.lineTo(x, y + size / 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (visible) draw(time);
    };
    const onMove = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      pointerX = event.clientX - box.left;
      pointerY = event.clientY - box.top;
    };
    resize();
    const observer = new ResizeObserver(() => {
      resize();
      if (reduced) draw(0);
    });
    observer.observe(element);
    const screen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    screen.observe(element);
    const host = element.parentElement;
    host?.addEventListener("pointermove", onMove);
    if (reduced) draw(0);
    else frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      screen.disconnect();
      host?.removeEventListener("pointermove", onMove);
    };
  }, [reduced, color]);

  return <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
