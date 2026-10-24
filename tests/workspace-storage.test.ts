import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, WorkspaceStore } from '../examples/workspace/storage.js';
import type { WorkspaceStorage } from '../examples/workspace/storage.js';
import type { GeometryFeatureCollection } from '../src/index.js';

const empty: GeometryFeatureCollection = { type: 'FeatureCollection', features: [] };
const sample: GeometryFeatureCollection = { type: 'FeatureCollection', features: [{
  type: 'Feature', id: 0, properties: { name: 'Route', nested: { keep: true } },
  geometry: { type: 'LineString', coordinates: [[4, 52], [5, 53]] },
}] };
function memory(initial: string | null = null): WorkspaceStorage {
  const values = new Map(initial === null ? [] : [[STORAGE_KEY, initial]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('application workspace persistence', () => {
  it('round trips a versioned workspace including typed IDs and nested properties', () => {
    const storage = memory(); const store = new WorkspaceStore(storage);
    expect(store.read()).toBeNull(); store.accept(); store.save(sample);
    const restored = new WorkspaceStore(storage);
    expect(restored.read()).toEqual({ data: sample });
    expect(restored.canSave).toBe(false);
    restored.accept(); expect(restored.canSave).toBe(true);
  });

  it.each(['{broken', '{"format":"geo-area-workspace","version":2,"data":{}}'])('protects an unreadable saved copy', (raw) => {
    const storage = memory(raw); const store = new WorkspaceStore(storage);
    expect(() => store.read()).toThrow();
    expect(store.recovery).toBe(raw);
    expect(() => store.save(empty)).toThrow('unreadable');
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    store.discard(); store.save(sample);
    expect(new WorkspaceStore(storage).read()).toEqual({ data: sample });
  });

  it('keeps invalid geometry blocked until the application validates it', () => {
    const raw = JSON.stringify({ format: 'geo-area-workspace', version: 1, data: null });
    const storage = memory(raw); const store = new WorkspaceStore(storage);
    expect(store.read()).toEqual({ data: null });
    expect(() => store.save(empty)).toThrow('unreadable');
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('rejects stale saves and discards after another tab changes or removes the saved copy', () => {
    const storage = memory(); const first = new WorkspaceStore(storage); const second = new WorkspaceStore(storage);
    first.read(); first.accept(); second.read(); second.accept(); first.save(sample);
    expect(() => second.save(empty)).toThrow('Another tab');
    expect(() => second.discard()).toThrow('Another tab');
    expect(new WorkspaceStore(storage).read()).toEqual({ data: sample });
    storage.removeItem(STORAGE_KEY);
    expect(() => first.save(sample)).toThrow('Another tab');
  });

  it('does not mark a failed storage write as saved and allows retry', () => {
    const storage = memory(); const store = new WorkspaceStore(storage);
    store.read(); store.accept(); store.save(sample);
    const saved = storage.getItem(STORAGE_KEY);
    const set = storage.setItem.bind(storage);
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => store.save(empty)).toThrow('Quota exceeded');
    expect(store.recovery).toBe(saved);
    storage.setItem = set; store.save(empty);
    expect(new WorkspaceStore(storage).read()).toEqual({ data: empty });
  });

  it('blocks storage access failures without inventing an empty baseline', () => {
    const store = new WorkspaceStore({ ...memory(), getItem: () => { throw new Error('Access denied'); } });
    expect(() => store.read()).toThrow('Access denied');
    expect(store.canSave).toBe(false);
    expect(() => store.save(empty)).toThrow('unreadable');
  });

  it('rejects oversized saved input and output without overwriting data', () => {
    const large: GeometryFeatureCollection = structuredClone(sample);
    large.features[0]!.properties = { text: 'x'.repeat(5 * 1024 * 1024) };
    const storage = memory(); const store = new WorkspaceStore(storage);
    store.read(); store.accept();
    expect(() => store.save(large)).toThrow('5 MB');
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    storage.setItem(STORAGE_KEY, 'x'.repeat(5 * 1024 * 1024 + 1));
    expect(() => store.read()).toThrow('5 MB');
    expect(store.canSave).toBe(false);
  });
});
