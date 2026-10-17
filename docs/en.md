# ENTSO-E day-ahead prices

**Unofficial connector, not affiliated with ENTSO-E.** It reads the
day-ahead electricity prices of one European bidding zone on the
[ENTSO-E Transparency Platform](https://transparency.entsoe.eu/), the
public data platform of the European transmission system operators, with a
free personal security token.

> **Never tested with a real token.** This first version was built and
> tested against recorded-shape answers only (no ENTSO-E account was
> available). Please report what you see in the forum thread or in a GitHub
> issue.

## What you get

One device, **ENTSO-E <zone>**, with these sensors (prices in EUR/kWh):

| Sensor                             | Content                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| Current price                      | the price of the current period (15 or 60 minutes)                                |
| Next period price                  | the price of the period that follows                                              |
| Today's lowest / highest / average | over the periods of your local day (the average weighs each period by its length) |
| Today's cheapest period (start)    | `HH:MM` local time of the cheapest period of today                                |
| Tomorrow's lowest price            | once tomorrow is published (usually 12:45–13:30 Brussels time)                    |
| Tomorrow's cheapest period (start) | `HH:MM`, or `--:--` while tomorrow is not published                               |
| Rank of the current period         | 0 = the cheapest period of the day, 95 the dearest (99 on the autumn DST day)     |

The rank is handy in scenes: "if the rank is below 16" means "during the 16
cheapest quarter hours of the day" (four hours).

**Prices are wholesale prices.** Your supplier adds its margin, the grid
fees and the taxes. Two options bring them closer to your bill: **fixed
fees** (EUR/kWh, added to the spot price) and **VAT** (%, applied to the
sum): price = (spot ÷ 1000 + fees) × (1 + VAT ÷ 100). A negative spot price
stays negative unless the fees exceed it.

## Get a free security token

1. Create an account on the
   [Transparency Platform](https://transparency.entsoe.eu/) (**Login** →
   **Register**), and confirm your e-mail address.
2. Send an e-mail to **transparency@entsoe.eu** with the subject
   **"Restful API access"** and, in the body, the e-mail address of your
   account. ENTSO-E enables API access by hand, usually within a few working
   days.
3. Once it is enabled, log in, open **My Account Settings**, and under
   **Web API Security Token** click **Generate a new token**. Copy the token
   (it looks like `1d9cd4bd-f8aa-476c-8cc1-3442dc91506d`).

The token is personal and free; ENTSO-E allows 400 requests a minute, this
integration makes a few a day.

## Installation

1. Install the integration, paste the token in **ENTSO-E security token**,
   pick your **bidding zone** (France by default), and save.
2. Press **Read the prices now**: the current price and today's average are
   shown under the button.
3. Open **Discovery** and add the device **ENTSO-E <zone>**.

**About the token:** Gladys keeps it in its database (in clear, masked in
the interface, and in its backups), never shows it again, and the
integration only sends it to ENTSO-E (`web-api.tp.entsoe.eu`). The platform
wants it in the address of the request, so the integration never logs an
address.

## Options

| Option          | Default      | Use                                                                                                                                                           |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bidding zone    | FR           | 40 zones (France, Belgium, Germany/Luxembourg, Italy, Nordics, …). Changing it creates a new device; delete the old one.                                      |
| VAT (%)         | 0            | 0 to 50                                                                                                                                                       |
| Fixed fees      | 0 EUR/kWh    | 0 to 1                                                                                                                                                        |
| Gladys timezone | Europe/Paris | the timezone of your Gladys (Settings → System), as an IANA name. It sets where a day starts and the times shown. An unknown name falls back to Europe/Paris. |

## When prices are read

- At start: today and tomorrow (one request).
- Tomorrow is asked from **13:00 Brussels time** (the auction clears at
  noon), then again after 10, 20, 30 and every 60 minutes until it is
  published. The next reading is at 13:00 the day after.
- In between, the sensors move every quarter hour from the prices in
  memory, **without any network call**. At midnight, tomorrow becomes today.
- A restart or a reconnection to Gladys keeps the prices and does not read
  again when today and tomorrow are known.

## Errors

| Situation                         | What happens                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token refused (401)               | readings **stop** and the status says so; the last prices stay shown. Fix the token (or wait for ENTSO-E to enable your API access), then save the configuration or press **Read the prices now**. |
| Too many requests (429)           | every reading, the button included, waits for the delay ENTSO-E gives (one minute to six hours; ten minutes when none is given).                                                                   |
| ENTSO-E down (5xx), network error | new attempt after 5, 15, 30, then every 60 minutes; the last prices stay shown.                                                                                                                    |
| No price for the zone             | the status says so; asked again every hour.                                                                                                                                                        |

## How the data is read

The integration asks the A44 document (day-ahead prices). Since 1 October
2025 the European day-ahead market uses **15-minute** periods; older or
other answers in **60-minute** periods are read as well. A period missing in
the answer repeats the price before it (the ENTSO-E rule for "variable sized
blocks"), and the 23- and 25-hour days of the clock changes are handled. The
answer is read with a bounded, linear parser and refused beyond 256 KB.

## Limits

- One zone per installation of the integration.
- No scene trigger, widget or energy contract in this version.
- Prices in EUR/MWh only: a zone ENTSO-E would price otherwise is reported
  in the status ("not priced in EUR/MWh") and asked again every six hours.
- Never tested with a real ENTSO-E token (see the top of this page).

The parsing logic is ported from
[JaccoR/hass-entso-e](https://github.com/JaccoR/hass-entso-e) (Apache-2.0).
