import { Map, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { LineEditor, type LineFeature } from '../../src/index.js';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

const style = (): StyleSpecification => ({
  version: 8, sources: {},
  layers: [{ id: 'host-background', type: 'background', paint: { 'background-color': '#eef2ed' } }],
});
let container: HTMLDivElement;
let map: Map;
let editor: LineEditor;
let canvas: HTMLCanvasElement;

function source(ending: string): GeoJSONSource {
  const id = Object.keys(map.getStyle().sources).find((key) => key.endsWith(ending));
  const result = id ? map.getSource<GeoJSONSource>(id) : undefined;
  if (!result) throw new Error(`Missing editor source: ${ending}`);
  return result;
}

const click = (x: number, y: number) => userEvent.click(canvas, { position: { x, y } });

beforeEach(async () => {
  container = document.createElement('div');
  container.style.cssText = 'width:700px;height:450px;position:relative;';
  document.body.append(container);
  map = new Map({ container, style: style(), center: [4.895, 52.372], zoom: 13, fadeDuration: 0 });
  await new Promise<void>((resolve) => { map.once('load', () => { resolve(); }); });
  editor = new LineEditor(map);
  canvas = map.getCanvas();
});

afterEach(() => {
  editor.destroy();
  map.remove();
  container.remove();
});

describe('MapLibre line editor in Chromium', () => {
  it('rejects competing editors on one map', () => {
    expect(() => new LineEditor(map)).toThrow('Only one geometry editor');
  });

  it('keeps separate maps independent and destroys an editor when its map is removed', async () => {
    const secondContainer = document.createElement('div');
    secondContainer.style.cssText = 'width:300px;height:200px;';
    document.body.append(secondContainer);
    const secondMap = new Map({ container: secondContainer, style: style() });
    await new Promise<void>((resolve) => { secondMap.once('load', () => { resolve(); }); });
    const secondEditor = new LineEditor(secondMap);
    try {
      secondEditor.startLine();
      expect(editor.getState().mode).toBe('idle');
      expect(map.doubleClickZoom.isEnabled()).toBe(true);
      secondMap.remove();
      expect(() => secondEditor.startLine()).toThrow('destroyed');
      expect(map.getStyle().layers.length).toBeGreaterThan(1);
    } finally {
      secondEditor.destroy();
      secondContainer.remove();
    }
  });

  it('draws a preview, then commits exactly the clicked points with Enter', async () => {
    const onCreate = vi.fn();
    editor.onCreate(onCreate);
    editor.startLine();
    await click(180, 170);
    await userEvent.hover(canvas, { position: { x: 280, y: 200 } });
    await expect.poll(async () => {
      const data = await source('-draft').getData();
      return data.type === 'FeatureCollection' ? data.features.length : 0;
    }).toBe(2);
    expect(editor.exportGeoJSON().features).toHaveLength(0);
    await click(350, 250);
    await userEvent.keyboard('{Enter}');
    expect(editor.getState()).toMatchObject({ mode: 'idle', featureCount: 1 });
    expect(onCreate).toHaveBeenCalledTimes(1);
    const feature = editor.exportGeoJSON().features[0];
    expect(feature?.geometry.coordinates).toHaveLength(2);
    const first = map.unproject([180, 170]);
    expect(feature?.geometry.coordinates[0]?.[0]).toBeCloseTo(first.lng, 6);
    expect(feature?.geometry.coordinates[0]?.[1]).toBeCloseTo(first.lat, 6);
    expect(editor.finish()).toBeNull();
    expect(onCreate).toHaveBeenCalledTimes(1);
    await expect.poll(() => map.queryRenderedFeatures({ layers: [
      map.getStyle().layers.find((layer) => layer.id.endsWith('-features'))?.id ?? '',
    ] }).length).toBeGreaterThan(0);
  });

  it('cannot finish too early and Escape keeps previous committed features', async () => {
    editor.startLine();
    await click(100, 100);
    await userEvent.keyboard('{Enter}');
    expect(editor.getState()).toMatchObject({ mode: 'draw-line', vertexCount: 1, featureCount: 0 });
    await click(240, 160);
    editor.finish();
    const committed = editor.exportGeoJSON();
    editor.startLine();
    await click(300, 200);
    await userEvent.keyboard('{Escape}');
    expect(editor.getState().mode).toBe('idle');
    expect(editor.exportGeoJSON()).toEqual(committed);
    expect(map.doubleClickZoom.isEnabled()).toBe(true);
  });

  it('does not handle shortcuts in unrelated inputs or modified Enter on the map', async () => {
    editor.startLine();
    await click(100, 100); await click(240, 160);
    const input = document.createElement('input');
    container.append(input);
    input.focus();
    await userEvent.keyboard('{Enter}{Escape}');
    expect(editor.getState().mode).toBe('draw-line');
    canvas.focus();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(editor.getState().mode).toBe('draw-line');
    await userEvent.keyboard('{Enter}');
    expect(editor.exportGeoJSON().features).toHaveLength(1);
  });

  it('preserves gesture settings and cursor, including initially disabled zoom', async () => {
    map.doubleClickZoom.disable();
    canvas.style.cursor = 'help';
    editor.startLine();
    expect(map.doubleClickZoom.isEnabled()).toBe(false);
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.scrollZoom.isEnabled()).toBe(true);
    await click(100, 100); await click(240, 160);
    editor.finish();
    expect(map.doubleClickZoom.isEnabled()).toBe(false);
    expect(canvas.style.cursor).toBe('help');
    map.doubleClickZoom.enable();
    editor.startLine();
    expect(map.doubleClickZoom.isEnabled()).toBe(false);
    editor.cancel();
    expect(map.doubleClickZoom.isEnabled()).toBe(true);
    expect(canvas.style.cursor).toBe('help');
  });

  it('pans without adding a vertex and ignores double-click duplicates', async () => {
    editor.startLine();
    const center = map.getCenter();
    await userEvent.dragAndDrop(canvas, canvas, {
      sourcePosition: { x: 150, y: 150 }, targetPosition: { x: 350, y: 250 },
    });
    expect(editor.getState().vertexCount).toBe(0);
    expect(map.getCenter().lng).not.toBe(center.lng);
    map.stop();
    const zoom = map.getZoom();
    await userEvent.dblClick(canvas, { position: { x: 100, y: 100 } });
    expect(editor.getState().vertexCount).toBe(1);
    expect(map.getZoom()).toBe(zoom);
  });

  it('does not rewrite committed geometry when the pointer moves', async () => {
    editor.startLine();
    await click(100, 100); await click(240, 160);
    editor.finish();
    const committed = vi.spyOn(source('-features'), 'setData');
    editor.startLine();
    await click(150, 150);
    await userEvent.hover(canvas, { position: { x: 400, y: 300 } });
    expect(committed).not.toHaveBeenCalled();
    committed.mockRestore();
  });

  it('removes only owned resources and remounts without duplicate creation events', async () => {
    const staleListener = vi.fn();
    editor.onCreate(staleListener);
    canvas.style.cursor = 'help';
    editor.startLine();
    await click(100, 100);
    editor.destroy();
    editor.destroy();
    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(['host-background']);
    expect(Object.keys(map.getStyle().sources)).toEqual([]);
    expect(canvas.style.cursor).toBe('help');
    expect(map.doubleClickZoom.isEnabled()).toBe(true);
    expect(() => editor.startLine()).toThrow('destroyed');
    editor = new LineEditor(map);
    const freshListener = vi.fn();
    editor.onCreate(freshListener);
    editor.startLine();
    await click(140, 150); await click(340, 240);
    editor.finish();
    expect(staleListener).not.toHaveBeenCalled();
    expect(freshListener).toHaveBeenCalledTimes(1);
  });

  it('restores rendered data after a style replacement', async () => {
    editor.startLine();
    await click(100, 100); await click(240, 160);
    editor.finish();
    const committed = editor.exportGeoJSON();
    const loaded = new Promise<void>((resolve) => { map.once('style.load', () => { resolve(); }); });
    map.setStyle(style(), { diff: false });
    await loaded;
    expect(editor.exportGeoJSON()).toEqual(committed);
    await expect.poll(() => source('-features').getData()).toEqual(committed);
  });

  it('isolates event snapshots and allows unsubscribing', async () => {
    editor.onCreate((feature) => { feature.geometry.coordinates.length = 0; });
    const observe = vi.fn<(feature: LineFeature) => void>();
    editor.onCreate(observe);
    const removed = vi.fn();
    editor.onCreate(removed)();
    editor.startLine();
    await click(100, 100); await click(240, 160);
    editor.finish();
    expect(observe.mock.calls[0]?.[0].geometry.coordinates).toHaveLength(2);
    expect(editor.exportGeoJSON().features[0]?.geometry.coordinates).toHaveLength(2);
    expect(removed).not.toHaveBeenCalled();
  });
});
