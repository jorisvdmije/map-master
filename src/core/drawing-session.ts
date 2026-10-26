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
import { translateFeatures } from './translation.js';
import { prepareTransaction } from './transaction.js';
import { EditHistory, type HistoryEntry } from './history.js';
import { GeoJSONImportError, copyProperties, prepareImport } from './geojson-import.js';
import { closePolygon, openRing, samePosition, validatePolygonRings, validateMultiPolygon } from './polygon.js';
import type {
  Coordinate, OffsetError, BufferError, SimplificationError, ScaleError, RotationError, SharedBoundaryPreview, SharedBoundaryError, TraceTarget, TraceSide, ReshapePreview, ReshapeError, ReshapeSide, IntersectionPreview, IntersectionError, DifferencePreview, DifferenceError, UnionPreview, UnionError, SplitPreview, SplitError, FeatureTransaction, TransactionEvent, FeatureChange, HistoryAction, FeatureId, EditorState, HistoryEvent, GeometryFeatureCollection, GeometryFeature, DrawGeometryType, ValidationError,
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
  private activePartIndex: number | null = null;
  private activeRingIndex: number | null = null;
  private reshapeId: FeatureId | null = null;
  private reshapePreview: ReshapePreview | null = null;
  private reshapeError: ReshapeError | null = null;
  private reshapeSide: ReshapeSide = 'shorter';
  private splitId: FeatureId | null = null;
  private splitPreview: SplitPreview | null = null;
  private splitError: SplitError | null = null;
  private kind: DrawGeometryType | null = null;
  private draft: Coordinate[] = [];
  private drawingSteps: number[] = [];
  private readonly features = new Map<FeatureId, GeometryFeature>();
  private selectedFeatureIds = new Set<FeatureId>();
  private validationError: ValidationError | null = null;
  private editingId: FeatureId | null = null;
  private selectedVertexIndex: number | null = null;
  private dataRevision = 0;

  private readonly history: EditHistory;
  private locks = new Set<FeatureId>();
  private historyLocks = new WeakMap<HistoryEntry, boolean>();

  constructor(private readonly createId: () => string, historyLimit = 100, lockedIds: readonly FeatureId[] = []) {
    this.history = new EditHistory(historyLimit);
    this.locks = lockedFeatureIds(lockedIds);
  }

  getLockedFeatureIds(): FeatureId[] { return [...this.locks]; }
  isFeatureLocked(id: FeatureId): boolean { return this.locks.has(id); }

  /** Replace host policy; cancel a draft only when one of its mutation targets is locked. */
  setLockedFeatureIds(ids: readonly FeatureId[]): boolean {
    const next = lockedFeatureIds(ids);
    if (sameLocks(this.locks, next)) return false;
    this.locks = next;
    this.historyLocks = new WeakMap();
    if (this.kind !== null && this.selectionLocked(this.differenceActive)) this.cancel();
    return true;
  }

  private selectionLocked(firstOnly = false): boolean {
    if (!this.locks.size) return false;
    for (const id of this.selectedFeatureIds) {
      if (this.locks.has(id)) return true;
      if (firstOnly) break;
    }
    return false;
  }

  private canReplay(direction: HistoryEvent['direction']): boolean {
    const entry = this.history.peek(direction);
    if (!entry) return false;
    if (!this.locks.size) return true;
    let blocked = this.historyLocks.get(entry);
    if (blocked === undefined) {
      blocked = entry.changes.some(({ before, after }) => this.locks.has((before ?? after)!.id));
      this.historyLocks.set(entry, blocked);
    }
    return !blocked;
  }

  private get selectedFeatureId(): FeatureId | null {
    return this.selectedFeatureIds.size === 1 ? this.selectedFeatureIds.values().next().value! : null;
  }

  get state(): EditorState {
    return {
      mode: this.offsetting ? 'offset-lines' : this.buffering ? 'buffer-features' : this.simplification ? 'simplify-features' : this.scaling ? 'scale-features' : this.rotation ? 'rotate-features' : this.sharedBoundary ? 'edit-shared-boundary' : this.reshapeId !== null ? 'reshape-polygon' : this.intersectionActive ? 'intersection-polygons' : this.differenceActive ? 'difference-polygons' : this.unionActive ? 'union-polygons' : this.holeId !== null ? 'draw-hole' : this.splitId !== null ? 'split-polygon' : this.kind === null ? 'idle' : this.editingId !== null
        ? this.kind === 'Point' ? 'edit-point' : this.kind === 'LineString' ? 'edit-line' : 'edit-polygon'
        : this.kind === 'Point' ? 'draw-point' : this.kind === 'LineString' ? 'draw-line' : 'draw-polygon',
      vertexCount: this.draft.length,
      featureCount: this.features.size,
      selectedFeatureId: this.selectedFeatureId,
      selectedFeatureIds: [...this.selectedFeatureIds],
      selectedVertexIndex: this.selectedVertexIndex,
      activeRingIndex: this.activeRingIndex,
      activePartIndex: this.activePartIndex,
      dataRevision: this.dataRevision,
      canFinish: this.offsetting ? this.offsetting.preview !== null : this.buffering ? this.buffering.preview !== null : this.simplification ? this.simplification.preview !== null : this.scaling ? this.scaling.preview !== null : this.rotation ? this.rotation.preview !== null : this.sharedBoundary ? this.sharedBoundaryPreview !== null : this.reshapeId !== null ? this.reshapePreview !== null : this.intersectionActive ? this.intersectionPreview !== null : this.differenceActive ? this.differencePreview !== null : this.unionActive ? this.unionPreview !== null : this.splitId !== null ? this.splitPreview !== null : this.kind !== null && this.validationError === null,
      canUndo: this.kind === null && this.canReplay('undo'),
      canRedo: this.kind === null && this.canReplay('redo'),
      validationError: this.validationError,
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

  start(kind: DrawGeometryType): boolean {
    if (kind !== 'Point' && kind !== 'LineString' && kind !== 'Polygon') throw new TypeError('Unsupported geometry type.');
    if (!this.offsetting && !this.buffering && !this.simplification && !this.scaling && !this.rotation && !this.sharedBoundary && this.kind === kind && this.editingId === null && this.splitId === null && this.reshapeId === null && this.holeId === null && !this.unionActive && !this.differenceActive && !this.intersectionActive) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before changing tools.');
    this.kind = kind;
    this.selectedFeatureIds.clear();
    this.validationError = 'too-few-vertices';
    return true;
  }

  add([lng, lat]: Coordinate): boolean {
    if (this.offsetting || this.buffering || this.simplification || this.scaling || this.rotation || this.sharedBoundary || this.kind === null || this.editingId !== null || this.unionActive || this.differenceActive || this.intersectionActive) return false;
    this.validatePosition([lng, lat]);
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
    return mode === 'draw-line' || mode === 'draw-polygon' || mode === 'draw-hole';
  }

  getBoundaryTrace(target: TraceTarget, from: Coordinate, to: Coordinate, side: TraceSide = 'shorter'): Coordinate[] | null {
    const feature = this.features.get(target.featureId);
    if (!feature) return null;
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

  getDraft(): Coordinate[] {
    return this.draft.map(([lng, lat]) => [lng, lat]);
  }

  finish(): GeometryFeature | null {
    if (this.offsetting || this.buffering || this.simplification || this.scaling || this.rotation || this.sharedBoundary || this.reshapeId !== null || this.intersectionActive || this.differenceActive || this.unionActive || this.splitId !== null || !this.state.canFinish) return null;
    const targetId = this.editingId ?? this.holeId;
    const original = targetId === null ? undefined : this.features.get(targetId);
    const common = { type: 'Feature' as const, id: original?.id ?? this.allocateId(), properties: original ? copyProperties(original.properties) : {} };
    const feature = withGeometry(common, this.draftGeometry(true));
    // No-op saves exit editing without emitting a data change or replacing the feature.
    if (!original || JSON.stringify(original.geometry) !== JSON.stringify(feature.geometry)) {
      this.commit(original ? 'edit' : 'create', [{ before: original ?? null, after: feature }]);
    }
    this.draft = [];
    this.drawingSteps = [];
    this.kind = null;
    this.validationError = null;
    this.editingId = null;
    this.holeId = null;
    this.activeRingIndex = null;
    this.activePartIndex = null;
    this.selectedVertexIndex = null;
    return copyFeature(feature);
  }

  cancel(): boolean {
    if (this.kind === null) return false;
    this.offsetting = null;
    this.buffering = null;
    this.simplification = null;
    this.scaling = null;
    this.rotation = null;
    this.sharedBoundary = null; this.sharedBoundaryPreview = null; this.sharedBoundaryError = null;
    this.intersectionActive = false; this.intersectionPreview = null; this.intersectionError = null;
    this.differenceActive = false; this.differencePreview = null; this.differenceError = null;
    this.unionActive = false; this.unionPreview = null; this.unionError = null;
    this.reshapeId = null; this.reshapePreview = null; this.reshapeError = null; this.reshapeSide = 'shorter';
    this.splitId = null; this.splitPreview = null; this.splitError = null;
    this.kind = null;
    this.draft = [];
    this.drawingSteps = [];
    this.validationError = null;
    this.editingId = null;
    this.holeId = null;
    this.activeRingIndex = null;
    this.activePartIndex = null;
    this.selectedVertexIndex = null;
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
    this.reshapePreview = result.preview; this.reshapeError = result.error;
  }

  finishReshape(): TransactionEvent | null {
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

  getSplitPreview(): SplitPreview | null {
    if (!this.splitPreview) return null;
    return { retained: { type: 'Polygon', coordinates: this.splitPreview.retained.coordinates.map((ring) => ring.map((p) => [...p])) },
      created: { type: 'Polygon', coordinates: this.splitPreview.created.coordinates.map((ring) => ring.map((p) => [...p])) } };
  }

  private validateSplit(): void {
    const feature = this.features.get(this.splitId!)!;
    if (feature.geometry.type !== 'Polygon') throw new Error('Expected a polygon split target.');
    const result = splitPolygonRings(feature.geometry.coordinates, this.draft);
    this.splitPreview = result.preview; this.splitError = result.error;
  }

  finishSplit(): TransactionEvent | null {
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
  importGeoJSON(input: unknown): GeometryFeatureCollection {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before importing.');
    const features = prepareImport(input, (id) => this.features.has(id), this.createId);
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
    for (const id of this.selectedFeatureIds) if (!this.features.has(id)) this.selectedFeatureIds.delete(id);
    this.dataRevision++;
  }

  private allocateId(reserved?: ReadonlySet<FeatureId>): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = this.createId();
      if (!this.features.has(id) && !reserved?.has(id)) return id;
    }
    throw new Error('Could not allocate a unique feature ID.');
  }

  exportGeoJSON(): GeometryFeatureCollection {
    return { type: 'FeatureCollection', features: Array.from(this.features.values(), copyFeature) };
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
    const previous = this.selectedFeatureIds.values();
    if (next.size === this.selectedFeatureIds.size && [...next].every((id) => id === previous.next().value)) return false;
    this.selectedFeatureIds = next;
    return true;
  }

  toggleSelection(id: FeatureId): boolean {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before selecting.');
    if (!this.features.has(id)) throw new RangeError(`Unknown feature ID: ${id}`);
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
    return this.applyTransaction({ update: translateFeatures(this.getSelection(), delta) });
  }

  /** Copy the selection in acquisition order, optionally offset in degrees.
   * Reserve every new ID before committing; a failed batch changes nothing.
   */
  duplicateSelection(delta: Coordinate = [0, 0]): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before duplicating.');
    const copies = translateFeatures(this.getSelection(), delta);
    const reserved = new Set<FeatureId>();
    for (const feature of copies) {
      feature.id = this.allocateId(reserved);
      reserved.add(feature.id);
    }
    const event = this.applyTransaction({ create: copies });
    if (event) this.selectedFeatureIds = reserved;
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
    this.selectedVertexIndex = null;
    this.validateSharedBoundary(); return true;
  }

  getSharedBoundaryPreview(): SharedBoundaryPreview | null {
    if (!this.sharedBoundaryPreview) return null;
    return { type: 'FeatureCollection', features: this.sharedBoundaryPreview.features.map(copyFeature) as SharedBoundaryPreview['features'] };
  }

  finishSharedBoundary(): TransactionEvent | null {
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
    this.kind = part.type;
    this.draft = part.type === 'Polygon' ? openRing(part.coordinates[ringIndex]!) : part.type === 'Point' ? [part.coordinates] : part.coordinates;
    this.selectedVertexIndex = null;
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
    if (this.kind !== 'Polygon' || this.unionActive || this.differenceActive || this.intersectionActive) return null;
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
    const id = this.editingId ?? this.holeId;
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
    const id = this.editingId ?? this.holeId;
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

  selectVertex(index: number | null): boolean {
    this.assertEditing();
    if (index !== null) this.assertIndex(index);
    if (index === this.selectedVertexIndex) return false;
    this.selectedVertexIndex = index;
    return true;
  }

  moveVertex(index: number, coordinate: Coordinate): boolean {
    this.assertEditing(); this.assertIndex(index); this.validatePosition(coordinate);
    if (this.sharedBoundary && (index === 0 || index === this.draft.length - 1)) return false;
    const changed = !samePosition(this.draft[index]!, coordinate);
    const selected = this.selectVertex(index);
    if (!changed) return selected;
    this.draft[index] = [...coordinate];
    this.validateEdit();
    return true;
  }

  /** Insert before index; index === vertexCount appends (also on a polygon's closing edge). */
  insertVertex(index: number, coordinate: Coordinate): boolean {
    this.assertEditing(); this.assertIndex(index, true); this.validatePosition(coordinate);
    if (this.sharedBoundary && (index === 0 || index === this.draft.length)) throw new RangeError('Insert between the fixed boundary endpoints.');
    if (this.kind === 'Point') return false;
    this.draft.splice(index, 0, [...coordinate]);
    this.selectedVertexIndex = index;
    this.validateEdit();
    return true;
  }

  removeVertex(index: number): boolean {
    this.assertEditing(); this.assertIndex(index);
    if (this.sharedBoundary && (index === 0 || index === this.draft.length - 1)) return false;
    if (this.draft.length <= (this.kind === 'Polygon' ? 3 : 2)) return false;
    this.draft.splice(index, 1);
    this.selectedVertexIndex = null;
    this.validateEdit();
    return true;
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
  }
}
