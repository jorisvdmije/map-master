import { canvasPoint } from './pointer.js';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ScreenPoint } from '../core/snapping.js';

interface SelectionActions {
  idle(): boolean;
  toggle(point: ScreenPoint): void;
  addBox(start: ScreenPoint, end: ScreenPoint): void;
}
interface Gesture {
  pointerId: number;
  start: ScreenPoint;
  end: ScreenPoint;
  moved: boolean;
  pan: boolean;
  boxZoom: boolean;
}

/** Shift+mouse selection; the rectangle is a transient screen overlay, not map data. */
export class SelectionInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly rectangle: HTMLDivElement;
  private gesture: Gesture | undefined;
  private suppressClick = false;

  constructor(private readonly map: MapLibreMap, private readonly actions: SelectionActions) {
    this.canvas = map.getCanvas();
    this.view = this.canvas.ownerDocument.defaultView!;
    this.rectangle = this.canvas.ownerDocument.createElement('div');
    this.rectangle.dataset.geoSelectionBox = '';
    this.rectangle.setAttribute('aria-hidden', 'true');
    this.rectangle.style.cssText = 'position:absolute;pointer-events:none;box-sizing:border-box;border:1px solid #2563eb;background:rgba(37,99,235,.12);z-index:1;';
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.interrupt);
    this.canvas.addEventListener('lostpointercapture', this.interrupt);
    this.canvas.addEventListener('click', this.click, true);
    this.canvas.addEventListener('keydown', this.key, true);
    this.view.addEventListener('blur', this.blur);
  }

  cancel(restoreGestures = true): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    this.rectangle.remove();
    if (this.canvas.hasPointerCapture(gesture.pointerId)) this.canvas.releasePointerCapture(gesture.pointerId);
    if (restoreGestures) {
      if (gesture.pan) this.map.dragPan.enable(); else this.map.dragPan.disable();
      if (gesture.boxZoom) this.map.boxZoom.enable(); else this.map.boxZoom.disable();
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

  private point(event: PointerEvent): ScreenPoint {
    const point = canvasPoint(this.canvas, event);
    // Rectangle selection is clipped to the map; captured drags are not.
    return { x: Math.max(0, Math.min(this.canvas.clientWidth, point.x)),
      y: Math.max(0, Math.min(this.canvas.clientHeight, point.y)) };
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.gesture) return;
    this.suppressClick = false;
    if (!this.actions.idle() || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
      || event.button !== 0 || event.pointerType !== 'mouse' || event.defaultPrevented) return;
    event.preventDefault();
    this.suppressClick = true;
    this.canvas.focus({ preventScroll: true });
    // Stop existing inertia before fixing a rectangle in screen coordinates.
    this.map.stop();
    const point = this.point(event);
    this.gesture = { pointerId: event.pointerId, start: point, end: point, moved: false,
      pan: this.map.dragPan.isEnabled(), boxZoom: this.map.boxZoom.isEnabled() };
    this.map.dragPan.disable();
    this.map.boxZoom.disable();
    this.canvas.setPointerCapture(event.pointerId);
  };

  private update(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    gesture.end = this.point(event);
    gesture.moved ||= Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y) >= 4;
    if (!gesture.moved) return;
    const { start, end } = gesture;
    Object.assign(this.rectangle.style, {
      left: `${Math.min(start.x, end.x)}px`, top: `${Math.min(start.y, end.y)}px`,
      width: `${Math.abs(end.x - start.x)}px`, height: `${Math.abs(end.y - start.y)}px`,
    });
    if (!this.rectangle.isConnected) this.map.getCanvasContainer().append(this.rectangle);
  }

  private readonly move = (event: PointerEvent): void => {
    if (this.gesture?.pointerId === event.pointerId) this.update(event);
  };

  private readonly up = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture?.pointerId !== event.pointerId) return;
    this.update(event);
    this.cancel();
    if (!this.actions.idle()) return;
    if (gesture.moved) this.actions.addBox(gesture.start, gesture.end);
    else this.actions.toggle(gesture.end);
  };

  private readonly click = (event: MouseEvent): void => {
    // Pointer-up already applied the selection. Keep suppression until the next
    // pointer-down, including after cancellation and when Shift is released early.
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
