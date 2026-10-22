import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { samePosition } from '../core/polygon.js';
import type { Coordinate, EditorState, GeometryFeatureCollection } from '../core/types.js';

const emptyCollection = () => ({ type: 'FeatureCollection' as const, features: [] });
// String UUIDs need promoteId to survive MapLibre's numeric vector-tile IDs.
// This property exists only in render data; the core/export never receives it.
const renderIdProperty = '__geo_editor_id';
type PreviewFeature = {
  type: 'Feature'; properties: Record<string, never>;
  geometry: { type: 'Point'; coordinates: Coordinate }
    | { type: 'LineString'; coordinates: Coordinate[] }
    | { type: 'Polygon'; coordinates: Coordinate[][] };
};

/** Owns map resources and visualization, never the authoritative feature data. */
export class MapLibreRenderer {
  private readonly featuresId: string;
  private readonly draftId: string;
  private readonly layers: LayerSpecification[];
  private selectedFeatureId: string | null = null;

  constructor(private readonly map: MapLibreMap, namespace: string) {
    this.featuresId = `${namespace}-features`;
    this.draftId = `${namespace}-draft`;
    const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
    const color: ExpressionSpecification = ['case', selected, '#2563eb', '#116b5b'];
    this.layers = [
      { id: `${namespace}-fill`, type: 'fill', source: this.featuresId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': color, 'fill-opacity': ['case', selected, 0.3, 0.18] } },
      { id: this.featuresId, type: 'line', source: this.featuresId,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': ['case', selected, 6, 4] } },
      { id: `${namespace}-draft-fill`, type: 'fill', source: this.draftId,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': '#df772e', 'fill-opacity': 0.12 } },
      { id: this.draftId, type: 'line', source: this.draftId,
        filter: ['in', '$type', 'LineString', 'Polygon'],
        paint: { 'line-color': '#df772e', 'line-width': 3, 'line-dasharray': [2, 1.5] } },
      { id: `${namespace}-vertices`, type: 'circle', source: this.draftId,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#fff',
          'circle-stroke-color': '#df772e', 'circle-stroke-width': 2 } },
    ];
  }

  mount(): void {
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
    // MapLibre reports worker failures through the map's error event.
    void this.map.getSource<GeoJSONSource>(this.featuresId)?.setData({
      type: 'FeatureCollection', features: collection.features.map((feature) => ({
        ...feature, properties: { ...feature.properties, [renderIdProperty]: feature.id },
      })),
    });
  }

  /** Update only presentation state, without copying or re-uploading geometry. */
  renderSelection(id: string | null): void {
    if (this.map.getSource(this.featuresId)) {
      if (this.selectedFeatureId !== null) {
        this.map.removeFeatureState({ source: this.featuresId, id: this.selectedFeatureId }, 'selected');
      }
      if (id !== null) this.map.setFeatureState({ source: this.featuresId, id }, { selected: true });
    }
    this.selectedFeatureId = id;
  }

  /** Prefer outlines near the pointer, then polygon interiors, in rendered order. */
  pick({ x, y }: { x: number; y: number }): string | null {
    const fillId = this.layers[0]!.id;
    if (!this.map.getLayer(this.featuresId) || !this.map.getLayer(fillId)) return null;
    const outlines = this.map.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], {
      layers: [this.featuresId],
    });
    const hit = outlines[0] ?? this.map.queryRenderedFeatures([x, y], { layers: [fillId] })[0];
    return typeof hit?.id === 'string' ? hit.id : null;
  }

  renderPreview(coordinates: Coordinate[], cursor: Coordinate | undefined, state: EditorState): void {
    const features: PreviewFeature[] = coordinates.map((position) => ({
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: position },
    }));
    const last = coordinates.at(-1);
    if (last && cursor && !samePosition(last, cursor)) coordinates.push(cursor);
    const first = coordinates[0];
    if (state.mode === 'draw-polygon' && first && coordinates.length >= 3) {
      if (!samePosition(first, coordinates.at(-1)!)) coordinates.push([...first]);
      features.push({ type: 'Feature', properties: {},
        geometry: { type: 'Polygon', coordinates: [coordinates] } });
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
