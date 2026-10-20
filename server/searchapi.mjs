// Thin SearchApi client with a disk cache and a credit counter.
// Every live call costs SearchApi credits; cached responses are free.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

export const ENGINES = new Set([
  "google_flights",
  "google_flights_calendar",
  "google_flights_deals",
  "google_flights_location_search",
]);

const BASE_URL = "https://www.searchapi.io/api/v1/search";

export function cacheKey(engine, params) {
  const ordered = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(`${engine}?${ordered}`).digest("hex");
}

export function cleanParams(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (k === "api_key" || k === "engine") continue;
    if (v === undefined || v === null || v === "") continue;
    out[k] = String(v);
  }
  return out;
}

export class SearchApiClient {
  constructor({ dataDir, fetchImpl = fetch }) {
    this.dataDir = dataDir;
    this.cacheDir = path.join(dataDir, "cache");
    this.usageFile = path.join(dataDir, "usage.json");
    this.fetchImpl = fetchImpl;
    this.sessionCalls = 0;
  }

  async init() {
    for (const engine of ENGINES) {
      await mkdir(path.join(this.cacheDir, engine), { recursive: true });
    }
  }

  async usage() {
    let total = { liveCalls: 0, byEngine: {} };
    try {
      total = JSON.parse(await readFile(this.usageFile, "utf8"));
    } catch {
      // first run
    }
    return { ...total, sessionCalls: this.sessionCalls };
  }

  async recordCall(engine) {
    const current = await this.usage();
    const next = {
      liveCalls: (current.liveCalls || 0) + 1,
      byEngine: { ...(current.byEngine || {}) },
    };
    next.byEngine[engine] = (next.byEngine[engine] || 0) + 1;
    this.sessionCalls += 1;
    await writeFile(this.usageFile, JSON.stringify(next, null, 2));
  }

  cachePath(engine, key) {
    return path.join(this.cacheDir, engine, `${key}.json`);
  }

  async readCache(engine, key) {
    try {
      return JSON.parse(await readFile(this.cachePath(engine, key), "utf8"));
    } catch {
      return null;
    }
  }

  // Returns { cached, fetchedAt, engine, params, data }.
  async search({ engine, params, apiKey, refresh = false, cacheOnly = false }) {
    if (!ENGINES.has(engine)) {
      throw Object.assign(new Error(`Engine not allowed: ${engine}`), { status: 400 });
    }
    const clean = cleanParams(params);
    const key = cacheKey(engine, clean);

    if (!refresh) {
      const hit = await this.readCache(engine, key);
      if (hit) return { ...hit, cached: true };
    }
    if (cacheOnly) {
      throw Object.assign(new Error("Not cached."), { status: 404 });
    }

    if (!apiKey) {
      throw Object.assign(new Error("Connect your SearchApi key first."), { status: 401 });
    }

    const url = new URL(BASE_URL);
    url.searchParams.set("engine", engine);
    for (const [k, v] of Object.entries(clean)) url.searchParams.set(k, v);

    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Object.assign(new Error(`SearchApi returned a non-JSON response (${res.status}).`), {
        status: 502,
      });
    }
    if (!res.ok) {
      const message = data?.error || `SearchApi error ${res.status}`;
      throw Object.assign(new Error(message), { status: res.status });
    }

    await this.recordCall(engine);
    const record = {
      engine,
      params: clean,
      fetchedAt: new Date().toISOString(),
      data,
    };
    await writeFile(this.cachePath(engine, key), JSON.stringify(record));
    return { ...record, cached: false };
  }

  // Metadata of cached searches, newest first. Reading it never calls SearchApi.
  async library() {
    const items = [];
    for (const engine of ["google_flights_calendar", "google_flights", "google_flights_deals"]) {
      let files = [];
      try {
        files = await readdir(path.join(this.cacheDir, engine));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const record = JSON.parse(
            await readFile(path.join(this.cacheDir, engine, file), "utf8"),
          );
          items.push({
            engine,
            params: record.params,
            fetchedAt: record.fetchedAt,
            summary: summarize(engine, record),
          });
        } catch {
          // skip corrupt file
        }
      }
    }
    items.sort((a, b) => (a.fetchedAt < b.fetchedAt ? 1 : -1));
    return items;
  }
}

export function summarize(engine, record) {
  const p = record.params || {};
  const d = record.data || {};
  if (engine === "google_flights_calendar") {
    const prices = (d.calendar || []).map((c) => c.price).filter((n) => typeof n === "number");
    return {
      route: `${p.departure_id} → ${p.arrival_id}`,
      count: (d.calendar || []).length,
      lowest: prices.length ? Math.min(...prices) : null,
      currency: p.currency || "USD",
    };
  }
  if (engine === "google_flights") {
    const best = (d.best_flights || [])[0] || (d.other_flights || [])[0];
    return {
      route: `${p.departure_id} → ${p.arrival_id}`,
      dates: [p.outbound_date, p.return_date].filter(Boolean).join(" to "),
      lowest: best?.price ?? (d.booking_options || [])[0]?.price ?? null,
      currency: p.currency || "USD",
      step: p.booking_token ? "booking" : p.departure_token ? "return" : "outbound",
    };
  }
  if (engine === "google_flights_deals") {
    return {
      route: `from ${p.departure_id}`,
      prompt: p.q || "",
      count: (d.deals || []).length,
      currency: p.currency || "USD",
    };
  }
  return {};
}
