import { createServer } from "node:http";
import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/geo+json", ".txt": "text/plain", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };

/** A plain static host: no SPA fallback, rewrites or application server required. */
export function createStaticServer({ directory, basePath = "" }) {
  const root = resolve(directory);
  return createServer((request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (basePath && url.pathname === basePath) {
        response.writeHead(308, { Location: `${basePath}/${url.search}` }); response.end(); return;
      }
      if (!url.pathname.startsWith(`${basePath}/`)) throw new Error("Not found");
      let file = resolve(root, decodeURIComponent(url.pathname.slice(basePath.length + 1)) || "index.html");
      if (!file.startsWith(`${root}${sep}`)) throw new Error("Not found");
      if (statSync(file).isDirectory()) {
        if (!url.pathname.endsWith("/")) {
          response.writeHead(308, { Location: `${url.pathname}/${url.search}` }); response.end(); return;
        }
        file = resolve(file, "index.html");
      }
      response.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
      const versioned = /\.[a-f0-9]{16}(?:-\d{4}-\d{2}-\d{2})?\.(json|geojson)$/.test(file);
      response.setHeader("Cache-Control", versioned ? "public, max-age=31536000, immutable" : "no-cache");
      response.setHeader("Vary", "Accept-Encoding");
      const accepted = request.headers["accept-encoding"] ?? "";
      if (/\bbr\b/.test(accepted) && existsSync(`${file}.br`)) { file += ".br"; response.setHeader("Content-Encoding", "br"); }
      else if (/\bgzip\b/.test(accepted) && existsSync(`${file}.gz`)) { file += ".gz"; response.setHeader("Content-Encoding", "gzip"); }
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404, { "Content-Type": "text/html" });
      try { response.end(readFileSync(resolve(root, "404.html"))); } catch { response.end("Not found"); }
    }
  });
}
