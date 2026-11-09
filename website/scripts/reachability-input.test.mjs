import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coordinateValue, coordinateOrigin, coordinateInput, initialOrigin } from '../src/features/reachability/coordinates.ts';

test('coordinate drafts accept decimal degrees while incomplete and out-of-range text stays invalid', () => {
  for (const text of ['', ' ', '-', '+', '.', ',', 'NaN', 'Infinity', '1e2', '0x10', '4,9.2', '180.000001', '-180.1']) assert.equal(coordinateValue(text, 180), null, text);
  for (const [text, value] of [['4.904', 4.904], ['4,904', 4.904], [' -73,9857 ', -73.9857], ['-.5', -.5], ['+0', 0], ['180', 180], ['-180', -180]]) assert.equal(coordinateValue(text, 180), value, text);
  assert.deepEqual(coordinateOrigin({ lng: '0', lat: '-85' }), [0, -85]);
  assert.equal(coordinateOrigin({ lng: '4.9', lat: '85.000001' }), null);
  assert.equal(coordinateOrigin({ lng: '', lat: '52.3' }), null);
  assert.deepEqual(coordinateOrigin(coordinateInput([-73.9857, 40.7484])), [-73.9857, 40.7484]);
});
test('missing, empty, malformed or incomplete URL coordinates use the default, never an accidental zero', () => {
  for (const query of ['', 'lng=&lat=', 'lng=%20&lat=52', 'lng=4.9', 'lat=52.3', 'lng=181&lat=52', 'lng=4&lat=86', 'lng=NaN&lat=52', 'lng=0x10&lat=52']) assert.deepEqual(initialOrigin(new URLSearchParams(query)), [4.904, 52.367], query);
  assert.deepEqual(initialOrigin(new URLSearchParams('lng=0&lat=0')), [0, 0]);
  assert.deepEqual(initialOrigin(new URLSearchParams('lng=-73.9857&lat=40.7484')), [-73.9857, 40.7484]);
  assert.deepEqual(initialOrigin(new URLSearchParams('lng=4%2C904&lat=52%2C367')), [4.904, 52.367]);
});
test('small valid coordinates remain editable decimal text after URL initialization or map picking', () => {
  for (const point of [[1e-7, -1e-12], [Number.MIN_VALUE, -Number.MIN_VALUE], [179.99999999999997, -84.99999999999999]]) {
    const input = coordinateInput(point);
    assert.ok(!input.lng.includes('e') && !input.lat.includes('e'));
    assert.deepEqual(coordinateOrigin(input), point);
  }
  assert.deepEqual(coordinateOrigin(coordinateInput(initialOrigin(new URLSearchParams('lng=0.0000001&lat=-0.000000000001')))), [1e-7, -1e-12]);
});
