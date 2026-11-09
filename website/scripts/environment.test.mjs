import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeEnergy,homeNoise,nearbyTrees,selectEnergyLabel} from '../src/features/housing/environment.ts';
const home={type:'Feature',geometry:{type:'Point',coordinates:[4.9,52.37]},properties:{id:'0363010000000001'}};
test('energy labels preserve expiry, absence and conflicting registrations',()=>{
 const rows=[{registratiedatum:'2020-01-01',metingGeldigTot:'2030-01-01',energieklasse:'D'},{registratiedatum:'2025-01-01',metingGeldigTot:'2026-01-01',energieklasse:'B'}];
 assert.equal(selectEnergyLabel(rows,'2026-11-04').status,'expired');
 assert.equal(selectEnergyLabel(rows,'2026-11-04').label,'B','Never hide an expired latest record behind an older valid one');
 assert.equal(selectEnergyLabel([],'2026-11-04').status,'missing');
 assert.equal(selectEnergyLabel([{registratiedatum:'2025-01-01',energieklasse:'A'}],'2026-11-04').status,'unknown');
 assert.throws(()=>selectEnergyLabel([...rows,{...rows[1],energieklasse:'F'}],'2026-11-04'),/Tegenstrijdige/);
});
test('exact BAG joining rejects an unrelated energy label',async()=>{
 await assert.rejects(homeEnergy(home,new AbortController().signal,async()=>Response.json({_embedded:{energielabel:[{bagVerblijfsobjectId:'wrong'}]},_links:{}})),/niet exact/);
});
test('nearby trees use geodesic distance rather than accepting the bounding box as a circle',async()=>{
 const result=await nearbyTrees(home,100,new AbortController().signal,async()=>Response.json({_embedded:{stamgegevens:[{id:1,geometrie:{type:'Point',coordinates:[4.9,52.37]}},{id:2,geometrie:{type:'Point',coordinates:[4.91,52.38]}}]},_links:{},page:{totalElements:2}}));
 assert.equal(result.examined,2);assert.equal(result.data.features.length,1);
});
test('noise distinguishes no model value from a zero or a failed request',async()=>{
 const request=raw=>async()=>Response.json({type:'FeatureCollection',features:[{properties:{GRAY_INDEX:raw}}]});
 assert.equal((await homeNoise(home,new AbortController().signal,request(-9999))).decibels,null);
 assert.equal((await homeNoise(home,new AbortController().signal,request(0))).decibels,0);
 await assert.rejects(homeNoise(home,new AbortController().signal,async()=>new Response('',{status:503})),/503/);
});
