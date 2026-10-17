# gladys-entsoe

[Gladys Assistant](https://gladysassistant.com) external integration for the
**day-ahead electricity prices of the ENTSO-E Transparency Platform**: one
European bidding zone (40 zones, France by default), prices converted from
EUR/MWh to EUR/kWh with optional VAT and fixed fees — current and next
period, today's lowest, highest and average price, the cheapest period of
today and tomorrow, and the rank of the current period. A free ENTSO-E
security token is needed. **Unofficial, not affiliated with ENTSO-E. Never
tested with a real token yet.**

User documentation (with how to get a free token): [docs/en.md](docs/en.md)
· [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (EntsoeApp)   readings schedule, pauses, quarter-hour tick
                 ├─ src/entsoe.js       A44 request + answer -> slots (EUR/MWh)
                 ├─ src/xml.js          bounded, linear XML scanner (no dependency)
                 ├─ src/http.js         the only network access (timeout, 256 KB cap)
                 ├─ src/prices.js       local days, tariff, snapshot at an instant (pure)
                 └─ src/devices.js      the device, its features and states (pure)
```

- **Request**: `GET https://web-api.tp.entsoe.eu/api?documentType=A44&in_Domain=<EIC>&out_Domain=<EIC>&contract_MarketAgreement.type=A01&periodStart=…&periodEnd=…&securityToken=…`,
  from the start of the local day to the end of tomorrow (UTC hours). The
  token is in the query string, as the platform requires: no URL is ever
  logged or put in a message.
- **Answer**: `Publication_MarketDocument` with `TimeSeries` → `Period`
  (`PT15M` or `PT60M`) → `Point` (`position`, `price.amount`). In a curve
  A03, missing positions repeat the previous price up to the end of the
  period; in A01 (or without a curve type) they stay without price; other
  curves are skipped. Overlapping series keep classification sequence 1,
  then the finer resolution; intraday (`A07`) or non-EUR/MWh series are
  skipped. An `Acknowledgement_MarketDocument` with reason 999 and "No
  matching data" means "no data yet".
- **Complete days**: judged on the part of a local day the market can have
  published (up to the end of today's Brussels market day before 13:00, of
  tomorrow's after), so a timezone west of Brussels does not read again
  every hour.
- **Schedule**: today and tomorrow at start; tomorrow from 13:00 Brussels
  time, then after 10, 20, 30 and every 60 minutes until published; next
  reading at 13:00 the day after. A tick every quarter hour publishes the
  states from memory (`publishChangedStates`, 30-minute heartbeat).
- **Errors**: 429 → a pause of Retry-After within [1 min, 6 h] (10 min when
  absent) that every path respects, kept across reconnections to Gladys
  (not across a container restart);
  5xx / network → 5, 15, 30, then every 60 minutes; 400 or a zone not in
  EUR/MWh → every 6 hours; 401 → readings stop (no timer) until the token
  changes, the configuration is saved or the "Read the prices now" button
  is pressed.

## Credits

The A44 request and the reading of its answer follow
[JaccoR/hass-entso-e](https://github.com/JaccoR/hass-entso-e) (Apache-2.0),
as do the bidding zones and their EIC codes; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled on the sibling
integration [gladys-nord-pool](https://github.com/LM1LC3N7/gladys-nord-pool)
(same price features and units).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the ENTSO-E answers are built by
`test/helpers/a44.js` after the shape of the real documents, Gladys is the
SDK's fake, the timers are fired by hand.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`), like the ported hass-entso-e logic, whose notice is
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (both shipped in the
Docker image).
