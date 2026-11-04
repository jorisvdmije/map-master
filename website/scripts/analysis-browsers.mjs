import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { createStaticServer } from "./lib/static-server.mjs";
import { checkAnalysis } from "./analysis-check.mjs";
import { checkBnb } from "./bnb-check.mjs";
import { checkLayoutHydration } from "./layout-hydration-check.mjs";

const site = resolve(import.meta.dirname, "..");
const { basePath } = JSON.parse(readFileSync(resolve(site, "dist/.build-info.json"), "utf8"));
const server = createStaticServer({ directory: resolve(site, "dist"), basePath });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browsers = { chromium, firefox, webkit };
const bnbOnly = process.argv.includes("--bnb");
const names = process.argv.slice(2).filter(arg => arg !== "--bnb");
try {
  for (const name of names.length ? names : Object.keys(browsers)) {
    const browser = await browsers[name].launch({ headless: true, ...(name === "chromium" ? { args: ["--enable-unsafe-swiftshader"] } : {}) });
    const context = await browser.newContext();
    const evidence = resolve(site, `../artifacts/analysis/${name}`); mkdirSync(evidence, { recursive: true });
    try {
      const options = { context, origin: `http://127.0.0.1:${server.address().port}`, evidence, basePath };
      if (!bnbOnly) await checkAnalysis(options);
      await checkBnb(options);
      await checkLayoutHydration({ ...options, browser });
    }
    finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
