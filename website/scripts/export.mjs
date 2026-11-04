import { readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(site, "out");
const { guides } = JSON.parse(readFileSync(resolve(site, ".generated/manifest.json"), "utf8"));
// Static hosts cannot issue configurable redirects. Keep the old pages readable
// without JS; with JS, canonicalize before Next hydrates and preserve query/hash.
for (const { slug } of guides) {
  const target = JSON.stringify(`./${slug}/`);
  const html = readFileSync(resolve(output, "guides", slug, "index.html"), "utf8");
  writeFileSync(resolve(output, "guides", `${slug}.html`), html.replace("<head>",
    `<head><script>location.replace(${target}+location.search+location.hash)</script><link rel="canonical" href="./${slug}/"/>`));
}
writeFileSync(resolve(output, ".nojekyll"), "");
writeFileSync(resolve(output, ".build-info.json"), JSON.stringify({ basePath: process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "", pages: guides.length + 5 }));
rmSync(resolve(site, "dist"), { recursive: true, force: true });
renameSync(output, resolve(site, "dist"));
console.log(`Exported ${guides.length + 5} Next.js pages and ${guides.length} legacy URL aliases to website/dist.`);
