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
} from "node:fs";
import { dirname, resolve, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(site, "dist");
const evidence = resolve(site, "../artifacts/documentation");
mkdirSync(evidence, { recursive: true });
const htmlFiles = [
  resolve(dist, "index.html"),
  ...readdirSync(resolve(dist, "guides"))
    .filter((f) => f.endsWith(".html"))
    .map((f) => resolve(dist, "guides", f)),
];
// Verify every generated local page/asset link and fragment, including subdirectory routes.
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  for (const match of html.matchAll(/(?:href|src)="([^"\s]+)"/g)) {
    const href = match[1].replaceAll("&amp;", "&");
    if (/^(https?:|mailto:|data:)/.test(href)) continue;
    const [pathname, hash] = href.split("#");
    const target = pathname
      ? resolve(dirname(file), pathname.split("?")[0])
      : file;
    assert.ok(
      existsSync(target),
      `Broken link in ${relative(dist, file)}: ${href}`,
    );
    if (hash && target.endsWith(".html"))
      assert.ok(
        readFileSync(target, "utf8").includes(
          `id="${decodeURIComponent(hash)}"`,
        ),
        `Missing anchor in ${relative(dist, file)}: ${href}`,
      );
  }
}
console.log(
  `✓ ${htmlFiles.length} generated pages: local links and section anchors`,
);

// Compile and build the exact files printed in the quickstart, rather than a separate fixture.
const quickstart = mkdtempSync(resolve(tmpdir(), "map-master-quickstart-"));
const markdown = readFileSync(resolve(site, "content/quickstart.md"), "utf8");
for (const [language, filename] of [
  ["html", "index.html"],
  ["css", "style.css"],
  ["ts", "main.ts"],
]) {
  const match = markdown.match(
    new RegExp("```" + language + "\\n([\\s\\S]*?)```"),
  );
  assert.ok(match, `Missing ${language} quickstart example`);
  writeFileSync(resolve(quickstart, filename), match[1]);
}
symlinkSync(
  resolve(site, "node_modules"),
  resolve(quickstart, "node_modules"),
  "dir",
);
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

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const prefix = url.pathname.startsWith("/quickstart/")
    ? "/quickstart/"
    : "/map-master/";
  const directory =
    prefix === "/quickstart/" ? resolve(quickstart, "dist") : dist;
  const name =
    decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html";
  const file = resolve(directory, name);
  if (
    !url.pathname.startsWith(prefix) ||
    !file.startsWith(`${directory}/`) ||
    !existsSync(file)
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.setHeader(
    "Content-Type",
    mime[extname(file)] ?? "application/octet-stream",
  );
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const allowedOrigins = new Set([origin]);
let devServer;
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("request", (request) => {
  if (/^https?:/.test(request.url()) && !allowedOrigins.has(new URL(request.url()).origin)) {
    errors.push(`Unexpected external request: ${request.url()}`);
  }
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (/^https?:/.test(response.url()) && allowedOrigins.has(new URL(response.url()).origin) && response.status() >= 400)
    errors.push(`${response.status()} ${response.url()}`);
});
const open = async (slug) => {
  await page.goto(`${origin}/map-master/${slug}`, { waitUntil: "networkidle" });
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
try {
  await open("index.html");
  await ready();
  await count(2);
  await page.screenshot({
    path: resolve(evidence, "overview-desktop.png"),
    fullPage: true,
  });
  await page.locator("[data-copy]").click();
  await page.waitForFunction(() =>
    document.querySelector("[data-copy]")?.textContent === "Copied!",
  );
  assert.match(await page.locator("[data-copy]").textContent(), /Copied/);
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

  await open("guides/draw.html");
  await ready();
  await count(0);
  await page.locator('[data-action="polygon"]').click();
  const canvas = page.locator(".demo-map canvas");
  const box = await canvas.boundingBox();
  for (const [x, y] of [
    [0.3, 0.3],
    [0.65, 0.3],
    [0.58, 0.7],
  ])
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  await page.locator('[data-action="finish"]:enabled').click();
  await count(1);
  await page.locator('[data-action="undo"]').click();
  await count(0);
  await page.locator('[data-action="line"]').click();
  await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
  await page.locator('[data-action="cancel"]').click();
  await count(0);
  console.log("✓ Draw a polygon, finish, Undo and cancel a line");

  await open("guides/edit.html");
  await ready();
  await count(2);
  await page.locator('[data-action="edit"]').click();
  const vertex = page.getByRole("button", { name: /Keyboard editing/ });
  await vertex.focus();
  await vertex.press("ArrowRight");
  await page.locator('[data-action="finish"]:enabled').click();
  assert.equal(await page.locator('[data-action="undo"]').isEnabled(), true);
  await page.locator('[data-action="undo"]').click();
  await count(2);
  await page.locator('[data-action="delete"]').click();
  await count(1);
  await page.locator('[data-action="undo"]').click();
  await count(2);
  console.log("✓ Edit, save, Undo, delete and restore through public controls");

  await open("guides/geojson.html");
  await ready();
  await count(2);
  await page.locator('[data-action="import"]').click();
  await count(3);
  const original = await page.locator(".geojson-output").textContent();
  await page.locator('[data-action="import"]').click();
  await count(3);
  assert.equal(await page.locator(".geojson-output").textContent(), original);
  await page.locator(".geojson-input").fill("{invalid");
  await page.locator('[data-action="import"]').click();
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
            geometry: { type: "Point", coordinates: [4.9, 52.37] },
          },
        ],
      }),
    );
  await page.locator('[data-action="import"]').click();
  await count(4);
  assert.equal(await page.locator(".demo-feature-list img").count(), 0);
  const downloading = page.waitForEvent("download");
  await page.locator('[data-action="export"]').click();
  const download = await downloading;
  const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
  assert.equal(exported.features.length, 4);
  assert.equal(exported.features[2].id, "meeting-point");
  console.log(
    "✓ GeoJSON append, duplicate/malformed input rollback, safe names and download",
  );

  await open("guides/quickstart.html");
  await page.screenshot({
    path: resolve(evidence, "quickstart-desktop.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open("index.html");
  await ready();
  await page.locator(".menu-button").click();
  assert.equal(
    await page.locator(".menu-button").getAttribute("aria-expanded"),
    "true",
  );
  await page.locator(".sidebar a", { hasText: "Quickstart" }).click();
  await page.waitForURL("**/guides/quickstart.html");
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
  await page.locator("#draw:enabled").waitFor();
  await page.locator("#draw").click();
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
  await page.locator("#finish:enabled").click();
  assert.match(await page.locator("#status").textContent(), /1 features/);
  await page.locator("#undo:enabled").click();
  assert.match(await page.locator("#status").textContent(), /0 features/);
  console.log("✓ Exact quickstart works in the browser: draw, save and Undo");

  // A successful production build cannot catch source URLs broken only in dev mode.
  devServer = await createViteServer({
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    clearScreen: false,
  });
  await devServer.listen();
  const devOrigin = devServer.resolvedUrls.local[0];
  allowedOrigins.add(new URL(devOrigin).origin);
  await page.setViewportSize({ width: 1440, height: 1050 });
  for (const path of ["", "guides/draw.html"]) {
    await page.goto(new URL(path, devOrigin).href, { waitUntil: "networkidle" });
    await ready();
    assert.equal(await page.locator(".sidebar").evaluate((node) => getComputedStyle(node).position), "fixed");
    await page.locator('[data-action="polygon"]').click();
    await page.locator('[data-demo][data-mode="draw-polygon"]').waitFor();
    await page.locator('[data-action="cancel"]').click();
  }
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
        publishedPackage: "0.1.0-beta.0",
        checks: [
          "links-and-anchors",
          "copy",
          "search",
          "drawing",
          "editing-history",
          "geojson-errors-download",
          "mobile",
          "exact-quickstart-build-and-browser",
          "development-server-styles-and-map",
        ],
        errorCount: errors.length,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  await devServer?.close();
  await new Promise((resolve) => server.close(resolve));
}
