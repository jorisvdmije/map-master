import * as editor from '@geo/editor';
import type { Map } from 'maplibre-gl';

// A strict consumer must resolve the shipped declarations, with no source alias.
const publicApi: typeof import('@geo/editor') = editor;
void publicApi;

export function integrateGeometry(map: Map): editor.GeometryFeatureCollection {
  const options: editor.EditorOptions = { historyLimit: 50, snapping: { enabled: true, distance: 18 } };
  const tool = new editor.GeometryEditor(map, options);
  const batch: editor.GeometryFeatureCollection = tool.importGeoJSON({ type: 'FeatureCollection', features: [] });
  tool.onImport((collection) => { const count: number = collection.features.length; void count; });
  const properties: editor.FeatureProperties = { nested: { list: [1, true, null] } };
  const importError = new editor.GeoJSONImportError('duplicate-id', '$.id', 'Duplicate');
  const code: editor.ImportErrorCode = importError.code;
  void [batch, properties, code];
  tool.setSnapping({ vertices: true, edges: true });
  const snapping: editor.SnappingOptions = tool.getSnapping();
  const snap: editor.SnapResult | null = tool.getSnap();
  tool.onSnap((result) => { const id: editor.FeatureId | null | undefined = result?.featureId; void id; });
  void [snapping, snap];
  tool.draw('Polygon');
  tool.onCreate((feature) => {
    if (feature.geometry.type === 'Polygon') {
      const rings: editor.Coordinate[][] = feature.geometry.coordinates;
      void rings;
    }
  });
  tool.onChange((state) => {
    const error: editor.ValidationError | null = state.validationError;
    const selectedId: editor.FeatureId | null = state.selectedFeatureId;
    void [error, selectedId];
  });
  // @ts-expect-error unsupported geometry must be rejected by the public types
  tool.draw('Circle');
  tool.cancel();
  tool.select(null);
  const selected: editor.GeometryFeature | null = tool.getSelected();
  void selected;
  tool.editSelected();
  const draft: editor.Coordinate[] = tool.getDraft();
  tool.selectVertex(0);
  tool.moveVertex(0, [4.9, 52.3]);
  tool.insertVertex(1, [4.91, 52.31]);
  const removedVertex: boolean = tool.removeVertex(1);
  tool.onUpdate((feature) => { const id: editor.FeatureId = feature.id; void id; });
  tool.cancel();
  void [draft, removedVertex];
  const unsubscribe = tool.onDelete((feature) => {
    const id: editor.FeatureId = feature.id;
    if (feature.geometry.type === 'Polygon') {
      const rings: editor.Coordinate[][] = feature.geometry.coordinates;
      void rings;
    }
    void id;
  });
  const deleted: editor.GeometryFeature | null = tool.deleteSelected();
  void deleted;
  unsubscribe();
  const undone: boolean = tool.undo();
  const redone: boolean = tool.redo();
  const canUndo: boolean = tool.getState().canUndo;
  tool.onHistory((event: editor.HistoryEvent) => {
    const action: editor.HistoryAction = event.action;
    const changes: editor.FeatureChange[] = event.changes;
    void [action, changes];
  });
  tool.clearHistory();
  void [undone, redone, canUndo];
  const result = tool.exportGeoJSON();
  tool.destroy();
  return result;
}

// Compile the real public API against a host-supplied MapLibre map.
export function integrate(map: Map): editor.LineCollection {
  const tool = new editor.LineEditor(map);
  tool.startLine();
  const selected: editor.LineFeature | null = tool.getSelected();
  void selected;
  tool.onCreate((feature) => {
    const id: editor.FeatureId = feature.id;
    const type: 'LineString' = feature.geometry.type;
    void [id, type];
  });
  tool.cancel();
  tool.onDelete((feature) => {
    const type: 'LineString' = feature.geometry.type;
    void type;
  });
  const deleted: editor.LineFeature | null = tool.deleteSelected();
  void deleted;
  const undone: boolean = tool.undo();
  const redone: boolean = tool.redo();
  const canUndo: boolean = tool.getState().canUndo;
  tool.onHistory((event: editor.HistoryEvent) => {
    const action: editor.HistoryAction = event.action;
    const changes: editor.FeatureChange[] = event.changes;
    void [action, changes];
  });
  tool.clearHistory();
  void [undone, redone, canUndo];
  const result = tool.exportGeoJSON();
  tool.destroy();
  return result;
}
