import { copyProperties, prepareImport } from './geojson-import.js';
import { closePolygon, openRing, samePosition, validatePolygon } from './polygon.js';
import type {
  Coordinate, FeatureId, EditorState, GeometryFeatureCollection, GeometryFeature, GeometryType, ValidationError,
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
  private kind: GeometryType | null = null;
  private draft: Coordinate[] = [];
  private readonly features = new Map<FeatureId, GeometryFeature>();
  private selectedFeatureId: FeatureId | null = null;
  private validationError: ValidationError | null = null;
  private editingId: FeatureId | null = null;
  private selectedVertexIndex: number | null = null;
  private dataRevision = 0;

  constructor(private readonly createId: () => string) {}

  get state(): EditorState {
    return {
      mode: this.kind === null ? 'idle' : this.editingId !== null
        ? this.kind === 'LineString' ? 'edit-line' : 'edit-polygon'
        : this.kind === 'LineString' ? 'draw-line' : 'draw-polygon',
      vertexCount: this.draft.length,
      featureCount: this.features.size,
      selectedFeatureId: this.selectedFeatureId,
      selectedVertexIndex: this.selectedVertexIndex,
      dataRevision: this.dataRevision,
      canFinish: this.kind !== null && this.validationError === null,
      validationError: this.validationError,
    };
  }

  start(kind: GeometryType): boolean {
    if (kind !== 'LineString' && kind !== 'Polygon') throw new TypeError('Unsupported geometry type.');
    if (this.kind === kind && this.editingId === null) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before changing tools.');
    this.kind = kind;
    this.selectedFeatureId = null;
    this.validationError = 'too-few-vertices';
    return true;
  }

  add([lng, lat]: Coordinate): boolean {
    if (this.kind === null || this.editingId !== null) return false;
    this.validatePosition([lng, lat]);
    const last = this.draft.at(-1);
    if (last && samePosition(last, [lng, lat])) return false;
    this.draft.push([lng, lat]);
    // Cache validity on clicks. Pointer movement and state reads never run topology checks.
    this.validationError = this.kind === 'Polygon' ? validatePolygon(this.draft)
      : this.draft.length < 2 ? 'too-few-vertices' : null;
    return true;
  }

  getDraft(): Coordinate[] {
    return this.draft.map(([lng, lat]) => [lng, lat]);
  }

  finish(): GeometryFeature | null {
    if (!this.state.canFinish) return null;
    const original = this.editingId === null ? undefined : this.features.get(this.editingId);
    const common = { type: 'Feature' as const, id: original?.id ?? this.allocateId(), properties: original ? copyProperties(original.properties) : {} };
    const feature: GeometryFeature = this.kind === 'Polygon'
      ? { ...common, geometry: { type: 'Polygon', coordinates: [closePolygon(this.draft)] } }
      : { ...common, geometry: { type: 'LineString', coordinates: this.draft } };
    // No-op saves exit editing without emitting a data change or replacing the feature.
    if (!original || JSON.stringify(original.geometry) !== JSON.stringify(feature.geometry)) {
      this.features.set(feature.id, feature);
      this.dataRevision++;
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
    this.kind = null;
    this.draft = [];
    this.validationError = null;
    this.editingId = null;
    this.selectedVertexIndex = null;
    return true;
  }

  /** Append a fully validated batch; existing data and selection survive any failure. */
  importGeoJSON(input: unknown): GeometryFeatureCollection {
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before importing.');
    const features = prepareImport(input, (id) => this.features.has(id), this.createId);
    for (const feature of features) this.features.set(feature.id, feature);
    if (features.length > 0) this.dataRevision++;
    return { type: 'FeatureCollection', features: features.map(copyFeature) };
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
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before selecting.');
    if (id !== null && !this.features.has(id)) throw new RangeError(`Unknown feature ID: ${id}`);
    if (id === this.selectedFeatureId) return false;
    this.selectedFeatureId = id;
    return true;
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
    const feature = this.getSelected();
    if (!feature) return null;
    this.features.delete(feature.id);
    this.dataRevision++;
    this.selectedFeatureId = null;
    return feature;
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
