import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { expect, it } from 'vitest';
import { GeometryEditor } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';
setWorkerUrl(workerUrl);
it('places an unboxed length on the actual line, keeps it upright, follows rotation and restores the badge', async () => {
  const host = document.createElement('div'); host.style.cssText = 'width:700px;height:500px;position:relative'; document.body.append(host);
  const map = new Map({ container: host, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] }, center: [4.9, 52.37], zoom: 14, fadeDuration: 0 });
  await new Promise<void>(resolve => { map.once('load', () => resolve()); });
  const editor = new GeometryEditor(map, { measurements: { enabled: true, locale: 'nl', lineStyle: 'along-line' } });
  try {
    const a = map.unproject([150, 320]).toArray(), b = map.unproject([550, 180]).toArray();
    editor.importGeoJSON({ type: 'Feature', id: 'line', properties: {}, geometry: { type: 'LineString', coordinates: [a, b] } }); editor.select('line');
    const label = () => host.querySelector<HTMLElement>('.mm-measurement')!;
    await expect.poll(() => label()?.dataset.appearance).toBe('along-line');
    expect(label().textContent).toMatch(/m|km/);
    expect(getComputedStyle(label()).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    const angle = () => Number(label().style.transform.match(/rotate\(([-\d.]+)deg\)/)![1]);
    const before = angle(); map.jumpTo({ bearing: 130, pitch: 35 });
    await expect.poll(angle).not.toBe(before); expect(Math.abs(angle())).toBeLessThanOrEqual(90);
    const from = map.project(a), to = map.project(b);
    let expected = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    if (expected > 90) expected -= 180; if (expected < -90) expected += 180;
    // CSSOM serializes the angle to a bounded number of significant digits.
    expect(angle()).toBeCloseTo(expected, 3);
    editor.setMeasurements({ lineStyle: 'badge' }); expect(label().dataset.appearance).toBeUndefined();
    expect(label().style.transform).toContain('rotate(0deg)');
    editor.setMeasurements({ enabled: false }); expect(host.querySelector('.mm-measurements')).toBeNull();
  } finally { editor.destroy(); map.remove(); host.remove(); }
});
