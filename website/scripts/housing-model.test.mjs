import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { indexById, pointsWithin, pairedCorrelation } from '../src/features/data/joins.ts';
import { loadHomes, trustedBagUrl } from '../src/features/housing/data.ts';
import { sourceMessage } from '../src/features/housing/errors.ts';
import { areasCsv, extent, filtered, format, metricValue, metrics, matchingHomes, numeric, rangeBound, rangeError, sortNeighborhoods } from '../src/features/housing/model.ts';

const area={type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[7,3],[7,7],[3,7],[3,3]]]},properties:{code:'BU0363TEST',homes:100,woz:400000,name:'Testbuurt'}};
const point=(id,x,y,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{identificatie:id,bronhouder_identificatie:'0363',gebruiksdoel:'woonfunctie',status:'Verblijfsobject in gebruik',oppervlakte:62,openbare_ruimte_naam:'Teststraat',huisnummer:1,...extra}});
const id='0363010000000001';
const collection=(features,next)=>({type:'FeatureCollection',features,links:next?[{rel:'next',href:next}]:[]});

test('identification joins preserve leading zeroes and reject ambiguity',()=>{
  assert.equal(indexById([{id:'0001'},{id:'1'}],x=>x.id).size,2);
  assert.throws(()=>indexById([{id:'0001'},{id:'0001'}],x=>x.id),/duplicate/);
});
test('spatial selection respects holes, boundaries and multipart areas',()=>{
  assert.equal(pointsWithin([point(id,1,1),point(id,5,5),point(id,0,1),point(id,12,1)],area).length,2);
  const multi={...area,geometry:{type:'MultiPolygon',coordinates:[area.geometry.coordinates,[[[20,20],[21,20],[21,21],[20,21],[20,20]]]]}};
  assert.equal(pointsWithin([point(id,20.5,20.5),point(id,5,5)],multi).length,1);
});
test('correlation uses complete pairs, rejects tiny or constant samples',()=>{
  const rows=[[1,2],[2,4],[3,6],[4,8],[5,10],[null,9],[9,null]];
  const r=pairedCorrelation(rows,r=>r[0],r=>r[1]); assert.equal(r.n,5); assert.equal(r.r,1);
  assert.equal(pairedCorrelation(rows.slice(0,4),r=>r[0],r=>r[1]).r,null);
  assert.equal(pairedCorrelation(rows,()=>3,r=>r[1]).r,null);
});
test('missing and suppressed CBS values never become zero',()=>{
  for(const input of [null,undefined,-99997,'.',NaN])assert.equal(numeric(input),null);
  assert.equal(numeric(0),0);
  assert.equal(filtered([area,{...area,properties:{...area.properties,homes:null}}],'test',20).length,1);
});
test('BAG pages reconcile duplicates and exclude holes, non-homes and retired units',async()=>{
  const next='https://api.pdok.nl/kadaster/bag/ogc/v2/collections/verblijfsobject/items?cursor=next';
  const one=point(id,1,1);let calls=0;
  const request=async()=>Response.json(++calls===1?collection([one,point('0363010000000002',5,5),point('0363010000000003',2,1,{gebruiksdoel:'kantoorfunctie'})],next):collection([one,point('0363010000000004',2,2,{status:'Verblijfsobject ingetrokken'}),point('0363010000000005',2,2,{status:'Verbouwing verblijfsobject'})]));
  const result=await loadHomes(area,new AbortController().signal,request);
  assert.equal(calls,2);assert.equal(result.audit.fetched,6);assert.equal(result.audit.duplicates,1);assert.equal(result.audit.within,4);assert.equal(result.audit.homes,2);
  assert.equal(result.data.features[0].properties.id,id);
  assert.equal(Object.hasOwn(result.data.features[0].properties,'woz'),false,'Never impute neighborhood WOZ to homes');
});
test('BAG failures cannot produce a partial successful result',async()=>{
  let calls=0;const next='https://api.pdok.nl/kadaster/bag/ogc/v2/collections/verblijfsobject/items?cursor=next';
  await assert.rejects(loadHomes(area,new AbortController().signal,async()=>++calls===1?Response.json(collection([point(id,1,1)],next)):new Response('',{status:503})),/503/);
  await assert.rejects(loadHomes(area,new AbortController().signal,async()=>Response.json(collection([point(id,1,1)],next))),/te groot/);
});
test('provider links cannot redirect to another host or source collection',()=>{
  assert.throws(()=>trustedBagUrl('https://example.com/stolen','pand'),/Onverwachte/);
  assert.throws(()=>trustedBagUrl('https://api.pdok.nl/kadaster/bag/ogc/v2/collections/adres/items/1','pand'),/Onverwachte/);
});
test('snapshot joins all statistics, preserves unknowns and verifies its fingerprint',()=>{
  const {data,meta}=JSON.parse(readFileSync(new URL('../src/features/housing/snapshot.json',import.meta.url)));
  assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'),meta.sha256);
  assert.equal(new Set(data.features.map(f=>f.id)).size,data.features.length);
  assert.equal(meta.unmatchedStatistics.length,0); assert.equal(meta.withoutStatistics.length,2);
  assert.equal(data.features.filter(f=>f.properties.woz!==null).length,430);
  assert.equal(meta.wozValuationDate,'2024-01-01');
  assert.ok(data.features.every(f=>Object.entries(f.properties).every(([key,v])=>typeof v!=='number'||key==='wozChange'||v>=0)));
});


test('combined metric filters preserve missing values, negative change and inclusive bounds',()=>{
  const row=(code,woz,wozChange,school)=>({...area,properties:{...area.properties,code,woz,wozChange,school}});
  const rows=[row('a',400000,-5,.5),row('b',600000,3,.2),row('c',null,-8,null),row('d',200000,null,.5)];
  assert.deepEqual(filtered(rows,'',0,[{metric:'woz',min:'',max:'400000'},{metric:'school',min:'',max:'0,5'}]).map(f=>f.properties.code),['a','d']);
  assert.deepEqual(filtered(rows,'',0,[{metric:'wozChange',min:'-6',max:'0'}]).map(f=>f.properties.code),['a']);
  assert.equal(filtered(rows,'',0,[], 'woz').length,3);
  assert.equal(filtered(rows,'',0,[{metric:'school',min:'1',max:'0'}]).length,0);
  assert.equal(filtered(rows,'',0,[{metric:'school',min:'abc',max:''}]).length,0);
  assert.equal(filtered(rows,'',0,[{metric:'school',min:'',max:''}]).length,4);
  assert.match(rangeError({metric:'woz',min:'500',max:'10'}),/groter/);
  assert.match(rangeError({metric:'woz',min:'NaN',max:''}),/geldig/);
  assert.deepEqual(extent(rows,'wozChange'),[-8,8]);
  assert.equal(metricValue(rows[0],'gas'),null);
  assert.equal(format(-5,'wozChange'),'-5 %');
});

test('sorting puts unknowns last in either direction and CSV keeps data year and nulls',()=>{
  const rows=[{...area,properties:{...area.properties,name:'Hoog',woz:600000}},{...area,properties:{...area.properties,name:'Onbekend',woz:null}},{...area,properties:{...area.properties,name:'Laag',woz:200000}}];
  assert.deepEqual(sortNeighborhoods(rows,'woz').map(f=>f.properties.name),['Hoog','Laag','Onbekend']);
  assert.deepEqual(sortNeighborhoods(rows,'woz',true).map(f=>f.properties.name),['Laag','Hoog','Onbekend']);
  assert.equal(rows[0].properties.name,'Hoog','sort must not mutate snapshot');
  const csv=areasCsv([{...area,properties:{...area.properties,name:'Buurt; "West"',woz:null}}]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv,/CBS 2024/);assert.match(csv,/"Buurt; ""West"""/);assert.ok(!csv.includes('"null"'));
});

test('expanded source coverage, comparable WOZ history and indicator years reconcile',()=>{
  const {data,meta}=JSON.parse(readFileSync(new URL('../src/features/housing/snapshot.json',import.meta.url)));
  assert.equal(metrics.length,25);
  for(const metric of metrics){
    assert.ok(meta.indicators[metric]?.description);assert.match(meta.indicators[metric].source,/cbs.nl/);
    assert.ok(data.features.some(f=>f.properties[metric]!==null),metric);
    for(const f of data.features){const value=f.properties[metric];assert.ok(value===null||Number.isFinite(value),metric);}
  }
  for(const key of ['education','income','lowIncome'])assert.equal(meta.indicators[key].year,2024);
  const declines=data.features.filter(f=>f.properties.wozChange<0);assert.ok(declines.length>50);
  for(const f of data.features){
    const p=f.properties;assert.deepEqual(p.wozHistory.map(x=>x.year),[2023,2024,2025]);
    for(const point of p.wozHistory){assert.equal(point.valuationDate,`${point.year-1}-01-01`);if(!point.comparable)assert.equal(point.value,null);}
    if(p.wozChange!==null){assert.ok(p.wozPrevious>0);assert.ok(Math.abs(p.wozChange-100*(p.woz/p.wozPrevious-1))<1e-10);}
    if(p.boundaryChange!=='1'){assert.equal(p.wozChange,null);assert.equal(p.education,null);assert.equal(p.income,null);}
    for(const metric of metrics.filter(m=>meta.indicators[m].unit==='%'&&m!=='wozChange'))assert.ok(p[metric]===null||(p[metric]>=0&&p[metric]<=100));
  }
  assert.ok(data.features.some(f=>f.properties.wozHistory[0].comparable===false));
});


test('local address search combines street, number, postcode or exact BAG identity and sorts naturally',()=>{
  const home=(id,address)=>({type:'Feature',geometry:{type:'Point',coordinates:[4.9,52.36]},properties:{id,address}});
  const rows=[home('0003','Teststraat 10, 1000AA'),home('0001','Teststraat 2, 1000AA'),home('0002','Andere straat 1, 1000BB')];
  assert.deepEqual(matchingHomes(rows,' TESTSTRAAT 1000aa ').map(f=>f.properties.id),['0001','0003']);
  assert.deepEqual(matchingHomes(rows,'0001').map(f=>f.properties.address),['Teststraat 2, 1000AA']);
  assert.equal(matchingHomes(rows,'Teststraat 1000BB').length,0);
  assert.equal(rows[0].properties.id,'0003');
});

test('BAG progress reports pages without partial homes, cancellation cannot finish successfully',async()=>{
  const abort=new AbortController(),progress=[];
  const next='https://api.pdok.nl/kadaster/bag/ogc/v2/collections/verblijfsobject/items?cursor=next';let calls=0;
  await assert.rejects(loadHomes(area,abort.signal,async()=>{calls++;if(calls===2){abort.abort();abort.signal.throwIfAborted();}return Response.json(collection([point(id,1,1)],next));},p=>progress.push(p)),{name:'AbortError'});
  assert.equal(calls,2);assert.ok(progress.some(p=>p.pages===1&&p.fetched===1));
  let called=false;await assert.rejects(loadHomes(area,abort.signal,async()=>{called=true;}),{name:'AbortError'});assert.equal(called,false);
});

test('source timeouts and failed fetches give actionable Dutch messages; domain detail survives',()=>{
  assert.match(sourceMessage(new DOMException('The operation was aborted due to timeout','TimeoutError')),/niet op tijd/);
  assert.match(sourceMessage(new TypeError('Failed to fetch')),/niet bereikbaar/);
  assert.match(sourceMessage(new DOMException('Aborted','AbortError')),/onderbroken/);
  assert.equal(sourceMessage(new Error('BAG tijdelijk niet bereikbaar (503).')),'BAG tijdelijk niet bereikbaar (503).');
});


test('a house-number token must not match unrelated trailing digits in another BAG identity',()=>{
  const rows=[{properties:{id:'0363010001041099',address:'Julius Pergerstraat 31, 1087KN'}},{properties:{id:'0363010001041133',address:'Julius Pergerstraat 99, 1087KN'}}];
  assert.deepEqual(matchingHomes(rows,'Julius Pergerstraat 99').map(f=>f.properties.id),['0363010001041133']);
  assert.deepEqual(matchingHomes(rows,'0363010001041099').map(f=>f.properties.address),['Julius Pergerstraat 31, 1087KN']);
});

test('Dutch grouped amounts and decimal filters never silently change magnitude',()=>{
  for(const [input,expected] of [['500000',500000],['500.000',500000],['500.000,00',500000],['1.234.567,89',1234567.89],['0,5',.5],['0.5',.5],['-5,25',-5.25],['12.5',12.5]])assert.equal(rangeBound(input),expected,input);
  for(const input of ['50.00.0','500 000','1,234.56','1e6','0x10','Infinity'])assert.notEqual(rangeError({metric:'woz',min:input,max:''}),null,input);
});
