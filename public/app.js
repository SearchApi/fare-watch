import {
  addDays,
  buildGrid,
  cheapestCells,
  combinationCount,
  formatMoney,
  gridToCsv,
  minutesToText,
  shortDate,
  weekday,
} from "/lib/grid.mjs";
import { vsTypical, bookOrWait } from "/lib/insights.mjs";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  key: "",
  envKey: false,
  calendar: null, // { params, data, fetchedAt, cached }
  grid: null,
  selected: null, // { departure, return }
  flights: null, // { params, data, fetchedAt, cached }
  deals: null,
  insights: null, // { range, level, dates } from the latest flights call on the current route
  locations: { origin: [], dest: [] }, // [{ id, label }], up to MAX_LOCATIONS each
};

/* ---------- API ---------- */

async function call(engine, params, { refresh = false, cacheOnly = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.key) headers["x-searchapi-key"] = state.key;
  const res = await fetch("/api/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ engine, params, refresh, cacheOnly }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  renderUsage(body.usage);
  return body;
}

async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const body = await res.json();
    state.envKey = Boolean(body.envKey);
    renderUsage(body.usage);
    renderKeyState();
  } catch {
    // server not reachable yet
  }
}

function renderUsage(usage) {
  if (!usage) return;
  $("usage").textContent = `${usage.liveCalls ?? 0} calls`;
  $("usage").title = `${usage.sessionCalls ?? 0} this session. Cached results are free.`;
}

function renderKeyState() {
  const on = Boolean(state.key || state.envKey);
  $("key-dot").classList.toggle("is-on", on);
  $("key-label").textContent = on ? "Key" : "Connect key";
}

function sourceLabel(record) {
  const when = record.fetchedAt
    ? new Date(record.fetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  return record.cached ? `cached ${when}` : `live ${when}`;
}

function rawJson(data) {
  return `<details class="raw"><summary class="section-title">JSON</summary><pre class="kv">${esc(
    JSON.stringify(data, null, 2),
  )}</pre></details>`;
}

/* ---------- Key dialog ---------- */

$("connect-btn").addEventListener("click", () => {
  $("env-hint").hidden = !state.envKey;
  $("key-input").value = "";
  $("key-dialog").showModal();
  $("key-input").focus();
});

$("key-dialog").addEventListener("close", () => {
  if ($("key-dialog").returnValue === "save") {
    state.key = $("key-input").value.trim();
    $("key-input").value = "";
    renderKeyState();
  }
});

/* ---------- Tabs ---------- */

function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === `view-${name}`));
  if (name === "library") renderLibrary();
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

/* ---------- Tooltip ---------- */

const tooltip = $("tooltip");

function showTooltip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const pad = 14;
  const w = tooltip.offsetWidth;
  const h = tooltip.offsetHeight;
  let left = x + pad;
  let top = y + pad;
  if (left + w > window.innerWidth - 8) left = x - w - pad;
  if (top + h > window.innerHeight - 8) top = y - h - pad;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

/* ---------- Calendar form ---------- */

const form = {
  originQ: $("origin-q"),
  originId: $("origin-id"),
  destQ: $("dest-q"),
  destId: $("dest-id"),
  flightType: $("flight-type"),
  outStart: $("out-start"),
  outEnd: $("out-end"),
  retStart: $("ret-start"),
  retEnd: $("ret-end"),
  adults: $("adults"),
  travelClass: $("travel-class"),
  stops: $("stops"),
  currency: $("currency"),
  maxPrice: $("max-price"),
};

// The app opens empty every time: a default window, no airports, no grid.
// Earlier searches stay reachable in the Library.
function setDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  form.outStart.value = addDays(today, 30);
  form.outEnd.value = addDays(today, 36);
  form.retStart.value = addDays(today, 37);
  form.retEnd.value = addDays(today, 43);
  renderChips("origin");
  renderChips("dest");
  syncTripType();
  updateComboHint();
}

function syncTripType() {
  const oneWay = form.flightType.value === "one_way";
  $("return-field").style.display = oneWay ? "none" : "";
}

function windowValues() {
  return {
    flightType: form.flightType.value,
    outStart: form.outStart.value,
    outEnd: form.outEnd.value,
    retStart: form.retStart.value,
    retEnd: form.retEnd.value,
  };
}

function updateComboHint() {
  const w = windowValues();
  const hint = $("combo-hint");
  const btn = $("search-grid");
  if (!w.outStart || !w.outEnd || (w.flightType === "round_trip" && (!w.retStart || !w.retEnd))) {
    hint.textContent = "";
    hint.classList.remove("is-over");
    btn.disabled = false;
    return;
  }
  const n = combinationCount(w);
  if (n === 0) {
    hint.textContent = "The end date has to be after the start date.";
    hint.classList.add("is-over");
    btn.disabled = true;
    return;
  }
  const over = n > 200;
  hint.textContent = over
    ? `${n} date pairs, the limit is 200`
    : `${n} ${w.flightType === "one_way" ? "dates" : "date pairs"} · 1 credit`;
  hint.classList.toggle("is-over", over);
  btn.disabled = over;
}

for (const el of Object.values(form)) {
  el.addEventListener("change", () => {
    syncTripType();
    updateComboHint();
  });
}

form.outStart.addEventListener("change", () => {
  if (!form.outEnd.value || form.outEnd.value < form.outStart.value) form.outEnd.value = addDays(form.outStart.value, 6);
  if (!form.retStart.value || form.retStart.value < form.outStart.value) form.retStart.value = addDays(form.outStart.value, 7);
  if (!form.retEnd.value || form.retEnd.value < form.retStart.value) form.retEnd.value = addDays(form.retStart.value, 6);
  updateComboHint();
});

/* ---------- Location lookup ---------- */

// Google Flights accepts up to 10 airports or cities per side (comma separated):
// the grid then uses the cheapest of them for each date pair.
const MAX_LOCATIONS = 10;

function listFromIds(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
}

function syncLocationInputs(side) {
  const idEl = side === "origin" ? form.originId : form.destId;
  idEl.value = state.locations[side].map((l) => l.id).join(",");
}

function renderChips(side) {
  const list = state.locations[side];
  const box = $(`${side}-chosen`);
  if (!list.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML =
    list
      .map(
        (l, i) =>
          `<span class="loc-chip" title="${esc(l.label)}"><strong>${esc(l.id)}</strong>${
            l.label && l.label !== l.id ? `<span>${esc(l.label)}</span>` : ""
          }<button type="button" class="loc-remove" data-side="${side}" data-i="${i}" aria-label="Remove ${esc(l.id)}">×</button></span>`,
      )
      .join("");
  box.querySelectorAll(".loc-remove").forEach((b) =>
    b.addEventListener("click", () => removeLocation(b.dataset.side, Number(b.dataset.i))),
  );
}

function addLocation(side, id, label) {
  const list = state.locations[side];
  if (!list.some((l) => l.id === id)) {
    if (list.length >= MAX_LOCATIONS) {
      $(`${side}-results`).hidden = true;
      return;
    }
    list.push({ id, label: String(label || id).replace(/<[^>]+>/g, "") });
  }
  (side === "origin" ? form.originQ : form.destQ).value = "";
  $(`${side}-results`).hidden = true;
  syncLocationInputs(side);
  renderChips(side);
}

function removeLocation(side, index) {
  state.locations[side].splice(index, 1);
  syncLocationInputs(side);
  renderChips(side);
}

async function lookup(side) {
  const q = (side === "origin" ? form.originQ : form.destQ).value.trim();
  const results = $(`${side}-results`);
  if (!q) return;
  if (/^[A-Za-z]{3}(\s*,\s*[A-Za-z]{3})*$/.test(q)) {
    for (const code of q.split(",")) addLocation(side, code.trim().toUpperCase(), code.trim().toUpperCase());
    return;
  }
  results.hidden = false;
  results.innerHTML = `<div class="kv" style="padding:8px 10px">Looking up “${esc(q)}”…</div>`;
  try {
    const record = await call("google_flights_location_search", { q });
    const locations = record.data.locations || [];
    if (!locations.length) {
      results.innerHTML = `<div class="kv" style="padding:8px 10px">No matches. Try a city name or a 3-letter airport code.</div>`;
      return;
    }
    const items = [];
    for (const loc of locations) {
      const type = loc.type || "";
      const id = type === "airport" ? loc.airport_code || loc.kgmid : loc.kgmid;
      items.push(
        `<button type="button" class="lookup-item" data-id="${esc(id)}" data-label="${esc(loc.short_name || loc.full_name)}">
          <span>${esc(loc.full_name || loc.short_name)} <small>${esc(loc.description || type)}</small></span>
          <span class="code">${esc(type === "airport" ? loc.airport_code || "" : "all airports")}</span>
        </button>`,
      );
      for (const ap of loc.airports || []) {
        items.push(
          `<button type="button" class="lookup-item is-sub" data-id="${esc(ap.airport_code)}" data-label="${esc(ap.title || ap.airport_code)}">
            <span>${esc(ap.title)} <small>${esc(ap.distance || "")}</small></span>
            <span class="code">${esc(ap.airport_code)}</span>
          </button>`,
        );
      }
    }
    results.innerHTML = items.join("");
    results.querySelectorAll(".lookup-item").forEach((b) =>
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        addLocation(side, b.dataset.id, b.dataset.label);
      }),
    );
  } catch (err) {
    results.innerHTML = `<div class="error" style="margin:0">${esc(err.message)}</div>`;
  }
}

/* ---------- Offline autocomplete (no credits) ---------- */

// public/data/airports.json: [iata, name, city, country] from the MIT-licensed mwgg/Airports list.
let airports = null;
let airportsLoading = null;

function loadAirports() {
  if (airports) return Promise.resolve(airports);
  if (!airportsLoading) {
    airportsLoading = fetch("/data/airports.json")
      .then((r) => r.json())
      .then((rows) => {
        airports = rows.map(([iata, name, city, country]) => ({
          iata,
          name,
          city,
          country,
          key: `${iata} ${city} ${name}`.toLowerCase(),
        }));
        return airports;
      })
      .catch(() => (airports = []));
  }
  return airportsLoading;
}

// Big hubs get a boost so "bali" suggests Denpasar (DPS) before Bali, Cameroon (BLC),
// and "paris" suggests CDG before a small field. The offline list has no traffic data.
const MAJOR = new Set(
  (
    "ATL PEK LAX DXB HND ORD LHR PVG CDG DFW CAN AMS HKG ICN FRA DEN DEL SIN BKK JFK KUL MAD SFO CTU LAS " +
    "SEA MIA BOM IST MCO CLT YYZ SZX PHX MNL MUC LGW MEX FCO SHA SYD EWR BCN IAH SGN LGA DME BOS MSP JED TPE " +
    "ORY JNB DTW FLL CGK GRU DOH BOG LIM SCL EZE PTY MEL BNE AKL NRT KIX ZRH VIE CPH ARN OSL HEL DUB BRU LIS " +
    "ATH MXP WAW PRG BUD OTP SVO LED CAI ADD NBO CMN LOS ACC DPS HKT BLR HYD MAA CCU PNQ GIG BSB CNF SSA " +
    "REC FOR POA CWB VCP FLN MDE CUN GDL MTY SJO UIO BOG MVD YVR YUL YYC SAN AUS PDX SLC BWI DCA IAD PHL " +
    "TLV AUH RUH DMM MCT BAH KWI AMM BEY TBS BKK CMB MLE KTM DAC RGN HAN SGN PNH REP TPE PUS CJU PER ADL " +
    "CHC WLG NAN PPT HNL ANC"
  ).split(/\s+/),
);

function suggest(q, limit = 8) {
  const needle = q.trim().toLowerCase();
  if (!needle || !airports) return [];
  const scored = [];
  for (const a of airports) {
    if (!a.key.includes(needle)) continue;
    const iata = a.iata.toLowerCase();
    const city = a.city.toLowerCase();
    const name = a.name.toLowerCase();
    let score = 0;
    if (iata === needle) score = 100;
    else if (iata.startsWith(needle)) score = 90;
    else if (city === needle) score = 80;
    else if (city.startsWith(needle)) score = 75;
    else if (name.startsWith(needle)) score = 65;
    else if (city.includes(needle)) score = 60;
    else score = 50;
    if (MAJOR.has(a.iata)) score += 30;
    else if (/international/i.test(a.name)) score += 10;
    scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score || x.a.city.localeCompare(y.a.city));
  return scored.slice(0, limit).map((x) => x.a);
}

const suggestState = { origin: { items: [], active: -1 }, dest: { items: [], active: -1 } };

function renderSuggestions(side, q) {
  const box = $(`${side}-results`);
  const items = suggest(q);
  suggestState[side] = { items, active: items.length ? 0 : -1 };
  if (!q.trim()) {
    box.hidden = true;
    return;
  }
  const rows = items.map(
    (a, i) =>
      `<button type="button" class="lookup-item${i === 0 ? " is-active" : ""}" data-i="${i}">
        <span><strong class="code">${esc(a.iata)}</strong> ${esc(a.city)}${a.country ? `, ${esc(a.country)}` : ""} <small>${esc(a.name)}</small></span>
      </button>`,
  );
  if (q.trim().length >= 3) {
    rows.push(
      `<button type="button" class="lookup-item is-google" data-google="1" title="Google Flights location search · 1 credit">Search Google Flights for “${esc(q.trim())}”</button>`,
    );
  }
  box.innerHTML = rows.join("");
  box.hidden = false;
  box.querySelectorAll(".lookup-item").forEach((b) =>
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (b.dataset.google) lookup(side);
      else pickSuggestion(side, Number(b.dataset.i));
    }),
  );
}

function pickSuggestion(side, index) {
  const a = suggestState[side].items[index];
  if (!a) return;
  addLocation(side, a.iata, `${a.city || a.name}, ${a.country}`);
}

function moveActive(side, delta) {
  const st = suggestState[side];
  const box = $(`${side}-results`);
  const buttons = [...box.querySelectorAll(".lookup-item")];
  if (!buttons.length) return;
  st.active = (st.active + delta + buttons.length) % buttons.length;
  buttons.forEach((b, i) => b.classList.toggle("is-active", i === st.active));
}

function wireAutocomplete(side, input) {
  let timer = null;
  input.addEventListener("focus", () => loadAirports());
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await loadAirports();
      renderSuggestions(side, input.value);
    }, 60);
  });
  input.addEventListener("keydown", (e) => {
    const st = suggestState[side];
    const box = $(`${side}-results`);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(side, e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Escape") {
      box.hidden = true;
      return;
    }
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const q = input.value.trim();
      const exact = /^[A-Za-z]{3}$/.test(q) && airports?.find((a) => a.iata === q.toUpperCase());
      if (exact) {
        addLocation(side, exact.iata, `${exact.city}, ${exact.country}`);
        return;
      }
      const buttons = [...box.querySelectorAll(".lookup-item")];
      const active = buttons[st.active];
      if (!box.hidden && active) {
        if (active.dataset.google) lookup(side);
        else pickSuggestion(side, Number(active.dataset.i));
      } else if (q) {
        lookup(side);
      }
    }
  });
  input.addEventListener("blur", () => setTimeout(() => ($(`${side}-results`).hidden = true), 120));
}

wireAutocomplete("origin", form.originQ);
wireAutocomplete("dest", form.destQ);


/* ---------- Calendar search ---------- */

function baseFilters() {
  const p = {
    adults: form.adults.value || "1",
    travel_class: form.travelClass.value,
    stops: form.stops.value,
    currency: (form.currency.value || "USD").toUpperCase(),
  };
  if (form.maxPrice.value) p.max_price = form.maxPrice.value;
  return p;
}

function calendarParams() {
  const w = windowValues();
  const p = {
    departure_id: form.originId.value,
    arrival_id: form.destId.value,
    flight_type: w.flightType,
    outbound_date: w.outStart,
    outbound_date_start: w.outStart,
    outbound_date_end: w.outEnd,
    ...baseFilters(),
  };
  if (w.flightType === "round_trip") {
    p.return_date = w.retStart;
    p.return_date_start = w.retStart;
    p.return_date_end = w.retEnd;
  }
  return p;
}

async function searchCalendar({ refresh = false, params = null, cacheOnly = false } = {}) {
  const err = $("calendar-error");
  err.hidden = true;
  if (!params) {
    if (!form.originId.value) return lookup("origin");
    if (!form.destId.value) return lookup("dest");
    params = calendarParams();
  }
  const btn = $("search-grid");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Searching…";
  try {
    const record = await call("google_flights_calendar", params, { refresh, cacheOnly });
    state.calendar = { ...record, params };
    state.grid = buildGrid(record.data.calendar || [], params.flight_type);
    state.selected = null;
    state.insights = null;
    $("flights-panel").hidden = true;
    renderGrid();
    primeInsights();
  } catch (e) {
    if (!cacheOnly) {
      err.textContent = e.message;
      err.hidden = false;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    updateComboHint();
  }
}

$("calendar-form").addEventListener("submit", (e) => {
  e.preventDefault();
  searchCalendar();
});
$("refresh-grid").addEventListener("click", () => state.calendar && searchCalendar({ refresh: true, params: state.calendar.params }));

// The typical range comes from a flights call on this route. If one is already cached
// (free), use it to annotate the grid; otherwise the grid offers a 1-credit check.
async function primeInsights() {
  if (state.insights || !state.grid) return;
  const [cheapest] = cheapestCells(state.grid, 1);
  if (!cheapest) return;
  try {
    const params = flightParams(cheapest.departure, cheapest.return);
    const record = await call("google_flights", params, { cacheOnly: true });
    noteInsights(record.data.price_insights, params, cheapest);
  } catch {
    // nothing cached yet
  }
}

function noteInsights(pi, params, dates) {
  const cal = state.calendar?.params;
  if (!pi?.typical_price_range || !cal) return;
  if (params.departure_id !== cal.departure_id || params.arrival_id !== cal.arrival_id) return;
  state.insights = {
    range: pi.typical_price_range,
    level: pi.price_level,
    dates: { departure: dates.departure, return: dates.return ?? null },
  };
  if (state.grid) renderGrid();
}

function routeLabel(p) {
  return `${String(p.departure_id).replaceAll(",", ", ")} → ${String(p.arrival_id).replaceAll(",", ", ")}`;
}

function vsText(vs) {
  if (!vs) return "";
  if (vs.status === "below") return `${vs.pct}% below the typical range`;
  if (vs.status === "above") return `${vs.pct}% above the typical range`;
  return "inside the typical range";
}

function toneStyle(tone) {
  const a = [238, 242, 255];
  const b = [49, 46, 129];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * tone));
  return `background: rgb(${c.join(",")})`;
}

function renderGrid() {
  const { grid, calendar } = state;
  const p = calendar.params;
  const cur = p.currency || "USD";
  const panel = $("grid-panel");
  panel.hidden = false;
  $("refresh-grid").hidden = false;

  const ins = state.insights;
  const range = ins?.range || null;
  const multi = String(p.departure_id).includes(",") || String(p.arrival_id).includes(",");

  $("grid-title").textContent = `${routeLabel(p)} · ${p.flight_type === "one_way" ? "one way" : "round trip"}`;
  const typicalText = range ? ` · typical ${formatMoney(range.low_price, cur)}–${formatMoney(range.high_price, cur)}` : "";
  $("grid-meta").textContent =
    grid.count && grid.min !== null
      ? `${grid.count} ${p.flight_type === "one_way" ? "dates" : "pairs"}${multi ? " · cheapest airport" : ""} · ${formatMoney(grid.min, cur)}–${formatMoney(grid.max, cur)}${typicalText} · ${sourceLabel(calendar)}`
      : `No flights on this route in this window. Check the airports and the dates. · ${sourceLabel(calendar)}`;

  const chips = cheapestCells(grid, 5);
  $("cheapest").innerHTML =
    chips
      .map((c) => {
        const vs = vsTypical(c.price, range);
        return `<button type="button" class="chip" data-dep="${c.departure}" data-ret="${c.return ?? ""}">
          ${esc(shortDate(c.departure))}${c.return ? ` → ${esc(shortDate(c.return))} · ${c.tripLength} days` : ""} <strong>${esc(formatMoney(c.price, cur))}</strong>${
            vs && vs.status === "below" ? `<span class="vs">↓${vs.pct}% vs typical</span>` : ""
          }
        </button>`;
      })
      .join("") +
    (grid.min !== null && !range && chips[0]
      ? `<button type="button" class="chip chip-check" data-dep="${chips[0].departure}" data-ret="${chips[0].return ?? ""}" title="Opens the cheapest pair; the typical range comes with it · 1 credit">Typical range?</button>`
      : "");
  $("cheapest").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => selectDates(b.dataset.dep, b.dataset.ret || null)),
  );

  const oneWay = p.flight_type === "one_way";
  const head = oneWay
    ? ""
    : `<tr><th class="row-head">Depart ↓ Return →</th>${grid.columns
        .map((c) => `<th>${esc(weekday(c))}<small>${esc(shortDate(c))}</small></th>`)
        .join("")}</tr>`;
  const rows = grid.rows
    .map(
      (r) =>
        `<tr><th class="row-head">${esc(weekday(r.departure))} <small>${esc(shortDate(r.departure))}</small></th>${r.cells
          .map((c) => {
            if (c.price === null) {
              return `<td><span class="cell is-empty">${c.missing ? "" : "no flights"}</span></td>`;
            }
            const sel = state.selected && state.selected.departure === c.departure && state.selected.return === c.return;
            const vs = vsTypical(c.price, range);
            return `<td><button type="button" class="cell${c.tone > 0.5 ? " is-dark" : ""}${c.lowest ? " is-lowest" : ""}${sel ? " is-selected" : ""}${
              vs && vs.status === "below" ? " is-deal" : ""
            }"
              style="${toneStyle(c.tone)}" data-dep="${c.departure}" data-ret="${c.return ?? ""}" data-len="${c.tripLength ?? ""}" data-price="${c.price}" data-vs="${esc(vsText(vs))}">${esc(
              formatMoney(c.price, cur),
            )}</button></td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  $("grid").innerHTML = `<table class="grid">${head}${rows}</table>`;
  $("grid-raw").innerHTML = rawJson(calendar.data);

  $("grid").querySelectorAll(".cell:not(.is-empty)").forEach((b) => {
    b.addEventListener("click", () => selectDates(b.dataset.dep, b.dataset.ret || null));
    b.addEventListener("mousemove", (e) => {
      const ret = b.dataset.ret;
      showTooltip(
        `<strong>${esc(formatMoney(Number(b.dataset.price), cur))}</strong><br>${esc(weekday(b.dataset.dep))} ${esc(shortDate(b.dataset.dep))}${
          ret ? ` → ${esc(weekday(ret))} ${esc(shortDate(ret))}<br>${b.dataset.len} days` : ""
        }${b.dataset.vs ? `<br>${esc(b.dataset.vs)}` : ""}`,
        e.clientX,
        e.clientY,
      );
    });
    b.addEventListener("mouseleave", hideTooltip);
  });

  $("grid-legend").innerHTML = grid.min !== null
    ? `<span class="ramp"></span><span style="margin-left:12px" class="swatch"></span><span>lowest</span>${
        range ? `<span style="margin-left:12px" class="swatch deal"></span><span>below typical</span>` : ""
      }`
    : "";
}

$("export-csv").addEventListener("click", () => {
  if (!state.grid) return;
  const p = state.calendar.params;
  const csv = gridToCsv(state.grid, p.currency || "USD");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fare-watch-${String(p.departure_id).replaceAll(",", "+")}-${String(p.arrival_id).replaceAll(",", "+")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------- Flights for a date pair ---------- */

function flightParams(departure, ret, extra = {}) {
  const base = state.calendar ? state.calendar.params : calendarParams();
  const p = {
    departure_id: base.departure_id,
    arrival_id: base.arrival_id,
    flight_type: ret ? "round_trip" : "one_way",
    outbound_date: departure,
    adults: base.adults,
    travel_class: base.travel_class,
    stops: base.stops,
    currency: base.currency,
    ...extra,
  };
  if (ret) p.return_date = ret;
  if (base.max_price) p.max_price = base.max_price;
  return p;
}

async function selectDates(departure, ret, { refresh = false, cacheOnly = false } = {}) {
  state.selected = { departure, return: ret };
  if (state.grid) renderGrid();
  const panel = $("flights-panel");
  panel.hidden = false;
  $("flights-title").textContent = `${shortDate(departure)}${ret ? ` → ${shortDate(ret)}` : ""}`;
  $("flights-meta").textContent = "Loading flights…";
  $("insights").innerHTML = "";
  $("flights").innerHTML = "";
  $("returns").innerHTML = "";
  $("booking").innerHTML = "";
  if (!cacheOnly) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const params = flightParams(departure, ret);
    const record = await call("google_flights", params, { refresh, cacheOnly });
    state.flights = { ...record, params };
    renderFlights();
    noteInsights(record.data.price_insights, params, { departure, return: ret });
  } catch (e) {
    if (cacheOnly) {
      $("flights-panel").hidden = true;
      return;
    }
    $("flights-meta").textContent = "";
    $("flights").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

$("refresh-flights").addEventListener("click", () => {
  if (state.selected) selectDates(state.selected.departure, state.selected.return, { refresh: true });
});

function renderFlights() {
  const { flights } = state;
  const p = flights.params;
  const cur = p.currency || "USD";
  const d = flights.data;
  const best = d.best_flights || [];
  const other = d.other_flights || [];
  $("flights-meta").textContent = `${best.length + other.length} itineraries · ${sourceLabel(flights)}`;
  renderInsights(d.price_insights, cur);
  const html = [];
  if (best.length) html.push(`<p class="section-title">Best</p>`, best.map((f) => flightCard(f, cur, "outbound")).join(""));
  if (other.length) html.push(`<p class="section-title">Other</p>`, other.map((f) => flightCard(f, cur, "outbound")).join(""));
  if (!best.length && !other.length) html.push(`<p class="empty">No itineraries.</p>`);
  html.push(rawJson(d));
  $("flights").innerHTML = html.join("");
  bindFlightButtons($("flights"));
}

function flightCard(f, cur, stage) {
  const segs = f.flights || [];
  const legs = [];
  segs.forEach((s, i) => {
    legs.push(
      `<div class="leg">
        <span class="times">${esc(s.departure_airport?.id)} ${esc(s.departure_airport?.time)} → ${esc(s.arrival_airport?.id)} ${esc(s.arrival_airport?.time)}</span>
        <span class="num">${esc(s.airline)} ${esc(s.flight_number)} · ${esc(minutesToText(s.duration))}${s.airplane ? ` · ${esc(s.airplane)}` : ""}${s.is_overnight ? " · overnight" : ""}</span>
      </div>`,
    );
    const lay = (f.layovers || [])[i];
    if (lay && i < segs.length - 1) legs.push(`<div class="layover">${esc(minutesToText(lay.duration))} layover in ${esc(lay.name || lay.id)}</div>`);
  });
  const stops = (f.layovers || []).length;
  const em = f.carbon_emissions;
  const emText = em && typeof em.difference_percent === "number" ? ` · CO₂ ${em.difference_percent > 0 ? "+" : ""}${em.difference_percent}% vs typical` : "";
  const airlines = [...new Set(segs.map((s) => s.airline))].join(", ");
  const action =
    stage === "outbound" && f.departure_token
      ? `<button type="button" class="btn btn-small" data-action="returns" data-token="${esc(f.departure_token)}" title="1 credit">Return flights</button>`
      : f.booking_token
        ? `<button type="button" class="btn btn-small" data-action="booking" data-token="${esc(f.booking_token)}" title="1 credit">Booking options</button>`
        : "";
  return `<article class="flight">
    <img src="${esc(f.airline_logo || segs[0]?.airline_logo || "")}" alt="" loading="lazy" />
    <div>
      <div class="legs">${legs.join("")}</div>
      <div class="summary">${esc(airlines)} · ${esc(minutesToText(f.total_duration))} · ${stops === 0 ? "nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`}${emText}</div>
    </div>
    <div class="price"><div class="amount">${esc(formatMoney(f.price, cur))}</div>${action}</div>
  </article>`;
}

function bindFlightButtons(root) {
  root.querySelectorAll("[data-action='returns']").forEach((b) => b.addEventListener("click", () => loadReturns(b)));
  root.querySelectorAll("[data-action='booking']").forEach((b) => b.addEventListener("click", () => loadBooking(b)));
}

async function loadReturns(button) {
  const { flights } = state;
  const cur = flights.params.currency || "USD";
  button.disabled = true;
  $("returns").innerHTML = `<p class="section-title">Return flights</p><p class="kv">Loading…</p>`;
  $("booking").innerHTML = "";
  $("returns").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const params = { ...flights.params, departure_token: button.dataset.token };
    const record = await call("google_flights", params);
    const d = record.data;
    const list = [...(d.best_flights || []), ...(d.other_flights || [])];
    const html = [`<p class="section-title">Return flights · ${esc(sourceLabel(record))}</p>`];
    html.push(list.length ? list.map((f) => flightCard(f, cur, "return")).join("") : `<p class="empty">No return itineraries.</p>`);
    html.push(rawJson(d));
    $("returns").innerHTML = html.join("");
    bindFlightButtons($("returns"));
  } catch (e) {
    $("returns").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  } finally {
    button.disabled = false;
  }
}

async function loadBooking(button) {
  const { flights } = state;
  const cur = flights.params.currency || "USD";
  button.disabled = true;
  $("booking").innerHTML = `<p class="section-title">Booking options</p><p class="kv">Loading…</p>`;
  $("booking").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const params = { ...flights.params, booking_token: button.dataset.token };
    const record = await call("google_flights", params);
    const d = record.data;
    const options = d.booking_options || [];
    const html = [`<p class="section-title">Booking options · ${esc(sourceLabel(record))}</p>`];
    if (!options.length) html.push(`<p class="empty">No booking options.</p>`);
    for (const o of options) {
      const name = o.book_with || o.vendor || o.provider || o.name || o.title || "Option";
      const notes = [o.option_title, ...(o.flight_numbers ? [o.flight_numbers.join(" + ")] : []), ...(o.extensions || []), ...(o.baggage_prices || [])]
        .filter(Boolean)
        .map(esc)
        .join(" · ");
      const price = typeof o.price === "number" ? formatMoney(o.price, cur) : o.price ? esc(String(o.price)) : "";
      const logos = (o.airline_logos || []).map((u) => `<img src="${esc(u)}" alt="" width="24" height="24" style="vertical-align:middle;margin-right:4px" />`).join("");
      html.push(`<div class="booking-option">
        <div>${logos}<strong>${esc(name)}</strong>${o.marketed_as ? ` <span class="kv">${esc([].concat(o.marketed_as).join(", "))}</span>` : ""}<div class="kv">${notes}</div></div>
        <div class="actions"><span class="amount">${price}</span>${bookingAction(o)}</div>
      </div>`);
    }
    html.push(rawJson(d));
    $("booking").innerHTML = html.join("");
  } catch (e) {
    $("booking").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  } finally {
    button.disabled = false;
  }
}

// Google hands back the seller's page as a POST request (url + post_data), so the
// button is a small form, not a link.
function bookingAction(o) {
  const direct = o.link || o.booking_link || o.url;
  if (direct) return `<a class="btn btn-small" href="${esc(direct)}" target="_blank" rel="noreferrer">Book</a>`;
  const req = o.booking_request;
  if (!req?.url) return "";
  const fields = [];
  for (const [k, v] of new URLSearchParams(req.post_data || "")) {
    fields.push(`<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`);
  }
  return `<form method="post" action="${esc(req.url)}" target="_blank" style="margin:0">${fields.join("")}<button type="submit" class="btn btn-small">Book</button></form>`;
}

/* ---------- Price insights + history chart ---------- */

function renderInsights(pi, cur) {
  const box = $("insights");
  if (!pi) {
    box.innerHTML = "";
    return;
  }
  const range = pi.typical_price_range;
  const read = bookOrWait(pi, (n) => formatMoney(n, cur));
  const cards = [
    `<div class="stat verdict"><div class="label">Buy or wait?</div><div class="value">${esc(read.verdict)}</div><ul class="reasons">${read.reasons
      .map((r) => `<li>${esc(r)}</li>`)
      .join("")}</ul><div class="sub">A rule, not a prediction.</div></div>`,
    `<div class="stat"><div class="label">Price level</div><div class="value"><span class="level">${esc(pi.price_level || "unknown")}</span></div></div>`,
    `<div class="stat"><div class="label">Lowest</div><div class="value">${esc(formatMoney(pi.lowest_price, cur))}</div></div>`,
    range
      ? `<div class="stat"><div class="label">Typical</div><div class="value">${esc(formatMoney(range.low_price, cur))}–${esc(formatMoney(range.high_price, cur))}</div></div>`
      : "",
    typeof pi.cheapest_to_book?.estimated_savings === "number"
      ? `<div class="stat"><div class="label">Est. savings</div><div class="value">${esc(formatMoney(pi.cheapest_to_book.estimated_savings, cur))}</div><div class="sub">cheapest to book now</div></div>`
      : "",
  ];
  const history = (pi.price_history || []).filter((h) => typeof h.price === "number");
  if (history.length > 1) cards.push(historyChart(history, cur));
  box.innerHTML = cards.join("");
  if (history.length > 1) bindChart(box.querySelector("svg"), history, cur);
}

const CH = { w: 1000, h: 150, l: 56, r: 12, t: 10, b: 24 };

function scales(history) {
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.15 || max * 0.05 || 1;
  const y0 = min - pad;
  const y1 = max + pad;
  const x = (i) => CH.l + (i / (history.length - 1)) * (CH.w - CH.l - CH.r);
  const y = (v) => CH.t + (1 - (v - y0) / (y1 - y0)) * (CH.h - CH.t - CH.b);
  return { x, y, y0, y1, min, max };
}

function historyChart(history, cur) {
  const { x, y, min, max } = scales(history);
  const path = history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.price).toFixed(1)}`).join(" ");
  const ticks = [min, Math.round((min + max) / 2), max].map(
    (v) =>
      `<line class="axis" x1="${CH.l}" x2="${CH.w - CH.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tick" x="${CH.l - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${esc(
        formatMoney(Math.round(v), cur),
      )}</text>`,
  );
  const n = history.length;
  const xs = [0, Math.floor(n / 2), n - 1].map(
    (i) => `<text class="tick" x="${x(i).toFixed(1)}" y="${CH.h - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(shortDate(history[i].iso_date?.slice(0, 10)))}</text>`,
  );
  return `<div class="chart-wrap"><div class="label">${n}-day history</div>
    <svg viewBox="0 0 ${CH.w} ${CH.h}" role="img" aria-label="Daily price for this trip over the last ${n} days">
      ${ticks.join("")}${xs.join("")}
      <path class="line" d="${path}"/>
      <g class="hover" style="display:none"><line class="crosshair" y1="${CH.t}" y2="${CH.h - CH.b}"/><circle class="marker" r="4"/></g>
      <rect class="hit" x="${CH.l}" y="0" width="${CH.w - CH.l - CH.r}" height="${CH.h}" fill="transparent"/>
    </svg></div>`;
}

function bindChart(svg, history, cur) {
  const { x, y } = scales(history);
  const hover = svg.querySelector(".hover");
  const line = hover.querySelector("line");
  const dot = hover.querySelector("circle");
  const hit = svg.querySelector(".hit");
  hit.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CH.w;
    const i = Math.max(0, Math.min(history.length - 1, Math.round(((px - CH.l) / (CH.w - CH.l - CH.r)) * (history.length - 1))));
    const h = history[i];
    hover.style.display = "";
    line.setAttribute("x1", x(i));
    line.setAttribute("x2", x(i));
    dot.setAttribute("cx", x(i));
    dot.setAttribute("cy", y(h.price));
    showTooltip(`<strong>${esc(formatMoney(h.price, cur))}</strong><br>${esc(shortDate(h.iso_date?.slice(0, 10)))}`, e.clientX, e.clientY);
  });
  hit.addEventListener("mouseleave", () => {
    hover.style.display = "none";
    hideTooltip();
  });
}

/* ---------- Deals ---------- */

function dealsParams() {
  const p = {
    departure_id: $("deals-origin").value.trim().toUpperCase(),
    stops: $("deals-stops").value,
    currency: ($("deals-currency").value || "USD").toUpperCase(),
  };
  const q = $("deals-q").value.trim();
  if (q) p.q = q;
  return p;
}

async function searchDeals({ refresh = false, params = null } = {}) {
  const err = $("deals-error");
  err.hidden = true;
  params = params || dealsParams();
  try {
    const record = await call("google_flights_deals", params, { refresh });
    state.deals = { ...record, params };
    renderDeals();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

$("deals-form").addEventListener("submit", (e) => {
  e.preventDefault();
  searchDeals();
});
$("refresh-deals").addEventListener("click", () => state.deals && searchDeals({ refresh: true, params: state.deals.params }));

function renderDeals() {
  const { deals } = state;
  const p = deals.params;
  const cur = p.currency || "USD";
  const list = deals.data.deals || [];
  $("deals-panel").hidden = false;
  $("refresh-deals").hidden = false;
  $("deals-meta").textContent = `${list.length} from ${p.departure_id}${p.q ? ` · ${p.q}` : ""} · ${sourceLabel(deals)}`;
  $("deals").innerHTML = list.length
    ? list
        .map(
          (d) => `<article class="deal">
        ${d.destination?.image ? `<img src="${esc(d.destination.image)}" alt="" loading="lazy" />` : `<div style="height:120px;background:var(--indigo-soft)"></div>`}
        <div class="body">
          <h3>${esc(d.destination?.name)} <span class="kv">${esc(d.destination?.airport_code || "")}</span></h3>
          <div class="sub">${esc(shortDate(d.outbound_date))} → ${esc(shortDate(d.return_date))} · ${esc(d.trip_length_days)} days</div>
          <div class="sub">${esc(d.airline || "")}${typeof d.stops === "number" ? ` · ${d.stops === 0 ? "nonstop" : `${d.stops} stop${d.stops > 1 ? "s" : ""}`}` : ""}${d.flight_duration ? ` · ${esc(d.flight_duration)}` : ""}</div>
          <div class="price-row"><span class="amount">${esc(formatMoney(d.price, cur))}</span>${
            typeof d.typical_price === "number" ? `<span class="typical">${esc(formatMoney(d.typical_price, cur))}</span>` : ""
          }${typeof d.savings_percentage === "number" ? `<span class="save">${d.savings_percentage}% below typical</span>` : ""}</div>
          ${d.booking_link ? `<a href="${esc(d.booking_link)}" target="_blank" rel="noreferrer" class="sub">Open ↗</a>` : ""}
        </div>
      </article>`,
        )
        .join("")
    : `<p class="empty">No deals.</p>`;
  $("deals").insertAdjacentHTML("beforeend", rawJson(deals.data));
}

/* ---------- Library ---------- */

async function renderLibrary() {
  const box = $("library");
  box.innerHTML = `<p class="kv">Loading…</p>`;
  try {
    const res = await fetch("/api/library");
    const { items } = await res.json();
    if (!items.length) {
      box.innerHTML = `<p class="empty">Nothing yet.</p>`;
      return;
    }
    box.innerHTML = items
      .map((it, i) => {
        const s = it.summary || {};
        const kind = it.engine === "google_flights_calendar" ? "Calendar" : it.engine === "google_flights" ? `Flights · ${s.step || ""}` : "Deals";
        const desc =
          it.engine === "google_flights_calendar"
            ? `${s.route} · ${s.count} pairs · lowest ${formatMoney(s.lowest, s.currency)}`
            : it.engine === "google_flights"
              ? `${s.route} · ${s.dates} · from ${formatMoney(s.lowest, s.currency)}`
              : `${s.route}${s.prompt ? ` · “${s.prompt}”` : ""} · ${s.count} deals`;
        return `<button type="button" class="lib-item" data-i="${i}"><div><div class="kind">${esc(kind)}</div><div>${esc(desc)}</div></div><div class="when">${esc(
          new Date(it.fetchedAt).toLocaleString("en-US"),
        )}</div></button>`;
      })
      .join("");
    box.querySelectorAll(".lib-item").forEach((b) =>
      b.addEventListener("click", () => openLibraryItem(items[Number(b.dataset.i)])),
    );
  } catch (e) {
    box.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

function fillFormFromParams(p) {
  for (const side of ["origin", "dest"]) {
    const ids = listFromIds(side === "origin" ? p.departure_id : p.arrival_id);
    const known = new Map(state.locations[side].map((l) => [l.id, l.label]));
    state.locations[side] = ids.map((l) => ({ id: l.id, label: known.get(l.id) || l.id }));
    syncLocationInputs(side);
    renderChips(side);
  }
  form.originQ.value = "";
  form.destQ.value = "";
  form.flightType.value = p.flight_type || "round_trip";
  form.outStart.value = p.outbound_date_start || p.outbound_date;
  form.outEnd.value = p.outbound_date_end || "";
  form.retStart.value = p.return_date_start || p.return_date || "";
  form.retEnd.value = p.return_date_end || "";
  if (p.adults) form.adults.value = p.adults;
  if (p.travel_class) form.travelClass.value = p.travel_class;
  if (p.stops) form.stops.value = p.stops;
  if (p.currency) form.currency.value = p.currency;
  form.maxPrice.value = p.max_price || "";
  syncTripType();
  updateComboHint();
}

async function openLibraryItem(item) {
  const p = item.params;
  if (item.engine === "google_flights_calendar") {
    showTab("calendar");
    fillFormFromParams(p);
    await searchCalendar({ params: p });
  } else if (item.engine === "google_flights") {
    showTab("calendar");
    if (!state.calendar || state.calendar.params.departure_id !== p.departure_id || state.calendar.params.arrival_id !== p.arrival_id) {
      state.calendar = { params: { ...p } };
      state.grid = null;
      $("grid-panel").hidden = true;
    }
    if (p.departure_token || p.booking_token) {
      const { departure_token, booking_token, ...base } = p;
      state.selected = { departure: base.outbound_date, return: base.return_date || null };
      state.flights = { ...(await call("google_flights", base)), params: base };
      $("flights-panel").hidden = false;
      $("flights-title").textContent = `${shortDate(base.outbound_date)}${base.return_date ? ` → ${shortDate(base.return_date)}` : ""}`;
      renderFlights();
    } else {
      await selectDates(p.outbound_date, p.return_date || null);
    }
  } else {
    showTab("deals");
    $("deals-origin").value = p.departure_id;
    $("deals-q").value = p.q || "";
    if (p.stops) $("deals-stops").value = p.stops;
    if (p.currency) $("deals-currency").value = p.currency;
    await searchDeals({ params: p });
  }
}

/* ---------- Boot ---------- */

setDefaults();
loadStatus();
