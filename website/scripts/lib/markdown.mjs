import { dirname, relative, resolve } from "node:path";
import { marked } from "marked";
import { createHighlighter } from "shiki";
import { codeTheme } from "../code-theme.mjs";

export const escape = value => String(value).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

const languages = { ts: "TypeScript", tsx: "TSX", vue: "Vue", svelte: "Svelte", js: "JavaScript", html: "HTML", css: "CSS", sh: "Shell", json: "JSON", text: "Text", mermaid: "Mermaid" };

/** Markdown and syntax highlighting run only in the content build, never in a browser. */
export async function createMarkdownCompiler({ repo, github, pathToSlug }) {
  const highlighter = await createHighlighter({
    themes: [codeTheme],
    langs: ["ts", "tsx", "js", "html", "css", "sh", "json", "vue", "svelte"],
  });
  return {
    dispose: () => highlighter.dispose(),
    compile(source, page) {
      const headings = [];
      const codeBlocks = {};
      const ids = new Map();
      const renderer = new marked.Renderer();
      renderer.heading = function ({ tokens, depth }) {
        const text = tokens.map(t => t.text ?? t.raw).join("").replace(/<[^>]*>/g, "");
        const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
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
          if (slug) url = `/guides/${slug}/${hash ? `#${hash}` : ""}`;
        } else if (!/^(https?:|mailto:|#)/.test(href)) {
          const [path, hash] = href.split("#");
          const target = resolve(dirname(page.path), path);
          const slug = pathToSlug.get(target);
          url = slug ? `/guides/${slug}/${hash ? `#${hash}` : ""}`
            : `${github}/blob/main/${relative(repo, target)}${hash ? `#${hash}` : ""}`;
        }
        return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ""}${/^https?:/.test(url) ? ' target="_blank" rel="noreferrer"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      };
      renderer.code = ({ text, lang }) => {
        const language = (lang || "text").split(/\s+/)[0];
        const title = lang?.match(/\btitle="([^"]+)"/)?.[1] ?? languages[language] ?? language;
        const id = `docs-code-${Object.keys(codeBlocks).length + 1}`;
        const lines = highlighter.getLoadedLanguages().includes(language)
          ? highlighter.codeToTokens(text, { lang: language, theme: codeTheme.name }).tokens
            .map(line => line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle })))
          : text.split("\n").map(content => [{ content }]);
        codeBlocks[id] = { code: text, language, title, lines };
        return `<docs-code data-id="${id}"></docs-code>`;
      };
      renderer.blockquote = function ({ tokens }) {
        const body = this.parser.parse(tokens);
        const marker = body.match(/^<p>\[!(NOTE|TIP|IMPORTANT|WARNING)\](?:\s+([^<]+))?<\/p>\n?/);
        if (!marker) return `<blockquote>${body}</blockquote>`;
        return `<docs-alert data-kind="${marker[1]}" data-title="${escape(marker[2]?.trim() ?? marker[1])}">${body.slice(marker[0].length)}</docs-alert>`;
      };
      return { html: marked.parse(source, { renderer, gfm: true }), headings, codeBlocks };
    },
  };
}
