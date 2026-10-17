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
  assert.ok(snap.todayComplete && snap.tomorrowComplete);
  assert.equal(hhmm(snap.tomorrow.min.start, PARIS), '23:45');
  assert.equal(snap.tomorrow.min.price, 0.105);
  // 0 = cheapest; the 40 periods from 00:00 to 09:45 are all below 240.
  assert.equal(snap.rank, 40);
  const bottom = snapshot(today, start + 4 * H, { timezone: PARIS });
  assert.equal(bottom.rank, 0);
  assert.equal(bottom.tomorrow, undefined);
  assert.equal(bottom.tomorrowComplete, false);
});

test('snapshot: tomorrow counts only once the whole local day is known', () => {
  const start = zonedTime('2026-10-16', PARIS);
  const slots = [...quarters(start, 96, () => 10), ...quarters(start + 24 * H, 95, () => 5)];
  assert.equal(snapshot(slots, start + H, { timezone: PARIS }).tomorrowComplete, false);
  // Without any price for now: no current, no rank.
  const empty = snapshot([], start, { timezone: PARIS });
  assert.equal(empty.current, undefined);
  assert.equal(empty.rank, undefined);
  assert.equal(empty.today, undefined);
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
