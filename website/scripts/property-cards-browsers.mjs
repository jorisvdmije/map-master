import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { createStaticServer } from "./lib/static-server.mjs";
import { checkFeaturePreviews } from "./feature-preview-check.mjs";
import { checkHoverSettings } from "./hover-settings-check.mjs";

const site = resolve(import.meta.dirname, "..");
const { basePath } = JSON.parse(
  readFileSync(resolve(site, "dist/.build-info.json")),
);
const server = createStaticServer({
  directory: resolve(site, "dist"),
  basePath,
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browsers = { chromium, firefox, webkit };
// Extra southern vertices put the vertex average away from the midpoint of
// the complete object's extent, catching an accidental centroid-by-average.
const polygon = {
  type: "Feature",
  id: "park",
  properties: {
    name: "Test park",
    status: "Open",
    details: { text: "<img src=x onerror=alert(1)>" },
  },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [4.88, 52.36],
        [4.89, 52.36],
        [4.9, 52.36],
        [4.91, 52.36],
        [4.91, 52.38],
        [4.88, 52.38],
        [4.88, 52.36],
      ],
    ],
  },
};
const objectCenter = [4.895, 52.37];
const upload = {
  name: "park.geojson",
  mimeType: "application/geo+json",
  buffer: Buffer.from(JSON.stringify(polygon)),
};
const repaint = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

async function projectCamera(page) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  return JSON.parse(readFileSync(await file.path(), "utf8")).camera;
}

// Read the public project export instead of exposing MapLibre for tests.
// The playground has zero pitch and rotation.
function projectedPoint(coordinate, camera, map) {
  const mercatorY = (latitude) => {
    const sine = Math.sin((latitude * Math.PI) / 180);
    return (1 - Math.log((1 + sine) / (1 - sine)) / (2 * Math.PI)) / 2;
  };
  const world = 512 * 2 ** camera.zoom;
  return {
    x:
      map.x +
      map.width / 2 +
      ((coordinate[0] - camera.center[0]) / 360) * world,
    y:
      map.y +
      map.height / 2 +
      (mercatorY(coordinate[1]) - mercatorY(camera.center[1])) * world,
  };
}

async function expectObjectCenter(page, camera, coordinate = objectCenter) {
  const map = await page.locator(".pg-map canvas").boundingBox();
  const card = await page.locator(".mm-property-overlay").boundingBox();
  const anchor = projectedPoint(coordinate, camera, map);
  const expected = {
    x: Math.max(
      map.x + 8,
      Math.min(anchor.x - card.width / 2, map.x + map.width - card.width - 8),
    ),
    y: Math.max(
      map.y + 8,
      Math.min(
        anchor.y - card.height / 2,
        map.y + map.height - card.height - 8,
      ),
    ),
  };
  assert.ok(
    Math.abs(card.x - expected.x) < 2,
    `Card follows object's longitude: ${card.x} ≈ ${expected.x}`,
  );
  assert.ok(
    Math.abs(card.y - expected.y) < 2,
    `Card follows object's latitude: ${card.y} ≈ ${expected.y}`,
  );
  return { map, card, anchor };
}

async function panBackground(page, dx, dy) {
  const map = await page.locator(".pg-map canvas").boundingBox();
  const start = { x: map.x + map.width / 2, y: map.y + map.height - 30 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  // Pause while still holding to avoid momentum after releasing the drag.
  await page.waitForTimeout(200);
  await page.mouse.up();
  await repaint(page);
}

try {
  for (const name of process.argv.slice(2).length
    ? process.argv.slice(2)
    : Object.keys(browsers)) {
    const browser = await browsers[name].launch({
      headless:
        (process.env.GEO_DOCS_HEADED ?? process.env.GEO_COMPAT_HEADED) !== "1",
      ...(name === "chromium" ? { args: ["--enable-unsafe-swiftshader"] } : {}),
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      await context.route("https://tiles.openfreemap.org/**", (route) =>
        route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
      );
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("dialog", (dialog) => dialog.accept());
      const overlay = page.locator(".mm-property-overlay"),
        card = page.locator(".mm-feature-preview");
      const viewportCenter = async (selector) => {
        const map = await page.locator(selector).boundingBox(),
          box = await overlay.boundingBox();
        assert.ok(
          Math.abs(box.x + box.width / 2 - map.x - map.width / 2) < 2,
          "Hover card is horizontally centered in the viewport",
        );
        assert.ok(
          Math.abs(box.y + box.height / 2 - map.y - map.height / 2) < 2,
          "Hover card is vertically centered in the viewport",
        );
      };
      await page.goto(`${origin}${basePath}/playground/`);
      await page.locator('[data-playground][data-ready="true"]').waitFor();
      await page
        .getByLabel("Import GeoJSON files", { exact: true })
        .setInputFiles(upload);
      await page.locator('.pg-workbench[data-feature-count="1"]').waitFor();
      const display = page.getByLabel("Property display", { exact: true });
      const map = await page.locator(".pg-map canvas").boundingBox();
      const point = {
        x: map.x + map.width / 2 - 40,
        y: map.y + map.height / 2,
      };
      await page.mouse.move(point.x, point.y);
      await card.waitFor();
      const first = await overlay.boundingBox();
      await page.mouse.move(point.x + 20, point.y);
      await page.waitForFunction(
        (x) =>
          Math.abs(
            document
              .querySelector(".mm-property-overlay")
              .getBoundingClientRect().x - x,
          ) > 10,
        first.x,
      );
      assert.equal(
        await card.locator("h3").textContent(),
        "Test park",
        "Still the same polygon while following",
      );
      assert.equal(
        await overlay.evaluate(
          (element) => getComputedStyle(element).pointerEvents,
        ),
        "none",
      );
      const compact = await overlay.evaluate((element) => {
        const box = getComputedStyle(element),
          content = getComputedStyle(
            element.querySelector(".mm-feature-preview"),
          );
        return {
          width: element.getBoundingClientRect().width,
          background: box.backgroundColor,
          padding: parseFloat(content.paddingTop),
          textOpacity: content.opacity,
        };
      });
      assert.ok(
        compact.width <= 250,
        "Properties are narrower than the previous 300px card",
      );
      assert.ok(compact.padding <= 10, "Property rows use compact spacing");
      const alpha = Number(
        compact.background.match(/[,/]\s*([\d.]+)\s*\)$/)?.[1] ?? 1,
      );
      assert.ok(
        alpha >= 0.75 && alpha <= 0.9,
        `Card background is translucent by default: ${compact.background}`,
      );
      assert.equal(
        compact.textOpacity,
        "1",
        "Transparency applies to the background, keeping text readable",
      );

      await display.selectOption("fixed");
      await page.mouse.move(point.x, point.y);
      await card.waitFor();
      await viewportCenter(".pg-map canvas");
      const fixed = await overlay.boundingBox();
      await page.mouse.move(point.x + 20, point.y + 20);
      await repaint(page);
      assert.deepEqual(
        await overlay.boundingBox(),
        fixed,
        "Center on hover remains fixed while the cursor moves",
      );
      assert.equal(
        await display.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            ) === element
          );
        }),
        true,
        "Display selector is not covered by basemap controls",
      );

      await display.selectOption("click");
      await page.mouse.move(point.x, point.y);
      await repaint(page);
      assert.equal(await card.count(), 0, "Click-only mode has no hover card");
      // Move the object away from the viewport center to catch the old behavior.
      await panBackground(page, 65, -40);
      const beforeClick = await projectCamera(page);
      const beforeMap = await page.locator(".pg-map canvas").boundingBox();
      const anchor = projectedPoint(objectCenter, beforeClick, beforeMap);
      assert.ok(
        Math.abs(anchor.x - beforeMap.x - beforeMap.width / 2) > 30,
        "Object is deliberately off-center",
      );
      const click = { x: anchor.x - 105, y: anchor.y + 45 };
      await page.mouse.click(click.x, click.y);
      await page.locator('.mm-property-overlay[data-pinned="true"]').waitFor();
      assert.deepEqual(
        await projectCamera(page),
        beforeClick,
        "Clicking an object preserves the camera",
      );
      const pinned = await expectObjectCenter(page, beforeClick);
      assert.ok(
        Math.abs(pinned.card.x + pinned.card.width / 2 - click.x) > 80,
        "Card centers on the object, not the click position",
      );
      await page.mouse.move(20, 20);
      assert.equal(
        await card.isVisible(),
        true,
        "Pinned card survives pointer exit",
      );
      assert.equal(
        await overlay.evaluate(
          (element) => getComputedStyle(element).pointerEvents,
        ),
        "auto",
      );
      assert.equal(await card.locator("img,script").count(), 0);
      assert.equal(await card.locator("p").count(), 0, "No technical geometry/ID caption");
      assert.equal(await card.locator("small").count(), 0, "No click or Escape instruction footer");

      await panBackground(page, -45, 25);
      const afterPan = await projectCamera(page);
      assert.notDeepEqual(
        afterPan,
        beforeClick,
        "Background drag moves the map",
      );
      const moved = await expectObjectCenter(page, afterPan);
      assert.ok(
        Math.abs(moved.card.x - pinned.card.x) > 20,
        "Pinned properties move with the object during map navigation",
      );
      await page
        .getByRole("button", { name: "Sluit eigenschappen", exact: true })
        .click();
      await card.waitFor({ state: "detached" });
      // A second point in the same polygon must produce the same anchor.
      const secondClick = { x: moved.anchor.x + 95, y: moved.anchor.y - 40 };
      await page.mouse.click(secondClick.x, secondClick.y);
      await card.waitFor();
      await expectObjectCenter(page, afterPan);
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      await page.mouse.click(secondClick.x, secondClick.y);
      await card.waitFor();

      const evidence = resolve(site, `../artifacts/properties/${name}`);
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({
        path: resolve(evidence, "object-center-desktop.png"),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector(".pg-map canvas"),
          frame = document.querySelector(".pg-map-frame");
        return (
          canvas.clientWidth === frame.clientWidth &&
          canvas.clientHeight === frame.clientHeight
        );
      });
      await repaint(page);
      const mobileCamera = await projectCamera(page);
      const mobile = await expectObjectCenter(page, mobileCamera);
      assert.ok(
        mobile.card.height <= mobile.map.height - 16 &&
          mobile.card.width <= mobile.map.width - 16,
        "Mobile card remains within the map",
      );
      await page.screenshot({
        path: resolve(evidence, "object-center-mobile.png"),
      });
      await display.selectOption("off");
      assert.equal(await card.count(), 0);

      // The free explorer uses original source data for the same interaction.
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${origin}${basePath}/analysis/`);
      await page.locator('[data-analysis][data-ready="true"]').waitFor();
      const guide = page.getByRole("dialog");
      if (await guide.count()) await page.keyboard.press("Escape");
      await page
        .getByLabel("Import analysis data", { exact: true })
        .setInputFiles(upload);
      await page.locator('.an-workbench[data-matches="1"]').waitFor();
      await page
        .locator('.an-map-host[data-feature-count="1"][aria-busy="false"]')
        .waitFor();
      await page
        .getByLabel("Property display", { exact: true })
        .selectOption("click");
      const free = await page.locator(".an-map-host canvas").boundingBox();
      await page.mouse.click(
        free.x + free.width / 2 - 85,
        free.y + free.height / 2 + 35,
      );
      await card.waitFor();
      assert.equal(await card.locator("h3").textContent(), "Test park");
      await viewportCenter(".an-map-host canvas");
      assert.equal(await card.locator("p,small").count(), 0, "Analysis has no technical caption or instruction footer");
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      // An unnamed source retains its actual fields without an implicit ID title.
      await page.getByLabel("Import analysis data", { exact: true }).setInputFiles({
        ...upload,
        buffer: Buffer.from(JSON.stringify({ ...polygon, properties: { status: "Open", id: "actual ID field" } })),
      });
      await page.locator('.an-map-host[data-feature-count="1"][aria-busy="false"]').waitFor();
      await page.mouse.click(free.x + free.width / 2 - 85, free.y + free.height / 2 + 35);
      await card.waitFor();
      assert.equal(await card.locator("h3,p,small").count(), 0);
      assert.ok((await card.locator("dd").allTextContents()).includes("actual ID field"), "An ID stored as an actual property remains visible");
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      await context.close();

      // A real touch tap needs no synthetic mouse hover first.
      const touch = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      await touch.route("https://tiles.openfreemap.org/**", (route) =>
        route.fulfill({ json: { version: 8, sources: {}, layers: [] } }),
      );
      const touchPage = await touch.newPage();
      touchPage.on("dialog", (dialog) => dialog.accept());
      await touchPage.goto(`${origin}${basePath}/playground/`);
      await touchPage.locator('[data-playground][data-ready="true"]').waitFor();
      await touchPage
        .getByLabel("Import GeoJSON files", { exact: true })
        .setInputFiles(upload);
      await touchPage
        .locator('.pg-workbench[data-feature-count="1"]')
        .waitFor();
      await touchPage
        .getByLabel("Property display", { exact: true })
        .selectOption("click");
      await repaint(touchPage);
      const target = await touchPage.locator(".pg-map canvas").boundingBox();
      await touchPage.touchscreen.tap(
        target.x + target.width / 2 - 30,
        target.y + target.height / 2,
      );
      await touchPage
        .locator('.mm-property-overlay[data-pinned="true"]')
        .waitFor();
      assert.equal(
        await touchPage.locator(".mm-feature-preview h3").textContent(),
        "Test park",
      );
      await touchPage
        .getByRole("button", { name: "Sluit eigenschappen", exact: true })
        .tap();
      await touchPage
        .locator(".mm-feature-preview")
        .waitFor({ state: "detached" });
      await touch.close();
      await checkFeaturePreviews({ browser, origin, basePath });
      await checkHoverSettings({ browser, origin, basePath });
      console.log(
        `✓ ${name}: compact translucent cards, cursor following, viewport hover center, object click center, pan/resize, camera preservation, touch, safe properties and existing preview settings`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
