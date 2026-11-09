import type { RoadFeature } from "./model";

const sx = 67900,
  sy = 111200,
  cellSize = 60;
const xy = (p: number[]) => [(p[0]! - 4.9) * sx, (p[1]! - 52.37) * sy];
export function pointSegmentDistance(p: number[], a: number[], b: number[]) {
  const dx = b[0]! - a[0]!,
    dy = b[1]! - a[1]!,
    square = dx * dx + dy * dy;
  const t = square
    ? Math.max(
        0,
        Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy) / square),
      )
    : 0;
  return Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy);
}
/** Each source point is assigned once. Close ties between DIFFERENT names are rejected. */
export function roadMatcher(
  features: RoadFeature[],
  radius = 30,
  ambiguity = 3,
) {
  const cells = new Map<
    string,
    { road: RoadFeature; a: number[]; b: number[] }[]
  >();
  for (const road of features) {
    // Highway furniture and paths beyond the named network are not city street observations.
    if (["HR", "AFR", "OPR"].includes(road.properties.kind)) continue;
    for (const line of road.geometry.coordinates)
      for (let i = 1; i < line.length; i++) {
        const a = xy(line[i - 1]!),
          b = xy(line[i]!),
          edge = { road, a, b };
        for (
          let x = Math.floor((Math.min(a[0]!, b[0]!) - radius) / cellSize);
          x <= Math.floor((Math.max(a[0]!, b[0]!) + radius) / cellSize);
          x++
        ) {
          for (
            let y = Math.floor((Math.min(a[1]!, b[1]!) - radius) / cellSize);
            y <= Math.floor((Math.max(a[1]!, b[1]!) + radius) / cellSize);
            y++
          ) {
            const key = `${x}:${y}`,
              list = cells.get(key);
            if (list) list.push(edge);
            else cells.set(key, [edge]);
          }
        }
      }
  }
  return (coordinates: number[]) => {
    if (
      coordinates.length < 2 ||
      !coordinates.every(Number.isFinite) ||
      coordinates[0]! < 4.6 ||
      coordinates[0]! > 5.3 ||
      coordinates[1]! < 52.2 ||
      coordinates[1]! > 52.5
    )
      return { status: "invalid" as const };
    const p = xy(coordinates),
      candidates =
        cells.get(
          `${Math.floor(p[0]! / cellSize)}:${Math.floor(p[1]! / cellSize)}`,
        ) ?? [];
    const streets = new Map<string, { id: string; distance: number }>();
    for (const edge of candidates) {
      const d = pointSegmentDistance(p, edge.a, edge.b),
        group =
          edge.road.properties.name === "Naamloos wegvak"
            ? edge.road.properties.id
            : edge.road.properties.name;
      const prior = streets.get(group);
      if (
        d <= radius &&
        (!prior ||
          d < prior.distance ||
          (d === prior.distance && edge.road.properties.id < prior.id))
      )
        streets.set(group, { id: edge.road.properties.id, distance: d });
    }
    const order = [...streets.values()].sort(
      (a, b) => a.distance - b.distance || a.id.localeCompare(b.id),
    );
    if (!order.length) return { status: "unmatched" as const };
    if (order[1] && order[1].distance - order[0]!.distance < ambiguity)
      return { status: "ambiguous" as const };
    return { status: "matched" as const, ...order[0]! };
  };
}
