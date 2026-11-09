import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { assetPath } from "@/lib/paths";
import type { AreaSeries } from "./model";

export type DevelopmentSnapshot = {
  meta: {
    retrievedAt: string;
    years: number[];
    geometryVintage: string;
    sha256: string;
    sources: { url: string; sha256: string }[];
    [key: string]: unknown;
  };
  areas: AreaSeries[];
  city: AreaSeries;
};
export type DevelopmentGeometry = FeatureCollection<
  Polygon | MultiPolygon,
  { code: string; name: string }
>;

export async function loadDevelopment(
  signal: AbortSignal,
  request: typeof fetch = fetch,
) {
  signal.throwIfAborted();
  const json = async <T>(path: `/${string}`): Promise<T> => {
    const response = await request(assetPath(path), { signal });
    signal.throwIfAborted();
    if (!response.ok)
      throw new Error(
        "De buurtontwikkeling kon niet worden geladen. Probeer opnieuw.",
      );
    const result: T = await response.json();
    signal.throwIfAborted();
    return result;
  };
  const [snapshot, geometry] = await Promise.all([
    json<DevelopmentSnapshot>("/data/amsterdam-development.json"),
    json<DevelopmentGeometry>("/data/amsterdam-development-geometry.json"),
  ]);
  const fail = (): never => {
    throw new Error(
      "De bronbestanden hebben een onverwacht formaat. Probeer opnieuw na een verversing.",
    );
  };
  if (!snapshot || !snapshot.meta || !geometry) fail();
  const years = snapshot.meta.years;
  if (
    !Array.isArray(years) ||
    years.length < 2 ||
    !years.every(
      (year, i) =>
        Number.isInteger(year) &&
        year >= 2000 &&
        year <= 2100 &&
        (i === 0 || year === years[i - 1] + 1),
    ) ||
    !Array.isArray(snapshot.areas) ||
    !snapshot.areas.length ||
    !snapshot.city ||
    !Number.isFinite(Date.parse(snapshot.meta.retrievedAt))
  )
    fail();
  const codes = new Set<string>();
  for (const area of [...snapshot.areas, snapshot.city]) {
    if (
      !area ||
      typeof area.code !== "string" ||
      typeof area.name !== "string" ||
      codes.has(area.code) ||
      (area.breakYears !== undefined &&
        (!Array.isArray(area.breakYears) ||
          !area.breakYears.every(
            (year) => Number.isInteger(year) && year >= 2000 && year <= 2100,
          )))
    )
      fail();
    codes.add(area.code);
    for (const series of [area.woz, area.homes]) {
      if (
        !series ||
        Array.isArray(series) ||
        !years.every(
          (year) =>
            series[year] === null ||
            (typeof series[year] === "number" &&
              Number.isFinite(series[year]) &&
              series[year]! >= 0),
        )
      )
        fail();
    }
  }
  if (
    geometry.type !== "FeatureCollection" ||
    !Array.isArray(geometry.features)
  )
    fail();
  const geometryCodes = new Set<string>();
  const areaCodes = new Set(snapshot.areas.map((area) => area.code));
  const validPolygon = (coordinates: unknown): boolean =>
    Array.isArray(coordinates) &&
    coordinates.length > 0 &&
    coordinates.every(
      (ring: unknown) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(
          (point: unknown) =>
            Array.isArray(point) &&
            point.length >= 2 &&
            point.every(
              (n: unknown) => typeof n === "number" && Number.isFinite(n),
            ) &&
            Math.abs(point[0]) <= 180 &&
            Math.abs(point[1]) < 85,
        ) &&
        ring[0][0] === ring.at(-1)[0] &&
        ring[0][1] === ring.at(-1)[1],
    );
  for (const area of geometry.features) {
    if (
      !area ||
      !area.properties ||
      !areaCodes.has(area.properties.code) ||
      geometryCodes.has(area.properties.code) ||
      !["Polygon", "MultiPolygon"].includes(area.geometry?.type)
    )
      fail();
    if (
      area.geometry.type === "Polygon"
        ? !validPolygon(area.geometry.coordinates)
        : !Array.isArray(area.geometry.coordinates) ||
          !area.geometry.coordinates.length ||
          !area.geometry.coordinates.every(validPolygon)
    )
      fail();
    geometryCodes.add(area.properties.code);
  }
  if (snapshot.areas.some((area) => !geometryCodes.has(area.code))) fail();
  signal.throwIfAborted();
  return { snapshot, geometry };
}
