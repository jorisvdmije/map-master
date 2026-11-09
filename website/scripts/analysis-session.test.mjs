import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AnalysisRecovery,parseAnalysis,analysisStorageKey} from '../src/features/analysis/session.ts';
import {demoDataset,demoArea,defaultFields,emptyFilters} from '../src/features/analysis/model.ts';
const dataset=demoDataset();
const document={format:'map-master-analysis',version:1,name:dataset.name,dataset:dataset.data,areas:{type:'FeatureCollection',features:[demoArea]},fields:defaultFields(dataset),filters:{...emptyFilters,query:'Waste',range:[0,500],rangeExclusive:true},activeArea:0};
test('saved analyses validate the full dataset and areas before restoration',()=>{
 const restored=parseAnalysis(document);assert.equal(restored.dataset.data.features.length,144);assert.deepEqual(restored.filters,document.filters);assert.equal(restored.activeArea,0);
 assert.throws(()=>parseAnalysis({...document,areas:{type:'FeatureCollection',features:[{...demoArea,geometry:{type:'Polygon',coordinates:[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}}]}}),/topology/);
 const fallback=parseAnalysis({...document,fields:{category:'nonexistent',metric:'nonexistent',size:'bad'},filters:{range:[5,0]},activeArea:9});assert.deepEqual(fallback.fields,defaultFields(dataset));assert.equal(fallback.filters.range,null);assert.equal(fallback.activeArea,null);
});
test('corrupt recovery stays downloadable; quota errors preserve the previous disk copy and latest memory',()=>{
 const disk=new Map([[analysisStorageKey,'{damaged']]);let fail=false;
 const storage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>{if(fail)throw new DOMException('Full','QuotaExceededError');disk.set(key,value);},removeItem:key=>disk.delete(key)};
 const corrupt=new AnalysisRecovery(storage);assert.equal(corrupt.blocked,true);assert.equal(corrupt.raw,'{damaged');assert.equal(corrupt.write(document),false);assert.equal(disk.get(analysisStorageKey),'{damaged');
 corrupt.discardCorruptCopy();assert.equal(corrupt.write(document),true);const saved=disk.get(analysisStorageKey);
 fail=true;const next={...document,name:'Unsaved latest work'};assert.equal(corrupt.write(next),false);assert.equal(disk.get(analysisStorageKey),saved);
 fail=false; const newer=JSON.stringify({...document,name:'Other tab newer analysis'});disk.set(analysisStorageKey,newer);assert.equal(corrupt.write(next),false);assert.equal(disk.get(analysisStorageKey),newer,'A stale tab cannot overwrite the detected newer copy');
 const navigation=new AnalysisRecovery(storage);assert.equal(navigation.initial.dataset.name,'Unsaved latest work','client navigation recovers memory even when disk save failed');
});
