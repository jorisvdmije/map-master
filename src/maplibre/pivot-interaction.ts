import type { Map as MapLibreMap } from 'maplibre-gl';
import { SnapIndex, type ScreenPoint } from '../core/snapping.js';
import { mercatorLatitudeLimit, transformPivot } from '../core/mercator-transform.js';
import type { EditorAppearance } from '../core/appearance.js';
import type { Coordinate, EditorState, GeometryFeature, SnappingOptions } from '../core/types.js';
import { canvasPoint } from './pointer.js';

type Kind = 'rotation' | 'scale';
interface Actions {
  state(): EditorState;
  snapping(): SnappingOptions;
  start(): void;
  pivot(kind: Kind, coordinate?: Coordinate): void;
  finish(kind: Kind): void;
  cancel(): void;
}
interface Gesture {
  id: number; kind: Kind; pivot: Coordinate; origin: ScreenPoint; start: ScreenPoint;
  point: ScreenPoint; alt: boolean; moved: boolean; cursor: string; restore: (() => void)[];
}

/** A pivot changes the absolute transform of frozen originals; it never commits geometry. */
export class PivotInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly root: HTMLDivElement;
  private readonly handle: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private originals: GeometryFeature[] = [];
  private center: Coordinate | null = null;
  private index: SnapIndex | undefined;
  private gesture: Gesture | undefined;
  private frame: number | undefined;
  private snapKind: 'vertex' | 'center' | null = null;
  private pivotColor = '#1e293b';
  private snapColor = '#7c3aed';

  constructor(private readonly map: MapLibreMap, private readonly actions: Actions) {
    this.canvas = map.getCanvas(); const doc = this.canvas.ownerDocument; this.view = doc.defaultView!;
    this.root = doc.createElement('div'); this.root.dataset.geoPivot = '';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3;';
    this.handle = doc.createElement('button'); this.handle.type = 'button'; this.handle.dataset.geoPivotHandle = '';
    this.handle.textContent = '⊕';
    this.handle.style.cssText = 'position:absolute;pointer-events:auto;width:28px;height:28px;padding:0;border:2px solid;border-radius:50%;font:22px/24px system-ui;cursor:move;touch-action:none;transform:translate(-50%,-50%);';
    this.label = doc.createElement('span'); this.label.dataset.geoPivotLabel = '';
    this.label.style.cssText = 'position:absolute;padding:2px 5px;border-radius:4px;background:#1e293b;color:#fff;font:11px/16px system-ui;white-space:nowrap;';
    this.root.append(this.handle, this.label);
    this.handle.addEventListener('pointerdown', this.down); this.handle.addEventListener('lostpointercapture', this.interrupt);
    this.handle.addEventListener('keydown', this.handleKey); this.handle.addEventListener('click', this.click);
    this.view.addEventListener('pointermove', this.move); this.view.addEventListener('pointerup', this.up);
    this.view.addEventListener('pointercancel', this.interrupt); this.view.addEventListener('blur', this.blur);
    this.view.addEventListener('keydown', this.key, true); this.view.addEventListener('keyup', this.key, true);
    map.on('move', this.camera); map.on('resize', this.camera);
  }
  private current(): { kind: Kind; pivot: Coordinate } | null {
    const state = this.actions.state();
    if (state.mode === 'rotate-features' && state.rotationPivot) return { kind: 'rotation', pivot: state.rotationPivot };
    if (state.mode === 'scale-features' && state.scalePivot) return { kind: 'scale', pivot: state.scalePivot };
    return null;
  }
  render(originals: GeometryFeature[], appearance: EditorAppearance): void {
    const current = this.current(); if (!current) return;
    if (!this.root.isConnected) {
      this.originals = originals; this.center = transformPivot(originals);
      this.map.getCanvasContainer().append(this.root);
    }
    this.handle.setAttribute('aria-label', `Move ${current.kind} pivot`);
    this.handle.title = 'Drag pivot; Alt bypasses snapping. Arrows: 1 pixel; Shift: 10 pixels. Home: original centre. Enter applies; Escape cancels.';
    this.handle.style.backgroundColor = appearance.pivot.color;
    this.handle.style.color = appearance.pivot.strokeColor;
    this.pivotColor = appearance.pivot.strokeColor; this.snapColor = appearance.snap.color;
    this.layout();
  }
  private layout(): void {
    const current = this.current(); if (!this.root.isConnected || !current) return;
    const point = this.map.project(current.pivot);
    this.root.style.visibility = Number.isFinite(point.x) && Number.isFinite(point.y) ? '' : 'hidden';
    Object.assign(this.handle.style, { left: `${point.x}px`, top: `${point.y}px` });
    Object.assign(this.label.style, { left: `${point.x + 20}px`, top: `${point.y - 10}px` });
    this.label.textContent = this.snapKind ? `Pivot · ${this.snapKind}` : 'Pivot';
    this.handle.dataset.geoPivotSnap = this.snapKind ?? '';
    this.handle.style.borderColor = this.snapKind ? this.snapColor : this.pivotColor;
  }
  private coordinate(point: ScreenPoint): Coordinate | null {
    const p = this.map.unproject([point.x, point.y]).toArray();
    return p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= mercatorLatitudeLimit ? p : null;
  }
  private readonly down = (event: PointerEvent): void => {
    if (this.gesture || event.button !== 0 || event.pointerType !== 'mouse' || event.ctrlKey || event.metaKey) return;
    const current = this.current(); if (!current) return;
    event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true }); this.map.stop(); this.actions.start();
    const start = canvasPoint(this.canvas, event);
    const restore = [this.map.dragPan, this.map.dragRotate, this.map.scrollZoom, this.map.boxZoom,
      this.map.doubleClickZoom, this.map.keyboard, this.map.touchZoomRotate, this.map.touchPitch].map(handler => {
      const enabled = handler.isEnabled(); handler.disable(); return () => { if (enabled) handler.enable(); else handler.disable(); };
    });
    this.gesture = { id: event.pointerId, kind: current.kind, pivot: current.pivot, origin: this.map.project(current.pivot),
      start, point: start, alt: event.altKey, moved: false, cursor: this.canvas.style.cursor, restore };
    this.canvas.style.cursor = 'move'; this.handle.setPointerCapture(event.pointerId);
  };
  private update(event: PointerEvent): void {
    const g = this.gesture; if (!g) return;
    g.point = canvasPoint(this.canvas, event); g.alt = event.altKey;
    g.moved ||= Math.hypot(g.point.x - g.start.x, g.point.y - g.start.y) >= 3;
  }
  private flush(): void {
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame); this.frame = undefined;
    const g = this.gesture; if (!g?.moved) return;
    const point = { x: g.origin.x + g.point.x - g.start.x, y: g.origin.y + g.point.y - g.start.y };
    let coordinate = this.coordinate(point); if (!coordinate) return;
    this.snapKind = null;
    const options = this.actions.snapping();
    if (options.enabled && !g.alt) {
      this.index ??= new SnapIndex({ type: 'FeatureCollection', features: this.originals }, p => this.map.project(p));
      const snap = this.index.query(point, { ...options, edges: false }, p => this.map.unproject([p.x, p.y]).toArray());
      const center = this.center && this.map.project(this.center);
      const distance = center ? Math.hypot(center.x - point.x, center.y - point.y) : Infinity;
      // Nearest wins; an original vertex wins exact ties against the centre.
      if (snap) { coordinate = snap.coordinate; this.snapKind = 'vertex'; }
      if (this.center && distance <= options.distance && (!snap || distance < snap.distance)) {
        coordinate = this.center; this.snapKind = 'center';
      }
    }
    this.actions.pivot(g.kind, coordinate); this.layout();
  }
  refresh(): void { if (this.gesture) this.flush(); }
  private readonly move = (event: PointerEvent): void => {
    if (this.gesture?.id !== event.pointerId) return; this.update(event);
    if (this.frame === undefined) this.frame = this.view.requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
  };
  private readonly up = (event: PointerEvent): void => {
    if (this.gesture?.id !== event.pointerId) return; this.update(event); this.flush(); this.stop();
  };
  stop(rollback = false, restoreHandlers = true): void {
    const g = this.gesture; if (!g) return; this.gesture = undefined;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame); this.frame = undefined;
    if (this.handle.hasPointerCapture(g.id)) this.handle.releasePointerCapture(g.id);
    this.canvas.style.cursor = g.cursor; if (restoreHandlers) for (const restore of g.restore) restore();
    this.snapKind = null;
    if (rollback && this.current()?.kind === g.kind) this.actions.pivot(g.kind, g.pivot);
    this.layout();
  }
  clear(): void { this.stop(); this.root.remove(); this.originals = []; this.center = null; this.index = undefined; this.snapKind = null; }
  destroy(restoreHandlers: boolean): void {
    this.stop(false, restoreHandlers); this.clear();
    this.handle.removeEventListener('pointerdown', this.down); this.handle.removeEventListener('lostpointercapture', this.interrupt);
    this.handle.removeEventListener('keydown', this.handleKey); this.handle.removeEventListener('click', this.click);
    this.view.removeEventListener('pointermove', this.move); this.view.removeEventListener('pointerup', this.up);
    this.view.removeEventListener('pointercancel', this.interrupt); this.view.removeEventListener('blur', this.blur);
    this.view.removeEventListener('keydown', this.key, true); this.view.removeEventListener('keyup', this.key, true);
    this.map.off('move', this.camera); this.map.off('resize', this.camera);
  }
  private readonly camera = (): void => { this.stop(true); this.index = undefined; this.layout(); };
  private readonly blur = (): void => { this.stop(true); };
  private readonly interrupt = (event: PointerEvent): void => { if (this.gesture?.id === event.pointerId) this.stop(true); };
  private readonly click = (event: MouseEvent): void => { event.preventDefault(); event.stopPropagation(); };
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.gesture || event.isComposing) return;
    if (event.key === 'Alt') { this.gesture.alt = event.type === 'keydown'; this.flush(); }
    if (event.type !== 'keydown' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation(); if (event.key === 'Escape') this.stop(true);
    }
  };
  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const current = this.current(); if (!current) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); this.actions.start(); this.stop();
      if (event.key === 'Home') { this.actions.pivot(current.kind); return; }
      const point = this.map.project(current.pivot); const step = event.shiftKey ? 10 : 1;
      point.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      point.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      const next = this.coordinate(point); if (next) this.actions.pivot(current.kind, next);
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true });
      if (event.key === 'Enter') this.actions.finish(current.kind); else this.actions.cancel();
    }
  };
}
