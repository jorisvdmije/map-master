import { splitPolygon } from './split-polygon.js';
import { translateFeatures } from './translation.js';
import { prepareTransaction } from './transaction.js';
import { EditHistory, type HistoryEntry } from './history.js';
import { copyProperties, prepareImport } from './geojson-import.js';
import { closePolygon, openRing, samePosition, validatePolygon } from './polygon.js';
import type {
  Coordinate, SplitPreview, SplitError, FeatureTransaction, TransactionEvent, FeatureChange, HistoryAction, FeatureId, EditorState, HistoryEvent, GeometryFeatureCollection, GeometryFeature, GeometryType, ValidationError,
} from './types.js';

function copyFeature(feature: GeometryFeature): GeometryFeature {
  const copy = ([lng, lat]: Coordinate): Coordinate => [lng, lat];
  const common = { type: 'Feature' as const, id: feature.id, properties: copyProperties(feature.properties) };
  return feature.geometry.type === 'LineString'
    ? { ...common, geometry: { type: 'LineString', coordinates: feature.geometry.coordinates.map(copy) } }
    : { ...common, geometry: { type: 'Polygon', coordinates: feature.geometry.coordinates.map((ring) => ring.map(copy)) } };
}

/** Internal editing state. No browser, map, or rendering dependencies. */
export class DrawingSession {
  private splitId: FeatureId | null = null;
  private splitPreview: SplitPreview | null = null;
  private splitError: SplitError | null = null;
  private kind: GeometryType | null = null;
  private draft: Coordinate[] = [];
  private readonly features = new Map<FeatureId, GeometryFeature>();
  private selectedFeatureIds = new Set<FeatureId>();
  private validationError: ValidationError | null = null;
  private editingId: FeatureId | null = null;
  private selectedVertexIndex: number | null = null;
  private dataRevision = 0;

  private readonly history: EditHistory;

  constructor(private readonly createId: () => string, historyLimit = 100) {
    this.history = new EditHistory(historyLimit);
  }

  private get selectedFeatureId(): FeatureId | null {
    return this.selectedFeatureIds.size === 1 ? this.selectedFeatureIds.values().next().value! : null;
  }

  get state(): EditorState {
    return {
      mode: this.splitId !== null ? 'split-polygon' : this.kind === null ? 'idle' : this.editingId !== null
        ? this.kind === 'LineString' ? 'edit-line' : 'edit-polygon'
        : this.kind === 'LineString' ? 'draw-line' : 'draw-polygon',
      vertexCount: this.draft.length,
      featureCount: this.features.size,
      selectedFeatureId: this.selectedFeatureId,
      selectedFeatureIds: [...this.selectedFeatureIds],
      selectedVertexIndex: this.selectedVertexIndex,
      dataRevision: this.dataRevision,
      canFinish: this.splitId !== null ? this.splitPreview !== null : this.kind !== null && this.validationError === null,
      canUndo: this.kind === null && this.history.canUndo,
      canRedo: this.kind === null && this.history.canRedo,
      validationError: this.validationError,
      splitError: this.splitError,
    };
  }

  start(kind: GeometryType): boolean {
    if (kind !== 'LineString' && kind !== 'Polygon') throw new TypeError('Unsupported geometry type.');
    if (this.kind === kind && this.editingId === null && this.splitId === null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before changing tools.');
    this.kind = kind;
    this.selectedFeatureIds.clear();
    this.validationError = 'too-few-vertices';
    return true;
  }

  add([lng, lat]: Coordinate): boolean {
    if (this.kind === null || this.editingId !== null) return false;
    this.validatePosition([lng, lat]);
    const last = this.draft.at(-1);
    if (last && samePosition(last, [lng, lat])) return false;
    this.draft.push([lng, lat]);
    if (this.splitId !== null) { this.validateSplit(); return true; }
    // Cache validity on clicks. Pointer movement and state reads never run topology checks.
    this.validationError = this.kind === 'Polygon' ? validatePolygon(this.draft)
      : this.draft.length < 2 ? 'too-few-vertices' : null;
    return true;
  }

  getDraft(): Coordinate[] {
    return this.draft.map(([lng, lat]) => [lng, lat]);
  }

  finish(): GeometryFeature | null {
    if (this.splitId !== null || !this.state.canFinish) return null;
    const original = this.editingId === null ? undefined : this.features.get(this.editingId);
    const common = { type: 'Feature' as const, id: original?.id ?? this.allocateId(), properties: original ? copyProperties(original.properties) : {} };
    const feature: GeometryFeature = this.kind === 'Polygon'
      ? { ...common, geometry: { type: 'Polygon', coordinates: [closePolygon(this.draft)] } }
      : { ...common, geometry: { type: 'LineString', coordinates: this.draft } };
    // No-op saves exit editing without emitting a data change or replacing the feature.
    if (!original || JSON.stringify(original.geometry) !== JSON.stringify(feature.geometry)) {
      this.commit(original ? 'edit' : 'create', [{ before: original ?? null, after: feature }]);
    }
    this.draft = [];
    this.kind = null;
    this.validationError = null;
    this.editingId = null;
    this.selectedVertexIndex = null;
    return copyFeature(feature);
  }

  cancel(): boolean {
    if (this.kind === null) return false;
    this.splitId = null; this.splitPreview = null; this.splitError = null;
    this.kind = null;
    this.draft = [];
    this.validationError = null;
    this.editingId = null;
    this.selectedVertexIndex = null;
    return true;
  }

  splitSelected(): boolean {
    if (this.splitId !== null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before splitting.');
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
    const result = splitPolygon(feature.geometry.coordinates[0]!, this.draft);
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

  private allocateId(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = this.createId();
      if (!this.features.has(id)) return id;
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
    const feature = this.getSelected();
    if (!feature) return null;
    this.commit('delete', [{ before: this.features.get(feature.id)!, after: null }]);
    return feature;
  }

  /** Delete the complete selection through one transaction/history action. */
  deleteSelection(): TransactionEvent | null {
    return this.applyTransaction({ delete: [...this.selectedFeatureIds] });
  }

  /** Apply the same degree offset to every selected vertex as one validated transaction. */
  translateSelection(delta: Coordinate): TransactionEvent | null {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before translating.');
    return this.applyTransaction({ update: translateFeatures(this.getSelection(), delta) });
  }

  editSelected(): boolean {
    if (this.editingId !== null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before editing.');
    const feature = this.getSelected();
    if (!feature) return false;
    this.editingId = feature.id;
    this.kind = feature.geometry.type;
    this.draft = feature.geometry.type === 'Polygon'
      ? openRing(feature.geometry.coordinates[0]!) : feature.geometry.coordinates;
    this.selectedVertexIndex = null;
    this.validateEdit();
    return true;
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
    this.draft.splice(index, 0, [...coordinate]);
    this.selectedVertexIndex = index;
    this.validateEdit();
    return true;
  }

  removeVertex(index: number): boolean {
    this.assertEditing(); this.assertIndex(index);
    if (this.draft.length <= (this.kind === 'Polygon' ? 3 : 2)) return false;
    this.draft.splice(index, 1);
    this.selectedVertexIndex = null;
    this.validateEdit();
    return true;
  }

  private assertEditing(): void {
    if (this.editingId === null) throw new Error('Start editing a selected feature first.');
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
    if (this.kind === 'Polygon') {
      // Edit drafts never contain a closing copy: coinciding first/last corners are invalid.
      this.validationError = new Set(this.draft.map(([x, y]) => `${x},${y}`)).size !== this.draft.length
        ? 'duplicate-vertex' : validatePolygon(this.draft);
    } else {
      this.validationError = this.draft.some((point, index) => index > 0 && samePosition(point, this.draft[index - 1]!))
        ? 'duplicate-vertex' : null;
    }
  }
}
