import type { Map as MapLibreMap } from 'maplibre-gl';
import { SnapIndex, snappingOptions, type ScreenPoint } from '../core/snapping.js';
import type { FeatureId, GeometryFeatureCollection, SnapResult, SnappingOptions } from '../core/types.js';

/** Cache source geometry by data revision and projected candidates by camera state. */
export class MapLibreSnapping {
  private options: SnappingOptions;
  private revision = -1;
  private collection: GeometryFeatureCollection = { type: 'FeatureCollection', features: [] };
  private index: SnapIndex | undefined;

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
  clear(): void { this.index = undefined; this.revision = -1; this.collection = { type: 'FeatureCollection', features: [] }; }

  resolve(point: ScreenPoint, revision: number, read: () => GeometryFeatureCollection, excludedFeatureId: FeatureId | null = null): SnapResult | null {
    if (!this.options.enabled || !this.options.vertices && !this.options.edges) return null;
    if (revision !== this.revision) {
      this.collection = read(); this.revision = revision; this.index = undefined;
    }
    this.index ??= new SnapIndex(this.collection, (coordinate) => this.map.project(coordinate));
    return this.index.query(point, this.options, ({ x, y }) => this.map.unproject([x, y]).wrap().toArray(), excludedFeatureId);
  }
}
