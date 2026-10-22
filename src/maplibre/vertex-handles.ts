import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate } from '../core/types.js';

export interface VertexHandle {
  kind: 'vertex' | 'midpoint';
  index: number;
  coordinate: Coordinate;
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
