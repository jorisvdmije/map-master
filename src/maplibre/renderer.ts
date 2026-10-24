import type { GeometryPart } from '../core/geometry.js';
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { samePosition } from '../core/polygon.js';
import type { Coordinate, SharedBoundaryPreview, ReshapePreview, UnionPreview, SplitPreview, SnapResult, FeatureId, EditorState, GeometryFeatureCollection } from '../core/types.js';
import { PreviewBorder } from './preview-border.js';
import { vertexHandles } from './vertex-handles.js';

const emptyCollection = () => ({ type: 'FeatureCollection' as const, features: [] });
// String UUIDs need promoteId to survive MapLibre's numeric vector-tile IDs.
// This property exists only in render data; the core/export never receives it.
const renderIdProperty = '__geo_editor_id';
type PreviewFeature = {
  type: 'Feature'; properties: { kind?: 'vertex' | 'midpoint' | 'snap' | 'split-part' | 'reshape' | 'shared-boundary-part'; part?: number; active?: boolean; locked?: boolean; snapKind?: 'vertex' | 'edge' };
  geometry: { type: 'Point'; coordinates: Coordinate }
    | { type: 'LineString'; coordinates: Coordinate[] }
    | { type: 'Polygon'; coordinates: Coordinate[][] };
};

/** Owns map resources and visualization, never the authoritative feature data. */
export class MapLibreRenderer {
  private readonly featuresId: string;
  private readonly draftId: string;
  private readonly layers: LayerSpecification[];
  private selectedFeatureIds = new Set<FeatureId>();
  private editingFeatureIds = new Set<FeatureId>();
  private hiddenFeatureIds = new Set<FeatureId>();
  private readonly translationPreview: PreviewBorder;
  private readonly draftBorder: PreviewBorder;
  private transfer: { ids: Set<FeatureId>; revision: number; ready: boolean; revealed: boolean } | undefined;
  private translationVisible = false;
  private revision = 0;

  constructor(private readonly map: MapLibreMap, namespace: string) {
    this.translationPreview = new PreviewBorder(map, 'translation-preview', true);
    this.draftBorder = new PreviewBorder(map, 'draft-border');
    this.featuresId = `${namespace}-features`;
    this.draftId = `${namespace}-draft`;
    const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
    const color: ExpressionSpecification = ['case', selected, '#2563eb', '#116b5b'];
    const editing: ExpressionSpecification = ['boolean', ['feature-state', 'editing'], false];
    this.layers = [
      { id: `${namespace}-fill`, type: 'fill', source: this.featuresId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': color, 'fill-opacity': ['case', editing, 0, selected, 0.3, 0.18], 'fill-opacity-transition': { duration: 0 } } },
      { id: this.featuresId, type: 'line', source: this.featuresId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': ['case', selected, 6, 4], 'line-opacity': ['case', editing, 0, 1], 'line-opacity-transition': { duration: 0 } } },
      { id: `${namespace}-draft-fill`, type: 'fill', source: this.draftId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['case', ['==', ['get', 'part'], 1], '#7c3aed', '#df772e'], 'fill-opacity': 0.22 } },
      { id: `${namespace}-midpoints`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'midpoint'],
        paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#df772e', 'circle-stroke-width': 1 } },
      { id: `${namespace}-vertices`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'vertex'],
        paint: { 'circle-radius': ['case', ['boolean', ['get', 'active'], false], 7, 5],
          'circle-color': ['case', ['boolean', ['get', 'locked'], false], '#64748b', ['boolean', ['get', 'active'], false], '#df772e', '#fff'],
          'circle-stroke-color': '#df772e', 'circle-stroke-width': 2 } },
      { id: `${namespace}-snap`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'snap'],
        paint: { 'circle-radius': ['case', ['==', ['get', 'snapKind'], 'vertex'], 8, 6],
          'circle-color': '#7c3aed', 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } },
    ];
  }

  mount(): void {
    this.stopTransfer();
    this.draftBorder.clear();
    this.renderEditingMany([]);
    if (!this.map.getSource(this.featuresId)) this.selectedFeatureIds.clear();
    for (const id of [this.featuresId, this.draftId]) {
      if (!this.map.getSource(id)) this.map.addSource(id, {
        type: 'geojson', data: emptyCollection(),
        ...(id === this.featuresId ? { promoteId: renderIdProperty } : {}),
      });
    }
    for (const layer of this.layers) {
      if (!this.map.getLayer(layer.id)) this.map.addLayer(layer);
    }
  }

  renderCommitted(collection: GeometryFeatureCollection): void {
    const revision = ++this.revision;
    if (this.transfer) {
      this.transfer.revision = revision; this.transfer.ready = false; this.transfer.revealed = false;
      this.renderEditingMany([...this.editingFeatureIds], true);
      if (this.translationVisible) {
        const features = new Map(collection.features.map((feature) => [feature.id, feature]));
        this.translationPreview.render([...this.transfer.ids].flatMap((id) => { const feature = features.get(id); return feature ? [feature.geometry] : []; }));
      }
    }
    const source = this.map.getSource<GeoJSONSource>(this.featuresId);
    // Encode ID types; keep old tiles hidden until the worker AND visible tiles are ready.
    void source?.setData({
      type: 'FeatureCollection', features: collection.features.map((feature) => ({
        ...feature, properties: { ...feature.properties, [renderIdProperty]: JSON.stringify(feature.id) },
      })),
    }).then(() => {
      if (this.transfer?.revision !== revision || this.map.getSource(this.featuresId) !== source) return;
      this.transfer.ready = true; this.map.triggerRepaint();
    }, () => { /* MapLibre reports source errors through the map error event. Keep the final preview. */ });
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
    this.selectedFeatureIds = next;
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
  }

  /** Synchronous selected-only overlay: no worker/tile lag or tile-local dash phase. */
  renderTranslation(features: GeometryFeatureCollection['features']): void {
    this.translationVisible = true;
    this.draftBorder.clear();
    this.translationPreview.render(features.map((feature) => feature.geometry));
  }

  renderOverlay(geometry: UnionPreview | null): void {
    this.translationVisible = false; this.translationPreview.clear();
    this.draftBorder.render(geometry ? [geometry] : []);
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData({ type: 'FeatureCollection',
      features: geometry ? [{ type: 'Feature', properties: {}, geometry }] : [],
    });
  }

  /** Prefer outlines near the pointer, then polygon interiors, in rendered order. */
  pick({ x, y }: { x: number; y: number }): FeatureId | null {
    const fillId = this.layers[0]!.id;
    if (!this.map.getLayer(this.featuresId) || !this.map.getLayer(fillId)) return null;
    const outlines = this.map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], {
      layers: [this.featuresId],
    });
    const hit = outlines[0] ?? this.map.queryRenderedFeatures([x, y], { layers: [fillId] })[0];
    if (typeof hit?.id !== 'string') return null;
    // Decode even a stale hit: the controller can then ignore deleted IDs instead
    // of treating the stale shape as empty space and clearing another selection.
    const id: unknown = JSON.parse(hit.id);
    if ((typeof id === 'string' || typeof id === 'number') && this.transfer?.ids.has(id)) return null;
    return typeof id === 'string' || typeof id === 'number' ? id : null;
  }

  /** All rendered editor features intersecting the screen rectangle, deduplicated. */
  pickBox(a: { x: number; y: number }, b: { x: number; y: number }): FeatureId[] {
    const fillId = this.layers[0]!.id;
    if (!this.map.getLayer(this.featuresId) || !this.map.getLayer(fillId)) return [];
    const hits = this.map.queryRenderedFeatures([
      [Math.min(a.x, b.x), Math.min(a.y, b.y)], [Math.max(a.x, b.x), Math.max(a.y, b.y)],
    ], { layers: [this.featuresId, fillId] });
    const ids = new Set<FeatureId>();
    for (const hit of hits) {
      if (typeof hit.id !== 'string') continue;
      const id: unknown = JSON.parse(hit.id);
      if ((typeof id === 'string' || typeof id === 'number') && !this.transfer?.ids.has(id)) ids.add(id);
    }
    return [...ids];
  }

  renderPreview(coordinates: Coordinate[], cursor: Coordinate | undefined, state: EditorState, snap: SnapResult | null = null, split: SplitPreview | null = null, rings: Coordinate[][] | null = null, inactiveParts: GeometryPart[] = [], reshape: ReshapePreview | null = null, trace: Coordinate[] | null = null, shared: SharedBoundaryPreview | null = null): void {
    if (state.mode !== 'idle') { this.translationVisible = false; this.translationPreview.clear(); }
    const editing = state.mode.startsWith('edit-');
    const polygon = state.mode === 'draw-polygon' || state.mode === 'edit-polygon' || state.mode === 'draw-hole';
    const handles = editing ? vertexHandles(this.map, coordinates, polygon)
      : coordinates.map((coordinate, index) => ({ kind: 'vertex' as const, index, coordinate }));
    const features: PreviewFeature[] = handles.map((handle) => ({
      type: 'Feature', properties: { kind: handle.kind, active: editing && handle.kind === 'vertex' && handle.index === state.selectedVertexIndex,
        locked: state.mode === 'edit-shared-boundary' && handle.kind === 'vertex' && (handle.index === 0 || handle.index === coordinates.length - 1) },
      geometry: { type: 'Point', coordinates: handle.coordinate },
    }));
    for (const geometry of inactiveParts) features.push({ type: 'Feature', properties: {}, geometry });
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
    if (polygon && first && coordinates.length >= 3) {
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
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData({ type: 'FeatureCollection', features });
  }

  clearPreview(): void {
    this.draftBorder.clear();
    this.translationVisible = false; this.translationPreview.clear();
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData(emptyCollection());
  }

  destroy(removeResources = true): void {
    this.draftBorder.clear();
    this.stopTransfer();
    if (!removeResources) return;
    for (const layer of [...this.layers].reverse()) {
      if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
    }
    for (const id of [this.draftId, this.featuresId]) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }
}
