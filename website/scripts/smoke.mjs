import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  symlinkSync,
  copyFileSync,
} from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";
import { createStaticServer } from "./lib/static-server.mjs";
import { checkNavigation } from "./navigation-check.mjs";
import { checkRegressions } from "./regression-check.mjs";
import { checkControlLayout } from "./layout-check.mjs";
import { checkPlayground } from "./playground-check.mjs";
import { checkPlaygroundStorage } from "./playground-storage-check.mjs";
import { checkPlaygroundIntegrity } from "./playground-integrity-check.mjs";
import { checkPlaygroundAttributeDrafts } from "./playground-attributes-check.mjs";
import { checkPlaygroundMobile } from "./playground-mobile-check.mjs";
import { checkPlaygroundResize } from "./playground-resize-check.mjs";
import { checkFeaturePreviews } from "./feature-preview-check.mjs";
import { checkDifference } from "./difference-check.mjs";
import { checkMapOverlays } from "./map-overlay-check.mjs";
import { checkHoverSettings } from "./hover-settings-check.mjs";
import { checkAnalysis } from "./analysis-check.mjs";
import { checkBnb } from "./bnb-check.mjs";
import { checkLayoutHydration } from "./layout-hydration-check.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..");
const dist = resolve(site, "dist");
const evidence = resolve(site, "../artifacts/documentation");
mkdirSync(evidence, { recursive: true });
const { guides } = JSON.parse(readFileSync(resolve(site, ".generated/manifest.json"), "utf8"));
const { basePath } = JSON.parse(readFileSync(resolve(dist, ".build-info.json"), "utf8"));
assert.equal(basePath, "/map-master", "Run npm run check to test the deployment base path");
const htmlFiles = [resolve(dist, "index.html"), resolve(dist, "playground", "index.html"), resolve(dist, "analysis", "index.html"), resolve(dist, "analysis", "bnb", "index.html"), resolve(dist, "analysis", "streets", "index.html"), ...guides.map(g => resolve(dist, "guides", g.slug, "index.html"))];
// Verify real exported pages, public assets and fragments under the deployment base path.
for (const file of htmlFiles) {
  for (const match of readFileSync(file, "utf8").replace(/<link\b[^>]*rel="(?:preconnect|dns-prefetch)"[^>]*>/g, "").matchAll(/(?:href|src)="([^"\s]+)"/g)) {
    const href = match[1].replaceAll("&amp;", "&");
    if (/^(https?:|mailto:|data:)/.test(href)) continue;
    const [pathname, hash] = href.split("#");
    let target = !pathname ? file : pathname.startsWith("/")
      ? resolve(dist, pathname.replace(/^\/map-master\//, "").split("?")[0])
      : resolve(dirname(file), pathname.split("?")[0]);
    if (pathname.endsWith("/")) target = resolve(target, "index.html");
    assert.ok(existsSync(target), `Broken link in ${relative(dist, file)}: ${href}`);
    if (hash && target.endsWith(".html")) assert.ok(readFileSync(target, "utf8").includes(`id="${decodeURIComponent(hash)}"`), `Missing anchor in ${relative(dist, file)}: ${href}`);
  }
}
console.log(`✓ ${htmlFiles.length} exported Next.js pages: local links and section anchors`);

// Compile and build the exact files printed in the quickstart, rather than a separate fixture.
const quickstart = mkdtempSync(resolve(tmpdir(), "map-master-quickstart-"));
const markdown = readFileSync(resolve(site, "content/quickstart.md"), "utf8");
for (const [language, filename] of [
  ["html", "index.html"],
  ["css", "style.css"],
  ["ts", "main.ts"],
]) {
  const match = markdown.match(
    new RegExp("```" + language + "[^\\n]*\\n([\\s\\S]*?)```"),
  );
  assert.ok(match, `Missing ${language} quickstart example`);
  writeFileSync(resolve(quickstart, filename), match[1]);
}
// Install like a user would: the website's MapLibre, Vite and TypeScript, plus this
// repository's library build in place of the npm package.
const modules = resolve(quickstart, "node_modules");
const library = resolve(modules, "@jorisvdmije/map-master");
mkdirSync(library, { recursive: true });
for (const entry of readdirSync(resolve(site, "node_modules")))
  if (entry !== "@jorisvdmije")
    symlinkSync(resolve(site, "node_modules", entry), resolve(modules, entry), "dir");
copyFileSync(resolve(repo, "package.json"), resolve(library, "package.json"));
symlinkSync(resolve(repo, "dist"), resolve(library, "dist"), "dir");
execFileSync(
  process.execPath,
  [
    resolve(site, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target",
    "ES2022",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "--types",
    "vite/client",
    // One MapLibre declaration for the app and the library's types.
    "--preserveSymlinks",
    "main.ts",
  ],
  { cwd: quickstart, stdio: "pipe" },
);
execFileSync(
  process.execPath,
  [resolve(site, "node_modules/vite/bin/vite.js"), "build", "--base", "./"],
  { cwd: quickstart, stdio: "pipe" },
);
console.log("✓ Quickstart: displayed TypeScript, HTML and CSS build together");

const docsServer = createStaticServer({ directory: dist, basePath });
const quickServer = createStaticServer({ directory: resolve(quickstart, "dist"), basePath: "/quickstart" });
const server = createServer((request, response) => {
  (request.url.startsWith("/quickstart/") ? quickServer : docsServer).emit("request", request, response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// Basemap requests are answered locally, so the checks never depend on the tile service.
const basemap = "https://tiles.openfreemap.org";
const allowedOrigins = new Set([origin, basemap]);
let devServer;
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  permissions: ["clipboard-read", "clipboard-write"],
});
await context.route(`${basemap}/**`, (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      version: 8,
      sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }],
    }),
  }),
);
const page = await context.newPage();
const errors = [];
page.on("request", (request) => {
  if (/^https?:/.test(request.url()) && !allowedOrigins.has(new URL(request.url()).origin)) {
    errors.push(`Unexpected external request: ${request.url()}`);
  }
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("response", (response) => {
  if (/^https?:/.test(response.url()) && allowedOrigins.has(new URL(response.url()).origin) && response.status() >= 400)
    errors.push(`${response.status()} ${response.url()}`);
});
const canonicalPath = slug => slug === "index.html" ? "" : slug.replace(/\/index\.html$/, "/").replace(/\.html$/, "/");
const open = async (slug) => {
  await page.goto(`${origin}/map-master/${canonicalPath(slug)}`, { waitUntil: "networkidle" });
};
const ready = async () => {
  await page.locator('[data-demo][data-ready="true"]').waitFor();
};
const count = async (n) => {
  await page.waitForFunction(
    (n) =>
      document.querySelector("[data-demo]").dataset.featureCount === String(n),
    n,
  );
};
const tool = (name) => page.locator(`.mm-toolbar-button[data-tool="${name}"]`);
const action = (text) => page.locator(".mm-toolbar-action", { hasText: text });
try {
  await open("index.html");
  await ready();
  await count(6);
  assert.equal(await page.locator(".demo .mm-toolbar").count(), 1);
  await page.screenshot({
    path: resolve(evidence, "overview-desktop.png"),
    fullPage: true,
  });
  await page.locator('#docs-install[data-hydrated="true"]').waitFor();
  const installCopy = page.locator('#docs-install [role="tabpanel"]:not([inert]) [data-slot="code-block-copy-button"]');
  await installCopy.click();
  await page.locator('#docs-install [role="tabpanel"]:not([inert]) [data-copied="true"]').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "npm i @jorisvdmije/map-master maplibre-gl");
  await page.getByRole("tab", { name: "pnpm", exact: true }).click();
  await installCopy.click();
  await page.locator('#docs-install [role="tabpanel"]:not([inert]) [data-copied="true"]').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "pnpm add @jorisvdmije/map-master maplibre-gl");
  await page.getByRole("tab", { name: "pnpm", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "yarn", exact: true }).evaluate(tab => tab === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("tab", { name: "yarn", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "npm", exact: true }).click();
  await page.locator(".search-trigger").click();
  await page.locator("#search-input").fill("GeoJSON");
  await page.locator(".search-result").first().waitFor();
  const href = await page
    .locator(".search-result")
    .first()
    .getAttribute("href");
  await page.locator("#search-input").press("ArrowDown");
  await page.locator("#search-input").press("Enter");
  await page.waitForURL(new URL(href, `${origin}/map-master/index.html`).href);
  await page.locator(".search-trigger").click();
  await page.locator("#search-input").fill("zzzzz-no-matches");
  await page.locator(".search-empty").waitFor();
  await page.locator("#search-input").press("Escape");
  console.log(
    "✓ Overview, copy, full-text search, keyboard navigation and empty results",
  );

  await checkNavigation({ page, context, browser, origin });
  await checkRegressions({ context, browser, origin, site });
  await checkControlLayout({ context, origin, evidence });
  await checkMapOverlays({ browser, origin, evidence });
  await checkPlayground({ context, origin, evidence });
  await checkAnalysis({ context, origin, evidence });
  await checkBnb({ context, origin, evidence });
  await checkLayoutHydration({ browser, context, origin });
  await checkPlaygroundStorage({ browser, origin });
  await checkPlaygroundIntegrity({ browser, origin, evidence });
  await checkPlaygroundAttributeDrafts({ browser, origin, evidence });
  await checkPlaygroundMobile({ browser, origin, evidence });
  await checkPlaygroundResize({ browser, origin, evidence });
  await checkFeaturePreviews({ browser, origin });
  await checkHoverSettings({ browser, origin });
  await checkDifference({ browser, origin });

  await open("guides/draw.html");
  await ready();
  await count(1);
  await tool("polygon").click();
  const canvas = page.locator(".demo-map canvas");
  const box = await canvas.boundingBox();
  for (const [x, y] of [
    [0.3, 0.3],
    [0.65, 0.3],
    [0.58, 0.7],
  ])
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  await action("Finish").click();
  await count(2);
  await tool("undo").click();
  await count(1);
  await tool("line").click();
  await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await action("Cancel").click();
  await page.locator('[data-demo][data-mode="idle"]').waitFor();
  await count(1);
  console.log("✓ Toolbar: draw a polygon, finish, Undo and cancel a line");

  await open("guides/edit.html");
  await ready();
  await count(3);
  await tool("edit").click();
  const vertex = page.getByRole("button", { name: /Keyboard editing/ });
  await vertex.focus();
  await vertex.press("ArrowRight");
  await action("Save").click();
  assert.equal(await tool("undo").isEnabled(), true);
  await tool("undo").click();
  await count(3);
  await tool("delete").click();
  await count(2);
  await tool("undo").click();
  await count(3);
  await page.locator(".demo-reset").click();
  assert.equal(await tool("undo").isEnabled(), false);
  console.log("✓ Toolbar: edit, save, Undo, delete, restore and reset");

  await open("guides/union.html");
  await ready();
  await count(2);
  await tool("union").click();
  await action("Apply").click();
  await count(1);
  await tool("undo").click();
  await count(2);
  console.log("✓ Toolbar: merge the preselected polygons and undo");

  await open("guides/geojson.html");
  await ready();
  await count(2);
  const importButton = page.locator(".demo-data button", { hasText: "Import GeoJSON" });
  await importButton.click();
  await count(3);
  const original = await page.locator(".geojson-output").textContent();
  await importButton.click();
  await count(3);
  assert.match(await page.locator(".demo-status").textContent(), /rejected/);
  assert.equal(await page.locator(".geojson-output").textContent(), original);
  await page.locator(".geojson-input").fill("{invalid");
  await importButton.click();
  assert.match(await page.locator(".demo-status").textContent(), /not valid JSON/);
  assert.equal(await page.locator(".geojson-output").textContent(), original);
  await page
    .locator(".geojson-input")
    .fill(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "unsafe-name",
            properties: { name: "<img src=x onerror=alert(1)>" },
            geometry: { type: "Point", coordinates: [4.868, 52.358] },
          },
        ],
      }),
    );
  await importButton.click();
  await count(4);
  assert.equal(await page.locator(".demo img").count(), 0);
  const downloading = page.waitForEvent("download");
  await page.locator(".demo-data button", { hasText: "Download GeoJSON" }).click();
  const download = await downloading;
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.equal(exported.features.length, 4);
  assert.equal(exported.features[2].id, "meeting-point");
  console.log(
    "✓ GeoJSON append, duplicate/malformed input rollback, safe names and download",
  );

  await open("guides/keyboard-shortcuts.html");
  await ready();
  await page.getByRole("button", { name: "Focus map", exact: true }).click();
  await page.keyboard.press("p");
  await page.locator('[data-demo][data-mode="draw-polygon"]').waitFor();
  const preset = page.getByLabel("Shortcut preset");
  await preset.selectOption("alternative");
  assert.match(await page.locator('[data-tool="polygon"]').getAttribute("data-tooltip"), /\(G\)/);
  assert.match(await page.locator(".demo-shortcut-reference").textContent(), /finish: Ctrl\+Enter/);
  await page.getByRole("button", { name: "Focus map", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("[data-demo]").getAttribute("data-mode"), "draw-polygon");
  await page.keyboard.press("c");
  await page.locator('[data-demo][data-mode="idle"]').waitFor();
  await page.getByLabel("Try typing here").fill("gce");
  assert.equal(await page.locator("[data-demo]").getAttribute("data-mode"), "idle");
  await preset.selectOption("off");
  await page.getByRole("button", { name: "Focus map", exact: true }).click();
  await page.keyboard.press("g");
  assert.equal(await page.locator("[data-demo]").getAttribute("data-mode"), "idle");
  await preset.selectOption("alternative");
  await page.getByRole("button", { name: "Focus map", exact: true }).click();
  await page.keyboard.press("g");
  const shortcutCanvas = page.locator(".demo-map canvas");
  for (const [x, y] of [[260, 150], [450, 150], [450, 300]]) await shortcutCanvas.click({ position: { x, y } });
  await page.keyboard.press("Control+Enter");
  await page.locator('[data-demo][data-mode="idle"]').waitFor();
  await count(3);
  await page.keyboard.press("Control+z");
  await count(2);
  await page.locator(".demo-reset").click();
  assert.equal(await preset.inputValue(), "standard");
  await page.locator(".demo").screenshot({ path: resolve(evidence, "keyboard-shortcuts.png") });
  console.log("✓ Shortcuts: runtime remapping during drawing, custom finish/cancel, disabled commands, text fields and reset");

  await open("guides/text-markers.html");
  await ready();
  await count(2);
  await tool("edit").click();
  await page.getByLabel("Text", { exact: true }).fill("Café 🌷\n<img src=x onerror=alert(1)>");
  await page.getByLabel("Text size", { exact: true }).fill("24");
  assert.equal(await page.locator(".mm-text-marker img").count(), 0);
  await action("Save").click();
  const savedText = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.equal(savedText.features[1].properties.mapMasterText.text, "Café 🌷\n<img src=x onerror=alert(1)>");
  assert.equal(savedText.features[1].properties.mapMasterText.style.fontSize, 24);
  await tool("undo").click();
  assert.match(await page.locator(".mm-text-marker").textContent(), /Meeting point/);
  await tool("redo").click();
  const textDownloadPromise = page.waitForEvent("download");
  await page.locator(".demo-data button", { hasText: "Download GeoJSON" }).click();
  const textDownload = await textDownloadPromise;
  assert.deepEqual(JSON.parse(readFileSync(await textDownload.path(), "utf8")), savedText);
  await tool("text").click();
  await page.locator(".demo-map canvas").click({ position: { x: 500, y: 330 } });
  await page.getByLabel("Text", { exact: true }).fill("New label");
  await action("Finish").click();
  await count(3);
  await tool("undo").click();
  await count(2);
  // Reimport the saved label under a new ID to verify metadata in the built example.
  const reimportedLabel = structuredClone(savedText.features[1]); reimportedLabel.id = "round-trip-label";
  await page.locator(".geojson-input").fill(JSON.stringify(reimportedLabel));
  await page.locator(".demo-data button", { hasText: "Import GeoJSON" }).click();
  await count(3);
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()).features[2], reimportedLabel);
  await page.locator(".demo").screenshot({ path: resolve(evidence, "text-markers.png") });
  console.log("✓ Text markers: edit text/style, safe rendering, creation, undo/redo, download and import round-trip");

  await open("guides/shape-templates.html");
  await ready(); await count(2);
  await tool("template").click();
  await page.getByLabel("Template", { exact: true }).selectOption("booth");
  await page.getByLabel("Size (Mercator m)", { exact: true }).fill("600");
  await page.getByLabel("Rotation (°)", { exact: true }).fill("30");
  await page.locator(".demo-map canvas").click({ position: { x: 500, y: 330 } });
  await count(2); // Preview is not exported.
  await action("Finish").click(); await count(4);
  const placedTemplates = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.equal(placedTemplates.features[2].properties.category, "booth");
  assert.equal(placedTemplates.features[3].properties.name, "Entrance path");
  assert.notEqual(placedTemplates.features[2].id, "booth");
  assert.notEqual(placedTemplates.features[3].id, "entrance");
  assert.equal(await page.locator(".demo-log li").count(), 1);
  await tool("undo").click(); await count(2);
  await tool("redo").click(); await count(4);
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), placedTemplates);
  const templateDownloadPromise = page.waitForEvent("download");
  await page.locator(".demo-data button", { hasText: "Download GeoJSON" }).click();
  const templateDownload = await templateDownloadPromise;
  assert.deepEqual(JSON.parse(readFileSync(await templateDownload.path(), "utf8")), placedTemplates);
  await tool("template").click();
  await page.getByLabel("Template", { exact: true }).selectOption("star");
  await page.getByLabel("Longitude", { exact: true }).fill("180");
  await page.getByLabel("Latitude", { exact: true }).fill("0");
  assert.equal(await action("Finish").isEnabled(), false);
  await action("Cancel").click(); await count(4);
  // After reset, the exact saved geometry imports without relying on the registry.
  await page.locator(".demo-reset").click();
  await page.locator(".geojson-input").fill(JSON.stringify({ type: "FeatureCollection", features: placedTemplates.features.slice(2) }));
  await page.locator(".demo-data button", { hasText: "Import GeoJSON" }).click(); await count(4);
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()).features.slice(2), placedTemplates.features.slice(2));
  await page.locator(".demo-map").scrollIntoViewIfNeeded();
  await page.locator(".demo-map").screenshot({ path: resolve(evidence, "shape-templates.png") });
  console.log("✓ Shape templates: group placement, size/rotation, properties, one-step history, invalid placement and GeoJSON round-trip");

  await open("guides/alignment-guides.html");
  await ready(); await count(3);
  assert.equal(await tool("guides").getAttribute("aria-pressed"), "true");
  await tool("guides").click(); assert.equal(await tool("guides").getAttribute("aria-pressed"), "false");
  await page.locator(".demo-map canvas").focus(); await page.keyboard.press("g");
  assert.equal(await tool("guides").getAttribute("aria-pressed"), "true");
  assert.equal(await tool("snapping").getAttribute("aria-pressed"), "false");
  await tool("line").click();
  await page.locator(".demo-map canvas").click({ position: { x: 430, y: 280 } });
  await page.locator(".demo-map canvas").click({ position: { x: 570, y: 280 } });
  await action("Finish").click(); await count(4);
  await tool("undo").click(); await count(3); await tool("redo").click(); await count(4);
  await page.locator(".demo-map").screenshot({ path: resolve(evidence, "alignment-guides.png") });
  console.log("✓ Alignment guides: independent toggle, remapped key, drawing and one-step history");

  await open("guides/vertex-pinning.html");
  await ready(); await count(4);
  const unpinnedVertices = JSON.parse(await page.locator(".geojson-output").textContent());
  await tool("pin").click();
  const pinnedVertices = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.ok(pinnedVertices.features.every(feature => feature.properties.mapMasterPins.length > 0));
  await tool("undo").click();
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), unpinnedVertices);
  await tool("redo").click();
  const junction = await page.locator('.mm-text-marker[data-feature-id="\\"junction\\""]').boundingBox();
  assert.ok(junction);
  await page.mouse.click(junction.x + junction.width / 2, junction.y + junction.height / 2);
  await tool("edit").click();
  await page.mouse.move(junction.x + junction.width / 2, junction.y + junction.height / 2);
  await page.mouse.down(); await page.mouse.move(junction.x + junction.width / 2 + 30, junction.y + junction.height / 2 - 25, { steps: 5 }); await page.mouse.up();
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), pinnedVertices);
  await action("Save").click();
  const movedPins = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.ok(movedPins.features.every((feature, index) => JSON.stringify(feature.geometry) !== JSON.stringify(pinnedVertices.features[index].geometry)));
  assert.equal(await page.locator(".demo-log li").count(), 4); // Pin, Undo, Redo, linked edit.
  await tool("undo").click(); assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), pinnedVertices);
  await tool("redo").click(); assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), movedPins);
  const pinsDownloadPromise = page.waitForEvent("download");
  await page.locator(".demo-data button", { hasText: "Download GeoJSON" }).click();
  const pinsDownload = await pinsDownloadPromise;
  assert.deepEqual(JSON.parse(readFileSync(await pinsDownload.path(), "utf8")), movedPins);
  await tool("unpin").click();
  assert.equal(JSON.parse(await page.locator(".geojson-output").textContent()).features[3].properties.mapMasterPins, undefined);
  await tool("undo").click();
  await page.locator(".demo-reset").click();
  const importedPins = structuredClone(movedPins); importedPins.features.forEach(feature => { feature.id += "-imported"; });
  await page.locator(".geojson-input").fill(JSON.stringify(importedPins));
  await page.locator(".demo-data button", { hasText: "Import GeoJSON" }).click(); await count(8);
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()).features.slice(4), importedPins.features);
  await page.locator(".demo-map").screenshot({ path: resolve(evidence, "vertex-pinning.png") });
  console.log("✓ Vertex pins: toolbar, linked drag, atomic events, exact Undo/Redo, unlink and GeoJSON round-trip");

  await open("guides/geofencing.html");
  await ready(); await count(2);
  const fencedBefore = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.equal(await tool("geofencing").getAttribute("aria-pressed"), "true");
  const fencedCanvas = page.locator(".demo-map canvas");
  const fencedBounds = await fencedCanvas.boundingBox();
  const movingLabel = await page.locator('.mm-text-marker').boundingBox();
  assert.ok(fencedBounds && movingLabel);
  await tool("edit").click();
  const startFenceX = movingLabel.x + movingLabel.width / 2;
  const startFenceY = movingLabel.y + movingLabel.height / 2;
  await page.mouse.move(startFenceX, startFenceY); await page.mouse.down();
  await page.mouse.move(fencedBounds.x + fencedBounds.width / 2 + 70, fencedBounds.y + fencedBounds.height / 2, { steps: 5 });
  await page.locator('.mm-geofencing-notice:not([hidden])').waitFor();
  assert.match(await page.locator('.mm-geofencing-notice').textContent(), /pond/);
  assert.equal(await action("Save").isEnabled(), false);
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), fencedBefore);
  await page.mouse.move(startFenceX + 20, startFenceY, { steps: 5 }); await page.mouse.up();
  assert.equal(await action("Save").isEnabled(), true);
  await action("Save").click();
  const fencedAfter = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.notDeepEqual(fencedAfter.features[0].geometry, fencedBefore.features[0].geometry);
  assert.deepEqual(fencedAfter.features[1], fencedBefore.features[1]);
  await tool("undo").click(); assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), fencedBefore);
  await tool("redo").click(); assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), fencedAfter);
  await tool("geofencing").click(); assert.equal(await tool("geofencing").getAttribute("aria-pressed"), "false");
  await fencedCanvas.focus(); await page.keyboard.press("f"); assert.equal(await tool("geofencing").getAttribute("aria-pressed"), "true");
  await tool("point").click(); await fencedCanvas.click({ position: { x: fencedBounds.width - 30, y: fencedBounds.height / 2 } });
  await count(2); assert.match(await page.locator('.mm-geofencing-notice').textContent(), /park/);
  await action("Cancel").click();
  await page.locator(".geojson-input").fill(JSON.stringify({ type: "Feature", id: "forbidden", properties: {}, geometry: { type: "Point", coordinates: [-80, 70] } }));
  await page.locator(".demo-data button", { hasText: "Import GeoJSON" }).click(); await count(2);
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), fencedAfter);
  await page.locator(".demo-map").screenshot({ path: resolve(evidence, "geofencing.png") });
  console.log("✓ Geofencing: forbidden drag/drawing/import, correction, exact history and runtime toggle without exported reference areas");

  await open("guides/data-layers.html");
  await ready(); await count(5);
  const originalLayers = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.equal(originalLayers.features.filter(feature => feature.properties.mapMasterLayer === "archive").length, 1);
  await page.locator('.mm-data-layers > button').click();
  await page.locator('[data-control-key="active"]').selectOption("notes");
  await tool("point").click(); await page.locator(".demo-map canvas").click({ position: { x: 300, y: 350 } }); await count(6);
  const drawnInNotes = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.equal(drawnInNotes.features.at(-1).properties.mapMasterLayer, "notes");
  await tool("undo").click(); await count(5); await tool("redo").click(); await count(6);
  await page.locator('[data-control-key="notes:visible"]').uncheck();
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), drawnInNotes);
  assert.equal(await page.locator('.mm-text-marker').count(), 0);
  assert.equal(await tool("undo").isEnabled(), false);
  await page.locator('[data-control-key="notes:visible"]').check(); assert.equal(await tool("undo").isEnabled(), true);
  await page.locator('[data-control-key="parcels:locked"]').check();
  await page.locator('[data-control-key="parcels:locked"]').uncheck();
  await page.locator('[data-control-key="reference:snapping"]').uncheck(); await page.locator('[data-control-key="reference:snapping"]').check();
  await page.locator('[data-control-key="parcels:forward"]').click();
  const reorderedLayers = await page.locator('.mm-data-layer-row').evaluateAll(rows => rows.map(row => row.dataset.dataLayerId));
  assert.ok(reorderedLayers.indexOf("parcels") < reorderedLayers.indexOf("notes"));
  // Collapse before selecting the map label, then use the panel to move its membership.
  await page.locator('.mm-data-layers > button').click();
  const layerNote = await page.locator('.mm-text-marker').boundingBox(); assert.ok(layerNote);
  await page.mouse.click(layerNote.x + layerNote.width / 2, layerNote.y + layerNote.height / 2);
  await page.locator('.mm-data-layers > button').click();
  await page.locator('[data-control-key="destination"]').selectOption("parcels"); await page.locator('[data-control-key="move"]').click();
  const movedBetweenLayers = JSON.parse(await page.locator(".geojson-output").textContent());
  assert.equal(movedBetweenLayers.features.find(feature => feature.id === "note").properties.mapMasterLayer, "parcels");
  assert.deepEqual(movedBetweenLayers.features.find(feature => feature.id === "note").geometry, originalLayers.features.find(feature => feature.id === "note").geometry);
  await tool("undo").click(); assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), drawnInNotes);
  await tool("redo").click(); assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), movedBetweenLayers);
  const layersDownloadPromise = page.waitForEvent("download");
  await page.locator(".demo-data button", { hasText: "Download GeoJSON" }).click();
  const layersDownload = await layersDownloadPromise;
  assert.deepEqual(JSON.parse(readFileSync(await layersDownload.path(), "utf8")), movedBetweenLayers);
  await page.locator(".demo-reset").click(); await count(5);
  assert.deepEqual(JSON.parse(await page.locator(".geojson-output").textContent()), originalLayers);
  assert.equal(await page.locator('[data-control-key="active"]').inputValue(), "parcels");
  await page.locator('.mm-data-layers > button').click();
  await page.locator(".demo-map").screenshot({ path: resolve(evidence, "data-layers.png") });
  console.log("✓ Data layers: active drawing, visibility, reference settings, order, atomic membership history, export and reset");

  // Every guide with a live example loads its map, data and toolbar.
  const demoPages = htmlFiles.filter((file) => readFileSync(file, "utf8").includes("data-demo="));
  for (const file of demoPages) {
    await open(relative(dist, file));
    await page.locator("[data-demo]").scrollIntoViewIfNeeded();
    await ready();
    assert.ok(await page.locator(".demo .mm-toolbar-button").count() > 0, `No toolbar in ${relative(dist, file)}`);
  }
  console.log(`✓ ${demoPages.length} live examples load their data and toolbar`);

  for (const guide of guides) {
    if (demoPages.includes(resolve(dist, "guides", guide.slug, "index.html"))) continue;
    await open(`guides/${guide.slug}/`);
    assert.equal(await page.locator(".article h1").first().textContent(), guide.title);
    await page.locator(".sidebar").getByRole("link", { name: "Quickstart", exact: true }).click();
    await page.waitForURL("**/guides/quickstart/");
  }
  console.log("✓ All remaining guide routes render and navigate with React");

  await open("guides/quickstart.html");
  await page.locator('[data-ui-root][data-hydrated="true"]').first().waitFor();
  const mainCode = page.locator('[data-slot="code-block"]').filter({ has: page.locator('[data-slot="code-block-title"]', { hasText: "main.ts" }) });
  const expectedSource = markdown.match(/```ts[^\n]*\n([\s\S]*?)```/)[1].replace(/\n$/, "");
  await mainCode.getByRole("button", { name: "Copy", exact: true }).click();
  await mainCode.locator('[data-copied="true"]').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expectedSource, "Copy preserves source whitespace and excludes line numbers");
  assert.equal(await mainCode.locator('[data-numbered="true"]').count(), 1);
  await mainCode.getByRole("button", { name: "Wrap lines", exact: true }).click();
  assert.equal(await mainCode.getByRole("button", { name: "Wrap lines", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await mainCode.locator('[data-wrap="true"]').count(), 1);
  await mainCode.getByRole("button", { name: "Show more", exact: true }).click();
  assert.equal(await mainCode.getByRole("button", { name: "Show less", exact: true }).getAttribute("aria-expanded"), "true");
  await mainCode.getByRole("button", { name: "Show less", exact: true }).click();
  assert.equal(await page.locator('[data-slot="alert"]').count(), 2);
  console.log("✓ shadcn Code Block: exact copy, line numbers, wrapping, expansion; package-manager tabs and setup alerts");
  await page.screenshot({
    path: resolve(evidence, "quickstart-desktop.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open("index.html");
  await ready();
  await page.evaluate(() => { window.__mobileShell = { header: document.querySelector(".topbar"), sidebar: document.querySelector(".sidebar") }; });
  await page.locator(".menu-button").click();
  assert.equal(
    await page.locator(".menu-button").getAttribute("aria-expanded"),
    "true",
  );
  await page.locator(".sidebar a", { hasText: "Quickstart" }).click();
  await page.waitForURL("**/guides/quickstart/");
  assert.equal(await page.evaluate(() => window.__mobileShell.header === document.querySelector(".topbar") && window.__mobileShell.sidebar === document.querySelector(".sidebar")), true);
  assert.equal(await page.locator(".menu-button").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator(".sidebar").evaluate(node => node.inert), true);
  await page.locator(".menu-button").click();
  await page.locator(".sidebar").getByRole("link", { name: "Quickstart", exact: true }).click();
  assert.equal(await page.locator(".menu-button").getAttribute("aria-expanded"), "false", "Selecting the current page closes mobile navigation");
  await page.waitForFunction(() => document.querySelector(".sidebar").getBoundingClientRect().right <= 1);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile quickstart must not overflow horizontally",
  );
  await page.screenshot({
    path: resolve(evidence, "quickstart-mobile.png"),
    fullPage: true,
  });
  await open("index.html");
  await ready();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile overview must not overflow horizontally",
  );
  await page.screenshot({
    path: resolve(evidence, "overview-mobile.png"),
    fullPage: true,
  });
  console.log("✓ Mobile navigation and responsive overview/quickstart");

  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${origin}/quickstart/index.html`, {
    waitUntil: "networkidle",
  });
  await tool("polygon").waitFor();
  await tool("polygon").click();
  const quickCanvas = page.locator("#map canvas");
  const quickBox = await quickCanvas.boundingBox();
  for (const [x, y] of [
    [0.3, 0.3],
    [0.6, 0.3],
    [0.55, 0.6],
  ])
    await quickCanvas.click({
      position: { x: quickBox.width * x, y: quickBox.height * y },
    });
  await action("Finish").click();
  assert.match(await page.locator("#status").textContent(), /^1 feature$/);
  await tool("undo").click();
  assert.match(await page.locator("#status").textContent(), /^0 features$/);
  console.log("✓ Exact quickstart works in the browser: draw, save and Undo");

  // A successful production build cannot catch source URLs broken only in dev mode.
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
  const devPort = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const devOrigin = `http://127.0.0.1:${devPort}/`;
  const devLog = [];
  devServer = spawn(process.execPath, [resolve(site, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(devPort)], {
    cwd: site, env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "", NEXT_DIST_DIR: ".next-dev" }, stdio: ["ignore", "pipe", "pipe"],
  });
  devServer.stdout.on("data", chunk => devLog.push(String(chunk)));
  devServer.stderr.on("data", chunk => devLog.push(String(chunk)));
  const deadline = Date.now() + 60_000;
  while (true) {
    try { if ((await fetch(devOrigin, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    if (devServer.exitCode !== null || Date.now() > deadline) throw new Error(`Next.js dev server failed: ${devLog.join("")}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  allowedOrigins.add(new URL(devOrigin).origin);
  await checkLayoutHydration({ browser, context, origin: new URL(devOrigin).origin, basePath: "" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  for (const path of ["", "guides/draw/"]) {
    await page.goto(new URL(path, devOrigin).href, { waitUntil: "networkidle" });
    await ready();
    assert.equal(await page.locator(".sidebar").evaluate((node) => getComputedStyle(node).position), "fixed");
    await tool("polygon").click();
    await page.locator('[data-demo][data-mode="draw-polygon"]').waitFor();
    await action("Cancel").click();
  }
  await page.goto(new URL("guides/draw.html?legacy=1#try-it", devOrigin).href, { waitUntil: "networkidle" });
  await page.waitForURL(new URL("guides/draw/?legacy=1#try-it", devOrigin).href);
  await ready();
  assert.equal(await page.locator("#try-it").count(), 1);
  await page.screenshot({ path: resolve(evidence, "development-desktop.png") });
  console.log("✓ Development server: styled overview and nested guide, loaded map and drawing controls");
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(evidence, "verification.json"),
    JSON.stringify(
      {
        passed: true,
        pages: htmlFiles.length,
        browser: browser.version(),
        library: JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8")).version,
        checks: [
          "links-and-anchors",
          "copy",
          "shadcn-code-block-tabs-alerts",
          "search",
          "persistent-navigation-history-scroll-and-cleanup",
          "toolbar-drawing",
          "toolbar-editing-history",
          "toolbar-geometry-tool",
          "every-live-example",
          "every-guide-route",
          "geojson-errors-download",
          "mobile",
          "exact-quickstart-build-and-browser",
          "next-development-server-styles-and-map",
          "next-static-export-and-legacy-urls",
          "react-query-cache-and-errors",
          "malformed-offline-search-clipboard-and-map-recovery",
          "mobile-focus-and-no-javascript-navigation",
          "embedded-map-toolbar-and-action-panel-containment",
          "playground-import-edit-style-project-recovery-and-export",
          "analysis-spatial-chart-filters-csv-statistics-area-history-and-export",
          "bnb-district-choropleth-permit-markers-quotas-queue-and-forecast",
          "workspace-server-client-layout-hydration-in-development-and-static-export",
        ],
        errorCount: errors.length,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  if (devServer && devServer.exitCode === null && devServer.signalCode === null) {
    const stopped = new Promise(resolve => devServer.once("exit", resolve));
    devServer.kill("SIGTERM");
    await stopped;
  }
  await new Promise((resolve) => server.close(resolve));
}
