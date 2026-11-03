import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Exercise subtraction through the actual playground and documentation controls. */
export async function checkDifference({ browser, origin, basePath = "/map-master" }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  const project = async () => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project", exact: true }).click()]);
    return JSON.parse(readFileSync(await file.path(), "utf8"));
  };
  const box = (id, name, west, south, east, north) => ({ type: "Feature", id, properties: { name, nested: { keep: true } },
    geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });
  const difference = () => page.locator('.mm-toolbar-button[data-tool="difference"]');
  const area = geometry => {
    const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return parts.reduce((sum, rings) => sum + rings.reduce((total, ring, index) => total + (index ? -1 : 1) * Math.abs(ring.slice(1).reduce((value, p, i) => value + ring[i][0] * p[1] - p[0] * ring[i][1], 0)) / 2, 0), 0);
  };
  try {
    await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" }); await page.locator('[data-ready="true"]').waitFor();
    const data = { type: "FeatureCollection", features: [box(7, "Target parcel", 4.89, 52.37, 4.9, 52.38), box("7", "Reference cutter", 4.895, 52.368, 4.897, 52.382)] };
    await page.getByLabel("Import GeoJSON files", { exact: true }).setInputFiles({ name: "difference.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(data)) });
    await page.locator('.pg-workbench[data-feature-count="2"]').waitFor();
    await page.getByRole("checkbox", { name: "Select Reference cutter", exact: true }).check();
    await page.getByRole("button", { name: "Lock / unlock", exact: true }).click();
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Target parcel", exact: true }).check();
    await page.getByRole("checkbox", { name: "Select Reference cutter", exact: true }).check();
    assert.equal(await difference().isEnabled(), true);
    const before = await project();
    await difference().click(); await page.locator('[data-mode="difference-polygons"]').first().waitFor();
    const notice = page.locator(".mm-toolbar-difference");
    assert.ok((await notice.textContent()).includes("Target (first selected): Target parcel"));
    assert.ok((await notice.textContent()).includes("Cutting polygons are kept (1)"));
    await page.locator(".mm-toolbar-actions").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.locator(".pg-workbench").getAttribute("data-mode"), "idle");
    assert.equal(await page.locator(".pg-ribbon").getByRole("button", { name: "Redo", exact: true }).isDisabled(), true);
    await difference().click();
    await page.locator(".mm-toolbar-actions").getByRole("button", { name: "Apply", exact: true }).click();
    const after = await project();
    assert.equal(after.data.features[0].geometry.type, "MultiPolygon");
    assert.ok(area(after.data.features[0].geometry) < area(before.data.features[0].geometry), "Subtraction reduces the actual target area");
    assert.deepEqual(after.data.features[0].properties, before.data.features[0].properties);
    assert.deepEqual(after.data.features[1], before.data.features[1], "The locked cutter remains exactly unchanged");
    assert.equal(after.data.features.length, 2, "Difference keeps its cutter");
    await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual((await project()).data, before.data);
    await page.locator(".pg-ribbon").getByRole("button", { name: "Redo", exact: true }).click();
    assert.deepEqual((await project()).data, after.data);
    await page.goto(`${origin}${basePath}/guides/difference/`, { waitUntil: "networkidle" });
    await page.locator('[data-demo="difference"]').scrollIntoViewIfNeeded(); await page.locator('[data-demo="difference"][data-ready="true"]').waitFor();
    await difference().click(); assert.ok((await notice.textContent()).includes("Festival area"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".mm-toolbar-actions").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const panel = document.querySelector(".mm-toolbar-actions").getBoundingClientRect(); const map = document.querySelector(".demo-map").getBoundingClientRect();
      return panel.left >= map.left - 1 && panel.top >= map.top - 1 && panel.right <= map.right + 1 && panel.bottom <= map.bottom + 1;
    });
    await page.locator(".mm-toolbar-actions").getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(await page.locator('[data-demo="difference"]').getAttribute("data-mode"), "idle");
    assert.equal(await page.locator('.mm-toolbar-button[data-tool="undo"]').isEnabled(), true);
    await page.locator('.mm-toolbar-button[data-tool="undo"]').click();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log("✓ Difference: real playground/docs controls, locked cutter, explicit preview/cancel/apply, reduced target area, exact retained cutter and Undo/Redo");
}
