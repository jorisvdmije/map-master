import {
  trustedUrl,
  requestSignal,
  visitPage,
  completeCount,
} from "@/features/data/source-contract";
import { booleanIntersects } from "@turf/boolean-intersects";
import type { MultiPolygon, Polygon } from "geojson";
import type { Home } from "./model";

export const addressSources = {
  leasehold:
    "https://api.data.amsterdam.nl/v1/docs/datasets/benkagg.html#brkkaartlaagerfpachtuitgevers",
  bnb: "https://api.data.amsterdam.nl/v1/docs/datasets/vergunningen.html#bedandbreakfast",
  leaseholdLookup:
    "https://www.amsterdam.nl/wonen-bouwen-verbouwen/erfpacht/een-woning-met-erfpacht-kopen/",
  leaseholdCalculator:
    "https://www.amsterdam.nl/wonen-bouwen-verbouwen/erfpacht/kosten-erfpacht/rekentool-erfpacht/",
  holidayRental:
    "https://www.amsterdam.nl/wonen-bouwen-verbouwen/huisvestingsvergunning/regels-voor-vakantieverhuur/",
  bnbMap: "https://kaart.amsterdam.nl/vergunningen-bed-breakfast",
} as const;

export type LeaseholdContext = {
  status: "matched" | "missing";
  parcels: {
    id: string;
    cadastralObject: string;
    issuer: string;
    rawIssuer: string;
  }[];
  retrievedAt: string;
  source: string;
};
export type BnbContext = {
  status: "matched" | "missing" | "boundary";
  wards: { id: string; name: string; category: string; label: string }[];
  retrievedAt: string;
  source: string;
};
const root = "https://api.data.amsterdam.nl/v1/";
const leaseholdTable = "benkagg/brkkaartlaagerfpachtuitgevers";
const bnbTable = "vergunningen/bedandbreakfast";
const categoryLabels: Record<string, string> = {
  green: "Beschikbaar",
  orange: "Beperkt beschikbaar",
  red: "Niet beschikbaar",
};

function validPoint(home: Home) {
  const c = home.geometry.coordinates;
  if (
    c.length < 2 ||
    !Number.isFinite(c[0]) ||
    !Number.isFinite(c[1]) ||
    Math.abs(c[0]) > 180 ||
    Math.abs(c[1]) > 90
  )
    throw new Error("Ongeldige woninglocatie.");
  return c;
}

function geometry(value: unknown): Polygon | MultiPolygon {
  if (!value || typeof value !== "object")
    throw new Error("Bron bevat een ongeldige gebiedsgeometrie.");
  const g = value as Polygon | MultiPolygon;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon")
    throw new Error("Bron bevat een ongeldige gebiedsgeometrie.");
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  if (
    !Array.isArray(polygons) ||
    !polygons.length ||
    !polygons.every(
      (polygon) =>
        Array.isArray(polygon) &&
        polygon.length &&
        polygon.every(
          (ring) =>
            Array.isArray(ring) &&
            ring.length >= 4 &&
            ring.every(
              (p) =>
                Array.isArray(p) &&
                p.length >= 2 &&
                Number.isFinite(p[0]) &&
                Number.isFinite(p[1]) &&
                Math.abs(p[0]) <= 180 &&
                Math.abs(p[1]) <= 90,
            ) &&
            ring[0][0] === ring.at(-1)![0] &&
            ring[0][1] === ring.at(-1)![1],
        ),
    )
  )
    throw new Error("Bron bevat een ongeldige gebiedsgeometrie.");
  return g;
}

async function intersectingRecords(
  home: Home,
  table: string,
  geometryField: string,
  fields: string[],
  signal: AbortSignal,
  request: typeof fetch,
) {
  signal.throwIfAborted();
  const [lng, lat] = validPoint(home);
  const start = new URL(`${root}${table}/`);
  start.search = new URLSearchParams({
    [`${geometryField}[intersects]`]: `POINT(${lng} ${lat})`,
    _fields: fields.join(","),
    _pageSize: "1000",
    _count: "true",
  }).toString();
  let url = start.href;
  const visited = new Set<string>(),
    unique = new Set<string>(),
    rows: Record<string, unknown>[] = [];
  let expectedTotal: number | undefined;
  while (url) {
    const parsed = new URL(
      trustedUrl(url, "https://api.data.amsterdam.nl", `/v1/${table}`),
    );
    visitPage(visited, parsed.href, 10);
    const response = await request(parsed.href, {
      headers: { "Accept-Crs": "EPSG:4326", "Content-Crs": "EPSG:4326" },
      signal: requestSignal(signal, 20000),
    });
    if (!response.ok)
      throw new Error(`Bron tijdelijk niet beschikbaar (${response.status}).`);
    const page = await response.json(),
      batch: unknown = page._embedded?.[table.split("/").at(-1)!];
    if (!Array.isArray(batch))
      throw new Error("Onverwacht antwoord van de gemeentelijke bron.");
    const total = page.page?.totalElements;
    if (total !== undefined) {
      if (
        !Number.isSafeInteger(total) ||
        total < 0 ||
        (expectedTotal !== undefined && expectedTotal !== total)
      )
        throw new Error("De omvang van de bronopvraag is onduidelijk.");
      expectedTotal = total;
    }
    for (const row of batch) {
      if (
        !row ||
        typeof row !== "object" ||
        (typeof row.id !== "string" && typeof row.id !== "number") ||
        !String(row.id) ||
        unique.has(String(row.id))
      )
        throw new Error("Bron bevat een ongeldige of dubbele registratie.");
      unique.add(String(row.id));
      // Recheck the spatial join locally: an ignored API filter must not become a match.
      const g = geometry(row[geometryField]);
      if (!booleanIntersects(home, g))
        throw new Error("Bronantwoord valt buiten de gekozen woninglocatie.");
      rows.push(row);
    }
    const next = page._links?.next?.href;
    if (next !== undefined && typeof next !== "string")
      throw new Error("Onverwachte vervolgpagina van de bron.");
    url = next ?? "";
  }
  completeCount(expectedTotal, rows.length);
  signal.throwIfAborted();
  return rows;
}

/** Parcel context at a BAG point, never proof of a dwelling's legal title or canon. */
export async function homeLeasehold(
  home: Home,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<LeaseholdContext> {
  const rows = await intersectingRecords(
    home,
    leaseholdTable,
    "geometrieVlak",
    ["id", "kadastraalobjectId", "erfpachtUitgegevenDoor", "geometrieVlak"],
    signal,
    request,
  );
  const parcels = rows.map((row) => {
    if (
      typeof row.kadastraalobjectId !== "string" ||
      !row.kadastraalobjectId ||
      typeof row.erfpachtUitgegevenDoor !== "string" ||
      !["Amsterdam", "Gemeente Amsterdam", "Overige"].includes(
        row.erfpachtUitgegevenDoor,
      )
    )
      throw new Error("Erfpachtbron bevat een onbekende perceelregistratie.");
    return {
      id: String(row.id),
      cadastralObject: row.kadastraalobjectId,
      issuer:
        row.erfpachtUitgegevenDoor === "Amsterdam"
          ? "Gemeente Amsterdam"
          : row.erfpachtUitgegevenDoor,
      rawIssuer: row.erfpachtUitgegevenDoor,
    };
  });
  return {
    status: parcels.length ? "matched" : "missing",
    parcels,
    retrievedAt: new Date().toISOString(),
    source: addressSources.leasehold,
  };
}

/** Availability category for the permit ward, not an address permit or holiday-rental register. */
export async function homeBnbContext(
  home: Home,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<BnbContext> {
  const rows = await intersectingRecords(
    home,
    bnbTable,
    "geometrie",
    ["id", "wijkNaam", "categorieKleur", "geometrie"],
    signal,
    request,
  );
  const wards = rows.map((row) => {
    if (
      typeof row.wijkNaam !== "string" ||
      !row.wijkNaam ||
      typeof row.categorieKleur !== "string" ||
      !Object.hasOwn(categoryLabels, row.categorieKleur)
    )
      throw new Error(
        "B&B-bron bevat een onbekende beschikbaarheidsindicatie.",
      );
    return {
      id: String(row.id),
      name: row.wijkNaam,
      category: row.categorieKleur,
      label: categoryLabels[row.categorieKleur],
    };
  });
  return {
    status:
      wards.length > 1 ? "boundary" : wards.length ? "matched" : "missing",
    wards,
    retrievedAt: new Date().toISOString(),
    source: addressSources.bnb,
  };
}
