# Fare Watch

Find the cheapest dates to fly with the [SearchApi Google Flights APIs](https://www.searchapi.io/docs/google-flights-api). One call paints a grid of every outbound and return date pair in your window; a click opens the actual flights for that pair, with Google's price level, the typical price range and about two months of daily price history.

This is a local example application for developers. It is not a hosted service, a booking tool or a production-ready multi-user deployment.

## Run locally

You need Git and **Node.js 24.13.0 or newer**. No npm packages, no database, no build step.

```sh
git clone https://github.com/SearchApi/fare-watch.git
cd fare-watch
npm start
```

Open **http://127.0.0.1:5208**. If you use nvm, run `nvm install` and `nvm use` first.

If the port is in use:

```sh
# macOS / Linux
PORT=5209 npm start
```

```powershell
# Windows PowerShell
$env:PORT=5209
npm start
```

## Your first search

1. Create a [SearchApi account](https://www.searchapi.io/users/sign_up) (100 free credits) and copy your API key.
2. Click **Connect key** in the top right and paste it. The key stays in the tab's memory and goes only to the local server, which calls SearchApi. Reconnect after reloading. If you prefer, put `SEARCHAPI_API_KEY=...` in a `.env` file next to `package.json` and the server picks it up.
3. Start typing an airport or city in **From** and **To**: suggestions come from an offline list of about 7,900 airports, so they cost nothing. Enter or a click adds the airport as a chip; add up to 10 per side (the grid then shows the cheapest of them for each date pair, and the flight list tells you which airport won). The last row of the list, **Search Google Flights for …**, uses the Location Search API (1 credit) for places the offline list does not know, including "all airports of a city".
4. Pick the departure and return windows. The hint under the form tells you how many date pairs the call will cover. Google caps one calendar call at **200 pairs**.
5. **Search dates** (1 credit). The grid shows every pair, cheapest highlighted. Hover for details, click a cell or one of the "cheapest" chips to load the flights for that pair (1 credit). Once one flights call for the route exists, the grid also knows Google's **typical price range** for it: cells below the range get a green marker and the chips say how far below typical they are. **Check typical range** does that first call for the cheapest pair.
6. The flights panel opens with **Buy or wait?**: a fixed rule over Google's price insights (price level, position against the typical range, the last 7 days against the previous 30, and Google's cheapest-to-book signal), with every reason written out. It is not a prediction.
7. On a flight, **Return flights** picks that outbound and lists the return legs (1 credit); on a return leg, **Booking options** lists where to book and the price per seller (1 credit).
8. **Deals** asks Google for discounted destinations from your airport, optionally filtered by a prompt like "beaches" or "ski" (1 credit).

Every response is cached on disk in `.data/cache/`. Repeating a search with the same parameters is free and instant; use **Refresh** to spend a credit and fetch again. The app opens empty every time; the **Library** tab lists everything cached and reopens it for free. The counter in the top bar shows live calls in total (hover for this session).

## Which APIs it calls

| What you do | Engine | Cost |
|---|---|---|
| Look up a city or airport | `google_flights_location_search` | 1 credit per lookup |
| Search a date window | `google_flights_calendar` | 1 credit per grid (up to 200 pairs) |
| Open a date pair | `google_flights` | 1 credit |
| Pick an outbound to see returns | `google_flights` with `departure_token` | 1 credit |
| See booking options | `google_flights` with `booking_token` | 1 credit |
| Find deals from an airport | `google_flights_deals` | 1 credit |

Every panel has a **Raw API response** section so you can see exactly what SearchApi returned.

## Reading the numbers

- Prices are observations at the moment of the call. They move daily; a cached grid shows when it was fetched.
- "Lowest in this window" means lowest among the pairs the call covered, not the lowest possible fare.
- The price level, typical range and history come from Google's price insights, as returned by the API. Fare Watch does not predict prices.
- Booking happens on the seller's site. The app never books anything.

## What the app adds on top of the API

SearchApi returns the structured data: the calendar, the itineraries, price insights, deals and locations. Fare Watch adds the grid layout and color scale, the cheapest-pairs shortlist, the below-typical markers, the buy-or-wait rule, the multi-airport chips, the trip-length math, the history chart, the local cache, the credit counter, the library and the CSV export.

## Keys and local data

The server listens on `127.0.0.1` only. The API key is never written to disk by the app; cached responses in `.data/` include the request parameters (route, dates, filters) but not the key. `.data/` and `.env` are ignored by Git. Do not expose this server with a public tunnel.

## Development

```sh
npm test     # unit tests, no SearchApi credits spent
npm run check
```

- `public/`: browser interface (`index.html`, `app.js`, `styles.css`); `lib/grid.mjs` (grid math) and `lib/insights.mjs` (typical-range comparison, trend, buy-or-wait rule), both pure and unit-tested
- `server/searchapi.mjs`: SearchApi client with disk cache and usage counter
- `server/routes.mjs`: the local JSON API (`/api/status`, `/api/search`, `/api/library`)
- `scripts/start.mjs`: static server plus API
- `scripts/build-airports.mjs`: regenerates `public/data/airports.json`, the offline autocomplete list, from the MIT-licensed [mwgg/Airports](https://github.com/mwgg/Airports) dataset (`npm run airports`)
- `tests/`: unit tests with fake responses

## License

MIT. The airport list in `public/data/airports.json` is derived from [mwgg/Airports](https://github.com/mwgg/Airports), also MIT.
