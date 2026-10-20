import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dateRange,
  combinationCount,
  buildGrid,
  cheapestCells,
  gridToCsv,
  minutesToText,
} from "../public/lib/grid.mjs";

test("date helpers", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(dateRange("2026-12-01", "2026-12-03"), ["2026-12-01", "2026-12-02", "2026-12-03"]);
  assert.deepEqual(dateRange("2026-12-03", "2026-12-01"), []);
});

test("combination count for round trip and one way", () => {
  assert.equal(
    combinationCount({
      flightType: "round_trip",
      outStart: "2026-11-25",
      outEnd: "2026-12-08",
      retStart: "2026-12-09",
      retEnd: "2026-12-22",
    }),
    196,
  );
  assert.equal(
    combinationCount({ flightType: "one_way", outStart: "2026-11-25", outEnd: "2026-12-08" }),
    14,
  );
});

const calendar = [
  { departure: "2026-12-01", return: "2026-12-10", price: 1500, is_lowest_price: true },
  { departure: "2026-12-01", return: "2026-12-11", price: 1800 },
  { departure: "2026-12-02", return: "2026-12-10", price: 2100 },
  { departure: "2026-12-02", return: "2026-12-11", has_no_flights: true },
];

test("grid rows, columns and tones", () => {
  const grid = buildGrid(calendar);
  assert.equal(grid.rows.length, 2);
  assert.deepEqual(grid.columns, ["2026-12-10", "2026-12-11"]);
  assert.equal(grid.min, 1500);
  assert.equal(grid.max, 2100);
  const first = grid.rows[0].cells[0];
  assert.equal(first.lowest, true);
  assert.equal(first.tone, 0);
  assert.equal(first.tripLength, 9);
  const empty = grid.rows[1].cells[1];
  assert.equal(empty.noFlights, true);
  assert.equal(empty.price, null);
});

test("cheapest cells are sorted by price", () => {
  const cells = cheapestCells(buildGrid(calendar), 2);
  assert.deepEqual(
    cells.map((c) => c.price),
    [1500, 1800],
  );
});

test("csv export skips empty cells", () => {
  const csv = gridToCsv(buildGrid(calendar), "USD");
  const lines = csv.split("\n");
  assert.equal(lines[0], "departure,return,trip_length_days,price_USD,lowest");
  assert.equal(lines.length, 4);
  assert.equal(lines[1], "2026-12-01,2026-12-10,9,1500,yes");
});

test("one way grid has a single column", () => {
  const grid = buildGrid(
    [
      { departure: "2026-12-01", price: 300 },
      { departure: "2026-12-02", price: 250, is_lowest_price: true },
    ],
    "one_way",
  );
  assert.equal(grid.columns.length, 1);
  assert.equal(grid.rows[1].cells[0].lowest, true);
});

test("minutes to text", () => {
  assert.equal(minutesToText(1700), "28h 20m");
  assert.equal(minutesToText(45), "45m");
});
