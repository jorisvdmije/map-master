import { canvasPoint } from './pointer.js';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate, EditorState, VertexUpdate } from '../core/types.js';
import type { ScreenPoint } from '../core/snapping.js';
import { pickDirectVertexHandle, pickEditEdge, vertexHandles } from './vertex-handles.js';

interface VertexActions {
  state(): EditorState;
  draft(): Coordinate[];
  select(indices: readonly number[]): void;
  move(updates: readonly VertexUpdate[]): void;
  insert(index: number, coordinate: Coordinate): void;
  remove(index: number): void;
  resolve(point: ScreenPoint, altKey: boolean): Coordinate;
  clearSnap(): void;
}
interface Drag {
  pointerId: number;
  direct: boolean;
  moved: boolean;
  index: number;
  original: Coordinate;
  originals: VertexUpdate[];
  inserted: boolean;
  group: boolean;
  invalid: boolean;
  previousSelection: number[];
  restorePan: boolean;
  cursor: string;
  start: ScreenPoint;
  origin: Coordinate;
}

/** Captured mouse/touch/pen vertex editing, coalesced movement and rollback. */
export class VertexInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private drag: Drag | undefined;
  private pointer: { point: ScreenPoint; altKey: boolean } | undefined;
  private pending = false;
  private frame: number | undefined;
  private readonly contacts = new Set<number>();
  private touchSequence = false;
  private suppressClick = false;

  constructor(private readonly map: MapLibreMap, private readonly actions: VertexActions) {
    this.canvas = map.getCanvas();
    this.view = this.canvas.ownerDocument.defaultView!;
    this.canvas.addEventListener('pointerdown', this.down, true);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.cancel);
    this.canvas.addEventListener('lostpointercapture', this.cancel);
    this.canvas.addEventListener('click', this.click, true);
    this.view.addEventListener('pointerdown', this.contactDown, true);
    this.view.addEventListener('pointerup', this.contactEnd, true);
    this.view.addEventListener('pointercancel', this.contactEnd, true);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      this.canvas.addEventListener(type, this.touch, { capture: true, passive: false });
    }
    this.view.addEventListener('keydown', this.key, true);
    this.view.addEventListener('blur', this.blur);
    this.map.on('resize', this.resize);
  }

  /** Stop a gesture before API mutations, finish/cancel, style changes, or teardown. */
  stop(rollback = false, restorePan = true): void {
    const drag = this.drag;
    if (!drag) return;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (!rollback) this.flush();
    if (this.drag !== drag) return;
    rollback ||= drag.invalid;
    this.drag = undefined;
    this.pointer = undefined;
    this.pending = false;
    if (this.canvas.hasPointerCapture(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
    this.canvas.style.cursor = drag.cursor;
    if (restorePan) {
      if (drag.restorePan) this.map.dragPan.enable();
      else this.map.dragPan.disable();
    }
    if (rollback) {
      if (drag.inserted) this.actions.remove(drag.index);
      else this.actions.move(drag.originals);
      // Host callbacks during restoration may have left the edit session.
      if (this.actions.state().mode.startsWith('edit-')) this.actions.select(drag.previousSelection);
    }
    this.actions.clearSnap();
  }

  /** Re-resolve a stationary drag after modifier or option changes. */
  refresh(altKey?: boolean): void {
    if (!this.drag || !this.pointer) return;
    if (altKey !== undefined) this.pointer.altKey = altKey;
    this.pending = true;
    if (this.frame !== undefined) return;
    this.frame = this.view.requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
  }

  cameraChanged(): void {
    // A group uses a frozen geographic pointer origin. Do not let a camera move
    // become an unintended group offset; legacy single-vertex drags re-resolve.
    if (this.drag?.group || this.drag?.direct) this.stop(true); else this.refresh();
  }

  destroy(restorePan: boolean): void {
    this.stop(true, restorePan);
    this.canvas.removeEventListener('pointerdown', this.down, true);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.cancel);
    this.canvas.removeEventListener('click', this.click, true);
    this.view.removeEventListener('pointerdown', this.contactDown, true);
    this.view.removeEventListener('pointerup', this.contactEnd, true);
    this.view.removeEventListener('pointercancel', this.contactEnd, true);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) this.canvas.removeEventListener(type, this.touch, true);
    this.contacts.clear(); this.touchSequence = false; this.suppressClick = false;
    this.view.removeEventListener('keydown', this.key, true);
    this.view.removeEventListener('blur', this.blur);
    this.map.off('resize', this.resize);
  }

  private readonly down = (event: PointerEvent): void => {
    const state = this.actions.state();
    const direct = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (!state.mode.startsWith('edit-') || this.drag || (!direct && event.pointerType !== 'mouse')
      || direct && (!event.isPrimary || this.contacts.size !== 1 || this.touchSequence)
      || event.button !== 0 || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const point = canvasPoint(this.canvas, event); const draft = this.actions.draft();
    // Vertices and insertion handles retain priority over whole-edge movement.
    const handles = vertexHandles(this.map, draft, state.mode === 'edit-polygon');
    const hit = direct ? pickDirectVertexHandle(this.map, handles, point, event.pointerType === 'touch' ? 22 : 12) : handles.find((handle) => {
      const projected = this.map.project(handle.coordinate);
      return Math.hypot(projected.x - point.x, projected.y - point.y) <= (handle.kind === 'vertex' ? 8 : 6);
    });
    const fixed = (index: number) => state.mode === 'edit-shared-boundary' && (index === 0 || index === draft.length - 1);
    if (event.shiftKey) {
      if (hit?.kind !== 'vertex' || fixed(hit.index)) return;
      event.preventDefault(); this.canvas.focus({ preventScroll: true });
      this.claim(event);
      const selected = state.selectedVertexIndices;
      this.actions.select(selected.includes(hit.index) ? selected.filter(i => i !== hit.index) : [...selected, hit.index]);
      return;
    }
    const edge = !hit && !direct ? pickEditEdge(this.map, draft, state.mode === 'edit-polygon', point) : null;
    if (!hit && !edge) { this.actions.select([]); return; }
    if (hit?.kind === 'vertex' && fixed(hit.index) || edge?.some(fixed)) {
      this.claim(event);
      event.preventDefault(); this.canvas.focus({ preventScroll: true }); this.actions.select([]); return;
    }
    const index = hit?.index ?? edge!.reduce((a, b) => {
      const pa = this.map.project(draft[a]!); const pb = this.map.project(draft[b]!);
      return Math.hypot(pa.x - point.x, pa.y - point.y) <= Math.hypot(pb.x - point.x, pb.y - point.y) ? a : b;
    });
    const inserted = hit?.kind === 'midpoint';
    const indices = edge ?? (hit?.kind === 'vertex' && state.selectedVertexIndices.includes(index) ? state.selectedVertexIndices : [index]);
    const original = hit?.coordinate ?? draft[index]!;
    event.preventDefault(); this.canvas.focus({ preventScroll: true }); this.map.stop();
    this.claim(event);
    const restorePan = this.map.dragPan.isEnabled(); this.map.dragPan.disable();
    this.drag = { pointerId: event.pointerId, direct, moved: false, index, original: [...original],
      originals: indices.map(i => ({ index: i, coordinate: inserted ? [...original] : [...draft[i]!] })),
      inserted, group: indices.length > 1, invalid: false, previousSelection: state.selectedVertexIndices,
      restorePan, cursor: this.canvas.style.cursor, start: point, origin: this.map.unproject([point.x, point.y]).toArray() };
    this.canvas.setPointerCapture(event.pointerId);
    if (inserted) this.actions.insert(index, original); else this.actions.select(indices);
  };

  private readonly move = (event: PointerEvent): void => {
    if (this.drag?.pointerId !== event.pointerId) return;
    this.pointer = { point: canvasPoint(this.canvas, event), altKey: event.altKey };
    this.refresh();
  };

  private flush(): void {
    const drag = this.drag;
    if (!drag || !this.pending || !this.pointer) return;
    this.pending = false;
    let point = this.pointer.point;
    if (drag.direct) {
      drag.moved ||= Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= 4;
      if (!drag.moved) return; // Tap/jitter selects without shifting the corner.
    }
    if (drag.group || drag.direct) {
      if (point.x === drag.start.x && point.y === drag.start.y) {
        drag.invalid = false; this.canvas.style.cursor = drag.cursor;
        this.actions.move(drag.originals); this.actions.clearSnap(); return;
      }
      const end = this.map.unproject([point.x, point.y]);
      const anchor: Coordinate = [drag.original[0] + end.lng - drag.origin[0], drag.original[1] + end.lat - drag.origin[1]];
      if (!anchor.every(Number.isFinite) || Math.abs(anchor[0]) > 180 || Math.abs(anchor[1]) >= 90) {
        drag.invalid = true; this.canvas.style.cursor = 'not-allowed'; this.actions.clearSnap(); return;
      }
      point = this.map.project(anchor);
    }
    const coordinate = this.actions.resolve(point, this.pointer.altKey);
    if (this.drag !== drag) return; // Snap observers can cancel/destroy synchronously.
    const delta: Coordinate = [coordinate[0] - drag.original[0], coordinate[1] - drag.original[1]];
    const updates: VertexUpdate[] = drag.group ? drag.originals.map(({ index, coordinate: p }) => ({ index, coordinate: [p[0] + delta[0], p[1] + delta[1]] }))
      : [{ index: drag.index, coordinate }];
    // Bounds failures never partly move a group. Keep the previous preview while
    // the pointer is invalid; recovery is possible, invalid release rolls back.
    drag.invalid = updates.some(({ coordinate: [x, y] }) => !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90);
    this.canvas.style.cursor = drag.invalid ? 'not-allowed' : drag.group ? 'move' : drag.cursor;
    if (drag.invalid) this.actions.clearSnap(); else this.actions.move(updates);
  }

  private readonly up = (event: PointerEvent): void => {
    if (this.drag?.pointerId !== event.pointerId) return;
    const point = canvasPoint(this.canvas, event);
    if (this.pointer || point.x !== this.drag.start.x || point.y !== this.drag.start.y) {
      this.pointer = { point, altKey: event.altKey }; this.pending = true;
    }
    this.stop();
  };
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.drag || event.isComposing || !['Escape', 'Enter'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') this.stop(true);
  };
  private readonly cancel = (event: PointerEvent): void => {
    if (this.drag?.pointerId === event.pointerId) this.stop(true);
  };
  private readonly blur = (): void => { this.stop(true); this.contacts.clear(); };
  private readonly resize = (): void => { if (this.drag?.direct) this.stop(true); };

  private claim(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return;
    this.suppressClick = true;
    if (event.pointerType === 'touch') this.touchSequence = true;
  }

  // Track direct contacts even outside the canvas: a second finger cancels the
  // edit, and no remaining finger can start another drag until all are lifted.
  private readonly contactDown = (event: PointerEvent): void => {
    if (!this.contacts.size && !this.drag && (event.pointerType === 'mouse' || event.isPrimary)) {
      this.suppressClick = false; this.touchSequence = false;
    }
    if (event.pointerType === 'touch' || event.pointerType === 'pen') this.contacts.add(event.pointerId);
    if (this.drag && event.pointerId !== this.drag.pointerId) {
      if (this.drag.direct && event.pointerType === 'touch') this.touchSequence = true;
      this.stop(true);
    }
  };
  private readonly contactEnd = (event: PointerEvent): void => { this.contacts.delete(event.pointerId); };
  private readonly touch = (event: Event): void => {
    // MapLibre consumes legacy TouchEvents as well as compatibility mouse input.
    // Shield only contact sequences acquired on a handle; free-map gestures
    // continue through the host's existing pan/zoom/pitch configuration.
    if (this.touchSequence && event.target === this.canvas) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
    if ((event.type === 'touchend' || event.type === 'touchcancel') && !(event as TouchEvent).touches.length) this.touchSequence = false;
  };
  private readonly click = (event: MouseEvent): void => {
    if (this.suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
}
