import { readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdownCompiler, escape } from "./lib/markdown.mjs";
import { demoHints } from "../src/content/demo-hints.ts";
import { writeFileAtomically } from "./lib/files.mjs";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..");
const output = resolve(site, ".generated");
const publicDir = resolve(site, "public");
// Compile everything before publishing, so failed/concurrent builds never erase
// the content being read by an active Next.js development server.
const pending = new Map();
const queueFile = (file, content) => pending.set(file, content);
const github = "https://github.com/jorisvdmije/map-master";
const { version } = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8"));
const pages = [
  ...readdirSync(resolve(site, "content")).filter(f => f.endsWith(".md"))
    .map(f => ({ path: resolve(site, "content", f), slug: basename(f, ".md") })),
  ...readdirSync(resolve(repo, "docs")).filter(f => f.endsWith(".md") && f !== "README.md")
    .map(f => ({ path: resolve(repo, "docs", f), slug: basename(f, ".md") })),
  { path: resolve(repo, "CHANGELOG.md"), slug: "changelog" },
  { path: resolve(repo, "SECURITY.md"), slug: "security" },
];
if (new Set([...pages.map(page => page.slug), "all-guides"]).size !== pages.length + 1) throw new Error("Duplicate or reserved documentation slug.");
const compiler = await createMarkdownCompiler({ repo, github, pathToSlug: new Map(pages.map(p => [p.path, p.slug])) });
const guides = [];
const search = [{
  title: "Overview", href: "/", description: "Map Master, an open-source geometry editor for MapLibre and Mapbox.",
  text: "drawing polygons lines markers TypeScript GeoJSON snapping undo MapLibre Mapbox",
}, {
  title: "Geodata playground", href: "/playground/", description: "Import and edit your own GeoJSON, manage layers and attributes, style features and export projects.",
  text: "playground workspace import export GeoJSON data layers attribute table project save local browser editor",
}];
try {
  for (const page of pages) {
    const source = readFileSync(page.path, "utf8");
    const title = source.match(/^# (.+)$/m)?.[1] ?? page.slug;
    const compiled = compiler.compile(source, page);
    let placed = false;
    compiled.html = compiled.html.replace(/<p>\[\[demo:([a-z-]+)\]\]<\/p>/g, (_, id) => {
      if (!(id in demoHints)) throw new Error(`Unknown demo: ${id}`);
      placed = true;
      return `<docs-demo data-id="${id}"></docs-demo>`;
    });
    if (!placed && demoHints[page.slug]) {
      const lead = compiled.html.indexOf("</p>");
      const at = lead >= 0 ? lead + 4 : compiled.html.indexOf("</h1>") + 5;
      compiled.html = compiled.html.slice(0, at) + `<docs-demo data-id="${page.slug}"></docs-demo>` + compiled.html.slice(at);
    }
    compiled.html = compiled.html.replace(/<p>\[\[examples\]\]<\/p>/g, "<docs-workflows></docs-workflows>")
      .replace(/<p>\[\[gallery\]\]<\/p>/g, "<docs-gallery></docs-gallery>");
    const description = source.replace(/^#.+$/gm, "").replace(/```[\s\S]*?```/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim().slice(0, 170);
    const summary = { slug: page.slug, title, description, sourcePath: relative(repo, page.path).split("\\").join("/") };
    guides.push(summary);
    queueFile(resolve(output, "guides", `${page.slug}.json`), JSON.stringify({ ...summary, ...compiled }));
    search.push({ title, href: `/guides/${page.slug}/`, description,
      text: source.replace(/```[\s\S]*?```/g, "").replace(/[#*`|]/g, "").replace(/\s+/g, " ").slice(0, 100000),
    });
  }
} finally { compiler.dispose(); }
const all = {
  slug: "all-guides", title: "All documentation", sourcePath: "docs/README.md",
  description: "Every Map Master guide, operation, API contract and project document.",
};
queueFile(resolve(output, "guides/all-guides.json"), JSON.stringify({ ...all,
  html: `<h1>All documentation</h1><p class="lead">The full collection of guides and references, built directly from the repository.</p><ul class="all-guides">${guides.map(g => `<li><a href="/guides/${g.slug}/">${escape(g.title)}</a></li>`).join("")}</ul>`,
  headings: [], codeBlocks: {},
}));
guides.push(all);
search.push({ ...all, href: "/guides/all-guides/", text: "All guides documentation reference" });
queueFile(resolve(publicDir, "search.json"), JSON.stringify(search));
const logo = readFileSync(resolve(repo, "assets/icon.svg"), "utf8");
queueFile(resolve(publicDir, "logo.svg"), logo);
queueFile(resolve(publicDir, "favicon.svg"), logo.replace("</title>", "</title><style>@media(prefers-color-scheme:dark){svg{color:#83D8B1}}</style>"));
queueFile(resolve(publicDir, "maplibre-worker.mjs"), readFileSync(resolve(site, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")));
queueFile(resolve(publicDir, "licenses.txt"), [
  ["Map Master", resolve(repo, "LICENSE")],
  ["shadcn/ui components (MIT)", resolve(site, "SHADCN-LICENSE.md")],
  ["React", resolve(site, "node_modules/react/LICENSE")],
  ["React DOM", resolve(site, "node_modules/react-dom/LICENSE")],
  ["Next.js", resolve(site, "node_modules/next/license.md")],
  ["TanStack Query", resolve(site, "node_modules/@tanstack/react-query/LICENSE")],
  ["html-react-parser", resolve(site, "node_modules/html-react-parser/LICENSE")],
  ["Base UI", resolve(site, "node_modules/@base-ui/react/LICENSE")],
  ["Lucide icons", resolve(site, "node_modules/lucide-react/LICENSE")],
  ["Class Variance Authority", resolve(site, "node_modules/class-variance-authority/LICENSE")],
  ["clsx", resolve(site, "node_modules/clsx/license")],
  ["tailwind-merge", resolve(site, "node_modules/tailwind-merge/LICENSE.md")],
  ["Map Master runtime dependency notices", resolve(repo, "THIRD_PARTY_NOTICES.md")],
  ["MapLibre GL JS", resolve(site, "node_modules/maplibre-gl/LICENSE.txt")],
  ["Manrope font", resolve(site, "node_modules/@fontsource-variable/manrope/LICENSE")],
  ["DM Sans font", resolve(site, "node_modules/@fontsource-variable/dm-sans/LICENSE")],
].map(([label, file]) => `${label}\n${readFileSync(file, "utf8")}`).join("\n\n"));
for (const [file, content] of pending) writeFileAtomically(file, content);
// Publish the manifest last, after all files it references are in place.
writeFileAtomically(resolve(output, "manifest.json"), JSON.stringify({ version, guides }));
const names = new Set(guides.map(guide => `${guide.slug}.json`));
for (const entry of readdirSync(resolve(output, "guides"), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".json") && !names.has(entry.name)) rmSync(resolve(output, "guides", entry.name));
}
console.log(`Compiled ${guides.length} guides, search index and static assets for Next.js.`);
