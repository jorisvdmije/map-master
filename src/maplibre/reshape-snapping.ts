import type { Map as MapLibreMap } from 'maplibre-gl';
import { SnapIndex, type ScreenPoint } from '../core/snapping.js';
import { projectToEdge } from '../core/reshape-polygon.js';
import type { PolygonFeature, SnapResult } from '../core/types.js';

/** Attach only to the reshape target, even when general snapping is disabled.
 * Cache the projected index until the camera changes; never upload geometry.
 */
export class ReshapeSnapping {
  private target: PolygonFeature | null = null;
  private index: SnapIndex | undefined;
  constructor(private readonly map: MapLibreMap) {}
  start(target: PolygonFeature): void { this.target = target; this.index = undefined; }
  clear(): void { this.target = null; this.index = undefined; }
  invalidateCamera(): void { this.index = undefined; }
  resolve(point: ScreenPoint): SnapResult | null {
    const target = this.target;
    if (!target) return null;
    this.index ??= new SnapIndex({ type: 'FeatureCollection', features: [target] }, (coordinate) => this.map.project(coordinate));
    const snap = this.index.query(point, { enabled: true, vertices: true, edges: true, distance: 18 },
      ({ x, y }) => this.map.unproject([x, y]).wrap().toArray());
    if (snap?.kind === 'edge') {
      const ring = target.geometry.coordinates[0]!;
      // Screen unprojection is not generally on a straight lon/lat edge. Attach
      // to the core's planar segment and check the actual marker's pixel distance.
      snap.coordinate = projectToEdge(snap.coordinate, ring[snap.index]!, ring[snap.index + 1]!).point;
      const pixel = this.map.project(snap.coordinate);
      snap.distance = Math.hypot(pixel.x - point.x, pixel.y - point.y);
      if (snap.distance > 18) return null;
    }
    return snap;
  }
}
