// A dropdown with animated expansion and staggered items. It takes <option> children and calls
// onChange with { target: { value } }, the same interface as a native <select>.
import { AnimatePresence, motion } from "motion/react";
import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { EASE } from "../motion/primitives";

interface Option { value: string; label: string }

function readOptions(children: ReactNode): Option[] {
  const list: Option[] = [];
  Children.forEach(children, (child) => {
    if (Array.isArray(child)) list.push(...readOptions(child));
    else if (isValidElement(child)) {
      const element = child as ReactElement<{ value?: string | number; children?: ReactNode }>;
      const label = Children.toArray(element.props.children).join("");
      list.push({ value: String(element.props.value ?? label), label });
    }
  });
  return list;
}

export function Select({ value, onChange, children, disabled, className = "", "aria-label": ariaLabel }: {
  value: string | number; onChange: (event: { target: { value: string } }) => void; children: ReactNode;
  disabled?: boolean; className?: string; "aria-label"?: string;
}) {
  const options = readOptions(children);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [upward, setUpward] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === String(value));

  useEffect(() => {
    if (!open) return;
    const rect = box.current?.getBoundingClientRect();
    setUpward(Boolean(rect && window.innerHeight - rect.bottom < 260 && rect.top > 260));
    setActive(Math.max(options.findIndex((o) => o.value === String(value)), 0));
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (option: Option) => {
    setOpen(false);
    if (option.value !== String(value)) onChange({ target: { value: option.value } });
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (options[active]) choose(options[active]);
    } else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(event) => { event.preventDefault(); setOpen((o) => !o); }}
        onKeyDown={onKey}
        className={`field flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${open ? "!border-ink" : ""}`}
      >
        <span className="truncate">{current?.label ?? "—"}</span>
        <motion.svg width="10" height="6" viewBox="0 0 10 6" className="shrink-0" animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} aria-hidden>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" />
        </motion.svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            ref={list}
            id={id}
            role="listbox"
            className={`absolute z-40 max-h-64 min-w-full overflow-y-auto border border-ink bg-card py-1 ${upward ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"}`}
            style={{ transformOrigin: upward ? "bottom" : "top" }}
            initial={{ opacity: 0, scaleY: 0.92, y: upward ? 4 : -4 }}
            animate={{ opacity: 1, scaleY: 1, y: 0 }}
            exit={{ opacity: 0, scaleY: 0.96, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {options.map((option, index) => (
              <motion.li
                key={option.value}
                role="option"
                aria-selected={option.value === String(value)}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(index, 8) * 0.018 }}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`num cursor-pointer whitespace-nowrap px-2.5 py-1.5 text-[12px] ${index === active ? "bg-accent text-paper" : option.value === String(value) ? "text-accent" : ""}`}
              >
                {option.label}
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
