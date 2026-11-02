import { queryOptions } from "@tanstack/react-query";
import type { StyleSpecification } from "maplibre-gl";

export const basemapUrl = "https://tiles.openfreemap.org/styles/liberty";
export const fallbackStyle: StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }],
};

export const basemapQuery = queryOptions({
  queryKey: ["basemap", basemapUrl],
  networkMode: "always",
  async queryFn({ signal }): Promise<StyleSpecification> {
    const response = await fetch(basemapUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    if (!response.ok) throw new Error(`Basemap ${response.status}`);
    const style: StyleSpecification = await response.json();
    if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) throw new Error("Invalid basemap style");
    return style;
  },
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
});
