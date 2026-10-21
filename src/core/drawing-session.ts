import { closePolygon, samePosition, validatePolygon } from './polygon.js';
import type {
  Coordinate, EditorState, GeometryFeatureCollection, GeometryFeature, GeometryType, ValidationError,
} from './types.js';

function copyFeature(feature: GeometryFeature): GeometryFeature {
  const copy = ([lng, lat]: Coordinate): Coordinate => [lng, lat];
  const common = { type: 'Feature' as const, id: feature.id, properties: {} };
  return feature.geometry.type === 'LineString'
    ? { ...common, geometry: { type: 'LineString', coordinates: feature.geometry.coordinates.map(copy) } }
    : { ...common, geometry: { type: 'Polygon', coordinates: feature.geometry.coordinates.map((ring) => ring.map(copy)) } };
}

/** Internal editing state. No browser, map, or rendering dependencies. */
export class DrawingSession {
  private kind: GeometryType | null = null;
  private draft: Coordinate[] = [];
  private features: GeometryFeature[] = [];
  private validationError: ValidationError | null = null;

  constructor(private readonly createId: () => string) {}

  get state(): EditorState {
    return {
      mode: this.kind === null ? 'idle' : this.kind === 'LineString' ? 'draw-line' : 'draw-polygon',
      vertexCount: this.draft.length,
      featureCount: this.features.length,
      canFinish: this.kind !== null && this.validationError === null,
      validationError: this.validationError,
    };
  }

  start(kind: GeometryType): boolean {
    if (kind !== 'LineString' && kind !== 'Polygon') throw new TypeError('Unsupported geometry type.');
    if (this.kind === kind) return false;
    if (this.kind !== null) throw new Error('Finish or cancel the current drawing before changing tools.');
    this.kind = kind;
    this.validationError = 'too-few-vertices';
    return true;
  }

  add([lng, lat]: Coordinate): boolean {
    if (this.kind === null) return false;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new RangeError('Expected finite longitude/latitude within [-180, 180] / [-90, 90].');
    }
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
    const common = { type: 'Feature' as const, id: this.createId(), properties: {} };
    const feature: GeometryFeature = this.kind === 'Polygon'
      ? { ...common, geometry: { type: 'Polygon', coordinates: [closePolygon(this.draft)] } }
      : { ...common, geometry: { type: 'LineString', coordinates: this.draft } };
    this.features.push(feature);
    this.draft = [];
    this.kind = null;
    this.validationError = null;
    return copyFeature(feature);
  }

  cancel(): boolean {
    if (this.kind === null) return false;
    this.kind = null;
    this.draft = [];
    this.validationError = null;
    return true;
  }

  exportGeoJSON(): GeometryFeatureCollection {
    return { type: 'FeatureCollection', features: this.features.map(copyFeature) };
  }
}
