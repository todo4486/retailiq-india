// The opening sequence. It plays once per browser session and never on internal navigation.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { EASE } from "./primitives";

const KEY = "riq.intro";
const WORD = "RETAILIQ".split("");

function alreadyPlayed() {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function IntroLoader() {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(() => !alreadyPlayed());

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // Without storage it simply plays again next time.
    }
    const timer = setTimeout(() => setVisible(false), reduced ? 0 : 2100);
    return () => clearTimeout(timer);
  }, [visible, reduced]);

  return (
    <AnimatePresence>
      {visible && !reduced && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-paper"
          initial={{ clipPath: "inset(0 0 0% 0)" }}
          exit={{ clipPath: "inset(0 0 100% 0)" }}
          transition={{ duration: 0.85, ease: EASE }}
          aria-hidden
        >
          <motion.div
            className="grid-lines absolute inset-0"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.4, ease: EASE, delay: 0.25 }}
          />
          <div className="relative flex overflow-hidden text-[clamp(2.25rem,8vw,5.5rem)] font-extrabold tracking-[0.14em]">
            {WORD.map((letter, index) => (
              <motion.span
                key={index}
                initial={{ y: "110%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 0.75, ease: EASE, delay: 0.1 + index * 0.055 }}
              >
                {letter}
              </motion.span>
            ))}
          </div>
          <div className="relative mt-5 h-px w-[min(70vw,420px)] overflow-hidden bg-rule">
            <motion.div
              className="h-px origin-left bg-accent"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1.35, ease: [0.65, 0, 0.35, 1], delay: 0.45 }}
            />
          </div>
          <motion.div
            className="eyebrow relative mt-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.6 }}
          >
            Initializing data environment
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
