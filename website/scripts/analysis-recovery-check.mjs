import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const key='map-master-analysis-recovery-v1';
const home=(id,x,value)=>({type:'Feature',id,properties:{name:id,category:'A',value},geometry:{type:'Point',coordinates:[x,52.37]}});
const dataset={type:'FeatureCollection',features:[home('kept-one',4.9,10),home('kept-two',4.91,20)]};
const area={type:'Feature',properties:{name:'My study area'},geometry:{type:'Polygon',coordinates:[[[4.89,52.36],[4.92,52.36],[4.92,52.38],[4.89,52.38],[4.89,52.36]]]}};
export async function checkAnalysisRecovery({browser,origin,basePath='/map-master'}) {
 const url=`${origin}${basePath}/analysis/`;
 const create=async()=>{const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});await context.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:{version:8,sources:{},layers:[]}}));return context;};
 const ready=page=>page.locator('[data-analysis][data-ready=true]').waitFor();
 const saved=page=>page.locator('[data-analysis-save=saved]').waitFor();
 const importData=(page,value)=>page.getByLabel('Import analysis data',{exact:true}).setInputFiles({name:'my-data.geojson',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
 const dismissIntro=async page=>{const button=page.getByRole('button',{name:'Explore on my own',exact:true});if(await button.count())await button.click();};
 const download=async(page,button)=>{const [file]=await Promise.all([page.waitForEvent('download'),button.click()]);return readFileSync(await file.path(),'utf8');};
 const context=await create();
 try {
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await ready(page);await dismissIntro(page);
  await importData(page,dataset);await page.locator('[data-matches="2"]').waitFor();
  await page.getByLabel('Import analysis areas',{exact:true}).setInputFiles({name:'study.geojson',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(area))});
  await page.getByLabel('Search data',{exact:true}).fill('kept-one');await page.locator('[data-matches="1"]').waitFor();await saved(page);
  const prepared=JSON.parse(await download(page,page.getByRole('button',{name:'Save analysis',exact:true})));
  prepared.areas.features[0].properties={name:'My study area',reviewNote:'Preserve nested properties',nested:{verified:true}};
  await page.getByLabel('Import analysis data',{exact:true}).setInputFiles({name:'resume.analysis.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(prepared))});
  await saved(page);
  const before=JSON.parse(await download(page,page.getByRole('button',{name:'Save analysis',exact:true})));
  assert.deepEqual(before.areas.features[0].properties,prepared.areas.features[0].properties);
  assert.equal(before.areas.features.length,1);assert.equal(before.activeArea,0);assert.equal(before.filters.query,'kept-one');
  const disk=await page.evaluate(key=>localStorage.getItem(key),key);
  const invalid={...area,geometry:{type:'Polygon',coordinates:[[[4.9,52.36],[4.91,52.37],[4.9,52.37],[4.91,52.36],[4.9,52.36]]]}};
  await importData(page,{type:'FeatureCollection',features:[dataset.features[0],invalid]});
  await page.getByRole('alert').filter({hasText:/Feature 2.*topology/}).waitFor();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),disk,'Invalid import cannot overwrite recovery');
  await page.getByRole('link',{name:'Documentation',exact:true}).click();await page.waitForURL(`${origin}${basePath}/`);await page.goBack();await ready(page);await saved(page);
  assert.equal(await page.getByLabel('Search data',{exact:true}).inputValue(),'kept-one');
  assert.deepEqual(JSON.parse(await download(page,page.getByRole('button',{name:'Save analysis',exact:true}))),before,'Internal navigation restores dataset, edited areas, fields, filters and selection');
  await page.reload();await ready(page);await saved(page);
  assert.deepEqual(JSON.parse(await download(page,page.getByRole('button',{name:'Save analysis',exact:true}))),before,'Reload restores the same analysis');
  const reopened = await context.newPage();
  await reopened.goto(url); await ready(reopened); await saved(reopened);
  assert.deepEqual(JSON.parse(await download(reopened,reopened.getByRole('button',{name:'Save analysis',exact:true}))),before,'A new tab can recover the browser-saved analysis');
  await reopened.close();
  await page.getByLabel('Search data',{exact:true}).fill('kept-two');await saved(page);
  await page.getByLabel('Search data',{exact:true}).fill('kept-one');await saved(page);
  const lastDisk = await page.evaluate(key=>localStorage.getItem(key),key);
  // Fail only recovery writes, after preserving a known-good on-disk copy.
  await page.evaluate(key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Full','QuotaExceededError');return original.call(this,k,v);};},key);
  await page.getByLabel('Search data',{exact:true}).fill('kept-two');await page.locator('[data-analysis-save=unsaved]').waitFor();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),lastDisk,'Failed storage must not replace the previous disk copy');
  const dialog=page.waitForEvent('dialog');const clicking=page.getByRole('link',{name:'Documentation',exact:true}).click();const warning=await dialog;assert.equal(warning.type(),'confirm');await warning.dismiss();await clicking;
  assert.equal(page.url(),url,'Dismissing the warning stays on the analysis');
  const unloadEvent=page.waitForEvent('dialog');const reloading=page.reload({timeout:5000}).catch(()=>{}),unload=await unloadEvent;assert.equal(unload.type(),'beforeunload');await unload.dismiss();await reloading;
  assert.equal(await page.getByLabel('Search data',{exact:true}).inputValue(),'kept-two');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
 } finally {await context.close();}
 const corrupt=await create();
 try {
  await corrupt.addInitScript(key=>{if(!localStorage.getItem(key))localStorage.setItem(key,'{damaged');},key);
  const page=await corrupt.newPage();await page.goto(url);await ready(page);
  await page.getByRole('alert').filter({hasText:'The previous analysis could not be restored.'}).waitFor();
  assert.equal(await download(page,page.getByRole('button',{name:'Download recovery copy',exact:true})),'{damaged');
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{damaged');
  await page.getByRole('button',{name:'Discard recovery copy',exact:true}).click();await saved(page);
 } finally {await corrupt.close();}
 const denied=await create();
 try {
  await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}}));
  const page=await denied.newPage();await page.goto(url);await ready(page);await dismissIntro(page);
  await importData(page,dataset);await page.locator('[data-matches="2"]').waitFor();await page.locator('[data-analysis-save=unsaved]').waitFor();
  const copy=JSON.parse(await download(page,page.getByRole('button',{name:'Save analysis',exact:true})));assert.deepEqual(copy.dataset,dataset,'Download remains available without storage');
  const warningEvent=page.waitForEvent('dialog');const leaving=page.getByRole('link',{name:'Documentation',exact:true}).click();const warning=await warningEvent;assert.equal(warning.type(),'confirm');await warning.accept();await leaving;
  await page.waitForURL(`${origin}${basePath}/`);await page.goBack();await ready(page);await page.locator('[data-matches="2"]').waitFor();
 } finally {await denied.close();}
 console.log('✓ Analysis recovery: navigation/reload preserve data, areas and filters; invalid imports rollback; quota warnings and corrupt-copy download/discard');
}
