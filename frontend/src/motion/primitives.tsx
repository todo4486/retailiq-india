// The shared motion system. Every page draws its movement from these pieces and timings,
// so the application moves as one thing. Only transform and opacity are animated.
import { animate, motion, useInView, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ResponsiveContainer } from "recharts";

export const EASE = [0.22, 1, 0.36, 1] as const;
export const DURATION = { fast: 0.2, base: 0.5, slow: 0.8 };
const ONCE = { once: true, margin: "-8% 0px" } as const;

export function RevealSection({ children, ...rest }: HTMLMotionProps<"section">) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={ONCE}
      transition={{ duration: DURATION.slow, ease: EASE }}
      {...rest}
    >
      {children}
    </motion.section>
  );
}

export function Reveal({ children, delay = 0, y = 18, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={ONCE}
      transition={{ duration: DURATION.base, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

// Reveals a visualization by opening a mask, top to bottom.
export function MaskReveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ clipPath: "inset(0 0 100% 0)" }}
      whileInView={{ clipPath: "inset(0 0 0% 0)" }}
      viewport={ONCE}
      transition={{ duration: 1, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

// Each line rises from behind its own mask, one after another. With inView, visibility is measured
// on the heading itself: the moving line starts fully clipped, so it can never report being seen.
export function TextLines({ lines, delay = 0, className = "", as = "h1", inView = false }: {
  lines: string[]; delay?: number; className?: string; as?: "h1" | "h2" | "h3"; inView?: boolean;
}) {
  const Tag = as;
  const heading = useRef<HTMLHeadingElement>(null);
  const seen = useInView(heading, { once: true, margin: "-4% 0px" });
  const show = !inView || seen;
  return (
    <Tag ref={heading} className={className} aria-label={lines.join(" ")}>
      {lines.map((line, index) => (
        <span key={line} className="block overflow-hidden pb-[0.08em]" aria-hidden>
          <motion.span
            className="block"
            initial={{ y: "110%" }}
            animate={{ y: show ? "0%" : "110%" }}
            transition={{ duration: 0.9, ease: EASE, delay: delay + index * 0.12 }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

// Counts up from zero the first time it is seen, then glides between later values.
export function CountUp({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const seen = useInView(element, { once: true, margin: "-5% 0px" });
  const shown = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!seen || !element.current) return;
    if (reduced) {
      element.current.textContent = format(value);
      shown.current = value;
      return;
    }
    const controls = animate(shown.current, value, {
      duration: 1.1,
      ease: EASE,
      onUpdate: (latest) => {
        shown.current = latest;
        if (element.current) element.current.textContent = format(latest);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, value, reduced]);

  // The real figure is in the accessible label, so screen readers skip the moving digits.
  return <span ref={element} className={className} aria-label={format(value)}>{format(0)}</span>;
}

// Mounts a chart when it scrolls into view, so its drawing animation is actually seen.
export function InViewChart({ children }: { children: React.ReactElement }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "-5% 0px" });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="h-full w-full">
      {visible && <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>}
    </div>
  );
}

// True while an element is on screen. Canvas animations stop drawing when this is false.
export function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const visible = useRef(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}
