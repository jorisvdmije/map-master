import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readView, text, flag, oneOf, bounded } from '../src/components/workspaces/view-state.tsx';
import { trustedUrl, visitPage, completeCount } from '../src/features/data/source-contract.ts';
const defaults = { query: '', metric: 'woz', minimum: 100, knownOnly: false };
const rules = { query: text, metric: oneOf(['woz', 'owner']), minimum: bounded(0, 1000), knownOnly: flag };
const search = data => `?view=${encodeURIComponent(JSON.stringify({ version: 1, app: 'housing', data }))}`;
test('versioned research settings round-trip and reject invalid fields independently', () => {
  const data = { query: 'Centrum', metric: 'owner', minimum: 0, knownOnly: true };
  assert.deepEqual(readView(search(data), 'housing', defaults, rules), data);
  assert.deepEqual(readView(search({ ...data, metric: 'broken', minimum: -1 }), 'housing', defaults, rules), { ...data, metric: 'woz', minimum: 100 });
  for (const input of ['?view={', '?view=null', '?view=[]', search(data).replace('housing', 'streets'), '?view=' + 'a'.repeat(9000)]) assert.deepEqual(readView(input, 'housing', defaults, rules), defaults);
});
test('source guards reject foreign URLs, credentials, fragments, loops and incomplete pages', () => {
  assert.equal(trustedUrl('https://api.pdok.nl/data/items/1', 'https://api.pdok.nl', '/data/items', true), 'https://api.pdok.nl/data/items/1');
  for (const url of ['https://evil.example/data/items', 'https://user@api.pdok.nl/data/items', 'https://api.pdok.nl/data/items-other', 'https://api.pdok.nl/data/items#foreign']) assert.throws(() => trustedUrl(url, 'https://api.pdok.nl', '/data/items', true));
  const seen = new Set(); visitPage(seen, 'one', 2); assert.throws(() => visitPage(seen, 'one', 2)); visitPage(seen, 'two', 2); assert.throws(() => visitPage(seen, 'three', 2));
  assert.throws(() => completeCount(3, 2)); assert.throws(() => completeCount('2', 2)); completeCount(undefined, 2); completeCount(2, 2);
});
