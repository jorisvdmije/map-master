import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate } from '../core/types.js';
import type { ScreenPoint } from '../core/snapping.js';

export interface VertexHandle {
  kind: 'vertex' | 'midpoint';
  index: number;
  coordinate: Coordinate;
}

/** Enlarged direct-input targets choose the closest corner before an insertion
 * handle. Equal distances retain draft order, independent of selection. */
export function pickDirectVertexHandle(map: MapLibreMap, handles: VertexHandle[], point: ScreenPoint, radius: number): VertexHandle | null {
  for (const kind of ['vertex', 'midpoint'] as const) {
    let best: VertexHandle | null = null; let distance = radius;
    for (const handle of handles) {
      if (handle.kind !== kind) continue;
      const projected = map.project(handle.coordinate);
      const next = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (next <= distance && (best === null || next < distance)) { best = handle; distance = next; }
    }
    if (best) return best;
  }
  return null;
}

/** Inclusive screen rectangle; only actual draft vertices, in draft order. */
export function pickEditVertices(map: MapLibreMap, points: Coordinate[], start: ScreenPoint, end: ScreenPoint, fixedEndpoints: boolean): number[] {
  const left = Math.min(start.x, end.x); const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y); const bottom = Math.max(start.y, end.y);
  const indices: number[] = [];
  points.forEach((coordinate, index) => {
    if (fixedEndpoints && (index === 0 || index === points.length - 1)) return;
    const point = map.project(coordinate);
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) indices.push(index);
  });
  return indices;
}

/** One shared screen-space definition for drawing and picking edit handles. */
export function vertexHandles(map: MapLibreMap, points: Coordinate[], polygon: boolean): VertexHandle[] {
  const handles: VertexHandle[] = points.map((coordinate, index) => ({ kind: 'vertex', index, coordinate }));
  const count = polygon ? points.length : points.length - 1;
  for (let index = 0; index < count; index++) {
    const a = map.project(points[index]!);
    const b = map.project(points[(index + 1) % points.length]!);
    const position = map.unproject([(a.x + b.x) / 2, (a.y + b.y) / 2]).wrap();
    handles.push({ kind: 'midpoint', index: index + 1, coordinate: [position.lng, position.lat] });
  }
  return handles;
}

/** Pick a whole edge only after vertex and insertion handles have been checked. */
export function pickEditEdge(map: MapLibreMap, points: Coordinate[], polygon: boolean, point: ScreenPoint): [number, number] | null {
  let best: [number, number] | null = null; let distance = 6;
  for (let index = 0; index < points.length - (polygon ? 0 : 1); index++) {
    const next = (index + 1) % points.length;
    const a = map.project(points[index]!); const b = map.project(points[next]!);
    const dx = b.x - a.x; const dy = b.y - a.y; const length = dx * dx + dy * dy;
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    const pixels = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    if (pixels < distance) { distance = pixels; best = [index, next]; }
  }
  return best;
}
