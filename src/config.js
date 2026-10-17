// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized:
// the rest of the code never deals with `undefined` or strings from a form.
// -----------------------------------------------------------------------------

import { DEFAULT_TIMEZONE, ZONES } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  zone: 'FR',
  vat_percent: 0,
  fees_per_kwh: 0,
  timezone: DEFAULT_TIMEZONE,
};

export const LIMITS = {
  vat_percent: { min: 0, max: 50 },
  fees_per_kwh: { min: 0, max: 1 },
};

// An ENTSO-E security token is a UUID; anything else is refused before it
// reaches a URL.
const TOKEN = /^[A-Za-z0-9-]{8,128}$/;

function bounded(value, key) {
  const number = Number(value ?? DEFAULTS[key]);
  const { min, max } = LIMITS[key];
  return Number.isFinite(number) && number >= min && number <= max ? number : DEFAULTS[key];
}

export function validTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export function normalizeConfig(raw = {}) {
  const token = String(raw.security_token ?? '').trim();
  const zone = String(raw.zone ?? '')
    .trim()
    .toUpperCase();
  return {
    token: TOKEN.test(token) ? token : '',
    tokenMalformed: token !== '' && !TOKEN.test(token),
    zone: zone in ZONES ? zone : DEFAULTS.zone,
    vatPercent: bounded(raw.vat_percent, 'vat_percent'),
    feesPerKwh: bounded(raw.fees_per_kwh, 'fees_per_kwh'),
    timezone: validTimezone(raw.timezone) ? raw.timezone.trim() : DEFAULTS.timezone,
  };
}
