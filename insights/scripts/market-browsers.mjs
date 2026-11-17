import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const project = resolve(import.meta.dirname, "..");
const directory = resolve(project, "dist");
const artifacts = resolve(project, "../artifacts/atlas/market");
await readFile(resolve(directory, "index.html")).catch(() => {
  throw new Error("Build Atlas first: npm run build");
});
await mkdir(artifacts, { recursive: true });
const source = JSON.parse(
  await readFile(resolve(project, "public/data/market.json"), "utf8"),
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
const format = (value, digits = 1) =>
  value.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const dateFor = (period) => {
  const [year, quarter] = period.split("-Q").map(Number);
  return new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
};
const addQuarters = (period, amount) => {
  const [year, quarter] = period.split("-Q").map(Number),
    index = year * 4 + quarter - 1 + amount;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
};
const baseFor = (period) =>
  source.prices
    .filter(
      (row) =>
        row.periodEnd <= dateFor(period) &&
        row.availableAt <= dateFor(period) &&
        row.value !== null,
    )
    .at(-1);
const marketRoot = (page) =>
  page.locator('[data-market-example][data-market-ready="true"]');
async function marketReady(page) {
  await marketRoot(page).waitFor();
  await page.locator("[data-market-known-history]").waitFor();
}
async function noCurrentOutcome(page) {
  assert.equal(
    await page
      .locator(
        "[data-market-outcome-value], [data-market-future-actual], [data-market-revealed-value]",
      )
      .count(),
    0,
    "Current hidden future has no value, chart path, title or accessible outcome in the DOM",
  );
  assert.equal(
    await page.locator("[data-market-forecast]").getAttribute("data-revealed"),
    "false",
  );
}
async function analysisDownload(page, name) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Bewaar analyse", exact: true })
    .click();
  const download = await event;
  const path = resolve(artifacts, name);
  await download.saveAs(path);
  return JSON.parse(await readFile(path, "utf8"));
}
function checkCutoffs(result) {
  assert.ok(result.knownInputs.records.length > 0);
  assert.ok(
    result.knownInputs.records.every(
      (record) => record.availableAt <= result.informationCutoff,
    ),
  );
  assert.ok(
    result.backtest.every(
      (row) =>
        row.originDate <= result.informationCutoff &&
        row.actualAvailableAt <= result.informationCutoff,
    ),
  );
  assert.ok(
    result.backtest.every((row) => row.targetPeriod !== result.targetPeriod),
    "The current target is outside every historical score calculation",
  );
  if (result.neighborhoods.year !== null) {
    assert.ok(
      `${result.neighborhoods.year + 1}-01-01` <= result.informationCutoff,
    );
    assert.ok(result.neighborhoods.availableAt <= result.informationCutoff);
    assert.ok(
      result.neighborhoods.trainingYears.every(
        (year) => year < result.neighborhoods.year,
      ),
    );
  }
}
function checkFlatScore(result) {
  const score = result.scores.find((row) => row.id === "flat");
  const rows = result.backtest;
  assert.equal(score.n, rows.length);
  assert.ok(
    rows.length > 12,
    "At least a year of rolling errors supports a real comparison",
  );
  const mae = rows.reduce(
    (sum, row) =>
      sum + Math.abs(100 * (row.actualIndex / row.baseIndex - 1)) / rows.length,
    0,
  );
  const rmse = Math.sqrt(
    rows.reduce(
      (sum, row) => sum + (row.baseIndex - row.actualIndex) ** 2 / rows.length,
      0,
    ),
  );
  assert.ok(
    Math.abs(score.maeGrowthPP - mae) < 1e-8,
    "Flat-baseline growth score agrees with independent source arithmetic",
  );
  assert.ok(Math.abs(score.rmseIndex - rmse) < 1e-8);
  assert.ok(rows.every((row) => row.predictions.flat === row.baseIndex));
  assert.equal(
    new Set(result.scores.map((row) => row.n)).size,
    1,
    "All models use identical completed test periods",
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
      viewport: { width: 1512, height: 1050 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    try {
      await page.goto(origin);
      await page.locator('[data-ready="true"]').waitFor();
      assert.equal(
        requests.filter((url) => url.endsWith("/data/market.json")).length,
        0,
        "Market data stays lazy until the example opens",
      );
      await page
        .getByLabel("Naam werkruimte", { exact: true })
        .fill("Mijn bewaarde werkruimte");
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem("atlas-workspace-v1") ?? "{}")
            .workspace?.name === "Mijn bewaarde werkruimte",
      );
      const blocksBefore = await page
        .locator(".insight-block")
        .evaluateAll((elements) => elements.map((element) => element.id));
      await page
        .getByRole("button", { name: "Woningmarkt tijdmachine", exact: true })
        .click();
      await marketReady(page);
      assert.ok(requests.some((url) => url.endsWith("/data/market.json")));
      assert.equal(
        await page.getByLabel("Voorspeldatum", { exact: true }).inputValue(),
        "2021-Q4",
      );
      assert.equal(
        await page.getByLabel("Voorspelhorizon", { exact: true }).inputValue(),
        "4",
      );
      assert.equal(
        await page.getByLabel("Voorspelmodel", { exact: true }).inputValue(),
        "rates",
      );
      await noCurrentOutcome(page);
      assert.equal(await page.locator("[data-market-prediction]").count(), 4);
      await page.screenshot({
        path: resolve(artifacts, `${name}-hidden-desktop.png`),
        fullPage: true,
      });

      const hidden = await analysisDownload(page, `${name}-hidden.json`);
      assert.equal(hidden.format, "atlas-market-analysis");
      assert.equal(hidden.origin, "2021-Q4");
      assert.equal(
        hidden.targetPeriod,
        addQuarters(hidden.origin, hidden.horizon),
      );
      assert.equal(
        hidden.knownInputs.basePeriod,
        baseFor(hidden.origin).period,
      );
      assert.equal(hidden.knownInputs.baseIndex, baseFor(hidden.origin).value);
      assert.equal(Object.hasOwn(hidden, "revealedOutcome"), false);
      checkCutoffs(hidden);
      checkFlatScore(hidden);
      assert.equal(
        hidden.neighborhoods.year,
        2020,
        "Default WOZ analysis uses only years usable before the prediction origin",
      );

      await page
        .getByLabel("Voorspelmodel", { exact: true })
        .selectOption("flat");
      assert.equal(
        await page.locator("[data-market-prediction-value]").textContent(),
        format(baseFor("2021-Q4").value),
      );
      const flatScore = hidden.scores.find((row) => row.id === "flat");
      const flatRow = page
        .locator(".market-score-table tbody tr")
        .filter({
          has: page.getByRole("button", { name: /Prijs blijft gelijk/ }),
        });
      assert.equal(
        (await flatRow.locator("td").nth(1).textContent()).trim(),
        format(flatScore.maeGrowthPP, 2),
      );
      assert.equal(
        (await flatRow.locator("td").nth(2).textContent()).trim(),
        format(flatScore.rmseIndex, 2),
      );
      await page.getByLabel("Vergelijk modellen", { exact: true }).uncheck();
      assert.equal(await page.locator("[data-market-prediction]").count(), 1);
      assert.equal(
        await page
          .locator("[data-market-prediction]")
          .getAttribute("data-market-prediction"),
        "flat",
      );
      await page.getByLabel("Vergelijk modellen", { exact: true }).check();
      await page
        .getByRole("button", {
          name: "Onthul werkelijke uitkomst",
          exact: true,
        })
        .click();
      const targetActual = source.prices.find(
        (row) => row.period === hidden.targetPeriod,
      ).value;
      assert.equal(
        await page.locator("[data-market-outcome-value]").textContent(),
        format(targetActual),
      );
      assert.equal(
        await page.locator("[data-market-future-actual]").count(),
        1,
      );
      const revealed = await analysisDownload(page, `${name}-revealed.json`);
      assert.equal(revealed.revealedOutcome.index, targetActual);
      assert.equal(revealed.revealedOutcome.period, hidden.targetPeriod);
      assert.deepEqual(
        revealed.scores,
        hidden.scores,
        "Revealing the target never changes historical scores",
      );
      await page
        .getByRole("button", {
          name: "Verberg werkelijke uitkomst",
          exact: true,
        })
        .click();
      await noCurrentOutcome(page);

      await page
        .getByLabel("Voorspelmodel", { exact: true })
        .selectOption("rates");
      const scoresBeforeScenario = await page
        .locator(".market-score-table")
        .textContent();
      const range = page.getByLabel(
        "Rente-aanname aanpassen in procentpunten",
        { exact: true },
      );
      await range.focus();
      await range.press("End");
      assert.equal(await range.inputValue(), "2");
      const scenario = await analysisDownload(page, `${name}-scenario.json`);
      assert.equal(scenario.rateDelta, 2);
      assert.equal(scenario.model, "rates");
      assert.deepEqual(scenario.scores, hidden.scores);
      assert.equal(
        await page.locator(".market-score-table").textContent(),
        scoresBeforeScenario,
      );
      for (const id of ["flat", "momentum", "trend"])
        assert.equal(
          scenario.forecasts.find((row) => row.id === id).predictedIndex,
          hidden.forecasts.find((row) => row.id === id).predictedIndex,
        );
      assert.notEqual(
        scenario.forecasts.find((row) => row.id === "rates").predictedIndex,
        hidden.forecasts.find((row) => row.id === "rates").predictedIndex,
      );
      assert.equal(
        scenario.forecasts.find((row) => row.id === "rates").interval,
        null,
      );
      assert.equal(
        await page.locator('[data-market-interval="rates"]').count(),
        0,
      );
      await page
        .getByRole("button", { name: "Rentescenario herstellen", exact: true })
        .click();
      assert.equal(await range.inputValue(), "0");

      await page.locator(".market-knowledge summary").click();
      const dates = await page
        .locator(".market-input-table tbody tr")
        .evaluateAll((rows) =>
          rows.map((row) => row.lastElementChild.textContent),
        );
      assert.ok(
        dates.length > 0 &&
          dates.every((date) => date <= hidden.informationCutoff),
      );
      await page.locator(".market-knowledge summary").click();
      const search = page.getByLabel("Zoek buurt in woningmarktanalyse", {
        exact: true,
      });
      await search.fill("Westelijke eilanden");
      assert.equal(await page.locator(".market-local-list button").count(), 1);
      await page.locator(".market-local-list button").click();
      assert.equal(
        await page.locator(".market-area-detail h3").textContent(),
        "Westelijke eilanden",
      );
      assert.equal(
        await page
          .locator('.market-geo .plot-map-area[data-code="BU0363AA02"]')
          .getAttribute("aria-pressed"),
        "true",
      );
      await page
        .locator(".market-area-detail")
        .getByRole("button", { name: "Alle buurten", exact: true })
        .click();
      await search.fill("");
      const polygon = page.locator(
        '.market-geo .plot-map-area[data-code="BU0363AA02"]',
      );
      await polygon.focus();
      await polygon.press("Enter");
      assert.equal(
        await page.locator(".market-area-detail h3").textContent(),
        "Westelijke eilanden",
      );
      await page
        .locator(".market-area-detail")
        .getByRole("button", { name: "Alle buurten", exact: true })
        .click();

      const csvEvent = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: "Download historische voorspelfouten",
          exact: true,
        })
        .click();
      const csv = await csvEvent;
      const csvPath = resolve(artifacts, `${name}-backtest.csv`);
      await csv.saveAs(csvPath);
      const exportedCsv = await readFile(csvPath, "utf8");
      assert.match(exportedCsv, /fout_pp/);
      assert.match(exportedCsv, /informatiegrens/);
      assert.match(exportedCsv, /gereconstrueerd/);
      assert.equal(
        exportedCsv.trim().split(/\r?\n/).length,
        hidden.backtest.length + 1,
      );
      await page
        .getByRole("button", {
          name: "Bronnen, methode en grenzen",
          exact: true,
        })
        .click();
      assert.match(
        await page.locator(".market-method-content").textContent(),
        /60 kalenderdagen/,
      );
      assert.match(
        await page.locator(".market-method-content").textContent(),
        /geen archief/,
      );

      // Changing origin/horizon clears any revealed target and resets the rate scenario.
      await page
        .getByLabel("Voorspelhorizon", { exact: true })
        .selectOption("1");
      await noCurrentOutcome(page);
      const h1 = await analysisDownload(page, `${name}-horizon1.json`);
      assert.equal(h1.targetPeriod, "2022-Q1");
      checkCutoffs(h1);
      checkFlatScore(h1);
      await page
        .getByRole("button", {
          name: "Onthul werkelijke uitkomst",
          exact: true,
        })
        .click();
      await page
        .getByLabel("Voorspeldatum", { exact: true })
        .selectOption("2010-Q1");
      await noCurrentOutcome(page);
      await page.locator(".market-empty-local").waitFor();
      const early = await analysisDownload(page, `${name}-early.json`);
      assert.equal(early.knownInputs.baseIndex, baseFor("2010-Q1").value);
      assert.equal(early.neighborhoods.year, null);
      checkCutoffs(early);

      await page
        .getByLabel("Voorspeldatum", { exact: true })
        .selectOption("2026-Q3");
      await page
        .getByLabel("Voorspelhorizon", { exact: true })
        .selectOption("4");
      await noCurrentOutcome(page);
      assert.equal(
        await page
          .getByRole("button", {
            name: "Onthul werkelijke uitkomst",
            exact: true,
          })
          .isDisabled(),
        true,
      );
      await page
        .getByLabel("Voorspeldatum", { exact: true })
        .selectOption("2021-Q4");
      await page
        .getByLabel("Voorspelhorizon", { exact: true })
        .selectOption("1");
      await page
        .getByLabel("Voorspelmodel", { exact: true })
        .selectOption("trend");
      await page
        .getByRole("button", {
          name: "Onthul werkelijke uitkomst",
          exact: true,
        })
        .click();
      await page.reload();
      await marketReady(page);
      assert.equal(
        await page.getByLabel("Voorspeldatum", { exact: true }).inputValue(),
        "2021-Q4",
      );
      assert.equal(
        await page.getByLabel("Voorspelhorizon", { exact: true }).inputValue(),
        "1",
      );
      assert.equal(
        await page.getByLabel("Voorspelmodel", { exact: true }).inputValue(),
        "trend",
      );
      await noCurrentOutcome(page);

      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Market example must fit a390px viewport",
      );
      await page.screenshot({
        path: resolve(artifacts, `${name}-mobile.png`),
        fullPage: false,
      });
      await page
        .locator(".market-main-chart")
        .screenshot({ path: resolve(artifacts, `${name}-mobile-chart.png`) });
      const tickSize = await page
        .locator(".market-main-chart .market-chart-tick")
        .first()
        .evaluate((element) => {
          const svg = element.ownerSVGElement;
          return (
            (parseFloat(getComputedStyle(element).fontSize) *
              svg.getBoundingClientRect().width) /
            svg.viewBox.baseVal.width
          );
        });
      assert.ok(
        tickSize >= 10,
        "Mobile chart ticks retain readable pixel size",
      );
      await page
        .getByRole("button", { name: "Terug naar je werkruimte", exact: true })
        .click();
      await page.locator('[data-ready="true"]').waitFor();
      assert.equal(
        await page.getByLabel("Naam werkruimte", { exact: true }).inputValue(),
        "Mijn bewaarde werkruimte",
      );
      assert.deepEqual(
        await page
          .locator(".insight-block")
          .evaluateAll((elements) => elements.map((element) => element.id)),
        blocksBefore,
      );

      // A failed market snapshot presents a retry and recovers without rebuilding the app.
      const failureContext = await browser.newContext({
        viewport: { width: 1200, height: 900 },
      });
      const failed = await failureContext.newPage();
      await failed.route("**/data/market.json", (route) =>
        route.fulfill({ status: 503, body: "Unavailable" }),
      );
      await failed.goto(`${origin}/#woningmarkt`);
      await failed
        .getByRole("heading", {
          name: "De marktdata konden niet worden geopend",
          exact: true,
        })
        .waitFor();
      await failed.unroute("**/data/market.json");
      await failed
        .getByRole("button", {
          name: "Marktdata opnieuw proberen",
          exact: true,
        })
        .click();
      await marketReady(failed);
      await failureContext.close();
      assert.deepEqual(errors, [], "No uncaught browser errors");
      console.log(
        `✓ ${name}: lazy market data, hidden future DOM/export and reveal, independent baseline and score arithmetic, horizon/origin boundaries, cutoff inputs and WOZ, scenario isolation, linked neighborhoods, exports, URL reset, mobile readable plots, preserved workspace, source retry`,
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
