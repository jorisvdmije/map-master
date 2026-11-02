import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export async function checkPlaygroundAttributeDrafts({ browser, origin, evidence, basePath = "/map-master" }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }] } }));
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  const properties = { numeric: 12, flag: false, nested: { original: [1, null] }, text: "Original text" };
  const display = value => typeof value === "string" ? value : JSON.stringify(value);
  const row = page.locator('tr[data-feature-key="string:draft"]');
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project", exact: true }).click()]);
    return JSON.parse(readFileSync(await file.path(), "utf8"));
  };
  const stored = async () => (await download()).data.features[0].properties;
  const undo = () => page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click();
  const redo = () => page.locator(".pg-ribbon").getByRole("button", { name: "Redo", exact: true }).click();
  const cells = async expected => {
    for (const key of [...Object.keys(properties), "new_field"]) {
      if (Object.hasOwn(expected, key)) await row.getByTitle(`${key}: ${display(expected[key])}`, { exact: true }).waitFor();
      else await row.locator(`.pg-cell[title^="${key}:"]`).waitFor({ state: "detached" });
    }
  };
  const edit = async key => {
    await row.getByTitle(`${key}: ${display(properties[key])}`, { exact: true }).click();
  };
  const dialog = page.getByRole("dialog"); const value = dialog.getByLabel("Value", { exact: true });
  const save = () => dialog.getByRole("button", { name: "Save attribute", exact: true }).click();
  const type = async next => dialog.getByLabel("Value type", { exact: true }).selectOption(next);
  try {
    await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" }); await page.locator('[data-playground][data-ready="true"]').waitFor();
    await page.getByLabel("Import GeoJSON files", { exact: true }).setInputFiles({ name: "drafts.geojson", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ type: "Feature", id: "draft", properties, geometry: { type: "Point", coordinates: [4.895, 52.372] } })) });
    await page.locator('.pg-workbench[data-feature-count="1"]').waitFor();
    await page.locator('tr[data-feature-key="string:draft"] .pg-feature-link').click();
    const original = await stored();
    const json = '{ "updated": [true, null, {"x": 3}] }';
    for (const scenario of [
      { key: "numeric", raw: "999", types: ["string", "null", "number", "string"], expected: "999" },
      { key: "numeric", raw: "007", types: ["string", "number"], expected: 7 },
      { key: "flag", raw: "true", types: ["string", "null", "boolean"], expected: true },
      { key: "nested", raw: json, types: ["string", "null", "json"], expected: JSON.parse(json) },
      { key: "text", raw: "Keep this draft", types: ["boolean", "null", "string"], expected: "Keep this draft" },
      { key: "text", raw: "Temporary text", types: ["null"], expected: null },
      { key: "new_field", raw: "42", types: ["number", "null", "number"], expected: 42, add: true },
    ]) {
      if (scenario.add) {
        await page.getByRole("button", { name: "Add attribute", exact: true }).click();
        await dialog.getByLabel("Field name", { exact: true }).fill(scenario.key);
      } else await edit(scenario.key);
      if (scenario.key === "flag") await value.selectOption(scenario.raw); else await value.fill(scenario.raw);
      for (const next of scenario.types) {
        await type(next);
        const displayed = next === "null" ? "null" : next === "boolean" && !["true", "false"].includes(scenario.raw) ? "" : scenario.raw;
        assert.equal(await value.inputValue(), displayed, `Keep ${scenario.key}'s pending value when changing to ${next}`);
        assert.equal(await value.isDisabled(), next === "null");
      }
      await save(); const expected = { ...original, [scenario.key]: scenario.expected };
      assert.deepEqual(await stored(), expected, "Convert only when saving, preserving other attributes");
      await undo(); await cells(original);
      await redo(); await cells(expected);
      await undo(); await cells(original);
    }
    for (const scenario of [
      { key: "text", raw: "not a number", target: "number", message: "finite number" },
      { key: "text", raw: "not a boolean", target: "boolean", message: "true or false" },
      { key: "nested", raw: '{"unfinished":', target: "json", message: null },
    ]) {
      await edit(scenario.key); await value.fill(scenario.raw); await type("string"); await type(scenario.target); await save();
      const alert = dialog.getByRole("alert"); await alert.waitFor();
      if (scenario.message) assert.ok((await alert.textContent()).includes(scenario.message));
      await type("string"); assert.equal(await value.inputValue(), scenario.raw, "Invalid conversions retain the pending input");
      assert.equal(await dialog.getByRole("alert").count(), 0, "Changing the type clears an obsolete error");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.deepEqual(await stored(), original, "Invalid or cancelled edits leave committed values untouched");
    }
    // Every successful edit was undone; failed/cancelled edits cannot add history.
    await undo(); await page.locator('.pg-workbench[data-feature-count="0"]').waitFor();
    await redo(); await page.locator('.pg-workbench[data-feature-count="1"]').waitFor(); assert.deepEqual(await stored(), original);
    await page.screenshot({ path: resolve(evidence, "playground-attribute-drafts.png") }); assert.deepEqual(errors, []);
    console.log("✓ Playground attribute drafts: all type switches preserve pending input; typed saves, invalid conversions, cancellation and exact history");
  } catch (error) {
    await page.screenshot({ path: resolve(evidence, "playground-attribute-drafts-failure.png") }).catch(() => {}); throw error;
  } finally { await context.close(); }
}
