import { canvasPoint } from './pointer.js';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { translateFeatures } from '../core/translation.js';
import type { Coordinate, GeometryFeature } from '../core/types.js';
import type { ScreenPoint } from '../core/snapping.js';

interface TranslationActions {
  targets(point: ScreenPoint): GeometryFeature[];
  preview(features: GeometryFeature[]): void;
  clear(): void;
  commit(delta: Coordinate): void;
}
interface Gesture {
  pointerId: number;
  start: ScreenPoint;
  end: ScreenPoint;
  anchor: Coordinate;
  originals: GeometryFeature[];
  moved: boolean;
  pan: boolean;
  cursor: string;
}

/** Drag a selected shape to translate the whole selection; release commits once. */
export class TranslationInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private gesture: Gesture | undefined;
  private frame: number | undefined;
  private suppressClick = false;

  constructor(private readonly map: MapLibreMap, private readonly actions: TranslationActions) {
    this.canvas = map.getCanvas();
    this.view = this.canvas.ownerDocument.defaultView!;
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.interrupt);
    this.canvas.addEventListener('lostpointercapture', this.interrupt);
    this.canvas.addEventListener('click', this.click, true);
    this.canvas.addEventListener('keydown', this.key, true);
    this.view.addEventListener('blur', this.blur);
  }

  get active(): boolean { return this.gesture !== undefined; }

  cancel(restoreGestures = true, clearPreview = true): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
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
  }

  destroy(restoreGestures: boolean): void {
    this.cancel(restoreGestures);
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.interrupt);
    this.canvas.removeEventListener('lostpointercapture', this.interrupt);
    this.canvas.removeEventListener('click', this.click, true);
    this.canvas.removeEventListener('keydown', this.key, true);
    this.view.removeEventListener('blur', this.blur);
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.gesture) return;
    this.suppressClick = false;
    if (event.button !== 0 || event.pointerType !== 'mouse' || event.shiftKey || event.ctrlKey
      || event.metaKey || event.altKey || event.defaultPrevented) return;
    const point = canvasPoint(this.canvas, event);
    const originals = this.actions.targets(point);
    if (originals.length === 0) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.map.stop();
    this.gesture = { pointerId: event.pointerId, start: point, end: point,
      anchor: this.map.unproject([point.x, point.y]).toArray(), originals, moved: false,
      pan: this.map.dragPan.isEnabled(), cursor: this.canvas.style.cursor };
    this.map.dragPan.disable();
    this.canvas.setPointerCapture(event.pointerId);
  };

  private update(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    gesture.end = canvasPoint(this.canvas, event);
    gesture.moved ||= Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y) >= 4;
    if (gesture.moved) this.suppressClick = true;
  }

  private delta(gesture: Gesture): Coordinate {
    // Keep the unwrapped coordinate: wrapping individual vertices would tear
    // a group at the antimeridian. Bounds violations reject the whole gesture.
    const end = this.map.unproject([gesture.end.x, gesture.end.y]);
    return [end.lng - gesture.anchor[0], end.lat - gesture.anchor[1]];
  }

  private translated(gesture: Gesture): GeometryFeature[] | null {
    try { return translateFeatures(gesture.originals, this.delta(gesture)); }
    catch (error) {
      if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
      return null;
    }
  }

  private readonly move = (event: PointerEvent): void => {
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.update(event);
    if (!this.gesture.moved || this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => {
      this.frame = undefined;
      const gesture = this.gesture;
      if (!gesture) return;
      const features = this.translated(gesture);
      this.canvas.style.cursor = features ? 'grabbing' : 'not-allowed';
      this.actions.preview(features ?? gesture.originals);
    });
  };

  private readonly up = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture?.pointerId !== event.pointerId) return;
    this.update(event);
    const features = gesture.moved ? this.translated(gesture) : null;
    if (features) this.actions.preview(features); // Exact release, even before the next animation frame.
    this.cancel(true, features === null);
    this.suppressClick = gesture.moved;
    if (features) this.actions.commit(this.delta(gesture));
  };

  private readonly click = (event: MouseEvent): void => {
    if (this.suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  private readonly interrupt = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) this.cancel();
  };
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.gesture || event.key !== 'Escape' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); event.stopImmediatePropagation(); this.cancel();
  };
  private readonly blur = (): void => { this.cancel(); };
}
