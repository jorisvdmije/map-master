import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchPages } from '../src/features/search/queries.ts';

test('search includes descriptions and requires every query term', () => {
  const page = { title: 'Wonen', href: '/analysis/housing/', description: 'Belastingen en opleiding', text: 'Amsterdam' };
  assert.deepEqual(searchPages([page], 'belasting'), [page]);
  assert.deepEqual(searchPages([page], 'AMSTERDAM opleiding'), [page]);
  assert.deepEqual(searchPages([page], 'opleiding onvindbaar'), []);
});
