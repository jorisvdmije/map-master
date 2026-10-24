import { traceSource } from '../core/trace-boundary.js';
import { projectToEdge } from '../core/reshape-polygon.js';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { SnapIndex, snappingOptions, type ScreenPoint } from '../core/snapping.js';
import type { FeatureId, GeometryFeature, GeometryFeatureCollection, SnapResult, SnappingOptions } from '../core/types.js';

/** Cache source geometry by data revision and projected candidates by camera state. */
export class MapLibreSnapping {
  private options: SnappingOptions;
  private revision = -1;
  private collection: GeometryFeatureCollection = { type: 'FeatureCollection', features: [] };
  private index: SnapIndex | undefined;
  private features = new Map<FeatureId, GeometryFeature>();

  constructor(private readonly map: MapLibreMap, options?: Partial<SnappingOptions>) {
    this.options = snappingOptions(options);
  }

  getOptions(): SnappingOptions { return { ...this.options }; }
  setOptions(update: Partial<SnappingOptions>): boolean {
    const next = snappingOptions(update, this.options);
    if (JSON.stringify(next) === JSON.stringify(this.options)) return false;
    this.options = next;
    if (!next.enabled) this.clear();
    return true;
  }
  invalidateCamera(): void { this.index = undefined; }
  clear(): void { this.index = undefined; this.revision = -1; this.collection = { type: 'FeatureCollection', features: [] }; this.features.clear(); }

  resolve(point: ScreenPoint, revision: number, read: () => GeometryFeatureCollection, excludedFeatureId: FeatureId | null = null, planar = false): SnapResult | null {
    if (!this.options.enabled || !this.options.vertices && !this.options.edges) return null;
    if (revision !== this.revision) {
      this.collection = read(); this.revision = revision; this.index = undefined;
      this.features = new Map(this.collection.features.map((feature) => [feature.id, feature]));
    }
    this.index ??= new SnapIndex(this.collection, (coordinate) => this.map.project(coordinate));
    const snap = this.index.query(point, this.options, ({ x, y }) => this.map.unproject([x, y]).wrap().toArray(), excludedFeatureId);
    if (planar && snap?.kind === 'edge' && snap.featureId !== null) {
      const feature = this.features.get(snap.featureId)!;
      const source = traceSource(feature, { ...snap, featureId: snap.featureId })!;
      snap.coordinate = projectToEdge(snap.coordinate, source.points[snap.index]!, source.points[snap.index + 1]!).point;
      const pixel = this.map.project(snap.coordinate);
      snap.distance = Math.hypot(pixel.x - point.x, pixel.y - point.y);
      if (snap.distance > this.options.distance) return null;
    }
    return snap;
  }
}
