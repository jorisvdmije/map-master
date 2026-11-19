import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Adversarial cases outside the normal documentation/editor workflow. */
export async function checkRegressions({ context, browser, origin, site }) {
  const url = path => `${origin}/map-master/${path}`;
  const ready = page => page.locator('[data-demo][data-ready="true"]').waitFor();
  const errors = [];
  const newPage = async () => {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    return page;
  };

  const search = await newPage();
  try {
    await search.route("**/search.json", route => route.fulfill({ json: { invalid: true } }));
    await search.goto(url("guides/frameworks/"), { waitUntil: "networkidle" });
    await search.evaluate(() => { window.__header = document.querySelector(".topbar"); });
    await search.locator(".search-trigger").click();
    await search.getByRole("button", { name: "Try again", exact: true }).waitFor();
    assert.equal(await search.evaluate(() => window.__header === document.querySelector(".topbar")), true);
    await search.unroute("**/search.json");
    await search.route("**/search.json", route => route.fulfill({ json: [{ title: "Missing fields" }] }));
    await search.getByRole("button", { name: "Try again", exact: true }).click();
    await search.getByRole("button", { name: "Try again", exact: true }).waitFor({ state: "hidden" });
    await search.getByRole("button", { name: "Try again", exact: true }).waitFor();
    await search.unroute("**/search.json");
    await search.getByRole("button", { name: "Try again", exact: true }).click();
    await search.locator(".search-result").first().waitFor();
    const input = search.getByRole("combobox");
    for (const term of ["belasting", "nieuwbouw", "erfpacht", "opleiding", "vakantieverhuur"]) {
      await input.fill(term);
      await search.locator('.search-result[href="/map-master/analysis/housing/"]').waitFor();
    }
    await input.fill("");
    await search.locator(".search-result").nth(8).waitFor();
    await input.press("ArrowUp");
    assert.equal(await search.locator('.search-result[aria-selected="true"]').getAttribute("id"), await input.getAttribute("aria-activedescendant"));
    assert.equal(await search.locator('.search-result[aria-selected="true"]').getAttribute("id"), `search-result-${await search.locator(".search-result").count() - 1}`);
    await input.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    await input.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
    await search.waitForLoadState("networkidle");
    assert.equal(search.url(), url("guides/frameworks/"), "IME composition must not activate a search result");
    assert.equal(await search.locator("dialog").evaluate(node => node.open), true, "IME Escape must not dismiss the search dialog");
    await search.evaluate(() => { const dialog = document.querySelector("dialog"); dialog.close(); dialog.showModal(); });
    await search.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await search.locator("dialog").evaluate(node => node.open), true, "An old queued close event cannot dismiss a reopened dialog");
    await search.keyboard.press("Escape");
    await search.setViewportSize({ width: 390, height: 844 });
    await search.locator(".menu-button").click();
    await search.locator(".sidebar a").last().focus();
    await search.keyboard.press("Tab");
    assert.equal(await search.evaluate(() => document.querySelector("#main").contains(document.activeElement)), false, "Covered mobile content is not keyboard reachable");
    assert.equal(await search.evaluate(() => getComputedStyle(document.body).overflow), "hidden");
    await search.keyboard.press("Escape");
    assert.equal(await search.locator(".menu-button").evaluate(node => node === document.activeElement), true);
  } finally { await search.close(); }

  const clipboard = await newPage();
  try {
    const { codeBlocks } = JSON.parse(readFileSync(resolve(site, ".generated/guides/quickstart.json"), "utf8"));
    await clipboard.goto(url("guides/quickstart/"), { waitUntil: "networkidle" });
    await clipboard.locator('[data-ui-root][data-hydrated="true"]').first().waitFor();
    await clipboard.evaluate(() => {
      window.__readClipboard = navigator.clipboard.readText.bind(navigator.clipboard);
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    const first = clipboard.locator('#docs-code-1 [data-slot="code-block-copy-button"]');
    await first.click();
    await clipboard.locator('#docs-code-1 [data-copied="true"]').waitFor();
    assert.equal(await clipboard.evaluate(() => window.__readClipboard()), codeBlocks["docs-code-1"].code);
    assert.equal(await first.evaluate(node => node === document.activeElement), true, "Fallback copying restores keyboard focus");
    await clipboard.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("Denied")) }, configurable: true }));
    await clipboard.locator('#docs-code-2 [data-slot="code-block-copy-button"]').click();
    await clipboard.locator('#docs-code-2 [data-copied="true"]').waitFor();
    assert.equal(await clipboard.evaluate(() => window.__readClipboard()), codeBlocks["docs-code-2"].code);
    await clipboard.evaluate(() => { document.execCommand = () => false; });
    await clipboard.locator('#docs-code-3 [data-slot="code-block-copy-button"]').click();
    await clipboard.getByRole("button", { name: "Copy failed; try again", exact: true }).waitFor();
  } finally { await clipboard.close(); }

  const offline = await newPage();
  try {
    let styleRequests = 0;
    const failedStyle = route => { styleRequests++; return route.fulfill({ status: 503, body: "Unavailable" }); };
    await offline.route("https://tiles.openfreemap.org/**", failedStyle);
    await offline.goto(url("guides/frameworks/"), { waitUntil: "networkidle" });
    await offline.locator('[data-ui-root][data-hydrated="true"]').first().waitFor();
    await offline.evaluate(() => window.dispatchEvent(new Event("offline")));
    await offline.locator(".sidebar").getByRole("link", { name: "Draw geometry", exact: true }).click();
    await offline.waitForURL(url("guides/draw/"));
    await ready(offline);
    assert.equal(styleRequests, 1, "Offline mode must settle into a working editor, rather than pause forever");
    await offline.route("**/search.json", route => route.abort("internetdisconnected"));
    await offline.locator(".search-trigger").click();
    await offline.getByRole("button", { name: "Try again", exact: true }).waitFor();
    await offline.keyboard.press("Escape");
    await offline.evaluate(() => window.dispatchEvent(new Event("online")));
    await offline.unroute("https://tiles.openfreemap.org/**", failedStyle);
    await offline.route("https://tiles.openfreemap.org/**", route => {
      styleRequests++;
      return route.fulfill({ json: { version: 8, sources: {}, layers: [] } });
    });
    await offline.locator(".sidebar").getByRole("link", { name: "Edit & undo", exact: true }).click();
    await offline.waitForURL(url("guides/edit/"));
    await ready(offline);
    assert.equal(styleRequests, 2, "A failed style is retried on the next map after service recovery");
    await offline.locator(".sidebar").getByRole("link", { name: "Draw geometry", exact: true }).click();
    await offline.waitForURL(url("guides/draw/"));
    await ready(offline);
    assert.equal(styleRequests, 2, "Successful map styles remain cached");
  } finally { await offline.close(); }

  const retry = await newPage();
  try {
    await retry.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "broken", type: "invalid" }] } }));
    await retry.goto(url("guides/draw/"), { waitUntil: "networkidle" });
    await retry.getByRole("button", { name: "Retry example", exact: true }).waitFor();
    await retry.unroute("https://tiles.openfreemap.org/**");
    await retry.getByRole("button", { name: "Retry example", exact: true }).click();
    await ready(retry);
    assert.equal(await retry.locator(".demo-map canvas").count(), 1, "Retry removes the old map before creating its replacement");
  } finally { await retry.close(); }

  const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await noJS.newPage();
    await page.goto(url(""));
    await page.locator(".demo-nojs").waitFor();
    assert.match(await page.locator(".demo-nojs").innerText(), /Interactive examples need JavaScript/);
    assert.equal(await page.locator(".demo-map").isVisible(), false);
    await page.getByRole("link", { name: "All guides", exact: true }).click();
    await page.waitForURL(url("guides/all-guides/"));
    await page.locator('.all-guides a[href$="/guides/quickstart/"]').click();
    await page.waitForURL(url("guides/quickstart/"));
    assert.ok((await page.locator('[data-slot="code-block-content"]').first().textContent()).length > 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await noJS.close(); }
  assert.deepEqual(errors, []);
  console.log("✓ Malformed/offline search, accessible keyboard/IME behavior, clipboard fallbacks, mobile/no-JS navigation and map failure recovery");
}
