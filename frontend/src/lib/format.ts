// Locale helpers: INR and DD/MM/YYYY throughout (see CLAUDE.md "Decisions locked for v1").

/** YYYY-MM-DD -> DD/MM/YYYY. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** ₹1,23,456 — Indian digit grouping. */
export function inr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/** ₹7.47L / ₹92,000 — compact form for headline figures. */
export function inrCompact(amount: number): string {
  if (Math.abs(amount) >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(2)}Cr`;
  if (Math.abs(amount) >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(2)}L`;
  return inr(amount);
}

/** Today's date in the browser's timezone as YYYY-MM-DD. Not toISOString(),
 * which is UTC and gives yesterday's date before 05:30 IST. */
export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonthISO(): string {
  return todayISO().slice(0, 7);
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "today" / "tomorrow" / "Thu 02/10" relative to the local date. */
export function relativeDay(iso: string): string {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === addDaysISO(today, 1)) return "Tomorrow";
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short" });
  return `${weekday} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** "2026-09" -> "September 2026". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function hoursSince(isoDateTime: string): number {
  // Backend timestamps are naive UTC.
  const ts = isoDateTime.endsWith("Z") ? isoDateTime : `${isoDateTime}Z`;
  return Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 3_600_000));
}

/** "2026-09" + n months. */
export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Unique key for one submit attempt (see recordPayment). randomUUID needs a
 * secure context; the fallback covers plain-http LAN testing. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
