import { defineConfig } from "vite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  root: ".generated",
  base: "./",
  publicDir: "public",
  resolve: {
    alias: {
      // HTML lives in .generated; source URLs must resolve outside that dev root.
      "/src": resolve("src"),
      // The live examples run this repository's library build (`npm run build`).
      "@jorisvdmije/map-master": resolve("../dist/index.js"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // The interactive examples bundle MapLibre GL JS (about 1.3 MB minified).
    chunkSizeWarningLimit: 1500,
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
