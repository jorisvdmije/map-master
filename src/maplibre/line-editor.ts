import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { LineSession } from '../core/line-session.js';
import type { Coordinate, EditorState, LineCollection, LineFeature } from '../core/types.js';

const editors = new WeakSet<MapLibreMap>();
let nextEditorId = 0;
const emptyCollection = () => ({ type: 'FeatureCollection' as const, features: [] });

type PreviewFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: { type: 'Point'; coordinates: Coordinate }
    | { type: 'LineString'; coordinates: Coordinate[] };
};

/** A line drawing tool for a MapLibre map whose style has loaded. */
export class LineEditor {
  private readonly session: LineSession;
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly prefix = `geo-editor-${++nextEditorId}`;
  private readonly featuresId = `${this.prefix}-features`;
  private readonly draftId = `${this.prefix}-draft`;
  private readonly layerIds = [this.featuresId, this.draftId, `${this.prefix}-vertices`];
  private readonly createListeners = new Set<(feature: LineFeature) => void>();
  private readonly changeListeners = new Set<(state: EditorState) => void>();
  private cursor: Coordinate | undefined;
  private frame: number | undefined;
  private previousCursor = '';
  private restoreDoubleClickZoom = false;
  private destroyed = false;

  constructor(private readonly map: MapLibreMap) {
    if (editors.has(map)) throw new Error('Only one LineEditor can be attached to a map.');
    // getStyle() is available once the style is initialized, even if background
    // tiles are still loading. isStyleLoaded() also waits for source updates.
    if (!map.getStyle()) throw new Error('Create LineEditor after the map style.load event.');
    this.canvas = map.getCanvas();
    const view = this.canvas.ownerDocument.defaultView;
    if (!view) throw new Error('The map must belong to a browser window.');
    this.view = view;
    this.session = new LineSession(() => view.crypto.randomUUID());
    this.mountLayers();
    editors.add(map);
    map.on('click', this.handleClick);
    map.on('mousemove', this.handleMove);
    map.on('mouseout', this.handleLeave);
    map.on('style.load', this.handleStyleLoad);
    map.on('remove', this.handleMapRemove);
    this.canvas.addEventListener('keydown', this.handleKey);
  }

  getState(): EditorState {
    return this.session.state;
  }

  /** Start drawing, preserving an already active draft. Focuses the map canvas. */
  startLine(): void {
    this.assertAlive();
    if (!this.session.start()) return;
    this.previousCursor = this.canvas.style.cursor;
    this.canvas.style.cursor = 'crosshair';
    this.restoreDoubleClickZoom = this.map.doubleClickZoom.isEnabled();
    this.map.doubleClickZoom.disable();
    this.canvas.focus({ preventScroll: true });
    this.emitChange();
  }

  /** Commit clicked vertices. Returns null if there are fewer than two positions. */
  finish(): LineFeature | null {
    this.assertAlive();
    const feature = this.session.finish();
    if (!feature) return null;
    this.leaveDrawing();
    this.renderCommitted();
    for (const listener of this.createListeners) {
      // Each listener owns its snapshot; it cannot mutate state or another listener's data.
      this.notify(() => listener(structuredClone(feature)));
    }
    this.emitChange();
    return feature;
  }

  cancel(): void {
    this.assertAlive();
    if (!this.session.cancel()) return;
    this.leaveDrawing();
    this.emitChange();
  }

  /** An independent snapshot of committed features, also readable after destroy(). */
  exportGeoJSON(): LineCollection {
    return this.session.exportGeoJSON();
  }

  onCreate(listener: (feature: LineFeature) => void): () => void {
    this.assertAlive();
    this.createListeners.add(listener);
    return () => { this.createListeners.delete(listener); };
  }

  onChange(listener: (state: EditorState) => void): () => void {
    this.assertAlive();
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  /** Idempotently remove this editor's handlers and map resources. */
  destroy(): void {
    this.dispose(true);
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('This LineEditor has been destroyed.');
  }

  private notify(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      // Observer errors must not interrupt a commit or lifecycle cleanup.
      this.view.queueMicrotask(() => { throw error; });
    }
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      this.notify(() => listener(this.getState()));
    }
  }

  private readonly handleClick = (event: MapMouseEvent): void => {
    const input = event.originalEvent;
    if (this.session.state.mode !== 'draw-line' || input.button !== 0
      || input.ctrlKey || input.metaKey || input.altKey || input.shiftKey || input.detail > 1) return;
    const { lng, lat } = event.lngLat.wrap();
    if (!this.session.add([lng, lat])) return;
    this.cursor = undefined;
    this.schedulePreview();
    this.emitChange();
  };

  private readonly handleMove = (event: MapMouseEvent): void => {
    if (this.session.state.mode !== 'draw-line') return;
    const { lng, lat } = event.lngLat.wrap();
    this.cursor = [lng, lat];
    this.schedulePreview();
  };

  private readonly handleLeave = (): void => {
    if (this.session.state.mode !== 'draw-line') return;
    this.cursor = undefined;
    this.schedulePreview();
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.target !== this.canvas || event.defaultPrevented || event.isComposing
      || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || this.session.state.mode !== 'draw-line') return;
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      if (event.key === 'Enter') this.finish();
      else this.cancel();
    }
  };

  private readonly handleStyleLoad = (): void => {
    this.mountLayers();
    this.renderCommitted();
    this.schedulePreview();
  };

  private readonly handleMapRemove = (): void => { this.dispose(false); };

  private mountLayers(): void {
    if (!this.map.getSource(this.featuresId)) {
      this.map.addSource(this.featuresId, { type: 'geojson', data: emptyCollection() });
    }
    if (!this.map.getSource(this.draftId)) {
      this.map.addSource(this.draftId, { type: 'geojson', data: emptyCollection() });
    }
    if (!this.map.getLayer(this.featuresId)) this.map.addLayer({
      id: this.featuresId, type: 'line', source: this.featuresId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#116b5b', 'line-width': 4 },
    });
    if (!this.map.getLayer(this.draftId)) this.map.addLayer({
      id: this.draftId, type: 'line', source: this.draftId,
      filter: ['==', '$type', 'LineString'],
      paint: { 'line-color': '#df772e', 'line-width': 3, 'line-dasharray': [2, 1.5] },
    });
    if (!this.map.getLayer(`${this.prefix}-vertices`)) this.map.addLayer({
      id: `${this.prefix}-vertices`, type: 'circle', source: this.draftId,
      filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 5, 'circle-color': '#fff',
        'circle-stroke-color': '#df772e', 'circle-stroke-width': 2 },
    });
  }

  private renderCommitted(): void {
    const source = this.map.getSource<GeoJSONSource>(this.featuresId);
    // MapLibre reports worker/render failures through the map's error event.
    void source?.setData(this.exportGeoJSON());
  }

  private schedulePreview(): void {
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      this.renderPreview();
    });
  }

  private renderPreview(): void {
    const coordinates = this.session.getDraft();
    const features: PreviewFeature[] = coordinates.map((position) => ({
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: position },
    }));
    if (coordinates.length && this.cursor) coordinates.push(this.cursor);
    if (coordinates.length >= 2) features.push({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
    });
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData({ type: 'FeatureCollection', features });
  }

  private leaveDrawing(): void {
    this.cursor = undefined;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.canvas.style.cursor = this.previousCursor;
    if (this.restoreDoubleClickZoom) this.map.doubleClickZoom.enable();
    else this.map.doubleClickZoom.disable();
    this.restoreDoubleClickZoom = false;
    void this.map.getSource<GeoJSONSource>(this.draftId)?.setData(emptyCollection());
  }

  private dispose(removeResources: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const wasDrawing = this.session.cancel();
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (wasDrawing) {
      this.canvas.style.cursor = this.previousCursor;
      if (removeResources) {
        if (this.restoreDoubleClickZoom) this.map.doubleClickZoom.enable();
        else this.map.doubleClickZoom.disable();
      }
    }
    this.map.off('click', this.handleClick);
    this.map.off('mousemove', this.handleMove);
    this.map.off('mouseout', this.handleLeave);
    this.map.off('style.load', this.handleStyleLoad);
    this.map.off('remove', this.handleMapRemove);
    this.canvas.removeEventListener('keydown', this.handleKey);
    this.createListeners.clear();
    this.changeListeners.clear();
    editors.delete(this.map);
    if (removeResources) {
      for (const id of [...this.layerIds].reverse()) {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      }
      for (const id of [this.draftId, this.featuresId]) {
        if (this.map.getSource(id)) this.map.removeSource(id);
      }
    }
  }
}
