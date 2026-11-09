import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeLeasehold, homeBnbContext } from '../src/features/housing/address-context.ts';

const home = {type:'Feature', geometry:{type:'Point', coordinates:[4.9,52.36]}, properties:{id:'0363010000000001'}};
const polygon = {type:'Polygon', coordinates:[[[4.89,52.35],[4.91,52.35],[4.91,52.37],[4.89,52.37],[4.89,52.35]]]};
const parcel = {id:1,kadastraalobjectId:'NL.IMKAD.KadastraalObject.1.2',erfpachtUitgegevenDoor:'Gemeente Amsterdam',geometrieVlak:polygon};
const ward = {id:1,wijkNaam:'Voorbeeldwijk',categorieKleur:'green',geometrie:polygon};
const page = (table, rows, total=rows.length, next) => Response.json({_embedded:{[table]:rows},page:{totalElements:total},_links:next?{next:{href:next}}:{}});
const signal = () => new AbortController().signal;

test('leasehold is spatial parcel context with explicit source and retrieval time', async () => {
  const result = await homeLeasehold(home,signal(),async (url, options) => {
    assert.equal(new URL(url).searchParams.get('geometrieVlak[intersects]'),'POINT(4.9 52.36)');
    assert.equal(options.headers['Content-Crs'],'EPSG:4326');
    assert.equal(options.headers['Accept-Crs'],'EPSG:4326');
    return page('brkkaartlaagerfpachtuitgevers',[parcel]);
  });
  assert.equal(result.status,'matched');assert.equal(result.parcels[0].issuer,'Gemeente Amsterdam');
  assert.ok(Date.parse(result.retrievedAt));assert.match(result.source,/benkagg/);
  assert.equal(Object.hasOwn(result,'canon'),false);
});
test('no intersecting erfpacht record remains missing, never freehold', async () => {
  const result=await homeLeasehold(home,signal(),async()=>page('brkkaartlaagerfpachtuitgevers',[]));
  assert.equal(result.status,'missing');assert.deepEqual(result.parcels,[]);
});
test('B&B matches a ward category, not an individual address permit', async () => {
  const result=await homeBnbContext(home,signal(),async()=>page('bedandbreakfast',[ward]));
  assert.equal(result.status,'matched');assert.equal(result.wards[0].label,'Beschikbaar');
  assert.equal(Object.hasOwn(result,'permit'),false);
  const boundary=await homeBnbContext(home,signal(),async()=>page('bedandbreakfast',[ward,{...ward,id:2,wijkNaam:'Aangrenzend',categorieKleur:'red'}]));
  assert.equal(boundary.status,'boundary');assert.equal(boundary.wards.length,2);
});
test('spatial responses cannot silently ignore the filter or use RD coordinates', async () => {
  const elsewhere={...polygon,coordinates:polygon.coordinates.map(r=>r.map(([x,y])=>[x+1,y]))};
  await assert.rejects(homeBnbContext(home,signal(),async()=>page('bedandbreakfast',[{...ward,geometrie:elsewhere}])),/buiten/);
  const rd={...polygon,coordinates:[[[120000,480000],[120001,480000],[120001,480001],[120000,480000]]]};
  await assert.rejects(homeLeasehold(home,signal(),async()=>page('brkkaartlaagerfpachtuitgevers',[{...parcel,geometrieVlak:rd}])),/ongeldige gebiedsgeometrie/);
});
test('unknown categories, duplicate rows, incomplete pages and HTTP errors fail explicitly', async () => {
  await assert.rejects(homeBnbContext(home,signal(),async()=>page('bedandbreakfast',[{...ward,categorieKleur:'purple'}])),/onbekende/);
  await assert.rejects(homeBnbContext(home,signal(),async()=>page('bedandbreakfast',[ward,ward])),/dubbele/);
  await assert.rejects(homeLeasehold(home,signal(),async()=>page('brkkaartlaagerfpachtuitgevers',[parcel],2)),/onvolledig/);
  await assert.rejects(homeLeasehold(home,signal(),async()=>new Response('',{status:503})),/503/);
});
test('pagination cannot leave its trusted source collection', async () => {
  let calls=0;
  await assert.rejects(homeBnbContext(home,signal(),async()=>{calls++;return page('bedandbreakfast',[ward],2,'https://example.com/leak');}),/Onverwachte/);
  assert.equal(calls,1);
});
test('cancellation before a request performs no work', async () => {
  const abort=new AbortController();abort.abort();let calls=0;
  await assert.rejects(homeLeasehold(home,abort.signal,async()=>{calls++;return page('brkkaartlaagerfpachtuitgevers',[]);}),{name:'AbortError'});
  assert.equal(calls,0);
});

test('actual Amsterdam issuer spelling remains a match and raw source spelling survives export', async () => {
  const result=await homeLeasehold(home,signal(),async()=>page('brkkaartlaagerfpachtuitgevers',[{...parcel,erfpachtUitgegevenDoor:'Amsterdam'}]));
  assert.equal(result.status,'matched');assert.equal(result.parcels[0].issuer,'Gemeente Amsterdam');assert.equal(result.parcels[0].rawIssuer,'Amsterdam');
  await assert.rejects(homeLeasehold(home,signal(),async()=>page('brkkaartlaagerfpachtuitgevers',[{...parcel,erfpachtUitgegevenDoor:'Onbekende uitgever'}])),/onbekende/);
});
