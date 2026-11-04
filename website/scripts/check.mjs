import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const script of ["lint", "test:analysis", "build", "check:content", "check:frameworks", "check:browser", "check:analysis", "check:properties", "check:streets", "check:heatmaps"]) {
  execFileSync("npm", ["run", script], {
    cwd, stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "/map-master" },
  });
}
