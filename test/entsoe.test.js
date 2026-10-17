import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { apiTime, fetchPrices, parseDocument, requestUrl } from '../src/entsoe.js';
import { EntsoeError, readBounded } from '../src/http.js';
import { acknowledgement, day, document, period, series } from './helpers/a44.js';
import { installFetch, status, xml } from './helpers/fakeFetch.js';

const TOKEN = '1d9cd4bd-f8aa-476c-8cc1-3442dc91506d';
const START = Date.parse('2026-10-15T22:00:00Z'); // 2026-10-16 00:00 Paris
const H = 3_600_000;

let fake;
afterEach(() => fake?.restore());

test('the request: A44, EIC of the zone, UTC hours', () => {
  const url = new URL(
    requestUrl({ token: TOKEN, zone: 'FR', start: START + 60_000, end: START + 48 * H - 1 }),
  );
  assert.equal(url.origin + url.pathname, 'https://web-api.tp.entsoe.eu/api');
  const p = Object.fromEntries(url.searchParams);
  assert.deepEqual(p, {
    securityToken: TOKEN,
    documentType: 'A44',
    in_Domain: '10YFR-RTE------C',
    out_Domain: '10YFR-RTE------C',
    periodStart: '202610152200',
    periodEnd: '202610172200',
  });
  assert.equal(apiTime(Date.parse('2026-01-02T03:04:00Z')), '202601020304');
});

test('PT60M and PT15M periods become slots in EUR/MWh', () => {
  const hourly = parseDocument(document(series([day(START, { minutes: 60, price: (i) => i })])));
  assert.equal(hourly.kind, 'prices');
  assert.equal(hourly.slots.length, 24);
  assert.deepEqual(hourly.slots[1], { start: START + H, end: START + 2 * H, price: 1 });
  const quarters = parseDocument(document(series([day(START, { price: (i) => i / 4 })])));
  assert.equal(quarters.slots.length, 96);
  assert.deepEqual(quarters.slots[5], {
    start: START + 75 * 60_000,
    end: START + 90 * 60_000,
    price: 1.25,
  });
});

test('a missing position repeats the previous price, up to the end of the period', () => {
  const doc = document(
    series([
      period({
        start: START,
        count: 8,
        price: (i) => [10, 20, 30, 40, 50, 60, 70, 80][i],
        skip: [3, 4, 7, 8],
      }),
    ]),
  );
  assert.deepEqual(
    parseDocument(doc).slots.map((s) => s.price),
    [10, 20, 20, 20, 50, 60, 60, 60],
  );
  // Nothing to repeat before the first point: those slots are not invented.
  const late = parseDocument(document(series([period({ start: START, count: 4, skip: [1, 2] })])));
  assert.deepEqual(
    late.slots.map((s) => [s.start - START, s.price]),
    [
      [30 * 60_000, 52],
      [45 * 60_000, 53],
    ],
  );
});

test('negative prices are kept', () => {
  const { slots } = parseDocument(
    document(series([period({ start: START, count: 2, price: (i) => -12.5 - i })])),
  );
  assert.deepEqual(
    slots.map((s) => s.price),
    [-12.5, -13.5],
  );
});

test('DST: 25 hours on 2026-10-25, 23 hours on 2026-03-29, all in UTC', () => {
  const autumn = Date.parse('2026-10-24T22:00:00Z');
  const long = parseDocument(document(series([day(autumn, { hours: 25 })]))).slots;
  assert.equal(long.length, 100);
  assert.equal(long.at(-1).end, Date.parse('2026-10-25T23:00:00Z'));
  const spring = Date.parse('2026-03-28T23:00:00Z');
  const short = parseDocument(document(series([day(spring, { hours: 23, minutes: 60 })]))).slots;
  assert.equal(short.length, 23);
  assert.equal(short.at(-1).end, Date.parse('2026-03-29T22:00:00Z'));
});

test('overlapping series: sequence 1 first, then the finer resolution; no overlap kept', () => {
  const hourly = series([day(START, { minutes: 60, price: () => 100 })], { sequence: 1 });
  const quarters = series([day(START, { price: () => 15 })], { sequence: 2 });
  const parsed = parseDocument(document(quarters, hourly));
  assert.equal(parsed.slots.length, 24);
  assert.ok(parsed.slots.every((s) => s.price === 100));
  assert.deepEqual(parsed.skipped, ['overlap PT15M']);
  // Same sequence: the quarter hours win.
  const both = parseDocument(document(series([day(START, { minutes: 60 })]), series([day(START)])));
  assert.equal(both.slots.length, 96);
  // Two days, each in its own period, both kept.
  const twoDays = parseDocument(document(series([day(START), day(START + 24 * H)])));
  assert.equal(twoDays.slots.length, 192);
});

test('intraday, foreign currency and unreadable periods are skipped', () => {
  const parsed = parseDocument(
    document(
      series([day(START)], { contract: 'A07' }),
      series([day(START)], { currency: 'GBP' }),
      series([period({ start: START, count: 2, price: () => 'n/a' })]),
      series([period({ start: START, count: 2, price: () => 200_000 })]),
    ),
  );
  assert.equal(parsed.slots.length, 0);
  assert.deepEqual(parsed.skipped, [
    'contract A07',
    'unit GBP/MWH',
    'unreadable point',
    'price out of bounds',
  ]);
});

test('acknowledgements: 999 is "no data yet", anything else a refusal', () => {
  assert.deepEqual(parseDocument(acknowledgement()), { kind: 'no_data' });
  assert.deepEqual(parseDocument(acknowledgement('Z1', 'Bad &amp; wrong')), {
    kind: 'refused',
    code: 'Z1',
    reason: 'Bad & wrong',
  });
});

test('not a price document: refused as invalid', () => {
  for (const text of ['<html><body>Maintenance</body></html>', '<a><b></a>', '{"json":1}']) {
    assert.throws(
      () => parseDocument(text),
      (err) => err instanceof EntsoeError && err.code === 'invalid',
    );
  }
  const many = document(
    series(Array.from({ length: 61 }, (_, i) => period({ start: START + i * H, count: 1 }))),
  );
  assert.throws(() => parseDocument(many), /too many periods/);
});

test('fetchPrices: statuses map to error codes, never echoing the token', async () => {
  const cases = [
    [() => status(401), 'unauthorized'],
    [() => status(429, { 'retry-after': '120' }), 'rate_limited'],
    [() => status(503), 'server'],
    [() => status(403), 'http'],
    [() => xml(acknowledgement('Z1', 'invalid'), 400), 'bad_request'],
    [
      () => {
        throw new TypeError(
          `fetch failed for https://web-api.tp.entsoe.eu/api?securityToken=${TOKEN}`,
        );
      },
      'network',
    ],
    [() => xml('x'.repeat(10), 200, { 'content-length': String(10 * 1024 * 1024) }), 'too_large'],
  ];
  for (const [answer, code] of cases) {
    fake = installFetch(answer);
    await assert.rejects(
      fetchPrices({ token: TOKEN, zone: 'BE', start: START, end: START + 48 * H }),
      (err) => {
        assert.equal(err.code, code);
        assert.ok(!err.message.includes(TOKEN), err.message);
        if (code === 'rate_limited') assert.equal(err.retryAfter, 120_000);
        return true;
      },
    );
    assert.equal(fake.calls[0].params.in_Domain, '10YBE----------2');
    fake.restore();
  }
  fake = installFetch(() => xml(acknowledgement(), 400));
  assert.deepEqual(await fetchPrices({ token: TOKEN, zone: 'FR', start: START, end: START + H }), {
    kind: 'no_data',
  });
});

test('the body is read in chunks and refused past the limit', async () => {
  const chunks = [new Uint8Array(100), new Uint8Array(100)];
  const stream = () =>
    new ReadableStream({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
  await assert.rejects(readBounded(new Response(stream()), 150), /more than 150 bytes/);
  assert.equal((await readBounded(new Response('<a/>'), 150)).length, 4);
});
