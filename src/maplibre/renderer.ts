import { geoJSONSource } from '../gl/map.js';
import { DataLayerStore, featureDataLayerId, type DataLayer } from '../core/data-layers.js';
import { TextMarkerOverlay } from './text-marker-overlay.js';
import { isTextMarker, type TextMarkerOptions } from '../core/text-marker.js';
import type { EditorStylingOptions, StylingIssue } from '../core/feature-styling.js';
import { FeatureStyling, renderIdProperty, dataLayerProperty } from './feature-styling.js';
import { geometryParts, type GeometryPart } from '../core/geometry.js';
import type { EditorAppearance, PointAppearance } from '../core/appearance.js';
import type { ExpressionSpecification, LayerSpecification, EditorMap as MapLibreMap } from '../gl/map.js';
import { samePosition } from '../core/polygon.js';
import type { Coordinate, CutFeedback, SharedBoundaryPreview, ReshapePreview, UnionPreview, SplitPreview, SnapResult, FeatureId, EditorState, GeometryFeatureCollection } from '../core/types.js';
import { PreviewBorder } from './preview-border.js';
import { vertexHandles } from './vertex-handles.js';
import { polygonLineWidth } from './polygon-outline.js';
import { pinImage } from './pin-image.js';

const emptyCollection = () => ({ type: 'FeatureCollection' as const, features: [] });
const circlePaint = (point: PointAppearance) => ({
  'circle-radius': point.radius, 'circle-color': point.color, 'circle-opacity': point.opacity,
  'circle-stroke-color': point.strokeColor, 'circle-stroke-width': point.strokeWidth,
});
// String UUIDs need promoteId to survive MapLibre's numeric vector-tile IDs.
// This property exists only in render data; the core/export never receives it.
type PreviewFeature = {
  type: 'Feature'; properties: { kind?: 'cut-contact' | 'cut-problem' | 'marker' | 'vertex' | 'midpoint' | 'snap' | 'split-part' | 'reshape' | 'shared-boundary-part'; part?: number; active?: boolean; locked?: boolean; snapKind?: 'vertex' | 'edge' };
  geometry: { type: 'Point'; coordinates: Coordinate }
    | { type: 'LineString'; coordinates: Coordinate[] }
    | { type: 'Polygon'; coordinates: Coordinate[][] };
};

/** Owns map resources and visualization, never the authoritative feature data. */
export class MapLibreRenderer {
  private readonly textMarkers: TextMarkerOverlay;
  private readonly featuresId: string;
  private readonly draftId: string;
  private layers: LayerSpecification[];
  private dataLayers: readonly DataLayer[] = new DataLayerStore().layers;
  private fillIds: string[] = [];
  private outlineIds: string[] = [];
  private layerRanks = new Map<FeatureId, number>();
  private selectedFeatureIds = new Set<FeatureId>();
  private editingFeatureIds = new Set<FeatureId>();
  private hiddenFeatureIds = new Set<FeatureId>();
  private comparisonIds = new Set<FeatureId>();
  private readonly translationPreview: PreviewBorder;
  private readonly draftBorder: PreviewBorder;
  private transfer: { ids: Set<FeatureId>; revision: number; ready: boolean; revealed: boolean } | undefined;
  private translationVisible = false;
  private revision = 0;
  private readonly styling: FeatureStyling;
  private appearance: EditorAppearance;
  private committed: GeometryFeatureCollection = { type: 'FeatureCollection', features: [] };
  private areasVisible = false;

  constructor(private readonly map: MapLibreMap, private readonly namespace: string, appearance: EditorAppearance, styling: EditorStylingOptions = {}) {
    this.textMarkers = new TextMarkerOverlay(map);
    this.appearance = appearance;
    this.styling = new FeatureStyling(map, namespace, styling);
    this.translationPreview = new PreviewBorder(map, 'translation-preview', appearance.draft, true, appearance.draftMarker, appearance.polygonOutline);
    this.draftBorder = new PreviewBorder(map, 'draft-border', appearance.draft, false, appearance.draftMarker, appearance.polygonOutline);
    this.featuresId = `${namespace}-features`;
    this.draftId = `${namespace}-draft`;
    this.layers = this.makeLayers(appearance);
  }

  private makeLayers(appearance: EditorAppearance): LayerSpecification[] {
    const { namespace } = this;
    const { feature, draft, vertex, midpoint, snap, pivot, draftMarker } = appearance;
    const shape = (key: keyof EditorAppearance['feature']) => this.styling.paint('shape', key, appearance);
    const marker = (key: keyof PointAppearance) => this.styling.paint('marker', key, appearance);
    const sort = this.styling.sortKey;
    const editing: ExpressionSpecification = ['boolean', ['feature-state', 'editing'], false];
    const visible = (expression: ExpressionSpecification): ExpressionSpecification => ['case', editing, 0, ...expression.slice(1)] as ExpressionSpecification;
    const layers: LayerSpecification[] = [
      { id: `${namespace}-fill`, type: 'fill', source: this.featuresId,
        filter: ['==', '$type', 'Polygon'],
        layout: { 'fill-sort-key': sort },
        paint: { 'fill-color': shape('fillColor'),
          'fill-opacity': this.areasVisible ? 0 : visible(shape('fillOpacity')), 'fill-opacity-transition': { duration: 0 } } },
      { id: `${namespace}-styled-fill`, type: 'fill', source: this.styling.sourceId, filter: ['==', 'kind', 'single'],
        layout: { visibility: this.areasVisible ? 'visible' : 'none' },
        paint: { 'fill-color': shape('fillColor'), 'fill-opacity': shape('fillOpacity'), 'fill-antialias': false, 'fill-opacity-transition': { duration: 0 } } },
      { id: `${namespace}-overlap-stripes`, type: 'fill', source: this.styling.sourceId, filter: ['==', 'kind', 'overlap'],
        layout: { visibility: this.areasVisible ? 'visible' : 'none' },
        paint: { 'fill-pattern': ['get', 'pattern'], 'fill-opacity': this.styling.options.overlap?.opacity ?? 0.7, 'fill-antialias': false, 'fill-opacity-transition': { duration: 0 } } },
      { id: this.featuresId, type: 'line', source: this.featuresId,
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': sort },
        paint: { 'line-color': shape('lineColor'),
          'line-width': polygonLineWidth(shape('lineWidth'), appearance.polygonOutline),
          'line-opacity': visible(shape('lineOpacity')), 'line-opacity-transition': { duration: 0 } } },
      { id: `${namespace}-markers`, type: 'circle', source: this.featuresId,
        filter: ['all', ['==', '$type', 'Point'], ['!=', '__mm_text', true], ['!=', '__mm_pin', true]], layout: { 'circle-sort-key': sort },
        paint: { 'circle-radius': marker('radius'),
          'circle-color': marker('color'),
          'circle-stroke-color': marker('strokeColor'),
          'circle-stroke-width': marker('strokeWidth'),
          'circle-opacity': visible(marker('opacity')),
          'circle-stroke-opacity': visible(marker('opacity')),
          'circle-opacity-transition': { duration: 0 }, 'circle-stroke-opacity-transition': { duration: 0 } } },
      { id: `${namespace}-pins`, type: 'symbol', source: this.featuresId,
        filter: ['all', ['==', '$type', 'Point'], ['!=', '__mm_text', true], ['==', '__mm_pin', true]],
        layout: { 'icon-image': `${namespace}-pin`, 'icon-anchor': 'bottom', 'icon-offset': [0, 4],
          'icon-size': ['/', ['coalesce', ['get', '__geo_editor_style_marker_radius'], appearance.marker.radius], 12],
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'symbol-sort-key': sort },
        paint: { 'icon-color': marker('color'), 'icon-opacity': visible(marker('opacity')),
          'icon-halo-color': marker('strokeColor'), 'icon-halo-width': marker('strokeWidth'),
          'icon-opacity-transition': { duration: 0 }, 'icon-color-transition': { duration: 0 }, 'icon-halo-color-transition': { duration: 0 } } },
      { id: `${namespace}-simplification-original`, type: 'line', source: this.featuresId,
        filter: ['!=', '$type', 'Point'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': feature.lineColor, 'line-width': polygonLineWidth(Math.max(1, feature.lineWidth), appearance.polygonOutline),
          'line-opacity': ['case', ['boolean', ['feature-state', 'comparison'], false], feature.lineOpacity * 0.3, 0],
          'line-opacity-transition': { duration: 0 } } },
      { id: `${namespace}-draft-marker`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'marker'], paint: circlePaint(draftMarker) },
      { id: `${namespace}-draft-fill`, type: 'fill', source: this.draftId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['case', ['==', ['get', 'part'], 1], draft.secondaryFillColor, draft.fillColor], 'fill-opacity': draft.fillOpacity } },
      { id: `${namespace}-midpoints`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'midpoint'],
        paint: circlePaint(midpoint) },
      { id: `${namespace}-vertices`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'vertex'],
        paint: { ...circlePaint(vertex), 'circle-radius': ['case', ['boolean', ['get', 'active'], false], vertex.activeRadius, vertex.radius],
          'circle-color': ['case', ['boolean', ['get', 'locked'], false], vertex.lockedColor, ['boolean', ['get', 'active'], false], vertex.activeColor, vertex.color] } },
      { id: `${namespace}-transform-pivot`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'transform-pivot'],
        paint: circlePaint(pivot) },
      { id: `${namespace}-cut-problem-lines`, type: 'line', source: this.draftId,
        filter: ['all', ['==', 'kind', 'cut-problem'], ['==', '$type', 'LineString']],
        paint: { 'line-color': '#dc2626', 'line-width': 5, 'line-dasharray': [2, 1] } },
      { id: `${namespace}-cut-contacts`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'cut-contact'],
        paint: { 'circle-color': '#ffffff', 'circle-radius': 7, 'circle-stroke-color': '#0f766e', 'circle-stroke-width': 3 } },
      { id: `${namespace}-cut-problems`, type: 'circle', source: this.draftId,
        filter: ['all', ['==', 'kind', 'cut-problem'], ['==', '$type', 'Point']],
        paint: { 'circle-color': '#dc2626', 'circle-radius': 7, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } },
      { id: `${namespace}-snap`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'snap'],
        paint: { ...circlePaint(snap), 'circle-radius': ['case', ['==', ['get', 'snapKind'], 'vertex'], snap.radius, snap.edgeRadius] } },
    ];
    const committed = layers.slice(0, 7);
    const stack = this.dataLayers.flatMap(dataLayer => committed.map((layer): LayerSpecification => ({
      ...layer,
      id: dataLayer.id === 'default' ? layer.id : `${namespace}-data-${encodeURIComponent(dataLayer.id)}-${layer.id.slice(namespace.length + 1)}`,
      filter: ['all', ...(layer.filter ? [layer.filter] : []), ['==', dataLayerProperty, dataLayer.id]],
      layout: { ...layer.layout, visibility: dataLayer.visible ? layer.layout?.visibility ?? 'visible' : 'none' },
    })));
    this.fillIds = stack.filter(layer => layer.type === 'fill' && layer.source === this.featuresId).map(layer => layer.id);
    this.outlineIds = stack.filter(layer => 'source' in layer && layer.source === this.featuresId && (layer.type === 'circle' || layer.type === 'symbol' || layer.type === 'line' && !layer.id.endsWith('simplification-original'))).map(layer => layer.id);
    return [...stack, ...layers.slice(7)];
  }

  setDataLayers(layers: readonly DataLayer[]): void {
    const old = this.layers; this.dataLayers = layers; this.styling.setDataLayers(layers);
    this.layers = this.makeLayers(this.appearance);
    if (!this.map.getSource(this.featuresId)) return;
    const next = new Set(this.layers.map(layer => layer.id));
    for (const layer of [...old].reverse()) if (!next.has(layer.id) && this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
    for (const layer of this.layers) if (!this.map.getLayer(layer.id)) this.map.addLayer(layer);
    this.applyLayers();
    for (const layer of this.layers) if (this.map.getLayer(layer.id)) this.map.moveLayer(layer.id);
  }

  setAppearance(appearance: EditorAppearance): void {
    this.appearance = appearance;
    this.styling.restyle(appearance);
    this.areasVisible = this.styling.active && this.hiddenFeatureIds.size === 0;
    this.layers = this.makeLayers(appearance);
    this.applyLayers();
    // Restyle existing overlays without interrupting a drag/commit handoff.
    this.draftBorder.setAppearance(appearance.draft, appearance.draftMarker, appearance.polygonOutline);
    this.translationPreview.setAppearance(appearance.draft, appearance.draftMarker, appearance.polygonOutline);
  }

  private applyLayers(): void {
    for (const layer of this.layers) {
      if (!this.map.getLayer(layer.id)) continue;
      for (const [property, value] of Object.entries(layer.layout ?? {})) this.map.setLayoutProperty(layer.id, property, value);
      for (const [property, value] of Object.entries(layer.paint ?? {})) {
        // Keys and values originate from our typed LayerSpecifications, never user paint objects.
        this.map.setPaintProperty(layer.id, property, value);
      }
    }
  }

  mount(): void {
    this.renderComparison([]);
    this.stopTransfer();
    this.draftBorder.clear();
    this.renderEditingMany([]);
    if (!this.map.getSource(this.featuresId)) this.selectedFeatureIds.clear();
    for (const id of [this.featuresId, this.draftId, this.styling.sourceId]) {
      if (!this.map.getSource(id)) this.map.addSource(id, {
        type: 'geojson', data: emptyCollection(),
        ...(id !== this.draftId ? { promoteId: renderIdProperty } : {}),
      });
    }
    if (!this.map.hasImage(`${this.namespace}-pin`)) this.map.addImage(`${this.namespace}-pin`, pinImage(), { pixelRatio: 2, sdf: true });
    for (const layer of this.layers) {
      if (!this.map.getLayer(layer.id)) this.map.addLayer(layer);
    }
  }

  renderCommitted(collection: GeometryFeatureCollection): void {
    this.committed = collection;
    const ranks = new Map(this.dataLayers.map((layer, index) => [layer.id, index]));
    this.layerRanks = new Map(collection.features.map(feature => [feature.id, ranks.get(featureDataLayerId(feature)) ?? 0]));
    this.textMarkers.setCommitted(collection.features);
    this.styling.prepare(collection, this.appearance);
    this.styling.upload();
    this.refreshAreaVisibility();
    const revision = ++this.revision;
    if (this.transfer) {
      this.transfer.revision = revision; this.transfer.ready = false; this.transfer.revealed = false;
      this.renderEditingMany([...this.editingFeatureIds], true);
      if (this.translationVisible) {
        const features = new Map(collection.features.map((feature) => [feature.id, feature]));
        this.translationPreview.render([...this.transfer.ids].flatMap((id) => { const feature = features.get(id); return feature ? [feature.geometry] : []; }));
      }
    }
    const source = geoJSONSource(this.map, this.featuresId);
    // Encode ID types; keep old tiles hidden until the worker AND visible tiles are ready.
    void Promise.resolve(source?.setData({
      type: 'FeatureCollection', features: collection.features.map((feature) => ({
        ...feature, properties: { [renderIdProperty]: JSON.stringify(feature.id), ...this.styling.properties(feature.id),
          __mm_text: isTextMarker(feature), __mm_pin: this.styling.properties(feature.id).__geo_editor_style_marker_shape === 'pin', [dataLayerProperty]: featureDataLayerId(feature) },
      })),
    })).then(() => {
      if (this.transfer?.revision !== revision || this.map.getSource(this.featuresId) !== source) return;
      this.transfer.ready = true; this.map.triggerRepaint();
    }, () => { /* The renderer reports source errors through the map error event. Keep the final preview. */ });
  }

  getStyling(): EditorStylingOptions { return this.styling.snapshot(); }
  getStylingIssues(): StylingIssue[] { return this.styling.issues.map(issue => ({ ...issue })); }
  setStyling(options: EditorStylingOptions): void {
    this.styling.options = options;
    this.refreshStyling();
  }
  refreshStyling(): void {
    this.renderCommitted(this.committed);
    this.layers = this.makeLayers(this.appearance);
    this.applyLayers();
    this.renderSelection([...this.selectedFeatureIds], true);
  }
  private refreshAreaVisibility(): void {
    const visible = this.styling.active && this.hiddenFeatureIds.size === 0;
    if (visible === this.areasVisible) return;
    this.areasVisible = visible;
    this.layers = this.makeLayers(this.appearance);
    this.applyLayers();
  }

  get transferringTranslation(): boolean { return this.transfer !== undefined; }

  /** Bridge a released drag to the asynchronously rebuilt committed source. */
  holdTranslation(): void {
    this.transfer = { ids: new Set(this.editingFeatureIds), revision: this.revision, ready: false, revealed: false };
    this.renderEditingMany([]);
    this.map.off('render', this.finishTransfer);
    this.map.on('render', this.finishTransfer);
  }

  private readonly finishTransfer = (): void => {
    const transfer = this.transfer;
    if (!transfer?.ready || !this.map.getSource(this.featuresId) || !this.map.isSourceLoaded(this.featuresId)) return;
    if (!transfer.revealed) {
      transfer.revealed = true;
      this.renderEditingMany([...this.editingFeatureIds], true);
      // Keep the overlay through this frame. Remove it only after a frame has
      // actually painted the new committed tiles with their restored opacity.
      this.map.triggerRepaint();
      return;
    }
    this.stopTransfer();
  };

  private stopTransfer(): void {
    this.transfer = undefined;
    this.map.off('render', this.finishTransfer);
    this.translationVisible = false;
    this.translationPreview.clear();
    this.textMarkers.setDraft([]);
  }

  /** Update only presentation state, without copying or re-uploading geometry. */
  renderSelection(ids: readonly FeatureId[], force = false): void {
    const next = new Set(ids);
    if (this.map.getSource(this.featuresId)) {
      for (const id of this.selectedFeatureIds) {
        if (!next.has(id)) this.map.removeFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, 'selected');
      }
      for (const id of next) {
        if (force || !this.selectedFeatureIds.has(id)) this.map.setFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, { selected: true });
      }
    }
    this.styling.setSelection(next, force);
    this.selectedFeatureIds = next;
    this.textMarkers.setSelection(next);
  }

  /** Hide only the committed version of the feature being previewed as an edit. */
  renderEditing(id: FeatureId | null): void {
    this.renderEditingMany(id === null ? [] : [id], true);
  }

  renderEditingMany(ids: readonly FeatureId[], force = false): void {
    this.editingFeatureIds = new Set(ids);
    const next = new Set(ids);
    if (this.transfer && !this.transfer.revealed) for (const id of this.transfer.ids) next.add(id);
    if (this.map.getSource(this.featuresId)) {
      for (const id of this.hiddenFeatureIds) {
        if (!next.has(id)) this.map.removeFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, 'editing');
      }
      for (const id of next) {
        if (force || !this.hiddenFeatureIds.has(id)) this.map.setFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, { editing: true });
      }
    }
    this.hiddenFeatureIds = next;
    this.textMarkers.setHidden(next);
    this.refreshAreaVisibility();
  }

  /** Reveal a faint original outline from existing tiles, below the result preview. */
  renderComparison(ids: readonly FeatureId[]): void {
    const next = new Set(ids);
    if (this.map.getSource(this.featuresId)) {
      for (const id of this.comparisonIds) {
        if (!next.has(id)) this.map.removeFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, 'comparison');
      }
      for (const id of next) {
        if (!this.comparisonIds.has(id)) this.map.setFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, { comparison: true });
      }
    }
    this.comparisonIds = next;
  }

  /** Synchronous selected-only overlay: no worker/tile lag or tile-local dash phase. */
  renderTranslation(features: GeometryFeatureCollection['features']): void {
    this.translationVisible = true;
    this.draftBorder.clear();
    this.translationPreview.render(features.map((feature) => feature.geometry));
    this.textMarkers.setPreview(features);
  }

  renderTransform(collection: GeometryFeatureCollection | null, pivot?: Coordinate, snap: SnapResult | null = null): void {
    this.translationVisible = false; this.translationPreview.clear();
    const features = collection?.features ?? [];
    this.textMarkers.setPreview(features);
    this.draftBorder.render(features.map((feature) => feature.geometry));
    // Do not copy application properties into renderer styling fields.
    void geoJSONSource(this.map, this.draftId)?.setData({ type: 'FeatureCollection', features: [
      ...features.map((feature) => ({ type: 'Feature' as const, properties: {}, geometry: feature.geometry })),
      ...(pivot ? [{ type: 'Feature' as const, properties: { kind: 'transform-pivot' }, geometry: { type: 'Point' as const, coordinates: pivot } }] : []),
      ...(snap ? [{ type: 'Feature' as const, properties: { kind: 'snap', snapKind: snap.kind }, geometry: { type: 'Point' as const, coordinates: snap.coordinate } }] : []),
    ] });
  }

  renderOverlay(geometry: UnionPreview | null): void {
    this.translationVisible = false; this.translationPreview.clear();
    this.draftBorder.render(geometry ? [geometry] : []);
    void geoJSONSource(this.map, this.draftId)?.setData({ type: 'FeatureCollection',
      features: geometry ? [{ type: 'Feature', properties: {}, geometry }] : [],
    });
  }

  /** Rectangle, circle and freehand previews: the outline without editing handles, plus the given corners. */
  renderShape(geometry: PreviewFeature['geometry'] | null, corners: Coordinate[], snap: SnapResult | null): void {
    this.translationVisible = false; this.translationPreview.clear();
    const features: PreviewFeature[] = corners.map((coordinates) => ({ type: 'Feature', properties: { kind: 'vertex' }, geometry: { type: 'Point', coordinates } }));
    if (geometry) features.push({ type: 'Feature', properties: {}, geometry });
    if (snap) features.push({ type: 'Feature', properties: { kind: 'snap', snapKind: snap.kind }, geometry: { type: 'Point', coordinates: [...snap.coordinate] } });
    this.draftBorder.render(geometry && geometry.type !== 'Point' ? [geometry] : [], 8);
    void geoJSONSource(this.map, this.draftId)?.setData({ type: 'FeatureCollection', features });
  }

  /** Prefer outlines near the pointer, then polygon interiors, in rendered order. */
  pick(point: { x: number; y: number }): FeatureId | null { return this.pickAll(point)[0] ?? null; }

  /** Every hit at a point: markers/outlines first, then interiors, in rendered order. */
  pickAll({ x, y }: { x: number; y: number }): FeatureId[] {
    const fills = this.fillIds.filter(id => this.map.getLayer(id));
    const outlines = this.outlineIds.filter(id => this.map.getLayer(id));
    if (!fills.length || !outlines.length) return [];
    const hits = [
      ...this.map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], {
        layers: outlines,
      }),
      ...this.map.queryRenderedFeatures([x, y], { layers: fills }),
    ];
    const ids = new Set<FeatureId>(this.textMarkers.pick({ x, y }));
    const staleRanks = new Map<FeatureId, number>();
    for (const hit of hits) {
      if (typeof hit.id !== 'string') continue;
      const id: unknown = JSON.parse(hit.id);
      if ((typeof id === 'string' || typeof id === 'number') && !this.transfer?.ids.has(id)) {
        ids.add(id);
        if (!this.layerRanks.has(id)) {
          const layer: unknown = hit.properties?.[dataLayerProperty];
          if (typeof layer === 'string') staleRanks.set(id, this.dataLayers.findIndex(value => value.id === layer));
        }
      }
    }
    return [...ids].sort((a, b) => (this.layerRanks.get(b) ?? staleRanks.get(b) ?? 0) - (this.layerRanks.get(a) ?? staleRanks.get(a) ?? 0));
  }

  /** All rendered editor features intersecting the screen rectangle, deduplicated. */
  pickBox(a: { x: number; y: number }, b: { x: number; y: number }): FeatureId[] {
    const fills = this.fillIds.filter(id => this.map.getLayer(id));
    const outlines = this.outlineIds.filter(id => this.map.getLayer(id));
    if (!fills.length || !outlines.length) return [];
    const hits = this.map.queryRenderedFeatures([
      [Math.min(a.x, b.x), Math.min(a.y, b.y)], [Math.max(a.x, b.x), Math.max(a.y, b.y)],
    ], { layers: [...outlines, ...fills] });
    const ids = new Set<FeatureId>(this.textMarkers.pick(a, b));
    for (const hit of hits) {
      if (typeof hit.id !== 'string') continue;
      const id: unknown = JSON.parse(hit.id);
      if ((typeof id === 'string' || typeof id === 'number') && !this.transfer?.ids.has(id)) ids.add(id);
    }
    return [...ids].sort((a, b) => (this.layerRanks.get(b) ?? 0) - (this.layerRanks.get(a) ?? 0));
  }

  renderPreview(coordinates: Coordinate[], cursor: Coordinate | undefined, state: EditorState, snap: SnapResult | null = null, split: SplitPreview | null = null, rings: Coordinate[][] | null = null, inactiveParts: GeometryPart[] = [], reshape: ReshapePreview | null = null, trace: Coordinate[] | null = null, shared: SharedBoundaryPreview | null = null, feedback: CutFeedback | null = null, text: TextMarkerOptions | null = null, pinned: GeometryFeatureCollection | null = null): void {
    if (state.mode !== 'idle') { this.translationVisible = false; this.translationPreview.clear(); }
    const textPoint = coordinates[0] ?? cursor;
    this.textMarkers.setDraft([...(text && textPoint ? [{ id: state.selectedFeatureId ?? '', coordinate: textPoint, options: text, preview: true }] : []),
      ...(pinned?.features ?? []).filter(isTextMarker).filter(feature => feature.id !== state.selectedFeatureId).map(feature => ({ id: feature.id, coordinate: feature.geometry.coordinates, options: feature.properties.mapMasterText, preview: true })),
    ]);
    if (state.mode === 'draw-point' || state.mode === 'draw-text') {
      this.draftBorder.clear();
      const point = state.mode === 'draw-text' ? coordinates[0] ?? cursor : cursor ?? coordinates[0];
      const features: PreviewFeature[] = point ? [{ type: 'Feature', properties: { kind: 'marker' }, geometry: { type: 'Point', coordinates: point } }] : [];
      if (snap) features.push({ type: 'Feature', properties: { kind: 'snap', snapKind: snap.kind }, geometry: { type: 'Point', coordinates: snap.coordinate } });
      void geoJSONSource(this.map, this.draftId)?.setData({ type: 'FeatureCollection', features });
      return;
    }
    const editing = state.mode.startsWith('edit-');
    const polygon = state.mode === 'draw-polygon' || state.mode === 'edit-polygon' || state.mode === 'draw-hole';
    const handles = editing ? vertexHandles(this.map, coordinates, polygon)
      : coordinates.map((coordinate, index) => ({ kind: 'vertex' as const, index, coordinate }));
    const selectedVertices = new Set(state.selectedVertexIndices);
    const features: PreviewFeature[] = handles.map((handle) => ({
      type: 'Feature', properties: { kind: handle.kind, active: editing && handle.kind === 'vertex' && selectedVertices.has(handle.index),
        locked: state.mode === 'edit-shared-boundary' && handle.kind === 'vertex' && (handle.index === 0 || handle.index === coordinates.length - 1) },
      geometry: { type: 'Point', coordinates: handle.coordinate },
    }));
    for (const feature of pinned?.features ?? []) {
      if (feature.id !== state.selectedFeatureId) for (const geometry of geometryParts(feature.geometry)) features.push({ type: 'Feature', properties: { kind: geometry.type === 'Point' ? 'marker' : 'shared-boundary-part' }, geometry });
    }
    for (const geometry of pinned ? [] : inactiveParts) features.push({ type: 'Feature', properties: {}, geometry });
    if (snap) features.push({ type: 'Feature', properties: { kind: 'snap', snapKind: snap.kind },
      geometry: { type: 'Point', coordinates: [...snap.coordinate] } });
    if (shared) shared.features.forEach((feature, part) => { features.push({ type: 'Feature', properties: { kind: 'shared-boundary-part', part }, geometry: feature.geometry }); });
    if (reshape) features.push({ type: 'Feature', properties: { kind: 'reshape' }, geometry: reshape });
    if (split) {
      for (const [part, geometry] of [split.retained, split.created].entries()) {
        features.push({ type: 'Feature', properties: { kind: 'split-part', part }, geometry });
      }
    }
    if (trace) coordinates.push(...trace.slice(1));
    const last = coordinates.at(-1);
    if (!editing && last && cursor && !samePosition(last, cursor)) coordinates.push(cursor);
    if (state.mode === 'draw-hole' && coordinates.length < 3 && rings) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon',
        coordinates: rings.slice(0, -1).map((ring) => [...ring, [...ring[0]!] as Coordinate]),
      } });
    }
    const first = coordinates[0];
    const pinnedPrimary = pinned?.features.find(feature => feature.id === state.selectedFeatureId);
    if (pinnedPrimary) {
      for (const geometry of geometryParts(pinnedPrimary.geometry)) if (geometry.type !== 'Point') features.push({ type: 'Feature', properties: {}, geometry });
    } else if (polygon && first && coordinates.length >= 3) {
      if (!samePosition(first, coordinates.at(-1)!)) coordinates.push([...first]);
      features.push({ type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: rings ? rings.map((ring, index) => {
          if (index === (state.activeRingIndex ?? 0)) return coordinates;
          return [...ring, [...ring[0]!] as Coordinate];
        }) : [coordinates] } });
    } else if (coordinates.length >= 2 && !reshape) {
      features.push({ type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates } });
    }
    if (!this.translationVisible) this.draftBorder.render(features.flatMap(({ geometry }) => geometry.type === 'Point' ? [] : [geometry]), editing || state.mode.startsWith('draw-') || state.mode === 'reshape-polygon' ? 8 : 0);
    if (feedback) {
      for (const coordinate of feedback.contacts) features.push({ type: 'Feature', properties: { kind: 'cut-contact' }, geometry: { type: 'Point', coordinates: coordinate } });
      for (const coordinate of feedback.problemPoints) features.push({ type: 'Feature', properties: { kind: 'cut-problem' }, geometry: { type: 'Point', coordinates: coordinate } });
      for (const coordinates of feedback.problemSegments) features.push({ type: 'Feature', properties: { kind: 'cut-problem' }, geometry: { type: 'LineString', coordinates } });
    }
    void geoJSONSource(this.map, this.draftId)?.setData({ type: 'FeatureCollection', features });
  }

  clearPreview(): void {
    this.textMarkers.setDraft([]);
    this.renderComparison([]);
    this.draftBorder.clear();
    this.translationVisible = false; this.translationPreview.clear();
    void geoJSONSource(this.map, this.draftId)?.setData(emptyCollection());
  }

  destroy(removeResources = true): void {
    this.textMarkers.destroy();
    // Mapbox has already released its style by the time remove is emitted.
    if (removeResources) this.renderComparison([]);
    this.comparisonIds.clear();
    this.draftBorder.clear();
    this.stopTransfer();
    this.committed = { type: 'FeatureCollection', features: [] };
    if (!removeResources) { this.styling.destroy(false); return; }
    for (const layer of [...this.layers].reverse()) {
      if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
    }
    for (const id of [this.draftId, this.featuresId, this.styling.sourceId]) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
    if (this.map.hasImage(`${this.namespace}-pin`)) this.map.removeImage(`${this.namespace}-pin`);
    this.styling.destroy(true);
  }
}
