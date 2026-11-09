import { expect, it, vi } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { CommittedSourceUpload, sourceDiff } from '../src/maplibre/source-upload.js';
const collection = (ids: (string | number)[]): FeatureCollection => ({ type: 'FeatureCollection', features: ids.map(id => ({ type: 'Feature', id, properties: { __geo_editor_id: JSON.stringify(id) }, geometry: { type: 'Point', coordinates: [0, 0] } })) });

it('sends only one changed feature from 20,000 and preserves typed IDs', () => {
  const before = collection(Array.from({ length: 20_000 }, (_, i) => i));
  const after = structuredClone(before);
  after.features[100]!.geometry = { type: 'Point', coordinates: [1, 2] };
  const { next } = sourceDiff(new Map(), before), { diff } = sourceDiff(next, after);
  expect(diff.remove).toEqual(['100']); expect(diff.add).toEqual([after.features[100]]);
  const typed = sourceDiff(sourceDiff(new Map(), collection([7, '7'])).next, collection(['7']));
  expect(typed.diff.remove).toEqual(['7']); expect(typed.diff.add).toEqual([]);
});

it('serializes MapLibre updates, skips no-ops and resets after worker errors', async () => {
  const setData = vi.fn(async () => {});
  const updateData = vi.fn(async () => {});
  const upload = new CommittedSourceUpload({ setData, updateData, getData: () => Promise.resolve(collection([])) } as ConstructorParameters<typeof CommittedSourceUpload>[0]);
  await Promise.all([upload.upload(collection([1])), upload.upload(collection([1, 2]))]);
  expect(setData).toHaveBeenCalledTimes(1); expect(updateData).toHaveBeenCalledTimes(1);
  await upload.upload(collection([1, 2])); expect(updateData).toHaveBeenCalledTimes(1);
  updateData.mockRejectedValueOnce(new Error('worker failed'));
  await expect(upload.upload(collection([2]))).rejects.toThrow('worker failed');
  await upload.upload(collection([3])); expect(setData).toHaveBeenCalledTimes(2);
});

it('keeps Mapbox on full setData despite its incompatible updateData method', async () => {
  const source = { setData: vi.fn((): unknown => source), updateData: vi.fn(), getData: vi.fn() };
  const upload = new CommittedSourceUpload(source);
  await upload.upload(collection([1])); await upload.upload(collection([2]));
  expect(source.setData).toHaveBeenCalledTimes(2); expect(source.updateData).not.toHaveBeenCalled();
});
