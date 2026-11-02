import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Exercise the workbench through its controls and downloaded files, without a test-only editor API. */
export async function checkPlayground({ context, origin, evidence, basePath = "/map-master" }) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("dialog", dialog => dialog.accept());
  const path = `${origin}${basePath}/playground/`;
  const ready = () => page.locator('[data-playground][data-ready="true"]').waitFor();
  const count = value => page.locator(`.pg-workbench[data-feature-count="${value}"]`).waitFor();
  const layers = async () => Number(await page.locator(".pg-workbench").getAttribute("data-layer-count"));
  const saved = () => page.getByRole("status").filter({ hasText: /^Saved locally$/ }).waitFor();
  const downloadProject = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save project", exact: true }).click();
    const download = await pending;
    assert.match(download.suggestedFilename(), /\.mapmaster\.json$/);
    return JSON.parse(readFileSync(await download.path(), "utf8"));
  };
  const importData = (data, name = "markers.geojson") => page.getByLabel("Import GeoJSON files", { exact: true }).setInputFiles({ name, mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(data)) });
  const openProject = project => page.getByLabel("Open project file", { exact: true }).setInputFiles({ name: "saved.mapmaster.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  const row = id => page.locator(`tr[data-feature-key="${id}"]`);
  const geometry = (project, id) => project.data.features.find(feature => feature.id === id).geometry;
  const feature = (project, id) => project.data.features.find(feature => feature.id === id);
  const cleanNotice = async () => { const dismiss = page.getByRole("button", { name: "Dismiss message" }); if (await dismiss.count()) await dismiss.click(); };

  try {
    await page.goto(path, { waitUntil: "networkidle" }); await ready(); await count(0);
    assert.equal(await page.locator(".sidebar").count(), 0, "The playground has its own full-width shell");
    await page.getByRole("button", { name: "Or explore the sample project" }).click(); await count(6);
    assert.equal(await layers(), 3);
    await page.getByLabel("Table scope", { exact: true }).selectOption("all");
    assert.equal(await page.locator("tbody tr").count(), 6);

    const source = { type: "FeatureCollection", features: [
      { type: "Feature", id: 7, properties: { name: "Numeric marker", capacity: 12, active: false, nested: { code: "<safe>", values: [null, 3] } }, geometry: { type: "Point", coordinates: [4.888, 52.371] } },
      { type: "Feature", id: "7", properties: { name: "Text marker", capacity: 5 }, geometry: { type: "Point", coordinates: [4.891, 52.373] } },
    ] };
    await importData(source); await count(8); assert.equal(await layers(), 4);
    await row("number:7").getByRole("button", { name: "7", exact: true }).click();
    assert.equal(await row("number:7").getAttribute("aria-selected"), "true");
    assert.equal(await row("string:7").getAttribute("aria-selected"), "false");

    await row("number:7").getByRole("button", { name: "Numeric marker", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Value", { exact: true }).fill("Edited marker");
    await page.getByRole("button", { name: "Save attribute", exact: true }).click();
    await row("number:7").getByRole("button", { name: "Edited marker", exact: true }).waitFor();
    await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click();
    await row("number:7").getByRole("button", { name: "Numeric marker", exact: true }).waitFor();
    await page.locator(".pg-ribbon").getByRole("button", { name: "Redo", exact: true }).click();
    await row("number:7").getByRole("button", { name: "Edited marker", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add attribute", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Field name", { exact: true }).fill("reviewed");
    await page.getByRole("dialog").getByLabel("Value type", { exact: true }).selectOption("boolean");
    await page.getByRole("dialog").getByLabel("Value", { exact: true }).selectOption("true");
    await page.getByRole("button", { name: "Save attribute", exact: true }).click();
    let project = await downloadProject();
    assert.equal(feature(project, 7).properties.reviewed, true);
    assert.equal(feature(project, 7).properties.capacity, 12);
    assert.deepEqual(feature(project, 7).properties.nested, source.features[0].properties.nested);
    assert.equal(feature(project, "7").properties.name, "Text marker");

    // Keyboard vertex editing reaches the real editor, saves once, and cancels cleanly.
    const beforeMove = geometry(project, 7);
    await page.getByRole("button", { name: "Edit geometry on map" }).click();
    await page.locator(".pg-map canvas").press("Home");
    await page.locator("[data-geo-vertex-focus]").press("ArrowRight");
    await page.locator("[data-geo-vertex-focus]").press("Enter");
    await page.locator('.pg-workbench[data-mode="idle"]').waitFor();
    assert.notDeepEqual(geometry(await downloadProject(), 7), beforeMove);
    await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual(geometry(await downloadProject(), 7), beforeMove);
    await page.getByRole("button", { name: "Edit geometry on map" }).click();
    await page.locator(".pg-map canvas").press("Home");
    await page.locator("[data-geo-vertex-focus]").press("ArrowRight");
    await page.locator("[data-geo-vertex-focus]").press("Escape");
    assert.deepEqual(geometry(await downloadProject(), 7), beforeMove);

    await page.getByLabel("Fill color", { exact: true }).fill("#e28436");
    await page.getByRole("button", { name: "Apply style", exact: true }).click();
    project = await downloadProject();
    assert.equal(feature(project, 7).properties.mapMasterPlaygroundStyle.shape.fillColor, "#e28436");
    await page.getByRole("button", { name: "Lock markers", exact: true }).click();
    assert.equal(await row("number:7").getByRole("button", { name: "Edited marker", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Unlock markers", exact: true }).click();

    // An invalid import cannot leave an empty layer, alter data, or consume history.
    const beforeInvalid = await downloadProject();
    await importData({ type: "Feature", id: "bad", properties: {}, geometry: { type: "Point", coordinates: [4, 99] } }, "bad.geojson");
    await page.getByRole("alert").filter({ hasText: /bad.geojson/ }).waitFor();
    const afterInvalid = await downloadProject();
    assert.deepEqual(afterInvalid.data, beforeInvalid.data); assert.deepEqual(afterInvalid.layers, beforeInvalid.layers);
    await importData(source, "duplicate.geojson");
    await page.getByRole("alert").filter({ hasText: /duplicate.geojson/ }).waitFor();
    assert.equal(await layers(), 4); await count(8);

    const corrupt = structuredClone(beforeInvalid);
    corrupt.name = "Invalid replacement";
    corrupt.layers.push({ ...corrupt.layers[0], id: "uncommitted-layer", name: "Must roll back" });
    corrupt.data.features[0].geometry = { type: "Point", coordinates: [4, 99] };
    await openProject(corrupt);
    await page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true }).click();
    await page.locator('.pg-notice[role="alert"]').waitFor();
    const afterProjectFailure = await downloadProject();
    assert.deepEqual(afterProjectFailure.data, beforeInvalid.data); assert.deepEqual(afterProjectFailure.layers, beforeInvalid.layers); assert.equal(afterProjectFailure.name, beforeInvalid.name);

    // GeoJSON exports respect selection while preserving typed IDs and attributes.
    await page.getByRole("button", { name: "Export GeoJSON", exact: true }).click();
    await page.getByLabel("Export scope", { exact: true }).selectOption("selection");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download GeoJSON", exact: true }).click();
    const exported = JSON.parse(readFileSync(await (await pending).path(), "utf8"));
    assert.deepEqual(exported.features.map(feature => feature.id), [7]);

    await page.getByLabel("Table scope", { exact: true }).selectOption("selection");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByLabel("Table scope", { exact: true }).selectOption("all");
    await page.getByLabel("Search attributes", { exact: true }).fill("Text marker");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByLabel("Search attributes", { exact: true }).fill("");
    await page.getByLabel("Basemap", { exact: true }).selectOption("blank");
    await page.getByLabel("Scale borders with zoom", { exact: true }).check();
    await page.getByRole("button", { name: "Lock / unlock", exact: true }).click();
    await page.getByLabel("Project name", { exact: true }).fill("My survey project");
    await page.getByLabel("Project name", { exact: true }).press("Enter");
    const portable = await downloadProject();
    assert.equal(portable.name, "My survey project"); assert.deepEqual(portable.lockedFeatureIds, [7]);
    assert.equal(portable.settings.basemap, "blank"); assert.equal(portable.settings.scaleBorders, true);
    await saved(); await page.reload({ waitUntil: "networkidle" }); await ready(); await count(8); await saved();
    const restored = await downloadProject();
    assert.deepEqual(restored.data, portable.data); assert.deepEqual(restored.layers, portable.layers); assert.deepEqual(restored.lockedFeatureIds, [7]);
    assert.deepEqual(restored.settings, portable.settings); assert.deepEqual(restored.camera, portable.camera);

    // Both open-project and empty-project drawing are covered independently of autosave.
    await page.getByRole("button", { name: "New project", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true }).click(); await count(0);
    await page.locator('.mm-toolbar-button[data-tool="polygon"]').click();
    assert.equal(await page.locator(".pg-empty-card").count(), 0, "The empty state cannot intercept drawing");
    const canvas = page.locator(".pg-map canvas"); const box = await canvas.boundingBox();
    for (const [x, y] of [[0.35, 0.48], [0.7, 0.48], [0.55, 0.75]]) await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    await page.getByRole("button", { name: "Finish", exact: true }).click(); await count(1);
    await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click(); await count(0);
    await openProject(portable); await count(8);
    assert.deepEqual((await downloadProject()).data, portable.data);
    await saved();

    // A second tab reads without writing; an actual conflicting save is rejected.
    const second = await context.newPage(); second.on("dialog", dialog => dialog.accept());
    try {
      await second.goto(path, { waitUntil: "networkidle" }); await second.locator('[data-ready="true"]').waitFor();
      await page.getByLabel("Project name", { exact: true }).fill("First tab wins"); await page.getByLabel("Project name", { exact: true }).press("Enter"); await saved();
      await second.getByLabel("Project name", { exact: true }).fill("Second tab conflict"); await second.getByLabel("Project name", { exact: true }).press("Enter");
      await second.getByRole("alert").filter({ hasText: /Another tab saved/ }).waitFor();
      assert.equal(await second.locator(".pg-save-state").innerText(), "Local save paused");
    } finally { await second.close(); }

    const transfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify({ type: "Feature", id: "dropped", properties: { name: "Dropped file" }, geometry: { type: "Point", coordinates: [4.89, 52.372] } })], "dropped.geojson", { type: "application/geo+json" }));
      transfer.items.add(new File(["{"], "broken.geojson", { type: "application/json" }));
      return transfer;
    });
    await page.dispatchEvent(".pg-root", "dragenter", { dataTransfer: transfer });
    await page.locator(".pg-drop-overlay").waitFor();
    await page.dispatchEvent(".pg-root", "drop", { dataTransfer: transfer }); await count(9);
    await page.getByRole("alert").filter({ hasText: /broken.geojson/ }).waitFor();
    assert.equal(await page.locator(".pg-drop-overlay").count(), 0);
    await transfer.dispose();

    await cleanNotice();
    await page.screenshot({ path: resolve(evidence, "playground-desktop.png") });
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No viewport overflow at ${width}`);
      const clippedControls = await page.evaluate(() => [...document.querySelectorAll(".pg-header button,.pg-header summary,.pg-ribbon button,.pg-table-controls")]
        .filter(node => node.checkVisibility()).filter(node => { const box = node.getBoundingClientRect(); return box.left < -1 || box.right > innerWidth + 1; }).map(node => node.getAttribute("aria-label") ?? node.textContent));
      assert.deepEqual(clippedControls, [], `Workspace controls remain reachable at ${width}`);
      await page.getByRole("button", { name: "Properties", exact: true }).click();
      await page.getByRole("complementary", { name: "Properties", exact: true }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Close properties", exact: true }).click();
      if (width <= 700) {
        await page.getByRole("button", { name: "Layers", exact: true }).click();
        await page.getByRole("complementary", { name: "Data layers", exact: true }).waitFor({ state: "visible" });
        await page.getByRole("button", { name: "Close layers", exact: true }).click();
        await page.getByLabel("Project actions", { exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "Open project", exact: true }).isVisible(), true);
        await page.getByLabel("Project actions", { exact: true }).click();
      }
      if (width === 390) await page.screenshot({ path: resolve(evidence, "playground-mobile.png") });
      const before = await page.locator(".pg-map").boundingBox();
      await page.getByRole("button", { name: "Collapse attributes", exact: true }).click();
      await page.waitForFunction(height => document.querySelector(".pg-map").getBoundingClientRect().height > height, before.height);
      await page.getByRole("button", { name: "Expand attributes", exact: true }).click();
    }
    assert.deepEqual(errors, []);
    console.log("✓ Playground: typed imports, attributes, geometry editing/history, styles, locks, invalid-file rollback, scoped exports, projects, autosave, tab conflicts and responsive panels");
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, "playground-failure.png") }).catch(() => {});
    throw error;
  } finally { await page.close(); }
}
