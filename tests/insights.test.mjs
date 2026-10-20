import test from "node:test";
import assert from "node:assert/strict";
import { vsTypical, trendOf, bookOrWait } from "../public/lib/insights.mjs";

const range = { low_price: 420, high_price: 690 };

test("vsTypical places a price against the range", () => {
  assert.deepEqual(vsTypical(378, range), { status: "below", pct: 10 });
  assert.deepEqual(vsTypical(500, range), { status: "within", pct: 0 });
  assert.deepEqual(vsTypical(759, range), { status: "above", pct: 10 });
  assert.equal(vsTypical(null, range), null);
  assert.equal(vsTypical(500, null), null);
});

function history(values) {
  return values.map((price, i) => ({ price, iso_date: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
}

test("trendOf compares the last week with the month before", () => {
  const falling = history([...Array(30).fill(600), ...Array(7).fill(540)]);
  assert.equal(trendOf(falling).pct, -10);
  const flat = history(Array(20).fill(600));
  assert.equal(trendOf(flat).pct, 0);
  assert.equal(trendOf(history([1, 2, 3])), null);
});

test("bookOrWait verdicts follow the rules", () => {
  const below = bookOrWait({ lowest_price: 380, price_level: "high", typical_price_range: range });
  assert.equal(below.verdict, "Good time to buy");

  const savings = bookOrWait({ lowest_price: 597, price_level: "high", typical_price_range: range, cheapest_to_book: { estimated_savings: 56 } });
  assert.equal(savings.verdict, "Lean towards buying");
  assert.ok(savings.reasons.some((r) => r.includes("56")));

  const highFalling = bookOrWait({
    lowest_price: 700,
    price_level: "high",
    typical_price_range: range,
    price_history: history([...Array(30).fill(760), ...Array(7).fill(700)]),
  });
  assert.equal(highFalling.verdict, "Worth waiting a few days");

  const high = bookOrWait({ lowest_price: 700, price_level: "high", typical_price_range: range });
  assert.equal(high.verdict, "High: try other dates first");

  const typical = bookOrWait({ lowest_price: 500, price_level: "typical", typical_price_range: range });
  assert.equal(typical.verdict, "Typical: no strong reason to wait");

  assert.equal(bookOrWait(null).verdict, "Not enough data");
});

test("bookOrWait formats money through the formatter", () => {
  const v = bookOrWait({ lowest_price: 380, typical_price_range: range }, (n) => `$${n}`);
  assert.ok(v.reasons[0].startsWith("$380 is 10% below the typical range ($420 to $690)"));
});
