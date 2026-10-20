// Builds public/data/airports.json (the offline autocomplete list) from the MIT-licensed
// mwgg/Airports dataset: https://github.com/mwgg/Airports
// Usage: node scripts/build-airports.mjs [path-to-airports.json]
// Without a path it downloads the current dataset. The output is committed, so a clone
// works offline; rerun this when you want a fresher list.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json";

const input = process.argv[2];
const raw = input ? await readFile(input, "utf8") : await (await fetch(SOURCE)).text();
const data = JSON.parse(raw);

// [iata, name, city, country] for every airport with an IATA code.
const rows = Object.values(data)
  .filter((a) => /^[A-Z]{3}$/.test(a.iata || ""))
  .map((a) => [a.iata, a.name || "", a.city || "", a.country || ""])
  .sort((a, b) => a[0].localeCompare(b[0]));

await mkdir(path.join(root, "public", "data"), { recursive: true });
await writeFile(path.join(root, "public", "data", "airports.json"), JSON.stringify(rows));
console.log(`${rows.length} airports written to public/data/airports.json`);
