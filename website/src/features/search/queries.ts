import { queryOptions } from "@tanstack/react-query";
import type { SearchPage } from "@/content/types";
import { assetPath } from "@/lib/paths";

export const searchIndexQuery = queryOptions({
  queryKey: ["documentation", "search-index"],
  networkMode: "always",
  async queryFn({ signal }): Promise<SearchPage[]> {
    const response = await fetch(assetPath("/search.json"), { signal });
    if (!response.ok) throw new Error(`Search index ${response.status}`);
    const pages: unknown = await response.json();
    if (!Array.isArray(pages) || !pages.every(isSearchPage)) throw new Error("Invalid documentation search index");
    return pages;
  },
  staleTime: Infinity,
  gcTime: Infinity,
});

function isSearchPage(value: unknown): value is SearchPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  return ["title", "description", "text"].every(key => typeof page[key] === "string")
    && typeof page.href === "string" && /^\/(?!\/)/.test(page.href);
}

export function searchPages(pages: SearchPage[], query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return pages.map(page => ({ page, score: terms.reduce((sum, term) => sum + (page.title.toLowerCase().includes(term) ? 10 : 0), 0) }))
    .filter(({ page }) => terms.every(term => `${page.title} ${page.description} ${page.text}`.toLowerCase().includes(term)))
    .sort((a, b) => b.score - a.score).slice(0, 9).map(({ page }) => page);
}
