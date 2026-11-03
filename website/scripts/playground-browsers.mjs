import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { createStaticServer } from "./lib/static-server.mjs";
import { checkPlaygroundMobile } from "./playground-mobile-check.mjs";
import { checkPlaygroundResize } from "./playground-resize-check.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = { chromium, firefox, webkit };
const headless = process.env.GEO_COMPAT_HEADED !== "1";
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(types);
for (const name of names) assert.ok(Object.hasOwn(types, name), `Unknown browser: ${name}`);
const { basePath } = JSON.parse(readFileSync(resolve(site, "dist/.build-info.json"), "utf8"));
const server = createStaticServer({ directory: resolve(site, "dist"), basePath });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const name of names) {
    const evidence = resolve(site, "../artifacts/playground", name); mkdirSync(evidence, { recursive: true });
    let browser;
    try {
      browser = await types[name].launch({ headless, ...(name === "chromium" ? { args: ["--enable-unsafe-swiftshader"] } : {}) });
      await checkPlaygroundMobile({ browser, origin, evidence, basePath });
      await checkPlaygroundResize({ browser, origin, evidence, basePath });
      results.push({ browser: name, version: browser.version(), headless, passed: true });
      console.log(`✓ ${name}: playground mobile and resize checks passed`);
    } catch (error) {
      results.push({ browser: name, headless, passed: false, error: String(error.stack ?? error) });
      console.error(`${name}: ${error.stack ?? error}`); process.exitCode = 1;
    } finally {
      if (browser) await browser.close();
      writeFileSync(resolve(evidence, "verification.json"), JSON.stringify(results.at(-1), null, 2));
    }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
