// -----------------------------------------------------------------------------
// Constants: endpoint, limits, schedule and the bidding zones (EIC codes).
// -----------------------------------------------------------------------------

export const USER_AGENT = 'gladys-entsoe (+https://github.com/LM1LC3N7/gladys-entsoe)';

// The RESTful API of the ENTSO-E Transparency Platform. The security token
// travels in the query string (`securityToken`), as the platform requires:
// a URL is therefore NEVER logged nor put in an error message.
export const API_URL = 'https://web-api.tp.entsoe.eu/api';
export const HTTP_TIMEOUT = 20_000;
// A44 for two days is about 20 KB in 15-minute slots; a zone that publishes
// two series (60 and 15 minutes, as DE-LU did) about 40 KB. Anything larger
// is refused unread: the parser never sees more than this.
export const MAX_RESPONSE_BYTES = 256 * 1024;
// Parser bounds, far above a real document (2 days x 100 quarters x 2 series).
export const MAX_SERIES = 20;
export const MAX_PERIODS = 60;
export const MAX_POINTS = 2_000;
export const MAX_DEPTH = 16;

// Prices on the platform are euros per MWh; outside these bounds a point is
// not a price (the SDAC harmonised limits are -500 / +4,000 EUR/MWh).
export const PRICE_BOUNDS = { min: -10_000, max: 100_000 };

// The day-ahead auction (SDAC) clears at 12:00 CET; the prices reach the
// platform shortly after. Tomorrow is asked from 13:00 Brussels time, then
// again after these delays (the last one repeats) until it is published.
export const MARKET_TIMEZONE = 'Europe/Brussels';
export const TOMORROW_FROM = { hour: 13, minute: 0 };
export const TOMORROW_RETRIES = [10, 20, 30, 60].map((m) => m * 60_000);
// Today missing although the platform answered: asked again every hour.
export const TODAY_RETRY = 60 * 60_000;
// Passing errors (network, 5xx): the next attempt waits this long (the last
// one repeats). A 429 waits for its Retry-After, within PAUSE_BOUNDS.
export const ERROR_RETRIES = [5, 15, 30, 60].map((m) => m * 60_000);
export const RATE_LIMIT_DEFAULT = 10 * 60_000;
export const PAUSE_BOUNDS = { min: 60_000, max: 6 * 60 * 60_000 };
// A request the platform refuses (400 other than "no data"): it will not
// get better by itself, so it is asked again only every few hours.
export const BAD_REQUEST_RETRY = 6 * 60 * 60_000;
// The sensors follow the quarter hours (the finest market resolution).
export const TICK_MINUTES = 15;
export const STATE_HEARTBEAT = 30 * 60_000;

// The core's default timezone (DEFAULT_TIMEZONE of server/utils/constants.js).
export const DEFAULT_TIMEZONE = 'Europe/Paris';

// Bidding zones answered by the A44 document, as listed by JaccoR/hass-entso-e
// (const.py AREA_INFO, api_client.py Area). The key is stored in the device
// external id: never rename one.
export const ZONES = {
  FR: { eic: '10YFR-RTE------C', en: 'France', fr: 'France' },
  BE: { eic: '10YBE----------2', en: 'Belgium', fr: 'Belgique' },
  NL: { eic: '10YNL----------L', en: 'Netherlands', fr: 'Pays-Bas' },
  DE_LU: { eic: '10Y1001A1001A82H', en: 'Germany / Luxembourg', fr: 'Allemagne / Luxembourg' },
  AT: { eic: '10YAT-APG------L', en: 'Austria', fr: 'Autriche' },
  CH: { eic: '10YCH-SWISSGRIDZ', en: 'Switzerland', fr: 'Suisse' },
  ES: { eic: '10YES-REE------0', en: 'Spain', fr: 'Espagne' },
  PT: { eic: '10YPT-REN------W', en: 'Portugal', fr: 'Portugal' },
  IT_NORD: { eic: '10Y1001A1001A73I', en: 'Italy, North', fr: 'Italie, Nord' },
  IT_CNOR: { eic: '10Y1001A1001A70O', en: 'Italy, Centre-North', fr: 'Italie, Centre-Nord' },
  IT_CSUD: { eic: '10Y1001A1001A71M', en: 'Italy, Centre-South', fr: 'Italie, Centre-Sud' },
  IT_SUD: { eic: '10Y1001A1001A788', en: 'Italy, South', fr: 'Italie, Sud' },
  IT_CALA: { eic: '10Y1001C--00096J', en: 'Italy, Calabria', fr: 'Italie, Calabre' },
  IT_SICI: { eic: '10Y1001A1001A75E', en: 'Italy, Sicily', fr: 'Italie, Sicile' },
  IT_SARD: { eic: '10Y1001A1001A74G', en: 'Italy, Sardinia', fr: 'Italie, Sardaigne' },
  DK_1: { eic: '10YDK-1--------W', en: 'Denmark, West (DK1)', fr: 'Danemark, Ouest (DK1)' },
  DK_2: { eic: '10YDK-2--------M', en: 'Denmark, East (DK2)', fr: 'Danemark, Est (DK2)' },
  NO_1: { eic: '10YNO-1--------2', en: 'Norway, Oslo (NO1)', fr: 'Norvège, Oslo (NO1)' },
  NO_2: {
    eic: '10YNO-2--------T',
    en: 'Norway, Kristiansand (NO2)',
    fr: 'Norvège, Kristiansand (NO2)',
  },
  NO_3: { eic: '10YNO-3--------J', en: 'Norway, Trondheim (NO3)', fr: 'Norvège, Trondheim (NO3)' },
  NO_4: { eic: '10YNO-4--------9', en: 'Norway, Tromsø (NO4)', fr: 'Norvège, Tromsø (NO4)' },
  NO_5: { eic: '10Y1001A1001A48H', en: 'Norway, Bergen (NO5)', fr: 'Norvège, Bergen (NO5)' },
  SE_1: { eic: '10Y1001A1001A44P', en: 'Sweden, Luleå (SE1)', fr: 'Suède, Luleå (SE1)' },
  SE_2: { eic: '10Y1001A1001A45N', en: 'Sweden, Sundsvall (SE2)', fr: 'Suède, Sundsvall (SE2)' },
  SE_3: { eic: '10Y1001A1001A46L', en: 'Sweden, Stockholm (SE3)', fr: 'Suède, Stockholm (SE3)' },
  SE_4: { eic: '10Y1001A1001A47J', en: 'Sweden, Malmö (SE4)', fr: 'Suède, Malmö (SE4)' },
  FI: { eic: '10YFI-1--------U', en: 'Finland', fr: 'Finlande' },
  EE: { eic: '10Y1001A1001A39I', en: 'Estonia', fr: 'Estonie' },
  LV: { eic: '10YLV-1001A00074', en: 'Latvia', fr: 'Lettonie' },
  LT: { eic: '10YLT-1001A0008Q', en: 'Lithuania', fr: 'Lituanie' },
  PL: { eic: '10YPL-AREA-----S', en: 'Poland', fr: 'Pologne' },
  CZ: { eic: '10YCZ-CEPS-----N', en: 'Czechia', fr: 'Tchéquie' },
  SK: { eic: '10YSK-SEPS-----K', en: 'Slovakia', fr: 'Slovaquie' },
  HU: { eic: '10YHU-MAVIR----U', en: 'Hungary', fr: 'Hongrie' },
  SI: { eic: '10YSI-ELES-----O', en: 'Slovenia', fr: 'Slovénie' },
  HR: { eic: '10YHR-HEP------M', en: 'Croatia', fr: 'Croatie' },
  RO: { eic: '10YRO-TEL------P', en: 'Romania', fr: 'Roumanie' },
  BG: { eic: '10YCA-BULGARIA-R', en: 'Bulgaria', fr: 'Bulgarie' },
  GR: { eic: '10YGR-HTSO-----Y', en: 'Greece', fr: 'Grèce' },
  RS: { eic: '10YCS-SERBIATSOV', en: 'Serbia', fr: 'Serbie' },
};
