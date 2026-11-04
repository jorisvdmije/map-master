import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { createStaticServer } from './lib/static-server.mjs';
import { checkFeaturePreviews } from './feature-preview-check.mjs';
import { checkHoverSettings } from './hover-settings-check.mjs';
const site = resolve(import.meta.dirname, '..');
const { basePath } = JSON.parse(readFileSync(resolve(site,'dist/.build-info.json')));
const server = createStaticServer({directory:resolve(site,'dist'),basePath});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browsers={chromium,firefox,webkit};
const polygon={type:'Feature',id:'park',properties:{name:'Test park',status:'Open',details:{text:'<img src=x onerror=alert(1)>'}},geometry:{type:'Polygon',coordinates:[[[4.88,52.36],[4.91,52.36],[4.91,52.38],[4.88,52.38],[4.88,52.36]]]}};
try {
  for(const name of process.argv.slice(2).length?process.argv.slice(2):Object.keys(browsers)) {
    const browser=await browsers[name].launch({headless:true,...(name==='chromium'?{args:['--enable-unsafe-swiftshader']}: {})});
    try {
      const context=await browser.newContext({viewport:{width:1440,height:1000}});
      await context.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[]}}));
      const page=await context.newPage(), errors=[];
      page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',dialog=>dialog.accept());
      const overlay=page.locator('.mm-property-overlay'),card=page.locator('.mm-feature-preview');
      const center=async selector=>{const m=await page.locator(selector).boundingBox(),r=await overlay.boundingBox();assert.ok(Math.abs(r.x+r.width/2-m.x-m.width/2)<2,'Card is horizontally centered');assert.ok(Math.abs(r.y+r.height/2-m.y-m.height/2)<2,'Card is vertically centered');};
      const upload={name:'park.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(polygon))};
      await page.goto(`${origin}${basePath}/playground/`);await page.locator('[data-playground][data-ready="true"]').waitFor();
      await page.getByLabel('Import GeoJSON files',{exact:true}).setInputFiles(upload);await page.locator('.pg-workbench[data-feature-count="1"]').waitFor();
      const display=page.getByLabel('Property display',{exact:true}), map=await page.locator('.pg-map canvas').boundingBox();
      const point={x:map.x+map.width/2-40,y:map.y+map.height/2};
      await page.mouse.move(point.x,point.y);await card.waitFor();const first=await overlay.boundingBox();
      await page.mouse.move(point.x+20,point.y);await page.waitForFunction(x=>Math.abs(document.querySelector('.mm-property-overlay').getBoundingClientRect().x-x)>10,first.x);
      assert.equal(await card.locator('h3').textContent(),'Test park','Still the SAME polygon while following');
      assert.equal(await overlay.evaluate(el=>getComputedStyle(el).pointerEvents),'none');
      await display.selectOption('fixed');await page.mouse.move(point.x,point.y);await card.waitFor();await center('.pg-map canvas');const fixed=await overlay.boundingBox();
      await page.mouse.move(point.x+20,point.y+20);await page.evaluate(()=>new Promise(requestAnimationFrame));assert.deepEqual(await overlay.boundingBox(),fixed,'Fixed center does not track the cursor');
      assert.equal(await display.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}),true,'Display selector is not covered by basemap controls');
      await display.selectOption('click');await page.mouse.move(point.x,point.y);await page.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await card.count(),0,'Click-only mode has no hover card');
      await page.mouse.click(point.x,point.y);await page.locator('.mm-property-overlay[data-pinned="true"]').waitFor();await center('.pg-map canvas');
      await page.mouse.move(20,20);assert.equal(await card.isVisible(),true,'Pinned card survives pointer exit');
      assert.equal(await overlay.evaluate(el=>getComputedStyle(el).pointerEvents),'auto');assert.equal(await card.locator('img,script').count(),0);
      await page.getByRole('button',{name:'Sluit eigenschappen',exact:true}).click();await card.waitFor({state:'detached'});
      await page.mouse.click(point.x,point.y);await card.waitFor();await page.keyboard.press('Escape');await card.waitFor({state:'detached'});
      await page.mouse.click(point.x,point.y);await card.waitFor();
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>{const c=document.querySelector('.pg-map canvas'),f=document.querySelector('.pg-map-frame');return c.clientWidth===f.clientWidth&&c.clientHeight===f.clientHeight;});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const mobile=await page.locator('.pg-map canvas').boundingBox();await center('.pg-map canvas');
      const bounds=await overlay.boundingBox();assert.ok(bounds.height<=mobile.height-16&&bounds.width<=mobile.width-16,'Mobile card remains within the map');
      const evidence=resolve(site,`../artifacts/properties/${name}`);mkdirSync(evidence,{recursive:true});await page.screenshot({path:resolve(evidence,'center-mobile.png')});
      await display.selectOption('off');assert.equal(await card.count(),0);
      // The free explorer uses the same interaction for imported source data.
      await page.setViewportSize({width:1440,height:1000});await page.goto(`${origin}${basePath}/analysis/`);await page.locator('[data-analysis][data-ready="true"]').waitFor();
      const guide=page.getByRole('dialog');if(await guide.count())await page.keyboard.press('Escape');
      await page.getByLabel('Import analysis data',{exact:true}).setInputFiles(upload);await page.locator('.an-workbench[data-matches="1"]').waitFor();
      await page.locator('.an-map-host[data-feature-count="1"][aria-busy="false"]').waitFor();
      await page.getByLabel('Property display',{exact:true}).selectOption('click');
      const free=await page.locator('.an-map-host canvas').boundingBox();await page.mouse.click(free.x+free.width/2-25,free.y+free.height/2);
      await card.waitFor();assert.equal(await card.locator('h3').textContent(),'Test park');await center('.an-map-host canvas');
      await page.keyboard.press('Escape');await card.waitFor({state:'detached'});assert.deepEqual(errors,[]);
      await context.close();
      // A real touch tap needs no synthetic mouse hover first.
      const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
      await touch.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[]}}));
      const t=await touch.newPage();t.on('dialog',dialog=>dialog.accept());await t.goto(`${origin}${basePath}/playground/`);await t.locator('[data-playground][data-ready="true"]').waitFor();
      await t.getByLabel('Import GeoJSON files',{exact:true}).setInputFiles(upload);await t.locator('.pg-workbench[data-feature-count="1"]').waitFor();
      await t.getByLabel('Property display',{exact:true}).selectOption('click');await t.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const target=await t.locator('.pg-map canvas').boundingBox();await t.touchscreen.tap(target.x+target.width/2-30,target.y+target.height/2);
      await t.locator('.mm-property-overlay[data-pinned="true"]').waitFor();assert.equal(await t.locator('.mm-feature-preview h3').textContent(),'Test park');await t.getByRole('button',{name:'Sluit eigenschappen',exact:true}).tap();await t.locator('.mm-feature-preview').waitFor({state:'detached'});await touch.close();
      await checkFeaturePreviews({browser,origin,basePath});await checkHoverSettings({browser,origin,basePath});
      console.log(`✓ ${name}: same-object cursor following, exact center, click-only, pin/close/Escape, resize, touch, safe properties, free analysis and existing preview settings`);
    }finally{await browser.close();}
  }
}finally{await new Promise(resolve=>server.close(resolve));}
