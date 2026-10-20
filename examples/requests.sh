#!/usr/bin/env bash
# The two SearchApi requests behind Fare Grid, ready to run.
# Needs: curl, jq, and SEARCHAPI_API_KEY in the environment. Each request costs one credit.
#
#   export SEARCHAPI_API_KEY=your_key
#   bash examples/requests.sh JFK LIS 2026-11-30 2026-12-06 2026-12-07 2026-12-13
#
# Request one prices every outbound/return date pair in the window (Google Flights Calendar).
# Request two returns the itineraries and Google's price insights for the cheapest pair (Google Flights).

set -euo pipefail

FROM="${1:-JFK}"
TO="${2:-LIS}"
OUT_START="${3:-2026-11-30}"
OUT_END="${4:-2026-12-06}"
RET_START="${5:-2026-12-07}"
RET_END="${6:-2026-12-13}"
CURRENCY="${CURRENCY:-USD}"

: "${SEARCHAPI_API_KEY:?Set SEARCHAPI_API_KEY first}"

echo "# Request one: google_flights_calendar, $FROM -> $TO, outbound $OUT_START..$OUT_END, return $RET_START..$RET_END"
curl -s -G https://www.searchapi.io/api/v1/search \
  -H "Authorization: Bearer $SEARCHAPI_API_KEY" \
  --data-urlencode engine=google_flights_calendar \
  --data-urlencode "departure_id=$FROM" \
  --data-urlencode "arrival_id=$TO" \
  --data-urlencode "outbound_date=$OUT_START" \
  --data-urlencode "outbound_date_start=$OUT_START" \
  --data-urlencode "outbound_date_end=$OUT_END" \
  --data-urlencode "return_date=$RET_START" \
  --data-urlencode "return_date_start=$RET_START" \
  --data-urlencode "return_date_end=$RET_END" \
  --data-urlencode "currency=$CURRENCY" > calendar.json

echo "# $(jq '.calendar | length' calendar.json) date pairs. The five cheapest:"
jq '[.calendar[] | select(.price)] | sort_by(.price) | .[:5]' calendar.json

DEP=$(jq -r '[.calendar[] | select(.price)] | sort_by(.price)[0].departure' calendar.json)
RET=$(jq -r '[.calendar[] | select(.price)] | sort_by(.price)[0].return' calendar.json)

echo
echo "# Request two: google_flights for the cheapest pair, $DEP -> $RET"
curl -s -G https://www.searchapi.io/api/v1/search \
  -H "Authorization: Bearer $SEARCHAPI_API_KEY" \
  --data-urlencode engine=google_flights \
  --data-urlencode "departure_id=$FROM" \
  --data-urlencode "arrival_id=$TO" \
  --data-urlencode "outbound_date=$DEP" \
  --data-urlencode "return_date=$RET" \
  --data-urlencode "currency=$CURRENCY" > flights.json

jq '{dates: [.search_parameters.outbound_date, .search_parameters.return_date],
     flights: [.best_flights[] | {airline: .flights[0].airline, price, stops: ((.layovers // []) | length), hours: ((.total_duration/60) | floor), departure_token: (.departure_token[:12] + "…")}],
     insights: {level: .price_insights.price_level, lowest: .price_insights.lowest_price, typical: .price_insights.typical_price_range, history_days: (.price_insights.price_history | length), cheapest_to_book: .price_insights.cheapest_to_book}}' flights.json

echo
echo "# Saved: calendar.json and flights.json. Prices are snapshots of this moment."
