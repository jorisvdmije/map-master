import type { Map as MapLibreMap } from 'maplibre-gl';
import { geometryParts } from '../core/geometry.js';
import { project, radians } from '../core/mercator-transform.js';
import { normalizeRotationAngle } from '../core/rotation.js';
import type { EditorAppearance } from '../core/appearance.js';
import type { Coordinate, EditorState, GeometryFeature } from '../core/types.js';
import type { ScreenPoint } from '../core/snapping.js';
import { canvasPoint } from './pointer.js';

interface Actions {
  state(): EditorState;
  angle(degrees: number): void;
  finish(): void;
  cancel(): void;
}
interface Gesture {
  id: number;
  angle: number;
  heading: number;
  raw: number;
  start: ScreenPoint;
  point: ScreenPoint;
  moved: boolean;
  shift: boolean;
  restore: (() => void)[];
  cursor: string;
}

/** Mouse rotation is a preview, never a commit. Its frame is always screen-aligned. */
export class RotationInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly root: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly box: SVGRectElement;
  private readonly ghost: SVGPathElement;
  private readonly stem: SVGLineElement;
  private readonly cross: SVGPathElement;
  private readonly handle: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private gesture: Gesture | undefined;
  private frame: number | undefined;
  private originals: GeometryFeature[] = [];
  private features: GeometryFeature[] = [];

  constructor(private readonly map: MapLibreMap, private readonly actions: Actions) {
    this.canvas = map.getCanvas();
    const doc = this.canvas.ownerDocument;
    this.view = doc.defaultView!;
    this.root = doc.createElement('div');
    this.root.dataset.geoRotation = '';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
    this.svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';
    this.ghost = doc.createElementNS(this.svg.namespaceURI, 'path') as SVGPathElement;
    this.ghost.setAttribute('fill', 'none'); this.ghost.setAttribute('stroke-dasharray', '4 4');
    this.ghost.setAttribute('stroke', '#64748b'); this.ghost.setAttribute('stroke-width', '1');
    this.box = doc.createElementNS(this.svg.namespaceURI, 'rect') as SVGRectElement;
    this.box.dataset.geoRotationBox = '';
    this.box.setAttribute('fill', 'none'); this.box.setAttribute('stroke-dasharray', '5 5'); this.box.setAttribute('stroke-width', '1');
    this.stem = doc.createElementNS(this.svg.namespaceURI, 'line') as SVGLineElement;
    this.stem.setAttribute('stroke-width', '1');
    this.cross = doc.createElementNS(this.svg.namespaceURI, 'path') as SVGPathElement;
    this.cross.setAttribute('stroke-width', '1.5');
    this.svg.append(this.ghost, this.box, this.stem, this.cross);
    this.handle = doc.createElement('button');
    this.handle.type = 'button'; this.handle.dataset.geoRotationHandle = '';
    this.handle.setAttribute('aria-label', 'Rotate selection by dragging');
    this.handle.title = 'Drag to rotate. Shift: 15° steps. Arrow keys: 1°; Shift + arrows: 15°.';
    this.handle.textContent = '↻';
    this.handle.style.cssText = 'position:absolute;pointer-events:auto;width:44px;height:44px;padding:0;border:8px solid transparent;border-radius:50%;background-clip:padding-box;color:white;font:22px/28px system-ui;cursor:grab;touch-action:none;transform:translate(-50%,-50%);';
    this.label = doc.createElement('span');
    this.label.dataset.geoRotationAngle = '';
    this.label.style.cssText = 'position:absolute;padding:3px 7px;border-radius:5px;background:#1e293b;color:#fff;font:12px/18px system-ui;white-space:nowrap;';
    this.root.append(this.svg, this.handle, this.label);
    this.handle.addEventListener('pointerdown', this.down);
    this.handle.addEventListener('click', this.click);
    this.handle.addEventListener('keydown', this.handleKey);
    this.handle.addEventListener('lostpointercapture', this.interrupt);
    this.view.addEventListener('pointermove', this.move);
    this.view.addEventListener('pointerup', this.up);
    this.view.addEventListener('pointercancel', this.interrupt);
    this.view.addEventListener('keydown', this.key, true);
    this.view.addEventListener('keyup', this.key, true);
    this.view.addEventListener('blur', this.blur);
    map.on('move', this.camera);
    map.on('resize', this.camera);
  }

  render(features: GeometryFeature[], originals: GeometryFeature[], appearance: EditorAppearance): void {
    if (this.actions.state().mode !== 'rotate-features') return;
    this.features = features;
    if (!this.root.isConnected) {
      this.originals = originals;
      this.map.getCanvasContainer().append(this.root);
    }
    const color = this.actions.state().rotationError ? '#b91c1c' : appearance.selected.lineColor;
    this.box.setAttribute('stroke', color); this.stem.setAttribute('stroke', color);
    this.handle.style.backgroundColor = color;
    this.cross.setAttribute('stroke', appearance.pivot.strokeColor);
    this.layout();
  }

  private paths(features: GeometryFeature[]): ScreenPoint[][] {
    return features.flatMap(feature => geometryParts(feature.geometry).flatMap(part => {
      const paths = part.type === 'Polygon' ? part.coordinates : part.type === 'Point' ? [[part.coordinates]] : [part.coordinates];
      return paths.map(path => path.map(coordinate => this.map.project(coordinate)));
    }));
  }

  private layout(): void {
    if (!this.root.isConnected) return;
    const state = this.actions.state();
    if (!state.rotationPivot) return;
    const points = this.paths(this.features).flat();
    if (!points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      this.root.style.visibility = 'hidden'; return;
    }
    this.root.style.visibility = '';
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (const p of points) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y); }
    // Compute bounds from the current projected geometry, never rotate the frame.
    for (const [key, value] of Object.entries({ x: left, y: top, width: right - left, height: bottom - top })) this.box.setAttribute(key, String(value));
    const width = this.canvas.clientWidth; const height = this.canvas.clientHeight;
    const clamp = (n: number, max: number) => Math.max(24, Math.min(max - 24, n));
    const anchor = this.gesture?.point ?? { x: clamp((left + right) / 2, width), y: clamp(top >= 60 ? top - 36 : bottom + 36, height) };
    const edge = { x: Math.max(left, Math.min(right, anchor.x)), y: Math.max(top, Math.min(bottom, anchor.y)) };
    for (const [key, value] of Object.entries({ x1: edge.x, y1: edge.y, x2: anchor.x, y2: anchor.y })) this.stem.setAttribute(key, String(value));
    Object.assign(this.handle.style, { left: `${anchor.x}px`, top: `${anchor.y}px` });
    Object.assign(this.label.style, { left: `${Math.max(0, Math.min(width - 80, anchor.x + 24))}px`, top: `${Math.max(0, Math.min(height - 26, anchor.y - 12))}px` });
    this.label.textContent = `${Number((state.rotationAngle ?? 0).toFixed(1))}°${this.gesture?.shift ? ' · 15°' : ''}`;
    const p = this.map.project(state.rotationPivot);
    this.cross.setAttribute('d', `M${p.x - 10},${p.y}h20M${p.x},${p.y - 10}v20`);
    this.ghost.setAttribute('d', this.paths(this.originals).map(path => path.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('')).join(''));
  }

  private heading(point: ScreenPoint, pivot: Coordinate): number | null {
    const screenPivot = this.map.project(pivot);
    if (Math.hypot(point.x - screenPivot.x, point.y - screenPivot.y) < 10) return null;
    const coordinate = this.map.unproject([point.x, point.y]).toArray();
    if (Math.abs(coordinate[1]) >= 90) return null;
    const [x, y] = project(coordinate); const [cx, cy] = project(pivot);
    const heading = Math.atan2(cy - y, x - cx) / radians;
    return Number.isFinite(heading) ? heading : null;
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.gesture || event.button !== 0 || event.pointerType !== 'mouse' || event.ctrlKey || event.metaKey || event.altKey) return;
    const state = this.actions.state();
    if (state.mode !== 'rotate-features' || !state.rotationPivot) return;
    const point = canvasPoint(this.canvas, event);
    const heading = this.heading(point, state.rotationPivot);
    if (heading === null) return;
    event.preventDefault(); event.stopPropagation();
    this.canvas.focus({ preventScroll: true }); this.map.stop();
    const handlers = [this.map.dragPan, this.map.dragRotate, this.map.scrollZoom, this.map.boxZoom,
      this.map.doubleClickZoom, this.map.keyboard, this.map.touchZoomRotate, this.map.touchPitch];
    const restore = handlers.map(handler => {
      const enabled = handler.isEnabled(); handler.disable();
      return () => { if (enabled) handler.enable(); else handler.disable(); };
    });
    this.gesture = { id: event.pointerId, angle: state.rotationAngle!, raw: state.rotationAngle!, heading,
      point, start: point, moved: false, shift: event.shiftKey, restore, cursor: this.canvas.style.cursor };
    this.canvas.style.cursor = 'grabbing'; this.handle.style.cursor = 'grabbing';
    this.handle.setPointerCapture(event.pointerId);
  };

  private update(event: PointerEvent): void {
    const gesture = this.gesture; const pivot = this.actions.state().rotationPivot;
    if (!gesture || !pivot) return;
    gesture.point = canvasPoint(this.canvas, event); gesture.shift = event.shiftKey;
    const heading = this.heading(gesture.point, pivot);
    // Re-anchor when leaving the dead zone, rather than jumping 180° across the pivot.
    if (heading === null) { gesture.heading = NaN; return; }
    if (Number.isFinite(gesture.heading)) gesture.raw += normalizeRotationAngle(heading - gesture.heading);
    gesture.heading = heading;
    gesture.moved ||= Math.hypot(gesture.point.x - gesture.start.x, gesture.point.y - gesture.start.y) >= 3;
  }

  private flush(): void {
    const gesture = this.gesture;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (!gesture?.moved) return;
    this.actions.angle(gesture.shift ? Math.round(gesture.raw / 15) * 15 : gesture.raw);
    this.layout();
  }

  private readonly move = (event: PointerEvent): void => {
    if (this.gesture?.id !== event.pointerId) return;
    this.update(event);
    if (this.frame === undefined) this.frame = this.view.requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
  };
  private readonly up = (event: PointerEvent): void => {
    if (this.gesture?.id !== event.pointerId) return;
    this.update(event); this.flush(); this.stop();
  };

  /** Stop input before an API command or lifecycle change. Rollback is only for interrupted gestures. */
  stop(rollback = false, restoreHandlers = true): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined;
    if (this.handle.hasPointerCapture(gesture.id)) this.handle.releasePointerCapture(gesture.id);
    this.canvas.style.cursor = gesture.cursor; this.handle.style.cursor = 'grab';
    if (restoreHandlers) for (const restore of gesture.restore) restore();
    if (rollback && this.actions.state().mode === 'rotate-features') this.actions.angle(gesture.angle);
    this.layout();
  }

  clear(): void { this.stop(); this.root.remove(); this.features = []; this.originals = []; }

  destroy(restoreHandlers: boolean): void {
    this.stop(false, restoreHandlers); this.root.remove(); this.features = []; this.originals = [];
    this.handle.removeEventListener('pointerdown', this.down);
    this.handle.removeEventListener('click', this.click);
    this.handle.removeEventListener('keydown', this.handleKey);
    this.handle.removeEventListener('lostpointercapture', this.interrupt);
    this.view.removeEventListener('pointermove', this.move);
    this.view.removeEventListener('pointerup', this.up);
    this.view.removeEventListener('pointercancel', this.interrupt);
    this.view.removeEventListener('keydown', this.key, true);
    this.view.removeEventListener('keyup', this.key, true);
    this.view.removeEventListener('blur', this.blur);
    this.map.off('move', this.camera); this.map.off('resize', this.camera);
  }
  private readonly click = (event: MouseEvent): void => { event.preventDefault(); event.stopPropagation(); };
  private readonly interrupt = (event: PointerEvent): void => { if (this.gesture?.id === event.pointerId) this.stop(true); };
  private readonly blur = (): void => { this.stop(true); };
  private readonly camera = (): void => { this.stop(true); this.layout(); };
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.gesture || event.isComposing) return;
    if (event.key === 'Shift') { this.gesture.shift = event.type === 'keydown'; this.flush(); }
    if (event.type !== 'keydown' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') this.stop(true);
    }
  };
  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const angle = this.actions.state().rotationAngle;
    if (angle === null) return;
    if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      this.actions.angle(angle + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 15 : 1));
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true });
      if (event.key === 'Enter') this.actions.finish(); else this.actions.cancel();
    }
  };
}
