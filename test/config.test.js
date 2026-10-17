import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig } from '../src/config.js';

test('defaults', () => {
  assert.deepEqual(normalizeConfig(), {
    token: '',
    tokenMalformed: false,
    zone: DEFAULTS.zone,
    vatPercent: 0,
    feesPerKwh: 0,
    timezone: 'Europe/Paris',
  });
});

test('values from the form are trimmed, bounded and validated', () => {
  const config = normalizeConfig({
    security_token: '  1d9cd4bd-f8aa-476c-8cc1-3442dc91506d ',
    zone: 'de_lu',
    vat_percent: '21',
    fees_per_kwh: '0.12',
    timezone: 'Europe/Brussels',
  });
  assert.equal(config.token, '1d9cd4bd-f8aa-476c-8cc1-3442dc91506d');
  assert.equal(config.zone, 'DE_LU');
  assert.equal(config.vatPercent, 21);
  assert.equal(config.feesPerKwh, 0.12);
  assert.equal(config.timezone, 'Europe/Brussels');
  const bad = normalizeConfig({
    security_token: 'abc&x=1 2',
    zone: 'XX',
    vat_percent: 99,
    fees_per_kwh: -1,
    timezone: 'Mars/Olympus',
  });
  assert.equal(bad.token, '');
  assert.equal(bad.tokenMalformed, true);
  assert.equal(bad.zone, 'FR');
  assert.equal(bad.vatPercent, 0);
  assert.equal(bad.feesPerKwh, 0);
  assert.equal(bad.timezone, 'Europe/Paris');
});
