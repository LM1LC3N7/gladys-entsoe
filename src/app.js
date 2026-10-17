// -----------------------------------------------------------------------------
// The integration itself: reads the day-ahead prices of the configured zone
// on the ENTSO-E Transparency Platform and keeps the price sensors fed.
// index.js only wires the SDK handlers to it.
//
// Schedule: today and tomorrow are read at start; tomorrow is asked from
// 13:00 Brussels time, then after 10, 20, 30 and every 60 minutes until it is
// published; the next reading is at 13:00 the day after. Between readings,
// the sensors follow the quarter hours from the prices in memory, without
// any network call. A 429 pauses every reading (Retry-After, bounded); a
// refused token (401) stops the readings until the configuration changes or
// the user presses "Read the prices now".
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  BAD_REQUEST_RETRY,
  ERROR_RETRIES,
  MARKET_TIMEZONE,
  PAUSE_BOUNDS,
  RATE_LIMIT_DEFAULT,
  STATE_HEARTBEAT,
  TICK_MINUTES,
  TODAY_RETRY,
  TOMORROW_FROM,
  TOMORROW_RETRIES,
} from './constants.js';
import { buildDevice, buildStates } from './devices.js';
import { EntsoeError } from './http.js';
import { fetchPrices } from './entsoe.js';
import { T, reasonOf, withReason } from './i18n.js';
import {
  addDays,
  dayOf,
  localDate,
  mergeSlots,
  snapshot,
  tomorrowFrom,
  zonedTime,
} from './prices.js';

export const ACTION_TEST = 'test_connection';

const defaultTimers = { setTimeout, clearTimeout };
const clamp = (value, { min, max }) => Math.min(max, Math.max(min, value));
const pick = (list, index) => list[Math.min(index, list.length - 1)];

export class EntsoeApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'entsoe' }),
    now = Date.now,
    timers = defaultTimers,
    fetch = fetchPrices,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.fetchPrices = fetch;
    this.config = undefined;
    // Raw slots { start, end, price (EUR/MWh) } of today and tomorrow.
    this.slots = [];
    this.fetchTimer = undefined;
    this.tickTimer = undefined;
    this.nextFetchAt = undefined;
    // Kept across restarts and reconnections: a 429 pause, and the token
    // the platform refused (only a new token, or the button, clears it).
    this.pauseUntil = 0;
    this.refusedToken = undefined;
    this.errorStreak = 0;
    this.tomorrowStreak = 0;
    this.lastError = undefined;
    this.lastStatus = undefined;
    this.lastStatusArgs = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
    this.fetching = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * (Re)start with a configuration. `userSaved`: the user saved the
   * configuration (onConfigUpdated), which lifts a refused-token block once,
   * even with the same token; a reconnection to Gladys keeps it.
   */
  start(raw = {}, { userSaved = false } = {}) {
    return this.serialize(() => this.doStart(raw, { userSaved }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { userSaved = false } = {}) {
    await this.doStop();
    // Gladys keeps the status in memory only: a (re)connection may follow a
    // restart of the core, so the status is published again, never assumed kept.
    const previousStatus = this.lastStatusArgs;
    this.lastStatus = undefined;
    const generation = this.generation;
    const previous = this.config;
    this.config = normalizeConfig(raw);
    const zoneChanged = previous?.zone !== this.config.zone;
    const tokenChanged = previous?.token !== this.config.token;
    if (zoneChanged) {
      this.slots = [];
      this.tomorrowStreak = 0;
    }
    if (tokenChanged) {
      this.errorStreak = 0;
      this.lastError = undefined;
    }
    if (userSaved) {
      this.refusedToken = undefined;
    }
    // A failed discovery must not stop the readings nor the tick.
    await this.publishDevices().catch((err) =>
      this.logger.warn(`Publishing the device failed: ${err.message}`),
    );
    await this.tick();
    if (generation !== this.generation) {
      return;
    }
    if (!this.config.token) {
      await this.setStatus(false, this.config.tokenMalformed ? T.malformedToken : T.noToken);
      return;
    }
    if (this.refusedToken === this.config.token) {
      await this.setStatus(false, T.refused);
      return;
    }
    const now = this.now();
    if (
      this.lastError &&
      !zoneChanged &&
      !tokenChanged &&
      !userSaved &&
      this.nextFetchAt !== undefined &&
      this.nextFetchAt > now
    ) {
      // A reconnection does not shortcut the backoff of a failed reading; the
      // status of that failure is said again.
      this.scheduleRead(this.nextFetchAt);
      if (previousStatus) {
        await this.setStatus(...previousStatus);
      }
      return;
    }
    if (this.needsReading()) {
      if (this.slots.length === 0) {
        await this.setStatus(false, T.starting);
      }
      await this.read();
    } else {
      this.scheduleAfterSuccess();
      await this.updateStatus();
    }
  }

  async doStop() {
    this.generation += 1;
    this.timers.clearTimeout(this.fetchTimer);
    this.timers.clearTimeout(this.tickTimer);
    this.fetchTimer = undefined;
    this.tickTimer = undefined;
    await this.fetching?.catch(() => {});
  }

  async setStatus(connected, message) {
    this.lastStatusArgs = [connected, message];
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async publishDevices() {
    const { zone } = this.config ?? normalizeConfig();
    await this.gladys.publishDiscoveredDevices([buildDevice(this.gladys, zone)]);
  }

  snap(t = this.now()) {
    return snapshot(this.slots, t, this.config);
  }

  // --- Reading ENTSO-E -------------------------------------------------------

  /** Something publishable at `t` is missing (see snapshot()). */
  needsReading(t = this.now()) {
    return !this.snap(t).allComplete;
  }

  /** Read today and tomorrow once. Single-flight; `manual` for the button. */
  read({ manual = false } = {}) {
    if (!this.fetching) {
      this.fetching = this.doRead({ manual }).finally(() => {
        this.fetching = undefined;
      });
    }
    return this.fetching;
  }

  async doRead({ manual }) {
    const generation = this.generation;
    const { token, zone, timezone } = this.config;
    const now = this.now();
    if (!token) {
      return;
    }
    if (now < this.pauseUntil) {
      // Every path waits for the end of a 429 pause, the button included.
      this.scheduleRead(this.pauseUntil);
      await this.setStatus(
        this.snap(now).current !== undefined,
        T.paused(this.pauseUntil, timezone),
      );
      return;
    }
    if (this.refusedToken === token && !manual) {
      return;
    }
    let result;
    try {
      result = await this.fetchPrices({
        token,
        zone,
        start: dayOf(now, timezone).start,
        end: dayOf(now, timezone, 2).start,
      });
      if (result.kind === 'prices' && result.slots.length === 0 && result.skipped.length > 0) {
        // Distinguish a zone priced in another unit from an unusable answer.
        const unit = result.skipped.some((s) => s.startsWith('unit '));
        throw new EntsoeError(
          unit ? 'unsupported' : 'unusable',
          `ENTSO-E series skipped: ${result.skipped.join(', ')}`,
        );
      }
    } catch (err) {
      if (generation === this.generation) {
        await this.failed(err);
      }
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    this.refusedToken = undefined;
    this.errorStreak = 0;
    this.lastError = undefined;
    if (result.kind === 'prices') {
      if (result.skipped.length > 0) {
        this.logger.info(`Some ENTSO-E periods were skipped: ${result.skipped.join(', ')}`);
      }
      const todayStart = dayOf(this.now(), timezone).start;
      this.slots = mergeSlots(this.slots, result.slots).filter((s) => s.end > todayStart);
    }
    await this.tick({ reschedule: false });
    this.scheduleAfterSuccess();
    await this.updateStatus();
  }

  async failed(err) {
    const { timezone } = this.config;
    const now = this.now();
    this.lastError = err;
    // Only our own messages are logged: they are built from fixed strings
    // and sanitized codes, never from a URL (the token is in it).
    const detail = err instanceof EntsoeError ? err.message : (err?.name ?? 'Error');
    this.logger.warn(`Reading ENTSO-E failed: ${err?.code ?? 'error'} (${detail})`);
    if (err.code === 'unauthorized') {
      // Stop: the platform will not accept this token by itself. No timer,
      // so no loop; the quarter-hour tick keeps the last prices shown.
      this.refusedToken = this.config.token;
      this.timers.clearTimeout(this.fetchTimer);
      this.fetchTimer = undefined;
      this.nextFetchAt = undefined;
      await this.setStatus(false, T.refused);
      return;
    }
    let delay;
    if (err.code === 'rate_limited') {
      delay = clamp(err.retryAfter ?? RATE_LIMIT_DEFAULT, PAUSE_BOUNDS);
      this.pauseUntil = now + delay;
    } else if (['bad_request', 'unsupported', 'unusable'].includes(err.code)) {
      delay = BAD_REQUEST_RETRY;
    } else {
      delay = clamp(pick(ERROR_RETRIES, this.errorStreak), PAUSE_BOUNDS);
      this.errorStreak += 1;
    }
    this.scheduleRead(now + delay);
    const hasPrice = this.snap(now).current !== undefined;
    await this.setStatus(
      hasPrice,
      withReason(hasPrice ? T.stale : T.unreachable, reasonOf(err), now + delay, timezone),
    );
  }

  scheduleRead(at) {
    this.timers.clearTimeout(this.fetchTimer);
    const generation = this.generation;
    this.nextFetchAt = at;
    this.fetchTimer = this.timers.setTimeout(
      () => {
        this.fetchTimer = undefined;
        if (generation === this.generation) {
          return this.read().catch((err) =>
            this.logger.warn(
              `Reading failed: ${err instanceof EntsoeError ? err.message : err?.name}`,
            ),
          );
        }
      },
      Math.max(1_000, at - this.now()),
    );
  }

  /**
   * After an answer: what was published before today's auction missing ->
   * again in an hour; before 13:00 Brussels -> at 13:00; tomorrow's market
   * day missing after 13:00 -> spaced retries; all known -> 13:00 next day.
   */
  scheduleAfterSuccess() {
    const now = this.now();
    const snap = this.snap(now);
    const from = tomorrowFrom(now);
    if (!snap.baseComplete) {
      this.scheduleRead(now + TODAY_RETRY);
    } else if (now < from) {
      this.scheduleRead(from);
    } else if (!snap.allComplete) {
      this.scheduleRead(now + pick(TOMORROW_RETRIES, this.tomorrowStreak));
      this.tomorrowStreak += 1;
    } else {
      this.tomorrowStreak = 0;
      const date = addDays(localDate(now, MARKET_TIMEZONE), 1);
      this.scheduleRead(zonedTime(date, MARKET_TIMEZONE, TOMORROW_FROM.hour, TOMORROW_FROM.minute));
    }
  }

  async updateStatus() {
    const snap = this.snap();
    if (!snap.current) {
      await this.setStatus(false, T.noData(this.config.zone));
      return;
    }
    await this.setStatus(true, T.ok(this.config.zone, snap.tomorrowComplete));
  }

  // --- The quarter-hour tick, local only --------------------------------------

  scheduleTick() {
    this.timers.clearTimeout(this.tickTimer);
    const now = this.now();
    const size = TICK_MINUTES * 60_000;
    // A second after the boundary: the clocks of Gladys and ours agree.
    const next = Math.floor(now / size) * size + size + 1_000;
    const generation = this.generation;
    this.tickTimer = this.timers.setTimeout(() => {
      this.tickTimer = undefined;
      if (generation === this.generation) {
        return this.tick().catch((err) => this.logger.warn(`Tick failed: ${err.message}`));
      }
    }, next - now);
  }

  /** Publish the states for now (from memory, no network call). */
  async tick({ reschedule = true } = {}) {
    const generation = this.generation;
    const now = this.now();
    const todayStart = dayOf(now, this.config.timezone).start;
    this.slots = this.slots.filter((s) => s.end > todayStart);
    const states = buildStates(this.gladys, this.config.zone, this.snap(now), this.config.timezone);
    if (states.length > 0) {
      await this.gladys
        .publishChangedStates(states, { heartbeat: STATE_HEARTBEAT })
        .catch((err) => this.logger.warn(`Publishing the states failed: ${err.message}`));
    }
    if (reschedule && generation === this.generation) {
      this.scheduleTick();
    }
  }

  // --- Configuration screen button --------------------------------------------

  async testConnection() {
    const { token, tokenMalformed, timezone, zone } = this.config ?? normalizeConfig();
    if (!token) {
      return tokenMalformed ? T.malformedToken : T.noToken;
    }
    if (this.now() < this.pauseUntil) {
      return T.paused(this.pauseUntil, timezone);
    }
    if (this.fetching) {
      // A reading is under way: wait for it rather than read again, so the
      // answer comes within the action's 30 seconds (one HTTP timeout).
      await this.fetching.catch(() => {});
    } else {
      await this.read({ manual: true });
    }
    if (this.refusedToken === token) {
      return T.refused;
    }
    const snap = this.snap();
    if (this.lastError) {
      return withReason(
        snap.current ? T.stale : T.unreachable,
        reasonOf(this.lastError),
        this.nextFetchAt ?? this.now(),
        timezone,
      );
    }
    if (!snap.current) {
      return T.noData(zone);
    }
    return T.report({
      zone,
      current: snap.current.price.toFixed(4),
      avg: snap.today.avg.toFixed(4),
      rank: snap.rank,
      tomorrow: snap.tomorrowComplete,
    });
  }
}
