// -----------------------------------------------------------------------------
// The price model, pure: local dates in a timezone, the user's tariff, and
// what the sensors show at an instant. Instants are UTC milliseconds, raw
// prices EUR/MWh, user prices EUR/kWh.
// -----------------------------------------------------------------------------

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
const covered = (slots, day) =>
  slots.length > 0 && slots.reduce((sum, s) => sum + (s.end - s.start), 0) >= day.end - day.start;

/**
 * What the sensors show at `t`, prices converted with the tariff:
 * `{ current, next, today, rank, tomorrow, todayComplete, tomorrowComplete }`.
 * `today` / `tomorrow` are the stats of the local days (tomorrow only once
 * the whole day is known).
 */
export function snapshot(rawSlots, t, { timezone, vatPercent = 0, feesPerKwh = 0 }) {
  const tariff = { vatPercent, feesPerKwh };
  const slots = rawSlots.map((s) => ({ ...s, price: userPrice(s.price, tariff) }));
  const today = dayOf(t, timezone);
  const tomorrow = dayOf(t, timezone, 1);
  const todaySlots = within(slots, today);
  const tomorrowSlots = within(slots, tomorrow);
  const current = slots.find((s) => s.start <= t && t < s.end);
  const next = slots.find((s) => s.start >= (current ? current.end : t));
  const todayStats = stats(todaySlots);
  const tomorrowComplete = covered(tomorrowSlots, tomorrow);
  return {
    current,
    next,
    today: todayStats,
    todayComplete: covered(todaySlots, today),
    // 0 = the cheapest period of the day; equal prices share a rank.
    rank:
      current && todaySlots.includes(current)
        ? todaySlots.filter((s) => s.price < current.price).length
        : undefined,
    tomorrow: tomorrowComplete ? stats(tomorrowSlots) : undefined,
    tomorrowComplete,
  };
}
