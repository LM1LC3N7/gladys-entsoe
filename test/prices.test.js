import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, hhmm, mergeSlots, snapshot, userPrice, zonedTime } from '../src/prices.js';

const H = 3_600_000;
const Q = 15 * 60_000;
const PARIS = 'Europe/Paris';

/** Quarter-hour slots from `start`, prices in EUR/MWh from `price(i)`. */
const quarters = (start, count, price) =>
  Array.from({ length: count }, (_, i) => ({
    start: start + i * Q,
    end: start + (i + 1) * Q,
    price: price(i),
  }));

test('local days in a timezone: 24, 25 and 23 hours', () => {
  assert.equal(zonedTime('2026-10-16', PARIS), Date.parse('2026-10-15T22:00:00Z'));
  assert.equal(zonedTime('2026-10-16', 'Europe/Brussels', 13), Date.parse('2026-10-16T11:00:00Z'));
  const autumn = dayOf(Date.parse('2026-10-25T12:00:00Z'), PARIS);
  assert.equal((autumn.end - autumn.start) / H, 25);
  const spring = dayOf(Date.parse('2026-03-29T12:00:00Z'), PARIS);
  assert.equal((spring.end - spring.start) / H, 23);
  assert.equal(dayOf(Date.parse('2026-10-15T22:30:00Z'), PARIS).date, '2026-10-16');
  assert.equal(dayOf(Date.parse('2026-10-15T22:30:00Z'), 'Europe/London').date, '2026-10-15');
  assert.equal(hhmm(Date.parse('2026-10-25T01:30:00Z'), PARIS), '02:30');
});

test('the tariff: (spot / 1000 + fees) x (1 + VAT), negative spot included', () => {
  assert.equal(userPrice(100), 0.1);
  assert.equal(userPrice(100, { vatPercent: 20, feesPerKwh: 0.05 }), 0.18);
  assert.equal(userPrice(-50, { vatPercent: 20 }), -0.06);
  assert.equal(userPrice(-50, { feesPerKwh: 0.1 }), 0.05);
});

test('snapshot: current, next, day stats, rank and the cheapest periods', () => {
  const start = zonedTime('2026-10-16', PARIS);
  // A V-shaped day: cheapest at 04:00 (position 17), a tie at the bottom.
  const today = quarters(start, 96, (i) => Math.abs(i - 16) * 10);
  const tomorrow = quarters(start + 24 * H, 96, (i) => 200 - i);
  const now = start + 10 * H + 5 * 60_000; // 10:05
  const snap = snapshot([...today, ...tomorrow], now, { timezone: PARIS });
  assert.equal(snap.current.start, start + 10 * H);
  assert.equal(snap.current.price, 0.24); // |40 - 16| x 10 EUR/MWh
  assert.equal(snap.next.start, start + 10 * H + Q);
  assert.equal(snap.today.min.price, 0);
  assert.equal(hhmm(snap.today.min.start, PARIS), '04:00');
  assert.equal(snap.today.max.price, 0.79);
  // Before 13:00 Brussels time, tomorrow is not taken as published.
  assert.ok(snap.todayComplete && !snap.tomorrowComplete && snap.allComplete);
  assert.equal(snap.tomorrow, undefined);
  // 0 = cheapest; the 40 periods from 00:00 to 09:45 are all below 240.
  assert.equal(snap.rank, 40);
  const afternoon = snapshot([...today, ...tomorrow], start + 14 * H, { timezone: PARIS });
  assert.ok(afternoon.tomorrowComplete && afternoon.allComplete);
  assert.equal(hhmm(afternoon.tomorrow.min.start, PARIS), '23:45');
  assert.equal(afternoon.tomorrow.min.price, 0.105);
  assert.equal(snapshot(today, start + 14 * H, { timezone: PARIS }).allComplete, false);
  const bottom = snapshot(today, start + 4 * H, { timezone: PARIS });
  assert.equal(bottom.rank, 0);
  assert.equal(bottom.tomorrow, undefined);
  assert.equal(bottom.tomorrowComplete, false);
});

test('snapshot: tomorrow counts only once the whole local day is known', () => {
  const start = zonedTime('2026-10-16', PARIS);
  const slots = [...quarters(start, 96, () => 10), ...quarters(start + 24 * H, 95, () => 5)];
  assert.equal(snapshot(slots, start + 14 * H, { timezone: PARIS }).tomorrowComplete, false);
  // Without any price for now: no current, no rank.
  const empty = snapshot([], start, { timezone: PARIS });
  assert.equal(empty.current, undefined);
  assert.equal(empty.rank, undefined);
  assert.equal(empty.today, undefined);
});

test('west of Brussels (Lisbon): complete on the publishable part of a local day', () => {
  const LISBON = 'Europe/Lisbon';
  // Market days are Brussels days: 2026-10-16 is 22:00Z to 22:00Z.
  const d16 = Date.parse('2026-10-15T22:00:00Z');
  const market = (from, n) => quarters(from, n * 96, () => 50);
  const morning = Date.parse('2026-10-16T09:00:00Z'); // 10:00 Lisbon, 11:00 Brussels
  // Known: the market days 16 (and 15's tail). Lisbon's 16 ends 23:00Z, an
  // hour into Brussels' 17, which is not publishable before 13:00.
  const before = snapshot(market(d16, 1), morning, { timezone: LISBON });
  assert.ok(before.todayComplete && before.baseComplete && before.allComplete);
  // After 13:00 Brussels, tomorrow (market 17) is due; its known part is
  // Lisbon's 17 up to 22:00Z, the end of Brussels' 17.
  const afternoon = Date.parse('2026-10-16T12:00:00Z');
  const withTomorrow = market(d16, 2);
  const after = snapshot(withTomorrow, afternoon, { timezone: LISBON });
  assert.ok(after.todayComplete && after.tomorrowComplete && after.allComplete);
  assert.equal(after.tomorrow.min.start, Date.parse('2026-10-16T23:00:00Z'));
  const missing = snapshot(market(d16, 1), afternoon, { timezone: LISBON });
  assert.ok(missing.baseComplete && !missing.allComplete && !missing.tomorrowComplete);
});

test('east and west of Brussels around local midnight: tomorrow is its own market day', () => {
  const market = (from, n) => quarters(from, n * 96, () => 50);
  const d18 = Date.parse('2026-10-17T22:00:00Z'); // Brussels market day 18
  // Helsinki, 00:30 on the 19th (21:30Z on the 18th, 23:30 in Brussels):
  // its tomorrow (the 20th) is market day 20, not out before 13:00 on the 19th.
  const helsinki = snapshot(market(d18, 2), Date.parse('2026-10-18T21:30:00Z'), {
    timezone: 'Europe/Helsinki',
  });
  assert.equal(helsinki.tomorrowComplete, false);
  assert.equal(helsinki.tomorrow, undefined);
  // Lisbon, 23:30 on the 16th (22:30Z, already the 17th in Brussels): its
  // tomorrow (the 17th) is market day 17, out since 13:00 on the 16th.
  const d16 = Date.parse('2026-10-15T22:00:00Z');
  const lisbon = snapshot(market(d16, 2), Date.parse('2026-10-16T22:30:00Z'), {
    timezone: 'Europe/Lisbon',
  });
  assert.equal(lisbon.tomorrowComplete, true);
  assert.equal(lisbon.tomorrow.min.start, Date.parse('2026-10-16T23:00:00Z'));
});

test('the autumn DST day has 100 quarter hours and ranks up to 99', () => {
  const start = zonedTime('2026-10-25', PARIS);
  const slots = quarters(start, 100, (i) => 1000 - i);
  const snap = snapshot(slots, start + 30 * 60_000, { timezone: PARIS });
  assert.ok(snap.todayComplete);
  assert.equal(snap.rank, 97);
  assert.equal(hhmm(snap.today.min.start, PARIS), '23:45');
});

test('mergeSlots: fresh slots replace any overlapping known slot', () => {
  const start = Date.parse('2026-10-15T22:00:00Z');
  const hourly = [0, 1, 2].map((i) => ({
    start: start + i * H,
    end: start + (i + 1) * H,
    price: 1,
  }));
  const fresh = quarters(start + H, 4, () => 2);
  const merged = mergeSlots(hourly, fresh);
  assert.deepEqual(
    merged.map((s) => [(s.start - start) / Q, s.price]),
    [
      [0, 1],
      [4, 2],
      [5, 2],
      [6, 2],
      [7, 2],
      [8, 1],
    ],
  );
  assert.equal(mergeSlots(hourly, []), hourly);
});
