import type { GeometryPart } from '../core/geometry.js';
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { samePosition } from '../core/polygon.js';
import type { Coordinate, SplitPreview, SnapResult, FeatureId, EditorState, GeometryFeatureCollection } from '../core/types.js';
import { vertexHandles } from './vertex-handles.js';

const emptyCollection = () => ({ type: 'FeatureCollection' as const, features: [] });
// String UUIDs need promoteId to survive MapLibre's numeric vector-tile IDs.
// This property exists only in render data; the core/export never receives it.
const renderIdProperty = '__geo_editor_id';
type PreviewFeature = {
  type: 'Feature'; properties: { kind?: 'vertex' | 'midpoint' | 'snap' | 'split-part'; part?: number; active?: boolean; snapKind?: 'vertex' | 'edge' };
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

  constructor(private readonly map: MapLibreMap, namespace: string) {
    this.featuresId = `${namespace}-features`;
    this.draftId = `${namespace}-draft`;
    const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
    const color: ExpressionSpecification = ['case', selected, '#2563eb', '#116b5b'];
    const editing: ExpressionSpecification = ['boolean', ['feature-state', 'editing'], false];
    this.layers = [
      { id: `${namespace}-fill`, type: 'fill', source: this.featuresId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': color, 'fill-opacity': ['case', editing, 0, selected, 0.3, 0.18] } },
      { id: this.featuresId, type: 'line', source: this.featuresId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': ['case', selected, 6, 4], 'line-opacity': ['case', editing, 0, 1] } },
      { id: `${namespace}-draft-fill`, type: 'fill', source: this.draftId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['case', ['==', ['get', 'part'], 1], '#7c3aed', '#df772e'], 'fill-opacity': 0.22 } },
      { id: this.draftId, type: 'line', source: this.draftId,
        filter: ['in', '$type', 'LineString', 'Polygon'],
        paint: { 'line-color': '#df772e', 'line-width': 3, 'line-dasharray': [2, 1.5] } },
      { id: `${namespace}-midpoints`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'midpoint'],
        paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#df772e', 'circle-stroke-width': 1 } },
      { id: `${namespace}-vertices`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'vertex'],
        paint: { 'circle-radius': ['case', ['boolean', ['get', 'active'], false], 7, 5],
          'circle-color': ['case', ['boolean', ['get', 'active'], false], '#df772e', '#fff'],
          'circle-stroke-color': '#df772e', 'circle-stroke-width': 2 } },
      { id: `${namespace}-snap`, type: 'circle', source: this.draftId,
        filter: ['==', 'kind', 'snap'],
        paint: { 'circle-radius': ['case', ['==', ['get', 'snapKind'], 'vertex'], 8, 6],
          'circle-color': '#7c3aed', 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } },
    ];
  }

  mount(): void {
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
    // Encode the ID type: MapLibre feature-state otherwise conflates 7 and "7".
    // MapLibre reports worker failures through the map's error event.
    void this.map.getSource<GeoJSONSource>(this.featuresId)?.setData({
      type: 'FeatureCollection', features: collection.features.map((feature) => ({
        ...feature, properties: { ...feature.properties, [renderIdProperty]: JSON.stringify(feature.id) },
      })),
    });
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
    const next = new Set(ids);
    if (this.map.getSource(this.featuresId)) {
      for (const id of this.editingFeatureIds) {
        if (!next.has(id)) this.map.removeFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, 'editing');
      }
      for (const id of next) {
        if (force || !this.editingFeatureIds.has(id)) this.map.setFeatureState({ source: this.featuresId, id: JSON.stringify(id) }, { editing: true });
      }
    }
    this.editingFeatureIds = next;
  }

  /** Only the moving group is uploaded per frame; committed data stays untouched. */
  renderTranslation(features: GeometryFeatureCollection['features']): void {
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData({ type: 'FeatureCollection',
      features: features.map((feature) => ({ type: 'Feature', properties: {}, geometry: feature.geometry })),
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
      if (typeof id === 'string' || typeof id === 'number') ids.add(id);
    }
    return [...ids];
  }

  renderPreview(coordinates: Coordinate[], cursor: Coordinate | undefined, state: EditorState, snap: SnapResult | null = null, split: SplitPreview | null = null, rings: Coordinate[][] | null = null, inactiveParts: GeometryPart[] = []): void {
    const editing = state.mode.startsWith('edit-');
    const polygon = state.mode === 'draw-polygon' || state.mode === 'edit-polygon' || state.mode === 'draw-hole';
    const handles = editing ? vertexHandles(this.map, coordinates, polygon)
      : coordinates.map((coordinate, index) => ({ kind: 'vertex' as const, index, coordinate }));
    const features: PreviewFeature[] = handles.map((handle) => ({
      type: 'Feature', properties: { kind: handle.kind, active: editing && handle.kind === 'vertex' && handle.index === state.selectedVertexIndex },
      geometry: { type: 'Point', coordinates: handle.coordinate },
    }));
    for (const geometry of inactiveParts) features.push({ type: 'Feature', properties: {}, geometry });
    if (snap) features.push({ type: 'Feature', properties: { kind: 'snap', snapKind: snap.kind },
      geometry: { type: 'Point', coordinates: [...snap.coordinate] } });
    if (split) {
      for (const [part, geometry] of [split.retained, split.created].entries()) {
        features.push({ type: 'Feature', properties: { kind: 'split-part', part }, geometry });
      }
    }
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
    } else if (coordinates.length >= 2) {
      features.push({ type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates } });
    }
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData({ type: 'FeatureCollection', features });
  }

  clearPreview(): void {
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData(emptyCollection());
  }

  destroy(): void {
    for (const layer of [...this.layers].reverse()) {
      if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
    }
    for (const id of [this.draftId, this.featuresId]) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }
}
