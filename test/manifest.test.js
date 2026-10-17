// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTION_TEST } from '../src/app.js';
import { DEFAULTS, LIMITS } from '../src/config.js';
import { ZONES } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics, and one version everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-entsoe:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.name, 'gladys-entsoe');
  assert.deepEqual(manifest.categories, ['energy']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.security_token.type, 'secret');
  assert.equal(fields.security_token.default, undefined);
  // Never claim encryption: Gladys keeps a secret in clear in its database.
  for (const text of Object.values(fields.security_token.description)) {
    assert.doesNotMatch(text, /encrypt|chiffr/i);
    assert.match(text, /ENTSO-E/);
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, `${key} default`);
  }
  for (const [key, { min, max }] of Object.entries(LIMITS)) {
    assert.equal(fields[key].min, min, `${key} min`);
    assert.equal(fields[key].max, max, `${key} max`);
  }
  assert.deepEqual(
    fields.zone.options.map((o) => o.value),
    Object.keys(ZONES),
  );
  const section = fields.intro;
  assert.equal(section.type, 'section');
  for (const link of section.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the action is wired', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    [ACTION_TEST],
  );
  assert.ok(index.includes('onAction(ACTION_TEST'));
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('the features use only categories, types and units the core lists', () => {
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the core (server/utils/constants.js):
  // the currency category takes these units; text and unknown take none.
  const allowed = {
    currency: ['euro', 'dollar', 'bitcoin', 'litecoin', 'ethereum', 'dogecoin', 'pound-sterling'],
  };
  const device = buildDevice(createFakeGladys({ selector: 'entsoe' }), 'FR');
  const types = { currency: ['decimal'], text: ['text'], unknown: ['unknown'] };
  for (const feature of device.features) {
    assert.ok(types[feature.category]?.includes(feature.type), feature.external_id);
    if (feature.unit !== undefined) {
      assert.ok(allowed[feature.category]?.includes(feature.unit), `${feature.external_id} unit`);
    }
    assert.equal(feature.read_only, true);
    assert.ok(feature.min <= feature.max);
  }
  assert.equal(new Set(device.features.map((x) => x.external_id)).size, device.features.length);
});

test('the licenses ship with the image', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  assert.match(read('LICENSE'), /Apache License\s+Version 2\.0/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /JaccoR\/hass-entso-e/);
  assert.equal(pkg.license, 'Apache-2.0');
});
