// Money helpers. All persisted amounts are INTEGER halalas (SAR * 100).

export function toHalalas(input) {
  if (input === null || input === undefined || input === "") return 0;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("amount: not finite");
    return Math.round(input * 100);
  }
  const s = String(input).trim().replace(/[٠-٩]/g, d => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]).replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error("amount: bad format");
  const [whole, frac = ""] = s.split(".");
  const cents = (frac + "00").slice(0, 2);
  const sign = whole.startsWith("-") ? -1 : 1;
  const wAbs = whole.replace("-", "");
  return sign * (Number(wAbs) * 100 + Number(cents));
}

export function fromHalalas(h) {
  const n = Number(h) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${cents}`;
}

export function formatSAR(h) {
  return `${fromHalalas(h)} ر.س`;
}

// computeClosing: شغل الصيغة مع opening من آخر رصيد للخزنة.
// المصاريف من العهدة الدائمة لا تخصم من الخزنة.
export function computeClosing({
  total_shift_sales_h,
  network_sales_h,
  apps_sales_h,
  cash_in_safe_h,
  opening_cash_in_safe_h,
}) {
  const cash_sales_h = total_shift_sales_h - network_sales_h - apps_sales_h;
  const expected_cash_h = opening_cash_in_safe_h + cash_sales_h;
  const discrepancy_h = cash_in_safe_h - expected_cash_h;
  return { cash_sales_h, expected_cash_h, discrepancy_h };
}
