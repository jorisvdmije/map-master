import { canvasPoint } from './pointer.js';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate, EditorState } from '../core/types.js';
import type { ScreenPoint } from '../core/snapping.js';
import { vertexHandles } from './vertex-handles.js';

interface VertexActions {
  state(): EditorState;
  draft(): Coordinate[];
  select(index: number | null): void;
  move(index: number, coordinate: Coordinate): void;
  insert(index: number, coordinate: Coordinate): void;
  remove(index: number): void;
  resolve(point: ScreenPoint, altKey: boolean): Coordinate;
  clearSnap(): void;
}
interface Drag {
  pointerId: number;
  index: number;
  original: Coordinate;
  inserted: boolean;
  previousSelection: number | null;
  restorePan: boolean;
  start: ScreenPoint;
}

/** Mouse pointer capture, coalesced vertex movement, and gesture cleanup. */
export class VertexInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private drag: Drag | undefined;
  private pointer: { point: ScreenPoint; altKey: boolean } | undefined;
  private pending = false;
  private frame: number | undefined;

  constructor(private readonly map: MapLibreMap, private readonly actions: VertexActions) {
    this.canvas = map.getCanvas();
    this.view = this.canvas.ownerDocument.defaultView!;
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.cancel);
    this.canvas.addEventListener('lostpointercapture', this.cancel);
    this.view.addEventListener('blur', this.blur);
  }

  /** Stop a gesture before API mutations, finish/cancel, style changes, or teardown. */
  stop(rollback = false, restorePan = true): void {
    const drag = this.drag;
    if (!drag) return;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (!rollback) this.flush();
    if (this.drag !== drag) return;
    this.drag = undefined;
    this.pointer = undefined;
    this.pending = false;
    if (this.canvas.hasPointerCapture(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
    if (restorePan) {
      if (drag.restorePan) this.map.dragPan.enable();
      else this.map.dragPan.disable();
    }
    if (rollback) {
      if (drag.inserted) this.actions.remove(drag.index);
      else this.actions.move(drag.index, drag.original);
      this.actions.select(drag.previousSelection);
    }
    this.actions.clearSnap();
  }

  /** Re-resolve a stationary drag after modifier, option, or camera changes. */
  refresh(altKey?: boolean): void {
    if (!this.drag || !this.pointer) return;
    if (altKey !== undefined) this.pointer.altKey = altKey;
    this.pending = true;
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
  }

  destroy(restorePan: boolean): void {
    this.stop(true, restorePan);
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.cancel);
    this.view.removeEventListener('blur', this.blur);
  }

  private readonly down = (event: PointerEvent): void => {
    const state = this.actions.state();
    if (!state.mode.startsWith('edit-') || this.drag || event.pointerType !== 'mouse'
      || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey
      || event.defaultPrevented) return;
    const point = canvasPoint(this.canvas, event);
    // Vertices come first so small segments never make their endpoints unselectable.
    const hit = vertexHandles(this.map, this.actions.draft(), state.mode === 'edit-polygon').find((handle) => {
      const projected = this.map.project(handle.coordinate);
      return Math.hypot(projected.x - point.x, projected.y - point.y) <= (handle.kind === 'vertex' ? 8 : 6);
    });
    if (!hit) { this.actions.select(null); return; }
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    const restorePan = this.map.dragPan.isEnabled();
    this.map.dragPan.disable();
    this.drag = { pointerId: event.pointerId, index: hit.index, original: [...hit.coordinate],
      inserted: hit.kind === 'midpoint', previousSelection: state.selectedVertexIndex, restorePan, start: point };
    this.canvas.setPointerCapture(event.pointerId);
    if (hit.kind === 'midpoint') this.actions.insert(hit.index, hit.coordinate);
    else this.actions.select(hit.index);
  };

  private readonly move = (event: PointerEvent): void => {
    if (this.drag?.pointerId !== event.pointerId) return;
    const point = canvasPoint(this.canvas, event);
    this.pointer = { point, altKey: event.altKey };
    this.refresh();
  };

  private flush(): void {
    const drag = this.drag;
    if (!drag || !this.pending || !this.pointer) return;
    this.pending = false;
    const coordinate = this.actions.resolve(this.pointer.point, this.pointer.altKey);
    // Snap observers can cancel/destroy the editor synchronously.
    if (this.drag === drag) this.actions.move(drag.index, coordinate);
  }

  private readonly up = (event: PointerEvent): void => {
    if (this.drag?.pointerId !== event.pointerId) return;
    const point = canvasPoint(this.canvas, event);
    // A plain click selects/inserts the exact handle; a drag resolves its release
    // position afresh, even when the final pointermove has not rendered yet.
    if (this.pointer || point.x !== this.drag.start.x || point.y !== this.drag.start.y) {
      this.pointer = { point, altKey: event.altKey };
      this.pending = true;
    }
    this.stop();
  };
  private readonly cancel = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) this.stop(true);
  };
  private readonly blur = (): void => { this.stop(true); };
}
