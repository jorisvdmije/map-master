import * as editor from '@jorisvdmije/map-master';
import type { Map } from 'maplibre-gl';

// A strict consumer must resolve the shipped declarations, with no source alias.
const publicApi: typeof import('@jorisvdmije/map-master') = editor;
void publicApi;

export function integrateGeometry(map: Map): editor.GeometryFeatureCollection {
  const marker: editor.PointFeature = { type: 'Feature', id: 'marker', properties: {}, geometry: { type: 'Point', coordinates: [4, 52] } };
  void marker;
  const textStyle: editor.TextMarkerStyle = { color: '#123456', backgroundColor: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'left' };
  const label: editor.TextMarkerFeature = { ...marker, properties: { mapMasterText: { text: 'Meeting point', style: textStyle } } };
  const isLabel: boolean = editor.isTextMarker(label); void isLabel;
  const appearance: editor.EditorAppearanceOptions = { feature: { lineColor: '#175c4c' }, vertex: { radius: 6 } };
  const options: editor.EditorOptions = { historyLimit: 50, lockedFeatureIds: ['reference', 0], snapping: { enabled: true, distance: 18 }, alignmentGuides: { enabled: true }, appearance };
  const tool = new editor.GeometryEditor(map, options);
  const guideSettings: editor.AlignmentGuidesOptions = { enabled: true, distance: 8, horizontal: true, vertical: true, extensions: true, maxCandidates: 96 };
  tool.setAlignmentGuides(guideSettings); tool.setAlignmentGuides(tool.getAlignmentGuides());
  const dataLayer: editor.DataLayerDefinition = { id: 'parcels', name: 'Parcels', style: { shape: { fillColor: '#008800' } } };
  const layerOptions: editor.DataLayerOptions = { layers: [dataLayer], activeLayerId: 'parcels', selectionScope: 'all' };
  void layerOptions;
  tool.addDataLayer(dataLayer); tool.updateDataLayer('parcels', { snapping: false });
  const layerDefinitions: editor.DataLayer[] = tool.getDataLayers(); tool.setDataLayers(layerDefinitions);
  tool.reorderDataLayers(layerDefinitions.map(layer => layer.id)); tool.setActiveDataLayer('parcels'); tool.setDataLayerSelectionScope('active');
  const layerMembership: string | null = tool.getFeatureDataLayer('parcel');
  const layerIssue: editor.DataLayerIssue | undefined = tool.getHistoryDataLayerIssues('undo')[0];
  const layerIssueCode: editor.DataLayerIssueCode | undefined = layerIssue?.code;
  const importLayer: editor.DataLayerImportOptions = { dataLayerId: 'parcels' };
  const exportLayer: editor.DataLayerExportOptions = { dataLayerId: 'parcels', visibleOnly: true };
  const layerData = tool.exportGeoJSON(exportLayer); tool.importGeoJSON(layerData, importLayer);
  const layerMove: editor.TransactionEvent | null = tool.moveFeaturesToDataLayer(['parcel'], 'parcels');
  const controlOptions: editor.DataLayerControlOptions = { collapsed: false, labels: { title: 'Layers' } };
  const layerControl = new editor.DataLayerControl(tool, controlOptions); layerControl.setCollapsed(true);
  const layerError = new editor.DataLayerError([]); const scope: editor.DataLayerSelectionScope = 'all';
  void [layerMembership, layerIssueCode, layerMove, layerControl.isCollapsed(), layerError, scope, tool.canSelectFeature('parcel'), tool.canDrawInDataLayer(), editor.defaultDataLayerId, editor.featureDataLayerId(marker)];
  tool.removeDataLayer('parcels');
  const fence: editor.GeofenceArea = { id: 'park', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } };
  const fencing: editor.GeofencingOptions = { enabled: true, allowed: [fence], excluded: [], allowedMatch: 'contains', excludedMatch: 'intersects' };
  tool.setGeofencing(fencing);
  const fencePolicy: editor.GeofencingOptions = tool.getGeofencing();
  const violations: editor.GeofencingViolation[] = tool.checkGeofencing(tool.exportGeoJSON().features);
  const violationCode: editor.GeofencingViolationCode | undefined = violations[0]?.code;
  const historyViolations: editor.GeofencingViolation[] = tool.getHistoryGeofencingViolations('undo');
  const fenceFailure = new editor.GeofencingError(violations); void [fencePolicy, violationCode, historyViolations, fenceFailure];
  const fenceToolbar: editor.ToolbarOptions = { tools: ['geofencing'] }; void fenceToolbar;
  tool.setGeofencing({ enabled: false });
  const addresses: editor.VertexAddress[] = [{ featureId: 'west', index: 1 }, { featureId: 'east', partIndex: 0, ringIndex: 0, index: 0 }];
  const pinOptions: editor.PinVerticesOptions = { tolerance: 0 };
  const pinEvent: editor.TransactionEvent | null = tool.pinVertices(addresses, pinOptions);
  const pinGroups: editor.PinnedVertexGroup[] = tool.getPinnedVertices();
  const pinMetadata: editor.VertexPin | undefined = pinGroups[0];
  const pinPreview: editor.GeometryFeatureCollection | null = tool.getPinnedPreview();
  const pinError: editor.PinningErrorCode | null = tool.getState().pinningError;
  void [pinEvent, pinMetadata, pinPreview, pinError, tool.canPinSharedVertices(), tool.canUnpinSelection()];
  tool.pinSharedVertices(); tool.unpinVertices(addresses); tool.unpinSelection();
  const pinFailure = new editor.VertexPinError('pin-conflict', 'Move all linked vertices together.'); void pinFailure;
  const pinToolbar: editor.ToolbarOptions = { tools: ['pin', 'unpin'] }; void pinToolbar;
  const alignment: editor.AlignmentResult | null = tool.getAlignment();
  const guide: editor.AlignmentGuide | undefined = alignment?.guides[0]; void guide;
  const guideToolbar: editor.ToolbarOptions = { tools: ['guides'] }; void guideToolbar;
  tool.setKeyboardShortcuts({ guides: [{ key: 'g' }] });
  // @ts-expect-error tolerances are numbers
  tool.setAlignmentGuides({ distance: '8' });
  tool.drawText({ text: 'Meeting point', style: textStyle });
  const draftText: editor.TextMarkerOptions | null = tool.getTextMarkerDraft(); void draftText;
  tool.setTextMarker({ text: 'Entrance', style: { fontWeight: 'normal' } }); tool.cancel();
  // @ts-expect-error font weights are explicit
  tool.setTextMarker({ style: { fontWeight: 'heavy' } });
  const templateFeature: editor.ShapeTemplateFeature = { type: 'Feature', properties: { name: 'Custom line' }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] } };
  const definition: editor.ShapeTemplate = { id: 'custom', label: 'Custom', data: templateFeature };
  const definitions: editor.ShapeTemplate[] = editor.defaultShapeTemplates();
  tool.setShapeTemplates([...definitions, definition]);
  const templatePlacement: editor.TemplatePlacement = { position: [4, 52], size: 250, rotation: 30 };
  tool.drawTemplate('custom', templatePlacement);
  const templateDraft: editor.TemplateDraft | null = tool.getTemplateDraft();
  const templatePreview: editor.GeometryFeatureCollection | null = tool.getTemplatePreview();
  const templateError: editor.TemplatePlacementError | null = tool.getState().templateError;
  tool.setTemplatePlacement({ templateId: 'arrow', size: 300 });
  const placed: editor.TransactionEvent | null = tool.finishTemplate(); void [templateDraft, templatePreview, templateError, placed];
  const templateToolbar: editor.ToolbarOptions = { tools: ['template'], templatePicker: templates => templates[0]?.id ?? null };
  void templateToolbar;
  // @ts-expect-error rotation is a number
  tool.setTemplatePlacement({ rotation: 'left' });
  const modifier: editor.ShortcutModifier = 'Mod';
  const binding: editor.KeyBinding = { key: 'p', modifiers: [modifier] };
  const shortcuts: editor.KeyboardShortcuts = { polygon: [binding], delete: false };
  tool.setKeyboardShortcuts(shortcuts);
  const resolved: editor.ResolvedKeyboardShortcuts = tool.getKeyboardShortcuts();
  const keyboardAction: editor.KeyboardAction = 'polygon';
  const shortcutLabel: string = tool.getKeyboardShortcutLabel(keyboardAction);
  const shortcutAria: string = tool.getKeyboardShortcutAria(keyboardAction);
  tool.setKeyboardShortcuts(false); tool.setKeyboardShortcuts(resolved);
  void [shortcutLabel, shortcutAria];
  // @ts-expect-error command names are typed
  tool.setKeyboardShortcuts({ unknown: [{ key: 'x' }] });
  // @ts-expect-error modifiers are typed
  tool.setKeyboardShortcuts({ polygon: [{ key: 'p', modifiers: ['Super'] }] });
  const styling: editor.EditorStylingOptions = {
    feature: feature => ({ shape: { fillColor: feature.properties?.category === 'park' ? '#0a0' : '#a00' }, sortKey: 2 }),
    selected: { shape: { lineWidth: 8 } },
    overlap: { enabled: true, palette: members => members.map(member => member.color), stripeWidth: 12 },
  };
  tool.setStyling(styling); tool.refreshStyling(); tool.setStyling(tool.getStyling());
  const issues: editor.StylingIssue[] = tool.getStylingIssues(); void issues;
  // @ts-expect-error stripe directions are explicit
  tool.setStyling({ overlap: { direction: 'vertical' } });
  const currentAppearance: editor.EditorAppearance = tool.getAppearance();
  tool.setAppearance({ draft: { lineColor: '#f80' }, selected: { fillOpacity: 0.4 } });
  tool.setAppearance(currentAppearance);
  const shapeStyle: editor.ShapeAppearance = currentAppearance.feature;
  const pointStyle: editor.PointAppearance = currentAppearance.midpoint;
  const vertexStyle: editor.VertexAppearance = currentAppearance.vertex;
  const snapStyle: editor.SnapAppearance = currentAppearance.snap;
  const draftStyle: editor.DraftAppearance = currentAppearance.draft;
  void [shapeStyle, pointStyle, vertexStyle, snapStyle, draftStyle];
  // @ts-expect-error appearance fields must be known
  tool.setAppearance({ feature: { stroke: 'red' } });
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
  tool.setLockedFeatureIds(['reference', 0]);
  const locks: editor.FeatureId[] = tool.getLockedFeatureIds();
  const locked: boolean = tool.isFeatureLocked('reference');
  const lockError = new editor.FeatureLockedError('reference');
  void [locks, locked, lockError.featureId];
  tool.setLockedFeatureIds([]);
  // @ts-expect-error IDs cannot be booleans
  tool.setLockedFeatureIds([false]);
  const transaction: editor.FeatureTransaction = { create: [], update: [], delete: [] };
  const committed: editor.TransactionEvent | null = tool.applyTransaction(transaction);
  tool.onTransaction((event: editor.TransactionEvent) => { const changes: editor.FeatureChange[] = event.changes; void changes; });
  tool.onDataChange((event: editor.DataChangeEvent) => {
    const source: editor.DataChangeSource = event.source;
    const revision: number = event.dataRevision;
    void [source, revision, event.changes];
  });
  const stored: editor.GeometryFeature | null = tool.getFeature('reference');
  const mode: editor.EditorMode = tool.getState().mode;
  const lassoOptions: editor.LassoOptions = { operation: 'add', match: 'contains' };
  const lassoStarted: boolean = tool.lasso(lassoOptions);
  const activeLasso: editor.LassoOptions | null = tool.getLassoOptions();
  tool.setLassoOptions({ operation: 'subtract' });
  const lassoHits: editor.FeatureId[] = tool.selectByLasso([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]);
  tool.cancel(); void [lassoStarted, activeLasso, lassoHits];
  void [stored, mode];
  const tools: editor.ToolbarTool[] = ['polygon', 'edit', 'buffer', 'undo'];
  const labels: Partial<editor.ToolbarLabels> = { polygon: 'Vlak tekenen', finish: 'Klaar' };
  const toolbarOptions: editor.ToolbarOptions = { tools, labels };
  const toolbar = new editor.EditorToolbar(tool, toolbarOptions);
  map.addControl(toolbar, 'top-left'); map.removeControl(toolbar);
  const allTools: readonly editor.ToolbarTool[] = editor.EditorToolbar.allTools;
  const labelKey: editor.ToolbarLabelKey = 'removeLastPoint';
  void [allTools, labelKey, editor.EditorToolbar.defaultTools];
  // @ts-expect-error tools are a closed set
  void new editor.EditorToolbar(tool, { tools: ['hexagon'] });
  void committed;
  const target: editor.TraceTarget = { featureId: 'boundary', partIndex: 0, ringIndex: 0 };
  const side: editor.TraceSide = 'shorter';
  tool.setTracing({ enabled: true, side });
  const tracing: editor.TracingOptions = tool.getTracing();
  const trace: editor.Coordinate[] | null = tool.getTracePreview();
  tool.draw('Point'); tool.cancel();
  tool.setAppearance({ marker: { radius: 9 }, selectedMarker: { color: '#00f' }, draftMarker: { opacity: 0.7 } });
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
  tool.draw('Hexagon');
  const shape: editor.DrawShape = 'Circle';
  tool.draw(shape); tool.cancel();
  tool.setMeasurements({ enabled: true, units: 'imperial', locale: 'nl' });
  const measurement: editor.Measurement = editor.measure({ type: 'LineString', coordinates: [[0, 0], [0, 1]] });
  const measurementOptions: editor.MeasurementOptions = tool.getMeasurements();
  const units: editor.MeasurementUnits = measurementOptions.units;
  void [measurement, units, editor.formatDistance(measurement.length), editor.formatArea(measurement.area, 'imperial', 'nl')];
  const button: editor.ToolbarButton = { id: 'save', label: 'Save', onClick: (current) => { void current.exportGeoJSON(); } };
  void new editor.EditorToolbar(tool, { buttons: [button], collapsible: true });
  void [tool.drawCut(), tool.finishCut(), tool.drawPart(), tool.explodeSelection(), tool.combineSelection(), tool.zoomToFeatures(['a'], { padding: 10 })];
  tool.cancel();
  tool.select(null);
  const hits: editor.GeometryFeature[] = tool.queryFeatures({ x: 100, y: 100 });
  void hits;
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
  const feedback: editor.CutFeedback | null = tool.getCutFeedback();
  void feedback;
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
  tool.selectVertices([0, 1]);
  const indices: number[] = tool.getState().selectedVertexIndices;
  const moves: editor.VertexUpdate[] = [{ index: 0, coordinate: [4.9, 52.3] }, { index: 1, coordinate: [4.91, 52.3] }];
  tool.moveVertices(moves); tool.translateSelectedVertices([0.001, 0]);
  const removedGroup: boolean = tool.removeSelectedVertices();
  void [indices, removedGroup];
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
  const removing: boolean = tool.removeHole();
  const chosenHole: boolean = tool.setHoleToRemove(1, 0);
  const removalPreview: editor.GeometryFeature | null = tool.getHoleRemovalPreview();
  const removalEvent: editor.TransactionEvent | null = tool.finishHoleRemoval();
  void removing; void chosenHole; void removalPreview; void removalEvent;
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
  const offsetting: boolean = tool.offsetSelection();
  tool.setOffsetDistance(5);
  const offsetResultPreview: editor.GeometryFeatureCollection | null = tool.getOffsetPreview();
  const offsetResultError: editor.OffsetError | null = tool.getState().offsetError;
  const offsetDistance: number | null = tool.getState().offsetDistance;
  const offsetResult: editor.TransactionEvent | null = tool.finishOffset();
  void [offsetting, offsetResultPreview, offsetResultError, offsetDistance, offsetResult];
  const buffering: boolean = tool.bufferSelection();
  tool.setBufferDistance(5);
  const bufferedPreview: editor.GeometryFeatureCollection | null = tool.getBufferPreview();
  const bufferedError: editor.BufferError | null = tool.getState().bufferError;
  const distance: number | null = tool.getState().bufferDistance;
  const buffered: editor.TransactionEvent | null = tool.finishBuffer();
  void [buffering, bufferedPreview, bufferedError, distance, buffered];
  const simplifying: boolean = tool.simplifySelection();
  tool.setSimplificationTolerance(5);
  const simplifiedPreview: editor.GeometryFeatureCollection | null = tool.getSimplificationPreview();
  const simplifiedError: editor.SimplificationError | null = tool.getState().simplificationError;
  const tolerance: number | null = tool.getState().simplificationTolerance;
  const simplified: editor.TransactionEvent | null = tool.finishSimplification();
  void [simplifying, simplifiedPreview, simplifiedError, tolerance, simplified];
  const rotating: boolean = tool.rotateSelection([4.895, 52.372]);
  tool.setRotationAngle(30);
  tool.setRotationPivot([4.9, 52.37]);
  tool.setRotationPivot();
  const rotationPreview: editor.GeometryFeatureCollection | null = tool.getRotationPreview();
  const rotationError: editor.RotationError | null = tool.getState().rotationError;
  const rotationPivot: editor.Coordinate | null = tool.getState().rotationPivot;
  const rotationAngle: number | null = tool.getState().rotationAngle;
  const rotated: editor.TransactionEvent | null = tool.finishRotation();
  void [rotating, rotationPreview, rotationError, rotationPivot, rotationAngle, rotated];
  const scaling: boolean = tool.scaleSelection([4.895, 52.372]);
  tool.setScaleFactor(2);
  tool.setScaleFactors(2, 0.5);
  tool.setScalePivot([4.9, 52.37]);
  tool.setScalePivot();
  const horizontalScale: number | null = tool.getState().scaleFactorX;
  const verticalScale: number | null = tool.getState().scaleFactorY;
  void [horizontalScale, verticalScale];
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
