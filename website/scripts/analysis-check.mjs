import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Real user controls, public map interactions and downloaded files; no test-only API. */
export async function checkAnalysis({ context, origin, evidence, basePath = "/map-master" }) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("dialog", dialog => dialog.accept());
  await page.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }] } }));
  const matches = count => page.locator(`.an-workbench[data-matches="${count}"]`).waitFor();
  const importData = data => page.getByLabel("Import analysis data", { exact: true }).setInputFiles({ name: "assets.geojson", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
  const downloadFile = async action => { const pending = page.waitForEvent("download"); await action(); return readFileSync(await (await pending).path(), "utf8"); };
  const exportData = async name => { await page.getByLabel("Export results", { exact: true }).click(); return downloadFile(() => page.getByRole("button", { name, exact: true }).click()); };
  const clearNotice = async () => { const button = page.getByRole("button", { name: "Dismiss message" }); if (await button.count()) await button.click(); };
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // This suite starts from a fresh analysis; recovery has its own navigation,
    // reload and failure scenarios. Other suites may have saved data on this origin.
    await page.goto(`${origin}${basePath}/`);
    await page.evaluate(() => localStorage.removeItem("map-master-analysis-recovery-v1"));
    await page.goto(`${origin}${basePath}/analysis/`);
    await page.locator('[data-analysis][data-ready="true"]').waitFor();
    await matches(144);
    const guide = page.getByRole("dialog", { name: "A quick guide to Analysis", exact: true });
    const help = page.getByRole("button", { name: "How Analysis works", exact: true });
    await guide.waitFor();
    assert.match(await guide.textContent(), /not real Amsterdam records or street addresses/);
    await page.screenshot({ path: resolve(evidence, "analysis-introduction-desktop.png") });
    await guide.getByRole("button", { name: "Explore on my own", exact: true }).click();
    await page.reload();
    await page.locator('[data-analysis][data-ready="true"]').waitFor(); await matches(144);
    assert.equal(await guide.count(), 0, "The introduction does not interrupt subsequent visits");
    assert.equal(await page.locator(".sidebar").count(), 0);
    assert.equal(await page.locator(".an-table tbody tr").count(), 50);
    await help.click();
    await guide.getByRole("button", { name: "Try City centre", exact: true }).click();
    const inside = Number(await page.locator(".an-workbench").getAttribute("data-matches"));
    assert.ok(inside > 0 && inside < 144);
    await help.click(); await guide.waitFor(); await page.keyboard.press("Escape"); await guide.waitFor({ state: "detached" });
    assert.equal(await help.evaluate(node => node === document.activeElement), true, "Escape restores focus to the information button");
    await matches(inside);
    await page.locator(".an-category").first().click();
    const categoryCount = Number(await page.locator(".an-workbench").getAttribute("data-matches"));
    assert.ok(categoryCount > 0 && categoryCount < inside);
    const summary = JSON.parse(await exportData("Summary & statistics"));
    assert.equal(summary.statistics.count, categoryCount);
    assert.ok(Number.isFinite(summary.statistics.median));
    assert.ok(summary.statistics.q1 <= summary.statistics.median && summary.statistics.median <= summary.statistics.q3);
    assert.equal(summary.area.properties.name, "City centre");
    const session = await downloadFile(() => page.getByRole("button", { name: "Save analysis", exact: true }).click());
    assert.equal(JSON.parse(session).dataset.features.length, 144);
    assert.equal(JSON.parse(session).areas.features.length, 1);
    assert.equal(JSON.parse(session).activeArea, 0);
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await matches(inside);
    await page.getByLabel("Analysis area", { exact: true }).selectOption("");
    await matches(144);
    await clearNotice();
    await page.screenshot({ path: resolve(evidence, "analysis-desktop.png") });

    const data = { type: "FeatureCollection", features: [
      { type: "Feature", id: "inside", properties: { name: "Inside", category: "A", cost: 10 }, geometry: { type: "Point", coordinates: [4.9, 52.37] } },
      { type: "Feature", id: "boundary", properties: { name: "Boundary", category: "B", cost: null }, geometry: { type: "Point", coordinates: [4.89, 52.37] } },
      { type: "Feature", id: "outside", properties: { name: "Outside", category: "A", cost: 30 }, geometry: { type: "Point", coordinates: [4.94, 52.39] } },
    ] };
    await importData(data); await matches(3);
    assert.equal(await page.locator(".an-demo-context").count(), 0, "The sample explanation is hidden for imported data");
    await help.click();
    assert.match(await guide.textContent(), /You’re exploring your own dataset/);
    assert.equal(await guide.getByRole("button", { name: "Try City centre", exact: true }).count(), 0);
    await page.keyboard.press("Escape"); await matches(3);
    assert.equal(await page.locator('[data-stat="sum"]').textContent(), "40");
    assert.equal(await page.locator('[data-stat="average"]').textContent(), "20");
    await page.locator(".an-histogram button").first().click(); await matches(1);
    assert.equal(await page.locator('[data-stat="sum"]').textContent(), "10");
    await page.getByRole("button", { name: "Reset filters", exact: true }).click(); await matches(3);
    await clearNotice();
    await page.getByRole("button", { name: "Locate feature 3", exact: true }).click();
    await page.locator(".an-feature-detail > strong").filter({ hasText: "Outside" }).waitFor();
    await page.getByRole("button", { name: "Clear selected feature", exact: true }).click();
    await page.locator(".an-map-host canvas").click();
    await page.locator(".an-feature-detail > strong").filter({ hasText: "Outside" }).waitFor();
    assert.equal(await page.locator('tr[data-focused="true"]').count(), 1);
    await page.getByRole("button", { name: "Fit all data", exact: true }).click();
    const region = { type: "Feature", properties: { name: "Test district" }, geometry: { type: "Polygon", coordinates: [[[4.89, 52.36], [4.91, 52.36], [4.91, 52.38], [4.89, 52.38], [4.89, 52.36]]] } };
    await page.getByLabel("Import analysis areas", { exact: true }).setInputFiles({ name: "district.geojson", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(region)) });
    await matches(2);
    assert.equal(await page.locator('[data-stat="sum"]').textContent(), "10");
    assert.equal(await page.locator('[data-stat="average"]').textContent(), "10");
    const exported = JSON.parse(await exportData("Matching GeoJSON"));
    assert.deepEqual(exported.features.map(f => f.id), ["inside", "boundary"]);
    assert.deepEqual(exported.features[0], data.features[0]);
    const csv = await exportData("Matching CSV");
    assert.match(csv, /geometry_geojson/); assert.match(csv, /Inside/); assert.ok(!csv.includes("Outside"));

    await clearNotice();
    await page.getByRole("button", { name: "Edit vertices", exact: true }).click();
    await page.locator('.an-workbench[data-mode="edit-polygon"]').waitFor();
    await page.locator(".an-map-host canvas").press("Home");
    await page.locator("[data-geo-vertex-focus]").press("ArrowRight");
    await page.getByRole("button", { name: "Apply area", exact: true }).click();
    await page.locator('.an-workbench[data-mode="idle"]').waitFor();
    await page.getByRole("button", { name: "Undo area edit", exact: true }).click();
    await matches(2);
    await page.getByRole("button", { name: "Delete analysis area", exact: true }).click(); await matches(3);
    await page.getByRole("button", { name: "Undo area edit", exact: true }).click();
    await page.getByLabel("Analysis area", { exact: true }).selectOption({ label: "Test district" }); await matches(2);

    // Draw a real polygon on the canvas, apply it and verify one undoable area.
    await clearNotice();
    await page.getByRole("button", { name: "Draw area", exact: true }).click();
    await help.click(); await guide.waitFor();
    await page.keyboard.press("Escape"); await guide.waitFor({ state: "detached" });
    assert.equal(await page.locator(".an-workbench").getAttribute("data-mode"), "draw-polygon", "Opening and closing help preserves an active draft");
    const canvas = page.locator(".an-map-host canvas"), bounds = await canvas.boundingBox();
    for (const [x, y] of [[.35, .3], [.62, .3], [.62, .65], [.35, .65]]) await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
    await page.getByRole("button", { name: "Apply area", exact: true }).click();
    const afterDraw = JSON.parse(await downloadFile(() => page.getByRole("button", { name: "Save analysis", exact: true }).click()));
    assert.equal(afterDraw.areas.features.length, 2);
    await page.getByRole("button", { name: "Undo area edit", exact: true }).click();
    await page.getByLabel("Analysis area", { exact: true }).selectOption(""); await matches(3);

    // Invalid imports keep the current analysis intact.
    await importData({ type: "FeatureCollection", features: [{ ...data.features[0], geometry: null }] });
    await page.locator('.an-notice[role="alert"]').waitFor(); await matches(3);
    await clearNotice();
    await page.getByLabel("Import analysis data", { exact: true }).setInputFiles({ name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from('name,east,north,amount\n"Alpha, Inc",4.9,52.37,0\nBeta,4.91,52.38,12') });
    await page.getByRole("dialog").waitFor();
    await page.getByLabel("CSV longitude", { exact: true }).selectOption("east");
    await page.getByLabel("CSV latitude", { exact: true }).selectOption("north");
    await page.getByRole("button", { name: "Load 2 rows", exact: true }).click(); await matches(2);
    assert.equal(await page.locator('[data-stat="sum"]').textContent(), "12");
    await importData({ type: "FeatureCollection", features: [...data.features, { ...region, properties: { name: "Source polygon", mapMasterLayer: "reference-layer" } }] }); await matches(4);
    await page.getByRole("button", { name: "Locate feature 4", exact: true }).click();
    await page.getByRole("button", { name: "Use polygon as analysis area", exact: true }).click(); await matches(3);
    await page.getByLabel("Import analysis data", { exact: true }).setInputFiles({ name: "saved.analysis.json", mimeType: "application/json", buffer: Buffer.from(session) });
    await matches(categoryCount);
    assert.equal(await page.getByLabel("Analysis area", { exact: true }).inputValue(), "area-1");

    // Responsive layout and linked map selection at the smallest supported width.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "Configure", exact: true }).click();
    await page.getByLabel("Analysis area", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Close configuration", exact: true }).click();
    await page.getByRole("button", { name: "Insights", exact: true }).click();
    assert.equal(await page.locator('[data-stat="count"]').isVisible(), true);
    await clearNotice();
    await page.screenshot({ path: resolve(evidence, "analysis-mobile-insights.png") });
    await page.getByRole("button", { name: "Close insights", exact: true }).click();
    await page.screenshot({ path: resolve(evidence, "analysis-mobile.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await help.click(); await guide.waitFor();
    const introBounds = await guide.boundingBox();
    assert.ok(introBounds.x >= 0 && introBounds.x + introBounds.width <= 360 && introBounds.height <= 800);
    const tryButton = await guide.getByRole("button", { name: "Try City centre", exact: true }).boundingBox();
    assert.ok(tryButton.y + tryButton.height <= 800, "Introduction actions remain visible without scrolling on mobile");
    await page.screenshot({ path: resolve(evidence, "analysis-introduction-mobile.png") });
    await page.keyboard.press("Escape");
    for (const width of [390, 800, 801, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${width}px`);
      const frame = await page.locator(".an-map-frame").boundingBox();
      await page.waitForFunction(({ width, height }) => {
        const map = document.querySelector(".an-map-host").getBoundingClientRect();
        return Math.abs(map.width - width) < 2 && Math.abs(map.height - height) < 2;
      }, { width: frame.width, height: frame.height });
    }
    assert.deepEqual(errors, []);
    console.log("✓ Analysis: first-visit/reopenable introduction, guided sample, spatial/category filters, statistics, area editing/history, CSV, save/reopen, exports, invalid imports and mobile layout");
  } catch (error) {
    console.error("Analysis initialization/browser errors:", errors);
    console.error("Analysis loading state:", await page.locator(".an-loading").allTextContents().catch(() => []));
    await page.screenshot({ path: resolve(evidence, "analysis-failure.png") }).catch(() => {});
    throw error;
  } finally { await page.close(); }
}
