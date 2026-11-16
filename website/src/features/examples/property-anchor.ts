import type { Geometry } from "geojson";

/** Center of a complete source geometry's geographic extent. Supply the original
 * feature geometry: rendered vector-tile fragments have different bounds.
 * This deliberately uses bounds, not a vertex mean or an interior centroid. */
export function featureAnchor(geometry: Geometry): [number, number] | null {
  const longitudes: number[] = [];
  let south = Infinity;
  let north = -Infinity;

  const position = (value: unknown): boolean => {
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      !value.every(
        (coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate),
      ) ||
      Math.abs(value[1]) > 90
    )
      return false;
    longitudes.push(value[0]);
    south = Math.min(south, value[1]);
    north = Math.max(north, value[1]);
    return true;
  };

  const coordinates = (value: unknown, depth: number): boolean => {
    if (depth === 0) return position(value);
    return (
      Array.isArray(value) &&
      value.every((child) => coordinates(child, depth - 1))
    );
  };

  // Accept empty geometry containers, but reject a malformed position anywhere
  // in a multipart object rather than silently anchoring to its valid fragment.
  const collect = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const item = value as {
      type?: unknown;
      coordinates?: unknown;
      geometries?: unknown;
    };
    switch (item.type) {
      case "Point":
        return Array.isArray(item.coordinates) && item.coordinates.length === 0
          ? true
          : position(item.coordinates);
      case "MultiPoint":
      case "LineString":
        return coordinates(item.coordinates, 1);
      case "MultiLineString":
      case "Polygon":
        return coordinates(item.coordinates, 2);
      case "MultiPolygon":
        return coordinates(item.coordinates, 3);
      case "GeometryCollection":
        return Array.isArray(item.geometries) && item.geometries.every(collect);
      default:
        return false;
    }
  };

  if (!collect(geometry) || longitudes.length === 0) return null;
  let west = Infinity;
  let east = -Infinity;
  for (const longitude of longitudes) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
  }
  const latitude = south + (north - south) / 2;
  // Preserve ordinary coordinates (including an already unwrapped world copy)
  // exactly, and avoid introducing modulo-rounding noise into Amsterdam points.
  if (east - west <= 180) return [west + (east - west) / 2, latitude];

  // On the longitude circle, the shortest enclosing arc is the complement of
  // its largest empty gap. This keeps 179° and -179° centered on the dateline.
  const wrapped = longitudes
    .map((longitude) => ((longitude % 360) + 360) % 360)
    .sort((a, b) => a - b);
  let largestGap = -1;
  let arcStart = wrapped[0];
  for (let index = 0; index < wrapped.length; index++) {
    const next =
      index + 1 < wrapped.length ? wrapped[index + 1] : wrapped[0] + 360;
    const gap = next - wrapped[index];
    if (gap > largestGap) {
      largestGap = gap;
      arcStart = next % 360;
    }
  }
  let longitude = (arcStart + (360 - largestGap) / 2) % 360;
  if (longitude > 180) longitude -= 360;
  return [longitude, latitude];
}
