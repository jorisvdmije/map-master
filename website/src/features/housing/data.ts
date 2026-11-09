import {
  trustedUrl,
  requestSignal,
  visitPage,
  completeCount,
} from "@/features/data/source-contract";
import { bbox } from "@turf/bbox";
import type { Feature, Point } from "geojson";
import { indexById, pointsWithin } from "@/features/data/joins";
import { numeric, type Home, type Homes, type Neighborhood } from "./model";

const root = "https://api.pdok.nl/kadaster/bag/ogc/v2/collections/";
export function trustedBagUrl(
  url: string,
  collection: "verblijfsobject" | "pand",
) {
  return trustedUrl(
    url,
    "https://api.pdok.nl",
    `/kadaster/bag/ogc/v2/collections/${collection}/items`,
    true,
  );
}
export type BagProgress = { pages: number; fetched: number };
export async function loadHomes(
  area: Neighborhood,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  onProgress?: (progress: BagProgress) => void,
): Promise<Homes> {
  signal.throwIfAborted();
  const first = new URL(`${root}verblijfsobject/items`);
  first.searchParams.set("bbox", bbox(area).slice(0, 4).join(","));
  first.searchParams.set("limit", "1000");
  first.searchParams.set("f", "json");
  let url: string | undefined = first.href,
    fetched = 0,
    duplicates = 0;
  const visited = new Set<string>(),
    rows: Feature<Point, Record<string, unknown>>[] = [];
  const unique = new Map<string, string>();
  while (url) {
    url = trustedBagUrl(url, "verblijfsobject");
    visitPage(
      visited,
      url,
      40,
      "Deze buurt is te groot of de bron herhaalt een pagina; er zijn geen gedeeltelijke resultaten gebruikt.",
    );
    onProgress?.({ pages: visited.size - 1, fetched });
    const response = await request(url, {
      signal: requestSignal(signal, 30000),
    });
    if (!response.ok)
      throw new Error(
        `BAG tijdelijk niet bereikbaar (${response.status}). Probeer opnieuw.`,
      );
    const page = await response.json();
    if (page.type !== "FeatureCollection" || !Array.isArray(page.features))
      throw new Error("Ongeldig BAG-antwoord.");
    for (const f of page.features) {
      fetched++;
      const p = f.properties,
        c = f.geometry?.coordinates;
      if (
        f.geometry?.type !== "Point" ||
        !Array.isArray(c) ||
        c.length < 2 ||
        !Number.isFinite(c[0]) ||
        !Number.isFinite(c[1]) ||
        Math.abs(c[0]) > 180 ||
        Math.abs(c[1]) > 90 ||
        !p ||
        typeof p.identificatie !== "string" ||
        !/^\d{16}$/.test(p.identificatie)
      )
        throw new Error("BAG bevat een ongeldige locatie of identificatie.");
      const fingerprint = JSON.stringify([f.geometry, p]);
      if (unique.has(p.identificatie)) {
        if (unique.get(p.identificatie) !== fingerprint)
          throw new Error("Tegenstrijdige BAG-records voor dezelfde woning.");
        duplicates++;
        continue;
      }
      unique.set(p.identificatie, fingerprint);
      rows.push(f);
    }
    signal.throwIfAborted();
    onProgress?.({ pages: visited.size, fetched });
    if (!page.links?.some((l: { rel: string }) => l.rel === "next"))
      completeCount(page.numberMatched, fetched);
    url = page.links?.find((l: { rel: string }) => l.rel === "next")?.href;
  }
  const inside = pointsWithin(rows, area);
  const homes: Home[] = inside
    .filter((f) => {
      const p = f.properties;
      return (
        p.bronhouder_identificatie === "0363" &&
        String(p.gebruiksdoel).includes("woonfunctie") &&
        (String(p.status).startsWith("Verblijfsobject in gebruik") ||
          p.status === "Verbouwing verblijfsobject")
      );
    })
    .map((f) => {
      const p = f.properties,
        id = String(p.identificatie);
      return {
        type: "Feature",
        id,
        geometry: f.geometry,
        properties: {
          id,
          address: `${p.openbare_ruimte_naam ?? "Onbekende straat"} ${p.huisnummer ?? ""}${p.huisletter ?? ""}${p.toevoeging ? `-${p.toevoeging}` : ""}, ${p.postcode ?? ""}`,
          area: numeric(p.oppervlakte),
          use: String(p.gebruiksdoel),
          status: String(p.status),
          buildings: Array.isArray(p["pand.href"])
            ? p["pand.href"].map(String)
            : [],
        },
      };
    });
  indexById(homes, (f) => f.properties.id);
  return {
    data: { type: "FeatureCollection", features: homes },
    audit: {
      fetched,
      within: inside.length,
      homes: homes.length,
      duplicates,
      retrievedAt: new Date().toISOString(),
    },
  };
}
export async function loadBuildingYears(
  home: Home,
  signal: AbortSignal,
): Promise<number[]> {
  if (home.properties.buildings.length > 10)
    throw new Error("Meer dan tien gekoppelde panden; bouwjaren niet geladen.");
  const years = await Promise.all(
    home.properties.buildings.map(async (url) => {
      const response = await fetch(trustedBagUrl(url, "pand"), {
        signal: requestSignal(signal, 15000),
      });
      if (!response.ok) throw new Error("Bouwjaar tijdelijk niet beschikbaar.");
      return numeric((await response.json()).properties?.bouwjaar);
    }),
  );
  return [
    ...new Set(years.filter((y): y is number => y !== null && y > 0)),
  ].sort((a, b) => a - b);
}
