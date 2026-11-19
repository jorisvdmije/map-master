import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.ATLAS_BASE_PATH || "./",
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
  build: { outDir: "dist", target: "es2022" },
});
