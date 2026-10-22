import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';

function fixture(): DrawingSession {
  let id = 0;
  const session = new DrawingSession(() => `feature-${++id}`);
  session.start('LineString'); session.add([0, 0]); session.add([2, 0]); session.finish();
  session.start('Polygon'); session.add([0, 0]); session.add([2, 0]); session.add([1, 2]); session.finish();
  session.start('LineString'); session.add([3, 0]); session.add([4, 0]); session.finish();
  return session;
}

describe('committed deletion', () => {
  it.each(['feature-1', 'feature-2'])('deletes %s once, clears selection, and preserves other geometry and order', (id) => {
    const session = fixture();
    const saved = session.exportGeoJSON();
    session.select(id);
    expect(session.deleteSelected()).toEqual(saved.features.find((feature) => feature.id === id));
    expect(session.state).toMatchObject({ mode: 'idle', selectedFeatureId: null, featureCount: 2 });
    expect(session.getSelected()).toBeNull();
    expect(session.hasFeature(id)).toBe(false);
    expect(session.deleteSelected()).toBeNull();
    expect(session.exportGeoJSON().features).toEqual(saved.features.filter((feature) => feature.id !== id));
    expect(() => session.select(id)).toThrow(RangeError);
    expect(session.state.selectedFeatureId).toBeNull();
  });

  it('does nothing without a selection, including on an empty editor', () => {
    const session = fixture();
    const saved = session.exportGeoJSON();
    expect(session.deleteSelected()).toBeNull();
    expect(session.exportGeoJSON()).toEqual(saved);
    expect(new DrawingSession(() => 'unused').deleteSelected()).toBeNull();
  });

  it('protects both the draft and committed geometry during drawing', () => {
    const session = fixture();
    const saved = session.exportGeoJSON();
    session.start('Polygon'); session.add([3, 3]); session.add([4, 4]);
    const state = session.state;
    const draft = session.getDraft();
    expect(() => session.deleteSelected()).toThrow('Finish or cancel');
    expect(session.state).toEqual(state);
    expect(session.getDraft()).toEqual(draft);
    expect(session.exportGeoJSON()).toEqual(saved);
  });

  it('keeps returned snapshots independent and can draw again after deleting all features', () => {
    const session = fixture();
    const saved = session.exportGeoJSON();
    session.select('feature-2');
    const selected = session.getSelected();
    const removed = session.deleteSelected();
    if (removed?.geometry.type !== 'Polygon') throw new Error('Expected a polygon');
    removed.geometry.coordinates[0]![0]![0] = 99;
    removed.id = 'changed';
    expect(selected).toEqual(saved.features[1]);
    expect(session.exportGeoJSON().features).toEqual([saved.features[0], saved.features[2]]);
    for (const id of ['feature-1', 'feature-3']) { session.select(id); session.deleteSelected(); }
    expect(session.exportGeoJSON()).toEqual({ type: 'FeatureCollection', features: [] });
    session.start('LineString'); session.add([5, 5]); session.add([6, 6]);
    expect(session.finish()?.id).toBe('feature-4');
    expect(session.state.featureCount).toBe(1);
  });
});
