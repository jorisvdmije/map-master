import { canvasPoint } from './pointer.js';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { translateFeatures, translationAnchor } from '../core/translation.js';
import { project } from '../core/mercator-transform.js';
import type { Coordinate, FeatureId, GeometryFeature, SnapResult } from '../core/types.js';
import type { EditorAppearance } from '../core/appearance.js';
import type { ScreenPoint } from '../core/snapping.js';
import { TranslationGuide } from './translation-guide.js';

interface TranslationActions {
  targets(point: ScreenPoint): { features: GeometryFeature[]; grabbed: GeometryFeature } | null;
  resolve(point: ScreenPoint, excluded: ReadonlySet<FeatureId>): SnapResult | null;
  snap(result: SnapResult | null): void;
  appearance(): EditorAppearance;
  preview(features: GeometryFeature[]): void;
  clear(): void;
  commit(delta: Coordinate): void;
}
interface Gesture {
  pointerId: number;
  start: ScreenPoint;
  end: ScreenPoint;
  pointer: Coordinate;
  anchor: Coordinate;
  originals: GeometryFeature[];
  excluded: ReadonlySet<FeatureId>;
  axis: 'east-west' | 'north-south' | null;
  shift: boolean;
  alt: boolean;
  moved: boolean;
  pan: boolean;
  cursor: string;
}
interface Result { delta: Coordinate; snap: SnapResult | null; features: GeometryFeature[] | null; }

/** Drag a selected shape to translate the whole selection; release commits once. */
export class TranslationInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly guide: TranslationGuide;
  private gesture: Gesture | undefined;
  private frame: number | undefined;
  private suppressClick = false;

  constructor(private readonly map: MapLibreMap, private readonly actions: TranslationActions) {
    this.canvas = map.getCanvas();
    this.view = this.canvas.ownerDocument.defaultView!;
    this.guide = new TranslationGuide(map);
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.interrupt);
    this.canvas.addEventListener('lostpointercapture', this.interrupt);
    this.canvas.addEventListener('click', this.click, true);
    this.view.addEventListener('keydown', this.key, true);
    this.view.addEventListener('keyup', this.key, true);
    this.view.addEventListener('blur', this.blur);
  }

  get active(): boolean { return this.gesture !== undefined; }

  cancel(restoreGestures = true, clearPreview = true, notify = true): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    this.guide.clear();
    // A release after cancellation must never become selection or drawing input.
    this.suppressClick = true;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (this.canvas.hasPointerCapture(gesture.pointerId)) this.canvas.releasePointerCapture(gesture.pointerId);
    this.canvas.style.cursor = gesture.cursor;
    if (restoreGestures) {
      if (gesture.pan) this.map.dragPan.enable(); else this.map.dragPan.disable();
      if (gesture.moved && clearPreview) this.actions.clear();
    }
    if (notify) this.actions.snap(null);
  }

  destroy(restoreGestures: boolean): void {
    this.cancel(restoreGestures);
    this.guide.clear();
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.interrupt);
    this.canvas.removeEventListener('lostpointercapture', this.interrupt);
    this.canvas.removeEventListener('click', this.click, true);
    this.view.removeEventListener('keydown', this.key, true);
    this.view.removeEventListener('keyup', this.key, true);
    this.view.removeEventListener('blur', this.blur);
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.gesture) return;
    this.suppressClick = false;
    if (event.button !== 0 || event.pointerType !== 'mouse' || event.shiftKey || event.ctrlKey
      || event.metaKey || event.defaultPrevented) return;
    const point = canvasPoint(this.canvas, event);
    const targets = this.actions.targets(point);
    if (!targets) return;
    const anchor = translationAnchor(targets.grabbed, point, coordinate => this.map.project(coordinate));
    if (!anchor) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.map.stop();
    this.gesture = { pointerId: event.pointerId, start: point, end: point,
      pointer: this.map.unproject([point.x, point.y]).toArray(), anchor, originals: targets.features,
      excluded: new Set(targets.features.map(feature => feature.id)), axis: null, shift: false, alt: event.altKey, moved: false,
      pan: this.map.dragPan.isEnabled(), cursor: this.canvas.style.cursor };
    this.map.dragPan.disable();
    this.canvas.setPointerCapture(event.pointerId);
  };

  private update(event: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    g.end = canvasPoint(this.canvas, event); g.alt = event.altKey; g.shift = event.shiftKey;
    if (!g.shift) g.axis = null;
    g.moved ||= Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) >= 4;
    if (g.moved) this.suppressClick = true;
  }

  private resolve(g: Gesture): Result {
    // Preserve the existing degree-offset contract and unwrapped coordinates.
    const end = this.map.unproject([g.end.x, g.end.y]).toArray();
    let delta: Coordinate = [end[0] - g.pointer[0], end[1] - g.pointer[1]];
    if (g.shift) {
      if (!g.axis && (delta[0] !== 0 || delta[1] !== 0)) {
        const a = project(g.pointer); const b = project(end);
        g.axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'east-west' : 'north-south';
      }
      if (g.axis === 'east-west') delta[1] = 0;
      if (g.axis === 'north-south') delta[0] = 0;
    }
    let snap: SnapResult | null = null;
    // Shift is a strict geographic axis constraint. Returning to the origin is
    // an exact no-op even if a stationary target happens to be within tolerance.
    if (!g.alt && !g.shift && (delta[0] !== 0 || delta[1] !== 0)) {
      const moving: Coordinate = [g.anchor[0] + delta[0], g.anchor[1] + delta[1]];
      if (Math.abs(moving[0]) <= 180 && Math.abs(moving[1]) < 90) {
        snap = this.actions.resolve(this.map.project(moving), g.excluded);
        if (snap) delta = [snap.coordinate[0] - g.anchor[0], snap.coordinate[1] - g.anchor[1]];
      }
    }
    try { return { delta, snap, features: translateFeatures(g.originals, delta) }; }
    catch (error) {
      if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
      return { delta, snap: null, features: null };
    }
  }

  private preview(g: Gesture, result: Result): void {
    this.canvas.style.cursor = result.features ? 'grabbing' : 'not-allowed';
    this.actions.preview(result.features ?? g.originals);
    this.guide.render(g.anchor, result.delta, g.end, result.snap, g.axis, result.features !== null, this.actions.appearance());
    // Notify last: host callbacks may cancel, destroy, or mutate the baseline.
    this.actions.snap(result.snap);
  }

  refresh(): void {
    if (!this.gesture?.moved || this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      const g = this.gesture;
      if (g) this.preview(g, this.resolve(g));
    });
  }

  private readonly move = (event: PointerEvent): void => {
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.update(event); this.refresh();
  };

  private readonly up = (event: PointerEvent): void => {
    const g = this.gesture;
    if (g?.pointerId !== event.pointerId) return;
    this.update(event);
    const result = g.moved ? this.resolve(g) : null;
    if (result) this.preview(g, result); // Exact release, without waiting for a frame.
    if (this.gesture !== g) return; // An onSnap callback interrupted the gesture.
    // Clear the snap notification after commit, so a null-snap observer cannot
    // mutate the baseline between detaching the gesture and its transaction.
    this.cancel(true, !result?.features, false);
    this.suppressClick = g.moved;
    try { if (result?.features) this.actions.commit(result.delta); }
    finally { this.actions.snap(null); }
  };

  private readonly click = (event: MouseEvent): void => {
    if (this.suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private readonly interrupt = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) this.cancel();
  };
  private readonly key = (event: KeyboardEvent): void => {
    const g = this.gesture;
    if (!g || event.isComposing) return;
    if (event.key === 'Escape' && event.type === 'keydown') {
      event.preventDefault(); event.stopImmediatePropagation(); this.cancel();
    } else if (event.key === 'Alt' || event.key === 'Shift') {
      event.preventDefault();
      if (event.key === 'Alt') g.alt = event.type === 'keydown';
      else { g.shift = event.type === 'keydown'; if (!g.shift) g.axis = null; }
      this.refresh();
    }
  };
  private readonly blur = (): void => { this.cancel(); };
}
