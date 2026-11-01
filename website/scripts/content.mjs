import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { createHighlighter } from "shiki";
import { codeTheme } from "./code-theme.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..");
const output = resolve(site, ".generated");
// Start clean so pages of removed or renamed guides are never published.
rmSync(output, { recursive: true, force: true });
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
// The guides and live examples document the library in this repository.
const version = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8")).version;
const prerelease = version.includes("-");
const highlighter = await createHighlighter({
  themes: [codeTheme],
  langs: ["ts", "tsx", "js", "html", "css", "sh", "json", "vue", "svelte"],
});
const languageNames = { ts: "TypeScript", tsx: "TSX", vue: "Vue", svelte: "Svelte", js: "JavaScript", html: "HTML", css: "CSS", sh: "Shell", json: "JSON", text: "Text", mermaid: "Mermaid" };
const highlight = (code, lang) => {
  if (!highlighter.getLoadedLanguages().includes(lang)) return escape(code);
  return highlighter
    .codeToTokens(code, { lang, theme: codeTheme.name })
    .tokens.map((line) =>
      line
        .map(({ content, color, fontStyle }) => {
          const italic = fontStyle && fontStyle & 1 ? ";font-style:italic" : "";
          return color ? `<span style="color:${color}${italic}">${escape(content)}</span>` : escape(content);
        })
        .join(""),
    )
    .join("\n");
};
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
      ["frameworks", "React, Vue & Svelte"],
    ],
  ],
  [
    "Learn the basics",
    [
      ["draw", "Draw geometry"],
      ["shapes", "Shapes & freehand"],
      ["toolbar", "Toolbar"],
      ["edit", "Edit & undo"],
      ["geojson", "Import & export"],
      ["persistence", "Save & load data"],
      ["markers", "Point markers"],
      ["appearance", "Appearance"],
      ["measurements", "Measurements"],
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
      ["cut", "Cut"],
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
      ["compatibility", "Compatibility & limits"],
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
        `<section class="nav-group"><h2>${name}</h2>${links.map(([id, label]) => `<a href="${route(id, root)}"${slug === id ? ' aria-current="page"' : ""}>${label}${id === "examples" ? `<span class="nav-count">${gallery.length}</span>` : ""}</a>`).join("")}</section>`,
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
<header class="topbar"><a class="brand" href="${root}index.html">${mark}<span>Map Master<span class="brand-label">DOCS</span></span></a><button class="search-trigger" aria-haspopup="dialog">${searchIcon}<span>Search documentation</span><kbd>/</kbd></button><nav class="header-links" aria-label="Project links"><a class="version" href="${root}guides/changelog.html"><span></span>${version}</a><a href="${github}" target="_blank" rel="noreferrer">GitHub ↗</a><button class="menu-button" aria-expanded="false" aria-controls="sidebar" aria-label="Open navigation">☰</button></nav></header>
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
// One live example per feature guide. The map, data and toolbar come from website/src/demos.ts.
const demoHints = {
  home: "Pick a tool on the left of the map. Click a shape to select it; Shift+click adds more.",
  quickstart: "The finished quickstart: draw a polygon, finish it and undo.",
  examples: "Every tool, in two toolbars. Click shapes to select them; tools turn on when the selection qualifies.",
  toolbar: "Hover a button to see its name. Select shapes to enable the editing tools; an active tool shows Finish and Cancel beside its button.",
  "geometry-editor": "Every tool of the editor. Select one or more shapes, then choose a tool.",
  draw: "Choose the marker, line or polygon tool and click the map. Snapping catches the corners and edges of the rose garden and of the buildings on the basemap.",
  shapes: "Rectangle: click two corners. Circle and ellipse: click the center, then the edge. Freehand: press and drag. Measurements show the size as you draw.",
  measurements: "The lawn is selected and shows its area and perimeter. Draw a line or polygon to see segment lengths, or choose Edit and drag a corner.",
  cut: "Choose Cut and draw a polygon across the lawn, the garden and the route. Close it on its first corner: everything inside is removed.",
  edit: "The lawn is selected. Choose Edit, drag a corner or click a small midpoint, then Save. Undo restores it.",
  geojson: "Draw or edit shapes, import the GeoJSON below and download the result.",
  persistence: "Every committed change appears below as one onDataChange event: the moment to save.",
  markers: "Place markers with the marker tool, or select one and choose Edit to drag it.",
  appearance: "Switch themes below the map; shapes, selection and handles restyle at once.",
  "keyboard-vertices": "Choose Edit, focus the map, press Page Down to pick a corner and the arrow keys to move it (Shift: 10 pixels). Enter saves.",
  "touch-pen-vertices": "On a touch screen or with a pen: choose Edit, then drag a corner or tap a small midpoint.",
  transactions: "Run the transaction below, then Undo: both changes are reverted together.",
  "feature-styling": "Each zone is colored from its kind property, and overlapping areas are striped.",
  "feature-locks": "The park boundary is locked: you can select it and snap to it, but not change it.",
  multipart: "The two pond islands are one MultiPolygon. Separate parts turns them into two features; select both flower beds and Combine makes them one. Add part draws another island.",
  splitting: "The lawn is selected. Choose Split, draw a line across it and Apply.",
  union: "Both areas are selected. Choose Merge to preview the union, then Apply.",
  difference: "Choose Subtract: the market area is cut out of the festival area.",
  intersection: "Choose Intersect: only the overlap of both areas remains.",
  buffer: "The running route is selected. Choose Buffer and drag the handle or type a distance.",
  offset: "The running route is selected. Choose Offset and type a distance to create a parallel line.",
  simplification: "The wetland edge has 56 corners. Choose Simplify and raise the tolerance.",
  rotation: "The rose garden is selected. Choose Rotate and drag the handle or type an angle.",
  scaling: "The rose garden is selected. Choose Scale and drag a corner handle or type a factor.",
  reshape: "The rose garden is selected. Choose Reshape and draw a new section from one edge to another.",
  "shared-boundaries": "Both allotments are selected. Choose Edit shared boundary and drag a common corner.",
  tracing: "Draw a line or polygon and click two points on the edge of the pond: the outline between them is traced.",
  "drawing-constraints": "New segments lock to 45° steps. Hold Alt to place a point freely.",
};
const demo = (id) =>
  `<figure class="demo" data-demo="${id}"><div class="demo-map" role="region" aria-label="Interactive map example"></div><figcaption class="demo-caption"><p class="demo-hint"><span class="demo-badge">Try it</span>${escape(demoHints[id])}</p><div class="demo-footer"><p class="demo-status" role="status">Loading the map…</p><button type="button" class="demo-reset" disabled>Reset</button></div></figcaption></figure>`;
// Guides with a live example in the gallery, in navigation order.
const gallery = [
  ["draw", "Draw", "Markers, lines and polygons with snapping."],
  ["shapes", "Shapes", "Rectangles, circles, ellipses and freehand."],
  ["measurements", "Measurements", "Live lengths, areas and perimeters."],
  ["edit", "Edit & undo", "Drag corners, add midpoints and undo."],
  ["geojson", "GeoJSON", "Import, edit and download data."],
  ["toolbar", "Toolbar", "The ready-made MapLibre control."],
  ["markers", "Markers", "Place, move and duplicate points."],
  ["appearance", "Appearance", "Switch editor themes live."],
  ["feature-styling", "Feature styling", "Colors from properties, striped overlaps."],
  ["feature-locks", "Feature locks", "Read-only reference geometry."],
  ["multipart", "Multipart & holes", "Add, separate and combine parts."],
  ["splitting", "Split", "Cut a polygon in two."],
  ["cut", "Cut", "Cut a drawn area out of everything."],
  ["union", "Union", "Merge overlapping polygons."],
  ["difference", "Difference", "Subtract one shape from another."],
  ["intersection", "Intersection", "Keep only the common area."],
  ["buffer", "Buffer", "Grow shapes by a distance."],
  ["offset", "Offset", "Parallel copies of lines."],
  ["simplification", "Simplify", "Remove unnecessary corners."],
  ["rotation", "Rotate", "Turn shapes around a pivot."],
  ["scaling", "Scale", "Resize shapes around a pivot."],
  ["reshape", "Reshape", "Redraw part of a boundary."],
  ["shared-boundaries", "Shared boundaries", "Move a common edge once."],
  ["tracing", "Trace", "Follow existing outlines."],
  ["drawing-constraints", "Angle constraints", "Draw at 45° and 90°."],
  ["transactions", "Transactions", "Several changes, one undo step."],
  ["persistence", "Save & load", "React to every committed change."],
];
const galleryCards = `<div class="gallery">${gallery
  .map(
    ([slug, title, text]) =>
      `<a href="${slug}.html"><strong>${escape(title)}</strong><span>${escape(text)}</span><span class="card-link">Open example →</span></a>`,
  )
  .join("")}</div>`;
const cards = `<div class="example-cards"><a href="ROOTguides/draw.html"><span class="card-number">01 / DRAW</span><h3>From clicks to geometry <span>↗</span></h3><p>Place a marker, trace a line or draw a polygon. Finish when you are ready.</p><span class="card-link">Try drawing →</span></a><a href="ROOTguides/edit.html"><span class="card-number">02 / EDIT</span><h3>Make every change reversible <span>↗</span></h3><p>Select a shape, move its corners and save. Undo brings the original back.</p><span class="card-link">Try editing →</span></a><a href="ROOTguides/geojson.html"><span class="card-number">03 / EXCHANGE</span><h3>Your data, in and out <span>↗</span></h3><p>Import a GeoJSON collection, edit it on the map and download the result.</p><span class="card-link">Try GeoJSON →</span></a></div>`;
const homeBody = `<div class="home-intro"><span class="eyebrow"><span class="status-dot"></span> A GEOMETRY EDITOR FOR MAPLIBRE</span><div class="hero-grid"><div class="hero-copy"><h1>Your map.<br>Ready to <em>edit.</em></h1><p>Draw, reshape and manage geometry with a TypeScript API. Built-in snapping, validation and Undo keep every edit under control.</p><div class="hero-buttons"><a class="button" href="./guides/quickstart.html">Start building <span>→</span></a><a class="text-button" href="./guides/examples.html">Explore ${gallery.length} examples ↗</a></div><div class="install-command"><code>npm i @jorisvdmije/map-master maplibre-gl</code><button data-copy="npm i @jorisvdmije/map-master maplibre-gl" aria-label="Copy install command">Copy</button></div><div class="hero-meta"><span>TypeScript</span><span>GeoJSON</span><span>MIT license</span></div></div>${demo("home")}</div></div><section class="home-workflows"><div class="section-heading"><div><span class="eyebrow">LEARN BY DOING</span><h2>Three paths to your first integration.</h2></div><a href="./guides/geometry-editor.html">Explore the API →</a></div>${cards.replaceAll("ROOT", "./")}</section><section class="home-bottom"><div><span class="eyebrow">SMALL API. ROOM TO GROW.</span><h2>Start with a polygon.<br>Build a complete workflow.</h2><p>Go from simple drawing to splitting, merging, shared boundaries and transactional updates. Add the tools your application needs.</p><a class="text-button" href="./guides/geometry-editor.html">Browse GeometryEditor →</a></div><div class="beta-note"><span class="version"><span></span> ${prerelease ? "PUBLIC BETA" : "LATEST RELEASE"}</span><h3>Clear about what is tested.</h3><p>Version ${version}. Every change is tested in a real browser with MapLibre 6.15, and checked against latency and memory budgets.</p><a href="./guides/compatibility.html">Compatibility & limits →</a></div></section>`;
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
    `<div class="code-block"><div class="code-top"><span>${escape(languageNames[lang] ?? (lang || "Code"))}</span><button class="copy-code" aria-label="Copy code example">Copy</button></div><pre><code>${highlight(text, lang)}</code></pre></div>`;
  let html = marked.parse(source, { renderer, gfm: true });
  let placed = false;
  html = html.replace(/<p>\[\[demo:([a-z-]+)\]\]<\/p>/g, (_, id) => {
    placed = true;
    return demo(id);
  });
  // Feature guides open with their live example, right after the introduction.
  if (!placed && demoHints[page.slug]) {
    const lead = html.indexOf("</p>");
    const at = lead >= 0 ? lead + 4 : html.indexOf("</h1>") + 5;
    html = html.slice(0, at) + demo(page.slug) + html.slice(at);
  }
  html = html.replace(/<p>\[\[examples\]\]<\/p>/g, cards.replaceAll("ROOT", "../"));
  html = html.replace(/<p>\[\[gallery\]\]<\/p>/g, galleryCards);
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
