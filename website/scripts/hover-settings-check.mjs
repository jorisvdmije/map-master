import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export async function checkHoverSettings({ browser, origin, basePath = "/map-master" }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  const ready = () => page.locator('[data-playground][data-ready="true"]').waitFor();
  const project = async () => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project", exact: true }).click()]);
    return JSON.parse(readFileSync(await file.path(), "utf8"));
  };
  const openSettings = () => page.locator(".pg-hover-settings summary").click();
  const hover = async () => {
    await page.mouse.move(20, 20);
    const box = await page.locator(".pg-map canvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator(".mm-feature-preview").waitFor();
  };
  const save = () => page.getByRole("button", { name: "Apply hover settings", exact: true }).click();
  try {
    await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" }); await ready();
    const feature = { type: "Feature", id: 7, properties: { name: "Station", status: "Active", capacity: 1234.567, checked: "2026-11-03", nested: { safe: "<img>" } }, geometry: { type: "Point", coordinates: [4.895, 52.372] } };
    await page.getByLabel("Import GeoJSON files", { exact: true }).setInputFiles({ name: "stations.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(feature)) });
    await page.locator('.pg-workbench[data-feature-count="1"]').waitFor();
    const before = await project(); const undoBefore = await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).isDisabled();
    await hover();
    const card = page.locator(".mm-feature-preview"); assert.ok((await card.textContent()).includes("Latitude")); assert.ok((await card.textContent()).includes("52.372000"));
    await openSettings();
    await page.getByRole("checkbox", { name: "Choose custom fields", exact: true }).check();
    await page.getByLabel("Hover title field", { exact: true }).selectOption(JSON.stringify("status"));
    await page.getByLabel("Hover label 1", { exact: true }).fill("State");
    await page.getByLabel("Hover format 2", { exact: true }).selectOption("number");
    await page.getByLabel("Hover decimals 2", { exact: true }).fill("1");
    await page.getByLabel("Hover format 3", { exact: true }).selectOption("date");
    await page.getByRole("button", { name: "Move hover field 3 up", exact: true }).click();
    await page.getByLabel("Hover locale", { exact: true }).selectOption("nl");
    await save();
    const configured = await project(); assert.deepEqual(configured.data, before.data);
    assert.equal(await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).isDisabled(), undoBefore);
    const options = configured.hoverPreviews[0].options;
    assert.deepEqual(options.fields.map(field => field.key), ["status", "checked", "capacity"]);
    await hover(); assert.equal(await card.locator("h3").textContent(), "Active");
    assert.deepEqual(await card.locator("dt").allTextContents(), ["State", "checked", "capacity", "Latitude", "Longitude"]);
    assert.ok((await card.textContent()).includes("1.234,6")); assert.ok((await card.textContent()).includes("3 nov 2026"));
    assert.ok(!(await card.textContent()).includes("nested"));
    await page.locator(".pg-save-state").filter({ hasText: /^Saved locally$/ }).waitFor();
    await page.reload({ waitUntil: "networkidle" }); await ready(); await hover();
    assert.equal(await card.locator("h3").textContent(), "Active"); assert.ok((await card.textContent()).includes("1.234,6"));
    const twoLayers = structuredClone(configured); twoLayers.hoverPreviews.push({ layerId: "default", options: { enabled: false } });
    await page.getByLabel("Open project file", { exact: true }).setInputFiles({ name: "layers.mapmaster.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(twoLayers)) });
    await page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true }).click(); await hover();
    assert.equal(await card.locator("h3").textContent(), "Active", "Disabling another layer cannot hide this layer's configured preview");
    await openSettings();
    await page.getByRole("checkbox", { name: "Marker coordinates", exact: true }).uncheck();
    await page.getByLabel("Hover maximum rows", { exact: true }).fill("2"); await save();
    await hover(); assert.deepEqual(await card.locator("dt").allTextContents(), ["State", "checked"]);
    assert.ok((await card.textContent()).includes("1 more property"));
    await openSettings(); await page.getByRole("checkbox", { name: "Show hover card", exact: true }).uncheck(); await save();
    await page.mouse.move(20, 20); const box = await page.locator(".pg-map canvas").boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await card.count(), 0);
    await openSettings(); await page.getByRole("button", { name: "Reset hover settings", exact: true }).click(); await hover();
    assert.equal(await card.locator("h3").textContent(), "Station"); assert.ok((await card.textContent()).includes("Latitude"));
    await openSettings(); await page.getByRole("checkbox", { name: "Choose custom fields", exact: true }).check();
    await page.getByRole("button", { name: "Remove hover field 3", exact: true }).click();
    await page.getByLabel("Add hover property", { exact: true }).selectOption(JSON.stringify("name"));
    await page.getByLabel("Hover title field", { exact: true }).selectOption(JSON.stringify("capacity"));
    await page.getByRole("checkbox", { name: "Choose custom fields", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Choose custom fields", exact: true }).check();
    assert.equal(await page.getByRole("button", { name: "Add hover field", exact: true }).isDisabled(), true, "An outdated property choice cannot add a duplicate and crash the draft");
    await page.getByLabel("Hover title field", { exact: true }).selectOption(JSON.stringify("name"));
    await page.getByRole("checkbox", { name: "Choose custom fields", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Choose custom fields", exact: true }).check();
    await page.getByRole("button", { name: "Remove hover field 3", exact: true }).click();
    await page.getByLabel("Add hover property", { exact: true }).selectOption(JSON.stringify("nested"));
    await page.getByRole("button", { name: "Add hover field", exact: true }).click();
    await page.getByLabel("Hover label 3", { exact: true }).fill("Details"); await page.getByLabel("Hover format 3", { exact: true }).selectOption("json");
    await save(); await hover(); assert.ok((await card.textContent()).includes('Details')); assert.ok((await card.textContent()).includes('{"safe":"<img>"}')); assert.equal(await card.locator("img").count(), 0);
    await openSettings(); await page.getByRole("button", { name: "Reset hover settings", exact: true }).click();
    const restored = await project(); assert.deepEqual(restored.data, before.data); assert.deepEqual(restored.hoverPreviews, [{ layerId: "default", options: { enabled: false } }]);
    // Malformed serialized settings must reject before replacing the project.
    const invalid = structuredClone(configured); invalid.hoverPreviews[0].options.maxRows = 999;
    await page.getByLabel("Open project file", { exact: true }).setInputFiles({ name: "bad.mapmaster.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.locator('.pg-notice[role="alert"]').waitFor(); assert.deepEqual((await project()).data, before.data);
    // Projects from before hover configuration remain compatible.
    const legacy = structuredClone(before); delete legacy.hoverPreviews;
    await page.getByLabel("Open project file", { exact: true }).setInputFiles({ name: "legacy.mapmaster.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacy)) });
    await page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true }).click();
    assert.deepEqual((await project()).hoverPreviews, []); assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log("✓ Hover settings: per-layer title/fields/labels/order/formats, default coordinates, row budget, disabling/reset, exact data, autosave/restore, invalid and legacy projects");
}
