import type { Map as MapLibreMap } from 'maplibre-gl';
import { geometryParts } from '../core/geometry.js';
import { project, unproject } from '../core/mercator-transform.js';
import type { EditorAppearance } from '../core/appearance.js';
import type { Coordinate, EditorState, GeometryFeature } from '../core/types.js';
import type { ScreenPoint } from '../core/snapping.js';
import { canvasPoint } from './pointer.js';

type Axis = 'both' | 'x' | 'y';
const handles = [
  ['nw', 0, 1, 'both', 'Scale proportionally, northwest'], ['n', 0.5, 1, 'y', 'Scale vertically, north'],
  ['ne', 1, 1, 'both', 'Scale proportionally, northeast'], ['e', 1, 0.5, 'x', 'Scale horizontally, east'],
  ['se', 1, 0, 'both', 'Scale proportionally, southeast'], ['s', 0.5, 0, 'y', 'Scale vertically, south'],
  ['sw', 0, 0, 'both', 'Scale proportionally, southwest'], ['w', 0, 0.5, 'x', 'Scale horizontally, west'],
] as const;
interface Actions {
  state(): EditorState;
  factors(x: number, y: number): void;
  finish(): void;
  cancel(): void;
}
interface Grip { button: HTMLButtonElement; axis: Axis; point: Coordinate; }
interface Gesture {
  id: number;
  grip: Grip;
  vector: Coordinate;
  pointer: Coordinate;
  start: ScreenPoint;
  factors: Coordinate;
  next: Coordinate;
  restore: (() => void)[];
  cursor: string;
  moved: boolean;
}

/** Centre-based scaling along Mercator axes; all mouse changes remain a preview. */
export class ScalingInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly root: HTMLDivElement;
  private readonly box: SVGPathElement;
  private readonly ghost: SVGPathElement;
  private readonly cross: SVGPathElement;
  private readonly label: HTMLSpanElement;
  private readonly grips: Grip[] = [];
  private features: GeometryFeature[] = [];
  private originals: GeometryFeature[] = [];
  private gesture: Gesture | undefined;
  private frame: number | undefined;

  constructor(private readonly map: MapLibreMap, private readonly actions: Actions) {
    this.canvas = map.getCanvas();
    const doc = this.canvas.ownerDocument; this.view = doc.defaultView!;
    this.root = doc.createElement('div'); this.root.dataset.geoScaling = '';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    this.box = doc.createElementNS(svg.namespaceURI, 'path') as SVGPathElement;
    this.box.dataset.geoScaleBox = ''; this.box.setAttribute('fill', 'none'); this.box.setAttribute('stroke-dasharray', '5 5');
    this.ghost = doc.createElementNS(svg.namespaceURI, 'path') as SVGPathElement;
    this.ghost.setAttribute('fill', 'none'); this.ghost.setAttribute('stroke', '#64748b'); this.ghost.setAttribute('stroke-dasharray', '4 4');
    this.cross = doc.createElementNS(svg.namespaceURI, 'path') as SVGPathElement;
    this.cross.setAttribute('stroke-width', '1.5'); svg.append(this.ghost, this.box, this.cross); this.root.append(svg);
    for (const [name, , , axis, label] of handles) {
      const button = doc.createElement('button'); button.type = 'button'; button.dataset.geoScaleHandle = name;
      button.setAttribute('aria-label', label); button.title = `${label}. Arrow keys: 1%; Shift + arrows: 10%.`;
      button.style.cssText = 'position:absolute;pointer-events:auto;width:28px;height:28px;padding:0;border:8px solid transparent;border-radius:3px;background-clip:padding-box;touch-action:none;transform:translate(-50%,-50%);';
      const grip: Grip = { button, axis, point: [0, 0] }; this.grips.push(grip);
      button.addEventListener('pointerdown', this.down); button.addEventListener('lostpointercapture', this.interrupt);
      button.addEventListener('click', this.click); button.addEventListener('keydown', this.handleKey); this.root.append(button);
    }
    this.label = doc.createElement('span'); this.label.dataset.geoScaleFactors = '';
    this.label.style.cssText = 'position:absolute;padding:3px 7px;border-radius:5px;background:#1e293b;color:#fff;font:12px/18px system-ui;white-space:nowrap;';
    this.root.append(this.label);
    this.view.addEventListener('pointermove', this.move); this.view.addEventListener('pointerup', this.up);
    this.view.addEventListener('pointercancel', this.interrupt); this.view.addEventListener('blur', this.blur);
    this.view.addEventListener('keydown', this.key, true);
    map.on('move', this.camera); map.on('resize', this.camera);
  }

  render(features: GeometryFeature[], originals: GeometryFeature[], appearance: EditorAppearance): void {
    if (this.actions.state().mode !== 'scale-features') return;
    this.features = features; this.originals = originals;
    if (!this.root.isConnected) this.map.getCanvasContainer().append(this.root);
    const color = this.actions.state().scaleError ? '#b91c1c' : appearance.selected.lineColor;
    this.box.setAttribute('stroke', color); this.cross.setAttribute('stroke', appearance.pivot.strokeColor);
    for (const grip of this.grips) grip.button.style.backgroundColor = color;
    this.layout();
  }

  private paths(features: GeometryFeature[]): Coordinate[][] {
    return features.flatMap(feature => geometryParts(feature.geometry).flatMap(part =>
      part.type === 'Polygon' ? part.coordinates : part.type === 'Point' ? [[part.coordinates]] : [part.coordinates]));
  }

  private layout(): void {
    const state = this.actions.state();
    if (!this.root.isConnected || !state.scalePivot) return;
    const points = this.paths(this.features).flat().map(project);
    if (!points.length) return;
    let left = Infinity; let right = -Infinity; let bottom = Infinity; let top = -Infinity;
    for (const [x, y] of points) { left = Math.min(left, x); right = Math.max(right, x); bottom = Math.min(bottom, y); top = Math.max(top, y); }
    const pivot = this.map.project(state.scalePivot);
    const corners: ScreenPoint[] = [];
    for (let i = 0; i < handles.length; i++) {
      const [, x, y] = handles[i]!; const grip = this.grips[i]!;
      grip.point = [left + x * (right - left), bottom + y * (top - bottom)];
      const p = this.map.project(unproject(grip.point));
      if (i % 2 === 0) corners.push(p);
      Object.assign(grip.button.style, { left: `${p.x}px`, top: `${p.y}px` });
      const dx = p.x - pivot.x; const dy = p.y - pivot.y;
      const cursors = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];
      grip.button.style.cursor = cursors[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 4]!;
      // A collapsed dimension cannot be expanded by multiplication; use numeric input.
      grip.button.disabled = Math.hypot(dx, dy) < 10 || grip.axis === 'x' && right - left < 1e-14 || grip.axis === 'y' && top - bottom < 1e-14;
    }
    this.box.setAttribute('d', corners.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('') + 'Z');
    this.cross.setAttribute('d', `M${pivot.x - 10},${pivot.y}h20M${pivot.x},${pivot.y - 10}v20`);
    this.ghost.setAttribute('d', this.paths(this.originals).map(path => path.map((point, i) => {
      const p = this.map.project(point); return `${i ? 'L' : 'M'}${p.x},${p.y}`;
    }).join('')).join(''));
    const x = Math.min(...corners.map(p => p.x)); const y = Math.min(...corners.map(p => p.y));
    Object.assign(this.label.style, { left: `${Math.max(0, Math.min(this.canvas.clientWidth - 160, x))}px`, top: `${Math.max(0, y - 38)}px` });
    this.label.textContent = `${Number((state.scaleFactorX! * 100).toFixed(1))}% × ${Number((state.scaleFactorY! * 100).toFixed(1))}%`;
  }

  private world(point: ScreenPoint): Coordinate | null {
    const coordinate = this.map.unproject([point.x, point.y]).toArray();
    if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[1]) >= 90) return null;
    const result = project(coordinate); return result.every(Number.isFinite) ? result : null;
  }

  private readonly down = (event: PointerEvent): void => {
    if (this.gesture || event.button !== 0 || event.pointerType !== 'mouse' || event.ctrlKey || event.metaKey || event.altKey) return;
    const state = this.actions.state(); const grip = this.grips.find(g => g.button === event.currentTarget)!;
    if (!state.scalePivot || state.scaleError || grip.button.disabled) return;
    const start = canvasPoint(this.canvas, event); const pointer = this.world(start); if (!pointer) return;
    const pivot = project(state.scalePivot); const vector: Coordinate = [grip.point[0] - pivot[0], grip.point[1] - pivot[1]];
    if (grip.axis === 'x' && Math.abs(vector[0]) < 1e-14 || grip.axis === 'y' && Math.abs(vector[1]) < 1e-14) return;
    event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true }); this.map.stop();
    const restore = [this.map.dragPan, this.map.dragRotate, this.map.scrollZoom, this.map.boxZoom,
      this.map.doubleClickZoom, this.map.keyboard, this.map.touchZoomRotate, this.map.touchPitch].map(handler => {
      const enabled = handler.isEnabled(); handler.disable(); return () => { if (enabled) handler.enable(); else handler.disable(); };
    });
    const factors: Coordinate = [state.scaleFactorX!, state.scaleFactorY!];
    this.gesture = { id: event.pointerId, grip, vector, pointer, start, factors, next: factors,
      restore, cursor: this.canvas.style.cursor, moved: false };
    this.canvas.style.cursor = grip.button.style.cursor; grip.button.setPointerCapture(event.pointerId);
  };

  private update(event: PointerEvent): void {
    const g = this.gesture; if (!g) return;
    const point = canvasPoint(this.canvas, event); const world = this.world(point); if (!world) return;
    g.moved ||= Math.hypot(point.x - g.start.x, point.y - g.start.y) >= 3;
    const x = g.vector[0] + world[0] - g.pointer[0]; const y = g.vector[1] + world[1] - g.pointer[1];
    const ratio = g.grip.axis === 'x' ? x / g.vector[0] : g.grip.axis === 'y' ? y / g.vector[1]
      : (x * g.vector[0] + y * g.vector[1]) / (g.vector[0] ** 2 + g.vector[1] ** 2);
    // Crossing the pivot never mirrors or collapses geometry. Keep the last positive preview.
    const next: Coordinate = [g.factors[0] * (g.grip.axis === 'y' ? 1 : ratio), g.factors[1] * (g.grip.axis === 'x' ? 1 : ratio)];
    if (next.every(value => Number.isFinite(value) && value > 0)) g.next = next;
  }
  private flush(): void {
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame); this.frame = undefined;
    if (this.gesture?.moved) this.actions.factors(...this.gesture.next);
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

  stop(rollback = false, restoreHandlers = true): void {
    const g = this.gesture; if (!g) return; this.gesture = undefined;
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame); this.frame = undefined;
    if (g.grip.button.hasPointerCapture(g.id)) g.grip.button.releasePointerCapture(g.id);
    this.canvas.style.cursor = g.cursor;
    if (restoreHandlers) for (const restore of g.restore) restore();
    if (rollback && this.actions.state().mode === 'scale-features') this.actions.factors(...g.factors);
    this.layout();
  }
  clear(): void { this.stop(); this.root.remove(); this.features = []; this.originals = []; }
  destroy(restoreHandlers: boolean): void {
    this.stop(false, restoreHandlers); this.root.remove(); this.features = []; this.originals = [];
    for (const { button } of this.grips) {
      button.removeEventListener('pointerdown', this.down); button.removeEventListener('lostpointercapture', this.interrupt);
      button.removeEventListener('click', this.click); button.removeEventListener('keydown', this.handleKey);
    }
    this.view.removeEventListener('pointermove', this.move); this.view.removeEventListener('pointerup', this.up);
    this.view.removeEventListener('pointercancel', this.interrupt); this.view.removeEventListener('blur', this.blur);
    this.view.removeEventListener('keydown', this.key, true);
    this.map.off('move', this.camera); this.map.off('resize', this.camera);
  }
  private readonly click = (event: MouseEvent): void => { event.preventDefault(); event.stopPropagation(); };
  private readonly interrupt = (event: PointerEvent): void => { if (this.gesture?.id === event.pointerId) this.stop(true); };
  private readonly blur = (): void => { this.stop(true); };
  private readonly camera = (): void => { this.stop(true); this.layout(); };
  private readonly key = (event: KeyboardEvent): void => {
    if (!this.gesture || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault(); event.stopImmediatePropagation(); if (event.key === 'Escape') this.stop(true);
    }
  };
  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const state = this.actions.state(); if (!state.scalePivot) return;
    if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation(); const grip = this.grips.find(g => g.button === event.currentTarget)!;
      const step = event.shiftKey ? 1.1 : 1.01; const ratio = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? 1 / step : step;
      this.actions.factors(state.scaleFactorX! * (grip.axis === 'y' ? 1 : ratio), state.scaleFactorY! * (grip.axis === 'x' ? 1 : ratio));
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true });
      if (event.key === 'Enter') this.actions.finish(); else this.actions.cancel();
    }
  };
}
