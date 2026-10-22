import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { DrawingSession } from '../core/drawing-session.js';
import type { Coordinate, FeatureTransaction, TransactionEvent, SnappingOptions, SnapResult, FeatureId, EditorState, EditorOptions, HistoryEvent, GeometryFeatureCollection, GeometryFeature, GeometryType } from '../core/types.js';
import { MapLibreRenderer } from './renderer.js';
import { MapLibreSnapping } from './snapping.js';
import type { ScreenPoint } from '../core/snapping.js';
import { VertexInteraction } from './vertex-interaction.js';

const editors = new WeakSet<MapLibreMap>();
/** Public drawing API. MapLibre input and rendering stay behind this boundary. */
export class GeometryEditor {
  private readonly snapping: MapLibreSnapping;
  private snap: SnapResult | null = null;
  private pointer: ScreenPoint | undefined;
  private altPressed = false;
  private readonly snapListeners = new Set<(result: SnapResult | null) => void>();
  private readonly session: DrawingSession;
  private readonly renderer: MapLibreRenderer;
  private readonly vertices: VertexInteraction;
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly createListeners = new Set<(feature: GeometryFeature) => void>();
  private readonly deleteListeners = new Set<(feature: GeometryFeature) => void>();
  private readonly transactionListeners = new Set<(event: TransactionEvent) => void>();
  private readonly importListeners = new Set<(collection: GeometryFeatureCollection) => void>();
  private readonly updateListeners = new Set<(feature: GeometryFeature) => void>();
  private readonly historyListeners = new Set<(event: HistoryEvent) => void>();
  private readonly changeListeners = new Set<(state: EditorState) => void>();
  private cursor: Coordinate | undefined;
  private frame: number | undefined;
  private previousCursor = '';
  private restoreDoubleClickZoom = false;
  private destroyed = false;

  constructor(private readonly map: MapLibreMap, options: EditorOptions = {}) {
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
    this.session = new DrawingSession(() => view.crypto.randomUUID(), options.historyLimit);
    this.snapping = new MapLibreSnapping(map, options.snapping);
    this.renderer = new MapLibreRenderer(map, `geo-editor-${view.crypto.randomUUID()}`);
    this.renderer.mount();
    this.vertices = new VertexInteraction(map, {
      state: () => this.session.state, draft: () => this.session.getDraft(),
      select: (index) => { this.draftChanged(this.session.selectVertex(index)); },
      move: (index, coordinate) => { this.draftChanged(this.session.moveVertex(index, coordinate)); },
      insert: (index, coordinate) => { this.draftChanged(this.session.insertVertex(index, coordinate)); },
      remove: (index) => { this.draftChanged(this.session.removeVertex(index)); },
    });
    editors.add(map);
    map.on('click', this.handleClick);
    map.on('mousemove', this.handleMove);
    map.on('mouseout', this.handleLeave);
    map.on('move', this.handleCameraMove);
    map.on('style.load', this.handleStyleLoad);
    map.on('remove', this.handleMapRemove);
    this.canvas.addEventListener('keydown', this.handleKey);
    this.view.addEventListener('keydown', this.handleSnapModifier);
    this.view.addEventListener('keyup', this.handleSnapModifier);
    this.view.addEventListener('blur', this.handleSnapBlur);
  }

  getState(): EditorState {
    return this.session.state;
  }

  getSnapping(): SnappingOptions { return this.snapping.getOptions(); }
  setSnapping(options: Partial<SnappingOptions>): void {
    this.assertAlive();
    if (!this.snapping.setOptions(options)) return;
    if (this.pointer && this.session.state.mode.startsWith('draw-')) {
      const resolved = this.resolvePointer(this.pointer);
      this.cursor = resolved.coordinate;
      this.setSnap(resolved.snap);
    }
    this.schedulePreview();
    this.emitChange();
  }
  getSnap(): SnapResult | null { return this.snap ? { ...this.snap, coordinate: [...this.snap.coordinate] } : null; }
  onSnap(listener: (result: SnapResult | null) => void): () => void {
    this.assertAlive(); this.snapListeners.add(listener);
    return () => { this.snapListeners.delete(listener); };
  }

  private setSnap(result: SnapResult | null): void {
    const previous = this.snap;
    this.snap = result;
    // Pixel distance may change while the same exact vertex remains acquired.
    if (previous?.kind === result?.kind && previous?.featureId === result?.featureId && previous?.index === result?.index
      && previous?.coordinate[0] === result?.coordinate[0] && previous?.coordinate[1] === result?.coordinate[1]) return;
    for (const listener of this.snapListeners) this.notify(() => listener(result ? structuredClone(result) : null));
  }

  private resolvePointer(point: ScreenPoint): { coordinate: Coordinate; snap: SnapResult | null; close: boolean } {
    const options = this.snapping.getOptions();
    const state = this.session.state;
    const first = state.mode === 'draw-polygon' && state.vertexCount >= 3 ? this.session.getDraft()[0] : undefined;
    if (first) {
      const projected = this.map.project(first);
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
      const snapping = options.enabled && options.vertices && !this.altPressed;
      if (distance <= (snapping ? Math.max(8, options.distance) : 8)) return {
        coordinate: first, close: true,
        snap: snapping ? { kind: 'vertex', featureId: null, index: 0, coordinate: first, distance } : null,
      };
    }
    const snap = this.altPressed ? null : this.snapping.resolve(point, state.dataRevision, () => this.session.exportGeoJSON());
    return { coordinate: snap?.coordinate ?? this.map.unproject([point.x, point.y]).wrap().toArray(), snap, close: false };
  }

  /** Select one committed feature, or pass null to clear selection. */
  select(id: FeatureId | null): void {
    this.assertAlive();
    if (!this.session.select(id)) return;
    this.renderer.renderSelection(id);
    this.emitChange();
  }

  /** An independent snapshot of the selected feature, or null. */
  getSelected(): GeometryFeature | null {
    return this.session.getSelected();
  }

  getDraft(): Coordinate[] { return this.session.getDraft(); }

  /** Begin a cancellable edit of the selected feature; false with no selection/already editing. */
  editSelected(): boolean {
    this.assertAlive();
    if (!this.session.editSelected()) return false;
    this.renderer.renderEditing(this.session.state.selectedFeatureId);
    this.enterInteraction();
    this.schedulePreview();
    return true;
  }

  selectVertex(index: number | null): void {
    this.assertAlive(); this.vertices.stop();
    this.draftChanged(this.session.selectVertex(index));
  }

  moveVertex(index: number, coordinate: Coordinate): void {
    this.assertAlive(); this.vertices.stop();
    this.draftChanged(this.session.moveVertex(index, coordinate));
  }

  insertVertex(index: number, coordinate: Coordinate): void {
    this.assertAlive(); this.vertices.stop();
    this.draftChanged(this.session.insertVertex(index, coordinate));
  }

  removeVertex(index: number): boolean {
    this.assertAlive(); this.vertices.stop();
    const changed = this.session.removeVertex(index);
    this.draftChanged(changed);
    return changed;
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
    this.enterInteraction();
  }

  private enterInteraction(): void {
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
    this.vertices.stop();
    const before = this.session.state;
    const feature = this.session.finish();
    if (!feature) return null;
    this.leaveDrawing();
    if (this.session.state.dataRevision !== before.dataRevision) {
      this.renderer.renderCommitted(this.exportGeoJSON());
      const listeners = before.mode.startsWith('edit-') ? this.updateListeners : this.createListeners;
      for (const listener of listeners) {
        // Each listener owns its snapshot; it cannot mutate state or another listener's data.
        this.notify(() => listener(structuredClone(feature)));
      }
    }
    this.emitChange();
    return feature;
  }

  cancel(): void {
    this.assertAlive();
    this.vertices.stop(true);
    if (!this.session.cancel()) return;
    this.leaveDrawing();
    this.emitChange();
  }

  /** An independent snapshot of committed features, also readable after destroy(). */
  exportGeoJSON(): GeometryFeatureCollection {
    return this.session.exportGeoJSON();
  }

  /** Atomically append a parsed Feature or FeatureCollection. Existing IDs cannot be overwritten. */
  importGeoJSON(input: unknown): GeometryFeatureCollection {
    this.assertAlive();
    const imported = this.session.importGeoJSON(input);
    if (imported.features.length === 0) return imported;
    this.renderer.renderCommitted(this.exportGeoJSON());
    for (const listener of this.importListeners) {
      this.notify(() => listener(structuredClone(imported)));
    }
    this.emitChange();
    return imported;
  }

  /** Apply a mixed batch atomically; callbacks receive the complete committed changes. */
  applyTransaction(input: FeatureTransaction): TransactionEvent | null {
    this.assertAlive();
    const event = this.session.applyTransaction(input);
    if (!event) return null;
    this.renderer.renderSelection(this.session.state.selectedFeatureId);
    this.renderer.renderCommitted(this.exportGeoJSON());
    for (const listener of this.transactionListeners) this.notify(() => listener(structuredClone(event)));
    this.emitChange();
    return event;
  }

  onTransaction(listener: (event: TransactionEvent) => void): () => void {
    this.assertAlive(); this.transactionListeners.add(listener);
    return () => { this.transactionListeners.delete(listener); };
  }

  onImport(listener: (collection: GeometryFeatureCollection) => void): () => void {
    this.assertAlive();
    this.importListeners.add(listener);
    return () => { this.importListeners.delete(listener); };
  }

  undo(): boolean { return this.replayHistory('undo'); }
  redo(): boolean { return this.replayHistory('redo'); }

  clearHistory(): void {
    this.assertAlive();
    if (this.session.clearHistory()) this.emitChange();
  }

  onHistory(listener: (event: HistoryEvent) => void): () => void {
    this.assertAlive();
    this.historyListeners.add(listener);
    return () => { this.historyListeners.delete(listener); };
  }

  private replayHistory(direction: HistoryEvent['direction']): boolean {
    this.assertAlive();
    const event = this.session[direction]();
    if (!event) return false;
    this.renderer.renderSelection(this.session.state.selectedFeatureId);
    this.renderer.renderCommitted(this.exportGeoJSON());
    for (const listener of this.historyListeners) this.notify(() => listener(structuredClone(event)));
    this.emitChange();
    return true;
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

  onUpdate(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    this.updateListeners.add(listener);
    return () => { this.updateListeners.delete(listener); };
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

  private draftChanged(changed: boolean): void {
    if (!changed || this.destroyed) return;
    this.schedulePreview();
    this.emitChange();
  }

  private readonly handleClick = (event: MapMouseEvent): void => {
    const input = event.originalEvent;
    const state = this.session.state;
    if (input.button !== 0
      || input.ctrlKey || input.metaKey || input.shiftKey || input.detail > 1) return;
    if (state.mode.startsWith('edit-')) return;
    if (state.mode === 'idle') {
      if (input.altKey) return;
      const id = this.renderer.pick(event.point);
      // MapLibre may still show a deleted feature until its asynchronous source update finishes.
      if (id === null || this.session.hasFeature(id)) this.select(id);
      return;
    }
    this.pointer = { x: event.point.x, y: event.point.y };
    this.altPressed = input.altKey;
    const resolved = this.resolvePointer(this.pointer);
    this.setSnap(resolved.snap);
    if (this.destroyed || !this.session.state.mode.startsWith('draw-')) return;
    this.schedulePreview();
    if (resolved.close) { this.finish(); return; }
    if (!this.session.add(resolved.coordinate)) return;
    this.cursor = undefined;
    this.schedulePreview();
    this.emitChange();
  };

  private readonly handleMove = (event: MapMouseEvent): void => {
    if (!this.session.state.mode.startsWith('draw-')) return;
    this.pointer = { x: event.point.x, y: event.point.y };
    this.altPressed = event.originalEvent.altKey;
    this.schedulePreview();
  };

  private readonly handleLeave = (): void => {
    if (!this.session.state.mode.startsWith('draw-')) return;
    this.pointer = undefined;
    this.cursor = undefined;
    this.setSnap(null);
    this.schedulePreview();
  };

  private readonly handleSnapModifier = (event: KeyboardEvent): void => {
    if (event.key !== 'Alt' || !this.session.state.mode.startsWith('draw-')) return;
    this.altPressed = event.type === 'keydown';
    this.schedulePreview();
  };

  private readonly handleSnapBlur = (): void => {
    this.altPressed = false;
    this.pointer = undefined;
    this.cursor = undefined;
    this.setSnap(null);
    if (this.session.state.mode.startsWith('draw-')) this.schedulePreview();
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.target !== this.canvas || event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.ctrlKey && event.metaKey || this.session.state.mode !== 'idle') return;
      const key = event.key.toLowerCase();
      const direction = key === 'z' ? event.shiftKey ? 'redo' : 'undo'
        : key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : null;
      if (direction && this.session.state[direction === 'undo' ? 'canUndo' : 'canRedo']) {
        event.preventDefault();
        this.replayHistory(direction);
      }
      return;
    }
    if (event.shiftKey) return;
    if (this.session.state.mode === 'idle') {
      if (this.session.state.selectedFeatureId !== null
        && (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        if (event.key === 'Escape') this.select(null);
        else this.deleteSelected();
      }
      return;
    }
    if (this.session.state.mode.startsWith('edit-') && (event.key === 'Delete' || event.key === 'Backspace')) {
      const index = this.session.state.selectedVertexIndex;
      if (index !== null) { event.preventDefault(); this.removeVertex(index); }
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      if (event.key === 'Enter') this.finish();
      else this.cancel();
    }
  };

  private readonly handleStyleLoad = (): void => {
    this.vertices.stop(true);
    this.renderer.mount();
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.renderer.renderSelection(this.session.state.selectedFeatureId);
    this.renderer.renderEditing(this.session.state.mode.startsWith('edit-') ? this.session.state.selectedFeatureId : null);
    this.schedulePreview();
  };

  private readonly handleMapRemove = (): void => { this.dispose(false); };

  private readonly handleCameraMove = (): void => {
    this.snapping.invalidateCamera();
    if (this.session.state.mode !== 'idle') this.schedulePreview();
  };

  private schedulePreview(): void {
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.pointer && this.session.state.mode.startsWith('draw-')) {
        const resolved = this.resolvePointer(this.pointer);
        this.cursor = resolved.coordinate;
        this.setSnap(resolved.snap);
      }
      if (this.destroyed) return;
      this.renderer.renderPreview(this.session.getDraft(), this.cursor, this.session.state, this.snap);
    });
  }

  private leaveDrawing(): void {
    this.pointer = undefined;
    this.altPressed = false;
    this.setSnap(null);
    this.cursor = undefined;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.canvas.style.cursor = this.previousCursor;
    if (this.restoreDoubleClickZoom) this.map.doubleClickZoom.enable();
    else this.map.doubleClickZoom.disable();
    this.restoreDoubleClickZoom = false;
    this.renderer.clearPreview();
    this.renderer.renderEditing(null);
  }

  private dispose(removeResources: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointer = undefined;
    this.snap = null;
    this.snapping.clear();
    this.vertices.destroy(removeResources);
    const wasDrawing = this.session.cancel();
    this.session.clearHistory();
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
    this.map.off('move', this.handleCameraMove);
    this.map.off('style.load', this.handleStyleLoad);
    this.map.off('remove', this.handleMapRemove);
    this.canvas.removeEventListener('keydown', this.handleKey);
    this.view.removeEventListener('keydown', this.handleSnapModifier);
    this.view.removeEventListener('keyup', this.handleSnapModifier);
    this.view.removeEventListener('blur', this.handleSnapBlur);
    this.snapListeners.clear();
    this.createListeners.clear();
    this.deleteListeners.clear();
    this.updateListeners.clear();
    this.importListeners.clear();
    this.transactionListeners.clear();
    this.changeListeners.clear();
    this.historyListeners.clear();
    editors.delete(this.map);
    if (removeResources) this.renderer.destroy();
  }
}
