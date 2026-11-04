import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Run the focused cross-browser workspaces before the longer documentation tour
// so platform failures are reported early, with the full regression tour after.
for (const script of ["lint", "test:analysis", "build", "check:content", "check:frameworks", "check:analysis", "check:properties", "check:streets", "check:heatmaps", "check:browser"]) {
  execFileSync("npm", ["run", script], {
    cwd, stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "/map-master" },
  });
}
