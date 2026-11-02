import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = [".generated/manifest.json", ".generated/guides/quickstart.json", "public/search.json"];
let reads = 0;
const failures = [];
const read = () => {
  for (const path of paths) {
    reads++;
    try { JSON.parse(readFileSync(resolve(site, path), "utf8")); }
    catch (error) { if (failures.length < 5) failures.push(`${path}: ${error.message}`); }
  }
};
read();
const interval = setInterval(read, 5);
try {
  await promisify(execFile)(process.execPath, [resolve(site, "node_modules/tsx/dist/cli.mjs"), "scripts/content.mjs"], { cwd: site, timeout: 30_000 });
} finally { clearInterval(interval); }
read();
assert.deepEqual(failures, [], "Content remains present and valid while the content build runs");
console.log(`✓ Atomic content generation: ${reads} concurrent reads without missing or partial JSON`);
