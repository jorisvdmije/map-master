import type { Coordinate, EditorState, LineCollection, LineFeature } from './types.js';

function copyFeature(feature: LineFeature): LineFeature {
  return {
    type: 'Feature',
    id: feature.id,
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: feature.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
    },
  };
}

/** Internal editing state. No browser, map, or rendering dependencies. */
export class LineSession {
  private active = false;
  private draft: Coordinate[] = [];
  private features: LineFeature[] = [];

  constructor(private readonly createId: () => string) {}

  get state(): EditorState {
    return {
      mode: this.active ? 'draw-line' : 'idle',
      vertexCount: this.draft.length,
      featureCount: this.features.length,
      canFinish: this.active && this.draft.length >= 2,
    };
  }

  start(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  add([lng, lat]: Coordinate): boolean {
    if (!this.active) return false;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new RangeError('Expected finite longitude/latitude within [-180, 180] / [-90, 90].');
    }
    const last = this.draft.at(-1);
    if (last?.[0] === lng && last[1] === lat) return false;
    this.draft.push([lng, lat]);
    return true;
  }

  getDraft(): Coordinate[] {
    return this.draft.map(([lng, lat]) => [lng, lat]);
  }

  finish(): LineFeature | null {
    if (!this.state.canFinish) return null;
    const feature: LineFeature = {
      type: 'Feature',
      id: this.createId(),
      properties: {},
      geometry: { type: 'LineString', coordinates: this.draft },
    };
    this.features.push(feature);
    this.draft = [];
    this.active = false;
    return copyFeature(feature);
  }

  cancel(): boolean {
    if (!this.active) return false;
    this.active = false;
    this.draft = [];
    return true;
  }

  exportGeoJSON(): LineCollection {
    return { type: 'FeatureCollection', features: this.features.map(copyFeature) };
  }
}
