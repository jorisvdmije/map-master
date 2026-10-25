import { lockedFeatureIds, sameLocks } from '../core/feature-locks.js';
import { constrainDrawingPoint, drawingConstraintsOptions } from '../core/drawing-constraints.js';
import { copyAppearance, resolveAppearance, type EditorAppearance, type EditorAppearanceOptions } from '../core/appearance.js';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { DrawingSession } from '../core/drawing-session.js';
import type { Coordinate, DrawingConstraintsOptions, SharedBoundaryPreview, TraceTarget, TraceSide, TracingOptions, ReshapePreview, ReshapeSide, IntersectionPreview, DifferencePreview, UnionPreview, SplitPreview, FeatureTransaction, TransactionEvent, SnappingOptions, SnapResult, FeatureId, EditorState, EditorOptions, HistoryEvent, GeometryFeatureCollection, GeometryFeature, DrawGeometryType } from '../core/types.js';
import { MapLibreRenderer } from './renderer.js';
import { ReshapeSnapping } from './reshape-snapping.js';
import { MapLibreSnapping } from './snapping.js';
import type { ScreenPoint } from '../core/snapping.js';
import { VertexInteraction } from './vertex-interaction.js';
import { SelectionInteraction } from './selection-interaction.js';
import { TranslationInteraction } from './translation-interaction.js';
import { RotationInteraction } from './rotation-interaction.js';
import { EditorEvents } from './editor-events.js';
import { KeyboardInteraction } from './keyboard-interaction.js';
import { GeoJSONImportError } from '../core/geojson-import.js';

const editors = new WeakSet<MapLibreMap>();
/** Public drawing API. MapLibre input and rendering stay behind this boundary. */
export class GeometryEditor {
  private appearance: EditorAppearance;
  private drawingConstraints: DrawingConstraintsOptions;
  private tracing: TracingOptions;
  private traceAnchor: { target: TraceTarget; coordinate: Coordinate } | null = null;
  private traceCache: { key: string; path: Coordinate[] | null } | null = null;
  private readonly reshapeSnapping: ReshapeSnapping;
  private readonly snapping: MapLibreSnapping;
  private snap: SnapResult | null = null;
  private pointer: ScreenPoint | undefined;
  private altPressed = false;
  private readonly events: EditorEvents;
  private readonly keyboard: KeyboardInteraction;
  private readonly session: DrawingSession;
  private readonly renderer: MapLibreRenderer;
  private readonly vertices: VertexInteraction;
  private readonly selection: SelectionInteraction;
  private readonly translation: TranslationInteraction;
  private readonly rotation: RotationInteraction;
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
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
    this.appearance = resolveAppearance(options.appearance);
    this.drawingConstraints = drawingConstraintsOptions(options.drawingConstraints);
    this.tracing = this.tracingOptions(options.tracing ?? {});
    this.events = new EditorEvents((error) => { view.queueMicrotask(() => { throw error; }); });
    this.session = new DrawingSession(() => view.crypto.randomUUID(), options.historyLimit, options.lockedFeatureIds);
    this.reshapeSnapping = new ReshapeSnapping(map);
    this.snapping = new MapLibreSnapping(map, options.snapping);
    this.renderer = new MapLibreRenderer(map, `geo-editor-${view.crypto.randomUUID()}`, this.appearance);
    this.renderer.mount();
    this.vertices = new VertexInteraction(map, {
      state: () => this.session.state, draft: () => this.session.getDraft(),
      select: (index) => { this.draftChanged(this.session.selectVertex(index)); },
      move: (index, coordinate) => { this.draftChanged(this.session.moveVertex(index, coordinate)); },
      insert: (index, coordinate) => { this.draftChanged(this.session.insertVertex(index, coordinate)); },
      remove: (index) => { this.draftChanged(this.session.removeVertex(index)); },
      resolve: (point, altKey) => {
        const resolved = this.resolvePointer(point, altKey);
        this.setSnap(resolved.snap);
        if (!this.destroyed) this.schedulePreview();
        return resolved.coordinate;
      },
      clearSnap: () => {
        this.setSnap(null);
        if (!this.destroyed) this.schedulePreview();
      },
    });
    this.selection = new SelectionInteraction(map, {
      idle: () => !this.destroyed && this.session.state.mode === 'idle',
      toggle: (point) => {
        const id = this.renderer.pick(point);
        if (id !== null && this.session.hasFeature(id)) this.toggleSelection(id);
      },
      addBox: (start, end) => {
        const ids = this.renderer.pickBox(start, end).filter((id) => this.session.hasFeature(id));
        this.selectMany([...this.session.state.selectedFeatureIds, ...ids]);
      },
    });
    this.translation = new TranslationInteraction(map, {
      targets: (point) => {
        const state = this.session.state;
        if (this.destroyed || this.renderer.transferringTranslation || state.mode !== 'idle' || state.selectedFeatureIds.length === 0 || state.selectedFeatureIds.some((id) => this.session.isFeatureLocked(id))) return [];
        const id = this.renderer.pick(point);
        return id !== null && state.selectedFeatureIds.includes(id) ? this.session.getSelection() : [];
      },
      preview: (features) => {
        this.renderer.renderEditingMany(features.map((feature) => feature.id));
        this.renderer.renderTranslation(features);
      },
      clear: () => { this.renderer.renderEditing(null); this.renderer.clearPreview(); },
      commit: (delta) => {
        try {
          const event = this.session.translateSelection(delta);
          if (event) {
            this.renderer.holdTranslation();
            this.publishTransaction(event);
          } else { this.renderer.renderEditing(null); this.renderer.clearPreview(); }
        }
        catch (error) {
          // Final topology validation can reject a numerically degenerate result.
          // Restore the original after a rejected commit; preserve data and history.
          this.renderer.renderEditing(null); this.renderer.clearPreview();
          if (!(error instanceof GeoJSONImportError || error instanceof RangeError)) throw error;
        }
      },
    });
    this.rotation = new RotationInteraction(map, {
      state: () => this.session.state,
      angle: (degrees) => { this.draftChanged(this.session.setRotationAngle(degrees)); },
      finish: () => { this.finishRotation(); },
      cancel: () => { this.cancel(); },
    });
    editors.add(map);
    map.on('click', this.handleClick);
    map.on('mousemove', this.handleMove);
    map.on('mouseout', this.handleLeave);
    map.on('move', this.handleCameraMove);
    map.on('style.load', this.handleStyleLoad);
    map.on('remove', this.handleMapRemove);
    this.keyboard = new KeyboardInteraction(this.canvas, {
      state: () => this.session.state,
      history: (direction) => { this.replayHistory(direction); },
      deselect: () => { this.select(null); },
      deleteSelected: () => { this.deleteSelected(); },
      deleteSelection: () => { this.deleteSelection(); },
      removeLastDrawStep: () => { this.removeLastDrawStep(); },
      removeSplitPoint: () => { this.removeSplitPoint(); },
      removeReshapePoint: () => { this.removeReshapePoint(); },
      removeVertex: (index) => { this.removeVertex(index); },
      finish: () => { this.finish(); },
      cancel: () => { this.cancel(); },
    });
    this.view.addEventListener('keydown', this.handleSnapModifier);
    this.view.addEventListener('keyup', this.handleSnapModifier);
    this.view.addEventListener('blur', this.handleSnapBlur);
  }

  // Public API: application controls and subscriptions.

  getState(): EditorState {
    return this.session.state;
  }

  getLockedFeatureIds(): FeatureId[] { return this.session.getLockedFeatureIds(); }
  isFeatureLocked(id: FeatureId): boolean { return this.session.isFeatureLocked(id); }

  /** Replace host locks atomically. Policy is separate from GeoJSON and history. */
  setLockedFeatureIds(ids: readonly FeatureId[]): void {
    this.assertAlive();
    const next = lockedFeatureIds(ids);
    if (sameLocks(new Set(this.session.getLockedFeatureIds()), next)) return;
    this.cancelIdleGestures();
    this.vertices.stop(true);
    this.rotation.stop();
    const wasDrawing = this.session.state.mode !== 'idle';
    this.session.setLockedFeatureIds([...next]);
    if (wasDrawing && this.session.state.mode === 'idle') this.leaveDrawing();
    this.emitChange();
  }

  /** Independent snapshot; changing it never changes the editor. */
  getAppearance(): EditorAppearance { return copyAppearance(this.appearance); }

  /** Atomically validate a presentation patch. No data upload, draft cancellation or history action. */
  setAppearance(patch: EditorAppearanceOptions): void {
    this.assertAlive();
    const next = resolveAppearance(patch, this.appearance);
    if (JSON.stringify(next) === JSON.stringify(this.appearance)) return;
    this.appearance = next;
    this.renderer.setAppearance(next);
    if (this.session.state.mode === 'rotate-features') this.schedulePreview();
    this.emitChange();
  }

  private tracingOptions(update: Partial<TracingOptions>, previous: TracingOptions = { enabled: false, side: 'shorter' }): TracingOptions {
    const options = { ...previous, ...update };
    if (typeof options.enabled !== 'boolean' || options.side !== 'shorter' && options.side !== 'longer') throw new TypeError('Invalid tracing options.');
    return options;
  }

  getTracing(): TracingOptions { return { ...this.tracing }; }
  setTracing(update: Partial<TracingOptions>): void {
    this.assertAlive();
    const next = this.tracingOptions(update, this.tracing);
    if (next.enabled === this.tracing.enabled && next.side === this.tracing.side) return;
    this.tracing = next; this.traceCache = null;
    if (!next.enabled) this.traceAnchor = null;
    this.schedulePreview(); this.emitChange();
  }

  /** Programmatic tracing does not require mouse snapping or the tracing toggle. */
  traceBoundary(target: TraceTarget, from: Coordinate, to: Coordinate, side: TraceSide = this.tracing.side): boolean {
    this.assertAlive();
    const changed = this.session.traceBoundary(target, from, to, side);
    if (changed) {
      const last = this.session.getDraft().at(-1)!;
      this.traceAnchor = { target: { ...target }, coordinate: last };
      this.traceCache = null; this.pointer = undefined; this.cursor = undefined; this.setSnap(null);
    }
    this.draftChanged(changed); return changed;
  }

  removeLastDrawStep(): boolean {
    this.assertAlive();
    const changed = this.session.removeLastDrawStep();
    if (changed) {
      const last = this.session.getDraft().at(-1);
      if (last && this.traceAnchor) this.traceAnchor.coordinate = last;
      else this.traceAnchor = null;
      this.traceCache = null;
    }
    this.draftChanged(changed); return changed;
  }

  /** Prospective source route only; pointer motion never changes draft validity or stored data. */
  getTracePreview(): Coordinate[] | null {
    if (!this.pointer || !this.canTracePointer() || !this.traceAnchor || this.altPressed) return null;
    const resolved = this.resolvePointer(this.pointer);
    const snap = resolved.snap;
    const { target, coordinate } = this.traceAnchor;
    if (!resolved.close && (!snap || snap.featureId !== target.featureId
      || (snap.partIndex ?? 0) !== (target.partIndex ?? 0) || (snap.ringIndex ?? 0) !== (target.ringIndex ?? 0))) return null;
    const key = JSON.stringify([target, coordinate, resolved.coordinate, this.tracing.side, this.session.state.dataRevision]);
    if (this.traceCache?.key !== key) this.traceCache = { key, path: this.session.getBoundaryTrace(target, coordinate, resolved.coordinate, this.tracing.side) };
    return this.traceCache.path?.map((p) => [...p]) ?? null;
  }

  private canTracePointer(): boolean {
    const mode = this.session.state.mode;
    const options = this.snapping.getOptions();
    return this.tracing.enabled && options.enabled && (options.vertices || options.edges)
      && (mode === 'draw-line' || mode === 'draw-polygon' || mode === 'draw-hole');
  }

  getDrawingConstraints(): DrawingConstraintsOptions { return { ...this.drawingConstraints }; }
  setDrawingConstraints(update: Partial<DrawingConstraintsOptions>): void {
    this.assertAlive();
    const next = drawingConstraintsOptions(update, this.drawingConstraints);
    if (next.enabled === this.drawingConstraints.enabled && next.angleStep === this.drawingConstraints.angleStep) return;
    this.drawingConstraints = next;
    this.schedulePreview(); this.emitChange();
  }

  getSnapping(): SnappingOptions { return this.snapping.getOptions(); }
  setSnapping(options: Partial<SnappingOptions>): void {
    this.assertAlive();
    if (!this.snapping.setOptions(options)) return;
    if (!this.snapping.getOptions().enabled) { this.traceAnchor = null; this.traceCache = null; }
    this.vertices.refresh();
    if (this.pointer && this.isDrawing()) {
      const resolved = this.resolvePointer(this.pointer);
      this.cursor = resolved.blocked ? undefined : resolved.coordinate;
      this.setSnap(resolved.snap);
    }
    this.schedulePreview();
    this.emitChange();
  }
  getSnap(): SnapResult | null { return this.snap ? { ...this.snap, coordinate: [...this.snap.coordinate] } : null; }
  onSnap(listener: (result: SnapResult | null) => void): () => void {
    this.assertAlive();
    return this.events.on('snap', listener);
  }

  /** Select one committed feature, or pass null to clear selection. */
  select(id: FeatureId | null): void {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.select(id)) return;
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.emitChange();
  }

  /** Replace the selection; unknown IDs reject the entire update. */
  selectMany(ids: readonly FeatureId[]): void {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.selectMany(ids)) return;
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.emitChange();
  }

  toggleSelection(id: FeatureId): void {
    this.assertAlive(); this.cancelIdleGestures();
    this.session.toggleSelection(id);
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.emitChange();
  }

  /** Independent snapshots in selection acquisition order. */
  getSelection(): GeometryFeature[] { return this.session.getSelection(); }

  /** An independent snapshot when exactly one feature is selected, otherwise null. */
  getSelected(): GeometryFeature | null {
    return this.session.getSelected();
  }

  getDraft(): Coordinate[] { return this.session.getDraft(); }

  /** Preview the union of at least two selected Polygon/MultiPolygon features. */
  unionSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.unionSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  getUnionPreview(): UnionPreview | null { return this.session.getUnionPreview(); }

  finishUnion(): TransactionEvent | null {
    this.assertAlive();
    const event = this.session.finishUnion();
    if (!event) return null;
    this.leaveDrawing();
    return this.publishTransaction(event);
  }

  /** Preview the area common to all selected Polygon/MultiPolygon features. */
  intersectionSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.intersectionSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  getIntersectionPreview(): IntersectionPreview | null { return this.session.getIntersectionPreview(); }

  finishIntersection(): TransactionEvent | null {
    this.assertAlive();
    const event = this.session.finishIntersection();
    if (!event) return null;
    this.leaveDrawing();
    return this.publishTransaction(event);
  }

  /** Subtract the remaining selected polygons from the first, preserving cutters. */
  differenceSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.differenceSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  getDifferencePreview(): DifferencePreview | null { return this.session.getDifferencePreview(); }

  finishDifference(): TransactionEvent | null {
    this.assertAlive();
    const state = this.session.state;
    if (state.mode !== 'difference-polygons' || !state.canFinish) return null;
    const event = this.session.finishDifference();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Replace one arc of the selected single-ring polygon with a boundary-to-boundary path. */
  reshapeSelected(): boolean {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.reshapeSelected()) return false;
    const target = this.session.getSelected()!;
    if (target.geometry.type !== 'Polygon') throw new Error('Expected a polygon reshape target.');
    this.reshapeSnapping.start({ ...target, geometry: target.geometry });
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  setReshapePath(coordinates: Coordinate[]): void {
    this.assertAlive(); this.session.setReshapePath(coordinates);
    this.pointer = undefined; this.cursor = undefined; this.setSnap(null);
    this.schedulePreview(); this.emitChange();
  }

  removeReshapePoint(): boolean {
    this.assertAlive(); const changed = this.session.removeReshapePoint();
    this.draftChanged(changed); return changed;
  }

  getReshapePreview(): ReshapePreview | null { return this.session.getReshapePreview(); }

  finishReshape(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'reshape-polygon' || !this.session.state.canFinish) return null;
    const event = this.session.finishReshape();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  setReshapeSide(side: ReshapeSide): void {
    this.assertAlive(); this.draftChanged(this.session.setReshapeSide(side));
  }

  /** Start an outside-to-outside cutting line on the selected polygon (cuts must avoid holes). */
  splitSelected(): boolean {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.splitSelected()) return false;
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  setSplitLine(coordinates: Coordinate[]): void {
    this.assertAlive(); this.session.setSplitLine(coordinates);
    this.pointer = undefined; this.cursor = undefined; this.setSnap(null);
    this.schedulePreview(); this.emitChange();
  }

  removeSplitPoint(): boolean {
    this.assertAlive(); const changed = this.session.removeSplitPoint();
    this.draftChanged(changed); return changed;
  }

  getSplitPreview(): SplitPreview | null { return this.session.getSplitPreview(); }

  finishSplit(): TransactionEvent | null {
    this.assertAlive();
    const event = this.session.finishSplit();
    if (!event) return null;
    this.leaveDrawing();
    return this.publishTransaction(event);
  }

  /** Begin a cancellable rotation of the selection around a fixed Mercator pivot. */
  rotateSelection(pivot?: Coordinate): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.rotateSelection(pivot)) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  setRotationAngle(degrees: number): boolean {
    this.assertAlive();
    this.rotation.stop();
    const changed = this.session.setRotationAngle(degrees);
    this.draftChanged(changed); return changed;
  }

  getRotationPreview(): GeometryFeatureCollection | null { return this.session.getRotationPreview(); }

  finishRotation(): TransactionEvent | null {
    this.assertAlive();
    this.rotation.stop();
    if (this.session.state.mode !== 'rotate-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishRotation();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Begin a cancellable scaling of the selection around a fixed Mercator pivot. */
  scaleSelection(pivot?: Coordinate): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.scaleSelection(pivot)) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  setScaleFactor(factor: number): boolean {
    this.assertAlive();
    const changed = this.session.setScaleFactor(factor);
    this.draftChanged(changed); return changed;
  }

  getScalePreview(): GeometryFeatureCollection | null { return this.session.getScalePreview(); }

  finishScale(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'scale-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishScale();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Begin a cancellable simplification of the selection with a Mercator-plane distance tolerance. */
  simplifySelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.simplifySelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  setSimplificationTolerance(meters: number): boolean {
    this.assertAlive();
    const changed = this.session.setSimplificationTolerance(meters);
    this.draftChanged(changed); return changed;
  }

  getSimplificationPreview(): GeometryFeatureCollection | null { return this.session.getSimplificationPreview(); }

  finishSimplification(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'simplify-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishSimplification();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Begin a cancellable offset of the selection with a signed Mercator-plane distance. */
  offsetSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.offsetSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  setOffsetDistance(meters: number): boolean {
    this.assertAlive();
    const changed = this.session.setOffsetDistance(meters);
    this.draftChanged(changed); return changed;
  }

  getOffsetPreview(): GeometryFeatureCollection | null { return this.session.getOffsetPreview(); }

  finishOffset(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'offset-lines' || !this.session.state.canFinish) return null;
    const event = this.session.finishOffset();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Begin a cancellable buffer of the selection with a positive Mercator-plane distance. */
  bufferSelection(distance = 10): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.bufferSelection(distance)) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  setBufferDistance(meters: number): boolean {
    this.assertAlive();
    const changed = this.session.setBufferDistance(meters);
    this.draftChanged(changed); return changed;
  }

  getBufferPreview(): GeometryFeatureCollection | null { return this.session.getBufferPreview(); }

  finishBuffer(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'buffer-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishBuffer();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Edit the common boundary of two selected single-ring polygons, keeping junctions fixed. */
  editSharedBoundary(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.editSharedBoundary()) return false;
    this.renderer.renderEditingMany(this.session.state.selectedFeatureIds);
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  getSharedBoundaryPreview(): SharedBoundaryPreview | null { return this.session.getSharedBoundaryPreview(); }

  finishSharedBoundary(): TransactionEvent | null {
    this.assertAlive();
    const initial = this.session.state;
    if (initial.mode !== 'edit-shared-boundary') return null;
    this.vertices.stop();
    const state = this.session.state;
    if (state.mode !== 'edit-shared-boundary' || !state.canFinish) return null;
    const event = this.session.finishSharedBoundary();
    if (this.session.state.mode !== 'idle') return null;
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Begin a cancellable edit of the selected feature; false with no selection/already editing. */
  editSelected(ringIndex = 0, partIndex = 0): boolean {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.editSelected(ringIndex, partIndex)) return false;
    this.renderer.renderEditing(this.session.state.selectedFeatureId);
    this.enterInteraction();
    this.schedulePreview();
    return true;
  }

  /** Begin drawing an interior ring; Finish saves, Cancel restores the original. */
  drawHole(partIndex = 0): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.drawHole(partIndex)) return false;
    this.renderer.renderEditing(this.session.state.selectedFeatureId);
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  deleteHole(ringIndex: number, partIndex = 0): TransactionEvent | null {
    this.assertAlive(); this.cancelIdleGestures();
    return this.publishTransaction(this.session.deleteHole(ringIndex, partIndex));
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
    this.cancelIdleGestures();
    const feature = this.session.deleteSelected();
    if (!feature) return null;
    this.renderer.renderSelection([]);
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.events.emit('delete', () => structuredClone(feature));
    this.emitChange();
    return feature;
  }

  /** Delete all selected features as one transaction, including a single selection. */
  deleteSelection(): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.deleteSelection());
  }

  /** Translate the current selection in longitude/latitude degrees, atomically. */
  translateSelection(delta: Coordinate): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.translateSelection(delta));
  }

  /** Create and select independent copies, optionally translated in degrees. */
  duplicateSelection(delta: Coordinate = [0, 0]): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.duplicateSelection(delta));
  }

  /** Start drawing. Finish/cancel the current draft before changing geometry type. */
  draw(kind: DrawGeometryType): void {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.start(kind)) return;
    this.renderer.renderSelection([]);
    this.enterInteraction();
  }

  /** Confirm a valid tool; null also represents a successfully committed empty overlay. */
  finish(): GeometryFeature | null {
    this.assertAlive();
    if (this.session.state.mode === 'offset-lines') {
      const preview = this.session.getOffsetPreview();
      if (!preview) return null;
      this.finishOffset();
      return preview.features[0]!;
    }
    if (this.session.state.mode === 'buffer-features') {
      const preview = this.session.getBufferPreview();
      if (!preview) return null;
      this.finishBuffer();
      return preview.features[0]!;
    }
    if (this.session.state.mode === 'simplify-features') {
      const preview = this.session.getSimplificationPreview();
      if (!preview) return null;
      this.finishSimplification();
      return preview.features[0]!;
    }
    if (this.session.state.mode === 'scale-features') {
      const preview = this.session.getScalePreview();
      if (!preview) return null;
      this.finishScale();
      return preview.features[0]!;
    }
    if (this.session.state.mode === 'rotate-features') {
      const preview = this.session.getRotationPreview();
      if (!preview) return null;
      this.finishRotation();
      return preview.features[0]!;
    }
    if (this.session.state.mode === 'edit-shared-boundary') {
      this.vertices.stop();
      if (!this.session.state.canFinish) return null;
      const original = this.session.getSelection()[0]!;
      return this.finishSharedBoundary()?.changes.find((change) => change.after?.id === original.id)?.after ?? original;
    }
    if (this.session.state.mode === 'difference-polygons') {
      const preview = this.session.getDifferencePreview();
      if (!preview) return null;
      const retained = this.session.getSelection()[0]!;
      const event = this.finishDifference();
      return preview.geometry ? event?.changes[0]?.after ?? retained : null;
    }
    if (this.session.state.mode === 'intersection-polygons') {
      const preview = this.session.getIntersectionPreview();
      if (!preview) return null;
      // Identical inputs can leave the retained geometry unchanged.
      const retained = this.session.getSelection()[0]!;
      const event = this.finishIntersection();
      return event && preview.geometry ? event.changes.find((change) => change.after?.id === retained.id)?.after ?? retained : null;
    }
    if (this.session.state.mode === 'union-polygons') {
      // A contained/identical union can have only deletions in its change list.
      const retained = this.session.getSelection()[0]!;
      const event = this.finishUnion();
      return event ? event.changes.find((change) => change.after?.id === retained.id)?.after ?? retained : null;
    }
    if (this.session.state.mode === 'reshape-polygon') {
      if (!this.session.state.canFinish) return null;
      const original = this.session.getSelected()!;
      return this.finishReshape()?.changes[0]?.after ?? original;
    }
    if (this.session.state.mode === 'split-polygon') return this.finishSplit()?.changes[0]?.after ?? null;
    this.vertices.stop();
    const before = this.session.state;
    const feature = this.session.finish();
    if (!feature) return null;
    this.leaveDrawing();
    if (this.session.state.dataRevision !== before.dataRevision) {
      this.renderer.renderCommitted(this.exportGeoJSON());
      this.events.emit(before.mode.startsWith('edit-') || before.mode === 'draw-hole' ? 'update' : 'create', () => structuredClone(feature));
    }
    this.emitChange();
    return feature;
  }

  cancel(): void {
    this.assertAlive();
    this.cancelIdleGestures();
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
    this.cancelIdleGestures();
    const imported = this.session.importGeoJSON(input);
    if (imported.features.length === 0) return imported;
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.events.emit('import', () => structuredClone(imported));
    this.emitChange();
    return imported;
  }

  /** Apply a mixed batch atomically; callbacks receive the complete committed changes. */
  applyTransaction(input: FeatureTransaction): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.applyTransaction(input));
  }

  onTransaction(listener: (event: TransactionEvent) => void): () => void {
    this.assertAlive();
    return this.events.on('transaction', listener);
  }

  onImport(listener: (collection: GeometryFeatureCollection) => void): () => void {
    this.assertAlive();
    return this.events.on('import', listener);
  }

  undo(): boolean { return this.replayHistory('undo'); }
  redo(): boolean { return this.replayHistory('redo'); }

  clearHistory(): void {
    this.assertAlive();
    this.translation.cancel();
    if (this.session.clearHistory()) this.emitChange();
  }

  onHistory(listener: (event: HistoryEvent) => void): () => void {
    this.assertAlive();
    return this.events.on('history', listener);
  }

  onCreate(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    return this.events.on('create', listener);
  }

  onDelete(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    return this.events.on('delete', listener);
  }

  onUpdate(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    return this.events.on('update', listener);
  }

  onChange(listener: (state: EditorState) => void): () => void {
    this.assertAlive();
    return this.events.on('change', listener);
  }

  /** Idempotently remove this editor's handlers and map resources. */
  destroy(): void {
    this.dispose(true);
  }

  // Internal coordination: input, rendering, notifications and lifecycle.

  private readonly handleClick = (event: MapMouseEvent): void => {
    const input = event.originalEvent;
    const state = this.session.state;
    if (input.button !== 0
      || input.ctrlKey || input.metaKey || input.shiftKey || input.detail > 1) return;
    if (state.mode === 'offset-lines' || state.mode === 'buffer-features' || state.mode === 'simplify-features' || state.mode === 'scale-features' || state.mode === 'rotate-features' || state.mode.startsWith('edit-') || state.mode === 'union-polygons' || state.mode === 'difference-polygons' || state.mode === 'intersection-polygons') return;
    if (state.mode === 'reshape-polygon' && state.canFinish) return;
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
    if (this.destroyed || !this.isDrawing()) return;
    this.schedulePreview();
    const trace = this.getTracePreview();
    if (trace && this.traceAnchor) {
      const changed = this.session.traceBoundary(this.traceAnchor.target, trace[0]!, trace.at(-1)!, this.tracing.side);
      if (changed) {
        this.traceAnchor.coordinate = this.session.getDraft().at(-1)!; this.traceCache = null;
        this.cursor = undefined; this.schedulePreview(); this.emitChange();
      }
      if (resolved.close) this.finish();
      return;
    }
    if (resolved.close) { this.finish(); return; }
    if (state.mode === 'reshape-polygon' && state.vertexCount === 0 && resolved.snap?.featureId !== state.selectedFeatureId) return;
    if (resolved.blocked || !this.session.add(resolved.coordinate)) return;
    if (state.mode === 'draw-point') { this.finish(); return; }
    this.traceAnchor = this.canTracePointer() && resolved.snap?.featureId !== null && resolved.snap && !this.altPressed
      ? { target: { featureId: resolved.snap.featureId, ...(resolved.snap.partIndex === undefined ? {} : { partIndex: resolved.snap.partIndex }),
        ...(resolved.snap.ringIndex === undefined ? {} : { ringIndex: resolved.snap.ringIndex }) }, coordinate: [...resolved.coordinate] } : null;
    this.traceCache = null;
    this.cursor = undefined;
    this.schedulePreview();
    this.emitChange();
  };

  private readonly handleMove = (event: MapMouseEvent): void => {
    if (!this.isDrawing()) return;
    this.pointer = { x: event.point.x, y: event.point.y };
    this.altPressed = event.originalEvent.altKey;
    this.schedulePreview();
  };

  private readonly handleLeave = (): void => {
    if (!this.isDrawing()) return;
    this.pointer = undefined;
    this.cursor = undefined;
    this.setSnap(null);
    this.schedulePreview();
  };

  private readonly handleSnapModifier = (event: KeyboardEvent): void => {
    if (event.key !== 'Alt') return;
    if (this.session.state.mode.startsWith('edit-')) {
      this.vertices.refresh(event.type === 'keydown');
      return;
    }
    if (!this.isDrawing()) return;
    this.altPressed = event.type === 'keydown';
    this.schedulePreview();
  };

  private readonly handleSnapBlur = (): void => {
    this.altPressed = false;
    this.pointer = undefined;
    this.cursor = undefined;
    this.setSnap(null);
    if (this.isDrawing()) this.schedulePreview();
  };

  private readonly handleStyleLoad = (): void => {
    this.rotation.stop(true);
    this.cancelIdleGestures();
    this.vertices.stop(true);
    this.renderer.mount();
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.renderer.renderSelection(this.session.state.selectedFeatureIds, true);
    this.renderer.renderEditing(this.session.state.mode.startsWith('edit-') || this.session.state.mode === 'draw-hole' ? this.session.state.selectedFeatureId : null);
    this.schedulePreview();
  };

  private readonly handleMapRemove = (): void => { this.dispose(false); };

  private readonly handleCameraMove = (): void => {
    this.cancelIdleGestures();
    this.snapping.invalidateCamera();
    this.reshapeSnapping.invalidateCamera();
    this.vertices.refresh();
    if (this.session.state.mode !== 'idle') this.schedulePreview();
  };

  private setSnap(result: SnapResult | null): void {
    const previous = this.snap;
    this.snap = result;
    // Pixel distance may change while the same exact vertex remains acquired.
    if (previous?.kind === result?.kind && previous?.featureId === result?.featureId && previous?.index === result?.index && previous?.ringIndex === result?.ringIndex && previous?.partIndex === result?.partIndex
      && previous?.coordinate[0] === result?.coordinate[0] && previous?.coordinate[1] === result?.coordinate[1]) return;
    this.events.emit('snap', () => result ? structuredClone(result) : null);
  }

  private resolvePointer(point: ScreenPoint, altPressed = this.altPressed): { coordinate: Coordinate; snap: SnapResult | null; close: boolean; blocked?: boolean } {
    const options = this.snapping.getOptions();
    const state = this.session.state;
    if (state.mode === 'reshape-polygon') {
      const attachment = this.reshapeSnapping.resolve(point);
      if (attachment) return { coordinate: attachment.coordinate, snap: attachment, close: false };
    }
    const first = (state.mode === 'draw-polygon' || state.mode === 'draw-hole') && state.vertexCount >= 3 ? this.session.getDraft()[0] : undefined;
    if (first) {
      const projected = this.map.project(first);
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
      const snapping = options.enabled && options.vertices && !altPressed;
      if (distance <= (snapping ? Math.max(8, options.distance) : 8)) return {
        coordinate: first, close: true,
        snap: snapping ? { kind: 'vertex', featureId: null, index: 0, coordinate: first, distance } : null,
      };
    }
    const excludedId = state.mode === 'edit-shared-boundary' ? new Set(state.selectedFeatureIds) : state.mode.startsWith('edit-') || state.mode === 'draw-hole' || state.mode === 'reshape-polygon' ? state.selectedFeatureId : null;
    const snap = altPressed ? null : this.snapping.resolve(point, state.dataRevision, () => this.session.exportGeoJSON(), excludedId, this.canTracePointer());
    const coordinate = snap?.coordinate ?? this.map.unproject([point.x, point.y]).wrap().toArray();
    if (!snap && !altPressed && this.drawingConstraints.enabled
      && (state.mode === 'draw-line' || state.mode === 'draw-polygon' || state.mode === 'draw-hole')) {
      const anchor = this.session.getLastDrawPoint();
      if (anchor) {
        const constrained = constrainDrawingPoint(anchor, coordinate, this.drawingConstraints.angleStep);
        return { coordinate: constrained ?? coordinate, snap: null, close: false, blocked: constrained === null };
      }
    }
    return { coordinate, snap, close: false };
  }

  private isDrawing(): boolean {
    const mode = this.session.state.mode;
    return mode.startsWith('draw-') || mode === 'split-polygon' || mode === 'reshape-polygon' && !this.session.state.canFinish;
  }

  private enterInteraction(cursor = 'crosshair'): void {
    this.previousCursor = this.canvas.style.cursor;
    this.canvas.style.cursor = cursor;
    this.restoreDoubleClickZoom = this.map.doubleClickZoom.isEnabled();
    this.map.doubleClickZoom.disable();
    this.canvas.focus({ preventScroll: true });
    this.emitChange();
  }

  private publishTransaction(event: TransactionEvent | null): TransactionEvent | null {
    if (!event) return null;
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.events.emit('transaction', () => structuredClone(event));
    this.emitChange();
    return event;
  }

  private replayHistory(direction: HistoryEvent['direction']): boolean {
    this.assertAlive();
    this.cancelIdleGestures();
    const event = this.session[direction]();
    if (!event) return false;
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.events.emit('history', () => structuredClone(event));
    this.emitChange();
    return true;
  }

  /** Stop transient selection/movement before a command changes their baseline. */
  private cancelIdleGestures(): void {
    this.selection.cancel();
    this.translation.cancel();
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('This GeometryEditor has been destroyed.');
  }

  private emitChange(): void {
    this.events.emit('change', () => this.getState());
  }

  private draftChanged(changed: boolean): void {
    if (!changed || this.destroyed) return;
    this.schedulePreview();
    this.emitChange();
  }

  private schedulePreview(): void {
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.pointer && this.isDrawing()) {
        const resolved = this.resolvePointer(this.pointer);
        this.cursor = resolved.blocked ? undefined : resolved.coordinate;
        this.setSnap(resolved.snap);
      }
      if (this.destroyed || this.translation.active) return;
      if (this.session.state.mode === 'offset-lines') {
        const preview = this.session.getOffsetPreview();
        this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
        this.renderer.renderTransform(preview);
        return;
      }
      if (this.session.state.mode === 'buffer-features') {
        const preview = this.session.getBufferPreview();
        this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
        this.renderer.renderTransform(preview);
        return;
      }
      if (this.session.state.mode === 'simplify-features') {
        const preview = this.session.getSimplificationPreview();
        this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
        this.renderer.renderTransform(preview);
        return;
      }
      if (this.session.state.mode === 'scale-features') {
        const preview = this.session.getScalePreview();
        this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
        this.renderer.renderTransform(preview, this.session.state.scalePivot!);
        return;
      }
      if (this.session.state.mode === 'rotate-features') {
        const preview = this.session.getRotationPreview();
        this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
        this.renderer.renderTransform(preview, this.session.state.rotationPivot!);
        const originals = this.session.getSelection();
        this.rotation.render(preview?.features ?? originals, originals, this.appearance);
        return;
      }
      if (this.session.state.mode === 'intersection-polygons') {
        const intersection = this.session.getIntersectionPreview();
        this.renderer.renderEditingMany(intersection ? this.session.state.selectedFeatureIds : [], true);
        this.renderer.renderOverlay(intersection?.geometry ?? null);
        return;
      }
      if (this.session.state.mode === 'union-polygons') {
        const union = this.session.getUnionPreview();
        this.renderer.renderEditingMany(union ? this.session.state.selectedFeatureIds : [], true);
        this.renderer.renderOverlay(union);
        return;
      }
      if (this.session.state.mode === 'difference-polygons') {
        const difference = this.session.getDifferencePreview();
        this.renderer.renderEditing(difference ? this.session.state.selectedFeatureIds[0]! : null);
        this.renderer.renderOverlay(difference?.geometry ?? null);
        return;
      }
      const reshape = this.session.getReshapePreview();
      if (this.session.state.mode === 'reshape-polygon') this.renderer.renderEditing(reshape ? this.session.state.selectedFeatureId : null);
      const split = this.session.getSplitPreview();
      if (this.session.state.mode === 'split-polygon') this.renderer.renderEditing(split ? this.session.state.selectedFeatureId : null);
      const shared = this.session.getSharedBoundaryPreview();
      if (this.session.state.mode === 'edit-shared-boundary') this.renderer.renderEditingMany(shared ? this.session.state.selectedFeatureIds : []);
      const trace = this.getTracePreview();
      this.renderer.renderPreview(this.session.getDraft(), reshape || trace ? undefined : this.cursor, this.session.state, this.snap, split, this.session.getDraftRings(), this.session.getInactiveParts(), reshape, trace, shared);
    });
  }

  private leaveDrawing(): void {
    this.rotation.clear();
    this.traceAnchor = null; this.traceCache = null;
    this.reshapeSnapping.clear();
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
    this.traceAnchor = null; this.traceCache = null;
    this.pointer = undefined;
    this.snap = null;
    this.snapping.clear();
    this.reshapeSnapping.clear();
    this.selection.destroy(removeResources);
    this.translation.destroy(removeResources);
    this.rotation.destroy(removeResources);
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
    this.keyboard.destroy();
    this.view.removeEventListener('keydown', this.handleSnapModifier);
    this.view.removeEventListener('keyup', this.handleSnapModifier);
    this.view.removeEventListener('blur', this.handleSnapBlur);
    this.events.clear();
    editors.delete(this.map);
    this.renderer.destroy(removeResources);
  }
}
