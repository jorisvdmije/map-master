import {
  trustedUrl,
  requestSignal,
  visitPage,
  completeCount,
} from "@/features/data/source-contract";
import type { Feature, FeatureCollection, Point } from "geojson";
import { measure } from "@jorisvdmije/map-master";
import type { Home } from "./model";

export const noiseLayer = "rivm_20250801_Geluid_lden_allebronnen_2022";
export const noiseService = "https://data.rivm.nl/geo/alo/wms";
const municipal = "https://api.data.amsterdam.nl/v1/";
export type Tree = Feature<Point, { id: string }>;
export type EnergyLabel = {
  label: string | null;
  registered: string | null;
  validUntil: string | null;
  status: "valid" | "expired" | "unknown" | "missing";
  retrievedAt: string;
};
const date = (v: unknown): string | null =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v
    ? v
    : null;

async function municipalPages(
  url: string,
  table: string,
  signal: AbortSignal,
  request: typeof fetch,
) {
  const rows: Record<string, unknown>[] = [],
    seen = new Set<string>();
  while (url) {
    url = trustedUrl(url, "https://api.data.amsterdam.nl", `/v1/${table}`);
    visitPage(seen, url, 20);
    const response = await request(url, {
      headers: { "Accept-Crs": "EPSG:4326" },
      signal: requestSignal(signal, 25000),
    });
    if (!response.ok)
      throw new Error(
        `Gemeentelijke bron niet bereikbaar (${response.status}).`,
      );
    const page = await response.json(),
      batch = page._embedded?.[table.split("/").at(-1)!];
    if (!Array.isArray(batch))
      throw new Error("Onverwacht antwoord van de gemeentelijke bron.");
    rows.push(...batch);
    url = page._links?.next?.href ?? "";
    if (!url) completeCount(page.page?.totalElements, rows.length);
  }
  return rows;
}

export async function nearbyTrees(
  home: Home,
  radius: number,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  if (radius !== 100 && radius !== 250)
    throw new TypeError("Kies een straal van 100 of 250 meter.");
  const [lng, lat] = home.geometry.coordinates,
    dy = radius / 110_500,
    dx = radius / (110_500 * Math.cos((lat * Math.PI) / 180));
  const wkt = `POLYGON((${lng - dx} ${lat - dy},${lng + dx} ${lat - dy},${lng + dx} ${lat + dy},${lng - dx} ${lat + dy},${lng - dx} ${lat - dy}))`;
  const url = new URL(`${municipal}bomen/stamgegevens/`);
  url.search = new URLSearchParams({
    "geometrie[intersects]": wkt,
    _pageSize: "1000",
    _fields: "id,geometrie",
    _count: "true",
  }).toString();
  const rows = await municipalPages(
      url.href,
      "bomen/stamgegevens",
      signal,
      request,
    ),
    ids = new Set<string>(),
    features: Tree[] = [];
  for (const row of rows) {
    const geometry = row.geometrie as Point | null,
      id = String(row.id);
    if (
      row.id == null ||
      !id ||
      !geometry ||
      geometry.type !== "Point" ||
      !geometry.coordinates.every(Number.isFinite) ||
      Math.abs(geometry.coordinates[0]!) > 180 ||
      Math.abs(geometry.coordinates[1]!) > 90 ||
      ids.has(id)
    )
      throw new Error("Boombron bevat een ongeldige of dubbele registratie.");
    ids.add(id);
    if (
      measure({
        type: "LineString",
        coordinates: [
          home.geometry.coordinates as [number, number],
          geometry.coordinates as [number, number],
        ],
      }).length <= radius
    )
      features.push({ type: "Feature", id, geometry, properties: { id } });
  }
  return {
    data: { type: "FeatureCollection", features } as FeatureCollection<
      Point,
      Tree["properties"]
    >,
    radius,
    examined: rows.length,
    retrievedAt: new Date().toISOString(),
  };
}

export function selectEnergyLabel(
  rows: Record<string, unknown>[],
  today: string,
): EnergyLabel {
  const sorted = rows
    .filter(
      (r) => date(r.registratiedatum) && String(r.registratiedatum) <= today,
    )
    .sort((a, b) =>
      String(b.registratiedatum).localeCompare(String(a.registratiedatum)),
    );
  const row = sorted[0],
    registered = date(row?.registratiedatum),
    validUntil = date(row?.metingGeldigTot),
    raw = row?.energieklasse;
  const label =
    typeof raw === "string" &&
    /^(A\+{0,5}|[B-G])$/.test(raw.trim().toUpperCase())
      ? raw.trim().toUpperCase()
      : null;
  if (
    row &&
    sorted.some(
      (r) =>
        r.registratiedatum === registered &&
        (r.energieklasse !== row.energieklasse ||
          r.metingGeldigTot !== row.metingGeldigTot),
    )
  )
    throw new Error(
      "Tegenstrijdige energielabelregistraties op dezelfde datum.",
    );
  return {
    label,
    registered,
    validUntil,
    status: !rows.length
      ? "missing"
      : !row || !label || !validUntil
        ? "unknown"
        : validUntil < today
          ? "expired"
          : "valid",
    retrievedAt: new Date().toISOString(),
  };
}

export async function homeEnergy(
  home: Home,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<EnergyLabel> {
  const url = new URL(`${municipal}duurzaamheid/energielabel/`);
  url.search = new URLSearchParams({
    bagVerblijfsobjectId: home.properties.id,
    _pageSize: "1000",
    _fields:
      "bagVerblijfsobjectId,energieklasse,registratiedatum,metingGeldigTot",
    _count: "true",
  }).toString();
  const rows = await municipalPages(
    url.href,
    "duurzaamheid/energielabel",
    signal,
    request,
  );
  if (rows.some((r) => r.bagVerblijfsobjectId !== home.properties.id))
    throw new Error("Energielabel is niet exact aan dit BAG-object gekoppeld.");
  return selectEnergyLabel(
    rows,
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(
      new Date(),
    ),
  );
}

export async function homeNoise(
  home: Home,
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  const [lng, lat] = home.geometry.coordinates,
    size = 0.0001;
  const url = new URL(noiseService);
  url.search = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetFeatureInfo",
    layers: noiseLayer,
    query_layers: noiseLayer,
    srs: "EPSG:4326",
    bbox: `${lng - size},${lat - size},${lng + size},${lat + size}`,
    width: "101",
    height: "101",
    x: "50",
    y: "50",
    info_format: "application/json",
    feature_count: "1",
  }).toString();
  const response = await request(url.href, {
    signal: requestSignal(signal, 20000),
  });
  if (!response.ok)
    throw new Error(`RIVM-geluidsbron niet bereikbaar (${response.status}).`);
  const data = await response.json();
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
    throw new Error("Onverwacht antwoord van de RIVM-geluidsbron.");
  const raw = data.features[0]?.properties?.GRAY_INDEX;
  const decibels =
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 150
      ? raw
      : null;
  return {
    decibels,
    layer: noiseLayer,
    source: "RIVM Geluid in Nederland, samengestelde bronjaren",
    retrievedAt: new Date().toISOString(),
  };
}
