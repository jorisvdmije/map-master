import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { EditorAppearance, ShapeAppearance, PointAppearance } from '../core/appearance.js';
import { resolveStyling, validateFeatureStyle, validatePalette, type EditorStylingOptions, type FeatureStyle, type StylingIssue } from '../core/feature-styling.js';
import { overlapRegions, type OverlapRegion } from '../core/overlap-regions.js';
import type { FeatureId, GeometryFeatureCollection } from '../core/types.js';

export const styleProperty = '__geo_editor_style';
export const renderIdProperty = '__geo_editor_id';
const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

/** A power-of-two, seamless tile; pixelRatio preserves the requested band width. */
export function stripeImage(colors: readonly string[], width: number, descending: boolean): { width: number; height: number; data: Uint8Array; pixelRatio: number } {
  const period = colors.length * width * Math.SQRT2;
  const size = 2 ** Math.ceil(Math.log2(period));
  const rgb = colors.map(color => {
    const hex = color.length === 4 ? color.slice(1).split('').map(c => c + c).join('') : color.slice(1);
    return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  });
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const phase = ((x + (descending ? -y : y)) % size + size) % size;
    const color = rgb[Math.floor(phase * colors.length / size)]!;
    const offset = (y * size + x) * 4;
    data[offset] = color[0]!; data[offset + 1] = color[1]!; data[offset + 2] = color[2]!; data[offset + 3] = 255;
  }
  return { width: size, height: size, data, pixelRatio: size / period };
}

/** Cached display-only styles and planar overlap cells; never owns document data. */
export class FeatureStyling {
  options: EditorStylingOptions;
  issues: StylingIssue[] = [];
  private collection: GeometryFeatureCollection = { type: 'FeatureCollection', features: [] };
  private styles = new Map<FeatureId, FeatureStyle>();
  private selected = new Set<FeatureId>();
  private geometryKey = '';
  private regions: OverlapRegion[] = [];
  private geometryError: string | undefined;
  private images = new Map<string, number>();
  private currentImages = new Set<string>();
  private pendingImages = new Map<string, ReturnType<typeof stripeImage>>();
  private cells: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  active = false;
  private uploaded = false;
  readonly sourceId: string;

  constructor(private readonly map: MapLibreMap, private readonly namespace: string, options: EditorStylingOptions) {
    this.options = options; this.sourceId = `${namespace}-styled-areas`;
    map.on('idle', this.pruneImages);
  }

  /** Expressions keep global defaults live without uploading committed geometry. */
  paint(group: 'shape' | 'marker', key: keyof ShapeAppearance | keyof PointAppearance, appearance: EditorAppearance): ExpressionSpecification {
    const base = appearance[group === 'shape' ? 'feature' : 'marker'] as unknown as Record<string, string | number>;
    const selection = appearance[group === 'shape' ? 'selected' : 'selectedMarker'] as unknown as Record<string, string | number>;
    const value = this.options.feature
      ? ['coalesce', ['get', `${styleProperty}_${group}_${key}`], base[key]!] : base[key]!;
    const overrides = this.options.selected?.[group] as Record<string, string | number> | undefined;
    const selectedValue = this.options.selected === undefined ? selection[key]! : overrides?.[key] ?? value;
    return ['case', selected, selectedValue, value] as ExpressionSpecification;
  }
  get sortKey(): ExpressionSpecification { return ['coalesce', ['get', `${styleProperty}_sortKey`], 0]; }

  properties(id: FeatureId): Record<string, string | number> {
    const style = this.styles.get(id);
    const properties: Record<string, string | number> = { [`${styleProperty}_sortKey`]: style?.sortKey ?? 0 };
    for (const group of ['shape', 'marker'] as const) for (const [key, value] of Object.entries(style?.[group] ?? {})) properties[`${styleProperty}_${group}_${key}`] = value;
    return properties;
  }

  prepare(collection: GeometryFeatureCollection, appearance: EditorAppearance): void {
    this.collection = collection; this.issues = []; this.styles.clear();
    if (this.options.feature) for (const feature of collection.features) {
      try {
        // Host callbacks may mutate their input; never expose retained render/core data.
        const result = this.options.feature(structuredClone(feature));
        if (result != null) this.styles.set(feature.id, validateFeatureStyle(result));
      } catch (error) { this.issues.push({ kind: 'feature', featureId: feature.id, message: String(error) }); }
    }
    this.prepareAreas(appearance);
  }

  restyle(appearance: EditorAppearance): void { this.prepareAreas(appearance); this.upload(); }

  private prepareAreas(appearance: EditorAppearance): void {
    this.issues = this.issues.filter(issue => issue.kind !== 'overlap');
    this.active = false; this.cells = { type: 'FeatureCollection', features: [] };
    this.currentImages.clear(); this.pendingImages.clear();
    for (const id of this.images.keys()) if (!this.map.hasImage(id)) this.images.delete(id);
    const overlap = this.options.overlap;
    if (!overlap?.enabled) return;
    try {
      const polygons = this.collection.features.filter(feature => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon');
      const key = JSON.stringify(polygons.map(feature => [feature.id, feature.geometry]));
      if (key !== this.geometryKey) {
        this.geometryKey = key; this.regions = []; this.geometryError = undefined;
        try { this.regions = overlapRegions(polygons); } catch (error) { this.geometryError = String(error); }
      }
      if (this.geometryError) throw new Error(this.geometryError);
      const features = new Map(polygons.map(feature => [feature.id, feature]));
      const cells: GeoJSON.Feature[] = [];
      const paletteCache = new Map<string, string>();
      for (const region of this.regions) {
        const id = region.members[0]!;
        const properties: Record<string, unknown> = { [renderIdProperty]: JSON.stringify(id), ...this.properties(id), kind: 'single' };
        if (region.members.length > 1) {
          const memberKey = JSON.stringify(region.members);
          let imageId = paletteCache.get(memberKey);
          if (!imageId) {
            const color = (id: FeatureId) => this.styles.get(id)?.shape?.fillColor ?? appearance.feature.fillColor;
            const colors = validatePalette(typeof overlap.palette === 'function'
              ? overlap.palette(region.members.map(id => ({ feature: structuredClone(features.get(id)!), color: color(id) })))
              : overlap.palette ?? region.members.map(color));
            imageId = `${this.namespace}-stripes-${JSON.stringify([colors, overlap.stripeWidth, overlap.direction])}`;
            this.currentImages.add(imageId);
            if (this.currentImages.size > 128) throw new RangeError('Overlap styling supports at most 128 distinct patterns.');
            if (!this.map.hasImage(imageId) && !this.pendingImages.has(imageId)) {
              const size = 2 ** Math.ceil(Math.log2(colors.length * overlap.stripeWidth! * Math.SQRT2));
              const retained = [...this.images.values()].reduce((sum, bytes) => sum + bytes, 0);
              const pending = [...this.pendingImages.values()].reduce((sum, image) => sum + image.data.byteLength, 0);
              if (retained + pending + size * size * 4 > 8 * 1024 * 1024) throw new RangeError('Overlap texture cache exceeds 8 MiB; refresh after the map becomes idle.');
              this.pendingImages.set(imageId, stripeImage(colors, overlap.stripeWidth!, overlap.direction === 'descending'));
            }
            paletteCache.set(memberKey, imageId);
          }
          properties.kind = 'overlap'; properties.pattern = imageId;
        }
        cells.push({ type: 'Feature', properties, geometry: { type: 'MultiPolygon', coordinates: region.coordinates } });
      }
      this.cells.features = cells; this.active = true;
    } catch (error) {
      this.currentImages.clear(); this.pendingImages.clear();
      this.issues.push({ kind: 'overlap', message: String(error) });
    }
  }

  upload(): void {
    if (!this.map.getSource(this.sourceId) || !this.active && !this.uploaded) return;
    this.uploaded = this.active;
    for (const [id, data] of this.pendingImages) {
      if (!this.map.hasImage(id)) this.map.addImage(id, data, { pixelRatio: data.pixelRatio });
      this.images.set(id, data.data.byteLength);
    }
    this.pendingImages.clear();
    void this.map.getSource<GeoJSONSource>(this.sourceId)!.setData(this.cells);
  }

  setSelection(ids: ReadonlySet<FeatureId>, force = false): void {
    if (!this.options.overlap?.enabled || !this.map.getSource(this.sourceId)) return;
    for (const id of this.selected) if (!ids.has(id)) this.map.removeFeatureState({ source: this.sourceId, id: JSON.stringify(id) }, 'selected');
    for (const id of ids) if (force || !this.selected.has(id)) this.map.setFeatureState({ source: this.sourceId, id: JSON.stringify(id) }, { selected: true });
    this.selected = new Set(ids);
  }

  snapshot(): EditorStylingOptions { return resolveStyling(this.options); }
  private readonly pruneImages = (): void => {
    for (const id of this.images.keys()) if (!this.currentImages.has(id)) {
      if (this.map.hasImage(id)) this.map.removeImage(id);
      this.images.delete(id);
    }
  };
  destroy(removeResources: boolean): void {
    this.map.off('idle', this.pruneImages);
    if (removeResources) for (const id of this.images.keys()) if (this.map.hasImage(id)) this.map.removeImage(id);
    this.images.clear(); this.pendingImages.clear(); this.regions = []; this.styles.clear(); this.selected.clear();
    this.collection = { type: 'FeatureCollection', features: [] }; this.cells.features = [];
  }
}
