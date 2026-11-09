import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { createStaticServer } from "./lib/static-server.mjs";

const site = resolve(import.meta.dirname, "..");
const output = resolve(site, "../artifacts/development");
mkdirSync(output, { recursive: true });
const { basePath } = JSON.parse(readFileSync(resolve(site, "dist/.build-info.json")));
const snapshot = JSON.parse(readFileSync(resolve(site, "src/features/development/snapshot.json")));
const server = createStaticServer({ directory: resolve(site, "dist"), basePath });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const root = `${origin}${basePath}`;
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["chromium", "firefox", "webkit"];
const results = [];
const defaults = { start: 2016, end: 2026, minimum: 100, stockFilter: true, maxStockChange: 20, query: "" };
const fmtPercent = (value) => `${value > 0 ? "+" : ""}${value.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
// Independent expectations from the official snapshot; no browser-model import.
function expected(filters) {
  return snapshot.areas.flatMap((area) => {
    if (area.breakYears?.some((year) => year > filters.start && year <= filters.end)) return [];
    const start = area.woz[filters.start], end = area.woz[filters.end];
    if (start === null || start <= 0 || end === null) return [];
    const firstStock = area.homes[filters.start], lastStock = area.homes[filters.end];
    if (filters.minimum > 0 && (firstStock === null || lastStock === null || firstStock < filters.minimum || lastStock < filters.minimum)) return [];
    if (filters.stockFilter) {
      if (firstStock === null || firstStock <= 0) return [];
      for (let year = filters.start; year <= filters.end; year++) {
        const stock = area.homes[year];
        if (stock === null || Math.abs(100 * (stock / firstStock - 1)) > filters.maxStockChange + 1e-9) return [];
      }
    }
    if (!`${area.name} ${area.code}`.toLocaleLowerCase("nl-NL").includes(filters.query.trim().toLocaleLowerCase("nl-NL"))) return [];
    return [{ area, growth: 100 * (end / start - 1), startValue: start, endValue: end }];
  }).sort((a, b) => b.growth - a.growth || a.area.code.localeCompare(b.area.code));
}

try {
  for (const name of names) {
    assert.ok(["chromium", "firefox", "webkit"].includes(name), `Unknown browser: ${name}`);
    const browser = await { chromium, firefox, webkit }[name].launch({
      headless: (process.env.GEO_DOCS_HEADED ?? process.env.GEO_COMPAT_HEADED) !== "1",
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    const filters = { ...defaults };
    const expectCount = async () => {
      const count = expected(filters).length;
      await page.waitForFunction((count) => Number(document.querySelector('[data-stat="neighborhoods"]')?.textContent) === count, count);
      return count;
    };
    const choosePeriod = async (length) => {
      filters.start = length === "all" ? snapshot.meta.years[0] : snapshot.meta.years.at(-1) - length;
      filters.end = snapshot.meta.years.at(-1);
      await page.getByRole("button", { name: length === "all" ? "Hele reeks" : `${length} jaar`, exact: true }).click();
      await expectCount();
      assert.equal(await page.getByLabel("Van bronjaar", { exact: true }).inputValue(), String(filters.start));
      assert.equal(await page.getByLabel("Tot bronjaar", { exact: true }).inputValue(), String(filters.end));
    };
    const expectSelected = async (area) => {
      await page.locator(`[data-development][data-selected="${area.code}"]`).waitFor();
      await page.waitForFunction((name) => {
        const heading = document.getElementById("development-profile-title");
        return heading?.textContent === name && document.activeElement === heading;
      }, area.name);
      assert.equal(await page.locator(`.bd-map path[data-code="${area.code}"]`).getAttribute("data-selected"), "true");
    };
    try {
      await page.goto(`${root}/data/bbga/`);
      await page.locator("[data-dataset-detail=bbga]").waitFor();
      assert.ok(!requests.some((url) => /\/data\/amsterdam-(development|housing|roads|street-observations)/.test(url)), "A source profile loads metadata before the user chooses an analysis");
      await page.getByRole("link", { name: "Open buurtontwikkeling", exact: true }).click();
      await page.locator("[data-development][data-ready=true]").waitFor();
      const initialCount = await expectCount();
      assert.ok(initialCount > 200);
      assert.equal(await page.locator('[data-stat="city-growth"]').textContent(), "—", "The city comparison must not cross the Weesp boundary break");
      assert.ok(requests.some((url) => url.endsWith("/data/amsterdam-development.json")));
      assert.ok(requests.some((url) => url.endsWith("/data/amsterdam-development-geometry.json")));
      assert.ok(!requests.some((url) => new URL(url).origin !== origin), "Opening this analysis uses local official snapshots without external API requests");

      for (const length of [1, 5, 10, "all"]) {
        await choosePeriod(length);
        if (length === 1) {
          const cityGrowth = 100 * (snapshot.city.woz[filters.end] / snapshot.city.woz[filters.start] - 1);
          assert.equal(await page.locator('[data-stat="city-growth"]').textContent(), fmtPercent(cityGrowth));
        }
      }
      await choosePeriod(10);
      await page.getByLabel("Beperk nieuwbouweffect", { exact: true }).uncheck();
      filters.stockFilter = false;
      assert.ok(await expectCount() > initialCount, "Disabling the stock filter reveals areas with major stock changes");
      assert.equal(await page.getByLabel("Maximale voorraadverandering", { exact: true }).isDisabled(), true);
      await page.getByLabel("Beperk nieuwbouweffect", { exact: true }).check();
      filters.stockFilter = true;
      await expectCount();
      for (const minimum of [20, 500, 100]) {
        filters.minimum = minimum;
        await page.getByLabel("Minimaal woningen", { exact: true }).selectOption(String(minimum));
        await expectCount();
      }
      for (const threshold of [10, 50, 20]) {
        filters.maxStockChange = threshold;
        await page.getByLabel("Maximale voorraadverandering", { exact: true }).selectOption(String(threshold));
        await expectCount();
      }

      const target = expected(filters).find(({ area }) =>
        snapshot.meta.years.filter((year) => year >= filters.start && year <= filters.end)
          .every((year) => typeof area.woz[year] === "number"),
      )?.area;
      assert.ok(target, "A stable neighborhood has a complete WOZ timeline for the profile check");
      filters.query = target.code;
      await page.getByLabel("Zoek je buurt", { exact: true }).fill(target.code);
      assert.equal(await expectCount(), 1);
      await page.getByRole("button", { name: target.name, exact: true }).click();
      await expectSelected(target);
      assert.equal(await page.locator(".bd-timeline .bd-series-area circle").count(), filters.end - filters.start + 1);
      await page.getByLabel("Tijdlijn tonen als", { exact: true }).selectOption("euro");
      await page.locator(".bd-timeline .bd-chart-data summary").click();
      const table = page.getByRole("region", { name: "WOZ-tijdlijntabel", exact: true });
      assert.equal(await table.locator("tbody tr").count(), filters.end - filters.start + 1);
      assert.match(await table.textContent(), new RegExp(`1 januari ${filters.start - 1}`));
      assert.match(await table.textContent(), new RegExp(`1 januari ${filters.end - 1}`));
      assert.equal(await table.locator("thead th").count(), 4, "Euro table contains dates and the two raw series");
      await page.getByLabel("Tijdlijn tonen als", { exact: true }).selectOption("index");
      assert.equal(await table.locator("thead th").count(), 6, "Index table retains raw values alongside both indices");
      await page.getByLabel("Tijdlijn tonen als", { exact: true }).selectOption("euro");

      const [jsonDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "JSON met bronmetadata", exact: true }).click(),
      ]);
      const exported = JSON.parse(readFileSync(await jsonDownload.path()));
      assert.deepEqual(exported.filters, filters);
      assert.equal(exported.selected, target.code);
      assert.equal(exported.selectedArea.code, target.code);
      assert.equal(exported.indexed, false);
      assert.equal(exported.provenance.sha256, snapshot.meta.sha256);
      assert.deepEqual(exported.provenance.sources, snapshot.meta.sources);
      assert.equal(exported.results.length, 1);
      assert.equal(exported.results[0].area.code, target.code);
      assert.equal(exported.results[0].growth, expected(filters)[0].growth);
      assert.equal(exported.city.code, snapshot.city.code);
      const [csvDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "CSV downloaden", exact: true }).click(),
      ]);
      const csv = readFileSync(await csvDownload.path(), "utf8");
      assert.ok(csv.startsWith("\uFEFF"));
      assert.equal(csv.split("\r\n").length, 2);
      assert.ok(csv.includes('"waardepeildatum_start"'));
      assert.ok(csv.includes(`"${filters.start - 1}-01-01"`));
      assert.ok(csv.includes(`"${filters.end - 1}-01-01"`));
      assert.ok(csv.includes(`"${target.code}"`));
      assert.ok(csv.includes(`"${expected(filters)[0].growth}"`));

      await page.getByRole("button", { name: "Deel weergave", exact: true }).click();
      await page.waitForFunction(() => new URLSearchParams(location.search).has("view"));
      const shared = JSON.parse(new URL(page.url()).searchParams.get("view"));
      assert.equal(shared.app, "development");
      assert.equal(shared.data.selected, target.code);
      assert.equal(shared.data.query, target.code);
      assert.equal(shared.data.indexed, false);
      await page.reload();
      await page.locator(`[data-development][data-ready=true][data-selected="${target.code}"]`).waitFor();
      await page.waitForFunction((query) => document.querySelector('input[aria-label="Zoek je buurt"]')?.value === query, target.code);
      await expectCount();
      assert.equal(await page.getByLabel("Tijdlijn tonen als", { exact: true }).inputValue(), "euro");
      await page.goBack();
      Object.assign(filters, defaults);
      await page.waitForFunction(() => document.querySelector('input[aria-label="Zoek je buurt"]')?.value === "");
      await expectCount();
      assert.equal(await page.locator("[data-development]").getAttribute("data-selected"), "");
      assert.equal(await page.getByLabel("Tijdlijn tonen als", { exact: true }).inputValue(), "index");

      // Choose an actual interior SVG point, including narrow or multipart neighborhoods.
      const mapTarget = expected(filters)[1].area;
      const path = page.locator(`.bd-map path[data-code="${mapTarget.code}"]`);
      await path.scrollIntoViewIfNeeded();
      const interior = await path.evaluate((element) => {
        const bounds = element.getBBox(), transform = element.getScreenCTM();
        const fractions = [.5, .4, .6, .3, .7, .2, .8, .1, .9, .05, .95];
        if (!transform) return null;
        for (const row of fractions) for (const col of fractions) {
          const point = new DOMPoint(bounds.x + bounds.width * col, bounds.y + bounds.height * row);
          if (element.isPointInFill(point)) {
            const screen = point.matrixTransform(transform);
            // SVG geometry hit tests and painted hit targets can differ near
            // holes/borders. The real pointer target must be this exact path.
            if ([[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) =>
              document.elementFromPoint(screen.x + dx, screen.y + dy) === element,
            )) return { x: screen.x, y: screen.y };
          }
        }
        return null;
      });
      assert.ok(interior, "The selected map neighborhood has a click target inside its polygon");
      await page.mouse.click(interior.x, interior.y);
      await expectSelected(mapTarget);

      await page.getByRole("button", { name: /Hoe deed mijn buurt het\?/ }).click();
      assert.equal(await page.getByLabel("Zoek je buurt", { exact: true }).evaluate((element) => element === document.activeElement), true);
      await page.getByLabel("Zoek je buurt", { exact: true }).fill("no-neighborhood-293874");
      filters.query = "no-neighborhood-293874";
      await expectCount();
      await page.getByRole("heading", { name: "Geen buurten binnen deze selectie", exact: true }).waitFor();
      assert.equal(await page.locator(".bd-map-area").count(), 0);
      assert.ok(!(await page.locator(".bd-map svg").innerHTML()).match(/NaN|Infinity/));
      assert.match(await page.locator(".bd-profile .bd-notice").first().textContent(), /buiten de huidige selectie/);
      const [outsideDownload] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "JSON met bronmetadata", exact: true }).click(),
      ]);
      const outside = JSON.parse(readFileSync(await outsideDownload.path()));
      assert.equal(outside.results.length, 0);
      assert.equal(outside.selectedArea.code, mapTarget.code, "The exported profile survives a search that excludes its neighborhood");
      assert.deepEqual(outside.selectedArea.woz, mapTarget.woz);
      await page.getByRole("button", { name: "Buurtselectie wissen", exact: true }).click();
      assert.equal(await page.locator("[data-development]").getAttribute("data-selected"), "");
      await page.getByRole("button", { name: /Welke buurt steeg het hardst\?/ }).click();
      Object.assign(filters, defaults);
      await expectCount();
      await page.getByRole("button", { name: /Wat veranderde het laatste jaar\?/ }).click();
      filters.start = 2025;
      await expectCount();
      assert.equal(await page.getByLabel("Van bronjaar", { exact: true }).inputValue(), "2025");

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator(".bd-visuals").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, `${name}-desktop.png`), fullPage: false });
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no page overflow at ${width}px`);
        await page.locator(".bd-profile").scrollIntoViewIfNeeded();
        if (width === 390) await page.screenshot({ path: resolve(output, `${name}-mobile.png`), fullPage: false });
      }
      assert.deepEqual(errors, []);

      // A failed local snapshot must remain a recoverable error, with no partial UI.
      const recoveryContext = await browser.newContext();
      const recovery = await recoveryContext.newPage();
      let fail = true;
      await recoveryContext.route("**/data/amsterdam-development.json", (route) => fail ? route.fulfill({ status: 503, body: "Unavailable" }) : route.continue());
      try {
        await recovery.goto(`${root}/analysis/development/`);
        await recovery.getByRole("heading", { name: "Buurtontwikkeling laden lukt nu niet", exact: true }).waitFor();
        assert.equal(await recovery.locator("[data-development]").getAttribute("data-ready"), "false");
        assert.equal(await recovery.locator(".bd-ranking").count(), 0);
        fail = false;
        await recovery.getByRole("button", { name: "Opnieuw proberen", exact: true }).click();
        await recovery.locator("[data-development][data-ready=true]").waitFor();
        assert.equal(Number(await recovery.locator('[data-stat="neighborhoods"]').textContent()), initialCount);
      } finally { await recoveryContext.close(); }
      results.push({ browser: name, passed: true, defaultNeighborhoods: initialCount, areas: snapshot.areas.length });
      console.log(`✓ ${name}: catalog on-demand loading, periods, stock filters, search/map selection, timeline, exports, share/history, mobile and recovery`);
    } catch (error) {
      writeFileSync(resolve(output, `${name}-failure.txt`), await page.locator("body").innerText());
      await page.screenshot({ path: resolve(output, `${name}-failure.png`), fullPage: false });
      throw error;
    } finally { await context.close(); await browser.close(); }
  }
} finally {
  writeFileSync(resolve(output, "verification.json"), JSON.stringify({ passed: results.length === names.length && results.every((result) => result.passed), results }, null, 2));
  await new Promise((resolve) => server.close(resolve));
}
