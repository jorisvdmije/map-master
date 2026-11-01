import { VertexKeyboard } from './vertex-keyboard.js';
import { resolveStyling, type EditorStylingOptions, type StylingIssue } from '../core/feature-styling.js';
import { lockedFeatureIds, sameLocks } from '../core/feature-locks.js';
import { constrainDrawingPoint, drawingConstraintsOptions } from '../core/drawing-constraints.js';
import { copyAppearance, resolveAppearance, type EditorAppearance, type EditorAppearanceOptions } from '../core/appearance.js';
import type { FitBoundsOptions, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { DrawShape } from '../core/shapes.js';
import { circleRadius } from '../core/shapes.js';
import { formatArea, formatDistance, measure, measurementOptions, pathLength, ringArea, ringPerimeter } from '../core/measurement.js';
import { geometryParts } from '../core/geometry.js';
import { MeasurementOverlay, type MeasurementLabel } from './measurement-overlay.js';
import { FreehandInteraction } from './freehand-interaction.js';
import { DrawingSession } from '../core/drawing-session.js';
import type { Coordinate, CutFeedback, VertexUpdate, DrawingConstraintsOptions, SharedBoundaryPreview, TraceTarget, TraceSide, TracingOptions, ReshapePreview, ReshapeSide, IntersectionPreview, DifferencePreview, UnionPreview, SplitPreview, FeatureTransaction, TransactionEvent, SnappingOptions, SnapResult, FeatureId, EditorState, EditorMode, EditorOptions, MeasurementOptions, HistoryEvent, GeometryFeatureCollection, GeometryFeature, DrawGeometryType, DataChangeEvent, DataChangeSource, FeatureChange } from '../core/types.js';
import { MapLibreRenderer } from './renderer.js';
import { BoundarySnapping } from './boundary-snapping.js';
import { MapLibreSnapping } from './snapping.js';
import type { ScreenPoint } from '../core/snapping.js';
import { VertexInteraction } from './vertex-interaction.js';
import { SelectionInteraction } from './selection-interaction.js';
import { pickEditVertices } from './vertex-handles.js';
import { TranslationInteraction } from './translation-interaction.js';
import { RotationInteraction } from './rotation-interaction.js';
import { ScalingInteraction } from './scaling-interaction.js';
import { DistanceInteraction } from './distance-interaction.js';
import { PivotInteraction } from './pivot-interaction.js';
import { EditorEvents } from './editor-events.js';
import { KeyboardInteraction } from './keyboard-interaction.js';
import { GeoJSONImportError } from '../core/geojson-import.js';

const editors = new WeakSet<MapLibreMap>();
let instances = 0;

function idGenerator(createId: unknown): () => FeatureId {
  if (typeof createId !== 'function') throw new TypeError('createId must be a function.');
  const generate = createId as () => unknown;
  return () => {
    const id = generate();
    if (typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id))) throw new TypeError('createId must return a string or finite number.');
    return id;
  };
}

/** Screen length below which a segment gets no measurement label. */
const minimumLabelSpacing = 64;

/** Whether the active drawing is a polygon ring that a click on its first corner closes. */
function closesRing(state: EditorState): boolean {
  return state.mode === 'draw-polygon' || state.mode === 'draw-hole' || state.mode === 'draw-cut'
    || state.mode === 'draw-part' && state.activeRingIndex !== null;
}

/** The renderer styles cuts and new parts like ordinary line and polygon drawing. */
function previewState(state: EditorState): EditorState {
  const mode: EditorMode = state.mode === 'draw-cut' ? 'draw-polygon'
    : state.mode === 'draw-part' ? state.activeRingIndex === null ? 'draw-line' : 'draw-polygon' : state.mode;
  return mode === state.mode ? state : { ...state, mode };
}

/** Where a shape's total is shown: the middle of a line, or the center of a polygon's largest part. */
function labelPoint(geometry: GeometryFeature['geometry']): Coordinate {
  const parts = geometryParts(geometry);
  const polygons = parts.flatMap((part) => part.type === 'Polygon' ? [part.coordinates[0]!] : []);
  if (polygons.length) {
    const ring = polygons.reduce((largest, candidate) => ringArea(candidate) > ringArea(largest) ? candidate : largest);
    const lngs = ring.map(([lng]) => lng); const lats = ring.map(([, lat]) => lat);
    return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  }
  const line = parts.flatMap((part) => part.type === 'LineString' ? [part.coordinates] : []).reduce<Coordinate[]>((longest, candidate) =>
    pathLength(candidate) > pathLength(longest) ? candidate : longest, []);
  if (line.length < 2) return line[0] ?? (parts[0]?.type === 'Point' ? parts[0].coordinates : [0, 0]);
  let remaining = pathLength(line) / 2;
  for (let index = 1; index < line.length; index++) {
    const a = line[index - 1]!; const b = line[index]!;
    const length = pathLength([a, b]);
    if (length >= remaining && length > 0) {
      const t = remaining / length;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= length;
  }
  return line.at(-1)!;
}

/**
 * Interactive geometry editor for one MapLibre map.
 *
 * The editor owns drawing, selection, vertex editing, validation, undo/redo and its
 * own map layers. The application owns the map, its controls and persistence.
 * Coordinates are WGS84 `[longitude, latitude]`; data is exchanged as GeoJSON.
 *
 * @example
 * ```ts
 * map.once('load', () => {
 *   const editor = new GeometryEditor(map, { snapping: { enabled: true } });
 *   editor.onDataChange(() => save(editor.exportGeoJSON()));
 *   editor.draw('Polygon'); // Click on the map; Enter finishes, Escape cancels.
 * });
 * ```
 */
export class GeometryEditor {
  private appearance: EditorAppearance;
  private drawingConstraints: DrawingConstraintsOptions;
  private tracing: TracingOptions;
  private traceAnchor: { target: TraceTarget; coordinate: Coordinate } | null = null;
  private traceCache: { key: string; path: Coordinate[] | null } | null = null;
  private readonly boundarySnapping: BoundarySnapping;
  private readonly snapping: MapLibreSnapping;
  private snap: SnapResult | null = null;
  private pointer: ScreenPoint | undefined;
  private altPressed = false;
  private readonly events: EditorEvents;
  private readonly keyboard: KeyboardInteraction;
  private readonly session: DrawingSession;
  private readonly renderer: MapLibreRenderer;
  private readonly vertices: VertexInteraction;
  private readonly vertexKeyboard: VertexKeyboard;
  private readonly selection: SelectionInteraction;
  private readonly freehand: FreehandInteraction;
  private freehandPath: Coordinate[] = [];
  private measurements: MeasurementOptions;
  private readonly measurementOverlay: MeasurementOverlay;
  private readonly translation: TranslationInteraction;
  private readonly rotation: RotationInteraction;
  private readonly scaling: ScalingInteraction;
  private readonly distance: DistanceInteraction;
  private readonly pivot: PivotInteraction;
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private cursor: Coordinate | undefined;
  private frame: number | undefined;
  private previousCursor = '';
  private restoreDoubleClickZoom = false;
  private destroyed = false;

  /**
   * Attach an editor to a map whose style has loaded, for example in a `load` handler.
   * @throws Error if the map already has an editor or its style has not loaded, or if
   * the page is not a secure context (HTTPS or localhost) able to generate feature IDs.
   */
  constructor(private readonly map: MapLibreMap, options: EditorOptions = {}) {
    if (editors.has(map)) throw new Error('Only one geometry editor can be attached to a map.');
    // getStyle() is available once the style is initialized, even if background
    // tiles are still loading. isStyleLoaded() also waits for source updates.
    if (!map.getStyle()) throw new Error('Create GeometryEditor after the map style.load event.');
    this.canvas = map.getCanvas();
    const view = this.canvas.ownerDocument.defaultView;
    if (!view) throw new Error('The map must belong to a browser window.');
    const uuid = typeof view.crypto?.randomUUID === 'function';
    if (!uuid && options.createId === undefined) {
      throw new Error('GeometryEditor requires HTTPS or localhost for feature IDs, or a createId option.');
    }
    const createId = options.createId === undefined ? () => view.crypto.randomUUID() : idGenerator(options.createId);
    this.view = view;
    this.measurements = measurementOptions(options.measurements);
    this.appearance = resolveAppearance(options.appearance);
    const styling = resolveStyling(options.styling);
    this.drawingConstraints = drawingConstraintsOptions(options.drawingConstraints);
    this.tracing = this.tracingOptions(options.tracing ?? {});
    this.events = new EditorEvents((error) => { view.queueMicrotask(() => { throw error; }); });
    this.session = new DrawingSession(createId, options.historyLimit, options.lockedFeatureIds);
    this.boundarySnapping = new BoundarySnapping(map);
    this.snapping = new MapLibreSnapping(map, options.snapping);
    this.renderer = new MapLibreRenderer(map, `geo-editor-${uuid ? view.crypto.randomUUID() : ++instances}`, this.appearance, styling);
    this.renderer.mount();
    this.measurementOverlay = new MeasurementOverlay(map);
    this.freehand = new FreehandInteraction(map, {
      enabled: () => !this.destroyed && this.session.state.mode === 'draw-freehand',
      preview: (path) => { this.freehandPath = path; this.schedulePreview(); },
      finish: (path) => {
        this.freehandPath = [];
        if (this.session.setFreehandPath(path)) this.finish();
        else this.schedulePreview();
      },
    });
    this.vertices = new VertexInteraction(map, {
      state: () => this.session.state, draft: () => this.session.getDraft(),
      select: (indices) => { this.draftChanged(this.session.selectVertices(indices)); },
      // Pointer movement is already coalesced by VertexInteraction. Upload its
      // preview in that frame instead of waiting for another animation frame.
      move: (updates) => { this.draftChanged(this.session.moveVertices(updates), true); },
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
      enabled: () => !this.destroyed && (this.session.state.mode === 'idle' || this.session.state.mode.startsWith('edit-')),
      toggle: (point) => {
        // VertexInteraction already handles Shift+click on an editable corner.
        if (this.session.state.mode !== 'idle') return;
        const id = this.renderer.pick(point);
        if (id !== null && this.session.hasFeature(id)) this.toggleSelection(id);
      },
      addBox: (start, end) => {
        const state = this.session.state;
        if (state.mode.startsWith('edit-')) {
          const indices = pickEditVertices(map, this.session.getDraft(), start, end, state.mode === 'edit-shared-boundary');
          this.selectVertices([...state.selectedVertexIndices, ...indices]);
          return;
        }
        const ids = this.renderer.pickBox(start, end).filter((id) => this.session.hasFeature(id));
        this.selectMany([...this.session.state.selectedFeatureIds, ...ids]);
      },
    });
    this.translation = new TranslationInteraction(map, {
      targets: (point) => {
        const state = this.session.state;
        if (this.destroyed || this.renderer.transferringTranslation || state.mode !== 'idle' || state.selectedFeatureIds.length === 0 || state.selectedFeatureIds.some((id) => this.session.isFeatureLocked(id))) return null;
        // A deliberately chosen underlying shape must remain draggable through
        // the overlap. Selection order is unchanged; only the grab target changes.
        const id = this.renderer.pickAll(point).find(id => state.selectedFeatureIds.includes(id));
        if (id === undefined) return null;
        const features = this.session.getSelection();
        return { features, grabbed: features.find(feature => feature.id === id)! };
      },
      resolve: (point, excluded) => this.snapping.resolve(point, this.session.state.dataRevision, () => this.session.exportGeoJSON(), excluded, true),
      snap: result => { if (!this.destroyed) this.setSnap(result); },
      appearance: () => this.appearance,
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
      angle: (degrees) => { this.pivot.stop(); this.draftChanged(this.session.setRotationAngle(degrees)); },
      finish: () => { this.finishRotation(); },
      cancel: () => { this.cancel(); },
    });
    this.scaling = new ScalingInteraction(map, {
      state: () => this.session.state,
      factors: (x, y) => { this.pivot.stop(); this.draftChanged(this.session.setScaleFactors(x, y)); },
      finish: () => { this.finishScale(); },
      cancel: () => { this.cancel(); },
    });
    this.distance = new DistanceInteraction(map, {
      state: () => this.session.state,
      distance: (kind, meters) => { this.draftChanged(kind === 'buffer' ? this.session.setBufferDistance(meters) : this.session.setOffsetDistance(meters)); },
      finish: kind => { if (kind === 'buffer') this.finishBuffer(); else this.finishOffset(); },
      cancel: () => { this.cancel(); },
    });
    this.pivot = new PivotInteraction(map, {
      state: () => this.session.state,
      snapping: () => this.snapping.getOptions(),
      start: () => { this.rotation.stop(); this.scaling.stop(); },
      pivot: (kind, coordinate) => { this.draftChanged(kind === 'rotation' ? this.session.setRotationPivot(coordinate) : this.session.setScalePivot(coordinate)); },
      finish: kind => { if (kind === 'rotation') this.finishRotation(); else this.finishScale(); },
      cancel: () => { this.cancel(); },
    });
    this.vertexKeyboard = new VertexKeyboard(map, {
      state: () => this.session.state, draft: () => this.session.getDraft(),
      start: () => { this.selection.cancel(); this.vertices.stop(true); this.setSnap(null); },
      select: indices => { this.draftChanged(this.session.selectVertices(indices)); },
      move: updates => { this.draftChanged(this.session.moveVertices(updates)); },
      remove: () => { const changed = this.session.removeSelectedVertices(); this.draftChanged(changed); return changed; },
      finish: () => { this.finish(); }, cancel: () => { this.cancel(); },
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
      removeSelectedVertices: () => { this.removeSelectedVertices(); },
      finish: () => { this.finish(); },
      cancel: () => { this.cancel(); },
      nudge: (x, y) => {
        if (this.session.state.selectedFeatureIds.some((id) => this.session.isFeatureLocked(id))) return false;
        const canvas = this.canvas;
        const from = this.map.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]);
        const to = this.map.unproject([canvas.clientWidth / 2 + x, canvas.clientHeight / 2 + y]);
        try { return this.translateSelection([to.lng - from.lng, to.lat - from.lat]) !== null; }
        catch (error) {
          // Moving past the world's edge is rejected like a dragged move.
          if (error instanceof GeoJSONImportError || error instanceof RangeError) return true;
          throw error;
        }
      },
    });
    this.view.addEventListener('keydown', this.handleSnapModifier);
    this.view.addEventListener('keyup', this.handleSnapModifier);
    this.view.addEventListener('blur', this.handleSnapBlur);
  }

  // Public API: application controls and subscriptions.

  /** A fresh snapshot of the active mode, selection, history availability and tool state. */
  getState(): EditorState {
    return this.session.state;
  }

  /** IDs the host has made read-only; see {@link GeometryEditor.setLockedFeatureIds}. */
  getLockedFeatureIds(): FeatureId[] { return this.session.getLockedFeatureIds(); }
  /** Whether a feature is currently locked against changes. */
  isFeatureLocked(id: FeatureId): boolean { return this.session.isFeatureLocked(id); }

  /**
   * Replace the set of read-only feature IDs.
   *
   * Locked features cannot be edited, moved or deleted and history entries touching them
   * are blocked, but they remain snapping and tracing targets. An active tool that changes
   * a newly locked feature is cancelled. Locks are UI policy, not authorization.
   */
  setLockedFeatureIds(ids: readonly FeatureId[]): void {
    this.assertAlive();
    const next = lockedFeatureIds(ids);
    if (sameLocks(new Set(this.session.getLockedFeatureIds()), next)) return;
    this.cancelIdleGestures();
    this.vertices.stop(true);
    this.rotation.stop();
    this.scaling.stop(); this.pivot.stop();
    this.distance.stop();
    const wasDrawing = this.session.state.mode !== 'idle';
    this.session.setLockedFeatureIds([...next]);
    if (wasDrawing && this.session.state.mode === 'idle') this.leaveDrawing();
    this.emitChange();
  }

  /** A copy of the complete resolved appearance: colors, outlines and marker sizes. */
  getAppearance(): EditorAppearance { return copyAppearance(this.appearance); }

  /**
   * Patch presentation settings. The patch is validated atomically; data, drafts and
   * history are never affected, and the settings survive map style changes.
   * @throws TypeError if a value is invalid; the appearance is then unchanged.
   */
  setAppearance(patch: EditorAppearanceOptions): void {
    this.assertAlive();
    const next = resolveAppearance(patch, this.appearance);
    if (JSON.stringify(next) === JSON.stringify(this.appearance)) return;
    this.appearance = next;
    this.renderer.setAppearance(next);
    this.translation.refresh();
    if (['rotate-features', 'scale-features', 'buffer-features', 'offset-lines'].includes(this.session.state.mode)) this.schedulePreview();
    this.emitChange();
  }

  /** The current per-feature styling options. */
  getStyling(): EditorStylingOptions { return this.renderer.getStyling(); }
  /** Problems found while applying styling rules, such as a resolver that threw. */
  getStylingIssues(): StylingIssue[] { return this.renderer.getStylingIssues(); }
  /** Replace the per-feature styling rules. Presentation only: no data or history change. */
  setStyling(options: EditorStylingOptions): void {
    this.assertAlive();
    const next = resolveStyling(options);
    this.renderer.setStyling(next);
    this.emitChange();
  }
  /** Re-run the styling rules after application state they depend on has changed. */
  refreshStyling(): void {
    this.assertAlive(); this.renderer.refreshStyling(); this.emitChange();
  }

  private tracingOptions(update: Partial<TracingOptions>, previous: TracingOptions = { enabled: false, side: 'shorter' }): TracingOptions {
    const options = { ...previous, ...update };
    if (typeof options.enabled !== 'boolean' || options.side !== 'shorter' && options.side !== 'longer') throw new TypeError('Invalid tracing options.');
    return options;
  }

  /** The current boundary-tracing options. */
  getTracing(): TracingOptions { return { ...this.tracing }; }
  /**
   * Update boundary tracing: while drawing, clicking along an existing line or ring
   * follows its corners. Pointer tracing requires snapping to be enabled.
   */
  setTracing(update: Partial<TracingOptions>): void {
    this.assertAlive();
    const next = this.tracingOptions(update, this.tracing);
    if (next.enabled === this.tracing.enabled && next.side === this.tracing.side) return;
    this.tracing = next; this.traceCache = null;
    if (!next.enabled) this.traceAnchor = null;
    this.schedulePreview(); this.emitChange();
  }

  /**
   * Append the section of an existing line or ring between two points to the active
   * line, polygon or hole draft. Works without the tracing toggle or pointer snapping.
   * @returns false when no draft accepts the section.
   */
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

  /**
   * Undo the last click while drawing a line, polygon or hole; a traced section
   * counts as one step.
   * @returns false when there is nothing to remove.
   */
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

  /**
   * The route a click at the current pointer position would trace, or null.
   * Reading it never changes the draft.
   */
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
      && (mode === 'draw-line' || mode === 'draw-polygon' || mode === 'draw-hole' || mode === 'draw-cut' || mode === 'draw-part');
  }

  /** The current angle-constraint options. */
  getDrawingConstraints(): DrawingConstraintsOptions { return { ...this.drawingConstraints }; }
  /**
   * Update the optional 45°/90° direction grid for new line, polygon and hole
   * segments. Exact snaps, tracing and closing a ring take priority; holding Alt bypasses it.
   */
  setDrawingConstraints(update: Partial<DrawingConstraintsOptions>): void {
    this.assertAlive();
    const next = drawingConstraintsOptions(update, this.drawingConstraints);
    if (next.enabled === this.drawingConstraints.enabled && next.angleStep === this.drawingConstraints.angleStep) return;
    this.drawingConstraints = next;
    this.schedulePreview(); this.emitChange();
  }

  /** The current snapping options. */
  getSnapping(): SnappingOptions { return this.snapping.getOptions(); }
  /**
   * Update snapping for drawing, vertex dragging and moving shapes. Vertices take
   * priority over edges; holding Alt places freely.
   */
  setSnapping(options: Partial<SnappingOptions>): void {
    this.assertAlive();
    if (!this.snapping.setOptions(options)) return;
    if (!this.snapping.getOptions().enabled) { this.traceAnchor = null; this.traceCache = null; }
    this.vertices.refresh();
    this.pivot.refresh();
    this.translation.refresh();
    if (this.pointer && this.isDrawing()) {
      const resolved = this.resolvePointer(this.pointer);
      this.cursor = resolved.blocked ? undefined : resolved.coordinate;
      this.setSnap(resolved.snap);
    }
    this.schedulePreview();
    this.emitChange();
  }
  /** The snap target currently under the pointer, or null. */
  getSnap(): SnapResult | null { return this.snap ? { ...this.snap, coordinate: [...this.snap.coordinate] } : null; }
  /**
   * Subscribe to changes of the acquired snap target.
   * @returns A function that unsubscribes.
   */
  onSnap(listener: (result: SnapResult | null) => void): () => void {
    this.assertAlive();
    return this.events.on('snap', listener);
  }

  /**
   * Select one committed feature, or pass null to clear the selection. Only while idle.
   * @throws RangeError if the ID is unknown.
   */
  select(id: FeatureId | null): void {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.select(id)) return;
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.emitChange();
  }

  /**
   * Replace the selection with these features, in order; duplicates are ignored.
   * @throws RangeError if any ID is unknown; the selection is then unchanged.
   */
  selectMany(ids: readonly FeatureId[]): void {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.selectMany(ids)) return;
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.emitChange();
  }

  /**
   * Add a feature to the selection, or remove it if it is already selected.
   * @throws RangeError if the ID is unknown.
   */
  toggleSelection(id: FeatureId): void {
    this.assertAlive(); this.cancelIdleGestures();
    this.session.toggleSelection(id);
    this.renderer.renderSelection(this.session.state.selectedFeatureIds);
    this.emitChange();
  }

  /** Copies of all selected features, in the order they were selected. */
  getSelection(): GeometryFeature[] { return this.session.getSelection(); }

  /** A copy of the selected feature when exactly one is selected, otherwise null. */
  getSelected(): GeometryFeature | null {
    return this.session.getSelected();
  }

  /** Independent committed snapshots at a canvas-relative CSS-pixel point.
   * Rendered marker/outline hits precede polygon interiors. Idle only; querying
   * never changes selection, data or history. Stale/deleted hits are excluded.
   */
  queryFeatures(point: { x: number; y: number }): GeometryFeature[] {
    this.assertAlive();
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError('Expected a finite screen point.');
    if (this.session.state.mode !== 'idle' || this.translation.active
      || point.x < 0 || point.y < 0 || point.x > this.canvas.clientWidth || point.y > this.canvas.clientHeight) return [];
    return this.renderer.pickAll(point).flatMap(id => {
      const feature = this.session.getFeature(id);
      return feature ? [feature] : [];
    });
  }

  /** A copy of one committed feature, or null if the ID is unknown. */
  getFeature(id: FeatureId): GeometryFeature | null { return this.session.getFeature(id); }

  /** A copy of the active draft's coordinates (the open ring for polygons), or an empty array. */
  getDraft(): Coordinate[] { return this.session.getDraft(); }

  /**
   * Preview the union of two or more selected polygons. Confirm with
   * {@link GeometryEditor.finish} or {@link GeometryEditor.finishUnion}; discard with {@link GeometryEditor.cancel}.
   * @returns false if the selection does not qualify.
   */
  unionSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.unionSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /** The merged geometry while a union is active and valid, otherwise null. */
  getUnionPreview(): UnionPreview | null { return this.session.getUnionPreview(); }

  /**
   * Commit the union as one undo step. The first selected feature keeps its ID and
   * properties; the other inputs are deleted.
   * @returns null when no valid union is active.
   */
  finishUnion(): TransactionEvent | null {
    this.assertAlive();
    const event = this.session.finishUnion();
    if (!event) return null;
    this.leaveDrawing();
    return this.publishTransaction(event);
  }

  /**
   * Preview the area shared by all selected polygons.
   * @returns false if the selection does not qualify.
   */
  intersectionSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.intersectionSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /**
   * The intersection while active and valid, otherwise null. A null `geometry`
   * means the result is empty.
   */
  getIntersectionPreview(): IntersectionPreview | null { return this.session.getIntersectionPreview(); }

  /**
   * Commit the intersection into the first selected feature and delete the other
   * inputs, as one undo step. An empty result deletes every input.
   * @returns null when no valid intersection is active.
   */
  finishIntersection(): TransactionEvent | null {
    this.assertAlive();
    const event = this.session.finishIntersection();
    if (!event) return null;
    this.leaveDrawing();
    return this.publishTransaction(event);
  }

  /**
   * Preview subtracting the other selected polygons from the first one.
   * The cutters are kept.
   * @returns false if the selection does not qualify.
   */
  differenceSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.differenceSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /**
   * The subtraction result while active and valid, otherwise null. A null
   * `geometry` means the target would be deleted.
   */
  getDifferencePreview(): DifferencePreview | null { return this.session.getDifferencePreview(); }

  /**
   * Commit the subtraction to the first selected feature as one undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishDifference(): TransactionEvent | null {
    this.assertAlive();
    const state = this.session.state;
    if (state.mode !== 'difference-polygons' || !state.canFinish) return null;
    const event = this.session.finishDifference();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /**
   * Start replacing one boundary section of the selected single-ring polygon with a
   * new path drawn from boundary to boundary.
   * @returns false if the selection does not qualify.
   */
  reshapeSelected(): boolean {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.reshapeSelected()) return false;
    const target = this.session.getSelected()!;
    if (target.geometry.type !== 'Polygon') throw new Error('Expected a polygon reshape target.');
    this.boundarySnapping.start({ ...target, geometry: target.geometry });
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  /** Replace the reshape route; its endpoints must lie on the original boundary. */
  setReshapePath(coordinates: Coordinate[]): void {
    this.assertAlive(); this.session.setReshapePath(coordinates);
    this.pointer = undefined; this.cursor = undefined; this.setSnap(null);
    this.schedulePreview(); this.emitChange();
  }

  /**
   * Remove the last reshape route point.
   * @returns false if the route is empty.
   */
  removeReshapePoint(): boolean {
    this.assertAlive(); const changed = this.session.removeReshapePoint();
    this.draftChanged(changed); return changed;
  }

  /** The reshaped polygon geometry while the route is valid, otherwise null. */
  getReshapePreview(): ReshapePreview | null { return this.session.getReshapePreview(); }

  /**
   * Commit the reshape as one update and undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishReshape(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'reshape-polygon' || !this.session.state.canFinish) return null;
    const event = this.session.finishReshape();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /** Choose which boundary arc between the route endpoints is replaced; default `'shorter'`. */
  setReshapeSide(side: ReshapeSide): void {
    this.assertAlive(); this.draftChanged(this.session.setReshapeSide(side));
  }

  /**
   * Start cutting the selected polygon in two. The cutting line must start and end on
   * or outside the boundary and may not cross holes.
   * @returns false if the selection does not qualify.
   */
  splitSelected(): boolean {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.splitSelected()) return false;
    const target = this.session.getSelected()!;
    if (target.geometry.type !== 'Polygon') throw new Error('Expected a polygon split target.');
    this.boundarySnapping.start({ ...target, geometry: target.geometry });
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  /** Replace the cutting line with these coordinates. */
  setSplitLine(coordinates: Coordinate[]): void {
    this.assertAlive(); this.session.setSplitLine(coordinates);
    this.pointer = undefined; this.cursor = undefined; this.setSnap(null);
    this.schedulePreview(); this.emitChange();
  }

  /**
   * Remove the last cutting-line point.
   * @returns false if the line is empty.
   */
  removeSplitPoint(): boolean {
    this.assertAlive(); const changed = this.session.removeSplitPoint();
    this.draftChanged(changed); return changed;
  }

  /**
   * Split/reshape diagnostics for the placed points: boundary contacts and localized
   * problems. Null outside those tools.
   */
  getCutFeedback(): CutFeedback | null { return this.session.getCutFeedback(); }

  /** Both resulting polygons while the cut is valid, otherwise null. */
  getSplitPreview(): SplitPreview | null { return this.session.getSplitPreview(); }

  /**
   * Commit the split as one undo step: the original feature keeps one part and a new
   * feature with copied properties receives the other.
   * @returns null when no valid split is active.
   */
  finishSplit(): TransactionEvent | null {
    this.assertAlive();
    const event = this.session.finishSplit();
    if (!event) return null;
    this.leaveDrawing();
    return this.publishTransaction(event);
  }

  /**
   * Start rotating the selection around a pivot; by default the centre of its bounds.
   * @returns false if the selection does not qualify.
   */
  rotateSelection(pivot?: Coordinate): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.rotateSelection(pivot)) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /**
   * Set the absolute clockwise angle in degrees, relative to the original geometry.
   * @returns whether the preview changed.
   */
  setRotationAngle(degrees: number): boolean {
    this.assertAlive();
    this.rotation.stop(); this.pivot.stop();
    const changed = this.session.setRotationAngle(degrees);
    this.draftChanged(changed); return changed;
  }

  /** Move the pivot while keeping the current angle; omit it to reset to the centre. */
  setRotationPivot(pivot?: Coordinate): boolean {
    this.assertAlive(); this.rotation.stop(); this.pivot.stop();
    const changed = this.session.setRotationPivot(pivot);
    this.draftChanged(changed); return changed;
  }

  /** The rotated features while the preview is valid, otherwise null. */
  getRotationPreview(): GeometryFeatureCollection | null { return this.session.getRotationPreview(); }

  /**
   * Commit the rotation as one undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishRotation(): TransactionEvent | null {
    this.assertAlive();
    this.rotation.stop(); this.pivot.stop();
    if (this.session.state.mode !== 'rotate-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishRotation();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /**
   * Start scaling the selection around a pivot; by default the centre of its bounds.
   * @returns false if the selection does not qualify.
   */
  scaleSelection(pivot?: Coordinate): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.scaleSelection(pivot)) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /**
   * Set one positive factor for both axes, relative to the original geometry.
   * @returns whether the preview changed.
   */
  setScaleFactor(factor: number): boolean {
    this.assertAlive();
    this.scaling.stop(); this.pivot.stop();
    const changed = this.session.setScaleFactor(factor);
    this.draftChanged(changed); return changed;
  }

  /**
   * Set independent positive horizontal and vertical factors.
   * @returns whether the preview changed.
   */
  setScaleFactors(horizontal: number, vertical: number): boolean {
    this.assertAlive(); this.scaling.stop(); this.pivot.stop();
    const changed = this.session.setScaleFactors(horizontal, vertical);
    this.draftChanged(changed); return changed;
  }

  /** Move the pivot while keeping the current factors; omit it to reset to the centre. */
  setScalePivot(pivot?: Coordinate): boolean {
    this.assertAlive(); this.scaling.stop(); this.pivot.stop();
    const changed = this.session.setScalePivot(pivot);
    this.draftChanged(changed); return changed;
  }

  /** The scaled features while the preview is valid, otherwise null. */
  getScalePreview(): GeometryFeatureCollection | null { return this.session.getScalePreview(); }

  /**
   * Commit the scaling as one undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishScale(): TransactionEvent | null {
    this.assertAlive(); this.scaling.stop(); this.pivot.stop();
    if (this.session.state.mode !== 'scale-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishScale();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /**
   * Start simplifying the selected lines and polygons; the tolerance starts at 0.
   * @returns false if the selection does not qualify.
   */
  simplifySelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.simplifySelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /**
   * Set the non-negative tolerance in Mercator meters, applied to the original geometry.
   * @returns whether the preview changed.
   */
  setSimplificationTolerance(meters: number): boolean {
    this.assertAlive();
    const changed = this.session.setSimplificationTolerance(meters);
    this.draftChanged(changed); return changed;
  }

  /** The simplified features while the preview is valid, otherwise null. */
  getSimplificationPreview(): GeometryFeatureCollection | null { return this.session.getSimplificationPreview(); }

  /**
   * Commit the simplification as one undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishSimplification(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'simplify-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishSimplification();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /**
   * Start offsetting the selected simple open lines; the distance starts at 0.
   * @returns false if the selection does not qualify.
   */
  offsetSelection(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.offsetSelection()) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /**
   * Set the signed offset in Mercator meters: positive is left of the line direction,
   * negative is right.
   * @returns whether the preview changed.
   */
  setOffsetDistance(meters: number): boolean {
    this.assertAlive(); this.distance.stop();
    const changed = this.session.setOffsetDistance(meters);
    this.draftChanged(changed); return changed;
  }

  /** The offset lines while the preview is valid, otherwise null. */
  getOffsetPreview(): GeometryFeatureCollection | null { return this.session.getOffsetPreview(); }

  /**
   * Commit the offset as one undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishOffset(): TransactionEvent | null {
    this.assertAlive(); this.distance.stop();
    if (this.session.state.mode !== 'offset-lines' || !this.session.state.canFinish) return null;
    const event = this.session.finishOffset();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /**
   * Start buffering the selected lines and polygons outward by a positive distance in
   * Mercator meters.
   * @returns false if the selection does not qualify.
   */
  bufferSelection(distance = 10): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.bufferSelection(distance)) return false;
    this.enterInteraction('default'); this.schedulePreview(); return true;
  }

  /**
   * Set the positive buffer distance in Mercator meters.
   * @returns whether the preview changed.
   */
  setBufferDistance(meters: number): boolean {
    this.assertAlive(); this.distance.stop();
    const changed = this.session.setBufferDistance(meters);
    this.draftChanged(changed); return changed;
  }

  /** The buffered features while the preview is valid, otherwise null. */
  getBufferPreview(): GeometryFeatureCollection | null { return this.session.getBufferPreview(); }

  /**
   * Commit the buffer as one undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishBuffer(): TransactionEvent | null {
    this.assertAlive(); this.distance.stop();
    if (this.session.state.mode !== 'buffer-features' || !this.session.state.canFinish) return null;
    const event = this.session.finishBuffer();
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /**
   * Edit the common boundary of two selected single-ring polygons together; the
   * junctions stay fixed.
   * @returns false if the selection has no exactly shared boundary.
   */
  editSharedBoundary(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.editSharedBoundary()) return false;
    this.renderer.renderEditingMany(this.session.state.selectedFeatureIds);
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  /** Both updated polygons while the edit is valid, otherwise null. */
  getSharedBoundaryPreview(): SharedBoundaryPreview | null { return this.session.getSharedBoundaryPreview(); }

  /**
   * Save both polygons as one undo step.
   * @returns null when inactive, invalid or unchanged.
   */
  finishSharedBoundary(): TransactionEvent | null {
    this.assertAlive();
    const initial = this.session.state;
    if (initial.mode !== 'edit-shared-boundary') return null;
    this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    const state = this.session.state;
    if (state.mode !== 'edit-shared-boundary' || !state.canFinish) return null;
    const event = this.session.finishSharedBoundary();
    if (this.session.state.mode !== 'idle') return null;
    this.leaveDrawing();
    if (!event) { this.emitChange(); return null; }
    return this.publishTransaction(event);
  }

  /**
   * Start editing the vertices of the selected feature. Choose a ring for polygons
   * (0 is the exterior) and a part for multipart features. Save with {@link GeometryEditor.finish}
   * and discard with {@link GeometryEditor.cancel}.
   * @returns false without a single unlocked selected feature.
   * @throws RangeError if the ring or part index does not exist.
   */
  editSelected(ringIndex = 0, partIndex = 0): boolean {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.editSelected(ringIndex, partIndex)) return false;
    this.renderer.renderEditing(this.session.state.selectedFeatureId);
    this.enterInteraction();
    this.schedulePreview();
    return true;
  }

  /**
   * Start drawing a hole in the selected polygon (or one part of a multipolygon).
   * {@link GeometryEditor.finish} saves it; {@link GeometryEditor.cancel} discards it.
   * @returns false if the selection does not qualify.
   */
  drawHole(partIndex = 0): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.drawHole(partIndex)) return false;
    this.renderer.renderEditing(this.session.state.selectedFeatureId);
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  /**
   * Draw a new part for the selected line or polygon. Finishing turns the feature into a
   * MultiLineString or MultiPolygon; the new polygon part may not overlap the others.
   * @returns false if the selection is not exactly one unlocked line or polygon.
   */
  drawPart(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.drawPart()) return false;
    this.renderer.renderEditing(this.session.state.selectedFeatureId);
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  /**
   * Split every selected MultiPolygon or MultiLineString into one feature per part, as one
   * undo step. The first part keeps the ID; the others get new IDs and copied properties.
   * @returns null if no selected feature is multipart or the selection contains a locked feature.
   */
  explodeSelection(): TransactionEvent | null {
    this.assertAlive(); this.cancelIdleGestures();
    return this.publishTransaction(this.session.explodeSelection());
  }

  /**
   * Combine two or more selected polygons, or lines, into one multipart feature as one undo
   * step. The first selected feature keeps its ID and properties; the others are deleted.
   * @returns null if the selection is mixed, contains a locked feature, or has overlapping
   * polygons. Merge overlapping polygons with {@link GeometryEditor.unionSelection}.
   */
  combineSelection(): TransactionEvent | null {
    this.assertAlive(); this.cancelIdleGestures();
    return this.publishTransaction(this.session.combineSelection());
  }

  /**
   * Draw a polygon that cuts away from the selected features, or from every unlocked feature
   * when nothing is selected. Polygons lose the area, lines lose the parts inside, markers
   * stay. Finish with {@link GeometryEditor.finish} (or Enter, or by closing the ring).
   * @returns false if the selection contains a locked feature.
   */
  drawCut(): boolean {
    this.assertAlive(); this.cancelIdleGestures();
    if (!this.session.drawCut()) return false;
    this.enterInteraction(); this.schedulePreview(); return true;
  }

  /**
   * Apply the drawn cut as one undo step. Features left without geometry are deleted.
   * @returns null if the cut polygon is invalid; the tool then stays active. When the cut
   * overlaps nothing, the tool ends and null is returned.
   */
  finishCut(): TransactionEvent | null {
    this.assertAlive();
    if (this.session.state.mode !== 'draw-cut' || !this.session.state.canFinish) return null;
    this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    const event = this.session.finishCut();
    // A failed calculation keeps the tool; a cut that overlaps nothing has already ended it.
    if (!event && this.session.state.mode === 'draw-cut') return null;
    this.leaveDrawing();
    if (event) return this.publishTransaction(event);
    this.emitChange();
    return null;
  }

  /** The current measurement options. */
  getMeasurements(): MeasurementOptions { return { ...this.measurements }; }

  /**
   * Show or hide live length and area labels, or change their units and number format.
   * @throws TypeError or RangeError for invalid options.
   */
  setMeasurements(update: Partial<MeasurementOptions>): void {
    this.assertAlive();
    const next = measurementOptions(update, this.measurements);
    if (JSON.stringify(next) === JSON.stringify(this.measurements)) return;
    this.measurements = next;
    this.renderMeasurements();
    this.events.emit('change', () => this.getState());
  }

  /**
   * Move the camera to show the given features, the selection, or else every feature.
   * `options` are passed to MapLibre's `fitBounds`; the default padding is 48 pixels.
   * @returns false if there is nothing to show.
   */
  zoomToFeatures(ids?: readonly FeatureId[], options: FitBoundsOptions = {}): boolean {
    this.assertAlive();
    const selected = this.session.state.selectedFeatureIds;
    const targets = ids ?? (selected.length ? selected : null);
    const features = targets ? targets.map((id) => this.session.getFeature(id)).filter((feature): feature is GeometryFeature => feature !== null)
      : this.session.exportGeoJSON().features;
    const points = features.flatMap((feature) => geometryParts(feature.geometry).flatMap((part) =>
      part.type === 'Point' ? [part.coordinates] : part.type === 'LineString' ? part.coordinates : part.coordinates[0]!));
    if (!points.length) return false;
    const lngs = points.map(([lng]) => lng); const lats = points.map(([, lat]) => lat);
    this.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 18, ...options });
    return true;
  }

  /**
   * Remove an interior ring (index 1 or higher) from the selected polygon as one undo step.
   * @returns null if the selection does not qualify.
   */
  deleteHole(ringIndex: number, partIndex = 0): TransactionEvent | null {
    this.assertAlive(); this.cancelIdleGestures();
    return this.publishTransaction(this.session.deleteHole(ringIndex, partIndex));
  }

  /** Select one vertex of the edit draft by index, or clear the vertex selection with null. */
  selectVertex(index: number | null): void {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    this.draftChanged(this.session.selectVertex(index));
  }

  /** Select several vertices of the edit draft; an empty array clears the selection. */
  selectVertices(indices: readonly number[]): void {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    this.draftChanged(this.session.selectVertices(indices));
  }

  /** Move several vertices of the edit draft to absolute coordinates at once and select them. */
  moveVertices(updates: readonly VertexUpdate[]): void {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    this.draftChanged(this.session.moveVertices(updates));
  }

  /**
   * Move the selected vertices by a `[longitude, latitude]` offset in degrees,
   * without snapping.
   */
  translateSelectedVertices(delta: Coordinate): void {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    this.draftChanged(this.session.translateSelectedVertices(delta));
  }

  /**
   * Remove every selected vertex.
   * @returns false if the geometry would become too small or a fixed junction is selected.
   */
  removeSelectedVertices(): boolean {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    const changed = this.session.removeSelectedVertices(); this.draftChanged(changed); return changed;
  }

  /** Move one vertex of the edit draft to an absolute coordinate and select it. */
  moveVertex(index: number, coordinate: Coordinate): void {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    this.draftChanged(this.session.moveVertex(index, coordinate));
  }

  /** Insert a vertex at a draft index, shifting later vertices, and select it. */
  insertVertex(index: number, coordinate: Coordinate): void {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    this.draftChanged(this.session.insertVertex(index, coordinate));
  }

  /**
   * Remove one vertex of the edit draft.
   * @returns false if the geometry would become too small.
   */
  removeVertex(index: number): boolean {
    this.assertAlive(); this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    const changed = this.session.removeVertex(index);
    this.draftChanged(changed);
    return changed;
  }

  /**
   * Delete the single selected feature as one undo step.
   * @returns The deleted feature, or null when nothing is selected or it is locked.
   * @throws RangeError when several features are selected; use {@link GeometryEditor.deleteSelection}.
   */
  deleteSelected(): GeometryFeature | null {
    this.assertAlive();
    this.cancelIdleGestures();
    const feature = this.session.deleteSelected();
    if (!feature) return null;
    this.renderer.renderSelection([]);
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.events.emit('delete', () => structuredClone(feature));
    this.emitData('delete', [{ before: feature, after: null }]);
    this.emitChange();
    return feature;
  }

  /**
   * Delete every selected feature as one undo step.
   * @returns The committed changes, or null when nothing was deleted.
   */
  deleteSelection(): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.deleteSelection());
  }

  /**
   * Move the selection by a `[longitude, latitude]` offset in degrees as one undo step.
   * @returns The committed changes, or null when nothing moved.
   */
  translateSelection(delta: Coordinate): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.translateSelection(delta));
  }

  /**
   * Copy the selection with new IDs, optionally offset in degrees, and select the copies.
   * One undo step.
   * @returns The committed changes, or null when nothing is selected.
   */
  duplicateSelection(delta: Coordinate = [0, 0]): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.duplicateSelection(delta));
  }

  /**
   * Start drawing a new feature and focus the map. Users click to add points;
   * {@link GeometryEditor.finish} (or Enter) commits and {@link GeometryEditor.cancel} (or Escape) discards.
   * Calling it again with the active type keeps the draft.
   * @throws Error when another tool is active; finish or cancel it first.
   */
  draw(kind: DrawGeometryType | DrawShape): void {
    this.assertAlive();
    this.cancelIdleGestures();
    if (!this.session.start(kind)) return;
    this.renderer.renderSelection([]);
    this.freehand.setEnabled(kind === 'Freehand');
    this.enterInteraction();
  }

  /**
   * Confirm the active tool: commit the drawing or edit, or apply the active geometry operation.
   * @returns The created or updated feature, or null when nothing valid is active. A valid
   * difference or intersection with an empty result also returns null after committing.
   */
  finish(): GeometryFeature | null {
    this.assertAlive();
    if (this.session.state.mode === 'draw-cut') {
      return this.finishCut()?.changes.find((change) => change.after !== null)?.after ?? null;
    }
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
      this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
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
    this.vertexKeyboard.stop(); this.selection.cancel(); this.vertices.stop();
    const before = this.session.state;
    const editing = before.mode.startsWith('edit-') || before.mode === 'draw-hole' || before.mode === 'draw-part';
    const original = editing && before.selectedFeatureId !== null ? this.session.getFeature(before.selectedFeatureId) : null;
    const feature = this.session.finish();
    if (!feature) return null;
    this.leaveDrawing();
    if (this.session.state.dataRevision !== before.dataRevision) {
      this.renderer.renderCommitted(this.exportGeoJSON());
      this.events.emit(editing ? 'update' : 'create', () => structuredClone(feature));
      this.emitData(editing ? 'update' : 'create', [{ before: original, after: feature }]);
    }
    this.emitChange();
    return feature;
  }

  /**
   * Discard the active draft, edit or preview without changing data. Also stops a
   * selection rectangle or drag in progress.
   */
  cancel(): void {
    this.assertAlive();
    this.cancelIdleGestures();
    this.vertices.stop(true);
    if (!this.session.cancel()) return;
    this.leaveDrawing();
    this.emitChange();
  }

  /**
   * A copy of all committed features as a FeatureCollection. Drafts are not included.
   * Also readable after {@link GeometryEditor.destroy}.
   */
  exportGeoJSON(): GeometryFeatureCollection {
    return this.session.exportGeoJSON();
  }

  /**
   * Validate and append a parsed GeoJSON Feature or FeatureCollection as one undo step.
   * Features without an ID receive a generated UUID; existing IDs cannot be overwritten.
   * @returns The imported features as stored.
   * @throws GeoJSONImportError if any feature is invalid; nothing is imported then.
   */
  importGeoJSON(input: unknown): GeometryFeatureCollection {
    this.assertAlive();
    this.cancelIdleGestures();
    const imported = this.session.importGeoJSON(input);
    if (imported.features.length === 0) return imported;
    this.renderer.renderCommitted(this.exportGeoJSON());
    this.events.emit('import', () => structuredClone(imported));
    this.emitData('import', imported.features.map((after) => ({ before: null, after })));
    this.emitChange();
    return imported;
  }

  /**
   * Create, update and delete features atomically as one undo step.
   * @returns The committed changes, or null if nothing changed.
   * @throws GeoJSONImportError, TypeError or RangeError if the batch is invalid; nothing is applied then.
   * @throws FeatureLockedError if the batch changes a locked feature.
   */
  applyTransaction(input: FeatureTransaction): TransactionEvent | null {
    this.assertAlive();
    this.cancelIdleGestures();
    return this.publishTransaction(this.session.applyTransaction(input));
  }

  /**
   * Subscribe to every committed change of the stored features in one stream: drawing,
   * editing, deletion, import, transactions, geometry tools and undo/redo. Use it to save data.
   * Drafts and previews never trigger it.
   * @returns A function that unsubscribes.
   */
  onDataChange(listener: (event: DataChangeEvent) => void): () => void {
    this.assertAlive();
    return this.events.on('data', listener);
  }

  /**
   * Subscribe to committed transactions, including those made by geometry tools.
   * @returns A function that unsubscribes.
   */
  onTransaction(listener: (event: TransactionEvent) => void): () => void {
    this.assertAlive();
    return this.events.on('transaction', listener);
  }

  /**
   * Subscribe to successful imports.
   * @returns A function that unsubscribes.
   */
  onImport(listener: (collection: GeometryFeatureCollection) => void): () => void {
    this.assertAlive();
    return this.events.on('import', listener);
  }

  /**
   * Revert the last committed action.
   * @returns false if nothing can be undone, including while a tool is active.
   */
  undo(): boolean { return this.replayHistory('undo'); }
  /**
   * Re-apply the last undone action.
   * @returns false if nothing can be redone.
   */
  redo(): boolean { return this.replayHistory('redo'); }

  /** Forget all undo and redo steps, for example after loading saved data. */
  clearHistory(): void {
    this.assertAlive();
    this.translation.cancel();
    if (this.session.clearHistory()) this.emitChange();
  }

  /**
   * Subscribe to undo and redo.
   * @returns A function that unsubscribes.
   */
  onHistory(listener: (event: HistoryEvent) => void): () => void {
    this.assertAlive();
    return this.events.on('history', listener);
  }

  /**
   * Subscribe to features created by drawing.
   * @returns A function that unsubscribes.
   */
  onCreate(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    return this.events.on('create', listener);
  }

  /**
   * Subscribe to deletions made with {@link GeometryEditor.deleteSelected}.
   * @returns A function that unsubscribes.
   */
  onDelete(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    return this.events.on('delete', listener);
  }

  /**
   * Subscribe to features saved after vertex editing or hole drawing.
   * @returns A function that unsubscribes.
   */
  onUpdate(listener: (feature: GeometryFeature) => void): () => void {
    this.assertAlive();
    return this.events.on('update', listener);
  }

  /**
   * Subscribe to state changes (mode, selection, drafts and data), for example to update
   * a toolbar.
   * @returns A function that unsubscribes.
   */
  onChange(listener: (state: EditorState) => void): () => void {
    this.assertAlive();
    return this.events.on('change', listener);
  }

  /**
   * Remove this editor's event handlers, layers and sources. Safe to call more than once;
   * removing the map destroys the editor automatically.
   */
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
    if ((state.mode === 'draw-rectangle' || state.mode === 'draw-circle' || state.mode === 'draw-ellipse') && this.session.state.vertexCount > 1) { this.finish(); return; }
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
    this.scaling.stop(true);
    this.distance.stop(true);
    this.pivot.stop(true);
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
    this.boundarySnapping.invalidateCamera();
    this.vertices.cameraChanged();
    this.pivot.refresh();
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
    if (state.mode === 'reshape-polygon' || state.mode === 'split-polygon' && !altPressed) {
      const attachment = this.boundarySnapping.resolve(point);
      if (attachment) return { coordinate: attachment.coordinate, snap: attachment, close: false };
    }
    const first = closesRing(state) && state.vertexCount >= 3 ? this.session.getDraft()[0] : undefined;
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
    const snap = altPressed ? null : this.snapping.resolve(point, state.dataRevision, () => this.session.exportGeoJSON(), excludedId, state.mode === 'split-polygon' || this.canTracePointer());
    const coordinate = snap?.coordinate ?? this.map.unproject([point.x, point.y]).wrap().toArray();
    if (!snap && !altPressed && this.drawingConstraints.enabled
      && (state.mode === 'draw-line' || state.mode === 'draw-polygon' || state.mode === 'draw-hole' || state.mode === 'draw-cut' || state.mode === 'draw-part')) {
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
    this.emitData('transaction', event.changes);
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
    this.emitData(direction, event.changes);
    this.emitChange();
    return true;
  }

  /** Stop transient selection/movement before a command changes their baseline. */
  private cancelIdleGestures(): void {
    this.vertexKeyboard.stop();
    this.selection.cancel();
    this.translation.cancel();
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('This GeometryEditor has been destroyed.');
  }

  private emitData(source: DataChangeSource, changes: FeatureChange[]): void {
    const dataRevision = this.session.state.dataRevision;
    this.events.emit('data', (): DataChangeEvent => ({ source, changes: structuredClone(changes), dataRevision }));
  }

  private emitChange(): void {
    this.vertexKeyboard.render();
    this.renderMeasurements();
    this.events.emit('change', () => this.getState());
  }

  private draftChanged(changed: boolean, immediatePreview = false): void {
    if (!changed || this.destroyed) return;
    if (immediatePreview) this.flushPreview(); else this.schedulePreview();
    this.emitChange();
  }

  private schedulePreview(): void {
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      this.flushPreview();
    });
  }

  /** Consume pending preview work, including snap/selection changes, once. */
  private flushPreview(): void {
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (this.destroyed) return;
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
      this.distance.render(this.session.getSelection(), this.appearance);
      return;
    }
    if (this.session.state.mode === 'buffer-features') {
      const preview = this.session.getBufferPreview();
      this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
      this.renderer.renderTransform(preview);
      this.distance.render(this.session.getSelection(), this.appearance);
      return;
    }
    if (this.session.state.mode === 'simplify-features') {
      const preview = this.session.getSimplificationPreview();
      this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
      this.renderer.renderComparison(preview ? this.session.state.selectedFeatureIds : []);
      this.renderer.renderTransform(preview);
      return;
    }
    if (this.session.state.mode === 'scale-features') {
      const preview = this.session.getScalePreview();
      this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
      this.renderer.renderTransform(preview, this.session.state.scalePivot!);
      const originals = this.session.getSelection();
      this.scaling.render(preview?.features ?? originals, originals, this.appearance);
      this.pivot.render(originals, this.appearance);
      return;
    }
    if (this.session.state.mode === 'rotate-features') {
      const preview = this.session.getRotationPreview();
      this.renderer.renderEditingMany(preview ? this.session.state.selectedFeatureIds : [], true);
      this.renderer.renderTransform(preview, this.session.state.rotationPivot!);
      const originals = this.session.getSelection();
      this.rotation.render(preview?.features ?? originals, originals, this.appearance);
      this.pivot.render(originals, this.appearance);
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
    const mode = this.session.state.mode;
    if (mode === 'draw-rectangle' || mode === 'draw-circle' || mode === 'draw-ellipse' || mode === 'draw-freehand') {
      this.renderShapePreview(mode);
      this.renderMeasurements();
      return;
    }
    const reshape = this.session.getReshapePreview();
    if (this.session.state.mode === 'reshape-polygon') this.renderer.renderEditing(reshape ? this.session.state.selectedFeatureId : null);
    const split = this.session.getSplitPreview();
    if (this.session.state.mode === 'split-polygon') this.renderer.renderEditing(split ? this.session.state.selectedFeatureId : null);
    if (this.session.state.mode === 'split-polygon' || this.session.state.mode === 'reshape-polygon') {
      this.renderer.renderComparison(split || reshape ? this.session.state.selectedFeatureIds : []);
    }
    const shared = this.session.getSharedBoundaryPreview();
    if (this.session.state.mode === 'edit-shared-boundary') this.renderer.renderEditingMany(shared ? this.session.state.selectedFeatureIds : []);
    const trace = this.getTracePreview();
    this.renderer.renderPreview(this.session.getDraft(), reshape || trace ? undefined : this.cursor, previewState(this.session.state), this.snap, split, this.session.getDraftRings(), this.session.getInactiveParts(), reshape, trace, shared, this.session.getCutFeedback());
    this.renderMeasurements();
  }

  private renderShapePreview(mode: 'draw-rectangle' | 'draw-circle' | 'draw-ellipse' | 'draw-freehand'): void {
    if (mode === 'draw-freehand') {
      const path = this.freehandPath;
      this.renderer.renderShape(path.length >= 2 ? { type: 'LineString', coordinates: path } : null, [], null);
      return;
    }
    const anchor = this.session.getDraft()[0];
    const ring = anchor && this.cursor ? this.session.getShapePreview(this.cursor) : null;
    const corners = [anchor, this.cursor].filter((point): point is Coordinate => point !== undefined);
    this.renderer.renderShape(ring ? { type: 'Polygon', coordinates: [[...ring, ring[0]!]] } : null, corners, this.snap);
  }

  /** Labels for the shape being drawn or edited, a transform preview, or the single selected feature. */
  private renderMeasurements(): void {
    if (this.destroyed) return;
    this.measurementOverlay.render(this.measurements.enabled ? this.measurementLabels() : []);
  }

  private measurementLabels(): MeasurementLabel[] {
    const state = this.session.state;
    const mode = state.mode;
    const distance = (meters: number): string => formatDistance(meters, this.measurements.units, this.measurements.locale);
    const area = (squareMeters: number): string => formatArea(squareMeters, this.measurements.units, this.measurements.locale);
    const labels: MeasurementLabel[] = [];
    const segments = (points: Coordinate[], closed: boolean): void => {
      const path = closed && points.length > 2 ? [...points, points[0]!] : points;
      for (let index = 1; index < path.length; index++) {
        const a = path[index - 1]!; const b = path[index]!;
        const from = this.map.project(a); const to = this.map.project(b);
        if (Math.hypot(to.x - from.x, to.y - from.y) < minimumLabelSpacing) continue;
        labels.push({ kind: 'segment', coordinate: this.map.unproject([(from.x + to.x) / 2, (from.y + to.y) / 2]).toArray(), text: distance(pathLength([a, b])) });
      }
    };
    const total = (geometry: GeometryFeature['geometry']): void => {
      const size = measure(geometry);
      if (size.area > 0) labels.push({ kind: 'total', coordinate: labelPoint(geometry), text: area(size.area), detail: distance(size.perimeter) });
      else if (size.length > 0) labels.push({ kind: 'total', coordinate: labelPoint(geometry), text: distance(size.length) });
    };
    if (mode === 'draw-rectangle' || mode === 'draw-circle' || mode === 'draw-ellipse') {
      const anchor = this.session.getDraft()[0];
      const ring = anchor && this.cursor ? this.session.getShapePreview(this.cursor) : null;
      if (!anchor || !ring || !this.cursor) return labels;
      if (mode === 'draw-rectangle') segments(ring, true);
      labels.push({ kind: 'total', coordinate: mode === 'draw-rectangle' ? labelPoint({ type: 'Polygon', coordinates: [ring] }) : anchor,
        text: area(ringArea(ring)), detail: mode === 'draw-circle' ? `r ${distance(circleRadius(anchor, this.cursor))}` : distance(ringPerimeter(ring)) });
      return labels;
    }
    if (mode === 'draw-line' || mode === 'draw-polygon' || mode === 'draw-hole' || mode === 'draw-cut' || mode === 'draw-part') {
      const points = this.session.getDraft();
      const last = points.at(-1);
      if (this.cursor && last && (last[0] !== this.cursor[0] || last[1] !== this.cursor[1])) points.push(this.cursor);
      const polygon = closesRing(state);
      segments(points, polygon);
      if (polygon && points.length >= 3) labels.push({ kind: 'total', coordinate: labelPoint({ type: 'Polygon', coordinates: [points] }), text: area(ringArea(points)), detail: distance(ringPerimeter(points)) });
      else if (!polygon && points.length >= 3) labels.push({ kind: 'total', coordinate: points.at(-1)!, text: distance(pathLength(points)) });
      return labels;
    }
    if (mode === 'edit-line' || mode === 'edit-polygon') {
      const rings = this.session.getDraftRings();
      total(rings ? { type: 'Polygon', coordinates: rings.map((ring) => [...ring, ring[0]!]) } : { type: 'LineString', coordinates: this.session.getDraft() });
      return labels;
    }
    const preview = mode === 'rotate-features' ? this.session.getRotationPreview() : mode === 'scale-features' ? this.session.getScalePreview()
      : mode === 'buffer-features' ? this.session.getBufferPreview() : mode === 'offset-lines' ? this.session.getOffsetPreview()
      : mode === 'simplify-features' ? this.session.getSimplificationPreview() : null;
    if (preview?.features.length === 1) total(preview.features[0]!.geometry);
    if (mode === 'idle' && state.selectedFeatureId !== null) {
      const feature = this.session.getFeature(state.selectedFeatureId);
      if (feature) total(feature.geometry);
    }
    return labels;
  }

  private leaveDrawing(): void {
    this.freehand.stop();
    this.freehand.setEnabled(false);
    this.freehandPath = [];
    this.vertexKeyboard.clear();
    this.rotation.clear();
    this.scaling.clear();
    this.distance.clear();
    this.pivot.clear();
    this.traceAnchor = null; this.traceCache = null;
    this.boundarySnapping.clear();
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
    this.boundarySnapping.clear();
    this.vertexKeyboard.destroy();
    this.selection.destroy(removeResources);
    this.translation.destroy(removeResources);
    this.rotation.destroy(removeResources);
    this.scaling.destroy(removeResources);
    this.distance.destroy(removeResources);
    this.pivot.destroy(removeResources);
    this.vertices.destroy(removeResources);
    this.freehand.destroy();
    this.measurementOverlay.destroy();
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
