// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake ENTSO-E.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTION_TEST, EntsoeApp } from '../src/app.js';
import { acknowledgement, day, document, series } from './helpers/a44.js';
import { installFetch, status, xml } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const TOKEN = '1d9cd4bd-f8aa-476c-8cc1-3442dc91506d';
const H = 3_600_000;
const MIN = 60_000;
const TODAY = Date.parse('2026-10-15T22:00:00Z'); // 2026-10-16 00:00 Paris
const TOMORROW = TODAY + 24 * H;
const MORNING = TODAY + 10 * H; // 10:00 Paris
const AT_13 = Date.parse('2026-10-16T11:00:00Z'); // 13:00 Brussels
const DEVICE = 'ext:entsoe:zone:FR';
const f = (key) => `${DEVICE}:${key}`;

let fake;
afterEach(() => fake?.restore());

// Today: a V shape (cheapest 04:00), tomorrow: cheapest at 02:30, EUR/MWh.
const todayPrice = (i) => Math.abs(i - 16) * 10;
const tomorrowPrice = (i) => (i === 10 ? -5 : 80 + i);

const instant = (text) =>
  Date.parse(text.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:00Z'));

/**
 * A fake ENTSO-E answering the Brussels market days that overlap the asked
 * window: today and before always, a later day once in `market.published`,
 * or, with `market.auto`, from 13:00 Brussels time the day before (CEST).
 */
function platform(market, clock) {
  return (call) => {
    if (market.answer) {
      return market.answer(call);
    }
    const start = instant(call.params.periodStart);
    const end = instant(call.params.periodEnd);
    const periods = [];
    for (let k = -1; k <= 3; k += 1) {
      const dayStart = TODAY + k * 24 * H;
      const price = k === 0 ? todayPrice : k === 1 ? tomorrowPrice : () => 70;
      const visible =
        dayStart < TOMORROW ||
        market.published.includes(dayStart) ||
        (market.auto && clock.now >= dayStart - 11 * H);
      if (dayStart < end && dayStart + 24 * H > start && visible) {
        periods.push(day(dayStart, { price }));
      }
    }
    return xml(periods.length ? document(series(periods)) : acknowledgement());
  };
}

function setup({ now = MORNING, published = [], auto = false } = {}) {
  const market = { published, auto, answer: undefined };
  const clock = { now };
  fake = installFetch(platform(market, clock));
  const timers = createFakeTimers(clock);
  const logs = [];
  const logger = {
    info: (m) => logs.push(m),
    warn: (m) => logs.push(m),
    error: (m) => logs.push(m),
    debug() {},
  };
  const gladys = createFakeGladys({ selector: 'entsoe' });
  const app = new EntsoeApp({ gladys, logger, now: () => clock.now, timers });
  gladys.onAction(ACTION_TEST, () => app.testConnection());
  const fireFetch = () => timers.fire((t) => t.id === app.fetchTimer);
  const fireTick = () => timers.fire((t) => t.id === app.tickTimer);
  return { app, gladys, timers, clock, market, logs, fireFetch, fireTick };
}

const CONFIG = { security_token: TOKEN, zone: 'FR' };

test('start: one device, its states from one reading, then 13:00 Brussels', async () => {
  const { app, gladys, timers } = setup();
  await app.start(CONFIG);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.deepEqual(
    device.features.map((x) => [x.external_id.slice(DEVICE.length + 1), x.category, x.unit]),
    [
      ['current_price', 'currency', 'euro'],
      ['next_price', 'currency', 'euro'],
      ['today_min', 'currency', 'euro'],
      ['today_max', 'currency', 'euro'],
      ['today_average', 'currency', 'euro'],
      ['today_cheapest_time', 'text', undefined],
      ['tomorrow_min', 'currency', 'euro'],
      ['tomorrow_cheapest_time', 'text', undefined],
      ['current_rank', 'unknown', undefined],
    ],
  );
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].params.periodStart, '202610152200');
  assert.equal(fake.calls[0].params.periodEnd, '202610172200');
  assert.equal(gladys.fake.lastState(f('current_price')), 0.24);
  assert.equal(gladys.fake.lastState(f('next_price')), 0.25);
  assert.equal(gladys.fake.lastState(f('today_min')), 0);
  assert.equal(gladys.fake.lastState(f('today_max')), 0.79);
  assert.equal(gladys.fake.lastState(f('today_cheapest_time')), '04:00');
  assert.equal(gladys.fake.lastState(f('tomorrow_cheapest_time')), '--:--');
  assert.equal(gladys.fake.lastState(f('tomorrow_min')), undefined);
  assert.equal(gladys.fake.lastState(f('current_rank')), 40);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.fr, /demain après 13 h/);
  const pending = timers.list().map((t) => t.at);
  assert.deepEqual(pending, [MORNING + 15 * MIN + 1_000, AT_13]);
  await app.stop();
  assert.equal(timers.pending.size, 0);
});

test('tomorrow: asked from 13:00, then after 10, 20, 30, 60, 60 minutes, then 13:00 the next day', async () => {
  const { app, gladys, market, clock, fireFetch } = setup();
  await app.start(CONFIG);
  await fireFetch();
  assert.equal(clock.now, AT_13);
  const gaps = [];
  for (let i = 0; i < 5; i += 1) {
    const before = clock.now;
    await fireFetch();
    gaps.push((clock.now - before) / MIN);
  }
  assert.deepEqual(gaps, [10, 20, 30, 60, 60]);
  assert.equal(fake.calls.length, 7);
  market.published.push(TOMORROW);
  await fireFetch();
  assert.equal(gladys.fake.lastState(f('tomorrow_min')), -0.005);
  assert.equal(gladys.fake.lastState(f('tomorrow_cheapest_time')), '02:30');
  assert.match(gladys.fake.connectionStatus.message.en, /today and tomorrow\.$/);
  assert.equal(app.nextFetchAt, AT_13 + 24 * H);
  await app.stop();
});

test('the quarter-hour tick moves the sensors without any network call, past midnight too', async () => {
  const { app, gladys, clock, fireTick } = setup({ now: AT_13 + 3 * H, published: [TOMORROW] });
  await app.start(CONFIG);
  const calls = fake.calls.length;
  await fireTick();
  assert.equal(clock.now, AT_13 + 3 * H + 15 * MIN + 1_000);
  // 16:15 Paris: position 66 of today, |65 - 16| x 10 EUR/MWh.
  assert.equal(gladys.fake.lastState(f('current_price')), 0.49);
  // Up to 00:00:01 Paris: tomorrow is today now, the day after is unknown.
  while (clock.now < TOMORROW) {
    await fireTick();
  }
  assert.equal(fake.calls.length, calls, 'no network call');
  assert.equal(gladys.fake.lastState(f('current_price')), 0.08);
  assert.equal(gladys.fake.lastState(f('today_min')), -0.005);
  assert.equal(gladys.fake.lastState(f('today_cheapest_time')), '02:30');
  assert.equal(gladys.fake.lastState(f('tomorrow_cheapest_time')), '--:--');
  await app.stop();
});

test('VAT and fees apply without reading again; a new zone is a new device', async () => {
  const { app, gladys } = setup();
  await app.start(CONFIG);
  await app.start({ ...CONFIG, vat_percent: 20, fees_per_kwh: 0.1 });
  assert.equal(fake.calls.length, 1);
  assert.equal(gladys.fake.lastState(f('current_price')), 0.408); // (0.24 + 0.1) x 1.2
  await app.start({ ...CONFIG, zone: 'BE' });
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].params.in_Domain, '10YBE----------2');
  assert.equal(gladys.fake.discoveredDevices.at(-1).external_id, 'ext:entsoe:zone:BE');
  await app.stop();
});

test('429: a bounded pause that every path respects, a reconnection included', async () => {
  const { app, gladys, market, clock, fireFetch } = setup();
  market.answer = () => status(429, { 'retry-after': '5' });
  await app.start(CONFIG);
  assert.equal(app.pauseUntil, MORNING + 60_000, 'at least one minute');
  assert.match(gladys.fake.connectionStatus.message.en, /No price yet: ENTSO-E asked to slow down/);
  // The button and a reconnection wait for the end of the pause.
  const ack = await gladys.fake.action(ACTION_TEST);
  assert.match(ack.message?.en ?? JSON.stringify(ack), /slow down/);
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 1);
  market.answer = () => status(429, { 'retry-after': '999999' });
  await fireFetch();
  assert.equal(fake.calls.length, 2);
  assert.equal(app.pauseUntil, clock.now + 6 * H, 'at most six hours');
  market.answer = () => status(429);
  await fireFetch();
  assert.equal(app.pauseUntil, clock.now + 10 * MIN, 'ten minutes without Retry-After');
  market.answer = undefined;
  await fireFetch();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await app.stop();
});

test('401: readings stop and say so; only a new token or the button reads again', async () => {
  const { app, gladys, market, timers, logs } = setup();
  market.answer = () => status(401);
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /refusé le jeton/);
  assert.equal(app.fetchTimer, undefined, 'no retry timer');
  assert.ok(app.tickTimer !== undefined, 'the local tick goes on');
  assert.equal(timers.pending.size, 1);
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 1, 'a restart with the same token does not ask again');
  // The button asks once, and is refused again.
  let ack = await gladys.fake.action(ACTION_TEST);
  assert.equal(fake.calls.length, 2);
  assert.match(JSON.stringify(ack), /refused the security token/);
  // A new token is asked at once.
  market.answer = undefined;
  await app.start({ ...CONFIG, security_token: 'aaaaaaaa-bbbb' });
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[2].params.securityToken, 'aaaaaaaa-bbbb');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  ack = await gladys.fake.action(ACTION_TEST);
  assert.match(JSON.stringify(ack), /ENTSO-E OK for FR: 0\.2400 EUR\/kWh now \(rank 40/);
  assert.ok(
    logs.every((line) => !String(line).includes(TOKEN)),
    'the token is never logged',
  );
  await app.stop();
});

test('5xx and network errors: retried after 5, 15, 30, 60 minutes, last prices kept', async () => {
  const { app, gladys, market, clock, fireFetch } = setup();
  await app.start(CONFIG);
  market.answer = () => status(503);
  await fireFetch(); // the 13:00 reading
  const gaps = [];
  for (let i = 0; i < 4; i += 1) {
    const before = clock.now;
    await fireFetch();
    gaps.push((clock.now - before) / MIN);
  }
  assert.deepEqual(gaps, [5, 15, 30, 60]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /^Showing the last prices read; ENTSO-E is in trouble \(503\)/,
  );
  market.answer = () => {
    throw new TypeError('fetch failed');
  };
  const before = clock.now;
  await fireFetch();
  assert.equal(clock.now - before, 60 * MIN);
  assert.match(gladys.fake.connectionStatus.message.en, /ENTSO-E is unreachable/);
  await app.stop();
});

test('no data for the zone today: said, and asked again every hour', async () => {
  const { app, gladys, market } = setup();
  market.answer = () => xml(acknowledgement());
  await app.start(CONFIG);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /publishes no day-ahead price for FR/);
  assert.equal(app.nextFetchAt, MORNING + H);
  assert.equal(gladys.fake.states.length, 0);
  await app.stop();
});

test('without a token nothing is asked, and the status says what to do', async () => {
  const { app, gladys } = setup();
  await app.start({ zone: 'FR' });
  assert.match(gladys.fake.connectionStatus.message.en, /Enter your ENTSO-E security token/);
  await app.start({ security_token: 'not a token!' });
  assert.match(gladys.fake.connectionStatus.message.en, /does not look like an ENTSO-E token/);
  assert.match(JSON.stringify(await gladys.fake.action(ACTION_TEST)), /does not look like/);
  assert.equal(fake.calls.length, 0);
  assert.equal(app.fetchTimer, undefined);
  await app.stop();
});

test('Lisbon (west of Brussels): three readings in 48 hours, tomorrow shown after 13:00', async () => {
  const { app, gladys, timers, clock } = setup({ auto: true });
  await app.start({ ...CONFIG, timezone: 'Europe/Lisbon' });
  assert.equal(fake.calls.length, 1);
  assert.equal(gladys.fake.lastState(f('tomorrow_cheapest_time')), '--:--');
  const end = MORNING + 48 * H;
  let tomorrowShown;
  while (clock.now < end) {
    await timers.fire();
    if (clock.now > AT_13 && clock.now < AT_13 + H && tomorrowShown === undefined) {
      tomorrowShown = gladys.fake.lastState(f('tomorrow_cheapest_time'));
    }
  }
  assert.equal(fake.calls.length, 3, 'start, then 13:00 on each day');
  // Brussels' 17 starts at 22:00Z (23:00 Lisbon on the 16th); Lisbon's 17
  // starts at 23:00Z. Its cheapest known period is position 11 of Brussels'
  // 17: 00:30Z, 02:30 in Paris, 01:30 in Lisbon.
  assert.equal(tomorrowShown, '01:30');
  await app.stop();
});

test('an unexpected error is logged by its name only (its message may hold the URL)', async () => {
  const { gladys, clock, timers, logs } = setup();
  const app = new EntsoeApp({
    gladys,
    logger: { info() {}, warn: (m) => logs.push(m), error() {}, debug() {} },
    now: () => clock.now,
    timers,
    fetch: async () => {
      throw new TypeError(`bad https://web-api.tp.entsoe.eu/api?securityToken=${TOKEN}`);
    },
  });
  await app.start(CONFIG);
  assert.ok(logs.some((line) => line.includes('(TypeError)')));
  assert.ok(logs.every((line) => !line.includes(TOKEN)));
  assert.ok(app.nextFetchAt > clock.now, 'retried later');
  await app.stop();
});

test('Helsinki (east of Brussels): tomorrow_min is not rewritten from 00:00 to 14:00', async () => {
  const { app, gladys, timers } = setup({ now: AT_13 + H, auto: true });
  await app.start({ ...CONFIG, timezone: 'Europe/Helsinki' });
  // Tomorrow (the 17th in Helsinki) is out: its cheapest is position 11 of
  // Brussels' 17, 00:30Z = 03:30 in Helsinki.
  assert.equal(gladys.fake.lastState(f('tomorrow_cheapest_time')), '03:30');
  const midnight = Date.parse('2026-10-16T21:00:00Z'); // 00:00 Helsinki on the 17th
  while (timers.list()[0].at < midnight) {
    await timers.fire();
  }
  const before = gladys.fake.lastState(f('tomorrow_min'));
  assert.equal(before, -0.005);
  const from = gladys.fake.states.length;
  const auction = Date.parse('2026-10-17T11:00:00Z'); // 14:00 Helsinki, 13:00 Brussels
  while (timers.list()[0].at < auction) {
    await timers.fire();
  }
  const written = gladys.fake.states
    .slice(from)
    .filter((s) => s.device_feature_external_id === f('tomorrow_min'))
    .map((s) => s.state);
  assert.ok(
    written.every((value) => value === before),
    JSON.stringify(written),
  );
  assert.equal(gladys.fake.lastState(f('tomorrow_cheapest_time')), '--:--');
  await app.stop();
});

test('after a 401, saving the configuration with the same token asks once; a reconnection does not', async () => {
  const { app, gladys, market } = setup();
  market.answer = () => status(401);
  await app.start(CONFIG);
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 1);
  market.answer = undefined;
  await app.start(CONFIG, { userSaved: true });
  assert.equal(fake.calls.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await app.stop();
});

test('disconnection then reconnection (Gladys restarted): status and Discovery published again', async () => {
  // Each case on a fresh installation: prices known; a refused token; a 503
  // in its retry delay; a 429 pause. The reconnection must say the same
  // status again and ask ENTSO-E nothing.
  const cases = [
    { name: 'prices known', check: (app) => assert.equal(app.lastError, undefined) },
    {
      name: '401',
      answer: () => status(401),
      check: (app) => assert.equal(app.refusedToken, TOKEN),
    },
    {
      name: '503',
      answer: () => status(503),
      check: (app) => assert.equal(app.lastError?.code, 'server'),
    },
    {
      name: '429',
      answer: () => status(429, { 'retry-after': '600' }),
      check: (app) => {
        assert.equal(app.lastError?.code, 'rate_limited');
        assert.ok(app.pauseUntil > MORNING);
      },
    },
  ];
  for (const { name, answer, check } of cases) {
    fake?.restore();
    const { app, gladys, market } = setup();
    const discoveries = () => gladys.fake.bodies('POST', '/discovered_device').length;
    market.answer = answer;
    await app.start(CONFIG);
    assert.equal(fake.calls.length, 1, name);
    check(app);
    const statuses = gladys.fake.connectionStatuses.length;
    const published = discoveries();
    const before = gladys.fake.connectionStatus;
    // index.js: 'disconnected' stops, 'connected' starts again.
    await app.stop();
    await app.start(CONFIG);
    assert.equal(gladys.fake.connectionStatuses.length, statuses + 1, `${name}: one more status`);
    assert.deepEqual(gladys.fake.connectionStatus, before, `${name}: the same status`);
    assert.equal(discoveries(), published + 1, `${name}: Discovery again`);
    assert.equal(fake.calls.length, 1, `${name}: nothing asked again`);
    await app.stop();
  }
});

test('a reconnection keeps the backoff of a failed reading', async () => {
  const { app, market } = setup();
  market.answer = () => status(503);
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 1);
  const next = app.nextFetchAt;
  await app.stop();
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 1);
  assert.equal(app.nextFetchAt, next);
  await app.stop();
});

test('a failed discovery does not stop the readings; a scan before start works', async () => {
  const { app, gladys } = setup();
  await app.publishDevices();
  assert.equal(gladys.fake.discoveredDevices[0].external_id, DEVICE);
  gladys.publishDiscoveredDevices = async () => {
    throw new Error('Gladys refused');
  };
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 1);
  assert.equal(gladys.fake.lastState(f('current_price')), 0.24);
  await app.stop();
});

test('the button waits for a reading under way instead of asking again', async () => {
  const { app, gladys, market } = setup();
  let release;
  market.answer = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const starting = app.start(CONFIG);
  while (!release) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const ack = gladys.fake.action(ACTION_TEST);
  market.answer = undefined;
  release(platform(market, { now: MORNING })({ params: fake.calls[0].params }));
  await starting;
  assert.match(JSON.stringify(await ack), /ENTSO-E OK for FR/);
  assert.equal(fake.calls.length, 1);
  await app.stop();
});

test('a reconnection keeps the prices: no new reading when today and tomorrow are known', async () => {
  const { app } = setup({ now: AT_13 + H, published: [TOMORROW] });
  await app.start(CONFIG);
  await app.stop();
  await app.start(CONFIG);
  assert.equal(fake.calls.length, 1);
  assert.equal(app.nextFetchAt, AT_13 + 24 * H);
  await app.stop();
});
