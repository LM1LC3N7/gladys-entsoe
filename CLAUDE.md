# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the **day-ahead prices (document A44) of the ENTSO-E Transparency
Platform** (`web-api.tp.entsoe.eu`, a free personal security token in the
query string) for one bidding zone, and publishes them per kWh on one
device. Unofficial: not affiliated with ENTSO-E. Sibling of
`gladys-nord-pool` (same price features and units); the parsing follows
JaccoR/hass-entso-e (Apache-2.0, see THIRD_PARTY_NOTICES.md).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/entsoe.test.js           # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        EntsoeApp: start/stop, readings schedule, 429 pause,
                                  refused token, quarter-hour tick, "Read the prices now"
src/entsoe.js                     A44 request URL, answer -> slots, fetchPrices
src/xml.js                        bounded, linear XML scanner (no dependency)
src/http.js                       the only network access: timeout, 256 KB cap, error codes
src/prices.js                     local days, tariff, snapshot at an instant (pure)
src/devices.js                    the device, feature keys, states (pure)
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js                  endpoint, limits, schedule, bidding zones (EIC)
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **The token is in the URL.** Never log a URL, a query or an answer body;
  error messages are built from fixed strings and status codes only
  (`src/http.js`). The token goes to `web-api.tp.entsoe.eu` only.
- **Be polite with ENTSO-E**: one request at start, tomorrow only from 13:00
  Brussels time and only until published, the tick never calls the network.
  A 429 pause applies to every path and survives restarts; a 401 stops the
  readings (no timer) until the token changes or the button is pressed.
- **Bounded parsing**: the answer is read up to `MAX_RESPONSE_BYTES`, the
  scanner is linear and refuses DOCTYPE and deep documents; keep it so.
- **Keys are forever**: the device external id `zone:<key of ZONES>`, the
  `FEATURE` keys of `src/devices.js`, the zone keys of `src/constants.js`,
  the manifest keys (`security_token`, `zone`, `vat_percent`,
  `fees_per_kwh`, `timezone`, `test_connection`). Units and categories are
  fixed at creation: only units the core lists for the category
  (`DEVICE_FEATURE_UNITS_BY_CATEGORY`).
- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`. Gladys keys devices, their history,
  scenes and dashboards on them: changing one creates a new device and
  orphans the old one.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume (this integration writes nothing). Never log tokens.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **Text files** are UTF-8 without BOM (`test/encoding.test.js` refuses a BOM
  and mojibake). User-facing text is bilingual (English and French).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
