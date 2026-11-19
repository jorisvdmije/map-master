import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coordinateValue, coordinateOrigin, coordinateInput, initialOrigin } from '../src/features/reachability/coordinates.ts';
import { searchAddressMatches } from '../src/features/data/address-search.ts';
import { searchAddresses } from '../src/features/area-report/address.ts';

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

const pdok = (docs, status = 200) => {
  const calls = [];
  const request = async (url) => { calls.push(new URL(url)); return new Response(JSON.stringify({ response: { docs } }), { status }); };
  return { calls, request };
};
const row = (overrides = {}) => ({ id: 'adr-1', type: 'adres', gemeentecode: '0344', weergavenaam: 'Domplein 9, 3512JC Utrecht', centroide_ll: 'POINT(5.12128 52.09084)', ...overrides });

test('address search sends only the query and validates every result', async () => {
  const { calls, request } = pdok([row()]);
  const matches = await searchAddressMatches('  Domplein 9 ', new AbortController().signal, { request });
  assert.deepEqual(matches, [{ id: 'adr-1', label: 'Domplein 9, 3512JC Utrecht', coordinates: [5.12128, 52.09084] }]);
  assert.equal(calls[0].origin + calls[0].pathname, 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free');
  assert.equal(calls[0].searchParams.get('q'), 'Domplein 9');
  assert.equal(calls[0].searchParams.get('fq'), 'type:adres', 'Reachability searches every Dutch address');
  for (const query of ['ab', '  a ', 'x'.repeat(201)]) await assert.rejects(searchAddressMatches(query, new AbortController().signal, { request }), /drie en maximaal 200/);
  assert.equal(calls.length, 1, 'Invalid queries never reach the service');
});

test('address search rejects malformed, duplicate and out-of-municipality rows', async () => {
  const signal = new AbortController().signal;
  for (const docs of [[row({ type: 'weg' })], [row({ centroide_ll: 'POINT(abc def)' })], [row({ centroide_ll: 'POINT(500 52)' })], [row(), row()], [row({ weergavenaam: '' })], Array.from({ length: 7 }, (_, i) => row({ id: `adr-${i}` }))])
    await assert.rejects(searchAddressMatches('Domplein 9', signal, pdok(docs)), /ongeldige|Ongeldige|Onverwacht/);
  await assert.rejects(searchAddressMatches('Domplein 9', signal, { ...pdok([], 503), unavailable: 'Kies iets anders.' }), /Kies iets anders/);
  const amsterdam = pdok([row()]);
  await assert.rejects(searchAddresses('Domplein 9', signal, amsterdam.request), /ongeldige locatie/, 'The area report keeps its Amsterdam-only filter');
  assert.equal(amsterdam.calls[0].searchParams.get('fq'), 'type:adres AND gemeentecode:0363');
  const ok = pdok([row({ gemeentecode: '0363', weergavenaam: 'Dam 1, 1012JS Amsterdam', centroide_ll: 'POINT(4.8924 52.3731)' })]);
  assert.deepEqual((await searchAddresses('Dam 1', signal, ok.request))[0], { id: 'adr-1', label: 'Dam 1, 1012JS Amsterdam', coordinates: [4.8924, 52.3731], kind: 'address' });
});
