import { defaultShapeTemplates, prepareShapeTemplates, placeTemplate, templatePlacement, type ShapeTemplate, type PreparedTemplate, type TemplateDraft, type TemplatePlacement } from './shape-templates.js';
import { isTextMarker, textMarkerOptions, type TextMarkerOptions } from './text-marker.js';
import { lassoOptions } from './lasso.js';
import { assignDataLayer, DataLayerError, DataLayerStore, defaultDataLayerId, featureDataLayerId, type DataLayer, type DataLayerDefinition, type DataLayerOptions, type DataLayerSelectionScope, type DataLayerIssue, type DataLayerExportOptions, type DataLayerImportOptions } from './data-layers.js';
import { GeofencingPolicy, GeofencingError, copyViolations, type GeofencingOptions, type GeofencingViolation, type GeofencingCandidate } from './geofencing.js';
import { featureVertices, moveVertexPins, readVertexPins, withVertexPins, VertexPinError, VertexPinIndex, type VertexAddress, type PinVerticesOptions, type PinnedVertexGroup, type PinningErrorCode } from './vertex-pins.js';
import { copyCutFeedback, emptyCutFeedback } from './cut-feedback.js';
import { FeatureLockedError, lockedFeatureIds, sameLocks } from './feature-locks.js';
import { canOffsetFeatures, offsetFeatures, validateOffsetDistance } from './offset.js';
import { bufferFeatures, validateBufferDistance } from './buffer.js';
import { simplifyFeatures, validateSimplificationTolerance } from './simplification.js';
import { scaleFeatures, validateScaleFactor } from './scaling.js';
import { transformPivot, validateTransformPivot } from './mercator-transform.js';
import { normalizeRotationAngle, rotateFeatures, rotationPivot, validateRotationPivot } from './rotation.js';
import { prepareSharedBoundary, updateSharedBoundary, type SharedBoundary } from './shared-boundary.js';
import { traceBoundary, traceSource } from './trace-boundary.js';
import { geometryParts, mapGeometry, replacePart, withGeometry, type Geometry, type GeometryPart } from './geometry.js';
import { reshapePolygon } from './reshape-polygon.js';
import { splitPolygonRings } from './split-polygon.js';
import { intersectionPolygons } from './intersection.js';
import { differencePolygons } from './difference.js';
import { unionPolygons } from './union.js';
import { cutGeometry } from './cut.js';
import { circleRing, ellipseRing, freehandRing, rectangleRing, type DrawShape } from './shapes.js';
import { translateFeatures } from './translation.js';
import { prepareTransaction } from './transaction.js';
import { EditHistory, type HistoryEntry } from './history.js';
import { GeoJSONImportError, copyProperties, prepareImport } from './geojson-import.js';
import { closePolygon, openRing, samePosition, validatePolygonRings, validateMultiPolygon } from './polygon.js';
import type {
  Coordinate, CutFeedback, VertexUpdate, LassoOptions, OffsetError, BufferError, SimplificationError, ScaleError, RotationError, SharedBoundaryPreview, SharedBoundaryError, TraceTarget, TraceSide, ReshapePreview, ReshapeError, ReshapeSide, IntersectionPreview, IntersectionError, DifferencePreview, DifferenceError, UnionPreview, UnionError, SplitPreview, SplitError, FeatureTransaction, TransactionEvent, FeatureChange, HistoryAction, FeatureId, EditorState, HistoryEvent, GeometryFeatureCollection, GeometryFeature, DrawGeometryType, ValidationError,
} from './types.js';

function copyFeature(feature: GeometryFeature): GeometryFeature {
  return withGeometry({ id: feature.id, properties: copyProperties(feature.properties) },
    mapGeometry(feature.geometry, ([lng, lat]) => [lng, lat]));
}

/** Match attachments after repeated projection, without a geographic snapping tolerance. */
function sameTraceAttachment(a: Coordinate, b: Coordinate): boolean {
  const tolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(a[0]), Math.abs(a[1]));
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
}

// A boolean check preserves typed readonly arrays instead of narrowing them to any[].
function isArray(value: unknown): boolean { return Array.isArray(value); }

const drawModes = { Point: 'draw-point', LineString: 'draw-line', Polygon: 'draw-polygon' } as const;
const shapeModes = { Rectangle: 'draw-rectangle', Circle: 'draw-circle', Ellipse: 'draw-ellipse', Freehand: 'draw-freehand' } as const;
const isPolygonal = (geometry: Geometry): boolean => geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
const isLineal = (geometry: Geometry): boolean => geometry.type === 'LineString' || geometry.type === 'MultiLineString';

/** Internal editing state. No browser, map, or rendering dependencies. */
export class DrawingSession {
  private offsetting: { originals: GeometryFeature[]; distance: number; preview: GeometryFeature[] | null; error: OffsetError | null } | null = null;
  private buffering: { originals: GeometryFeature[]; distance: number; preview: GeometryFeature[] | null; error: BufferError | null } | null = null;
  private simplification: { originals: GeometryFeature[]; tolerance: number; preview: GeometryFeature[] | null; error: SimplificationError | null } | null = null;
  private scaling: { originals: GeometryFeature[]; pivot: Coordinate; factorX: number; factorY: number; preview: GeometryFeature[] | null; error: ScaleError | null } | null = null;
  private rotation: { originals: GeometryFeature[]; pivot: Coordinate; angle: number; preview: GeometryFeature[] | null; error: RotationError | null } | null = null;
  private sharedBoundary: SharedBoundary | null = null;
  private sharedBoundaryPreview: SharedBoundaryPreview | null = null;
  private sharedBoundaryError: SharedBoundaryError | null = null;
  private intersectionActive = false;
  private intersectionPreview: IntersectionPreview | null = null;
  private intersectionError: IntersectionError | null = null;
  private differenceActive = false;
  private differencePreview: DifferencePreview | null = null;
  private differenceError: DifferenceError | null = null;
  private unionActive = false;
  private unionPreview: UnionPreview | null = null;
  private unionError: UnionError | null = null;
  private holeId: FeatureId | null = null;
  private holeRemoval: GeometryFeature | null = null;
  private lasso: LassoOptions | null = null;
  private activePartIndex: number | null = null;
  private activeRingIndex: number | null = null;
  private reshapeId: FeatureId | null = null;
  private reshapePreview: ReshapePreview | null = null;
  private reshapeError: ReshapeError | null = null;
  private reshapeSide: ReshapeSide = 'shorter';
  private cutFeedback: CutFeedback | null = null;
  private splitId: FeatureId | null = null;
  private splitPreview: SplitPreview | null = null;
  private splitError: SplitError | null = null;
  private templates: PreparedTemplate[];
  private template: { source: PreparedTemplate; draft: TemplateDraft; result: ReturnType<typeof placeTemplate> } | null = null;
  private textMarker: TextMarkerOptions | null = null;
  private kind: DrawGeometryType | null = null;
  private shape: DrawShape | null = null;
  private shapeAnchor: Coordinate | null = null;
  private cutting: { targets: FeatureId[] | null } | null = null;
  private partId: FeatureId | null = null;
  private draft: Coordinate[] = [];
  private drawingSteps: number[] = [];
  private readonly features = new Map<FeatureId, GeometryFeature>();
  private selectedFeatureIds = new Set<FeatureId>();
  private validationError: ValidationError | null = null;
  private editingId: FeatureId | null = null;
  private selectedVertexIndices: number[] = [];
  private get selectedVertexIndex(): number | null { return this.selectedVertexIndices.at(-1) ?? null; }
  private dataRevision = 0;
  private readonly pins = new VertexPinIndex();
  private pinSequence = 0;
  private editPinIndices = new Map<string, number[]>();
  private pinnedPreview: GeometryFeatureCollection | null = null;
  private pinningError: PinningErrorCode | null = null;

  private readonly history: EditHistory;
  private locks = new Set<FeatureId>();
  private historyLocks = new WeakMap<HistoryEntry, boolean>();
  private dataLayers: DataLayerStore;
  private activeDataLayerId: string | null;
  private dataLayerSelectionScope: DataLayerSelectionScope;
  private dataLayerRevision = 0;
  private historyDataLayers = new WeakMap<HistoryEntry, DataLayerIssue[]>();
  private geofencing: GeofencingPolicy;
  private fenceCache: { key: string; violations: GeofencingViolation[] } | null = null;
  private historyFences = new WeakMap<HistoryEntry, Partial<Record<HistoryEvent['direction'], GeofencingViolation[]>>>();

  constructor(private readonly createId: () => FeatureId, historyLimit = 100, lockedIds: readonly FeatureId[] = [], templates: readonly ShapeTemplate[] = defaultShapeTemplates(), geofencing?: Partial<GeofencingOptions>, layers: DataLayerOptions = {}, private readonly maxFeatures = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(maxFeatures) || maxFeatures < 0) throw new RangeError('maxFeatures must be a nonnegative safe integer.');
    if (!layers || typeof layers !== 'object' || Array.isArray(layers) || Object.keys(layers).some(key => !['layers', 'activeLayerId', 'selectionScope'].includes(key))) throw new TypeError('Invalid data layer options.');
    this.dataLayers = new DataLayerStore(layers.layers);
    this.dataLayerSelectionScope = layers.selectionScope === undefined ? 'all' : layers.selectionScope;
    if (this.dataLayerSelectionScope !== 'all' && this.dataLayerSelectionScope !== 'active') throw new TypeError('Data layer selection scope must be all or active.');
    this.activeDataLayerId = layers.activeLayerId === undefined ? this.fallbackDataLayer() : layers.activeLayerId;
    if (this.activeDataLayerId !== null) this.dataLayers.assertWritable(this.activeDataLayerId);
    this.geofencing = new GeofencingPolicy(geofencing);
    this.templates = prepareShapeTemplates(templates);
    this.history = new EditHistory(historyLimit);
    this.locks = lockedFeatureIds(lockedIds);
  }

  getGeofencing(): GeofencingOptions { return this.geofencing.snapshot(); }

  getDataLayers(): DataLayer[] { return this.dataLayers.snapshot(); }
  getActiveDataLayer(): string | null { return this.activeDataLayerId; }
  getReferenceRevision(): number { return this.dataRevision + this.dataLayerRevision; }
  getFeatureDataLayer(id: FeatureId): string | null { const feature = this.features.get(id); return feature ? featureDataLayerId(feature) : null; }
  canCreateFeatures(count = 1): boolean {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Feature count must be a nonnegative safe integer.');
    return count <= this.maxFeatures - this.features.size;
  }
  canDrawInDataLayer(): boolean { return this.canCreateFeatures() && this.dataLayers.issue(this.activeDataLayerId) === null; }

  canSelectFeature(id: FeatureId): boolean {
    const feature = this.features.get(id); if (!feature) return false;
    const layer = this.dataLayers.get(featureDataLayerId(feature));
    return !!layer?.visible && layer.selectable && (this.dataLayerSelectionScope === 'all' || layer.id === this.activeDataLayerId);
  }

  isFeatureSnappable(id: FeatureId): boolean {
    const feature = this.features.get(id); const layer = feature && this.dataLayers.get(featureDataLayerId(feature));
    return !!layer?.visible && layer.snapping;
  }

  private fallbackDataLayer(): string | null {
    return this.dataLayers.layers.find(layer => !this.dataLayers.issue(layer.id))?.id ?? null;
  }

  setDataLayers(definitions: readonly DataLayerDefinition[]): boolean {
    const next = new DataLayerStore(definitions);
    for (const feature of this.features.values()) next.assertKnown(featureDataLayerId(feature), feature.id);
    if (JSON.stringify(next.layers) === JSON.stringify(this.dataLayers.layers)) return false;
    const oldActive = this.activeDataLayerId;
    this.dataLayers = next;
    if (this.activeDataLayerId !== null && this.dataLayers.issue(this.activeDataLayerId)) this.activeDataLayerId = this.fallbackDataLayer();
    this.refreshDataLayerPolicy(oldActive !== this.activeDataLayerId);
    return true;
  }

  validateDataLayers(definitions: readonly DataLayerDefinition[]): void {
    const next = new DataLayerStore(definitions);
    for (const feature of this.features.values()) next.assertKnown(featureDataLayerId(feature), feature.id);
  }

  addDataLayer(definition: DataLayerDefinition): boolean {
    if (this.dataLayers.get(definition?.id)) throw new RangeError(`Data layer already exists: ${definition.id}`);
    return this.setDataLayers([...this.getDataLayers(), definition]);
  }
  updateDataLayer(id: string, patch: Partial<Omit<DataLayer, 'id'>>): boolean {
    this.dataLayers.assertKnown(id);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.hasOwn(patch, 'id')) throw new TypeError('Patch data layer settings without changing its ID.');
    return this.setDataLayers(this.getDataLayers().map(layer => layer.id === id ? { ...layer, ...patch } : layer));
  }
  removeDataLayer(id: string): boolean {
    this.dataLayers.assertKnown(id);
    if (id === defaultDataLayerId) throw new RangeError('The default data layer cannot be removed.');
    return this.setDataLayers(this.getDataLayers().filter(layer => layer.id !== id));
  }
  reorderDataLayers(ids: readonly string[]): boolean {
    if (!isArray(ids) || ids.length !== this.dataLayers.layers.length || new Set(ids).size !== ids.length) throw new RangeError('Reorder with every data layer ID exactly once, bottom to top.');
    return this.setDataLayers(ids.map(id => { this.dataLayers.assertKnown(id); return this.dataLayers.get(id)!; }));
  }
  setActiveDataLayer(id: string | null): boolean {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before changing the active data layer.');
    if (id !== null) this.dataLayers.assertWritable(id);
    if (id === this.activeDataLayerId) return false;
    this.activeDataLayerId = id; this.refreshDataLayerPolicy(); return true;
  }
  setDataLayerSelectionScope(scope: DataLayerSelectionScope): boolean {
    if (scope !== 'all' && scope !== 'active') throw new TypeError('Data layer selection scope must be all or active.');
    if (scope === this.dataLayerSelectionScope) return false;
    this.dataLayerSelectionScope = scope; this.refreshDataLayerPolicy(); return true;
  }
  private refreshDataLayerPolicy(activeChanged = false): void {
    this.dataLayerRevision++; this.historyLocks = new WeakMap(); this.historyDataLayers = new WeakMap(); this.fenceCache = null;
    const targets = this.differenceActive ? [...this.selectedFeatureIds].slice(0, 1) : [...this.selectedFeatureIds];
    if (this.editingId !== null) targets.push(...this.pins.related(this.editingId));
    if (this.kind !== null && !this.lasso && (activeChanged && this.isCreationDraft() || targets.some(id => this.isFeatureLocked(id) || !this.canSelectFeature(id)))) this.cancel();
    for (const id of this.selectedFeatureIds) if (!this.canSelectFeature(id)) this.selectedFeatureIds.delete(id);
  }
  private isCreationDraft(): boolean {
    return this.kind !== null && this.editingId === null && this.holeId === null && this.partId === null && !this.lasso && !this.holeRemoval && !this.cutting
      && !this.offsetting && !this.buffering && !this.simplification && !this.scaling && !this.rotation && !this.sharedBoundary
      && this.reshapeId === null && this.splitId === null && !this.unionActive && !this.differenceActive && !this.intersectionActive;
  }

  getHistoryDataLayerIssues(direction: HistoryEvent['direction']): DataLayerIssue[] {
    if (direction !== 'undo' && direction !== 'redo') throw new TypeError('Expected undo or redo.');
    const entry = this.history.peek(direction);
    return entry ? this.historyDataLayerIssues(entry).map(issue => ({ ...issue })) : [];
  }
  private historyDataLayerIssues(entry: HistoryEntry): DataLayerIssue[] {
    let issues = this.historyDataLayers.get(entry);
    if (!issues) {
      const unique = new Map<string, DataLayerIssue>();
      for (const change of entry.changes) for (const feature of [change.before, change.after]) {
        if (!feature) continue;
        const issue = this.dataLayers.issue(featureDataLayerId(feature), feature.id);
        if (issue) unique.set(JSON.stringify([issue.featureId, issue.layerId, issue.code]), issue);
      }
      issues = [...unique.values()]; this.historyDataLayers.set(entry, issues);
    }
    return issues;
  }
  moveFeaturesToDataLayer(ids: readonly FeatureId[], layerId: string): TransactionEvent | null {
    if (!isArray(ids)) throw new TypeError('Expected feature IDs.');
    this.dataLayers.assertWritable(layerId);
    return this.applyTransaction({ update: [...new Set(ids)].map(id => {
      const feature = this.features.get(id); if (!feature) throw new RangeError(`Unknown feature ID: ${id}`);
      return assignDataLayer(feature, layerId);
    }) });
  }

  getVisibleGeoJSON(): GeometryFeatureCollection {
    const ranks = new Map(this.dataLayers.layers.map((layer, index) => [layer.id, index]));
    return { type: 'FeatureCollection', features: [...this.features.values()].filter(feature => this.dataLayers.get(featureDataLayerId(feature))?.visible)
      .sort((a, b) => ranks.get(featureDataLayerId(a))! - ranks.get(featureDataLayerId(b))!).map(copyFeature) };
  }
  getSnappingGeoJSON(): GeometryFeatureCollection {
    return { type: 'FeatureCollection', features: [...this.features.values()].filter(feature => this.isFeatureSnappable(feature.id)).map(copyFeature) };
  }
  setGeofencing(update: Partial<GeofencingOptions>): boolean {
    const next = new GeofencingPolicy(update, this.geofencing.options);
    if (JSON.stringify(next.options) === JSON.stringify(this.geofencing.options)) return false;
    this.geofencing = next; this.fenceCache = null; this.historyFences = new WeakMap();
    return true;
  }

  /** Audit snapshots without mutating data or allocating feature IDs. */
  checkGeofencing(features: readonly GeometryFeature[]): GeofencingViolation[] {
    const prepared = prepareImport({ type: 'FeatureCollection', features }, () => false, () => { throw new TypeError('Geofencing checks require explicit feature IDs.'); });
    return this.geofencing.check(prepared.map(feature => ({ featureId: feature.id, geometry: feature.geometry })));
  }

  getHistoryGeofencingViolations(direction: HistoryEvent['direction']): GeofencingViolation[] {
    if (direction !== 'undo' && direction !== 'redo') throw new TypeError('Expected undo or redo.');
    const entry = this.history.peek(direction);
    return entry ? copyViolations(this.historyGeofencingViolations(entry, direction)) : [];
  }

  private historyGeofencingViolations(entry: HistoryEntry, direction: HistoryEvent['direction']): GeofencingViolation[] {
    if (!this.geofencing.options.enabled) return [];
    let cached = this.historyFences.get(entry);
    if (!cached) { cached = {}; this.historyFences.set(entry, cached); }
    return cached[direction] ??= this.geofencing.check(entry.changes.flatMap(change => {
      const feature = direction === 'undo' ? change.before : change.after;
      return feature ? [{ featureId: feature.id, geometry: feature.geometry }] : [];
    }));
  }

  private assertGeofencing(changes: readonly FeatureChange[]): void {
    const violations = this.geofencing.check(changes.flatMap(change => change.after ? [{ featureId: change.after.id, geometry: change.after.geometry }] : []));
    if (violations.length) throw new GeofencingError(violations);
  }

  private draftGeofencingViolations(): GeofencingViolation[] {
    if (!this.geofencing.options.enabled || this.kind === null || this.lasso) return [];
    const key = JSON.stringify([this.dataRevision, this.kind, this.shape, this.editingId, this.holeId, this.partId, this.activePartIndex, this.activeRingIndex,
      [...this.selectedFeatureIds], [...this.locks], this.dataLayerRevision, this.validationError, this.pinningError, this.draft, this.textMarker, this.template?.result.preview,
      this.offsetting?.preview, this.buffering?.preview, this.simplification?.preview, this.scaling?.preview, this.rotation?.preview,
      this.sharedBoundaryPreview, this.reshapePreview, this.unionPreview, this.differencePreview, this.intersectionPreview, this.splitPreview, this.holeRemoval, this.cutting]);
    if (key === this.fenceCache?.key) return this.fenceCache.violations;
    const violations = this.geofencing.check(this.geofencingCandidates());
    this.fenceCache = { key, violations }; return violations;
  }

  /** Final affected geometry, never an input cutter or an incomplete polygon. */
  private geofencingCandidates(): GeofencingCandidate[] {
    const candidates = (features: readonly GeometryFeature[] | null | undefined): GeofencingCandidate[] => features?.map(feature => ({ featureId: feature.id, geometry: feature.geometry })) ?? [];
    if (this.template) return (this.template.result.preview?.features ?? []).map(feature => ({ featureId: null, geometry: feature.geometry }));
    if (this.offsetting) return candidates(this.offsetting.preview);
    if (this.buffering) return candidates(this.buffering.preview);
    if (this.simplification) return candidates(this.simplification.preview);
    if (this.scaling) return candidates(this.scaling.preview);
    if (this.rotation) return candidates(this.rotation.preview);
    if (this.sharedBoundary) return candidates(this.sharedBoundaryPreview?.features);
    if (this.splitId !== null) return this.splitPreview ? [{ featureId: this.splitId, geometry: this.splitPreview.retained }, { featureId: null, geometry: this.splitPreview.created }] : [];
    if (this.reshapeId !== null) return this.reshapePreview ? [{ featureId: this.reshapeId, geometry: this.reshapePreview }] : [];
    const first = this.selectedFeatureIds.values().next().value ?? null;
    if (this.unionActive) return this.unionPreview ? [{ featureId: first, geometry: this.unionPreview }] : [];
    if (this.differenceActive) return this.differencePreview?.geometry ? [{ featureId: first, geometry: this.differencePreview.geometry }] : [];
    if (this.intersectionActive) return this.intersectionPreview?.geometry ? [{ featureId: first, geometry: this.intersectionPreview.geometry }] : [];
    if (this.holeRemoval) return this.validationError === null ? candidates([this.holeRemoval]) : [];
    if (this.validationError !== null || this.pinningError !== null) return [];
    if (this.isPinnedEdit()) return candidates(this.pinnedPreview?.features);
    if (this.cutting) {
      const output: GeofencingCandidate[] = [];
      for (const id of this.cutting.targets ?? this.features.keys()) {
        const feature = this.features.get(id)!;
        if (this.isFeatureLocked(id)) continue;
        const result = cutGeometry(feature.geometry, this.draft);
        if (result.geometry && JSON.stringify(result.geometry) !== JSON.stringify(feature.geometry)) output.push({ featureId: id, geometry: result.geometry });
      }
      return output;
    }
    return [{ featureId: this.editingId ?? this.holeId ?? this.partId, geometry: this.draftGeometry(true) }];
  }

  getLockedFeatureIds(): FeatureId[] { return [...this.locks]; }
  isFeatureLocked(id: FeatureId): boolean { const feature = this.features.get(id); return this.locks.has(id) || !!feature && this.dataLayers.issue(featureDataLayerId(feature), id) !== null; }

  /** Replace host policy; cancel a draft only when one of its mutation targets is locked. */
  setLockedFeatureIds(ids: readonly FeatureId[]): boolean {
    const next = lockedFeatureIds(ids);
    if (sameLocks(this.locks, next)) return false;
    this.locks = next;
    this.historyLocks = new WeakMap();
    if (this.kind !== null && !this.lasso && this.selectionLocked(this.differenceActive)) this.cancel();
    if (this.editingId !== null && this.pins.related(this.editingId).some(id => this.isFeatureLocked(id))) this.cancel();
    return true;
  }

  private selectionLocked(firstOnly = false): boolean {
    for (const id of this.selectedFeatureIds) {
      if (this.isFeatureLocked(id)) return true;
      if (firstOnly) break;
    }
    return false;
  }

  private canReplay(direction: HistoryEvent['direction']): boolean {
    const entry = this.history.peek(direction);
    if (!entry) return false;
    let blocked = this.historyLocks.get(entry);
    if (blocked === undefined) {
      blocked = entry.changes.some(({ before, after }) => this.locks.has((before ?? after)!.id)) || this.historyDataLayerIssues(entry).length > 0;
      this.historyLocks.set(entry, blocked);
    }
    return !blocked && this.historyGeofencingViolations(entry, direction).length === 0;
  }

  private get selectedFeatureId(): FeatureId | null {
    return this.selectedFeatureIds.size === 1 ? this.selectedFeatureIds.values().next().value! : null;
  }

  get state(): EditorState {
    const geofencingViolations = this.draftGeofencingViolations();
    const growth = this.template ? this.template.result.preview?.features.length ?? 0 : this.splitId !== null ? 1 : this.isCreationDraft() ? 1 : 0;
    const featureLimitReached = !this.canCreateFeatures(growth);
    return {
      mode: this.template ? 'draw-template' : this.lasso ? 'select-lasso' : this.holeRemoval ? 'remove-hole' : this.offsetting ? 'offset-lines' : this.buffering ? 'buffer-features' : this.simplification ? 'simplify-features' : this.scaling ? 'scale-features' : this.rotation ? 'rotate-features' : this.sharedBoundary ? 'edit-shared-boundary' : this.reshapeId !== null ? 'reshape-polygon' : this.intersectionActive ? 'intersection-polygons' : this.differenceActive ? 'difference-polygons' : this.unionActive ? 'union-polygons' : this.holeId !== null ? 'draw-hole' : this.splitId !== null ? 'split-polygon' : this.cutting ? 'draw-cut' : this.partId !== null ? 'draw-part' : this.kind === null ? 'idle' : this.editingId !== null
        ? this.kind === 'Point' ? 'edit-point' : this.kind === 'LineString' ? 'edit-line' : 'edit-polygon'
        : this.textMarker ? 'draw-text' : this.shape ? shapeModes[this.shape] : this.kind === 'Point' ? 'draw-point' : this.kind === 'LineString' ? 'draw-line' : 'draw-polygon',
      vertexCount: this.draft.length,
      featureCount: this.features.size,
      selectedFeatureId: this.selectedFeatureId,
      selectedFeatureIds: [...this.selectedFeatureIds],
      selectedVertexIndex: this.selectedVertexIndex,
      selectedVertexIndices: [...this.selectedVertexIndices],
      activeRingIndex: this.activeRingIndex,
      activePartIndex: this.activePartIndex,
      dataRevision: this.dataRevision,
      dataLayerRevision: this.dataLayerRevision, activeDataLayerId: this.activeDataLayerId, dataLayerSelectionScope: this.dataLayerSelectionScope,
      canFinish: featureLimitReached || geofencingViolations.length || this.pinningError !== null ? false : this.template ? this.template.draft.position !== null && this.template.result.preview !== null : this.textMarker && !this.textMarker.text.trim() ? false : this.lasso ? false : this.holeRemoval ? this.validationError === null : this.offsetting ? this.offsetting.preview !== null : this.buffering ? this.buffering.preview !== null : this.simplification ? this.simplification.preview !== null : this.scaling ? this.scaling.preview !== null : this.rotation ? this.rotation.preview !== null : this.sharedBoundary ? this.sharedBoundaryPreview !== null : this.reshapeId !== null ? this.reshapePreview !== null : this.intersectionActive ? this.intersectionPreview !== null : this.differenceActive ? this.differencePreview !== null : this.unionActive ? this.unionPreview !== null : this.splitId !== null ? this.splitPreview !== null : this.kind !== null && this.validationError === null,
      canUndo: this.kind === null && this.canReplay('undo'),
      canRedo: this.kind === null && this.canReplay('redo'),
      validationError: featureLimitReached ? 'feature-limit' : this.validationError,
      pinningError: this.pinningError,
      geofencingViolations: copyViolations(geofencingViolations),
      templateError: this.template?.result.error ?? null,
      splitError: this.splitError,
      sharedBoundaryError: this.sharedBoundaryError,
      offsetDistance: this.offsetting?.distance ?? null,
      offsetError: this.offsetting?.error ?? null,
      bufferDistance: this.buffering?.distance ?? null,
      bufferError: this.buffering?.error ?? null,
      simplificationTolerance: this.simplification?.tolerance ?? null,
      simplificationError: this.simplification?.error ?? null,
      scaleFactor: this.scaling && this.scaling.factorX === this.scaling.factorY ? this.scaling.factorX : null,
      scaleFactorX: this.scaling?.factorX ?? null,
      scaleFactorY: this.scaling?.factorY ?? null,
      scalePivot: this.scaling ? [...this.scaling.pivot] : null,
      scaleError: this.scaling?.error ?? null,
      rotationAngle: this.rotation?.angle ?? null,
      rotationPivot: this.rotation ? [...this.rotation.pivot] : null,
      rotationError: this.rotation?.error ?? null,
      reshapeError: this.reshapeError,
      reshapeSide: this.reshapeId !== null ? this.reshapeSide : null,
      unionError: this.unionError,
      differenceError: this.differenceError,
      intersectionError: this.intersectionError,
    };
  }

  /** Freeze data while a screen-space lasso is being drawn; selection is retained. */
  startLasso(options: Partial<LassoOptions> = {}): boolean {
    const next = lassoOptions(options);
    if (this.lasso) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before selecting with a lasso.');
    this.lasso = next; this.kind = 'Polygon';
    return true;
  }

  getLassoOptions(): LassoOptions | null { return this.lasso ? { ...this.lasso } : null; }

  setLassoOptions(update: Partial<LassoOptions>): void {
    if (!this.lasso) throw new Error('Start lasso selection before changing its options.');
    this.lasso = lassoOptions(update, this.lasso);
    this.validationError = null;
  }

  setLassoError(error: ValidationError | null): void {
    if (this.lasso) this.validationError = error;
  }

  /** Complete a selection, without a data revision, transaction or history entry. */
  finishLasso(ids: readonly FeatureId[]): boolean {
    if (!this.lasso) return false;
    for (const id of ids) if (!this.features.has(id)) throw new RangeError(`Unknown feature ID: ${id}`);
    const hits = new Set(ids.filter(id => this.canSelectFeature(id)));
    const previous = [...this.selectedFeatureIds];
    const selected = this.lasso.operation === 'replace' ? [...hits]
      : this.lasso.operation === 'add' ? [...this.selectedFeatureIds, ...hits]
      : previous.filter((id) => !hits.has(id));
    this.cancel();
    this.selectMany(selected);
    return true;
  }

  getShapeTemplates(): ShapeTemplate[] { return this.templates.map(({ definition, features }) => ({ id: definition.id, label: definition.label, data: { type: 'FeatureCollection', features: features.map(copyFeature) } })); }

  setShapeTemplates(templates: readonly ShapeTemplate[]): void {
    if (this.template) throw new Error('Finish or cancel template placement before replacing its library.');
    const next = prepareShapeTemplates(templates);
    this.templates = next;
  }

  startTemplate(id?: string, options: Partial<TemplatePlacement> = {}): boolean {
    this.dataLayers.assertWritable(this.activeDataLayerId);
    const source = this.templates.find(template => template.definition.id === (id ?? this.templates[0]?.definition.id));
    if (!source) throw new RangeError(`Unknown shape template: ${String(id)}`);
    const draft = templatePlacement(options, { templateId: source.definition.id, position: null, size: 200, rotation: 0 });
    if (draft.templateId !== source.definition.id) throw new TypeError('Pass the template ID as the first argument.');
    if (this.template?.draft.templateId === source.definition.id) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before placing a template.');
    const result = placeTemplate(source, draft);
    this.template = { source, draft, result }; this.kind = 'Polygon';
    this.draft = draft.position ? [[...draft.position]] : [];
    this.selectedFeatureIds.clear();
    return true;
  }

  getTemplateDraft(): TemplateDraft | null {
    return this.template ? { ...this.template.draft, position: this.template.draft.position ? [...this.template.draft.position] : null } : null;
  }

  setTemplatePlacement(patch: Partial<TemplateDraft>): boolean {
    if (!this.template) throw new Error('Start template placement first.');
    const draft = templatePlacement(patch, this.template.draft);
    const source = this.templates.find(template => template.definition.id === draft.templateId);
    if (!source) throw new RangeError(`Unknown shape template: ${draft.templateId}`);
    if (JSON.stringify(draft) === JSON.stringify(this.template.draft)) return false;
    this.template = { source, draft, result: placeTemplate(source, draft) };
    this.draft = draft.position ? [[...draft.position]] : [];
    return true;
  }

  getTemplatePreview(position?: Coordinate): GeometryFeatureCollection | null {
    if (!this.template) return null;
    const result = this.template.draft.position !== null || position === undefined ? this.template.result
      : placeTemplate(this.template.source, templatePlacement({ position }, this.template.draft));
    return result.preview ? { type: 'FeatureCollection', features: result.preview.features.map(copyFeature) } : null;
  }

  finishTemplate(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.template?.result.preview || this.template.draft.position === null) return null;
    const reserved = new Set<FeatureId>();
    const features = this.template.result.preview.features.map(feature => {
      const id = this.allocateId(reserved); reserved.add(id);
      return assignDataLayer({ ...copyFeature(feature), id }, this.activeDataLayerId!);
    });
    const changes = prepareTransaction({ create: features }, this.features);
    this.commit('transaction', changes); this.cancel(); this.selectedFeatureIds = new Set([...reserved].filter(id => this.canSelectFeature(id)));
    return { changes: changes.map(({ after }) => ({ before: null, after: copyFeature(after!) })) };
  }

  /** Place a label, then confirm its text and position as one creation. */
  startText(options: TextMarkerOptions = { text: '' }): boolean {
    const next = textMarkerOptions(options, true);
    if (this.textMarker && this.editingId === null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before drawing text.');
    this.start('Point');
    this.textMarker = next;
    return true;
  }

  getTextMarkerDraft(): TextMarkerOptions | null {
    return this.textMarker ? textMarkerOptions(this.textMarker, true) : null;
  }

  /** Patch draft text/style without committing or losing unrelated properties. */
  setTextMarker(patch: Partial<TextMarkerOptions>): boolean {
    if (!this.textMarker) throw new Error('Start drawing or editing a text marker first.');
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)
      || Object.keys(patch).some(key => key !== 'text' && key !== 'style')) throw new TypeError('Expected a text marker patch.');
    const next = textMarkerOptions({ ...this.textMarker, ...patch,
      ...(Object.hasOwn(patch, 'style') ? { style: { ...this.textMarker.style, ...textMarkerOptions({ text: '', style: patch.style }, true).style } } : {}),
    }, true);
    if (JSON.stringify(next) === JSON.stringify(this.textMarker)) return false;
    this.textMarker = next;
    this.validatePinnedEdit();
    return true;
  }

  start(kind: DrawGeometryType | DrawShape): boolean {
    this.dataLayers.assertWritable(this.activeDataLayerId);
    const shape = kind === 'Rectangle' || kind === 'Circle' || kind === 'Ellipse' || kind === 'Freehand' ? kind : null;
    if (!shape && kind !== 'Point' && kind !== 'LineString' && kind !== 'Polygon') throw new TypeError('Unsupported geometry type.');
    if (this.kind !== null && this.state.mode === (shape ? shapeModes[shape] : drawModes[kind as DrawGeometryType])) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before changing tools.');
    this.kind = shape ? 'Polygon' : kind as DrawGeometryType;
    this.shape = shape; this.shapeAnchor = null;
    this.selectedFeatureIds.clear();
    this.validationError = 'too-few-vertices';
    return true;
  }

  add([lng, lat]: Coordinate): boolean {
    if (this.template) return this.setTemplatePlacement({ position: [lng, lat] });
    if (this.lasso || this.holeRemoval || this.offsetting || this.buffering || this.simplification || this.scaling || this.rotation || this.sharedBoundary || this.kind === null || this.editingId !== null || this.unionActive || this.differenceActive || this.intersectionActive || this.shape === 'Freehand') return false;
    this.validatePosition([lng, lat]);
    if (this.shape) return this.addShapePoint([lng, lat]);
    const last = this.draft.at(-1);
    if (last && samePosition(last, [lng, lat])) return false;
    if (this.canTrace()) this.drawingSteps.push(this.draft.length);
    if (this.kind === 'Point') this.draft = [[lng, lat]];
    else this.draft.push([lng, lat]);
    if (this.splitId !== null) { this.validateSplit(); return true; }
    if (this.reshapeId !== null) { this.validateReshape(); return true; }
    // Cache validity on clicks. Pointer movement and state reads never run topology checks.
    this.validationError = this.kind === 'Polygon' ? this.validateDraftPolygon()
      : this.draft.length < (this.kind === 'Point' ? 1 : 2) ? 'too-few-vertices' : null;
    return true;
  }

  private canTrace(): boolean {
    const mode = this.state.mode;
    return mode === 'draw-line' || mode === 'draw-polygon' || mode === 'draw-hole' || mode === 'draw-cut' || mode === 'draw-part';
  }

  /** Rectangles, circles and ellipses: the first point anchors the shape, the second completes it. */
  private addShapePoint(point: Coordinate): boolean {
    const anchor = this.shapeAnchor ?? this.draft[0];
    if (!anchor) { this.shapeAnchor = [...point]; this.draft = [point]; this.validationError = 'too-few-vertices'; return true; }
    const ring = this.getShapePreview(point);
    if (!ring) return false;
    const previous = this.draft;
    this.draft = ring;
    const error = this.validateDraftPolygon();
    // An invalid shape keeps its anchor so the next point can try again.
    if (error) { this.draft = previous; return false; }
    this.validationError = null;
    return true;
  }

  /** The open rectangle, circle or ellipse ring from the placed anchor to `point`; null without one. */
  getShapeAnchor(): Coordinate | null { return this.shapeAnchor ? [...this.shapeAnchor] : null; }

  getShapePreview(point: Coordinate): Coordinate[] | null {
    const anchor = this.shapeAnchor ?? this.draft[0];
    if (!anchor || !this.shape || this.shape === 'Freehand') return null;
    return this.shape === 'Rectangle' ? rectangleRing(anchor, point) : this.shape === 'Circle' ? circleRing(anchor, point) : ellipseRing(anchor, point);
  }

  /** Replace the freehand draft with the outline traced by the pointer. */
  setFreehandPath(points: readonly Coordinate[]): boolean {
    if (this.shape !== 'Freehand') return false;
    if (!isArray(points)) throw new TypeError('Expected an array of positions.');
    for (const point of points) {
      if (!isArray(point) || point.length !== 2) throw new TypeError('Expected 2D positions.');
      this.validatePosition(point);
    }
    const ring = freehandRing(points);
    if (!ring) return false;
    const previous = this.draft;
    this.draft = ring;
    const error = this.validateDraftPolygon();
    if (error) { this.draft = previous; return false; }
    this.validationError = null;
    return true;
  }

  getBoundaryTrace(target: TraceTarget, from: Coordinate, to: Coordinate, side: TraceSide = 'shorter'): Coordinate[] | null {
    const feature = this.features.get(target.featureId);
    if (!feature || !this.isFeatureSnappable(feature.id)) return null;
    const source = traceSource(feature, target);
    return source ? traceBoundary(source.points, source.closed, from, to, side) : null;
  }

  /** Append one traced section as one correctable drawing step, without committing data. */
  traceBoundary(target: TraceTarget, from: Coordinate, to: Coordinate, side: TraceSide = 'shorter'): boolean {
    if (!this.canTrace()) return false;
    const path = this.getBoundaryTrace(target, from, to, side);
    if (!path) return false;
    const last = this.draft.at(-1);
    if (last && !sameTraceAttachment(last, path[0]!)) return false;
    const addition = last ? path.slice(1) : path;
    // Polygon closure is implicit in the draft; tracing back to its start adds only intervening corners.
    if (this.kind === 'Polygon' && this.draft[0] && sameTraceAttachment(this.draft[0], addition.at(-1)!)) addition.pop();
    if (!addition.length) return false;
    this.drawingSteps.push(this.draft.length);
    this.draft = this.draft.concat(addition);
    this.validationError = this.kind === 'Polygon' ? this.validateDraftPolygon() : this.draft.length < (this.kind === 'Point' ? 1 : 2) ? 'too-few-vertices' : null;
    return true;
  }

  /** Backspace removes the last click, including all corners inserted by a trace. */
  removeLastDrawStep(): boolean {
    if (this.shape && this.shape !== 'Freehand' && this.draft.length === 1) {
      this.draft = []; this.shapeAnchor = null; this.validationError = 'too-few-vertices'; return true;
    }
    if (!this.canTrace() || !this.drawingSteps.length) return false;
    this.draft.length = this.drawingSteps.pop()!;
    this.validationError = this.kind === 'Polygon' ? this.validateDraftPolygon() : this.draft.length < (this.kind === 'Point' ? 1 : 2) ? 'too-few-vertices' : null;
    return true;
  }

  /** Constant-time snapshot for pointer constraints; avoids copying the complete draft. */
  getLastDrawPoint(): Coordinate | null {
    const point = this.draft.at(-1);
    return point ? [...point] : null;
  }

  /** Bounded recent path for interactive guides; never copies an entire drawing. */
  getAlignmentDrawPoints(): Coordinate[] {
    const points = this.draft.slice(-3).map((point): Coordinate => [...point]);
    if (this.draft.length > 3) points.unshift([...this.draft[0]!]);
    return points;
  }

  getDraft(): Coordinate[] {
    return this.draft.map(([lng, lat]) => [lng, lat]);
  }

  finish(): GeometryFeature | null {
    if (this.isPinnedEdit()) {
      if (!this.state.canFinish) return null;
      const id = this.editingId!;
      this.finishPinnedEdit(); return this.getFeature(id);
    }
    if (this.template) return null;
    if (this.lasso || this.holeRemoval || this.offsetting || this.buffering || this.simplification || this.scaling || this.rotation || this.sharedBoundary || this.reshapeId !== null || this.intersectionActive || this.differenceActive || this.unionActive || this.splitId !== null || this.cutting || !this.state.canFinish) return null;
    const targetId = this.editingId ?? this.holeId ?? this.partId;
    const original = targetId === null ? undefined : this.features.get(targetId);
    const common = { type: 'Feature' as const, id: original?.id ?? this.allocateId(), properties: original ? copyProperties(original.properties) : {} };
    if (this.textMarker) common.properties = { ...common.properties, mapMasterText: textMarkerOptions(this.textMarker) };
    const raw = withGeometry(common, this.draftGeometry(true));
    const feature = original ? raw : assignDataLayer(raw, this.activeDataLayerId!);
    // No-op saves exit editing without emitting a data change or replacing the feature.
    if (!original || JSON.stringify(original.geometry) !== JSON.stringify(feature.geometry)
      || this.textMarker !== null && prepareTransaction({ update: [feature] }, this.features).length > 0) {
      this.commit(original ? 'edit' : 'create', [{ before: original ?? null, after: feature }]);
    }
    this.textMarker = null;
    this.draft = [];
    this.drawingSteps = [];
    this.kind = null;
    this.shape = null; this.shapeAnchor = null;
    this.validationError = null;
    this.editingId = null;
    this.holeId = null;
    this.partId = null;
    this.activeRingIndex = null;
    this.activePartIndex = null;
    this.selectedVertexIndices = [];
    return copyFeature(feature);
  }

  cancel(): boolean {
    if (this.kind === null) return false;
    this.editPinIndices.clear(); this.pinnedPreview = null; this.pinningError = null;
    this.template = null;
    this.textMarker = null;
    this.offsetting = null;
    this.buffering = null;
    this.simplification = null;
    this.scaling = null;
    this.rotation = null;
    this.sharedBoundary = null; this.sharedBoundaryPreview = null; this.sharedBoundaryError = null;
    this.intersectionActive = false; this.intersectionPreview = null; this.intersectionError = null;
    this.differenceActive = false; this.differencePreview = null; this.differenceError = null;
    this.unionActive = false; this.unionPreview = null; this.unionError = null;
    this.cutFeedback = null;
    this.reshapeId = null; this.reshapePreview = null; this.reshapeError = null; this.reshapeSide = 'shorter';
    this.splitId = null; this.splitPreview = null; this.splitError = null;
    this.cutting = null;
    this.partId = null;
    this.shape = null; this.shapeAnchor = null;
    this.kind = null;
    this.draft = [];
    this.drawingSteps = [];
    this.validationError = null;
    this.editingId = null;
    this.holeId = null;
    this.holeRemoval = null;
    this.lasso = null;
    this.activeRingIndex = null;
    this.activePartIndex = null;
    this.selectedVertexIndices = [];
    return true;
  }

  /** Freeze the complete polygon selection until confirmation or cancellation. */
  unionSelection(): boolean {
    if (this.unionActive) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before merging.');
    if (this.selectionLocked()) return false;
    const selected = this.getSelection();
    if (selected.length < 2) return false;
    const geometries: UnionPreview[] = [];
    for (const { geometry } of selected) {
      if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return false;
      geometries.push(geometry);
    }
    const result = unionPolygons(geometries);
    this.unionActive = true; this.kind = 'Polygon';
    this.unionPreview = result.preview; this.unionError = result.error;
    return true;
  }

  getUnionPreview(): UnionPreview | null {
    const preview = this.unionPreview;
    if (!preview) return null;
    const copyRings = (rings: Coordinate[][]): Coordinate[][] => rings.map((ring) => ring.map(([x, y]) => [x, y]));
    return preview.type === 'Polygon' ? { type: preview.type, coordinates: copyRings(preview.coordinates) }
      : { type: preview.type, coordinates: preview.coordinates.map(copyRings) };
  }

  /** Retain the first selected ID/properties/position; remove the other inputs atomically. */
  finishUnion(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.unionActive || !this.unionPreview) return null;
    const [retainedId, ...removedIds] = this.selectedFeatureIds;
    const original = this.features.get(retainedId!)!;
    const changes = prepareTransaction({ update: [withGeometry(original, this.unionPreview)], delete: removedIds }, this.features);
    this.commit('transaction', changes);
    this.cancel();
    return { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) };
  }

  /** The first selected polygon is the target; all subsequent polygons are cutters. */
  differenceSelection(): boolean {
    if (this.differenceActive) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before subtracting.');
    if (this.selectionLocked(true)) return false;
    const selected = this.getSelection();
    if (selected.length < 2) return false;
    const geometries: UnionPreview[] = [];
    for (const { geometry } of selected) {
      if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return false;
      geometries.push(geometry);
    }
    const result = differencePolygons(geometries[0]!, geometries.slice(1));
    this.differenceActive = true; this.kind = 'Polygon';
    this.differencePreview = result.preview; this.differenceError = result.error;
    return true;
  }

  getDifferencePreview(): DifferencePreview | null {
    if (!this.differencePreview) return null;
    const geometry = this.differencePreview.geometry;
    if (!geometry) return { geometry: null };
    const copyRings = (rings: Coordinate[][]): Coordinate[][] => rings.map((ring) => ring.map(([x, y]) => [x, y]));
    return { geometry: geometry.type === 'Polygon' ? { type: geometry.type, coordinates: copyRings(geometry.coordinates) }
      : { type: geometry.type, coordinates: geometry.coordinates.map(copyRings) } };
  }

  /** Update or delete only the target. A no-op exits review without recording history. */
  finishDifference(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.differenceActive || !this.differencePreview) return null;
    const original = this.features.get(this.selectedFeatureIds.values().next().value!)!;
    const geometry = this.differencePreview.geometry;
    const changes = prepareTransaction(geometry ? { update: [withGeometry(original, geometry)] } : { delete: [original.id] }, this.features);
    const committed = this.commit('transaction', changes);
    this.cancel();
    return committed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  /** Keep the filled area common to every selected polygon feature. */
  intersectionSelection(): boolean {
    if (this.intersectionActive) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before intersecting.');
    if (this.selectionLocked()) return false;
    const selected = this.getSelection();
    if (selected.length < 2) return false;
    const geometries: UnionPreview[] = [];
    for (const { geometry } of selected) {
      if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return false;
      geometries.push(geometry);
    }
    const result = intersectionPolygons(geometries);
    this.intersectionActive = true; this.kind = 'Polygon';
    this.intersectionPreview = result.preview; this.intersectionError = result.error;
    return true;
  }

  getIntersectionPreview(): IntersectionPreview | null {
    if (!this.intersectionPreview) return null;
    const geometry = this.intersectionPreview.geometry;
    if (!geometry) return { geometry: null };
    const copyRings = (rings: Coordinate[][]): Coordinate[][] => rings.map((ring) => ring.map(([x, y]) => [x, y]));
    return { geometry: geometry.type === 'Polygon' ? { type: geometry.type, coordinates: copyRings(geometry.coordinates) }
      : { type: geometry.type, coordinates: geometry.coordinates.map(copyRings) } };
  }

  /** Retain the first ID for nonempty output; empty output deletes all inputs. */
  finishIntersection(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.intersectionActive || !this.intersectionPreview) return null;
    const [retainedId, ...removedIds] = this.selectedFeatureIds;
    const original = this.features.get(retainedId!)!;
    const geometry = this.intersectionPreview.geometry;
    const changes = prepareTransaction(geometry ? { update: [withGeometry(original, geometry)], delete: removedIds } : { delete: [original.id, ...removedIds] }, this.features);
    const committed = this.commit('transaction', changes);
    this.cancel();
    return committed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  reshapeSelected(): boolean {
    if (this.reshapeId !== null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before reshaping.');
    if (this.selectionLocked()) return false;
    const feature = this.getSelected();
    if (!feature || feature.geometry.type !== 'Polygon' || feature.geometry.coordinates.length !== 1) return false;
    this.cutFeedback = emptyCutFeedback();
    this.reshapeId = feature.id; this.kind = 'LineString'; this.draft = [];
    this.reshapeError = 'reshape-too-few-points'; this.reshapePreview = null;
    return true;
  }

  setReshapePath(coordinates: Coordinate[]): void {
    if (this.reshapeId === null) throw new Error('Start reshaping a selected polygon first.');
    if (!Array.isArray(coordinates)) throw new TypeError('Expected an array of reshape-path coordinates.');
    for (const coordinate of coordinates) {
      if (!Array.isArray(coordinate) || coordinate.length !== 2) throw new TypeError('Expected a 2D reshape-path coordinate.');
      this.validatePosition(coordinate);
    }
    this.draft = coordinates.map((point) => [...point]); this.validateReshape();
  }

  removeReshapePoint(): boolean {
    if (this.reshapeId === null) throw new Error('Start reshaping a selected polygon first.');
    if (this.draft.length === 0) return false;
    this.draft.pop(); this.validateReshape(); return true;
  }

  setReshapeSide(side: ReshapeSide): boolean {
    if (this.reshapeId === null) throw new Error('Start reshaping a selected polygon first.');
    if (side !== 'shorter' && side !== 'longer') throw new TypeError('Unknown reshape side.');
    if (side === this.reshapeSide) return false;
    this.reshapeSide = side; this.validateReshape(); return true;
  }

  getReshapePreview(): ReshapePreview | null {
    return this.reshapePreview ? { type: 'Polygon', coordinates: this.reshapePreview.coordinates.map((ring) => ring.map((p) => [...p])) } : null;
  }

  private validateReshape(): void {
    const feature = this.features.get(this.reshapeId!)!;
    if (feature.geometry.type !== 'Polygon') throw new Error('Expected a polygon reshape target.');
    const result = reshapePolygon(feature.geometry.coordinates[0]!, this.draft, this.reshapeSide);
    this.cutFeedback = result.feedback;
    this.reshapePreview = result.preview; this.reshapeError = result.error;
  }

  finishReshape(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (this.reshapeId === null || !this.reshapePreview) return null;
    const original = this.features.get(this.reshapeId)!;
    const changes = prepareTransaction({ update: [withGeometry(original, this.reshapePreview)] }, this.features);
    const committed = this.commit('transaction', changes);
    this.cancel();
    return committed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  splitSelected(): boolean {
    if (this.splitId !== null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before splitting.');
    if (this.selectionLocked()) return false;
    const feature = this.getSelected();
    if (!feature || feature.geometry.type !== 'Polygon') return false;
    this.cutFeedback = emptyCutFeedback();
    this.splitId = feature.id; this.kind = 'LineString'; this.draft = [];
    this.splitError = 'split-too-few-points'; this.splitPreview = null;
    return true;
  }

  setSplitLine(coordinates: Coordinate[]): void {
    if (this.splitId === null) throw new Error('Start splitting a selected polygon first.');
    if (!Array.isArray(coordinates)) throw new TypeError('Expected an array of cutting-line coordinates.');
    for (const coordinate of coordinates) {
      if (!Array.isArray(coordinate) || coordinate.length !== 2) throw new TypeError('Expected a 2D cutting-line coordinate.');
      this.validatePosition(coordinate);
    }
    this.draft = coordinates.map((point) => [...point]); this.validateSplit();
  }

  removeSplitPoint(): boolean {
    if (this.splitId === null) throw new Error('Start splitting a selected polygon first.');
    if (this.draft.length === 0) return false;
    this.draft.pop(); this.validateSplit(); return true;
  }

  getCutFeedback(): CutFeedback | null {
    return this.cutFeedback ? copyCutFeedback(this.cutFeedback) : null;
  }

  getSplitPreview(): SplitPreview | null {
    if (!this.splitPreview) return null;
    return { retained: { type: 'Polygon', coordinates: this.splitPreview.retained.coordinates.map((ring) => ring.map((p) => [...p])) },
      created: { type: 'Polygon', coordinates: this.splitPreview.created.coordinates.map((ring) => ring.map((p) => [...p])) } };
  }

  private validateSplit(): void {
    const feature = this.features.get(this.splitId!)!;
    if (feature.geometry.type !== 'Polygon') throw new Error('Expected a polygon split target.');
    const result = splitPolygonRings(feature.geometry.coordinates, this.draft);
    this.cutFeedback = result.feedback;
    this.splitPreview = result.preview; this.splitError = result.error;
  }

  finishSplit(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (this.splitId === null || !this.splitPreview) return null;
    const original = this.features.get(this.splitId)!;
    const changes = prepareTransaction({ update: [{ ...original, geometry: this.splitPreview.retained }],
      create: [{ ...original, id: this.allocateId(), geometry: this.splitPreview.created }],
    }, this.features);
    this.commit('transaction', changes);
    this.cancel();
    return { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) };
  }

  /** Append a fully validated batch; existing data and selection survive any failure. */
  importGeoJSON(input: unknown, options: DataLayerImportOptions = {}): GeometryFeatureCollection {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before importing.');
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'dataLayerId')) throw new TypeError('Invalid data layer import options.');
    if (options.dataLayerId !== undefined) this.dataLayers.assertKnown(options.dataLayerId);
    const features = prepareImport(input, (id) => this.features.has(id), this.createId).map(feature => options.dataLayerId !== undefined
      ? assignDataLayer(feature, options.dataLayerId) : Object.hasOwn(feature.properties ?? {}, 'mapMasterLayer') ? feature : assignDataLayer(feature, this.activeDataLayerId ?? defaultDataLayerId));
    this.commit('import', features.map((feature) => ({ before: null, after: feature })));
    return { type: 'FeatureCollection', features: features.map(copyFeature) };
  }

  /** Validate a mixed batch, then commit it once. An empty/unchanged batch is a no-op. */
  applyTransaction(input: FeatureTransaction): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before applying a transaction.');
    const changes = prepareTransaction(input, this.features);
    if (!this.commit('transaction', changes)) return null;
    return { changes: changes.map(({ before, after }) => ({
      before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null,
    })) };
  }

  /** The only entry point for recording and applying prepared committed mutations. */
  private commit(action: HistoryAction, changes: FeatureChange[]): boolean {
    if (changes.length === 0) return false;
    const count = changes.reduce((count, change) => count + (change.before === null ? 1 : change.after === null ? -1 : 0), this.features.size);
    if (count > this.maxFeatures) throw new RangeError(`The editor allows at most ${this.maxFeatures} features.`);
    this.dataLayers.assertChanges(changes);
    this.assertGeofencing(changes);
    this.pins.validate(changes);
    for (const { before } of changes) {
      if (before && this.locks.has(before.id)) throw new FeatureLockedError(before.id);
    }
    const deletions = changes.filter((change) => change.after === null);
    // Only deletion needs original positions. Ordinary creation/editing stays indexed.
    const positions = deletions.length > 0 ? new Map(Array.from(this.features.keys(), (id, index) => [id, index])) : null;
    let appendIndex = this.features.size - deletions.length;
    const entry: HistoryEntry = { action, changes: changes.map((change) => ({ ...change,
      index: change.before === null ? appendIndex++ : change.after === null ? positions!.get(change.before.id)! : -1,
    })) };
    this.history.record(entry);
    this.applyChanges(entry.changes);
    return true;
  }

  undo(): HistoryEvent | null { return this.replay('undo'); }
  redo(): HistoryEvent | null { return this.replay('redo'); }

  clearHistory(): boolean {
    this.assertIdleHistory();
    return this.history.clear();
  }

  private assertIdleHistory(): void {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before changing history.');
  }

  private replay(direction: HistoryEvent['direction']): HistoryEvent | null {
    this.assertIdleHistory();
    if (!this.canReplay(direction)) return null;
    const entry = this.history[direction]();
    if (!entry) return null;
    this.applyChanges(entry.changes.map((change) => direction === 'undo'
      ? { before: change.after, after: change.before, index: change.index } : change));
    return { direction, action: entry.action, changes: entry.changes.map((change) => {
      const before = direction === 'undo' ? change.after : change.before;
      const after = direction === 'undo' ? change.before : change.after;
      return { before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null };
    }) };
  }

  private applyChanges(changes: HistoryEntry['changes']): void {
    this.pins.apply(changes);
    const insertions: { feature: GeometryFeature; index: number }[] = [];
    for (const change of changes) {
      const target = change.after;
      if (target === null) this.features.delete((change.before ?? change.after)!.id);
      else if (this.features.has(target.id)) this.features.set(target.id, target);
      else insertions.push({ feature: target, index: change.index });
    }
    insertions.sort((a, b) => a.index - b.index);
    // Appends need no reordering. Restoring a deleted middle feature rebuilds
    // only the Map order, retaining the untouched geometry objects by reference.
    if (insertions.length > 0 && insertions[0]!.index < this.features.size) {
      const survivors = Array.from(this.features.values());
      this.features.clear();
      let next = 0;
      for (const feature of survivors) {
        while (next < insertions.length && insertions[next]!.index <= this.features.size) {
          const restored = insertions[next++]!.feature;
          this.features.set(restored.id, restored);
        }
        this.features.set(feature.id, feature);
      }
      for (; next < insertions.length; next++) {
        const restored = insertions[next]!.feature;
        this.features.set(restored.id, restored);
      }
    } else {
      for (const { feature } of insertions) this.features.set(feature.id, feature);
    }
    for (const id of this.selectedFeatureIds) if (!this.canSelectFeature(id)) this.selectedFeatureIds.delete(id);
    this.dataRevision++;
  }

  private allocateId(reserved?: ReadonlySet<FeatureId>): FeatureId {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = this.createId();
      if (!this.features.has(id) && !reserved?.has(id)) return id;
    }
    throw new Error('Could not allocate a unique feature ID.');
  }

  exportGeoJSON(options: DataLayerExportOptions = {}): GeometryFeatureCollection {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['dataLayerId', 'visibleOnly'].includes(key))) throw new TypeError('Invalid data layer export options.');
    if (options.dataLayerId !== undefined) this.dataLayers.assertKnown(options.dataLayerId);
    if (options.visibleOnly !== undefined && typeof options.visibleOnly !== 'boolean') throw new TypeError('visibleOnly must be boolean.');
    return { type: 'FeatureCollection', features: [...this.features.values()].filter(feature => (options.dataLayerId === undefined || featureDataLayerId(feature) === options.dataLayerId)
      && (!options.visibleOnly || this.dataLayers.get(featureDataLayerId(feature))?.visible)).map(copyFeature) };
  }

  /** Selection is separate from feature data and available only outside drawing. */
  select(id: FeatureId | null): boolean {
    return this.selectMany(id === null ? [] : [id]);
  }

  /** Replace the whole selection atomically; deduplicate typed IDs in input order. */
  selectMany(ids: readonly FeatureId[]): boolean {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before selecting.');
    if (!Array.isArray(ids)) throw new TypeError('Expected an array of feature IDs.');
    const next = new Set<FeatureId>(ids as readonly FeatureId[]);
    for (const id of next) if (!this.features.has(id)) throw new RangeError(`Unknown feature ID: ${id}`);
    for (const id of next) if (!this.canSelectFeature(id)) throw new DataLayerError([{ featureId: id, layerId: featureDataLayerId(this.features.get(id)!), code: 'unselectable-layer' }]);
    const previous = this.selectedFeatureIds.values();
    if (next.size === this.selectedFeatureIds.size && [...next].every((id) => id === previous.next().value)) return false;
    this.selectedFeatureIds = next;
    return true;
  }

  toggleSelection(id: FeatureId): boolean {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before selecting.');
    if (!this.features.has(id)) throw new RangeError(`Unknown feature ID: ${id}`);
    if (!this.canSelectFeature(id)) throw new DataLayerError([{ featureId: id, layerId: featureDataLayerId(this.features.get(id)!), code: 'unselectable-layer' }]);
    if (!this.selectedFeatureIds.delete(id)) this.selectedFeatureIds.add(id);
    return true;
  }

  getSelection(): GeometryFeature[] {
    return Array.from(this.selectedFeatureIds, (id) => copyFeature(this.features.get(id)!));
  }

  getSelected(): GeometryFeature | null {
    const feature = this.selectedFeatureId === null ? undefined : this.features.get(this.selectedFeatureId);
    return feature ? copyFeature(feature) : null;
  }

  getFeature(id: FeatureId): GeometryFeature | null {
    const feature = this.features.get(id);
    return feature ? copyFeature(feature) : null;
  }

  hasFeature(id: FeatureId): boolean {
    return this.features.has(id);
  }

  /** Commit deletion of the selection; an idle editor without selection is a no-op. */
  deleteSelected(): GeometryFeature | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before deleting.');
    if (this.selectedFeatureIds.size > 1) throw new RangeError('Use deleteSelection() to delete multiple selected features.');
    if (this.selectionLocked()) return null;
    const feature = this.getSelected();
    if (!feature) return null;
    this.commit('delete', [{ before: this.features.get(feature.id)!, after: null }]);
    return feature;
  }

  /** Delete the complete selection through one transaction/history action. */
  deleteSelection(): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before deleting.');
    if (this.selectionLocked()) return null;
    return this.applyTransaction({ delete: [...this.selectedFeatureIds] });
  }

  /** Apply the same degree offset to every selected vertex as one validated transaction. */
  translateSelection(delta: Coordinate): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before translating.');
    if (this.selectionLocked()) return null;
    return this.applyTransaction({ update: this.previewTranslation(delta) });
  }

  /** Immutable idle-movement preview, including linked vertices of unselected features. */
  previewTranslation(delta: Coordinate, selected: readonly GeometryFeature[] = this.getSelection()): GeometryFeature[] {
    const translated = translateFeatures(selected, delta);
    const destinations = new Map(translated.flatMap(feature => readVertexPins(feature).map(pin => [pin.id, pin.coordinate] as const)));
    const selectedIds = new Set(selected.map(feature => feature.id));
    const followers = [...new Set(selected.flatMap(feature => this.pins.related(feature.id)))].filter(id => !selectedIds.has(id));
    const candidates = [...translated, ...followers.map(id => moveVertexPins(this.features.get(id)!, destinations))];
    this.assertGeofencing(candidates.map(after => ({ before: this.features.get(after.id)!, after })));
    if (!destinations.size) return candidates;
    const changes = prepareTransaction({ update: candidates }, this.features);
    if (changes.some(change => this.isFeatureLocked(change.before!.id))) throw new VertexPinError('pin-locked', 'A linked feature is locked.');
    this.pins.validate(changes);
    const normalized = new Map(changes.map(change => [change.after!.id, change.after!]));
    return candidates.map(feature => normalized.get(feature.id) ?? feature);
  }

  /** Copy the selection in acquisition order, optionally offset in degrees.
   * Reserve every new ID before committing; a failed batch changes nothing.
   */
  canDuplicateSelection(): boolean {
    return this.kind === null && this.selectedFeatureIds.size > 0 && this.canCreateFeatures(this.selectedFeatureIds.size) && [...this.selectedFeatureIds].every(id => this.dataLayers.issue(featureDataLayerId(this.features.get(id)!)) === null);
  }

  duplicateSelection(delta: Coordinate = [0, 0]): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before duplicating.');
    for (const id of this.selectedFeatureIds) this.dataLayers.assertWritable(featureDataLayerId(this.features.get(id)!), id);
    const copies = translateFeatures(this.getSelection().map(feature => withVertexPins(feature, [])), delta);
    const reserved = new Set<FeatureId>();
    for (const feature of copies) {
      feature.id = this.allocateId(reserved);
      reserved.add(feature.id);
    }
    const event = this.applyTransaction({ create: copies });
    if (event) this.selectedFeatureIds = new Set([...reserved].filter(id => this.canSelectFeature(id)));
    return event;
  }

  /** Begin a selection-wide rotation review in the Mercator plane. */
  rotateSelection(pivot?: Coordinate): boolean {
    if (this.rotation) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before rotating.');
    if (this.selectionLocked()) return false;
    if (pivot !== undefined) validateRotationPivot(pivot);
    const originals = this.getSelection();
    const center = rotationPivot(originals);
    if (!center) return false;
    this.rotation = { originals, pivot: [...(pivot ?? center)], angle: 0, preview: originals, error: null };
    this.kind = 'LineString';
    return true;
  }

  /** Absolute angle from the entry baseline, never an incremental transformation. */
  setRotationAngle(degrees: number): boolean {
    const angle = normalizeRotationAngle(degrees);
    if (!this.rotation || this.rotation.angle === angle) return false;
    return this.updateRotation(angle, this.rotation.pivot);
  }

  /** Recompute the absolute transform around a new pivot; omitted means original bounds centre. */
  setRotationPivot(pivot?: Coordinate): boolean {
    if (pivot !== undefined) validateRotationPivot(pivot);
    if (!this.rotation) return false;
    const next = pivot ?? rotationPivot(this.rotation.originals)!;
    if (next[0] === this.rotation.pivot[0] && next[1] === this.rotation.pivot[1]) return false;
    return this.updateRotation(this.rotation.angle, next);
  }

  private updateRotation(angle: number, pivot: Coordinate): boolean {
    const rotation = this.rotation!;
    let preview: GeometryFeature[] | null = null;
    let error: RotationError | null = null;
    try {
      const candidates = rotateFeatures(rotation.originals, angle, pivot);
      if (!rotationPivot(candidates)) throw new RangeError('Rotation creates an unsupported world-spanning selection.');
      // Use the same validation/normalization as commit; previews contain exact commit geometry.
      const changes = prepareTransaction({ update: candidates }, this.features);
      const updated = new Map(changes.map((change) => [change.after!.id, change.after!]));
      preview = candidates.map((feature) => updated.get(feature.id) ?? this.features.get(feature.id)!);
    } catch (cause) {
      if (cause instanceof GeoJSONImportError) error = 'rotation-invalid-result';
      else if (cause instanceof RangeError) error = 'rotation-out-of-bounds';
      else throw cause;
    }
    rotation.pivot = [...pivot]; rotation.angle = angle; rotation.preview = preview; rotation.error = error;
    return true;
  }

  getRotationPreview(): GeometryFeatureCollection | null {
    return this.rotation?.preview ? { type: 'FeatureCollection', features: this.rotation.preview.map(copyFeature) } : null;
  }

  finishRotation(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.rotation?.preview) return null;
    const changes = prepareTransaction({ update: this.rotation.preview }, this.features);
    const changed = this.commit('transaction', changes);
    this.cancel();
    return changed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  /** Begin a selection-wide scaling review in the Mercator plane. */
  scaleSelection(pivot?: Coordinate): boolean {
    if (this.scaling) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before scaling.');
    if (this.selectionLocked()) return false;
    if (pivot !== undefined) validateTransformPivot(pivot);
    const originals = this.getSelection();
    const center = transformPivot(originals);
    if (!center) return false;
    this.scaling = { originals, pivot: [...(pivot ?? center)], factorX: 1, factorY: 1, preview: originals, error: null };
    this.kind = 'LineString';
    return true;
  }

  /** Absolute factor from the entry baseline, never an incremental transformation. */
  setScaleFactor(factor: number): boolean {
    return this.setScaleFactors(factor, factor);
  }

  /** Absolute positive factors for the horizontal and vertical Mercator axes. */
  setScaleFactors(horizontal: number, vertical: number): boolean {
    validateScaleFactor(horizontal); validateScaleFactor(vertical);
    if (!this.scaling || this.scaling.factorX === horizontal && this.scaling.factorY === vertical) return false;
    return this.updateScale(horizontal, vertical, this.scaling.pivot);
  }

  /** Recompute absolute factors around a new pivot; omitted means original bounds centre. */
  setScalePivot(pivot?: Coordinate): boolean {
    if (pivot !== undefined) validateTransformPivot(pivot);
    if (!this.scaling) return false;
    const next = pivot ?? transformPivot(this.scaling.originals)!;
    if (next[0] === this.scaling.pivot[0] && next[1] === this.scaling.pivot[1]) return false;
    return this.updateScale(this.scaling.factorX, this.scaling.factorY, next);
  }

  private updateScale(horizontal: number, vertical: number, pivot: Coordinate): boolean {
    const scaling = this.scaling!;
    let preview: GeometryFeature[] | null = null;
    let error: ScaleError | null = null;
    try {
      const candidates = scaleFeatures(scaling.originals, horizontal, pivot, vertical);
      if (!transformPivot(candidates)) throw new RangeError('Scaling creates an unsupported world-spanning selection.');
      // Use the same validation/normalization as commit; previews contain exact commit geometry.
      const changes = prepareTransaction({ update: candidates }, this.features);
      const updated = new Map(changes.map((change) => [change.after!.id, change.after!]));
      preview = candidates.map((feature) => updated.get(feature.id) ?? this.features.get(feature.id)!);
    } catch (cause) {
      if (cause instanceof GeoJSONImportError) error = 'scale-invalid-result';
      else if (cause instanceof RangeError) error = 'scale-out-of-bounds';
      else throw cause;
    }
    scaling.pivot = [...pivot]; scaling.factorX = horizontal; scaling.factorY = vertical; scaling.preview = preview; scaling.error = error;
    return true;
  }

  getScalePreview(): GeometryFeatureCollection | null {
    return this.scaling?.preview ? { type: 'FeatureCollection', features: this.scaling.preview.map(copyFeature) } : null;
  }

  finishScale(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.scaling?.preview) return null;
    const changes = prepareTransaction({ update: this.scaling.preview }, this.features);
    const changed = this.commit('transaction', changes);
    this.cancel();
    return changed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  /** Begin a selection-wide simplification review in the Mercator plane. */
  simplifySelection(): boolean {
    if (this.simplification) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before simplification.');
    if (this.selectionLocked()) return false;
    const originals = this.getSelection();
    const center = transformPivot(originals);
    if (!center) return false;
    this.simplification = { originals, tolerance: 0, preview: originals, error: null };
    this.kind = 'LineString';
    return true;
  }

  /** Absolute tolerance from the entry baseline, never an incremental transformation. */
  setSimplificationTolerance(tolerance: number): boolean {
    validateSimplificationTolerance(tolerance);
    if (!this.simplification || this.simplification.tolerance === tolerance) return false;
    const simplification = this.simplification;
    let preview: GeometryFeature[] | null = null;
    let error: SimplificationError | null = null;
    try {
      const candidates = simplifyFeatures(simplification.originals, tolerance);
      // Use the same validation/normalization as commit; previews contain exact commit geometry.
      const changes = prepareTransaction({ update: candidates }, this.features);
      const updated = new Map(changes.map((change) => [change.after!.id, change.after!]));
      preview = candidates.map((feature) => updated.get(feature.id) ?? this.features.get(feature.id)!);
    } catch (cause) {
      if (cause instanceof GeoJSONImportError) error = 'simplification-invalid-result';
      else throw cause;
    }
    simplification.tolerance = tolerance; simplification.preview = preview; simplification.error = error;
    return true;
  }

  getSimplificationPreview(): GeometryFeatureCollection | null {
    return this.simplification?.preview ? { type: 'FeatureCollection', features: this.simplification.preview.map(copyFeature) } : null;
  }

  finishSimplification(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.simplification?.preview) return null;
    const changes = prepareTransaction({ update: this.simplification.preview }, this.features);
    const changed = this.commit('transaction', changes);
    this.cancel();
    return changed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  /** Begin a selection-wide offsetting review in the Mercator plane. */
  offsetSelection(): boolean {
    if (this.offsetting) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before offsetting.');
    if (this.selectionLocked()) return false;
    const originals = this.getSelection();
    if (!canOffsetFeatures(originals)) return false;
    this.offsetting = { originals, distance: 0, preview: originals, error: null };
    this.kind = 'LineString';
    return true;
  }

  /** Absolute distance from the entry baseline, never an incremental transformation. */
  setOffsetDistance(distance: number): boolean {
    validateOffsetDistance(distance);
    if (!this.offsetting || this.offsetting.distance === distance) return false;
    const offsetting = this.offsetting;
    let preview: GeometryFeature[] | null = null;
    let error: OffsetError | null = null;
    try {
      const result = offsetFeatures(offsetting.originals, distance);
      if (!result.preview) {
        offsetting.distance = distance; offsetting.preview = null; offsetting.error = result.error;
        return true;
      }
      const candidates = result.preview;
      // Use the same validation/normalization as commit; previews contain exact commit geometry.
      const changes = prepareTransaction({ update: candidates }, this.features);
      const updated = new Map(changes.map((change) => [change.after!.id, change.after!]));
      preview = candidates.map((feature) => updated.get(feature.id) ?? this.features.get(feature.id)!);
    } catch (cause) {
      if (cause instanceof GeoJSONImportError) error = 'offset-invalid-result';
      else throw cause;
    }
    offsetting.distance = distance; offsetting.preview = preview; offsetting.error = error;
    return true;
  }

  getOffsetPreview(): GeometryFeatureCollection | null {
    return this.offsetting?.preview ? { type: 'FeatureCollection', features: this.offsetting.preview.map(copyFeature) } : null;
  }

  finishOffset(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.offsetting?.preview) return null;
    const changes = prepareTransaction({ update: this.offsetting.preview }, this.features);
    const changed = this.commit('transaction', changes);
    this.cancel();
    return changed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  /** Begin a selection-wide buffering review in the Mercator plane. */
  bufferSelection(distance = 10): boolean {
    validateBufferDistance(distance);
    if (this.buffering) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before buffering.');
    if (this.selectionLocked()) return false;
    const originals = this.getSelection();
    const center = transformPivot(originals);
    if (!center) return false;
    this.buffering = { originals, distance: 0, preview: null, error: null };
    this.kind = 'LineString';
    this.setBufferDistance(distance);
    return true;
  }

  /** Absolute distance from the entry baseline, never an incremental transformation. */
  setBufferDistance(distance: number): boolean {
    validateBufferDistance(distance);
    if (!this.buffering || this.buffering.distance === distance) return false;
    const buffering = this.buffering;
    let preview: GeometryFeature[] | null = null;
    let error: BufferError | null = null;
    try {
      const result = bufferFeatures(buffering.originals, distance);
      if (!result.preview) {
        buffering.distance = distance; buffering.preview = null; buffering.error = result.error;
        return true;
      }
      const candidates = result.preview;
      // Use the same validation/normalization as commit; previews contain exact commit geometry.
      const changes = prepareTransaction({ update: candidates }, this.features);
      const updated = new Map(changes.map((change) => [change.after!.id, change.after!]));
      preview = candidates.map((feature) => updated.get(feature.id) ?? this.features.get(feature.id)!);
    } catch (cause) {
      if (cause instanceof GeoJSONImportError) error = 'buffer-invalid-result';
      else throw cause;
    }
    buffering.distance = distance; buffering.preview = preview; buffering.error = error;
    return true;
  }

  getBufferPreview(): GeometryFeatureCollection | null {
    return this.buffering?.preview ? { type: 'FeatureCollection', features: this.buffering.preview.map(copyFeature) } : null;
  }

  finishBuffer(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.buffering?.preview) return null;
    const changes = prepareTransaction({ update: this.buffering.preview }, this.features);
    const changed = this.commit('transaction', changes);
    this.cancel();
    return changed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  /** Edit the one complete common boundary of exactly two adjacent simple polygons. */
  editSharedBoundary(): boolean {
    if (this.sharedBoundary) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before editing a shared boundary.');
    if (this.selectionLocked()) return false;
    const selected = this.getSelection();
    if (selected.length !== 2) return false;
    const first = selected[0]!; const second = selected[1]!;
    if (first.geometry.type !== 'Polygon' || second.geometry.type !== 'Polygon') return false;
    const context = prepareSharedBoundary(first.geometry, second.geometry);
    if (!context) return false;
    this.sharedBoundary = context; this.kind = 'LineString';
    this.draft = context.path.map((point) => [...point]);
    this.selectedVertexIndices = [];
    this.validateSharedBoundary(); return true;
  }

  getSharedBoundaryPreview(): SharedBoundaryPreview | null {
    if (!this.sharedBoundaryPreview) return null;
    return { type: 'FeatureCollection', features: this.sharedBoundaryPreview.features.map(copyFeature) as SharedBoundaryPreview['features'] };
  }

  finishSharedBoundary(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.sharedBoundary || !this.sharedBoundaryPreview) return null;
    // Revalidate before preparing the complete batch. Invalid output never partially commits.
    this.validateSharedBoundary();
    if (!this.sharedBoundaryPreview) return null;
    const changes = prepareTransaction({ update: this.sharedBoundaryPreview.features }, this.features);
    const changed = this.commit('transaction', changes);
    this.cancel();
    return changed ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  private validateSharedBoundary(): void {
    const result = updateSharedBoundary(this.sharedBoundary!, this.draft);
    this.sharedBoundaryError = result.error;
    const ids = [...this.selectedFeatureIds];
    this.sharedBoundaryPreview = result.geometries ? { type: 'FeatureCollection', features: result.geometries.map((geometry, i) =>
      withGeometry(this.features.get(ids[i]!)!, geometry)) as SharedBoundaryPreview['features'] } : null;
    this.validationError = null;
  }

  getLinkedFeatureIds(ids: readonly FeatureId[]): FeatureId[] { return [...new Set(ids.flatMap(id => [id, ...this.pins.related(id)]))]; }

  getPinnedEditIds(): FeatureId[] { return this.editingId === null ? [] : this.pins.related(this.editingId); }

  getPinnedVertices(): PinnedVertexGroup[] { return this.pins.snapshot(this.features); }

  private sharedVertexGroups(): VertexAddress[][] {
    const groups = new Map<string, VertexAddress[]>();
    for (const feature of this.getSelection()) for (const vertex of featureVertices(feature)) {
      const key = vertex.coordinate.join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(vertex);
    }
    return [...groups.values()].filter(vertices => new Set(vertices.map(vertex => vertex.featureId)).size > 1);
  }

  canPinSharedVertices(): boolean {
    return this.kind === null && !this.selectionLocked() && this.sharedVertexGroups().length > 0
      && ![...this.selectedFeatureIds].some(id => this.pins.related(id).some(member => this.isFeatureLocked(member)));
  }

  /** Link every exactly coincident position in the selected features in one transaction. */
  pinSharedVertices(): TransactionEvent | null { return this.pinGroups(this.sharedVertexGroups(), {}); }

  /** Explicitly join vertices; existing groups are merged, including unselected participants. */
  pinVertices(vertices: readonly VertexAddress[], options: PinVerticesOptions = {}): TransactionEvent | null {
    if (!Array.isArray(vertices) || vertices.length < 2) throw new RangeError('Pin at least two vertices from different features.');
    return this.pinGroups([vertices], options);
  }

  private pinGroups(groups: readonly (readonly VertexAddress[])[], options: PinVerticesOptions): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before pinning vertices.');
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'tolerance')) throw new TypeError('Expected pin options with an optional tolerance.');
    const tolerance = options.tolerance === undefined ? 0 : options.tolerance;
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new RangeError('Pin tolerance must be between 0 and 1 longitude/latitude degrees.');
    const updates = new Map<FeatureId, GeometryFeature>();
    for (const targets of groups) {
      const points = targets.map(target => {
        const feature = this.features.get(target?.featureId);
        const vertex = feature && featureVertices(feature).find(vertex => vertex.index === target.index
          && vertex.partIndex === (target.partIndex === undefined ? 0 : target.partIndex) && vertex.ringIndex === (target.ringIndex === undefined ? 0 : target.ringIndex));
        if (!vertex) throw new RangeError('Vertex address is outside the feature.');
        return vertex;
      });
      if (new Set(points.map(point => point.featureId)).size < 2) throw new RangeError('A pin must connect different features.');
      const coordinate = points[0]!.coordinate;
      const merging = new Set<string>();
      for (const point of points) for (const pin of this.pins.pins(point.featureId)) {
        if (samePosition(point.coordinate, pin.coordinate)) merging.add(pin.id);
      }
      const participants = new Map<FeatureId, Coordinate[]>(points.map(point => [point.featureId, []]));
      for (const point of points) participants.get(point.featureId)!.push(point.coordinate);
      for (const id of merging) for (const [featureId, coordinate] of this.pins.group(id)) {
        if (!participants.has(featureId)) participants.set(featureId, []);
        participants.get(featureId)!.push(coordinate);
      }
      let id = merging.values().next().value;
      if (id === undefined) { do { id = `map-master-pin-${Date.now().toString(36)}-${++this.pinSequence}-${Math.random().toString(36).slice(2)}`; } while (this.pins.has(id)); }
      for (const [featureId, coordinates] of participants) {
        if (this.isFeatureLocked(featureId)) throw new VertexPinError('pin-locked', `Feature ${JSON.stringify(featureId)} is locked.`);
        if (coordinates.some(point => Math.hypot(point[0] - coordinate[0], point[1] - coordinate[1]) > tolerance)) throw new RangeError('Vertices are outside the pin tolerance.');
        const feature = updates.get(featureId) ?? this.features.get(featureId)!;
        const geometry = mapGeometry(feature.geometry, point => coordinates.some(source => samePosition(source, point)) ? [...coordinate] : [...point]);
        const pins = readVertexPins(feature).filter(pin => !merging.has(pin.id));
        updates.set(featureId, withVertexPins(withGeometry(feature, geometry), [...pins, { id, coordinate }]));
      }
    }
    return this.applyTransaction({ update: [...updates.values()] });
  }

  /** Remove the complete groups touched by these addresses; other groups remain. */
  unpinVertices(vertices: readonly VertexAddress[]): TransactionEvent | null {
    if (!isArray(vertices)) throw new TypeError('Expected an array of vertex addresses.');
    const ids = new Set<string>();
    for (const target of vertices) {
      const feature = this.features.get(target?.featureId);
      const vertex = feature && featureVertices(feature).find(vertex => vertex.index === target.index
        && vertex.partIndex === (target.partIndex === undefined ? 0 : target.partIndex) && vertex.ringIndex === (target.ringIndex === undefined ? 0 : target.ringIndex));
      if (!vertex) throw new RangeError('Vertex address is outside the feature.');
      for (const pin of this.pins.pins(vertex.featureId)) if (samePosition(pin.coordinate, vertex.coordinate)) ids.add(pin.id);
    }
    return this.unpinGroups(ids);
  }

  unpinSelection(): TransactionEvent | null {
    return this.unpinGroups(new Set([...this.selectedFeatureIds].flatMap(id => this.pins.pins(id).map(pin => pin.id))));
  }

  canUnpinSelection(): boolean {
    const ids = [...this.selectedFeatureIds];
    return this.kind === null && ids.some(id => this.pins.pins(id).length > 0)
      && !ids.some(id => this.pins.related(id).some(member => this.isFeatureLocked(member)));
  }

  private unpinGroups(ids: ReadonlySet<string>): TransactionEvent | null {
    const updates = [...new Set([...ids].flatMap(id => [...this.pins.group(id)].map(([featureId]) => featureId)))].map(id => {
      if (this.isFeatureLocked(id)) throw new VertexPinError('pin-locked', `Feature ${JSON.stringify(id)} is locked.`);
      const feature = this.features.get(id)!;
      return withVertexPins(feature, readVertexPins(feature).filter(pin => !ids.has(pin.id)));
    });
    return this.applyTransaction({ update: updates });
  }

  isPinnedEdit(): boolean { return this.editingId !== null && this.pins.pins(this.editingId).length > 0; }
  getPinnedPreview(): GeometryFeatureCollection | null { return this.pinnedPreview ? { type: 'FeatureCollection', features: this.pinnedPreview.features.map(copyFeature) } : null; }

  finishPinnedEdit(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.isPinnedEdit() || !this.state.canFinish) return null;
    this.validatePinnedEdit();
    if (!this.pinnedPreview) return null;
    const changes = prepareTransaction({ update: this.pinnedPreview.features }, this.features);
    const changed = this.commit('transaction', changes);
    this.cancel();
    return changed ? { changes: changes.map(change => ({ before: change.before ? copyFeature(change.before) : null, after: change.after ? copyFeature(change.after) : null })) } : null;
  }

  private validatePinnedEdit(): void {
    this.pinningError = null; this.pinnedPreview = null;
    if (!this.isPinnedEdit() || this.validationError !== null) return;
    try {
      const destinations = new Map<string, Coordinate>();
      for (const [id, indices] of this.editPinIndices) destinations.set(id, this.draft[indices[0]!]!);
      const original = this.features.get(this.editingId!)!;
      const primary = moveVertexPins(withGeometry(original, this.draftGeometry(true)), destinations,
        { partIndex: this.activePartIndex!, ringIndex: this.activeRingIndex ?? 0 }, readVertexPins(original));
      if (this.textMarker) primary.properties = { ...primary.properties, mapMasterText: textMarkerOptions(this.textMarker) };
      const candidates = [primary, ...this.pins.related(original.id).filter(id => id !== original.id)
        .map(id => moveVertexPins(this.features.get(id)!, destinations))];
      const changes = prepareTransaction({ update: candidates }, this.features);
      if (changes.some(change => this.isFeatureLocked(change.before!.id))) throw new VertexPinError('pin-locked', 'A linked feature is locked. Unpin or unlock it before moving this vertex.');
      this.pins.validate(changes);
      const normalized = new Map(changes.map(change => [change.after!.id, change.after!]));
      this.pinnedPreview = { type: 'FeatureCollection', features: candidates.map(feature => normalized.get(feature.id) ?? this.features.get(feature.id)!) };
    } catch (error) {
      this.pinningError = error instanceof VertexPinError ? error.code : 'pin-invalid-result';
    }
  }

  editSelected(ringIndex = 0, partIndex = 0): boolean {
    if (this.editingId !== null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before editing.');
    if (this.selectionLocked()) return false;
    const feature = this.getSelected();
    if (!feature) return false;
    const part = this.partAt(feature.geometry, partIndex);
    const ringCount = part.type === 'Polygon' ? part.coordinates.length : 1;
    if (!Number.isInteger(ringIndex) || ringIndex < 0 || ringIndex >= ringCount) throw new RangeError('Ring index is outside the component.');
    this.activeRingIndex = part.type === 'Polygon' ? ringIndex : null;
    this.activePartIndex = partIndex;
    this.editingId = feature.id;
    this.textMarker = isTextMarker(feature) ? textMarkerOptions(feature.properties.mapMasterText) : null;
    this.kind = part.type;
    this.draft = part.type === 'Polygon' ? openRing(part.coordinates[ringIndex]!) : part.type === 'Point' ? [part.coordinates] : part.coordinates;
    this.editPinIndices = new Map(this.pins.pins(feature.id).flatMap(pin => {
      const indices = this.draft.flatMap((point, index) => samePosition(point, pin.coordinate) ? [index] : []);
      return indices.length ? [[pin.id, indices] as const] : [];
    }));
    this.selectedVertexIndices = [];
    this.validateEdit();
    return true;
  }

  private partAt(geometry: Geometry, index: number): GeometryPart {
    const parts = geometryParts(geometry);
    if (!Number.isInteger(index) || index < 0 || index >= parts.length) throw new RangeError('Part index is outside the geometry.');
    return parts[index]!;
  }

  /** Draft ring plus preserved rings of the active component; independent open snapshots. */
  getDraftRings(): Coordinate[][] | null {
    if (this.template || this.kind !== 'Polygon' || this.unionActive || this.differenceActive || this.intersectionActive) return null;
    const id = this.editingId ?? this.holeId;
    const original = id === null ? undefined : this.features.get(id);
    if (!original) return [this.getDraft()];
    const part = this.partAt(original.geometry, this.activePartIndex!);
    if (part.type !== 'Polygon') throw new Error('Expected a polygon component.');
    const rings = part.coordinates.map(openRing);
    rings[this.activeRingIndex!] = this.getDraft();
    return rings;
  }

  /** Untouched components remain visible while the committed feature is hidden. */
  getInactiveParts(): GeometryPart[] {
    const id = this.editingId ?? this.holeId ?? this.partId;
    if (id === null) return [];
    return geometryParts(this.features.get(id)!.geometry)
      .filter((_, index) => index !== this.activePartIndex)
      .map((part): GeometryPart => part.type === 'Point' ? { type: part.type, coordinates: [...part.coordinates] } : part.type === 'LineString'
        ? { type: part.type, coordinates: part.coordinates.map((point) => [...point]) }
        : { type: part.type, coordinates: part.coordinates.map((ring) => ring.map((point) => [...point])) });
  }

  private draftGeometry(normalize = false): Geometry {
    const rings = this.getDraftRings();
    const part: GeometryPart = this.kind === 'Point' ? { type: 'Point', coordinates: [...this.draft[0]!] } : rings
      ? { type: 'Polygon', coordinates: normalize ? rings.map((ring, index) => closePolygon(ring, index > 0)) : rings }
      : { type: 'LineString', coordinates: this.getDraft() };
    const id = this.editingId ?? this.holeId ?? this.partId;
    return id === null ? part : replacePart(this.features.get(id)!.geometry, this.activePartIndex!, part);
  }

  private validateDraftPolygon(): ValidationError | null {
    const geometry = this.draftGeometry();
    if (geometry.type === 'MultiPolygon') return validateMultiPolygon(geometry.coordinates);
    if (geometry.type === 'Polygon') return validatePolygonRings(geometry.coordinates);
    throw new Error('Expected a polygon draft.');
  }

  /** Draw one new interior ring in the selected polygon component. */
  drawHole(partIndex = 0): boolean {
    if (this.holeId !== null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before drawing a hole.');
    if (this.selectionLocked()) return false;
    const feature = this.getSelected();
    if (!feature || feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return false;
    const part = this.partAt(feature.geometry, partIndex);
    if (part.type !== 'Polygon') return false;
    this.holeId = feature.id;
    this.activePartIndex = partIndex;
    this.activeRingIndex = part.coordinates.length;
    this.kind = 'Polygon'; this.draft = []; this.validationError = 'too-few-vertices';
    return true;
  }

  /** Preview filling the first hole of the sole selected polygon or multipolygon. */
  removeHole(): boolean {
    if (this.holeRemoval) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before removing a hole.');
    if (this.selectionLocked()) return false;
    const feature = this.getSelected();
    if (!feature) return false;
    const partIndex = geometryParts(feature.geometry).findIndex((part) => part.type === 'Polygon' && part.coordinates.length > 1);
    if (partIndex < 0) return false;
    const preview = this.holeRemovalCandidate(1, partIndex);
    this.kind = 'Polygon';
    this.holeRemoval = preview.feature;
    this.validationError = preview.error;
    this.activePartIndex = partIndex;
    this.activeRingIndex = 1;
    return true;
  }

  /** Choose another original interior ring; invalid indices leave the preview untouched. */
  setHoleToRemove(ringIndex: number, partIndex = 0): boolean {
    if (!this.holeRemoval) throw new Error('Start removing a hole before choosing a ring.');
    const preview = this.holeRemovalCandidate(ringIndex, partIndex);
    if (this.activeRingIndex === ringIndex && this.activePartIndex === partIndex) return false;
    this.holeRemoval = preview.feature;
    this.validationError = preview.error;
    this.activePartIndex = partIndex;
    this.activeRingIndex = ringIndex;
    return true;
  }

  private holeRemovalCandidate(ringIndex: number, partIndex: number): { feature: GeometryFeature; error: ValidationError | null } {
    const feature = this.getSelected()!;
    const part = this.partAt(feature.geometry, partIndex);
    if (part.type !== 'Polygon' || !Number.isInteger(ringIndex) || ringIndex < 1 || ringIndex >= part.coordinates.length) {
      throw new RangeError('Expected an existing interior ring index.');
    }
    part.coordinates.splice(ringIndex, 1);
    const error = feature.geometry.type === 'MultiPolygon' ? validateMultiPolygon(feature.geometry.coordinates)
      : validatePolygonRings(part.coordinates);
    return { feature, error };
  }

  /** Independent filled geometry, or null outside a valid removal preview. */
  getHoleRemovalPreview(): GeometryFeature | null {
    return this.holeRemoval && this.validationError === null ? copyFeature(this.holeRemoval) : null;
  }

  /** Commit one validated update while preserving feature identity and collection order. */
  finishHoleRemoval(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.holeRemoval || this.validationError !== null) return null;
    const changes = prepareTransaction({ update: [this.holeRemoval] }, this.features);
    this.commit('transaction', changes);
    this.cancel();
    return { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) };
  }

  /** Remove an interior ring as one atomic update. The exterior cannot be removed. */
  deleteHole(ringIndex: number, partIndex = 0): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before deleting a hole.');
    if (this.selectionLocked()) return null;
    const feature = this.getSelected();
    if (!feature || feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') return null;
    const part = this.partAt(feature.geometry, partIndex);
    if (part.type !== 'Polygon') return null;
    if (!Number.isInteger(ringIndex) || ringIndex < 1 || ringIndex >= part.coordinates.length) {
      throw new RangeError('Expected an existing interior ring index.');
    }
    part.coordinates.splice(ringIndex, 1);
    // Validation can reject filling a hole containing another polygon component.
    return this.applyTransaction({ update: [feature] });
  }

  /** Draw one new component for the selected line or polygon; it becomes multipart on finish. */
  drawPart(): boolean {
    if (this.partId !== null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before drawing a part.');
    if (this.selectionLocked()) return false;
    const feature = this.getSelected();
    if (!feature || feature.geometry.type === 'Point') return false;
    const polygonal = isPolygonal(feature.geometry);
    this.partId = feature.id;
    this.activePartIndex = geometryParts(feature.geometry).length;
    this.activeRingIndex = polygonal ? 0 : null;
    this.kind = polygonal ? 'Polygon' : 'LineString'; this.draft = []; this.validationError = 'too-few-vertices';
    return true;
  }

  /** Draw a polygon that cuts the selection, or every unlocked feature when nothing is selected. */
  drawCut(): boolean {
    if (this.cutting) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before cutting.');
    if (this.selectionLocked()) return false;
    this.cutting = { targets: this.selectedFeatureIds.size ? [...this.selectedFeatureIds] : null };
    this.kind = 'Polygon'; this.draft = []; this.validationError = 'too-few-vertices';
    return true;
  }

  /**
   * Remove the drawn polygon from every target as one transaction. Features left without
   * geometry are deleted. Returns null, leaving the tool, when nothing overlaps.
   */
  finishCut(): TransactionEvent | null {
    if (!this.state.canFinish) return null;
    if (!this.cutting || this.validationError !== null) return null;
    const cutter = this.getDraft();
    const update: GeometryFeature[] = [];
    const remove: FeatureId[] = [];
    for (const id of this.cutting.targets ?? this.features.keys()) {
      const feature = this.features.get(id);
      if (!feature || this.isFeatureLocked(id)) continue;
      const result = cutGeometry(feature.geometry, cutter);
      if (result.error) return null;
      if (result.geometry === null) remove.push(id);
      else if (JSON.stringify(result.geometry) !== JSON.stringify(feature.geometry)) {
        update.push(withGeometry({ id, properties: copyProperties(feature.properties) }, result.geometry));
      }
    }
    let changes: FeatureChange[];
    try { changes = prepareTransaction({ update, delete: remove }, this.features); } catch { return null; }
    this.commit('transaction', changes);
    this.cancel();
    return changes.length ? { changes: changes.map(({ before, after }) => ({ before: before ? copyFeature(before) : null, after: after ? copyFeature(after) : null })) } : null;
  }

  /** Split every selected multipart feature into one feature per part; the first part keeps the ID. */
  explodeSelection(): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before separating parts.');
    if (this.selectionLocked()) return null;
    const update: GeometryFeature[] = [];
    const create: GeometryFeature[] = [];
    const selection: FeatureId[] = [];
    const reserved = new Set<FeatureId>();
    for (const feature of this.getSelection()) {
      selection.push(feature.id);
      if (feature.geometry.type !== 'MultiPolygon' && feature.geometry.type !== 'MultiLineString') continue;
      const [first, ...rest] = geometryParts(feature.geometry);
      update.push(withGeometry(feature, first!));
      for (const part of rest) {
        const id = this.allocateId(reserved);
        reserved.add(id);
        create.push(withGeometry({ id, properties: copyProperties(feature.properties) }, part));
        selection.push(id);
      }
    }
    if (!update.length) return null;
    const event = this.applyTransaction({ update, create });
    if (event) this.selectedFeatureIds = new Set(selection);
    return event;
  }

  /**
   * Combine the selected polygons, or the selected lines, into one multipart feature that keeps
   * the first feature's ID and properties. Overlapping polygons cannot be combined; use union.
   */
  combineSelection(): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before combining.');
    if (this.selectionLocked()) return null;
    const selected = this.getSelection();
    if (selected.length < 2) return null;
    const polygonal = selected.every((feature) => isPolygonal(feature.geometry));
    if (!polygonal && !selected.every((feature) => isLineal(feature.geometry))) return null;
    const [first, ...rest] = selected;
    let geometry: Geometry;
    if (polygonal) {
      const parts = selected.flatMap((feature) => geometryParts(feature.geometry).flatMap((part) => part.type === 'Polygon' ? [part.coordinates] : []));
      if (validateMultiPolygon(parts)) return null;
      geometry = { type: 'MultiPolygon', coordinates: parts };
    } else {
      geometry = { type: 'MultiLineString', coordinates: selected.flatMap((feature) => geometryParts(feature.geometry).flatMap((part) => part.type === 'LineString' ? [part.coordinates] : [])) };
    }
    const event = this.applyTransaction({ update: [withGeometry(first!, geometry)], delete: rest.map((feature) => feature.id) });
    if (event) this.selectedFeatureIds = new Set([first!.id]);
    return event;
  }

  selectVertex(index: number | null): boolean { return this.selectVertices(index === null ? [] : [index]); }

  selectVertices(indices: readonly number[]): boolean {
    this.assertEditing();
    if (!isArray(indices)) throw new TypeError('Expected an array of vertex indices.');
    for (const index of indices) this.assertIndex(index);
    const next = [...new Set(indices)];
    if (next.length === this.selectedVertexIndices.length && next.every((index, i) => index === this.selectedVertexIndices[i])) return false;
    this.selectedVertexIndices = next;
    return true;
  }

  moveVertex(index: number, coordinate: Coordinate): boolean { return this.moveVertices([{ index, coordinate }]); }

  /** Validate the complete batch before changing coordinates or selection; validate topology once. */
  moveVertices(updates: readonly VertexUpdate[]): boolean {
    this.assertEditing();
    if (!isArray(updates)) throw new TypeError('Expected an array of vertex updates.');
    const indices = new Set<number>();
    for (const update of updates) {
      if (!update || !isArray(update.coordinate) || update.coordinate.length !== 2) throw new TypeError('Expected a vertex index and 2D coordinate.');
      this.assertIndex(update.index); this.validatePosition(update.coordinate);
      if (indices.has(update.index)) throw new RangeError('Duplicate vertex update index.');
      indices.add(update.index);
    }
    if (updates.length === 0 || this.sharedBoundary && (indices.has(0) || indices.has(this.draft.length - 1))) return false;
    const expanded = new Map(updates.map(update => [update.index, update.coordinate]));
    for (const linked of this.editPinIndices.values()) {
      const moved = linked.filter(index => expanded.has(index));
      if (!moved.length) continue;
      const coordinate = expanded.get(moved[0]!)!;
      if (moved.some(index => !samePosition(expanded.get(index)!, coordinate))) throw new VertexPinError('pin-conflict', 'A pin cannot move to two coordinates at once.');
      for (const index of linked) expanded.set(index, coordinate);
    }
    const changed = [...expanded].some(([index, coordinate]) => !samePosition(this.draft[index]!, coordinate));
    const selected = this.selectVertices([...indices]);
    if (!changed) return selected;
    for (const [index, coordinate] of expanded) this.draft[index] = [coordinate[0], coordinate[1]];
    this.validateEdit(); return true;
  }

  translateSelectedVertices(delta: Coordinate): boolean {
    this.assertEditing();
    if (!Array.isArray(delta) || delta.length !== 2 || !delta.every(Number.isFinite)) throw new TypeError('Expected two finite degree offsets.');
    return this.moveVertices(this.selectedVertexIndices.map(index => ({ index, coordinate: [this.draft[index]![0] + delta[0], this.draft[index]![1] + delta[1]] })));
  }

  /** Insert before index; index === vertexCount appends (also on a polygon's closing edge). */
  insertVertex(index: number, coordinate: Coordinate): boolean {
    this.assertEditing(); this.assertIndex(index, true); this.validatePosition(coordinate);
    if (this.sharedBoundary && (index === 0 || index === this.draft.length)) throw new RangeError('Insert between the fixed boundary endpoints.');
    if (this.kind === 'Point') return false;
    for (const [id, indices] of this.editPinIndices) this.editPinIndices.set(id, indices.map(existing => existing >= index ? existing + 1 : existing));
    this.draft.splice(index, 0, [...coordinate]);
    this.selectedVertexIndices = [index];
    this.validateEdit();
    return true;
  }

  removeVertex(index: number): boolean { return this.removeVertices([index]); }

  removeSelectedVertices(): boolean { return this.removeVertices(this.selectedVertexIndices); }

  private removeVertices(indices: readonly number[]): boolean {
    this.assertEditing();
    for (const index of indices) this.assertIndex(index);
    const removed = new Set(indices);
    if (!removed.size || this.kind === 'Point' || this.draft.length - removed.size < (this.kind === 'Polygon' ? 3 : 2)
      || this.sharedBoundary && (removed.has(0) || removed.has(this.draft.length - 1))) return false;
    if ([...this.editPinIndices.values()].some(linked => linked.some(index => removed.has(index)))) return false;
    for (const [id, linked] of this.editPinIndices) this.editPinIndices.set(id, linked.map(index => index - [...removed].filter(removed => removed < index).length));
    this.draft = this.draft.filter((_, index) => !removed.has(index));
    this.selectedVertexIndices = [];
    this.validateEdit(); return true;
  }

  private assertEditing(): void {
    if (this.editingId === null && !this.sharedBoundary) throw new Error('Start editing a selected feature first.');
  }

  private assertIndex(index: number, insertion = false): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.draft.length + Number(insertion)) {
      throw new RangeError('Vertex index is outside the editing draft.');
    }
  }

  private validatePosition([lng, lat]: Coordinate): void {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new RangeError('Expected finite longitude/latitude within [-180, 180] / [-90, 90].');
    }
  }

  private validateEdit(): void {
    if (this.sharedBoundary) { this.validateSharedBoundary(); return; }
    if (this.kind === 'Polygon') {
      // Edit drafts never contain a closing copy: coinciding first/last corners are invalid.
      this.validationError = new Set(this.draft.map(([x, y]) => `${x},${y}`)).size !== this.draft.length
        ? 'duplicate-vertex' : this.validateDraftPolygon();
    } else {
      this.validationError = this.draft.some((point, index) => index > 0 && samePosition(point, this.draft[index - 1]!))
        ? 'duplicate-vertex' : null;
    }
    this.validatePinnedEdit();
  }
}
