import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..");
const output = resolve(site, ".generated");
mkdirSync(resolve(output, "guides"), { recursive: true });
mkdirSync(resolve(output, "public"), { recursive: true });
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const github = "https://github.com/jorisvdmije/map-master";
const pages = [
  ...readdirSync(resolve(site, "content"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      path: resolve(site, "content", f),
      slug: basename(f, ".md"),
    })),
  ...readdirSync(resolve(repo, "docs"))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => ({ path: resolve(repo, "docs", f), slug: basename(f, ".md") })),
  { path: resolve(repo, "CHANGELOG.md"), slug: "changelog" },
  { path: resolve(repo, "SECURITY.md"), slug: "security" },
];
const pathToSlug = new Map(pages.map((p) => [p.path, p.slug]));
const groups = [
  [
    "Start here",
    [
      ["index", "Overview"],
      ["quickstart", "Quickstart"],
      ["examples", "Interactive examples"],
    ],
  ],
  [
    "Learn the basics",
    [
      ["draw", "Draw geometry"],
      ["edit", "Edit & undo"],
      ["geojson", "Import & export"],
      ["markers", "Point markers"],
      ["appearance", "Appearance"],
      ["snapping", "Snapping"],
      ["keyboard-vertices", "Keyboard editing"],
    ],
  ],
  [
    "Reference",
    [
      ["geometry-editor", "GeometryEditor API"],
      ["transactions", "Transactions & events"],
      ["feature-styling", "Feature styling"],
      ["feature-locks", "Feature locks"],
      ["multipart", "Multipart & holes"],
    ],
  ],
  [
    "Geometry operations",
    [
      ["splitting", "Split"],
      ["union", "Union"],
      ["difference", "Difference"],
      ["intersection", "Intersection"],
      ["buffer", "Buffer"],
      ["offset", "Offset"],
      ["simplification", "Simplify"],
      ["rotation", "Rotate"],
      ["scaling", "Scale"],
      ["reshape", "Reshape"],
      ["tracing", "Trace"],
      ["shared-boundaries", "Shared boundaries"],
      ["drawing-constraints", "Drawing constraints"],
    ],
  ],
  [
    "Project",
    [
      ["beta-budgets", "Compatibility & budgets"],
      ["browser-compatibility", "Browser investigation"],
      ["touch-pen-vertices", "Touch & pen"],
      ["migration", "Migration"],
      ["changelog", "Changelog"],
      ["security", "Security"],
      ["all-guides", "All documentation"],
    ],
  ],
];
// Snapping lives in the existing API guide; retain its canonical section anchor.
const route = (slug, root) =>
  slug === "index"
    ? `${root}index.html`
    : slug === "snapping"
      ? `${root}guides/geometry-editor.html#snapping-while-drawing`
      : `${root}guides/${slug}.html`;
const mark =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 8 24 5 27 23 12 27Z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.8"/><path d="m7 8 20 15M24 5 12 27" stroke="currentColor" stroke-width="1" opacity=".35"/><g fill="currentColor"><circle cx="7" cy="8" r="2.8"/><circle cx="24" cy="5" r="2.8"/><circle cx="27" cy="23" r="2.8"/><circle cx="12" cy="27" r="2.8"/></g></svg>';
const searchIcon =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>';
const nav = (slug, root) =>
  groups
    .map(
      ([name, links]) =>
        `<section class="nav-group"><h2>${name}</h2>${links.map(([id, label]) => `<a href="${route(id, root)}"${slug === id ? ' aria-current="page"' : ""}>${label}${id === "examples" ? '<span class="nav-count">3</span>' : ""}</a>`).join("")}</section>`,
    )
    .join("");
function shell({
  slug,
  title,
  description,
  body,
  headings = [],
  home = false,
}) {
  const root = home ? "./" : "../";
  return `<!doctype html><html lang="en" data-root="${root}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#153b32"><meta name="description" content="${escape(description)}"><title>${home ? "Map Master — Geometry editing for MapLibre" : `${escape(title)} · Map Master`}</title><link rel="icon" href="${root}favicon.svg" type="image/svg+xml"></head><body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar"><a class="brand" href="${root}index.html">${mark}<span>Map Master<span class="brand-label">DOCS</span></span></a><button class="search-trigger" aria-haspopup="dialog">${searchIcon}<span>Search documentation</span><kbd>/</kbd></button><nav class="header-links" aria-label="Project links"><a class="version" href="${root}guides/changelog.html"><span></span>0.1.0-beta.0</a><a href="${github}" target="_blank" rel="noreferrer">GitHub ↗</a><button class="menu-button" aria-expanded="false" aria-controls="sidebar" aria-label="Open navigation">☰</button></nav></header>
<div class="sidebar-shade" hidden></div><aside class="sidebar" id="sidebar" aria-label="Documentation navigation">${nav(slug, root)}<div class="sidebar-footer"><span class="status-dot"></span> Open source · MIT licensed</div></aside>
<div class="page ${home ? "home" : "guide"}"><main id="main" tabindex="-1">${home ? "" : `<div class="breadcrumbs"><a href="${root}index.html">Documentation</a><span>/</span>${escape(title)}</div>`}${body}<footer class="page-footer"><span>Map Master <span class="muted">/</span> Built for MapLibre · <a href="${root}licenses.txt">Licenses</a></span><a href="${github}/issues" target="_blank" rel="noreferrer">Suggest an improvement ↗</a></footer></main>${
    !home && headings.length
      ? `<aside class="toc" aria-label="On this page"><h2>On this page</h2>${headings
          .filter((h) => h.depth === 2)
          .map((h) => `<a href="#${h.id}">${escape(h.text)}</a>`)
          .join(
            "",
          )}<a class="toc-source" href="${github}/tree/main" target="_blank" rel="noreferrer">View source ↗</a></aside>`
      : ""
  }</div>
<dialog class="search-dialog" aria-labelledby="search-title"><div class="search-top"><label id="search-title" for="search-input">${searchIcon}<span class="sr-only">Search documentation</span></label><input id="search-input" type="search" placeholder="Search guides, methods, examples…" autocomplete="off"><button class="search-close" aria-label="Close search">Esc</button></div><div id="search-results" aria-live="polite"></div><div class="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span><span>Searches all guides</span></div></dialog>
<script type="module" src="/src/main.ts"></script></body></html>`;
}
const demo = (kind) =>
  `<section class="demo" data-demo="${kind}" aria-label="Interactive ${kind} example"><div class="demo-top"><span><i></i> LIVE EXAMPLE</span><span class="demo-kind">${kind === "draw" ? "Draw & explore" : kind === "edit" ? "Edit & undo" : "GeoJSON exchange"}</span></div><div class="demo-map" aria-label="Interactive map"></div><div class="demo-toolbar" role="group" aria-label="Drawing tools"><button data-action="polygon">◇ Polygon</button><button data-action="line">⌁ Line</button><button data-action="marker">⊙ Marker</button><span></span><button data-action="undo" aria-label="Undo">↶ Undo</button></div><div class="demo-actions"><button data-action="finish" class="button small">Finish</button><button data-action="cancel">Cancel</button><button data-action="edit">Edit selected</button><button data-action="delete">Delete</button><button data-action="sample">Load sample</button><button data-action="reset">Reset</button></div><p class="demo-status" role="status">Loading the map…</p><div class="demo-feature-list" aria-label="Features"></div>${kind === "geojson" ? `<div class="demo-data"><label>GeoJSON input<textarea class="geojson-input" rows="5" spellcheck="false" aria-label="GeoJSON input"></textarea></label><div><button data-action="import" class="button small">Import GeoJSON</button><button data-action="export">Download GeoJSON ↓</button></div><details><summary>View current GeoJSON</summary><pre class="geojson-output"></pre></details></div>` : ""}<p class="demo-caption">Fictional neighborhood · no API key · changes stay in this page</p></section>`.replace(
    /data-action="[^"]+"/g,
    "$& disabled",
  );
const cards = `<div class="example-cards"><a href="ROOTguides/draw.html"><span class="card-number">01 / DRAW</span><h3>From clicks to geometry <span>↗</span></h3><p>Place a marker, trace a line or draw a polygon. Finish when you are ready.</p><span class="card-link">Try drawing →</span></a><a href="ROOTguides/edit.html"><span class="card-number">02 / EDIT</span><h3>Make every change reversible <span>↗</span></h3><p>Select a shape, move its corners and save. Undo brings the original back.</p><span class="card-link">Try editing →</span></a><a href="ROOTguides/geojson.html"><span class="card-number">03 / EXCHANGE</span><h3>Your data, in and out <span>↗</span></h3><p>Import a GeoJSON collection, edit it on the map and download the result.</p><span class="card-link">Try GeoJSON →</span></a></div>`;
const homeBody = `<div class="home-intro"><span class="eyebrow"><span class="status-dot"></span> A GEOMETRY EDITOR FOR MAPLIBRE</span><div class="hero-grid"><div class="hero-copy"><h1>Your map.<br>Ready to <em>edit.</em></h1><p>Draw, reshape and manage geometry with a TypeScript API. Built-in snapping, validation and Undo keep every edit under control.</p><div class="hero-buttons"><a class="button" href="./guides/quickstart.html">Start building <span>→</span></a><a class="text-button" href="./guides/examples.html">Explore examples ↗</a></div><div class="install-command"><code>npm i @jorisvdmije/map-master@beta</code><button data-copy="npm i @jorisvdmije/map-master@beta" aria-label="Copy install command">Copy</button></div><div class="hero-meta"><span>TypeScript</span><span>GeoJSON</span><span>MIT license</span></div></div>${demo("draw")}</div></div><section class="home-workflows"><div class="section-heading"><div><span class="eyebrow">LEARN BY DOING</span><h2>Three paths to your first integration.</h2></div><a href="./guides/geometry-editor.html">Explore the API →</a></div>${cards.replaceAll("ROOT", "./")}</section><section class="home-bottom"><div><span class="eyebrow">SMALL API. ROOM TO GROW.</span><h2>Start with a polygon.<br>Build a complete workflow.</h2><p>Go from simple drawing to splitting, merging, shared boundaries and transactional updates. Add the tools your application needs.</p><a class="text-button" href="./guides/geometry-editor.html">Browse GeometryEditor →</a></div><div class="beta-note"><span class="version"><span></span> PUBLIC BETA</span><h3>Clear about what is tested.</h3><p>Published as 0.1.0-beta.0. The API is experimental. Current qualification covers the documented Chromium and MapLibre 6.15.0 profile.</p><a href="./guides/beta-budgets.html">Compatibility & limitations →</a></div></section>`;
writeFileSync(
  resolve(output, "index.html"),
  shell({
    slug: "index",
    title: "Overview",
    description:
      "Draw, edit and manage geometry on MapLibre maps. Get started with Map Master, an open-source TypeScript geometry editor.",
    body: homeBody,
    home: true,
  }),
);
const search = [
  {
    title: "Overview",
    slug: "index",
    description: "Map Master, an open-source geometry editor for MapLibre.",
    text: "drawing polygons lines markers TypeScript GeoJSON snapping undo",
  },
];
for (const page of pages) {
  let source = readFileSync(page.path, "utf8");
  const title = source.match(/^# (.+)$/m)?.[1] ?? page.slug;
  const headings = [];
  const ids = new Map();
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const text = tokens
      .map((t) => t.text ?? t.raw)
      .join("")
      .replace(/<[^>]*>/g, "");
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-");
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    const id = n ? `${base}-${n}` : base;
    headings.push({ text, depth, id });
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}${depth === 2 || depth === 3 ? `<a class="heading-anchor" href="#${id}" aria-label="Link to ${escape(text)}">#</a>` : ""}</h${depth}>`;
  };
  renderer.link = function ({ href, title, tokens }) {
    let url = href;
    const repositoryPrefix = `${github}/blob/main/`;
    if (href.startsWith(repositoryPrefix)) {
      const [path, hash] = href.slice(repositoryPrefix.length).split("#");
      const slug = pathToSlug.get(resolve(repo, path));
      if (slug) url = `${slug}.html${hash ? `#${hash}` : ""}`;
    }
    if (!/^(https?:|mailto:|#)/.test(href)) {
      const [path, hash] = href.split("#");
      const target = resolve(dirname(page.path), path);
      const slug = pathToSlug.get(target);
      url = slug
        ? `${slug}.html${hash ? `#${hash}` : ""}`
        : `${github}/blob/main/${relative(repo, target)}${hash ? `#${hash}` : ""}`;
    }
    return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ""}${/^https?:/.test(url) ? ' target="_blank" rel="noreferrer"' : ""}>${this.parser.parseInline(tokens)}</a>`;
  };
  renderer.code = ({ text, lang }) =>
    `<div class="code-block"><div class="code-top"><span>${escape(lang || "Code")}</span><button class="copy-code" aria-label="Copy code example">Copy</button></div><pre><code>${escape(text)}</code></pre></div>`;
  let html = marked.parse(source, { renderer, gfm: true });
  html = html.replace(/<p>\[\[demo:(draw|edit|geojson)\]\]<\/p>/g, (_, kind) =>
    demo(kind),
  );
  html = html.replace(
    /<p>\[\[examples\]\]<\/p>/g,
    cards.replaceAll("ROOT", "../"),
  );
  const description = source
    .replace(/^#.+$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 170);
  writeFileSync(
    resolve(output, "guides", `${page.slug}.html`),
    shell({
      slug: page.slug,
      title,
      description,
      body: `<article class="article">${html}</article>`,
      headings,
    }),
  );
  search.push({
    title,
    slug: `guides/${page.slug}`,
    description,
    text: source
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[#*`|]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 100000),
  });
}
const allLinks = pages
  .map(
    (p) =>
      `<li><a href="${p.slug}.html">${escape(readFileSync(p.path, "utf8").match(/^# (.+)$/m)?.[1] ?? p.slug)}</a></li>`,
  )
  .join("");
writeFileSync(
  resolve(output, "guides/all-guides.html"),
  shell({
    slug: "all-guides",
    title: "All documentation",
    description:
      "Every Map Master guide, operation, API contract and project document.",
    body: `<article class="article"><h1>All documentation</h1><p class="lead">The full collection of guides and references, built directly from the repository.</p><ul class="all-guides">${allLinks}</ul></article>`,
  }),
);
writeFileSync(resolve(output, "public/search.json"), JSON.stringify(search));
writeFileSync(
  resolve(output, "public/favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#153b32"/><path d="m8 9 15-3 3 17-15 3Z" fill="none" stroke="#a3e3b0" stroke-width="2"/><g fill="#a3e3b0"><circle cx="8" cy="9" r="2"/><circle cx="23" cy="6" r="2"/><circle cx="26" cy="23" r="2"/><circle cx="11" cy="26" r="2"/></g></svg>`,
);
console.log(`Generated overview and ${pages.length + 1} documentation pages.`);

writeFileSync(
  resolve(output, "public/licenses.txt"),
  [
    ["Map Master", resolve(repo, "LICENSE")],
    [
      "Map Master runtime dependency notices",
      resolve(repo, "THIRD_PARTY_NOTICES.md"),
    ],
    ["MapLibre GL JS", resolve(site, "node_modules/maplibre-gl/LICENSE.txt")],
    [
      "Manrope font",
      resolve(site, "node_modules/@fontsource-variable/manrope/LICENSE"),
    ],
    [
      "DM Sans font",
      resolve(site, "node_modules/@fontsource-variable/dm-sans/LICENSE"),
    ],
  ]
    .map(([label, file]) => `${label}\n${readFileSync(file, "utf8")}`)
    .join("\n\n"),
);
