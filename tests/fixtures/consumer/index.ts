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
  const transaction: editor.FeatureTransaction = { create: [], update: [], delete: [] };
  const committed: editor.TransactionEvent | null = tool.applyTransaction(transaction);
  tool.onTransaction((event: editor.TransactionEvent) => { const changes: editor.FeatureChange[] = event.changes; void changes; });
  void committed;
  const target: editor.TraceTarget = { featureId: 'boundary', partIndex: 0, ringIndex: 0 };
  const side: editor.TraceSide = 'shorter';
  tool.setTracing({ enabled: true, side });
  const tracing: editor.TracingOptions = tool.getTracing();
  const trace: editor.Coordinate[] | null = tool.getTracePreview();
  tool.draw('Polygon');
  const traced: boolean = tool.traceBoundary(target, [0, 0], [1, 1]);
  const corrected: boolean = tool.removeLastDrawStep();
  void [tracing, trace, traced, corrected];
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
  const sharedEditing: boolean = tool.editSharedBoundary();
  const sharedPreview: editor.SharedBoundaryPreview | null = tool.getSharedBoundaryPreview();
  const sharedError: editor.SharedBoundaryError | null = tool.getState().sharedBoundaryError;
  if (sharedEditing) {
    tool.insertVertex(1, [1, 1]); tool.moveVertex(1, [1.1, 1]); tool.removeVertex(1);
    const sharedTransaction: editor.TransactionEvent | null = tool.finishSharedBoundary();
    void sharedTransaction; tool.cancel();
  }
  void [sharedPreview, sharedError];
  const reshaping: boolean = tool.reshapeSelected();
  const reshapePreview: editor.ReshapePreview | null = tool.getReshapePreview();
  const reshapeError: editor.ReshapeError | null = tool.getState().reshapeError;
  const reshapeSide: editor.ReshapeSide | null = tool.getState().reshapeSide;
  if (reshaping) {
    tool.setReshapePath([[0, 0], [1, -1], [2, 0]]);
    tool.setReshapeSide('longer'); tool.removeReshapePoint();
    const reshaped: editor.TransactionEvent | null = tool.finishReshape();
    void reshaped; tool.cancel();
  }
  void [reshapePreview, reshapeError, reshapeSide];
  const splitting: boolean = tool.splitSelected();
  const splitPreview: editor.SplitPreview | null = tool.getSplitPreview();
  const splitError: editor.SplitError | null = tool.getState().splitError;
  if (splitting) {
    tool.setSplitLine([[0, 0], [1, 1]]);
    tool.removeSplitPoint();
    const split: editor.TransactionEvent | null = tool.finishSplit();
    void split;
    tool.cancel();
  }
  void [splitPreview, splitError];
  const merging: boolean = tool.unionSelection();
  const unionPreview: editor.UnionPreview | null = tool.getUnionPreview();
  const unionError: editor.UnionError | null = tool.getState().unionError;
  if (merging) {
    const merged: editor.TransactionEvent | null = tool.finishUnion();
    void merged;
    tool.cancel();
  }
  void [unionPreview, unionError];
  const subtracting: boolean = tool.differenceSelection();
  const differencePreview: editor.DifferencePreview | null = tool.getDifferencePreview();
  const differenceError: editor.DifferenceError | null = tool.getState().differenceError;
  if (subtracting) {
    const subtracted: editor.TransactionEvent | null = tool.finishDifference();
    void subtracted;
    tool.cancel();
  }
  void [differencePreview, differenceError];
  const intersecting: boolean = tool.intersectionSelection();
  const intersectionPreview: editor.IntersectionPreview | null = tool.getIntersectionPreview();
  const intersectionError: editor.IntersectionError | null = tool.getState().intersectionError;
  if (intersecting) {
    const intersected: editor.TransactionEvent | null = tool.finishIntersection();
    void intersected;
    tool.cancel();
  }
  void [intersectionPreview, intersectionError];
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
  tool.selectMany([]);
  tool.drawHole(); tool.cancel();
  tool.editSelected(1); tool.cancel();
  const holeDeleted: editor.TransactionEvent | null = tool.deleteHole(1);
  const ring: number | null = tool.getState().activeRingIndex;
  void holeDeleted; void ring;
  const multipart: editor.MultiPolygonFeature = { type: 'Feature', id: 'islands', properties: null,
    geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 0], [0, 2], [0, 0]]]] } };
  const paths: editor.MultiLineFeature = { type: 'Feature', id: 'paths', properties: {},
    geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } };
  const kind: editor.GeometryType = multipart.geometry.type;
  const drawKind: editor.DrawGeometryType = 'Polygon';
  tool.applyTransaction({ create: [multipart, paths] });
  tool.editSelected(1, 1); tool.cancel();
  tool.drawHole(1); tool.cancel(); tool.deleteHole(1, 1);
  const part: number | null = tool.getState().activePartIndex;
  const snapPart: number | undefined = tool.getSnap()?.partIndex;
  void [kind, drawKind, part, snapPart];
  // @ts-expect-error multipart construction is via import/transactions, not the drawing tool
  tool.draw('MultiPolygon');
  tool.cancel();
  const selection: editor.GeometryFeature[] = tool.getSelection();
  const selectedIds: editor.FeatureId[] = tool.getState().selectedFeatureIds;
  if (selection[0]) tool.toggleSelection(selection[0].id);
  const duplicated: editor.TransactionEvent | null = tool.duplicateSelection();
  tool.duplicateSelection([0.01, -0.01]);
  void duplicated;
  const constraints: editor.DrawingConstraintsOptions = tool.getDrawingConstraints();
  tool.setDrawingConstraints({ enabled: true, angleStep: 90 });
  tool.setDrawingConstraints({ enabled: constraints.enabled, angleStep: constraints.angleStep });
  const rotating: boolean = tool.rotateSelection([4.895, 52.372]);
  tool.setRotationAngle(30);
  const rotationPreview: editor.GeometryFeatureCollection | null = tool.getRotationPreview();
  const rotationError: editor.RotationError | null = tool.getState().rotationError;
  const rotationPivot: editor.Coordinate | null = tool.getState().rotationPivot;
  const rotationAngle: number | null = tool.getState().rotationAngle;
  const rotated: editor.TransactionEvent | null = tool.finishRotation();
  void [rotating, rotationPreview, rotationError, rotationPivot, rotationAngle, rotated];
  const scaling: boolean = tool.scaleSelection([4.895, 52.372]);
  tool.setScaleFactor(2);
  const scalePreview: editor.GeometryFeatureCollection | null = tool.getScalePreview();
  const scaleError: editor.ScaleError | null = tool.getState().scaleError;
  const scalePivot: editor.Coordinate | null = tool.getState().scalePivot;
  const scaleFactor: number | null = tool.getState().scaleFactor;
  const scaled: editor.TransactionEvent | null = tool.finishScale();
  void [scaling, scalePreview, scaleError, scalePivot, scaleFactor, scaled];
  const translated: editor.TransactionEvent | null = tool.translateSelection([0.01, -0.01]);
  void translated;
  const deletedSelection: editor.TransactionEvent | null = tool.deleteSelection();
  void [selectedIds, deletedSelection];
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
  const duplicated: editor.TransactionEvent | null = tool.duplicateSelection();
  tool.duplicateSelection([0.01, -0.01]);
  void duplicated;
  const translated: editor.TransactionEvent | null = tool.translateSelection([0.01, -0.01]);
  void translated;
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
