import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Check actual hit targets: a visible button must not activate a different control. */
export async function checkPlaygroundMobile({ browser, origin, evidence, basePath = "/map-master" }) {
  const diagnostics = [];
  const sizes = [[320, 568], [320, 540], [568, 320], [844, 390], [390, 844], [768, 1024], [1280, 800], [1440, 1050]];
  const open = async (width, height) => {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }] } }));
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", error => {
      // Separately tracked in the playground review; keep all other errors fatal.
      if (browser.browserType().name() === "webkit" && error.message === "ResizeObserver loop completed with undelivered notifications.") diagnostics.push({ width, height, message: error.message });
      else errors.push(error.message);
    }); page.on("dialog", dialog => dialog.accept());
    await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" }); await page.locator('[data-playground][data-ready="true"]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  };
  const settled = async page => {
    await page.waitForFunction(() => {
      const a = document.querySelector(".pg-map").getBoundingClientRect(); const b = document.querySelector(".pg-map-frame").getBoundingClientRect();
      return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const hit = async (locator, name) => {
    assert.equal(await locator.evaluate(element => {
      const box = element.getBoundingClientRect(); const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && element.contains(target);
    }), true, `${name} has an unobstructed center inside the viewport`);
  };
  const welcome = async page => {
    // The workspace can be taller than a short landscape viewport. Normal page
    // scrolling must be allowed to reveal the card after visiting the table.
    await page.locator(".pg-empty-card").scrollIntoViewIfNeeded();
    await hit(page.getByRole("button", { name: "Or explore the sample project" }), "Sample project button");
    await hit(page.getByRole("button", { name: "Import GeoJSON", exact: true }), "Import button");
    assert.equal(await page.locator(".pg-empty-card").evaluate(card => {
      const a = card.getBoundingClientRect(); const b = document.querySelector(".pg-map").getBoundingClientRect();
      return a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom;
    }), true, "The welcome card stays inside the map");
  };
  const drawers = async (page, width) => {
    for (const name of ["Properties", "Layers"]) {
      if (width > (name === "Properties" ? 1000 : 700)) continue;
      await page.getByRole("button", { name, exact: true }).click();
      const panel = page.locator(name === "Properties" ? ".pg-inspector" : ".pg-layers");
      assert.equal(await panel.evaluate(element => {
        const box = element.getBoundingClientRect(); const map = document.querySelector(".pg-map-frame").getBoundingClientRect();
        return box.width >= 200 && box.left >= 0 && box.right <= innerWidth && Math.abs(box.top - map.top) < 1 && Math.abs(box.bottom - map.bottom) < 1;
      }), true, `${name} drawer uses the map area instead of its desktop grid cell`);
      const close = page.getByRole("button", { name: `Close ${name.toLowerCase()}`, exact: true });
      await hit(close, `Close ${name.toLowerCase()}`); await close.click();
      assert.equal(await panel.isVisible(), false);
    }
  };
  for (const [width, height] of sizes) for (const columns of [2, 1]) {
    const { context, page, errors } = await open(width, height);
    try {
      await page.getByLabel("Toolbar columns", { exact: true }).selectOption(String(columns)); await settled(page); await welcome(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const name of ["Measurements", "Scale borders with zoom"]) {
        const checkbox = page.getByRole("checkbox", { name, exact: true }); const label = checkbox.locator("..");
        await hit(label, name); const box = await label.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); assert.equal(await checkbox.isChecked(), true);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); assert.equal(await checkbox.isChecked(), false);
      }
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Import GeoJSON", exact: true }).click()]); await chooser.setFiles([]);
      await page.getByRole("button", { name: "Collapse attributes", exact: true }).click(); await settled(page); await welcome(page);
      await page.getByRole("button", { name: "Expand attributes", exact: true }).click(); await settled(page); await welcome(page);
      if (columns === 2 && [320, 568, 1440].includes(width)) await page.screenshot({ path: resolve(evidence, `playground-welcome-${width}x${height}.png`) });
      // The welcome region must stop intercepting the map as soon as drawing starts.
      await page.locator('.mm-toolbar-button[data-tool="point"]').click(); await page.locator('.pg-workbench[data-mode="draw-point"]').waitFor();
      assert.equal(await page.locator(".pg-empty-card").count(), 0);
      const canvas = page.locator(".pg-map canvas"); const box = await canvas.boundingBox();
      await canvas.click({ position: { x: box.width * 0.58, y: box.height * 0.5 } }); await page.locator('.pg-workbench[data-feature-count="1"]').waitFor();
      await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click(); await page.locator('.pg-workbench[data-feature-count="0"]').waitFor();
      await settled(page); await welcome(page);
      const sample = await page.getByRole("button", { name: "Or explore the sample project" }).boundingBox();
      await page.mouse.click(sample.x + sample.width / 2, sample.y + sample.height / 2); await page.locator('.pg-workbench[data-feature-count="6"]').waitFor();
      assert.equal(await page.getByRole("checkbox", { name: "Measurements", exact: true }).isChecked(), false, "The sample click cannot toggle Measurements");
      assert.equal(await page.getByRole("checkbox", { name: "Scale borders with zoom", exact: true }).isChecked(), false);
      await drawers(page, width);
      await page.getByRole("button", { name: "Collapse attributes", exact: true }).click(); await settled(page); await drawers(page, width);
      await page.getByRole("button", { name: "Expand attributes", exact: true }).click(); await settled(page);
      assert.deepEqual(errors, []);
    } catch (error) {
      await page.screenshot({ path: resolve(evidence, `playground-welcome-failure-${width}x${height}-${columns}.png`) }).catch(() => {}); throw error;
    } finally { await context.close(); }
  }
  // A tall recovery message must remain scrollable, with its real actions reachable.
  for (const [width, height] of [[320, 568], [844, 390]]) {
    const { context, page, errors } = await open(width, height);
    try {
      await page.locator(".pg-save-state").filter({ hasText: /^Saved locally$/ }).waitFor();
      await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open("map-master-playground", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result; const tx = db.transaction("projects", "readwrite");
          tx.objectStore("projects").put({ key: "current", revision: 20, project: { version: 999, important: "Preserve this recovery copy" } });
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
        };
      }));
      await page.reload({ waitUntil: "networkidle" }); await page.getByRole("heading", { name: "Keep your saved copy." }).waitFor(); await settled(page);
      const download = page.getByRole("button", { name: "Download saved copy", exact: true }); await download.scrollIntoViewIfNeeded(); await hit(download, "Download recovery copy");
      const [file] = await Promise.all([page.waitForEvent("download"), download.click()]); assert.equal(JSON.parse(readFileSync(await file.path(), "utf8")).important, "Preserve this recovery copy");
      const restart = page.getByRole("button", { name: "Start a new project", exact: true }); await restart.scrollIntoViewIfNeeded(); await hit(restart, "Start a new project"); await restart.click();
      await page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true }).click(); await settled(page); await welcome(page); assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log("✓ Playground mobile: unobstructed real clicks, both column layouts, short/landscape maps, table resizing, drawing, drawers and recovery controls");
  if (diagnostics.length) console.warn(`Known WebKit ResizeObserver diagnostic: ${diagnostics.length} occurrences (tracked separately from welcome hit targets).`);
  return { diagnostics };
}
