// -----------------------------------------------------------------------------
// One Gladys device per bidding zone, with its price features. Pure.
// Keys are forever: the feature keys and the `zone` device type end up in
// the users' dashboards and scenes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { hhmm } from './prices.js';

export const DEVICE_TYPE = 'zone';

export const FEATURE = {
  CURRENT: 'current_price',
  NEXT: 'next_price',
  TODAY_MIN: 'today_min',
  TODAY_MAX: 'today_max',
  TODAY_AVG: 'today_average',
  TODAY_CHEAPEST_TIME: 'today_cheapest_time',
  TOMORROW_MIN: 'tomorrow_min',
  TOMORROW_CHEAPEST_TIME: 'tomorrow_cheapest_time',
  RANK: 'current_rank',
};

// Shown while a time is not known (tomorrow before publication).
export const UNKNOWN_TIME = '--:--';

// A price per kWh: euro is the unit the core lists for the currency
// category (DEVICE_FEATURE_UNITS_BY_CATEGORY). A negative price is a credit,
// a few euros the worst crisis.
const price = (name) => ({
  name,
  category: C.CURRENCY,
  type: T.CURRENCY.DECIMAL,
  unit: U.EURO,
  min: -5,
  max: 50,
  keep_history: true,
});
const time = (name) => ({
  name,
  category: C.TEXT,
  type: T.TEXT.TEXT,
  min: 0,
  max: 0,
  keep_history: false,
});

const DEFINITIONS = {
  [FEATURE.CURRENT]: price('Current price (EUR/kWh)'),
  [FEATURE.NEXT]: price('Next period price (EUR/kWh)'),
  [FEATURE.TODAY_MIN]: price("Today's lowest price (EUR/kWh)"),
  [FEATURE.TODAY_MAX]: price("Today's highest price (EUR/kWh)"),
  [FEATURE.TODAY_AVG]: price("Today's average price (EUR/kWh)"),
  [FEATURE.TODAY_CHEAPEST_TIME]: time("Today's cheapest period (start)"),
  [FEATURE.TOMORROW_MIN]: price("Tomorrow's lowest price (EUR/kWh)"),
  [FEATURE.TOMORROW_CHEAPEST_TIME]: time("Tomorrow's cheapest period (start)"),
  // No unit: a position among the periods of the day (96 quarters, 100 on
  // the autumn DST day). `unknown` is the core category without a unit.
  [FEATURE.RANK]: {
    name: 'Rank of the current period (0 = cheapest)',
    category: C.UNKNOWN,
    type: T.UNKNOWN.UNKNOWN,
    min: 0,
    max: 99,
    keep_history: true,
  },
};

/** The external ids of a zone: `{ device, feature(key) }`. */
export const idsOf = (gladys, zone) => gladys.externalIds(DEVICE_TYPE, zone);

export function buildDevice(gladys, zone) {
  const ids = idsOf(gladys, zone);
  return {
    name: `ENTSO-E ${zone}`,
    external_id: ids.device,
    params: [{ name: 'ZONE', value: zone }],
    should_poll: false,
    features: Object.entries(DEFINITIONS).map(([key, definition]) => ({
      ...definition,
      external_id: ids.feature(key),
      read_only: true,
      has_feedback: false,
    })),
  };
}

/** The states of a zone for a `snapshot()` (nothing when no price is known). */
export function buildStates(gladys, zone, snap, timezone) {
  const ids = idsOf(gladys, zone);
  const states = [];
  const number = (key, value) => {
    if (Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const text = (key, value) =>
    states.push({ device_feature_external_id: ids.feature(key), text: value });
  if (!snap.current && !snap.today) {
    return states;
  }
  number(FEATURE.CURRENT, snap.current?.price);
  number(FEATURE.NEXT, snap.next?.price);
  number(FEATURE.TODAY_MIN, snap.today?.min.price);
  number(FEATURE.TODAY_MAX, snap.today?.max.price);
  number(FEATURE.TODAY_AVG, snap.today?.avg);
  text(
    FEATURE.TODAY_CHEAPEST_TIME,
    snap.today ? hhmm(snap.today.min.start, timezone) : UNKNOWN_TIME,
  );
  number(FEATURE.TOMORROW_MIN, snap.tomorrow?.min.price);
  text(
    FEATURE.TOMORROW_CHEAPEST_TIME,
    snap.tomorrow ? hhmm(snap.tomorrow.min.start, timezone) : UNKNOWN_TIME,
  );
  number(FEATURE.RANK, snap.rank);
  return states;
}
