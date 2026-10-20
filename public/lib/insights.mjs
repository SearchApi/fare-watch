// Rules over Google's price insights. Pure functions, shared by the browser and the tests.
// None of this predicts prices: it states where a price sits against numbers Google returned.

export function vsTypical(price, range) {
  if (
    typeof price !== "number" ||
    !range ||
    typeof range.low_price !== "number" ||
    typeof range.high_price !== "number" ||
    range.low_price <= 0
  ) {
    return null;
  }
  if (price < range.low_price) {
    return { status: "below", pct: Math.round(((range.low_price - price) / range.low_price) * 100) };
  }
  if (price > range.high_price) {
    return { status: "above", pct: Math.round(((price - range.high_price) / range.high_price) * 100) };
  }
  return { status: "within", pct: 0 };
}

// Average of the last `recentDays` against the `baseDays` before them.
export function trendOf(history, recentDays = 7, baseDays = 30) {
  const pts = (history || []).filter((h) => typeof h.price === "number");
  if (pts.length < recentDays + 3) return null;
  const recent = pts.slice(-recentDays);
  const base = pts.slice(-(recentDays + baseDays), -recentDays);
  if (!base.length) return null;
  const avg = (a) => a.reduce((s, h) => s + h.price, 0) / a.length;
  const r = avg(recent);
  const b = avg(base);
  return { pct: Math.round(((r - b) / b) * 100), recent: r, base: b, days: recent.length, baseDays: base.length };
}

export function bookOrWait(pi, fmt = (n) => String(n)) {
  const price = pi?.lowest_price;
  const range = pi?.typical_price_range;
  const level = pi?.price_level;
  const vs = vsTypical(price, range);
  const trend = trendOf(pi?.price_history);
  const savings = pi?.cheapest_to_book?.estimated_savings;
  const reasons = [];

  if (level) reasons.push(`Google rates the current price as "${level}".`);
  if (vs) {
    const span = `${fmt(range.low_price)} to ${fmt(range.high_price)}`;
    if (vs.status === "below") reasons.push(`${fmt(price)} is ${vs.pct}% below the typical range (${span}).`);
    else if (vs.status === "above") reasons.push(`${fmt(price)} is ${vs.pct}% above the typical range (${span}).`);
    else reasons.push(`${fmt(price)} sits inside the typical range (${span}).`);
  }
  if (trend) {
    if (trend.pct <= -3) {
      reasons.push(`The last ${trend.days} days average ${Math.abs(trend.pct)}% below the previous ${trend.baseDays}: the price has been falling.`);
    } else if (trend.pct >= 3) {
      reasons.push(`The last ${trend.days} days average ${trend.pct}% above the previous ${trend.baseDays}: the price has been rising.`);
    } else {
      reasons.push(`The last ${trend.days} days are flat against the previous ${trend.baseDays}.`);
    }
  }
  if (typeof savings === "number") {
    reasons.push(`Google flags this as the cheapest time to book, estimating ${fmt(savings)} in savings.`);
  }

  let verdict;
  if ((vs && vs.status === "below") || level === "low") verdict = "Good time to buy";
  else if (typeof savings === "number") verdict = "Lean towards buying";
  else if (level === "high" && trend && trend.pct <= -3) verdict = "Worth waiting a few days";
  else if (level === "high" || (vs && vs.status === "above")) verdict = "High: try other dates first";
  else if (trend && trend.pct >= 3) verdict = "Typical and rising: buy if the dates work";
  else if (reasons.length) verdict = "Typical: no strong reason to wait";
  else verdict = "Not enough data";

  return { verdict, reasons, vs, trend };
}
