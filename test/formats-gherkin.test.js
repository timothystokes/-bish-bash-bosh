import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { FORMATS, checkFormats } from '../src/formats.js';

/** @param {Record<string, string>} files */
function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'gherkin-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const GOOD = `Feature: Orders
  @R-orders-1
  Scenario: Create an order
    Given an empty cart
    When I add item "a"
    Then the cart has 1 item

  @R-orders-2
  Scenario Outline: Price
    Given item <item>
    Then the price is <price>

    Examples:
      | item | price |
      | a    | 1     |
`;

const validate = (/** @type {string} */ text, name = 'a.feature') => {
  const dir = repo({ [name]: text });
  return FORMATS.gherkin.validate(join(dir, name));
};

test('gherkin is a registered format', () => {
  assert.ok(Object.hasOwn(FORMATS, 'gherkin'));
});

test('a feature whose scenarios each carry a requirement ID passes', () => {
  assert.deepEqual(validate(GOOD), []);
});

test('a feature-level requirement tag covers its scenarios', () => {
  assert.deepEqual(validate('@R-x-1\nFeature: F\n  Scenario: S\n    Given a\n'), []);
});

test('rule and background scenarios are covered', () => {
  const text = `Feature: F
  Background:
    Given a
  Rule: r
    @R-x-1
    Scenario: S
      Then b
`;
  assert.deepEqual(validate(text), []);
});

test('a syntax error is reported', () => {
  assert.match(validate('Feature: F\n  Scenario: S\n    Given a\nFeature: G\n').join('\n'), /invalid Gherkin/);
  assert.match(validate('not gherkin at all').join('\n'), /invalid Gherkin/);
});

test('a scenario without a requirement ID is reported', () => {
  const out = validate('Feature: F\n  @smoke\n  Scenario: S\n    Given a\n');
  assert.match(out.join('\n'), /scenario "S" has no requirement ID tag \(@R-<spec>-<n>\)/);
});

test('a file with no scenarios is reported', () => {
  assert.match(validate('Feature: F\n').join('\n'), /no scenarios/);
});

test('duplicate scenario names within a file are reported', () => {
  const out = validate('@R-x-1\nFeature: F\n  Scenario: S\n    Given a\n  Scenario: S\n    Given b\n');
  assert.match(out.join('\n'), /duplicate scenario "S"/);
});

test('crossCheck flags a scenario name used in two files', () => {
  const dir = repo({
    'a.feature': '@R-x-1\nFeature: A\n  Scenario: Same\n    Given a\n',
    'b.feature': '@R-x-2\nFeature: B\n  Scenario: Same\n    Given a\n',
  });
  const out = FORMATS.gherkin.crossCheck([join(dir, 'a.feature'), join(dir, 'b.feature')]);
  assert.equal(out.length, 1);
  assert.match(out[0], /duplicate scenario "Same"/);
});

test('crossCheck ignores unparseable files and distinct names', () => {
  const dir = repo({
    'a.feature': '@R-x-1\nFeature: A\n  Scenario: One\n    Given a\n',
    'b.feature': '@R-x-2\nFeature: B\n  Scenario: Two\n    Given a\n',
    'c.feature': 'junk',
  });
  const paths = ['a.feature', 'b.feature', 'c.feature', 'missing.feature'].map((f) => join(dir, f));
  assert.deepEqual(FORMATS.gherkin.crossCheck(paths), []);
});

test('checkFormats reports a declared gherkin artifact with problems', () => {
  const dir = repo({
    'specs/orders.md': '# Spec\n## Requirements\n- R-orders-1: see specs/orders.feature\n## Formats\n- gherkin: specs/orders.feature\n',
    'specs/orders.feature': 'Feature: F\n  Scenario: S\n    Given a\n',
  });
  assert.match(checkFormats(dir).join('\n'), /gherkin artifact specs\/orders\.feature: scenario "S" has no requirement ID/);
});

test('checkFormats passes a valid declared gherkin artifact', () => {
  const dir = repo({
    'specs/orders.md': '# Spec\n## Requirements\n- R-orders-1: see specs/orders.feature\n## Formats\n- gherkin: specs/orders.feature\n',
    'specs/orders.feature': GOOD,
  });
  assert.deepEqual(checkFormats(dir), []);
});
