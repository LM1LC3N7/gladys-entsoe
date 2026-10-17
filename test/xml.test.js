import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XmlError, decodeText, scanXml } from '../src/xml.js';

function collect(text, options) {
  const events = [];
  scanXml(text, {
    ...options,
    onOpen: (name, parent) => events.push(['open', name, parent]),
    onClose: (name, value, parent) => events.push(['close', name, value, parent]),
  });
  return events;
}

test('elements, leaf texts, parents; namespaces, attributes and comments dropped', () => {
  const events = collect(
    '<?xml version="1.0"?><!-- c --><ns:a xmlns:ns="urn:x" k="v>w"><b>1</b><c/><d> x &amp; y <![CDATA[<&>]]></d></ns:a>',
  );
  assert.deepEqual(events, [
    ['open', 'a', undefined],
    ['open', 'b', 'a'],
    ['close', 'b', '1', 'a'],
    ['open', 'c', 'a'],
    ['close', 'c', '', 'a'],
    ['open', 'd', 'a'],
    ['close', 'd', 'x & y <&>', 'a'],
    ['close', 'a', '', undefined],
  ]);
});

test('entities: the five predefined and numeric references only', () => {
  assert.equal(decodeText('&lt;&gt;&amp;&quot;&apos;&#233;&#xE9;&foo;'), '<>&"\'éé&foo;');
});

test('malformed documents are refused', () => {
  for (const bad of [
    '',
    'text only',
    '<a>',
    '<a></b>',
    '<a><b></a></b>',
    '<a/><b/>',
    '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>',
    '<a><!-- never closed </a>',
    '<a b="unclosed></a>',
  ]) {
    assert.throws(() => scanXml(bad), XmlError, bad);
  }
});

test('the depth is bounded', () => {
  const deep = '<a>'.repeat(20) + '</a>'.repeat(20);
  assert.throws(() => scanXml(deep, { maxDepth: 16 }), /too deep/);
  assert.doesNotThrow(() => scanXml(deep, { maxDepth: 32 }));
});

test('linear: a large hostile input is scanned quickly', () => {
  // Patterns that make naive regex parsers backtrack: many '<' without '>',
  // long attribute strings, thousands of siblings.
  const siblings = `<r>${'<p><q>1</q></p>'.repeat(20_000)}</r>`;
  let count = 0;
  const started = process.hrtime.bigint();
  scanXml(siblings, { onClose: () => (count += 1) });
  assert.equal(count, 40_001);
  assert.throws(() => scanXml(`<r a="${'<'.repeat(200_000)}`), XmlError);
  assert.throws(() => scanXml(`<r>${'<!--'.repeat(50_000)}`), XmlError);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 2_000, `took ${ms} ms`);
});
