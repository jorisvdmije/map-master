import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { DrawingSession } from '../core/drawing-session.js';
import type { Coordinate, EditorState, GeometryFeatureCollection, GeometryFeature, GeometryType } from '../core/types.js';
import { MapLibreRenderer } from './renderer.js';

const editors = new WeakSet<MapLibreMap>();
/** Public drawing API. MapLibre input and rendering stay behind this boundary. */
export class GeometryEditor {
  private readonly session: DrawingSession;
  private readonly renderer: MapLibreRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly createListeners = new Set<(feature: GeometryFeature) => void>();
  private readonly deleteListeners = new Set<(feature: GeometryFeature) => void>();
  private readonly changeListeners = new Set<(state: EditorState) => void>();
  private cursor: Coordinate | undefined;
  private frame: number | undefined;
  private previousCursor = '';
  private restoreDoubleClickZoom = false;
  private destroyed = false;

  constructor(private readonly map: MapLibreMap) {
    if (editors.has(map)) throw new Error('Only one geometry editor can be attached to a map.');
    // getStyle() is available once the style is initialized, even if background
    // tiles are still loading. isStyleLoaded() also waits for source updates.
    if (!map.getStyle()) throw new Error('Create GeometryEditor after the map style.load event.');
    this.canvas = map.getCanvas();
    const view = this.canvas.ownerDocument.defaultView;
    if (!view) throw new Error('The map must belong to a browser window.');
    if (typeof view.crypto?.randomUUID !== 'function') {
      throw new Error('GeometryEditor requires HTTPS or localhost for feature IDs.');
    }
    this.view = view;
    this.session = new DrawingSession(() => view.crypto.randomUUID());
    this.renderer = new MapLibreRenderer(map, `geo-editor-${view.crypto.randomUUID()}`);
    this.renderer.mount();
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

  /** Select one committed feature, or pass null to clear selection. */
  select(id: string | null): void {
    this.assertAlive();
    if (!this.session.select(id)) return;
    this.renderer.renderSelection(id);
    this.emitChange();
  }

  /** An independent snapshot of the selected feature, or null. */
  getSelected(): GeometryFeature | null {
    return this.session.getSelected();
  }

  /** Delete the selected feature and return its snapshot, or null if nothing is selected. */
  deleteSelected(): GeometryFeature | null {
    this.assertAlive();
    const feature = this.session.deleteSelected();
    if (!feature) return null;
    this.renderer.renderSelection(null);
    this.renderer.renderCommitted(this.exportGeoJSON());
    for (const listener of this.deleteListeners) {
      this.notify(() => listener(structuredClone(feature)));
    }
    this.emitChange();
    return feature;
  }

  /** Start drawing. Finish/cancel the current draft before changing geometry type. */
  draw(kind: GeometryType): void {
    this.assertAlive();
    if (!this.session.start(kind)) return;
    this.renderer.renderSelection(null);
    this.previousCursor = this.canvas.style.cursor;
    this.canvas.style.cursor = 'crosshair';
    this.restoreDoubleClickZoom = this.map.doubleClickZoom.isEnabled();
    this.map.doubleClickZoom.disable();
    this.canvas.focus({ preventScroll: true });
    this.emitChange();
  }

  /** Commit a valid draft; otherwise return null and keep drawing active. */
  finish(): GeometryFeature | null {
    this.assertAlive();
    const feature = this.session.finish();
    if (!feature) return null;
    this.leaveDrawing();
    this.renderer.renderCommitted(this.exportGeoJSON());
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
  exportGeoJSON(): GeometryFeatureCollection {
    return this.session.exportGeoJSON();
  }

  onCreate(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    this.createListeners.add(listener);
    return () => { this.createListeners.delete(listener); };
  }

  onDelete(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    this.deleteListeners.add(listener);
    return () => { this.deleteListeners.delete(listener); };
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
    if (this.destroyed) throw new Error('This GeometryEditor has been destroyed.');
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
    const state = this.session.state;
    if (input.button !== 0
      || input.ctrlKey || input.metaKey || input.altKey || input.shiftKey || input.detail > 1) return;
    if (state.mode === 'idle') {
      const id = this.renderer.pick(event.point);
      // MapLibre may still show a deleted feature until its asynchronous source update finishes.
      if (id === null || this.session.hasFeature(id)) this.select(id);
      return;
    }
    // Closing tolerance is in CSS pixels, independent of map zoom.
    if (state.mode === 'draw-polygon' && state.vertexCount >= 3) {
      const first = this.session.getDraft()[0];
      if (first && this.map.project(first).dist(event.point) <= 8) {
        this.finish();
        return;
      }
    }
    const { lng, lat } = event.lngLat.wrap();
    if (!this.session.add([lng, lat])) return;
    this.cursor = undefined;
    this.schedulePreview();
    this.emitChange();
  };

  private readonly handleMove = (event: MapMouseEvent): void => {
    if (this.session.state.mode === 'idle') return;
    const { lng, lat } = event.lngLat.wrap();
    this.cursor = [lng, lat];
    this.schedulePreview();
  };

  private readonly handleLeave = (): void => {
    if (this.session.state.mode === 'idle') return;
    this.cursor = undefined;
    this.schedulePreview();
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.target !== this.canvas || event.defaultPrevented || event.isComposing
      || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    ) return;
    if (this.session.state.mode === 'idle') {
      if (this.session.state.selectedFeatureId !== null
        && (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (event.key === 'Escape') this.select(null);
        else this.deleteSelected();
      }
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      if (event.key === 'Enter') this.finish();
      else this.cancel();
    }
  };

  private readonly handleStyleLoad = (): void => {
    this.renderer.mount();
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.renderer.renderSelection(this.session.state.selectedFeatureId);
    this.schedulePreview();
  };

  private readonly handleMapRemove = (): void => { this.dispose(false); };

  private schedulePreview(): void {
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      this.renderer.renderPreview(this.session.getDraft(), this.cursor, this.session.state);
    });
  }

  private leaveDrawing(): void {
    this.cursor = undefined;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.canvas.style.cursor = this.previousCursor;
    if (this.restoreDoubleClickZoom) this.map.doubleClickZoom.enable();
    else this.map.doubleClickZoom.disable();
    this.restoreDoubleClickZoom = false;
    this.renderer.clearPreview();
  }

  private dispose(removeResources: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const wasDrawing = this.session.cancel();
    this.session.select(null);
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
    this.deleteListeners.clear();
    this.changeListeners.clear();
    editors.delete(this.map);
    if (removeResources) this.renderer.destroy();
  }
}
