import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Resize a live draft, then leave and remount the workbench through Next navigation. */
export async function checkPlaygroundResize({ browser, origin, evidence, basePath = "/map-master" }) {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor });
    await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
    const page = await context.newPage(); const errors = []; let phase = "mount";
    page.on("pageerror", error => errors.push({ phase, message: error.message }));
    page.on("dialog", dialog => dialog.accept());
    const ready = () => page.locator('[data-playground][data-ready="true"]').waitFor();
    const count = value => page.locator(`.pg-workbench[data-feature-count="${value}"]`).waitFor();
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const aligned = async () => {
      await page.waitForFunction(() => {
        const map = document.querySelector(".pg-map"); const canvas = map.querySelector("canvas");
        const a = map.getBoundingClientRect(); const b = document.querySelector(".pg-map-frame").getBoundingClientRect();
        return [a.left - b.left, a.top - b.top, a.width - b.width, a.height - b.height].every(value => Math.abs(value) < 1)
          && Math.abs(canvas.width - map.clientWidth * devicePixelRatio) <= 1 && Math.abs(canvas.height - map.clientHeight * devicePixelRatio) <= 1;
      });
      await frames(); assert.deepEqual(errors, [], `No browser errors during ${phase}`);
    };
    const project = async () => {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save project", exact: true }).click()]);
      return JSON.parse(readFileSync(await download.path(), "utf8"));
    };
    try {
      await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" }); await ready(); await aligned();
      const canvas = page.locator(".pg-map canvas");
      await page.locator('.mm-toolbar-button[data-tool="polygon"]').click();
      const box = await canvas.boundingBox();
      for (const [x, y] of [[0.35, 0.48], [0.7, 0.48]]) await canvas.click({ position: { x: box.width * x, y: box.height * y } });
      for (const [width, height] of [[320, 568], [568, 320], [390, 844], [844, 390], [768, 1024], [1440, 1050], [1280, 800]]) {
        phase = `viewport ${width}×${height} at DPR ${deviceScaleFactor}`;
        await page.setViewportSize({ width, height }); await aligned();
        for (const columns of [1, 2]) {
          await page.getByLabel("Toolbar columns", { exact: true }).selectOption(String(columns));
          for (const name of ["Collapse attributes", "Expand attributes"]) {
            phase = `${name} at ${width}×${height}, ${columns} column(s), DPR ${deviceScaleFactor}`;
            await page.getByRole("button", { name, exact: true }).click(); await aligned();
          }
        }
        assert.equal(await page.locator(".pg-workbench").getAttribute("data-mode"), "draw-polygon", "Resizing preserves the active draft");
        await count(0); assert.equal(await page.getByRole("button", { name: "Finish", exact: true }).isDisabled(), true);
      }
      await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.75 } });
      await page.getByRole("button", { name: "Finish", exact: true }).click(); await count(1);
      const saved = await project(); assert.equal(saved.data.features[0].geometry.type, "Polygon");
      assert.equal(saved.data.features[0].geometry.coordinates[0].length, 4, "Both original draft vertices survive resizing");
      await page.locator(".pg-ribbon").getByRole("button", { name: "Undo", exact: true }).click(); await count(0);
      await page.locator(".pg-ribbon").getByRole("button", { name: "Redo", exact: true }).click(); await count(1);
      assert.deepEqual((await project()).data, saved.data, "The resized draft commits as one exact history step");
      await page.locator(".pg-save-state").filter({ hasText: /^Saved locally$/ }).waitFor();
      // Queue a resize and navigate in the same task; leaving must dispose the
      // map even while work is pending, without later writes to a detached map.
      phase = "navigation cleanup";
      await page.evaluate(() => {
        const canvas = document.querySelector(".pg-map canvas");
        window.__playgroundResize = { canvas, gl: canvas.getContext("webgl2") };
        window.dispatchEvent(new Event("resize")); document.querySelector(".pg-brand").click();
      });
      await page.waitForURL(`${origin}${basePath}/`);
      await page.waitForFunction(() => window.__playgroundResize.gl.isContextLost());
      assert.equal(await page.evaluate(() => window.__playgroundResize.canvas.isConnected), false);
      assert.equal(await page.locator("[data-playground]").count(), 0);
      await page.evaluate(() => window.dispatchEvent(new Event("resize"))); await frames(); assert.deepEqual(errors, []);
      phase = "remount";
      await page.goBack(); await ready(); await count(1); await aligned();
      assert.equal(await page.evaluate(() => document.querySelector(".pg-map canvas") === window.__playgroundResize.canvas), false);
      assert.deepEqual((await project()).data, saved.data, "Navigation restores the saved geometry exactly");
      await page.setViewportSize({ width: 390, height: 844 }); await aligned();
      await page.getByRole("button", { name: "Collapse attributes", exact: true }).click(); await aligned();
    } catch (error) {
      await page.screenshot({ path: resolve(evidence, `playground-resize-failure-dpr-${deviceScaleFactor}.png`) }).catch(() => {}); throw error;
    } finally { await context.close(); }
  }
  console.log("✓ Playground resize: portrait/landscape breakpoints, table/toolbar layouts, DPR 1/2 canvases, draft/history preservation and navigation cleanup/remount without browser errors");
}
