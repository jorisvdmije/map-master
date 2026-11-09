import assert from "node:assert/strict";
import { htmlToDOM } from "html-react-parser";

/** Inspect actual HTML elements, not escaped markup inside Next's scripts. */
function serverElements(html) {
  const elements = [];
  const visit = nodes => {
    for (const node of nodes) {
      if (node.type === "tag") elements.push(node);
      if (node.children) visit(node.children);
    }
  };
  visit(htmlToDOM(html));
  return elements;
}
const docsShell = element => (element.attribs.class ?? "").split(/\s+/u).includes("docs-shell");

/** Prove that full-page workspaces have the same shell before and after hydration. */
export async function checkLayoutHydration({ context, origin, basePath = "/map-master" }) {
  const url = path => `${origin}${basePath}${path}`;
  let serverPath = "";
  try {
    for (const [path, workspace] of [["/analysis/streets/", "data-streets"], ["/analysis/bnb/", "data-bnb"], ["/analysis/housing/", "data-housing"], ["/analysis/", "data-analysis"], ["/playground/", "data-playground"]]) {
      serverPath = path;
      // Server rendering is an HTTP contract. Node fetch cannot execute page
      // scripts, and avoids Linux WebKit's disabled-JavaScript protocol failures.
      // The browser navigation and hydration contract is exercised below.
      const response = await fetch(url(path), { signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, 200);
      const elements = serverElements(await response.text());
      assert.equal(elements.filter(el => Object.hasOwn(el.attribs, workspace)).length, 1, `${path}: the server renders the workspace`);
      assert.equal(elements.filter(docsShell).length, 0, `${path}: no documentation wrapper in server HTML`);
    }
    for (const path of ["/", "/guides/draw/", "/missing-layout-test/"]) {
      serverPath = path;
      const response = await fetch(url(path), { signal: AbortSignal.timeout(30_000) });
      assert.equal(response.status, path.startsWith("/missing") ? 404 : 200);
      const elements = serverElements(await response.text());
      assert.equal(elements.filter(docsShell).length, 1, `${path}: documentation and 404s retain their shell`);
      assert.equal(elements.filter(el => el.attribs.id === "main").length, 1);
    }
  } catch (error) {
    console.error("Server HTML failure:", { path: serverPath });
    throw error;
  }

  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem("map-master-analysis-intro-v1", "seen"));
  await page.route("https://tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }] } }));
  const bnbReady = () => page.locator('[data-bnb][data-ready="true"]').waitFor();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url("/analysis/bnb/")); await bnbReady();
    await page.evaluate(() => { window.__layoutDocument = document; });
    await page.locator(".bb-header .an-brand").click();
    await page.locator(".docs-shell .topbar").waitFor();
    await page.locator(".sidebar").getByRole("link", { name: "B&B permit dashboard ↗", exact: true }).click(); await bnbReady();
    assert.equal(await page.locator(".docs-shell").count(), 0);
    await page.locator(".workspace-switcher summary").click();
    await page.getByRole("link", { name: "Vrije analyse", exact: true }).click();
    await page.locator('[data-analysis][data-ready="true"]').waitFor();
    assert.equal(await page.locator(".docs-shell").count(), 0);
    await page.locator(".an-header .an-brand").click();
    await page.locator(".docs-shell .topbar").waitFor();
    await page.locator(".header-links").getByRole("link", { name: "Playground ↗", exact: true }).click();
    await page.locator('[data-playground][data-ready="true"]').waitFor();
    assert.equal(await page.locator(".docs-shell").count(), 0);
    assert.equal(await page.evaluate(() => window.__layoutDocument === document), true, "Route groups keep the shared root and client-side navigation");
    await page.goto(url("/analysis/bnb/")); await bnbReady();
    await page.reload(); await bnbReady();
    assert.deepEqual(errors, [], "Direct loads, navigation and refresh must not report hydration errors");
    console.log("✓ Layouts: server HTML without JavaScript, isolated workspace shells, docs/404 chrome, direct hydration, client navigation and refresh");
  } finally { await page.close(); }
}
