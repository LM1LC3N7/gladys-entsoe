# TODO

## Before announcing

- [ ] Test with a real ENTSO-E token on a real Gladys 5.1+: discovery, the
      nine sensors over a day and a night, tomorrow's publication after
      13:00, the "Read the prices now" button, a wrong token (401).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm with a real token (built without an ENTSO-E account)

- [ ] The shape of a real A44 answer since the 15-minute market (October
      2025): one `TimeSeries` per day or one for the whole window, `PT15M`
      everywhere, the `classificationSequence` of DE-LU now.
- [ ] "No data yet" for tomorrow: an `Acknowledgement_MarketDocument` with
      reason 999, answered with HTTP 200 or 400 (both are handled).
- [ ] A wrong token answers 401 (not 403, which is treated as a passing
      error); a token whose API access is not enabled yet answers 401 too.
- [ ] The answer size for two days (expected 20-40 KB, cap 256 KB).
- [ ] The zones whose prices are not in EUR on the platform, if any (they
      are reported "not priced in EUR/MWh").
- [ ] The `text` features (cheapest time) and the `unknown` rank feature
      show on a dashboard and in scene conditions.

## Decisions

- **Version 0.1.0** set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-entsoe:0.1.0`); the
  Release workflow owns it from now on (the first patch release gives 0.1.1).
- **One zone, one device**, external id `zone:<key>` (`zone:FR`…). Changing
  the zone publishes a new device; the old one stays until the user deletes
  it (its history is kept). Several zones: see Ideas.
- **Features**: current price, next period price, today's lowest, highest
  and average price, today's cheapest period start, tomorrow's lowest price,
  tomorrow's cheapest period start, rank of the current period. **The price
  of today's cheapest period is today's lowest price**: no duplicate
  sensor. Prices are `currency` / `decimal` / `euro` (the core's currency
  unit), bounds -5 to 50 EUR/kWh as in gladys-nord-pool.
- **Times are `text` features** (`HH:MM` in the configured timezone, not
  kept in history); `--:--` while tomorrow is not published. Tomorrow's
  lowest price keeps its last value until tomorrow is published again
  (a number cannot be "unknown"); the `--:--` time tells it apart.
- **Rank is `unknown` / `unknown`**, no unit, 0 to 99: no core category
  describes a rank; equal prices share a rank (count of strictly cheaper
  periods of the local day).
- **Tariff**: (spot ÷ 1000 + fixed fees) × (1 + VAT), applied to negative
  prices as well (linear). Defaults 0 / 0: the raw wholesale price. The
  conversion happens at each tick, so a new VAT or fee needs no reading.
- **Timezone**: the SDK gives no access to the Gladys timezone, hence the
  `timezone` option (default `Europe/Paris`, the core's DEFAULT_TIMEZONE;
  an invalid name falls back to it). It sets the local days of the
  statistics and the times shown; the market schedule (13:00) stays on
  Brussels time.
- **Tomorrow is "published"** only when the whole local day of tomorrow is
  covered (a timezone east of CET would otherwise see a partial day early).
- **Overlapping series**: classification sequence 1 first, then the finer
  resolution; a period overlapping one already taken is dropped whole. No
  averaging between resolutions (hass-entso-e's option): the sensors show
  the market's own periods.
- **Unreadable point** (not a number, out of -10,000 / 100,000 EUR/MWh): the
  whole period is refused rather than "repeated" from a neighbour.
- **Answer cap 256 KB**, not the 64 KB used for other XML APIs: two days of
  quarter hours in two series (as DE-LU published) with ENTSO-E's
  indentation approach 40-70 KB. Beyond it, refused unread.
- **401 stops the readings**, as the brief asks: no retry timer (no loop),
  the tick keeps the last prices; a new token, a configuration save or the
  button reads again. The button is manual and asks once, so it is allowed
  to retry a refused token (ENTSO-E enables API access by hand, days after
  the token is generated). Restarts and reconnections keep the refusal.
- **403 is a passing error** (backoff), not a refused token: ENTSO-E
  documents 401 for a bad token.
- **429**: Retry-After within [1 min, 6 h], 10 minutes when absent (the
  platform's ban after 400 requests a minute lasts 10 minutes); every path
  (timer, restart, reconnection, button) waits for it.
- **5xx / network / timeout**: 5, 15, 30, then every 60 minutes; the last
  prices stay shown ("Showing the last prices read").
- **400 (other than "no data") and non-EUR zones**: every 6 hours, they will
  not get better by themselves.
- **No fallback host**: hass-entso-e also tries `external-api.tp.entsoe.eu`;
  one documented host is enough for a few requests a day.
- **Token format checked** (`[A-Za-z0-9-]{8,128}`) before any request: a
  pasted sentence never reaches a URL; the status says the token looks wrong.
- **No scene trigger, widget nor energy contract** in milestone 1 (not in
  the brief); gladys-nord-pool already offers the `spot-*` calendars for its
  zones, and a second integration publishing the same calendar keys would
  collide.
- **gladys_version >= 5.1.0**: no field needs 5.2 (no energy contract).
- **Reused project**: the logic of JaccoR/hass-entso-e (Apache-2.0) is
  ported and credited (THIRD_PARTY_NOTICES.md, README, docs). The npm
  clients were looked at (2026-10-17): `entsoe-api-node` 1.3.4 (MIT, pulls
  `xml2js` and `undici`) and `entsoe-api-client` 1.0.6 (MIT, pulls
  `fast-xml-parser` 4.2.5 and `@zip.js/zip.js`). Not used: each adds a
  general XML parser (the brief asks for none if possible), and the size
  cap, the linear parse and the A44 rules (missing positions, overlapping
  series) would have to be ours anyway; their code was not reviewed. The XML
  is read by our own bounded, linear scanner.

## Ideas

- Several zones in one installation (a `multi_select`, one device each).
- Scene triggers "cheapest period started", "negative price started",
  "tomorrow's prices published", and a widget, as in gladys-nord-pool.
- Energy calendars for the zones gladys-nord-pool does not cover (Spain,
  Portugal, Italy, Switzerland, Central and Eastern Europe), under keys that
  name the zone.
- Other A44-like documents: day-ahead total load forecast (A65), wind and
  solar forecast (A69), for "green hours".
