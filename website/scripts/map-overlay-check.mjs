import assert from "node:assert/strict";
import { resolve } from "node:path";

/** Map vendor overlays must stay behind site navigation, even during scrolling. */
export async function checkMapOverlays({ browser, origin, evidence, basePath = "/map-master" }) {
  const context = await browser.newContext();
  await context.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    for (const [width, height] of [[1280, 800], [390, 844], [320, 568]]) for (const path of ["guides/markers/", ""]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${origin}${basePath}/${path}`, { waitUntil: "networkidle" });
      const map = page.locator(".demo-map").first(); await map.scrollIntoViewIfNeeded();
      await page.locator('[data-demo][data-ready="true"]').first().waitFor();
      await page.evaluate(() => window.scrollBy(0, document.querySelector(".demo-map").getBoundingClientRect().top - 20));
      const box = await map.boundingBox(); const header = await page.locator(".topbar").boundingBox();
      await page.mouse.move(box.x + box.width / 2, header.height + 60);
      await page.mouse.wheel(0, 40);
      const help = page.locator(".maplibregl-cooperative-gesture-screen").first();
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".maplibregl-cooperative-gesture-screen")).opacity) > 0.5);
      // Keep opacity visible after the real wheel event has opened the hint, so
      // the library's short dismissal timer cannot race the later assertions.
      await help.evaluate(element => { element.style.opacity = "1"; element.style.transition = "none"; });
      assert.equal(await page.evaluate(() => {
        const map = document.querySelector(".demo-map").getBoundingClientRect();
        const header = document.querySelector(".topbar"); const bounds = header.getBoundingClientRect();
        const hint = document.querySelector(".maplibregl-cooperative-gesture-screen");
        // The hint normally ignores hit-testing. Temporarily include it so this
        // probes its paint order, not just whether the header still takes clicks.
        const previous = hint.style.pointerEvents; hint.style.pointerEvents = "auto";
        const hit = document.elementFromPoint(map.left + map.width / 2, bounds.height / 2);
        hint.style.pointerEvents = previous;
        return header.contains(hit);
      }), true, `The header stays above the visible wheel hint at ${width}px`);
      assert.equal(await help.evaluate(element => {
        const map = element.closest(".demo-map").getBoundingClientRect();
        const message = element.querySelector(".maplibregl-desktop-message").getBoundingClientRect();
        return message.left >= map.left && message.right <= map.right;
      }), true, "Gesture instructions wrap inside the narrow map");
      // The hint must never prevent native zoom controls or toolbar interaction.
      const zoom = page.locator(".maplibregl-ctrl-zoom-in").first(); await zoom.scrollIntoViewIfNeeded();
      assert.equal(await zoom.evaluate(element => {
        const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      }), true, "Wheel hint leaves zoom controls clickable");
      await zoom.click();
      await page.locator(".search-trigger").click();
      await page.waitForFunction(() => document.querySelector(".search-dialog").open);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".search-dialog").open);
      if (width <= 700) {
        await page.getByRole("button", { name: "Open navigation", exact: true }).click();
        await page.waitForFunction(() => Math.abs(document.querySelector(".sidebar").getBoundingClientRect().left) < 1);
        assert.equal(await page.locator(".sidebar").evaluate(element => {
          const r = element.getBoundingClientRect(); const hint = document.querySelector(".maplibregl-cooperative-gesture-screen");
          const previous = hint.style.pointerEvents; hint.style.pointerEvents = "auto";
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 60); hint.style.pointerEvents = previous;
          return element.contains(hit);
        }), true, "Mobile navigation stays above the map and its hint");
        await page.keyboard.press("Escape");
      }
      if (evidence) await page.screenshot({ path: resolve(evidence, `map-overlay-${path ? "guide" : "home"}-${width}.png`) });
      assert.equal(await help.evaluate(element => element.getAttribute("aria-hidden")), "true");
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
  console.log("✓ Map overlays: real wheel hints stay below the header/mobile navigation and leave controls clickable at desktop and narrow widths");
}
