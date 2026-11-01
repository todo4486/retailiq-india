// All display formatting. Money is always rupees, grouped the Indian way: ₹12,50,000.
import type { ValueFormat } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LAKH = 1_00_000;
const CRORE = 1_00_00_000;

export const int = (value: number | null | undefined) => (value == null ? "—" : Math.round(value).toLocaleString("en-IN"));

// The second argument is the currency symbol, which is always ₹ in this application.
export function money(value: number | null | undefined, _currency = "₹", decimals = 0) {
  if (value == null) return "—";
  return `${value < 0 ? "-" : ""}₹${Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

// ₹1.25 Cr, ₹8.75 L, or the full figure below a lakh.
export function moneyShort(value: number | null | undefined, _currency = "₹") {
  if (value == null) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= CRORE) return `${sign}₹${(abs / CRORE).toFixed(2)} Cr`;
  if (abs >= LAKH) return `${sign}₹${(abs / LAKH).toFixed(2)} L`;
  return money(value);
}

// Short axis labels in the Indian system.
export function compact(value: number) {
  const abs = Math.abs(value);
  const trim = (n: number) => n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, "");
  if (abs >= CRORE) return `${trim(value / CRORE)} Cr`;
  if (abs >= LAKH) return `${trim(value / LAKH)} L`;
  return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export const pct = (value: number | null | undefined, digits = 1) => (value == null ? "—" : `${(value * 100).toFixed(digits)}%`);

export const signedPct = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;

export function monthLabel(month: string) {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${year}`;
}

export function monthShort(month: string) {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ’${year.slice(2)}`;
}

export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fileSize(bytes: number) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatValue(value: unknown, format: ValueFormat | undefined, _currency = "₹") {
  if (value == null) return "—";
  const dec = (digits: number) => Number(value).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  switch (format) {
    case "money": return money(Number(value), "₹", 2);
    case "int": return int(Number(value));
    case "pct": return pct(Number(value));
    case "dec1": return dec(1);
    case "dec2": return dec(2);
    case "dec3": return Number(value).toFixed(3);
    default: return String(value);
  }
}

// Some imported catalogues are in upper case. Names already in mixed case, like "Smart TV", are left alone.
export function titleCase(text: string) {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s/+(-])([a-z])/g, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}
