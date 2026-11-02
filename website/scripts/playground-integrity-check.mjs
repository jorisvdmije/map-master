import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Exercise data-integrity regressions through ordinary controls, files and browser storage. */
export async function checkPlaygroundIntegrity({ browser, origin, evidence, basePath = "/map-master" }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }] } }));
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  const ready = () => page.locator('[data-playground][data-ready="true"]').waitFor();
  const count = n => page.locator(`.pg-workbench[data-feature-count="${n}"]`).waitFor();
  const saved = () => page.locator(".pg-save-state").filter({ hasText: /^Saved locally$/ }).waitFor();
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project", exact: true }).click()]);
    return JSON.parse(readFileSync(await file.path(), "utf8"));
  };
  const open = async project => {
    const replacing = Number(await page.locator(".pg-workbench").getAttribute("data-feature-count")) > 0;
    await page.getByLabel("Open project file", { exact: true }).setInputFiles({ name: "integrity.mapmaster.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true });
    if (replacing) await confirm.click();
  };
  const undo = () => page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click();
  const redo = () => page.locator(".pg-ribbon").getByRole("button", { name: "Redo", exact: true }).click();
  try {
    await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" }); await ready();
    const project = await download(); project.name = "Data integrity boundary"; project.settings.basemap = "blank";
    project.data.features = Array.from({ length: 19_999 }, (_, i) => ({ type: "Feature", id: `boundary-${i}`, properties: i ? {} : { field: "Keep this value", " field ": "Spaced key", "": "Empty key", " ": "Space-only key", " mapMasterLayer ": "User field" }, geometry: { type: "Point", coordinates: [4.8 + (i % 200) * 0.0001, 52.3 + Math.floor(i / 200) * 0.0001] } }));
    await open(project); await count(19_999);
    const row = page.locator('tr[data-feature-key="string:boundary-0"]');
    for (const key of [" field ", "", " ", " mapMasterLayer "]) {
      const before = (await download()).data.features[0].properties;
      const value = `Updated ${JSON.stringify(key)}`;
      await row.getByTitle(`${key}: ${before[key]}`, { exact: true }).click();
      assert.equal(await page.getByRole("dialog").getByLabel("Field name", { exact: true }).inputValue(), key);
      await page.getByRole("dialog").getByLabel("Value", { exact: true }).fill(value);
      await page.getByRole("button", { name: "Save attribute", exact: true }).click();
      const edited = { ...before, [key]: value };
      assert.deepEqual((await download()).data.features[0].properties, edited, "Only the exact imported key changes");
      await undo(); assert.deepEqual((await download()).data.features[0].properties, before);
      await redo(); assert.deepEqual((await download()).data.features[0].properties, edited);
      await row.getByTitle(`${key}: ${value}`, { exact: true }).click();
      await page.getByRole("button", { name: "Delete field", exact: true }).click();
      const removed = { ...edited }; delete removed[key];
      assert.deepEqual((await download()).data.features[0].properties, removed, "Deletion also preserves every other exact key");
      await undo(); assert.deepEqual((await download()).data.features[0].properties, edited);
    }
    await row.locator(".pg-feature-link").click();
    await page.getByRole("button", { name: "Add attribute", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Field name", { exact: true }).fill(" field ");
    await page.getByRole("button", { name: "Save attribute", exact: true }).click();
    await page.getByRole("dialog").getByRole("alert").filter({ hasText: "already exists" }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

    // Batch growth is disabled if the entire selection does not fit.
    await row.locator('input[type="checkbox"]').check();
    await page.locator('tr[data-feature-key="string:boundary-1"] input[type="checkbox"]').check();
    const duplicate = page.locator('.mm-toolbar-button[data-tool="duplicate"]');
    assert.equal(await duplicate.isDisabled(), true);
    await row.locator(".pg-feature-link").click(); assert.equal(await duplicate.isDisabled(), false);
    await duplicate.click(); await count(20_000);
    assert.equal(await duplicate.isDisabled(), true);
    for (const tool of ["point", "text", "line", "polygon", "rectangle", "circle", "ellipse", "freehand", "template"]) assert.equal(await page.locator(`.mm-toolbar-button[data-tool="${tool}"]`).isDisabled(), true, `${tool} cannot grow a full project`);
    await page.locator(".pg-statusbar").filter({ hasText: "limit reached" }).waitFor();
    const full = await download(); assert.equal(full.data.features.length, 20_000);
    await page.locator('.mm-toolbar-button[data-tool="delete"]').click(); await count(19_999);
    await undo(); await count(20_000); await redo(); await count(19_999); await undo(); await count(20_000);
    await saved(); await page.reload({ waitUntil: "networkidle" }); await ready(); await count(20_000); await saved();
    assert.equal(await page.getByRole("heading", { name: "Keep your saved copy." }).count(), 0);
    assert.deepEqual((await download()).data, full.data, "Autosave remains readable at the exact limit");
    await open(full); await count(20_000); assert.deepEqual((await download()).data, full.data, "Downloaded projects also round-trip at the limit");
    await page.screenshot({ path: resolve(evidence, "playground-integrity.png") });
    assert.deepEqual(errors, []);
    console.log("✓ Playground integrity: exact attribute keys, edit/delete history, atomic batch capacity, 19,999/20,000 boundary and project/autosave restore");
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, "playground-integrity-failure.png") }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
