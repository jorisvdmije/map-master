import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** User-visible pin styles, safe previews, persistence and documentation navigation. */
export async function checkFeaturePreviews({ browser, origin, basePath = "/map-master" }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  const saved = () => page.locator(".pg-save-state").filter({ hasText: /^Saved locally$/ }).waitFor();
  const downloadProject = async () => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project", exact: true }).click()]);
    return JSON.parse(readFileSync(await file.path(), "utf8"));
  };
  const hoverPin = async () => {
    const canvas = await page.locator(".pg-map canvas").boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2 + 8, canvas.y + canvas.height / 2 - 25);
    await page.locator(".mm-feature-preview").waitFor();
  };
  try {
    await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" }); await page.locator('[data-ready="true"]').waitFor();
    const feature = { type: "Feature", id: 7, properties: { name: '<img src=x onerror="window.previewXSS=true">', active: false, value: null, nested: { code: "<safe>", items: [1, true] } }, geometry: { type: "Point", coordinates: [4.895, 52.372] } };
    await page.getByLabel("Import GeoJSON files", { exact: true }).setInputFiles({ name: "preview.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(feature)) });
    await page.locator('.pg-workbench[data-feature-count="1"]').waitFor();
    await page.getByLabel("Marker shape", { exact: true }).selectOption("pin");
    await page.getByLabel("Marker radius", { exact: true }).fill("10");
    await page.getByRole("button", { name: "Apply style", exact: true }).click(); await saved();
    const before = await downloadProject(); assert.equal(before.layers.at(-1).style.marker.shape, "pin");
    await hoverPin();
    const card = page.locator(".mm-feature-preview");
    assert.ok((await card.textContent()).includes(feature.properties.name));
    assert.equal(await card.locator("img,script").count(), 0);
    assert.ok((await card.textContent()).includes('{"code":"<safe>","items":[1,true]}'));
    assert.ok((await card.textContent()).includes("false")); assert.ok((await card.textContent()).includes("null"));
    assert.equal(await page.locator('tbody tr[aria-selected="true"]').count(), 0, "Hover does not select features");
    await page.keyboard.press("Escape"); await card.waitFor({ state: "detached" });
    const canvasBox = await page.locator(".pg-map canvas").boundingBox();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 9, canvasBox.y + canvasBox.height / 2 - 25);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await card.count(), 0, "Dismissed preview stays closed while hovering the same pin");
    await page.mouse.move(20, 20); await hoverPin();
    await card.hover(); assert.equal(await card.isVisible(), true, "The preview remains readable when moving into it");
    assert.deepEqual((await downloadProject()).data, before.data, "Hover never changes saved geometry or properties");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector(".pg-map").clientWidth === document.querySelector(".pg-map-frame").clientWidth);
    await hoverPin();
    assert.equal(await card.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; }), true, "Preview stays within a narrow map");
    assert.equal(await card.evaluate(element => { const box = element.getBoundingClientRect(); const map = document.querySelector(".pg-map").getBoundingClientRect(); return box.top >= map.top && box.bottom <= map.bottom; }), true, "Preview fits the available map height");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload({ waitUntil: "networkidle" }); await page.locator('[data-ready="true"]').waitFor();
    assert.equal(await page.getByLabel("Marker shape", { exact: true }).inputValue(), "pin");
    await hoverPin(); await page.mouse.move(20, 20); await card.waitFor({ state: "detached" });
    // Feature override, exact Undo and project/GeoJSON serialization.
    await page.locator('tr[data-feature-key="number:7"]').getByRole("checkbox").check();
    await page.locator(".pg-map canvas").focus(); await card.waitFor();
    await page.keyboard.press("Escape"); await card.waitFor({ state: "detached" });
    assert.equal(await page.locator('tr[data-feature-key="number:7"]').getByRole("checkbox").isChecked(), true, "Dismissing the preview preserves keyboard selection");
    await page.getByLabel("Marker shape", { exact: true }).selectOption("circle");
    await page.getByRole("button", { name: "Apply style", exact: true }).click();
    assert.equal((await downloadProject()).data.features[0].properties.mapMasterPlaygroundStyle.marker.shape, "circle");
    await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual((await downloadProject()).data, before.data);
    await page.locator(".pg-ribbon").getByRole("button", { name: "Redo", exact: true }).click();
    assert.equal((await downloadProject()).data.features[0].properties.mapMasterPlaygroundStyle.marker.shape, "circle");
    await saved();
    await page.locator(".pg-brand").click(); await page.waitForURL(`${origin}${basePath}/`);
    assert.equal(await page.locator(".mm-feature-preview").count(), 0);
    await page.goto(`${origin}${basePath}/guides/markers/`, { waitUntil: "networkidle" });
    const toc = page.locator(".toc");
    assert.equal(await toc.evaluate(element => getComputedStyle(element.querySelector("a")).fontSize), "13px");
    assert.ok(await toc.evaluate(element => [...element.querySelectorAll("a")].every(link => link.getBoundingClientRect().height >= 36)));
    await toc.getByRole("link", { name: "Appearance", exact: true }).click(); await page.waitForURL(/#appearance$/);
    await page.locator('[data-demo="markers"]').scrollIntoViewIfNeeded(); await page.locator('[data-demo="markers"][data-ready="true"]').waitFor();
    const mapBox = await page.locator('[data-demo="markers"] canvas').boundingBox();
    const scale = 512 * 2 ** 15.6 / (360 * 111320 * Math.cos(52.3579 * Math.PI / 180));
    await page.mouse.move(mapBox.x + mapBox.width / 2 - 60 * scale + 8, mapBox.y + mapBox.height / 2 - 95 * scale - 25);
    await card.waitFor(); assert.ok((await card.textContent()).includes("Bench"), "Documentation markers share the property preview");
    await page.keyboard.press("Escape"); await card.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log("✓ Map pins and property previews: layer/feature styles, safe nested values, hover without selection, dismissal, project restore, exact history and readable docs contents");
}
