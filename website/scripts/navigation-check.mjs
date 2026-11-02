import assert from "node:assert/strict";

/** Exercise Next's App Router through actual links on the plain static export. */
export async function checkNavigation({ page, context, browser, origin }) {
  const url = path => `${origin}/map-master/${path}`;
  const sidebarLink = name => page.locator(".sidebar").getByRole("link", { name, exact: true });
  const settled = async path => {
    await page.waitForURL(url(path));
    await page.locator("#main").waitFor();
  };
  const shellIntact = () => page.evaluate(() => {
    const previous = window.__navigationCheck;
    return previous.document === document && previous.header === document.querySelector(".topbar")
      && previous.sidebar === document.querySelector(".sidebar") && previous.dialog === document.querySelector(".search-dialog");
  });

  await page.goto(url("guides/quickstart/"), { waitUntil: "networkidle" });
  await page.locator('[data-ui-root][data-hydrated="true"]').first().waitFor();
  await page.locator('[data-demo]').scrollIntoViewIfNeeded();
  await page.locator('[data-demo][data-ready="true"]').waitFor();
  await page.evaluate(() => {
    const canvas = document.querySelector(".demo-map canvas");
    const sidebar = document.querySelector(".sidebar");
    sidebar.scrollTop = 100;
    window.__navigationCheck = {
      document, sidebar, header: document.querySelector(".topbar"), dialog: document.querySelector(".search-dialog"),
      gl: canvas.getContext("webgl2"), code: document.querySelector("[data-ui-root]"),
    };
    window.scrollTo(0, 420);
  });
  let documentRequests = 0;
  let searchRequests = 0;
  let styleRequests = 0;
  const requestListener = request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++;
    if (request.url().endsWith("/search.json")) searchRequests++;
    if (request.url() === "https://tiles.openfreemap.org/styles/liberty") styleRequests++;
  };
  page.on("request", requestListener);
  try {
    await sidebarLink("Framework integrations").click();
    await settled("guides/frameworks/");
    assert.equal(await shellIntact(), true, "Header, sidebar, search dialog and document remain mounted");
    assert.equal(await page.locator(".sidebar").evaluate(node => node.scrollTop), 100);
    assert.equal(await page.locator('.sidebar a[aria-current="page"]').textContent(), "Framework integrations");
    assert.match(await page.title(), /React, Vue, Svelte and Angular/);
    await page.waitForFunction(() => window.__navigationCheck.gl.isContextLost());
    assert.equal(await page.evaluate(() => window.__navigationCheck.code.isConnected), false, "Previous React content is detached");

    await page.locator('.toc a[href="#react"]').click();
    await settled("guides/frameworks/#react");
    assert.ok(await page.evaluate(() => scrollY > 0));
    await page.goBack();
    await settled("guides/frameworks/");
    await page.evaluate(() => window.scrollTo(0, 700));
    await sidebarLink("Quickstart").click();
    await settled("guides/quickstart/");
    await page.goBack();
    await settled("guides/frameworks/");
    await page.waitForFunction(() => Math.abs(scrollY - 700) < 2);
    await page.goForward();
    await settled("guides/quickstart/");
    await page.goBack();
    await settled("guides/frameworks/");

    await page.locator(".breadcrumbs a").click();
    await settled("");
    await page.getByRole("tab", { name: "pnpm", exact: true }).click();
    assert.equal(await page.getByRole("tab", { name: "pnpm", exact: true }).getAttribute("aria-selected"), "true");
    await page.locator(".search-trigger").click();
    await page.locator("#search-input").fill("Troubleshooting");
    await page.locator('.search-result[href$="/guides/troubleshooting/"]').click();
    await settled("guides/troubleshooting/");
    assert.equal(await page.locator(".search-dialog").evaluate(node => node.open), false);
    await page.locator(".search-trigger").click();
    assert.equal(await page.locator("#search-input").inputValue(), "Troubleshooting", "Search state survives page changes");
    await page.locator('.search-result[href$="/guides/troubleshooting/"]').click();
    assert.equal(await page.locator(".search-dialog").evaluate(node => node.open), false, "Selecting the current page also closes search");
    await page.locator(".search-trigger").click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".search-dialog").open);
    assert.equal(await shellIntact(), true);
    assert.equal(documentRequests, 0, "Internal navigation never requests a new document");
    assert.equal(searchRequests, 1, "React Query fetches the search index once across repeated searches and page changes");
    assert.equal(styleRequests, 0, "React Query reuses the original map style on later pages");

    // A slow RSC response cannot overwrite a newer navigation intent.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let started;
    const requested = new Promise(resolve => { started = resolve; });
    const matcher = url => url.pathname.startsWith("/map-master/guides/security/") && url.pathname.endsWith(".txt");
    const slowRoute = async route => {
      started();
      await gate;
      await route.continue().catch(() => {});
    };
    await page.route(matcher, slowRoute);
    try {
      await sidebarLink("Security").click();
      await requested;
      await sidebarLink("Draw geometry").click();
      await settled("guides/draw/");
      release();
      await page.waitForLoadState("networkidle");
      assert.equal(page.url(), url("guides/draw/"));
      assert.equal(await shellIntact(), true);
    } finally { release(); await page.unroute(matcher, slowRoute); }

    await sidebarLink("Quickstart").click();
    await settled("guides/quickstart/");
    await page.locator('[data-ui-root][data-hydrated="true"]').first().waitFor();
    await page.locator('[data-slot="code-block-copy-button"]').first().click();
    await page.locator('[data-copied="true"]').waitFor();
  } finally { page.off("request", requestListener); }

  // Navigating away while the basemap is pending must not create a detached map.
  const pendingPage = await context.newPage();
  let releaseBasemap;
  const basemapGate = new Promise(resolve => { releaseBasemap = resolve; });
  let basemapStarted;
  const basemapRequested = new Promise(resolve => { basemapStarted = resolve; });
  await pendingPage.route("https://tiles.openfreemap.org/**", async route => {
    basemapStarted();
    await basemapGate;
    await route.fulfill({ json: { version: 8, sources: {}, layers: [] } }).catch(() => {});
  });
  try {
    await pendingPage.goto(url(""), { waitUntil: "domcontentloaded" });
    await basemapRequested;
    await pendingPage.locator(".sidebar").getByRole("link", { name: "Framework integrations", exact: true }).click();
    await pendingPage.waitForURL(url("guides/frameworks/"));
    releaseBasemap();
    await pendingPage.waitForLoadState("networkidle");
    assert.equal(await pendingPage.locator("canvas").count(), 0);
  } finally { releaseBasemap(); await pendingPage.close(); }

  // Search failure has an actionable retry; a failed tile service retains the editor.
  const failurePage = await context.newPage();
  await failurePage.route("**/search.json", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await failurePage.route("https://tiles.openfreemap.org/**", route => route.fulfill({ status: 503, body: "Unavailable" }));
  try {
    await failurePage.goto(url(""), { waitUntil: "networkidle" });
    await failurePage.locator('[data-demo][data-ready="true"]').waitFor();
    await failurePage.locator(".search-trigger").click();
    await failurePage.getByRole("button", { name: "Try again", exact: true }).waitFor();
    await failurePage.unroute("**/search.json");
    await failurePage.getByRole("button", { name: "Try again", exact: true }).click();
    await failurePage.locator(".search-result").first().waitFor();
  } finally { await failurePage.close(); }

  const noJS = await browser.newContext({ javaScriptEnabled: false });
  try {
    const documentPage = await noJS.newPage();
    await documentPage.goto(url(""));
    await documentPage.locator(".sidebar").getByRole("link", { name: "Quickstart", exact: true }).click();
    await documentPage.waitForURL(url("guides/quickstart/"));
    assert.ok((await documentPage.locator('[data-slot="code-block-content"]').first().textContent()).length > 0);
    await documentPage.goto(url("guides/frameworks.html#react"));
    assert.equal(documentPage.url(), url("guides/frameworks.html#react"));
    assert.ok(await documentPage.locator("#react").count());
  } finally { await noJS.close(); }
  await page.goto(url("guides/frameworks.html?legacy=1#react"));
  await page.waitForURL(url("guides/frameworks/?legacy=1#react"));
  console.log("✓ Persistent Next.js layout, history/scroll, resource cleanup, React Query caching/errors and legacy/no-JS links");
}
