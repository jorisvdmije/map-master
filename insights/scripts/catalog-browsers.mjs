import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const project = resolve(import.meta.dirname, "..");
const directory = resolve(project, "dist");
const artifacts = resolve(project, "../artifacts/atlas/catalog");
await readFile(resolve(directory, "index.html")).catch(() => {
  throw new Error("Build Atlas first: npm run build");
});
await mkdir(artifacts, { recursive: true });
const files = [
  "population",
  "households",
  "income",
  "ownership",
  "energy",
  "environment",
];
const snapshots = Object.fromEntries(
  await Promise.all(
    files.map(async (id) => [
      id,
      JSON.parse(
        await readFile(
          resolve(project, `public/data/catalog/${id}.json`),
          "utf8",
        ),
      ),
    ]),
  ),
);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const file = resolve(
      directory,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(directory + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.setHeader(
      "Content-Type",
      types[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["chromium"];

async function ready(page) {
  await page.locator('[data-ready="true"]').waitFor();
}
async function openLibrary(page) {
  await page.getByRole("button", { name: "Databronnen", exact: true }).click();
  await page
    .getByRole("heading", { name: "Bronnenbibliotheek", exact: true })
    .waitFor();
}
const card = (page, id) => page.locator(`[data-source-id="${id}"]`);
const query = (page) =>
  page.getByRole("searchbox", { name: "Zoek databronnen", exact: true });
async function waitLoaded(page, id) {
  await page.locator(`[data-source-id="${id}"].is-loaded`).waitFor();
}
async function closeLibrary(page) {
  await page
    .getByRole("button", { name: "Venster sluiten", exact: true })
    .click();
}
async function persistedSourceIds(page) {
  return page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("atlas-workspace-v1") ?? "{}",
      ).sources?.map((source) => source.sourceId) ?? [],
  );
}
async function cacheExists(page, id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("atlas-source-cache-v1", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db
            .transaction("sources", "readonly")
            .objectStore("sources")
            .get(id);
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
          get.onsuccess = () => {
            db.close();
            resolve(!!get.result);
          };
        };
      }),
    id,
  );
}

try {
  for (const name of names) {
    assert.ok(
      ["chromium", "firefox", "webkit"].includes(name),
      `Unknown browser: ${name}`,
    );
    const browser = await { chromium, firefox, webkit }[name].launch({
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const requests = [],
      errors = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => errors.push(error.message));
    // Deterministic integration coverage: exercise the honest checked-snapshot fallback,
    // while the source-contract unit tests independently exercise live HAL responses.
    await context.route("https://api.data.amsterdam.nl/**", (route) =>
      route.fulfill({
        status: 503,
        body: "Unavailable during offline integration test",
      }),
    );
    try {
      await page.goto(origin);
      await ready(page);
      const extraRequests = () =>
        requests.filter(
          (url) =>
            url.includes("/data/catalog/") ||
            url.startsWith("https://api.data.amsterdam.nl/"),
        );
      assert.equal(
        extraRequests().length,
        0,
        "Startup loads only the core housing data",
      );
      await openLibrary(page);
      assert.equal(await page.locator(".sl-card").count(), files.length);
      assert.equal(
        extraRequests().length,
        0,
        "Opening the source library is metadata-only",
      );
      await query(page).fill("energie");
      assert.equal(await page.locator(".sl-card").count(), 1);
      assert.equal(
        await page.locator(".sl-card").getAttribute("data-source-id"),
        "energy",
      );
      await query(page).fill("CBS");
      assert.equal(await page.locator(".sl-card").count(), 1);
      assert.equal(
        await page.locator(".sl-card").getAttribute("data-source-id"),
        "income",
      );
      await query(page).fill("RVO");
      assert.equal(await page.locator(".sl-card").count(), 1);
      assert.equal(
        await page.locator(".sl-card").getAttribute("data-source-id"),
        "energy",
      );
      await query(page).fill("xyz-998877");
      await page
        .getByRole("heading", { name: "Geen bron gevonden", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Wis de filters", exact: true })
        .click();
      await page.getByRole("button", { name: "Wonen", exact: true }).click();
      assert.equal(await page.locator(".sl-card").count(), 1);
      assert.equal(
        await page.locator(".sl-card").getAttribute("data-source-id"),
        "ownership",
      );
      await page
        .getByRole("button", { name: "Alle thema’s", exact: true })
        .click();
      await card(page, "energy").locator("summary").click();
      assert.match(await card(page, "energy").textContent(), /2020 ontbreekt/);
      assert.match(await card(page, "energy").textContent(), /RVO/);
      assert.equal(
        extraRequests().length,
        0,
        "Definition inspection does not load observations",
      );
      await card(page, "energy").locator("summary").click();
      await page.locator(".source-library").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: resolve(artifacts, `${name}-library.png`),
        fullPage: false,
      });

      await card(page, "population")
        .getByRole("button", {
          name: "Bevolking & leeftijd toevoegen",
          exact: true,
        })
        .click();
      await waitLoaded(page, "population");
      assert.match(
        await card(page, "population").textContent(),
        /Momentopname/,
      );
      assert.match(await card(page, "population").textContent(), /2026/);
      assert.ok(
        await cacheExists(page, "population"),
        "Loaded snapshots are cached in IndexedDB",
      );
      await closeLibrary(page);
      await page
        .getByRole("button", {
          name: "Inwoners toewijzen aan actief blok",
          exact: true,
        })
        .waitFor();
      const map = page.locator('[data-kind="map"]').first();
      await map.locator(".axis-drop select").selectOption("population_total");
      const area = snapshots.population.areas.find(
        (area) => area.code === "BU0363AA02",
      );
      const population = area.series.population_total[2026];
      assert.match(
        await map
          .locator('.plot-map-area[data-code="BU0363AA02"]')
          .getAttribute("aria-label"),
        new RegExp(
          population
            .toLocaleString("nl-NL")
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        ),
      );
      await openLibrary(page);
      assert.equal(
        await card(page, "population")
          .getByRole("button", {
            name: "Bevolking & leeftijd verwijderen",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      assert.match(
        await card(page, "population").textContent(),
        /In gebruik door een blok/,
      );

      // A failed refresh preserves the current bundle and its published values.
      await page.waitForFunction(() =>
        JSON.parse(
          localStorage.getItem("atlas-workspace-v1") ?? "{}",
        ).sources?.some((source) => source.sourceId === "population"),
      );
      const beforeRefresh = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("atlas-workspace-v1")).sources.find(
            (source) => source.sourceId === "population",
          ).sha256,
      );
      await card(page, "population")
        .getByRole("button", {
          name: "Bevolking & leeftijd verversen",
          exact: true,
        })
        .click();
      await card(page, "population").getByRole("alert").waitFor();
      assert.match(
        await card(page, "population").textContent(),
        /bestaande gegevens/,
      );
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("atlas-workspace-v1")).sources.find(
              (source) => source.sourceId === "population",
            ).sha256,
        ),
        beforeRefresh,
      );
      await closeLibrary(page);
      await map.locator(".axis-drop select").selectOption("woz");
      await openLibrary(page);
      const networkBeforeCache = extraRequests().length;
      await card(page, "population")
        .getByRole("button", {
          name: "Bevolking & leeftijd verwijderen",
          exact: true,
        })
        .click();
      await card(page, "population")
        .getByRole("button", {
          name: "Bevolking & leeftijd toevoegen",
          exact: true,
        })
        .waitFor();
      await card(page, "population")
        .getByRole("button", {
          name: "Bevolking & leeftijd toevoegen",
          exact: true,
        })
        .click();
      await waitLoaded(page, "population");
      assert.equal(
        extraRequests().length,
        networkBeforeCache,
        "Re-adding a cached source makes no source requests",
      );

      // Both live and snapshot failure leave the dataset unchanged; retry can recover.
      await page.route("**/data/catalog/households.json", (route) =>
        route.fulfill({ status: 503, body: "Unavailable fixture" }),
      );
      await card(page, "households")
        .getByRole("button", { name: "Huishoudens toevoegen", exact: true })
        .click();
      await card(page, "households").getByRole("alert").waitFor();
      assert.equal(
        await card(page, "households").evaluate((el) =>
          el.classList.contains("is-loaded"),
        ),
        false,
      );
      assert.equal(
        await page.locator(".source-field-group").count(),
        1,
        "A failed source publishes no partial field group",
      );
      await page.unroute("**/data/catalog/households.json");
      await card(page, "households")
        .getByRole("button", { name: "Huishoudens toevoegen", exact: true })
        .click();
      await waitLoaded(page, "households");

      // Cancel a snapshot while it is in flight. Releasing its response cannot add late variables.
      let releaseEnergy;
      const energyGate = new Promise((resolve) => {
        releaseEnergy = resolve;
      });
      let energyRequested;
      const energyStarted = new Promise((resolve) => {
        energyRequested = resolve;
      });
      await page.route("**/data/catalog/energy.json", async (route) => {
        energyRequested();
        await energyGate;
        await route
          .fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(snapshots.energy),
          })
          .catch(() => {});
      });
      await card(page, "energy")
        .getByRole("button", { name: "Energielabels toevoegen", exact: true })
        .click();
      await energyStarted;
      const aborted = page.waitForEvent("requestfailed", (request) =>
        request.url().endsWith("/data/catalog/energy.json"),
      );
      await card(page, "energy")
        .getByRole("button", {
          name: "Energielabels ophalen annuleren",
          exact: true,
        })
        .click();
      await aborted;
      releaseEnergy();
      await card(page, "energy")
        .getByRole("button", { name: "Energielabels toevoegen", exact: true })
        .waitFor();
      await page.unroute("**/data/catalog/energy.json");
      assert.equal(
        await page
          .getByRole("button", {
            name: "Energielabel A++++ t/m B toewijzen aan actief blok",
            exact: true,
          })
          .count(),
        0,
      );

      // Add independent sources concurrently, then load every remaining theme.
      await Promise.all([
        card(page, "income")
          .getByRole("button", { name: "Inkomen toevoegen", exact: true })
          .dispatchEvent("click"),
        card(page, "ownership")
          .getByRole("button", {
            name: "Koop & corporatiebezit toevoegen",
            exact: true,
          })
          .dispatchEvent("click"),
      ]);
      await Promise.all([
        waitLoaded(page, "income"),
        waitLoaded(page, "ownership"),
      ]);
      await card(page, "energy")
        .getByRole("button", { name: "Energielabels toevoegen", exact: true })
        .click();
      await waitLoaded(page, "energy");
      await card(page, "environment")
        .getByRole("button", {
          name: "Groen in de buurt toevoegen",
          exact: true,
        })
        .click();
      await waitLoaded(page, "environment");
      assert.equal(
        await page.locator(".sl-card.is-loaded").count(),
        files.length,
      );
      await page.getByRole("button", { name: /^In werkruimte/ }).click();
      assert.equal(await page.locator(".sl-card").count(), files.length);
      await closeLibrary(page);
      assert.equal(
        await page.locator(".source-field-group").count(),
        files.length,
      );
      await map.locator(".axis-drop select").selectOption("income_mean");
      assert.equal(
        await page.getByLabel("Actief bronjaar", { exact: true }).inputValue(),
        "2024",
        "Selecting a metric chooses its latest compatible source year",
      );
      await map
        .locator(".axis-drop select")
        .selectOption("environment_green_pct");
      assert.equal(
        await page.getByLabel("Actief bronjaar", { exact: true }).inputValue(),
        "2024",
        "An already compatible active year is retained",
      );
      const regression = page.locator('[data-kind="regression"]').first();
      await regression
        .locator(".axis-drop select")
        .first()
        .selectOption("population_total");
      await regression
        .locator(".axis-drop select")
        .last()
        .selectOption("income_mean");
      assert.ok(
        (await page.locator(".plot-scatter-point").count()) > 100,
        "Regression pairs variables across independently loaded sources",
      );

      await page.waitForFunction(
        (expected) =>
          JSON.parse(localStorage.getItem("atlas-workspace-v1") ?? "{}").sources
            ?.length === expected,
        files.length,
      );
      const requestsBeforeReload = extraRequests().length;
      await page.reload();
      await ready(page);
      assert.equal(
        await page.locator(".source-field-group").count(),
        files.length,
      );
      assert.equal(
        extraRequests().length,
        requestsBeforeReload,
        "Restoring a saved session needs no extra source requests",
      );
      assert.deepEqual(
        (await persistedSourceIds(page)).sort(),
        files.slice().sort(),
      );

      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Bewaar werkruimte", exact: true })
        .click();
      const download = await downloadEvent;
      const sessionPath = resolve(artifacts, `${name}-sources.atlas.json`);
      await download.saveAs(sessionPath);
      const session = JSON.parse(await readFile(sessionPath, "utf8"));
      assert.equal(session.sources.length, files.length);
      await page
        .getByLabel("Naam werkruimte", { exact: true })
        .fill("Tijdelijke naam");
      await page
        .getByLabel("CSV of Atlas-werkruimte openen")
        .setInputFiles(sessionPath);
      await page.waitForFunction(
        (name) =>
          document.querySelector('[aria-label="Naam werkruimte"]')?.value ===
          name,
        session.workspace.name,
      );
      assert.equal(
        await page.locator(".source-field-group").count(),
        files.length,
      );
      assert.equal(
        extraRequests().length,
        requestsBeforeReload,
        "Portable source snapshots reopen without network fetches",
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await openLibrary(page);
      await query(page).fill("groen");
      assert.equal(await page.locator(".sl-card").count(), 1);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Mobile library fits the viewport",
      );
      await page.screenshot({
        path: resolve(artifacts, `${name}-library-mobile.png`),
        fullPage: false,
      });
      await query(page).press("Escape");
      await page
        .locator("[data-source-library]")
        .waitFor({ state: "detached" });
      assert.deepEqual(errors, [], "No uncaught page errors");
      console.log(
        `✓ ${name}: metadata-only search/themes, six authentic source snapshots, lazy loading/cancel, atomic errors/retry, refresh preservation, in-use removal guard, IndexedDB cache, concurrent additions, cross-source regression, compatible years, portable session/reload, mobile library`,
      );
    } catch (error) {
      await page
        .screenshot({
          path: resolve(artifacts, `${name}-failure.png`),
          fullPage: false,
        })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }
} finally {
  await new Promise((done) => server.close(done));
}
