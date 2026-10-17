// -----------------------------------------------------------------------------
// The price model, pure: local dates in a timezone, the user's tariff, and
// what the sensors show at an instant. Instants are UTC milliseconds, raw
// prices EUR/MWh, user prices EUR/kWh.
// -----------------------------------------------------------------------------

import { MARKET_TIMEZONE, TOMORROW_FROM } from './constants.js';

const formats = new Map();
function format(timezone) {
  let f = formats.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formats.set(timezone, f);
  }
  return f;
}

/** The wall clock of `t` in `timezone`: `{ date: 'YYYY-MM-DD', hour, minute }`. */
export function localClock(t, timezone) {
  const p = Object.fromEntries(
    format(timezone)
      .formatToParts(new Date(t))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export const localDate = (t, timezone) => localClock(t, timezone).date;

/** A calendar date plus `days` (YYYY-MM-DD arithmetic). */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Offset of `timezone` from UTC at `t`, in ms (wall clock minus UTC). */
function offsetAt(t, timezone) {
  const { date, hour, minute } = localClock(t, timezone);
  const wall = Date.parse(
    `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
  return wall - Math.floor(t / 60_000) * 60_000;
}

/** The instant of a wall-clock time of `date` in `timezone` (two passes around DST). */
export function zonedTime(date, timezone, hour = 0, minute = 0) {
  const guess = Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000;
  let t = guess - offsetAt(guess, timezone);
  t = guess - offsetAt(t, timezone);
  return t;
}

/** `HH:MM` of `t` in `timezone`. */
export function hhmm(t, timezone) {
  const { hour, minute } = localClock(t, timezone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** The user's price per kWh: (spot / 1000 + fees) x (1 + VAT). Linear, so a negative spot stays negative. */
export function userPrice(eurPerMwh, { vatPercent = 0, feesPerKwh = 0 } = {}) {
  return round((eurPerMwh / 1000 + feesPerKwh) * (1 + vatPercent / 100));
}

export const round = (value) => Math.round(value * 100_000) / 100_000;

/** Min, max, duration-weighted average and the cheapest slot (earliest on a tie). */
export function stats(slots) {
  if (slots.length === 0) {
    return undefined;
  }
  let min = slots[0];
  let max = slots[0];
  let total = 0;
  let duration = 0;
  for (const slot of slots) {
    if (slot.price < min.price) min = slot;
    if (slot.price > max.price) max = slot;
    total += slot.price * (slot.end - slot.start);
    duration += slot.end - slot.start;
  }
  return { min, max, avg: round(total / duration) };
}

/** Merge freshly read slots into the known ones: the new ones replace any overlap. */
export function mergeSlots(known, fresh) {
  if (fresh.length === 0) {
    return known;
  }
  const from = fresh[0].start;
  const to = fresh.at(-1).end;
  const kept = known.filter((s) => s.end <= from || s.start >= to);
  return [...kept, ...fresh].sort((a, b) => a.start - b.start);
}

/** The local day of `t`: `{ date, start, end }` (23, 24 or 25 hours). */
export function dayOf(t, timezone, offset = 0) {
  const date = addDays(localDate(t, timezone), offset);
  return {
    date,
    start: zonedTime(date, timezone),
    end: zonedTime(addDays(date, 1), timezone),
  };
}

const within = (slots, day) => slots.filter((s) => s.start >= day.start && s.start < day.end);

/** True when the slots cover [from, to) entirely (an empty window is covered). */
export function coveredOn(slots, from, to) {
  if (to <= from) {
    return true;
  }
  let total = 0;
  for (const s of slots) {
    total += Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
  }
  return total >= to - from;
}

/** 13:00 Brussels time of the market day of `t`: tomorrow may be out from then. */
export function tomorrowFrom(t) {
  return zonedTime(
    localDate(t, MARKET_TIMEZONE),
    MARKET_TIMEZONE,
    TOMORROW_FROM.hour,
    TOMORROW_FROM.minute,
  );
}

/** The end of the market day (Brussels) of `t`, plus `offset` days. */
export function marketDayEnd(t, offset = 0) {
  return zonedTime(addDays(localDate(t, MARKET_TIMEZONE), 1 + offset), MARKET_TIMEZONE);
}

/**
 * What the sensors show at `t`, prices converted with the tariff:
 * `{ current, next, today, rank, tomorrow, todayComplete, tomorrowComplete,
 * baseComplete, allComplete }`.
 *
 * A local day may straddle two market days (Lisbon, London: the last local
 * hour belongs to the next Brussels day). "Complete" is therefore judged on
 * the part of a local day that can be published at `t`: up to the end of
 * today's market day before 13:00 Brussels time, of tomorrow's after.
 * `baseComplete`: everything already published before today's auction is
 * known; `allComplete`: everything publishable now is known (both drive the
 * readings). "Tomorrow published" is judged on the market day holding the
 * local tomorrow: from 13:00 Brussels time the day before that market day,
 * on the part of the local tomorrow up to its end. Using the Brussels date
 * of `t` instead would be wrong at both ends: from 00:00 to 01:00 in
 * Helsinki it is still yesterday, after the auction, in Brussels (one known
 * hour taken for tomorrow); from 23:00 in Lisbon it is already the next
 * Brussels day, before its auction (tomorrow lost).
 */
export function snapshot(rawSlots, t, { timezone, vatPercent = 0, feesPerKwh = 0 }) {
  const tariff = { vatPercent, feesPerKwh };
  const slots = rawSlots.map((s) => ({ ...s, price: userPrice(s.price, tariff) }));
  const today = dayOf(t, timezone);
  const tomorrow = dayOf(t, timezone, 1);
  const auctionDone = t >= tomorrowFrom(t);
  const cap = marketDayEnd(t, auctionDone ? 1 : 0);
  const todaySlots = within(slots, today);
  const tomorrowSlots = within(slots, tomorrow);
  const current = slots.find((s) => s.start <= t && t < s.end);
  const next = slots.find((s) => s.start >= (current ? current.end : t));
  const todayStats = stats(todaySlots);
  // The market day holding most of the local tomorrow (its middle): it is
  // published at 13:00 Brussels time the day before, and tomorrow's known
  // part ends with it.
  const market = localDate(tomorrow.start + 12 * 3_600_000, MARKET_TIMEZONE);
  const tomorrowComplete =
    t >=
      zonedTime(addDays(market, -1), MARKET_TIMEZONE, TOMORROW_FROM.hour, TOMORROW_FROM.minute) &&
    tomorrowSlots.length > 0 &&
    coveredOn(
      slots,
      tomorrow.start,
      Math.min(tomorrow.end, zonedTime(addDays(market, 1), MARKET_TIMEZONE)),
    );
  return {
    current,
    next,
    today: todayStats,
    todayComplete: todaySlots.length > 0 && coveredOn(slots, today.start, Math.min(today.end, cap)),
    baseComplete:
      todaySlots.length > 0 &&
      coveredOn(slots, today.start, Math.min(tomorrow.end, marketDayEnd(t))),
    allComplete:
      todaySlots.length > 0 && coveredOn(slots, today.start, Math.min(tomorrow.end, cap)),
    // 0 = the cheapest period of the day; equal prices share a rank.
    rank:
      current && todaySlots.includes(current)
        ? todaySlots.filter((s) => s.price < current.price).length
        : undefined,
    tomorrow: tomorrowComplete ? stats(tomorrowSlots) : undefined,
    tomorrowComplete,
  };
}
