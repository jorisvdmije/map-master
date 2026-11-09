import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cache } from "react";
import type { ContentManifest, Guide } from "@/content/types";

const directory = resolve(process.cwd(), ".generated");

export const getManifest = cache(async (): Promise<ContentManifest> =>
  JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")),
);

export const getGuide = cache(async (slug: string): Promise<Guide | undefined> => {
  const { guides } = await getManifest();
  // The manifest is also the allowlist for filesystem reads and public routes.
  if (!guides.some(guide => guide.slug === slug)) return undefined;
  return JSON.parse(await readFile(resolve(directory, "guides", `${slug}.json`), "utf8"));
});

export const getCatalog = cache(async (): Promise<import("@/features/catalog/types").Catalog> =>
  JSON.parse(await readFile(resolve(directory, "data-catalog.json"), "utf8")),
);
