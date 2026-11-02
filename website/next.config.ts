import type { NextConfig } from "next";
import { resolve } from "node:path";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
const development = process.env.NODE_ENV === "development";
if (basePath && (!basePath.startsWith("/") || basePath.includes(".."))) {
  throw new Error("NEXT_PUBLIC_BASE_PATH must be an absolute URL path, such as /map-master.");
}

const config: NextConfig = {
  output: development ? undefined : "export",
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  poweredByHeader: false,
  // Production aliases are real exported HTML; the dev server can redirect.
  ...(development ? {
    redirects: () => [
      { source: "/guides/:slug.html", destination: "/guides/:slug/", permanent: false },
      { source: "/index.html", destination: "/", permanent: false },
    ],
  } : {}),
  turbopack: {
    root: resolve(import.meta.dirname, ".."),
    resolveAlias: { "@jorisvdmije/map-master": "../dist/index.js" },
  },
};

export default config;
