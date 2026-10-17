# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- Status and Discovery republished after Gladys restarts.

## [0.1.1] - 2026-10-17

### Added

- One device for the chosen European bidding zone (40 zones, France by
  default) with the day-ahead prices of the ENTSO-E Transparency Platform,
  converted from EUR/MWh to EUR/kWh: current price, next period price,
  today's lowest, highest and average price, the start of today's and
  tomorrow's cheapest period, tomorrow's lowest price, and the rank of the
  current period (0 = the cheapest of the day).
- Optional VAT (%) and fixed fees (EUR/kWh) added to every price, and the
  Gladys timezone setting the days and the times shown.
- 15- and 60-minute periods, missing positions (the previous price
  repeated), 23- and 25-hour days, negative prices.
- Readings: today and tomorrow at start, tomorrow from 13:00 Brussels time
  every 10, 20, 30 then 60 minutes until published; the sensors follow the
  quarter hours without any network call. A 429 pauses every reading (its
  Retry-After, between one minute and six hours), other errors are retried
  after 5, 15, 30 then every 60 minutes, and a refused token (401) stops the
  readings until the configuration is saved or "Read the prices now" is
  pressed. In a timezone west of Brussels (Lisbon, London), a day is
  complete once its publishable hours are known: no hourly readings.
- "Read the prices now" button.
- `THIRD_PARTY_NOTICES.md` crediting JaccoR/hass-entso-e (Apache-2.0),
  shipped in the image with `LICENSE`.

[Unreleased]: https://github.com/LM1LC3N7/gladys-entsoe/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-entsoe/releases/tag/v0.1.1
