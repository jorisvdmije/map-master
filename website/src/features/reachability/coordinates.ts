import type { Coordinate } from "@jorisvdmije/map-master";

export type CoordinateInput = { lng: string; lat: string };
export const defaultOrigin: Coordinate = [4.904, 52.367];

/** Coordinate degrees use a decimal dot or comma, never grouping or exponents. */
export function coordinateValue(
  input: string | null,
  maximum: number,
): number | null {
  const text = input?.trim() ?? "";
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && Math.abs(value) <= maximum ? value : null;
}
export function coordinateOrigin(input: CoordinateInput): Coordinate | null {
  const lng = coordinateValue(input.lng, 180),
    lat = coordinateValue(input.lat, 85);
  return lng === null || lat === null ? null : [lng, lat];
}
const decimalDegrees = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumSignificantDigits: 21,
});
export const coordinateInput = (point: Coordinate): CoordinateInput => ({
  lng: decimalDegrees.format(point[0]),
  lat: decimalDegrees.format(point[1]),
});
export function initialOrigin(
  params: Pick<URLSearchParams, "get">,
): Coordinate {
  return (
    coordinateOrigin({
      lng: params.get("lng") ?? "",
      lat: params.get("lat") ?? "",
    }) ?? [...defaultOrigin]
  );
}
