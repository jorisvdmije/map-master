import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium,firefox,webkit} from 'playwright';
import {createStaticServer} from './lib/static-server.mjs';
const site=resolve(import.meta.dirname,'..'),{basePath}=JSON.parse(readFileSync(resolve(site,'dist/.build-info.json')));
const server=createStaticServer({directory:resolve(site,'dist'),basePath});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
try{
 for(const name of process.argv.slice(2).length?process.argv.slice(2):['chromium','firefox','webkit']){
  const browser=await {chromium,firefox,webkit}[name].launch({headless:(process.env.GEO_DOCS_HEADED??process.env.GEO_COMPAT_HEADED)!=='1',...(name==='chromium'?{args:['--enable-unsafe-swiftshader']}: {})});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
   await context.route('https://tiles.openfreemap.org/**',r=>r.fulfill({json:{version:8,sources:{},layers:[]}}));
   let calls=0,lastRequest,fail=false,delay=0,nonCumulative=false;
   await context.route('https://valhalla1.openstreetmap.de/isochrone*',async r=>{
    calls++;const p=JSON.parse(new URL(r.request().url()).searchParams.get('json'));lastRequest=p;
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(fail)return r.fulfill({status:429,body:'Rate limited'});
    const {lon,lat}=p.locations[0];const features=p.contours.map(({time})=>{const d=time*.001,offset=nonCumulative&&time===10?.1:0;return {type:'Feature',properties:{metric:'time',contour:time},geometry:{type:'Polygon',coordinates:[[[lon-d+offset,lat-d],[lon+d+offset,lat-d],[lon+d+offset,lat+d],[lon-d+offset,lat+d],[lon-d+offset,lat-d]]]}};});
    await r.fulfill({json:{type:'FeatureCollection',features}}).catch(()=>{});
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const query of ['lng=&lat=%20','lng=181&lat=86']) {
    await page.goto(`${origin}${basePath}/analysis/reachability/?${query}`);await page.locator('[data-reachability][data-ready=true]').waitFor();
    assert.equal(await page.getByLabel('Lengtegraad vertrekpunt').inputValue(),'4.904','Invalid URL coordinates use the default longitude');
    assert.equal(await page.getByLabel('Breedtegraad vertrekpunt').inputValue(),'52.367','Invalid URL coordinates use the default latitude');
   }
   for(const [query,lng,lat] of [['lng=0&lat=0','0','0'],['lng=0.0000001&lat=-0.000000000001','0.0000001','-0.000000000001']]) {
    await page.goto(`${origin}${basePath}/analysis/reachability/?${query}`);await page.locator('[data-reachability][data-ready=true]').waitFor();
    assert.equal(await page.getByLabel('Lengtegraad vertrekpunt').inputValue(),lng,'Valid URL longitude stays editable decimal text');
    assert.equal(await page.getByLabel('Breedtegraad vertrekpunt').inputValue(),lat,'Valid URL latitude stays editable decimal text');
    assert.equal(await page.getByRole('button',{name:'Bereken bereikbaarheid',exact:true}).isEnabled(),true);
   }
   await page.goto(`${origin}${basePath}/analysis/reachability/?lng=4.904&lat=52.367`);await page.locator('[data-reachability][data-ready=true]').waitFor();await page.locator('.ra-map[data-idle=true]').waitFor();
   assert.equal(calls,0,'No routing requests before an explicit calculation');
   assert.equal(await page.getByLabel('Lengtegraad vertrekpunt').inputValue(),'4.904');
   const camera=await page.locator('.ra-map').getAttribute('data-camera');
   const lng=page.getByLabel('Lengtegraad vertrekpunt'),lat=page.getByLabel('Breedtegraad vertrekpunt'),calculate=page.getByRole('button',{name:'Bereken bereikbaarheid',exact:true});
   const expectOrigin=point=>page.waitForFunction(expected=>document.querySelector('.ra-map').dataset.origin===JSON.stringify(expected),point);
   await expectOrigin([4.904,52.367]);
   for(const value of ['', '-', '181', '4,9.2']) {
    await lng.fill(value);assert.equal(await lng.inputValue(),value,'Partial text stays editable');assert.equal(await lng.getAttribute('aria-invalid'),'true');
    assert.equal(await calculate.isDisabled(),true);await expectOrigin([4.904,52.367]);assert.equal(calls,0);
   }
   await lat.fill('-86');await lng.fill('-73,9857');
   assert.equal(await lat.getAttribute('aria-invalid'),'true');await expectOrigin([4.904,52.367]);assert.equal(await calculate.isDisabled(),true);
   await lat.fill('40,7484');await expectOrigin([-73.9857,40.7484]);assert.equal(await calculate.isEnabled(),true);assert.equal(calls,0);
   assert.equal(await page.locator('.ra-map').getAttribute('data-camera'),camera,'Editing valid coordinates changes the point, not the camera');
   await lng.fill('');await page.getByRole('button',{name:'Kies vertrekpunt op kaart',exact:true}).click();
   await page.locator('.ra-map canvas').click({position:{x:220,y:220}});
   assert.notEqual(await lng.getAttribute('aria-invalid'),'true');assert.notEqual(await lat.getAttribute('aria-invalid'),'true');assert.equal(await calculate.isEnabled(),true,'Map picking repairs an incomplete coordinate draft');
   await lng.fill('4.904');await lat.fill('52.367');await expectOrigin([4.904,52.367]);assert.equal(calls,0);
   await page.getByRole('button',{name:'Bereken bereikbaarheid',exact:true}).click();await page.locator('.ra-map[data-contours="3"]').waitFor();
   assert.equal(lastRequest.costing,'bicycle');assert.equal(lastRequest.polygons,true);assert.equal(await page.locator('.ra-result tbody tr').count(),3);
   assert.equal(await page.locator('.ra-map').getAttribute('data-camera'),camera,'Calculating never moves the camera');
   const invalidPolygon={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[4.9,52.36],[4.91,52.37],[4.9,52.37],[4.91,52.36],[4.9,52.36]]]}};
   await page.getByLabel('Onderzoeksdata bereikbaarheid').setInputFiles({name:'invalid.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(invalidPolygon))});
   await page.getByRole('alert').filter({hasText:/Feature 1.*topology/}).waitFor();
   assert.equal(await page.locator('.ra-map').getAttribute('data-contours'),'3','Bad research geometry leaves existing contours intact');
   await page.getByLabel('Onderzoeksdata bereikbaarheid').setInputFiles({name:'points.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'near'},geometry:{type:'Point',coordinates:[4.904,52.367]}},{type:'Feature',properties:{name:'far'},geometry:{type:'Point',coordinates:[5.5,52.9]}}]}))});
   await page.waitForFunction(()=>[...document.querySelectorAll('.ra-result tbody tr')].every(r=>r.lastElementChild.textContent==='1'));
   const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Contouren exporteren',exact:true}).click()]);const exported=JSON.parse(readFileSync(await download.path()));assert.equal(exported.features.length,3);assert.equal(exported.provenance.request.profile,'cycling');
   await page.getByRole('button',{name:'E-bike',exact:true}).click();await page.getByText(/Instellingen gewijzigd/).waitFor();assert.equal(calls,1,'Changing controls does not spam the demo endpoint');
   await page.getByLabel('Reisrichting').selectOption('to');await page.getByRole('button',{name:'Bereken bereikbaarheid',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ra-result h3')?.textContent.includes('E-bike'));
   assert.equal(lastRequest.reverse,true);assert.equal(lastRequest.costing_options.bicycle.cycling_speed,25);
   const validResult=await page.locator('.ra-result tbody').textContent();
   nonCumulative=true;await calculate.click();await page.getByRole('alert').filter({hasText:/geen volledige, geldige contouren/}).waitFor();
   assert.equal(await page.locator('.ra-result tbody').textContent(),validResult,'A non-cumulative response preserves the last valid result');assert.equal(await page.locator('.ra-map').getAttribute('data-contours'),'3');
   nonCumulative=false;
   await page.getByRole('button',{name:'Meetlijn tekenen',exact:true}).click();const map=await page.locator('.ra-map canvas').boundingBox();await page.mouse.click(map.x+150,map.y+200);await page.mouse.click(map.x+450,map.y+300);await page.getByRole('button',{name:'Meting afronden',exact:true}).click();
   await page.locator('.mm-measurement[data-appearance=along-line]').waitFor();assert.match(await page.locator('.mm-measurement').textContent(),/m|km/);
   const evidence=resolve(site,`../artifacts/reachability/${name}`);mkdirSync(evidence,{recursive:true});await page.screenshot({path:resolve(evidence,'desktop.png'),fullPage:true});
   await page.getByRole('button',{name:'Metingen wissen',exact:true}).click();await page.locator('.mm-measurement').waitFor({state:'detached'});
   fail=true;await page.getByRole('button',{name:'Bereken bereikbaarheid',exact:true}).click();await page.getByRole('alert').getByText(/429/).waitFor();
   await page.getByRole('button',{name:'Contouren wissen',exact:true}).click();await page.locator('.ra-map[data-contours="0"]').waitFor();
   fail=false;delay=500;await page.getByRole('button',{name:'Bereken bereikbaarheid',exact:true}).click();await page.getByRole('button',{name:'Berekening annuleren',exact:true}).click();assert.equal(await page.locator('.ra-result').count(),0);
   delay=0;const beforeCoordinates=calls;
   await lng.fill('-73,9857');await lat.fill('40,7484');await expectOrigin([-73.9857,40.7484]);assert.equal(calls,beforeCoordinates,'Valid pasted coordinates still need explicit calculation');
   await calculate.click();await page.waitForFunction(()=>document.querySelector('.ra-result p')?.textContent.includes('−73,9857')||document.querySelector('.ra-result p')?.textContent.includes('-73,9857'));
   assert.equal(lastRequest.locations[0].lon,-73.9857);assert.equal(lastRequest.locations[0].lat,40.7484);
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:resolve(evidence,'mobile.png'),fullPage:true});
   await page.setViewportSize({width:1440,height:1000});await page.goto(`${origin}${basePath}/playground/`);await page.locator('[data-playground][data-ready=true]').waitFor();
   await page.getByRole('checkbox',{name:'Measurements',exact:true}).check();await page.getByLabel('Line label style',{exact:true}).selectOption('along-line');
   const [projectFile]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Save project',exact:true}).click()]);const project=JSON.parse(readFileSync(await projectFile.path()));assert.equal(project.settings.lineLabelStyle,'along-line');
   await page.getByLabel('Line label style',{exact:true}).selectOption('badge');await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'labels.mapmaster.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
   // Empty projects can reopen directly; replacing existing objects asks first.
   await page.waitForFunction(()=>document.querySelector('[role=dialog]')||document.querySelector('[aria-label="Line label style"]')?.value==='along-line');
   if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'Open project',exact:true}).click();
   assert.equal(await page.getByLabel('Line label style',{exact:true}).inputValue(),'along-line');assert.deepEqual(errors,[]);
   await context.close();console.log(`✓ ${name}: editable/invalid/URL coordinates, explicit routing, strict cumulative contours and rollback, four profiles, inverse contours, non-moving camera, POI counts, exports, line measurements, failure/cancel and mobile`);
  }finally{await browser.close();}
 }
}finally{await new Promise(resolve=>server.close(resolve));}
