import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export async function checkPlaygroundStorage({ browser, origin, basePath = "/map-master" }) {
  for (const scenario of ["recovery", "quota"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }] }) }));
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    const stored = () => page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open("map-master-playground", 1);
      open.onerror = () => reject(new Error("Cannot inspect project storage"));
      open.onsuccess = () => {
        const database = open.result; const request = database.transaction("projects", "readonly").objectStore("projects").get("current");
        request.onsuccess = () => { resolve(request.result); database.close(); };
        request.onerror = () => { database.close(); reject(new Error("Cannot read project storage")); };
      };
    }));
    try {
      await page.goto(`${origin}${basePath}/playground/`, { waitUntil: "networkidle" });
      await page.locator('[data-ready="true"]').waitFor();
      await page.locator(".pg-save-state").filter({ hasText: /^Saved locally$/ }).waitFor();
      if (scenario === "recovery") {
        await page.evaluate(() => new Promise((resolve, reject) => {
          const open = indexedDB.open("map-master-playground", 1);
          open.onerror = () => reject(new Error("Cannot seed recovery project"));
          open.onsuccess = () => {
            const database = open.result; const transaction = database.transaction("projects", "readwrite");
            transaction.objectStore("projects").put({ key: "current", revision: 20, project: { format: "map-master-playground", version: 999, important: "Keep this saved copy" } });
            transaction.oncomplete = () => { database.close(); resolve(); };
            transaction.onerror = () => { database.close(); reject(new Error("Cannot seed recovery project")); };
          };
        }));
        await page.reload({ waitUntil: "networkidle" }); await page.locator('[data-ready="true"]').waitFor();
        await page.getByRole("heading", { name: "Keep your saved copy." }).waitFor();
        assert.equal((await stored()).project.important, "Keep this saved copy");
        const pending = page.waitForEvent("download");
        await page.getByRole("button", { name: "Download saved copy", exact: true }).click();
        assert.equal(JSON.parse(readFileSync(await (await pending).path(), "utf8")).important, "Keep this saved copy");
        await page.getByRole("button", { name: "Start a new project", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Open project", exact: true }).click();
        await page.locator(".pg-save-state").filter({ hasText: /^Saved locally$/ }).waitFor();
        assert.equal((await stored()).project.version, 1);
      } else {
        const before = await stored();
        await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException("Simulated storage quota", "QuotaExceededError"); }; });
        await page.getByRole("button", { name: "Or explore the sample project" }).click();
        await page.locator('.pg-workbench[data-feature-count="6"]').waitFor();
        await page.getByRole("alert").filter({ hasText: /Local saving failed/ }).waitFor();
        assert.equal(await page.locator(".pg-save-state").innerText(), "Local save paused");
        assert.deepEqual(await stored(), before, "A failed save preserves the saved copy");
        const pending = page.waitForEvent("download");
        await page.getByRole("button", { name: "Save project", exact: true }).click();
        assert.equal(JSON.parse(readFileSync(await (await pending).path(), "utf8")).data.features.length, 6, "Unsaved work is still downloadable");
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log("✓ Playground storage: corrupt projects stay recoverable; quota failures preserve both saved data and downloadable work");
}
