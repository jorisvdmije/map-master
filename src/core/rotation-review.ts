import { rotateFeatures, rotationPivot } from './rotation.js';
import { prepareTransaction } from './transaction.js';
import { GeoJSONImportError } from './geojson-import.js';
import type { Coordinate, FeatureId, GeometryFeature, RotationError } from './types.js';

/** Rotation candidate preparation owns no history or authoritative data. */
export class RotationReview {
  angle = 0;
  preview: GeometryFeature[] | null;
  error: RotationError | null = null;
  constructor(readonly originals: GeometryFeature[], public pivot: Coordinate) { this.preview = originals; }

  update(angle: number, pivot: Coordinate, features: ReadonlyMap<FeatureId, GeometryFeature>): void {
    let preview: GeometryFeature[] | null = null, error: RotationError | null = null;
    try {
      const candidates = rotateFeatures(this.originals, angle, pivot);
      if (!rotationPivot(candidates)) throw new RangeError('Rotation creates an unsupported world-spanning selection.');
      const changes = prepareTransaction({ update: candidates }, features);
      const updated = new Map(changes.map(change => [change.after!.id, change.after!]));
      preview = candidates.map(feature => updated.get(feature.id) ?? features.get(feature.id)!);
    } catch (cause) {
      if (cause instanceof GeoJSONImportError) error = 'rotation-invalid-result';
      else if (cause instanceof RangeError) error = 'rotation-out-of-bounds';
      else throw cause;
    }
    this.pivot = [...pivot]; this.angle = angle; this.preview = preview; this.error = error;
  }
}
