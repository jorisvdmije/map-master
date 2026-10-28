import type { FeatureId } from './types.js';

/** A changed transaction cannot overwrite or delete a locked feature. */
export class FeatureLockedError extends Error {
  constructor(readonly featureId: FeatureId) {
    super(`Feature ${JSON.stringify(featureId)} is locked.`);
    this.name = 'FeatureLockedError';
  }
}

export function lockedFeatureIds(input: readonly FeatureId[]): Set<FeatureId> {
  if (!Array.isArray(input)) throw new TypeError('lockedFeatureIds must be an array.');
  const ids = new Set<FeatureId>();
  for (const id of input) {
    if (typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id))) {
      throw new TypeError('Locked feature IDs must be strings or finite numbers.');
    }
    ids.add(id);
  }
  return ids;
}

export function sameLocks(a: ReadonlySet<FeatureId>, b: ReadonlySet<FeatureId>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}
