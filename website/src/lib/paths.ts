/** Next Link prefixes routes itself; only public assets need the explicit base path. */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
export const assetPath = (path: `/${string}`) => `${basePath}${path}`;

export function guidePath(slug: string) {
  if (slug === "index") return "/";
  if (slug === "snapping") return "/guides/geometry-editor/#snapping-while-drawing";
  return `/guides/${slug}/`;
}

export const github = "https://github.com/jorisvdmije/map-master";
