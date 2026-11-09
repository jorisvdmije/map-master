import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { createStaticServer } from "./lib/static-server.mjs";
import { checkAnalysisRecovery } from "./analysis-recovery-check.mjs";
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
    console.log(`Analysis browser: ${name}`);
    const evidence = resolve(site, `../artifacts/analysis/${name}`); mkdirSync(evidence, { recursive: true });
    const isolated = async check => {
      const browser = await browsers[name].launch({ headless: (process.env.GEO_DOCS_HEADED ?? process.env.GEO_COMPAT_HEADED) !== "1", ...(name === "chromium" ? { args: ["--enable-unsafe-swiftshader"] } : {}) });
      try {
        const context = await browser.newContext();
        try { await check({ browser, context, origin: `http://127.0.0.1:${server.address().port}`, evidence, basePath }); }
        finally { await context.close(); }
      } finally { await browser.close(); }
    };
    await isolated(async options => {
      if (!bnbOnly) await checkAnalysis(options);
      await checkBnb(options);
    });
    // Keep the disabled-JavaScript context and route-hydration checks independent
    // of the native WebGL/GPU resources exercised by the map interaction suites.
    if (!bnbOnly) await isolated(checkAnalysisRecovery);
    await isolated(checkLayoutHydration);
  }
} finally { await new Promise(resolve => server.close(resolve)); }
