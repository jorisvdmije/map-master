import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  root: ".generated",
  base: "./",
  publicDir: "public",
  // HTML lives in .generated; source URLs must resolve outside that dev root.
  resolve: { alias: { "/src": resolve("src") } },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: [
        resolve(".generated/index.html"),
        ...readdirSync(".generated/guides")
          .filter((f) => f.endsWith(".html"))
          .map((f) => resolve(".generated/guides", f)),
      ],
    },
  },
  server: { fs: { allow: [".."] } },
});
