// Business date helpers (timezone-aware, no external libs).
// Asia/Riyadh is UTC+3 with no DST, so a fixed offset is safe and simple.

const RIYADH_OFFSET_MIN = 180;

export function nowIso() {
  return new Date().toISOString();
}

export function businessDate(d = new Date(), offsetMin = RIYADH_OFFSET_MIN) {
  const shifted = new Date(d.getTime() + offsetMin * 60000);
  return shifted.toISOString().slice(0, 10);
}

export function isValidBusinessDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function addDays(yyyymmdd, days) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function rangeFor(period, anchor) {
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "week") {
    const [y, m, d] = anchor.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay();
    const diff = (dow + 1) % 7;
    const start = addDays(anchor, -diff);
    return { from: start, to: addDays(start, 6) };
  }
  if (period === "month") {
    const [y, m] = anchor.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${anchor.slice(0, 7)}-01`, to: `${anchor.slice(0, 7)}-${String(last).padStart(2, "0")}` };
  }
  return { from: anchor, to: anchor };
}
