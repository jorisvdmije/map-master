import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';

function fixture(): DrawingSession {
  let id = 0;
  const session = new DrawingSession(() => `feature-${++id}`);
  session.start('LineString'); session.add([0, 0]); session.add([2, 0]); session.finish();
  session.start('Polygon'); session.add([0, 0]); session.add([2, 0]); session.add([1, 2]); session.finish();
  return session;
}

describe('single feature selection', () => {
  it('selects and replaces one feature without changing geometry, properties, IDs, or order', () => {
    const session = fixture();
    const saved = session.exportGeoJSON();
    expect(session.getSelected()).toBeNull();
    expect(session.select('feature-1')).toBe(true);
    expect(session.state).toMatchObject({ mode: 'idle', selectedFeatureId: 'feature-1', featureCount: 2 });
    expect(session.getSelected()).toEqual(saved.features[0]);
    expect(session.select('feature-1')).toBe(false);
    expect(session.select('feature-2')).toBe(true);
    expect(session.getSelected()).toEqual(saved.features[1]);
    expect(session.exportGeoJSON()).toEqual(saved);
    expect(session.select(null)).toBe(true);
    expect(session.select(null)).toBe(false);
    expect(session.state.selectedFeatureId).toBeNull();
    expect(session.getSelected()).toBeNull();
  });

  it('rejects unknown IDs atomically', () => {
    const session = fixture();
    session.select('feature-1');
    const before = session.state;
    expect(() => session.select('missing')).toThrow(RangeError);
    expect(session.state).toEqual(before);
    expect(session.getSelected()?.id).toBe('feature-1');
  });

  it('returns independent nested snapshots and state', () => {
    const session = fixture();
    session.select('feature-2');
    const selected = session.getSelected();
    if (selected?.geometry.type !== 'Polygon') throw new Error('Expected a polygon');
    selected.geometry.coordinates[0]![0]![0] = 99;
    selected.id = 'changed';
    session.state.selectedFeatureId = 'changed';
    expect(session.getSelected()).toEqual(session.exportGeoJSON().features[1]);
    expect(session.state.selectedFeatureId).toBe('feature-2');
  });

  it('clears selection on draw and protects the draft from programmatic selection', () => {
    const session = fixture();
    session.select('feature-1');
    const saved = session.exportGeoJSON();
    session.start('Polygon'); session.add([1, 1]);
    expect(session.getSelected()).toBeNull();
    expect(() => session.select('feature-2')).toThrow('Finish or cancel');
    expect(() => session.select(null)).toThrow('Finish or cancel');
    expect(session.getDraft()).toEqual([[1, 1]]);
    session.cancel();
    expect(session.getSelected()).toBeNull();
    expect(session.exportGeoJSON()).toEqual(saved);
  });
});
