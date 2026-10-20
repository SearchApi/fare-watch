import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SearchApiClient, cacheKey, cleanParams, summarize } from "../server/searchapi.mjs";

function fakeFetch(payload, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: status < 400,
      status,
      text: async () => JSON.stringify(payload),
    };
  };
  fn.calls = calls;
  return fn;
}

test("cache key ignores order and drops the api key", () => {
  const a = cacheKey("google_flights", cleanParams({ b: "2", a: "1", api_key: "x" }));
  const b = cacheKey("google_flights", cleanParams({ a: 1, b: 2 }));
  assert.equal(a, b);
});

test("second identical search is served from disk and does not call SearchApi", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fare-grid-"));
  try {
    const fetchImpl = fakeFetch({ calendar: [{ departure: "2026-12-01", return: "2026-12-10", price: 900 }] });
    const client = new SearchApiClient({ dataDir: dir, fetchImpl });
    await client.init();
    const params = { departure_id: "JFK", arrival_id: "LIS", outbound_date: "2026-12-01", return_date: "2026-12-10" };

    const first = await client.search({ engine: "google_flights_calendar", params, apiKey: "k" });
    assert.equal(first.cached, false);
    assert.equal(fetchImpl.calls.length, 1);
    assert.match(fetchImpl.calls[0].init.headers.Authorization, /^Bearer k$/);
    assert.ok(!fetchImpl.calls[0].url.includes("api_key="));

    const second = await client.search({ engine: "google_flights_calendar", params, apiKey: "" });
    assert.equal(second.cached, true);
    assert.equal(fetchImpl.calls.length, 1);

    const usage = await client.usage();
    assert.equal(usage.liveCalls, 1);
    assert.equal(usage.byEngine.google_flights_calendar, 1);

    const library = await client.library();
    assert.equal(library.length, 1);
    assert.equal(library[0].summary.lowest, 900);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refresh bypasses the cache", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fare-grid-"));
  try {
    const fetchImpl = fakeFetch({ deals: [] });
    const client = new SearchApiClient({ dataDir: dir, fetchImpl });
    await client.init();
    const params = { departure_id: "JFK", q: "beaches" };
    await client.search({ engine: "google_flights_deals", params, apiKey: "k" });
    await client.search({ engine: "google_flights_deals", params, apiKey: "k", refresh: true });
    assert.equal(fetchImpl.calls.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("errors from SearchApi are surfaced with their status", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fare-grid-"));
  try {
    const client = new SearchApiClient({ dataDir: dir, fetchImpl: fakeFetch({ error: "Invalid API key" }, 401) });
    await client.init();
    await assert.rejects(
      client.search({ engine: "google_flights", params: { departure_id: "A", arrival_id: "B" }, apiKey: "bad" }),
      (err) => err.status === 401 && /Invalid API key/.test(err.message),
    );
    await assert.rejects(
      client.search({ engine: "google_search", params: {}, apiKey: "k" }),
      (err) => err.status === 400,
    );
    await assert.rejects(
      client.search({ engine: "google_flights", params: { departure_id: "A" }, apiKey: "" }),
      (err) => err.status === 401,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summaries describe each engine", () => {
  const flights = summarize("google_flights", {
    params: { departure_id: "JFK", arrival_id: "LIS", outbound_date: "2026-12-01", return_date: "2026-12-10", departure_token: "t" },
    data: { best_flights: [{ price: 700 }] },
  });
  assert.equal(flights.step, "return");
  assert.equal(flights.lowest, 700);
  const deals = summarize("google_flights_deals", { params: { departure_id: "JFK", q: "ski" }, data: { deals: [1, 2] } });
  assert.equal(deals.count, 2);
});

test("cacheOnly never calls SearchApi", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fare-grid-"));
  try {
    const fetchImpl = fakeFetch({ calendar: [] });
    const client = new SearchApiClient({ dataDir: dir, fetchImpl });
    await client.init();
    await assert.rejects(
      client.search({ engine: "google_flights_calendar", params: { departure_id: "A", arrival_id: "B" }, apiKey: "k", cacheOnly: true }),
      (err) => err.status === 404,
    );
    assert.equal(fetchImpl.calls.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
