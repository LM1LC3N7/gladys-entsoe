// -----------------------------------------------------------------------------
// The ENTSO-E Transparency Platform, document A44 (day-ahead prices): the
// request URL, the parsing of the answer into price slots, and the fetch.
//
// The parsing follows JaccoR/hass-entso-e (api_client.py, Apache-2.0):
// periods of 15 or 60 minutes (PT15M / PT60M, the market moved to quarter
// hours on 2025-10-01), a missing position repeats the previous price (curve
// A03), the first series wins where two overlap (the DE-LU zone published a
// 60-minute and a 15-minute series). Every instant is UTC: a 23- or 25-hour
// day needs no special case.
// -----------------------------------------------------------------------------

import {
  API_URL,
  MAX_DEPTH,
  MAX_PERIODS,
  MAX_POINTS,
  MAX_SERIES,
  PRICE_BOUNDS,
  ZONES,
} from './constants.js';
import { EntsoeError, getText } from './http.js';
import { XmlError, scanXml } from './xml.js';

const pad = (n) => String(n).padStart(2, '0');

/** `yyyyMMddHHmm` in UTC, the format of periodStart / periodEnd. */
export function apiTime(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}`;
}

/** The A44 request of a zone between two instants (floored / ceiled to the hour). */
export function requestUrl({ token, zone, start, end }) {
  const hour = 3_600_000;
  const url = new URL(API_URL);
  url.searchParams.set('securityToken', token);
  url.searchParams.set('documentType', 'A44');
  url.searchParams.set('in_Domain', ZONES[zone].eic);
  url.searchParams.set('out_Domain', ZONES[zone].eic);
  url.searchParams.set('periodStart', apiTime(Math.floor(start / hour) * hour));
  url.searchParams.set('periodEnd', apiTime(Math.ceil(end / hour) * hour));
  return url.toString();
}

const ISO_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;
const DECIMAL = /^-?\d{1,9}(\.\d{1,9})?$/;
const POSITION = /^\d{1,5}$/;

function parseInstant(text) {
  if (!ISO_MINUTE.test(text)) {
    return undefined;
  }
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : undefined;
}

/** PT15M -> 15, PT60M / PT1H -> 60; undefined for anything else. */
export function resolutionMinutes(text) {
  const minutes = { PT15M: 15, PT30M: 30, PT60M: 60, PT1H: 60 }[text];
  return minutes;
}

/**
 * Read an A44 answer. Returns `{ kind: 'prices', slots, skipped }` (slots of
 * `{ start, end, price }` in EUR/MWh, sorted, without overlap), or
 * `{ kind: 'no_data' }` for the "No matching data found" acknowledgement, or
 * `{ kind: 'refused', code, reason }` for another acknowledgement. Throws an
 * EntsoeError('invalid') for anything else.
 */
export function parseDocument(text) {
  let root;
  const series = [];
  let seriesCount = 0;
  let periodCount = 0;
  let pointCount = 0;
  let current; // the TimeSeries being read
  let period; // the Period being read
  let point; // the Point being read
  const reason = { code: '', text: '' };
  const tooMany = (what) => {
    throw new EntsoeError('invalid', `ENTSO-E answered too many ${what}`);
  };
  try {
    scanXml(text, {
      maxDepth: MAX_DEPTH,
      onOpen(name, parent) {
        if (parent === undefined) {
          root = name;
        } else if (name === 'TimeSeries') {
          if (++seriesCount > MAX_SERIES) tooMany('series');
          current = { sequence: 1, contract: '', currency: '', unit: '', periods: [] };
        } else if (name === 'Period' && current) {
          if (++periodCount > MAX_PERIODS) tooMany('periods');
          period = { start: undefined, end: undefined, resolution: '', points: [] };
        } else if (name === 'Point' && period) {
          if (++pointCount > MAX_POINTS) tooMany('points');
          point = { position: '', price: '' };
        }
      },
      onClose(name, value, parent) {
        if (root === 'Acknowledgement_MarketDocument') {
          if (parent === 'Reason' && name === 'code') reason.code = value;
          if (parent === 'Reason' && name === 'text') reason.text = value.slice(0, 200);
          return;
        }
        if (point) {
          if (name === 'position') point.position = value;
          else if (name === 'price.amount') point.price = value;
          else if (name === 'Point') {
            period.points.push(point);
            point = undefined;
          }
        } else if (period) {
          if (parent === 'timeInterval' && name === 'start') period.start = parseInstant(value);
          else if (parent === 'timeInterval' && name === 'end') period.end = parseInstant(value);
          else if (name === 'resolution') period.resolution = value;
          else if (name === 'Period') {
            current.periods.push(period);
            period = undefined;
          }
        } else if (current) {
          if (name === 'classificationSequence_AttributeInstanceComponent.position') {
            current.sequence = POSITION.test(value) ? Number(value) : 1;
          } else if (name === 'contract_MarketAgreement.type') current.contract = value;
          else if (name === 'currency_Unit.name') current.currency = value;
          else if (name === 'price_Measure_Unit.name') current.unit = value;
          else if (name === 'TimeSeries') {
            series.push(current);
            current = undefined;
          }
        }
      },
    });
  } catch (err) {
    if (err instanceof XmlError) {
      throw new EntsoeError('invalid', 'ENTSO-E answered a document that is not valid XML');
    }
    throw err;
  }
  if (root === 'Acknowledgement_MarketDocument') {
    // 999: "No matching data found for Data item ... ", the usual answer for
    // tomorrow before the auction results.
    return reason.code === '999'
      ? { kind: 'no_data' }
      : { kind: 'refused', code: reason.code, reason: reason.text };
  }
  if (root !== 'Publication_MarketDocument') {
    throw new EntsoeError('invalid', 'ENTSO-E answered an unexpected document');
  }
  return { kind: 'prices', ...slotsOf(series) };
}

/** The price slots of the parsed series: first series (by sequence) wins on overlaps. */
function slotsOf(series) {
  const skipped = [];
  const accepted = []; // [start, end) of the periods already taken
  const slots = [];
  // Day-ahead series only (A01 when the contract type is given); the
  // classification sequence 1 first, then the finer resolution.
  const candidates = series
    .filter((s) => {
      if (s.contract && s.contract !== 'A01') {
        skipped.push(`contract ${s.contract}`);
        return false;
      }
      if (s.currency !== 'EUR' || s.unit !== 'MWH') {
        skipped.push(`unit ${s.currency || '?'}/${s.unit || '?'}`);
        return false;
      }
      return true;
    })
    .flatMap((s) => s.periods.map((p) => ({ sequence: s.sequence, ...p })))
    .map((p) => ({ ...p, minutes: resolutionMinutes(p.resolution) }))
    .sort((a, b) => a.sequence - b.sequence || (a.minutes ?? 999) - (b.minutes ?? 999));
  for (const p of candidates) {
    const periodSlots = expandPeriod(p, skipped);
    if (periodSlots.length === 0) {
      continue;
    }
    const from = periodSlots[0].start;
    const to = periodSlots.at(-1).end;
    if (accepted.some(([s, e]) => from < e && s < to)) {
      skipped.push(`overlap ${p.resolution}`);
      continue;
    }
    accepted.push([from, to]);
    slots.push(...periodSlots);
  }
  slots.sort((a, b) => a.start - b.start);
  return { slots, skipped };
}

/** The slots of one Period, missing positions repeating the previous price. */
function expandPeriod(p, skipped) {
  const { start, end, minutes } = p;
  if (start === undefined || end === undefined || !minutes || end <= start) {
    skipped.push(`period ${p.resolution || '?'}`);
    return [];
  }
  const size = minutes * 60_000;
  const count = (end - start) / size;
  if (!Number.isInteger(count) || count > MAX_POINTS) {
    skipped.push(`period length ${p.resolution}`);
    return [];
  }
  const prices = new Array(count + 1);
  for (const point of p.points) {
    if (!POSITION.test(point.position) || !DECIMAL.test(point.price)) {
      // A point that cannot be read is not "missing": refuse the period
      // rather than repeat a price that may be wrong.
      skipped.push('unreadable point');
      return [];
    }
    const position = Number(point.position);
    const price = Number(point.price);
    if (price < PRICE_BOUNDS.min || price > PRICE_BOUNDS.max) {
      skipped.push('price out of bounds');
      return [];
    }
    if (position >= 1 && position <= count && prices[position] === undefined) {
      prices[position] = price;
    }
  }
  const slots = [];
  let last;
  for (let position = 1; position <= count; position += 1) {
    if (prices[position] !== undefined) {
      last = prices[position];
    }
    // Before the first point there is nothing to repeat: no slot.
    if (last !== undefined) {
      const slotStart = start + (position - 1) * size;
      slots.push({ start: slotStart, end: slotStart + size, price: last });
    }
  }
  return slots;
}

/**
 * Read the prices of a zone between two instants. Resolves the parsed
 * answer (see parseDocument); a refused request is thrown as
 * EntsoeError('bad_request').
 */
export async function fetchPrices({ token, zone, start, end }, options = {}) {
  const { status, text } = await getText(requestUrl({ token, zone, start, end }), options);
  const result = parseDocument(text);
  if (result.kind === 'refused' || (status === 400 && result.kind === 'prices')) {
    throw new EntsoeError(
      'bad_request',
      `ENTSO-E refused the request${result.code ? ` (reason ${result.code})` : ''}`,
      { status },
    );
  }
  return result;
}
