import type { EditorMap as MapLibreMap } from '../gl/map.js';
import { simplifyPath } from '../core/shapes.js';
import type { Coordinate } from '../core/types.js';
import { canvasPoint } from './pointer.js';

interface FreehandActions {
  enabled(): boolean;
  preview(path: Coordinate[]): void;
  finish(path: Coordinate[]): void;
}
interface Gesture { pointerId: number; points: Coordinate[]; pan: boolean }

/** Screen distance between recorded pointer samples, and the simplification tolerance. */
const sampleSpacing = 3;
const tolerance = 1.5;

/** Press and drag to trace an outline. Releasing the pointer completes the shape. */
export class FreehandInteraction {
  private readonly canvas: HTMLCanvasElement;
  private gesture: Gesture | undefined;
  private suppressClick = false;
  private touchAction: string | null = null;

  constructor(private readonly map: MapLibreMap, private readonly actions: FreehandActions) {
    this.canvas = map.getCanvas();
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.interrupt);
    this.canvas.addEventListener('lostpointercapture', this.interrupt);
    this.canvas.addEventListener('click', this.click, true);
  }

  get active(): boolean { return this.gesture !== undefined; }

  /** While the tool is active, one-finger drags draw instead of scrolling the page. */
  setEnabled(enabled: boolean): void {
    if (enabled && this.touchAction === null) {
      this.touchAction = this.canvas.style.touchAction;
      this.canvas.style.touchAction = 'none';
    } else if (!enabled && this.touchAction !== null) {
      this.canvas.style.touchAction = this.touchAction;
      this.touchAction = null;
    }
  }

  /** Abandon a stroke in progress and restore map panning. */
  stop(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    if (this.canvas.hasPointerCapture(gesture.pointerId)) this.canvas.releasePointerCapture(gesture.pointerId);
    if (gesture.pan) this.map.dragPan.enable();
  }

  destroy(): void {
    this.stop();
    this.setEnabled(false);
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.interrupt);
    this.canvas.removeEventListener('lostpointercapture', this.interrupt);
    this.canvas.removeEventListener('click', this.click, true);
  }

  private path(points: readonly Coordinate[]): Coordinate[] {
    return points.map(([x, y]) => this.map.unproject([x, y]).wrap().toArray());
  }

  private readonly down = (event: PointerEvent): void => {
    this.suppressClick = false;
    if (this.gesture || !this.actions.enabled() || !event.isPrimary || event.button !== 0 || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    this.map.stop();
    const { x, y } = canvasPoint(this.canvas, event);
    this.gesture = { pointerId: event.pointerId, points: [[x, y]], pan: this.map.dragPan.isEnabled() };
    this.map.dragPan.disable();
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly move = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture?.pointerId !== event.pointerId) return;
    const { x, y } = canvasPoint(this.canvas, event);
    const [lastX, lastY] = gesture.points.at(-1)!;
    if (Math.hypot(x - lastX, y - lastY) < sampleSpacing) return;
    gesture.points.push([x, y]);
    this.actions.preview(this.path(gesture.points));
  };

  private readonly up = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture?.pointerId !== event.pointerId) return;
    this.stop();
    this.suppressClick = true;
    if (gesture.points.length < 3) { this.actions.preview([]); return; }
    this.actions.finish(this.path(simplifyPath(gesture.points, tolerance)));
  };

  private readonly interrupt = (event: PointerEvent): void => {
    if (this.gesture?.pointerId !== event.pointerId) return;
    this.stop();
    this.actions.preview([]);
  };

  private readonly click = (event: MouseEvent): void => {
    // The stroke has been handled on pointer-up; its click must not select a feature.
    if (this.suppressClick) { this.suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
  };
}
