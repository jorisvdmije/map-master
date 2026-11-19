import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const project = resolve(import.meta.dirname, "..");
const directory = resolve(project, "dist");
const artifacts = resolve(project, "../artifacts/atlas");
await readFile(resolve(directory, "index.html")).catch(() => {
  throw new Error("Build Atlas first: npm run build");
});
await mkdir(artifacts, { recursive: true });
const snapshot = JSON.parse(
  await readFile(
    resolve(project, "public/data/amsterdam-development.json"),
    "utf8",
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
const selectors = {
  map: '[data-kind="map"]',
  timeseries: '[data-kind="timeseries"]',
  regression: '[data-kind="regression"]',
};
const expectedPairs = snapshot.areas.filter(
  (area) => area.woz[2026] !== null && area.homes[2026] !== null,
).length;

async function ready(page) {
  await page.locator('[data-ready="true"]').waitFor();
  await page.locator(".plot-map-area").first().waitFor();
}
async function count(page, expected) {
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll(".insight-block").length === expected,
    expected,
  );
}
async function dragVariable(page, label, target) {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByRole("button", {
      name: `${label} toewijzen aan actief blok`,
      exact: true,
    })
    .dispatchEvent("dragstart", { dataTransfer: transfer });
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
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
      viewport: { width: 1512, height: 1050 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(origin);
      await ready(page);
      await count(page, 4);
      assert.equal(
        await page.locator(".plot-map-area").count(),
        snapshot.areas.length,
      );
      assert.equal(
        await page.locator(".plot-scatter-point").count(),
        expectedPairs,
      );
      assert.ok((await page.locator(".plot-time path[stroke]").count()) >= 2);
      assert.equal(
        await page.getByLabel("Actief bronjaar", { exact: true }).inputValue(),
        "2026",
      );
      await page.screenshot({
        path: resolve(artifacts, `${name}-desktop.png`),
        fullPage: true,
      });

      const map = page.locator(selectors.map).first();
      await map.locator(".axis-drop select").selectOption("homes");
      assert.equal(
        await map.locator(".axis-drop select").inputValue(),
        "homes",
      );
      await dragVariable(page, "WOZ-groei", map.locator(".axis-drop"));
      assert.equal(
        await map.locator(".axis-drop select").inputValue(),
        "wozGrowth",
      );
      await map.locator(".axis-drop select").selectOption("woz");

      await page.getByLabel("Beginjaar", { exact: true }).selectOption("2012");
      await page
        .getByRole("button", { name: "Toon bronjaar 2020", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Actief bronjaar", { exact: true }).inputValue(),
        "2020",
      );
      await page
        .getByRole("button", { name: "Tijdlijn afspelen", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector(".current-year")?.textContent === "2021",
      );
      await page
        .getByRole("button", { name: "Tijdlijn pauzeren", exact: true })
        .click();
      await page.getByLabel("Actief bronjaar", { exact: true }).focus();
      await page.keyboard.press("End");
      assert.equal(
        await page.getByLabel("Actief bronjaar", { exact: true }).inputValue(),
        "2026",
      );

      const selectedArea = map.locator(
        '.plot-map-area[data-code="BU0363AA02"]',
      );
      await selectedArea.focus();
      await page.keyboard.press("Enter");
      assert.equal(await selectedArea.getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: /^Alle buurten/ }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".plot-scatter-point").length === 1,
      );
      assert.match(
        await page.locator(".plot-series-legend").textContent(),
        /Westelijke eilanden/,
      );
      await page
        .getByRole("button", { name: "Selectie wissen", exact: true })
        .click();
      await page.waitForFunction(
        (expected) =>
          document.querySelectorAll(".plot-scatter-point").length === expected,
        expectedPairs,
      );

      // Independently derive the full-period ranking from the published snapshot.
      const expectedGrowth = snapshot.areas
        .filter(
          (a) =>
            a.woz[2012] > 0 &&
            a.woz[2026] !== null &&
            !a.breakYears?.some((y) => y > 2012 && y <= 2026),
        )
        .map((a) => ({
          name: a.name,
          growth: 100 * (a.woz[2026] / a.woz[2012] - 1),
        }))
        .sort((a, b) => b.growth - a.growth)[0];
      const ranking = page.locator('[data-kind="ranking"]').first();
      await ranking
        .getByRole("button", { name: "Periodegroei", exact: true })
        .click();
      assert.equal(
        await ranking.locator(".rank-main>span").first().textContent(),
        expectedGrowth.name,
      );
      assert.match(
        await ranking
          .locator(".ranking-list>button>strong")
          .first()
          .textContent(),
        new RegExp(
          expectedGrowth.growth.toLocaleString("nl-NL", {
            maximumFractionDigits: 1,
          }) + "%",
        ),
      );
      await ranking
        .getByRole("button", { name: "Waarde", exact: true })
        .click();

      const order = await page
        .locator(".insight-block")
        .evaluateAll((els) => els.map((el) => el.id));
      await map.locator(".block-menu summary").click();
      await map.getByRole("button", { name: "Omlaag", exact: true }).click();
      assert.equal(
        await page.locator(".insight-block").first().getAttribute("id"),
        order[1],
      );

      await page.getByRole("tab", { name: "Blokken", exact: true }).click();
      for (const [i, label] of [
        "Kaart",
        "Tijdreeks",
        "Regressie",
        "Ranglijst",
        "Datatabel",
        "Kerncijfer",
      ].entries()) {
        await page
          .locator(".sidebar-blocks button")
          .filter({
            has: page.locator("strong", { hasText: new RegExp(`^${label}$`) }),
          })
          .click();
        await count(page, 5 + i);
      }
      const last = page.locator(".insight-block").last();
      await last.locator(".block-menu summary").click();
      await last
        .getByRole("button", { name: "Verwijderen", exact: true })
        .click();
      await count(page, 9);
      await page
        .getByRole("button", { name: "Ongedaan maken", exact: true })
        .click();
      await count(page, 10);
      await page
        .getByRole("button", { name: "Opnieuw uitvoeren", exact: true })
        .click();
      await count(page, 9);

      await page.keyboard.press("Control+k");
      const command = page.getByRole("combobox", {
        name: "Zoek data, blokken en functies",
      });
      await command.fill("Leeg canvas");
      await command.press("Enter");
      await count(page, 0);
      await page
        .getByRole("button", { name: "Ongedaan maken", exact: true })
        .click();
      await count(page, 9);
      await page.keyboard.press("Control+k");
      await command.fill("geen resultaat 998877");
      assert.match(
        await page.locator('[role="dialog"]').textContent(),
        /Geen resultaten/,
      );
      await command.press("Escape");

      // These explicit fixture prices test imported observations; they are not published source values.
      const fixture =
        "buurtcode,jaar,prijs_m2\nBU0363AA02,2016,4000\nBU0363AA02,2020,6000\nBU0363AA02,2026,8000\nBU0363AB03,2026,8500\nBU0363AA03,2026,9000\n";
      await page.getByLabel("CSV of Atlas-werkruimte openen").setInputFiles({
        name: "test-prices.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(fixture),
      });
      await page
        .getByRole("heading", { name: "Geef je kolommen betekenis" })
        .waitFor();
      await page
        .getByRole("button", { name: "Variabele toevoegen", exact: true })
        .click();
      await page.getByRole("tab", { name: "Data", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Vierkantemeterprijs toewijzen aan actief blok",
          exact: true,
        })
        .waitFor();
      const time = page.locator(selectors.timeseries).first();
      await time.locator(".axis-drop select").last().selectOption("priceM2");
      assert.match(
        await time.locator(".plot-series-legend").textContent(),
        /8\.000/,
      );
      await time.getByRole("button", { name: "Index", exact: true }).click();
      assert.match(
        await time.locator(".block-foot").textContent(),
        /2012 = 100/,
      );
      await time.getByRole("button", { name: "Waarde", exact: true }).click();

      await page
        .getByLabel("Naam werkruimte", { exact: true })
        .fill("Browsercheck met eigen m²-prijs");
      await page.waitForFunction(() => {
        const raw = localStorage.getItem("atlas-workspace-v1");
        return (
          raw &&
          JSON.parse(raw).workspace.name === "Browsercheck met eigen m²-prijs"
        );
      });
      await page.reload();
      await ready(page);
      await count(page, 9);
      assert.equal(
        await page.getByLabel("Naam werkruimte", { exact: true }).inputValue(),
        "Browsercheck met eigen m²-prijs",
      );
      assert.equal(
        await page
          .locator(selectors.timeseries)
          .first()
          .locator(".axis-drop select")
          .last()
          .inputValue(),
        "priceM2",
      );

      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Bewaar werkruimte", exact: true })
        .click();
      const saved = await downloadEvent;
      const savedPath = resolve(artifacts, `${name}-workspace.atlas.json`);
      await saved.saveAs(savedPath);
      const savedSession = JSON.parse(await readFile(savedPath, "utf8"));
      assert.equal(savedSession.format, "atlas");
      assert.equal(savedSession.imports.length, 1);
      await page
        .getByLabel("Naam werkruimte", { exact: true })
        .fill("Tijdelijke naam");
      await page
        .getByLabel("CSV of Atlas-werkruimte openen")
        .setInputFiles(savedPath);
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Naam werkruimte"]')?.value ===
          "Browsercheck met eigen m²-prijs",
      );

      const table = page.locator('[data-kind="table"]').first();
      await table.locator(".axis-drop select").selectOption("priceM2");
      await table.locator(".block-menu summary").click();
      const csvEvent = page.waitForEvent("download");
      await table
        .getByRole("button", { name: "Cijfers als CSV", exact: true })
        .click();
      const csvDownload = await csvEvent;
      const csvPath = resolve(artifacts, `${name}-export.csv`);
      await csvDownload.saveAs(csvPath);
      const exported = await readFile(csvPath, "utf8");
      assert.match(exported, /buurtcode/);
      assert.match(exported, /priceM2/);
      assert.match(exported, /Eigen CSV-import/);
      assert.match(exported, /8000/);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Mobile workspace must not overflow horizontally",
      );
      await page.screenshot({
        path: resolve(artifacts, `${name}-mobile.png`),
        fullPage: false,
      });
      await page.keyboard.press("Control+k");
      await command.fill("Bronnen en definities");
      await command.press("Enter");
      await page
        .getByRole("heading", { name: "Inzicht begint bij de bron" })
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Mobile dialog must fit viewport",
      );
      await page
        .getByRole("button", { name: "Venster sluiten", exact: true })
        .click();

      // Failed source requests must settle, then recover through the visible retry action.
      const offline = await browser.newContext({
        viewport: { width: 1200, height: 900 },
      });
      const failedPage = await offline.newPage();
      await failedPage.route("**/data/amsterdam-development.json", (route) =>
        route.fulfill({ status: 503, body: "Unavailable" }),
      );
      await failedPage.goto(origin);
      await failedPage
        .getByRole("heading", { name: "De bron is even niet bereikbaar" })
        .waitFor();
      await failedPage.unroute("**/data/amsterdam-development.json");
      await failedPage
        .getByRole("button", { name: "Opnieuw proberen", exact: true })
        .click();
      await ready(failedPage);
      await failedPage.evaluate(() =>
        localStorage.setItem("atlas-workspace-v1", "{broken-json"),
      );
      await failedPage.reload();
      await ready(failedPage);
      await failedPage.waitForFunction(() =>
        document
          .querySelector(".workspace-footer")
          ?.textContent.includes("Herstel mislukt"),
      );
      assert.equal(
        await failedPage.evaluate(() =>
          localStorage.getItem("atlas-workspace-v1"),
        ),
        "{broken-json",
      );
      await offline.close();

      assert.deepEqual(errors, [], "No uncaught browser errors");
      console.log(
        `✓ ${name}: authentic map and paired regression; variable drag/drop and menus; timeline and linked selection; six block types, reorder and undo; command search; CSV import/export; session reload/reimport; mobile layout; source retry`,
      );
    } catch (error) {
      await page
        .screenshot({
          path: resolve(artifacts, `${name}-failure.png`),
          fullPage: true,
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
