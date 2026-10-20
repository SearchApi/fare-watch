// Pure helpers shared by the browser and the tests. No network, no DOM.

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86400000);
}

export function dateRange(start, end) {
  if (!start || !end || end < start) return [];
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// How many date pairs the calendar call will cover. Google caps it at 200.
export function combinationCount({ flightType, outStart, outEnd, retStart, retEnd }) {
  const outbound = dateRange(outStart, outEnd).length;
  if (flightType === "one_way") return outbound;
  return outbound * dateRange(retStart, retEnd).length;
}

// Turns the calendar array into rows (outbound) x columns (return).
export function buildGrid(calendar, flightType = "round_trip") {
  const entries = Array.isArray(calendar) ? calendar : [];
  const outbounds = [...new Set(entries.map((e) => e.departure))].sort();
  const returns =
    flightType === "one_way" ? [null] : [...new Set(entries.map((e) => e.return))].sort();
  const byKey = new Map();
  for (const e of entries) byKey.set(`${e.departure}|${e.return ?? ""}`, e);

  const prices = entries.map((e) => e.price).filter((p) => typeof p === "number");
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;

  const rows = outbounds.map((dep) => ({
    departure: dep,
    cells: returns.map((ret) => {
      const entry = byKey.get(`${dep}|${ret ?? ""}`) || null;
      const price = entry && typeof entry.price === "number" ? entry.price : null;
      return {
        departure: dep,
        return: ret,
        price,
        noFlights: Boolean(entry?.has_no_flights) || (entry !== null && price === null),
        missing: entry === null,
        lowest: Boolean(entry?.is_lowest_price) || (price !== null && price === min),
        tripLength: ret ? daysBetween(dep, ret) : null,
        tone: price === null || min === null || max === min ? 0 : (price - min) / (max - min),
      };
    }),
  }));

  return { rows, columns: returns, min, max, count: entries.length };
}

export function cheapestCells(grid, limit = 5) {
  const all = grid.rows.flatMap((r) => r.cells).filter((c) => c.price !== null);
  all.sort((a, b) => a.price - b.price || a.departure.localeCompare(b.departure));
  return all.slice(0, limit);
}

export function gridToCsv(grid, currency = "USD") {
  const lines = [["departure", "return", "trip_length_days", `price_${currency}`, "lowest"].join(",")];
  for (const row of grid.rows) {
    for (const c of row.cells) {
      if (c.price === null) continue;
      lines.push([c.departure, c.return ?? "", c.tripLength ?? "", c.price, c.lowest ? "yes" : ""].join(","));
    }
  }
  return lines.join("\n");
}

export function minutesToText(total) {
  if (typeof total !== "number") return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m}m`;
}

export function formatMoney(value, currency = "USD") {
  if (typeof value !== "number") return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

export function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function weekday(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}
