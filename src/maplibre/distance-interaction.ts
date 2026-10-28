import type { Map as MapLibreMap } from 'maplibre-gl';
import { geometryParts } from '../core/geometry.js';
import { project, unproject } from '../core/mercator-transform.js';
import type { EditorAppearance } from '../core/appearance.js';
import type { Coordinate, EditorState, GeometryFeature } from '../core/types.js';
import type { ScreenPoint } from '../core/snapping.js';
import { canvasPoint } from './pointer.js';

const radius = 6378137;
type Kind = 'buffer' | 'offset';
interface Guide { origin: Coordinate; normal: Coordinate; }
interface Actions {
  state(): EditorState;
  distance(kind: Kind, meters: number): void;
  finish(kind: Kind): void;
  cancel(): void;
}
interface Gesture {
  id: number;
  kind: Kind;
  start: ScreenPoint;
  pointer: Coordinate;
  distance: number;
  next: number;
  normal: Coordinate;
  moved: boolean;
  cursor: string;
  restore: (() => void)[];
}
const meters = (p: Coordinate): Coordinate => { const [x, y] = project(p); return [x * radius, y * radius]; };

/** A fixed reference on frozen originals. Buffer uses its eastmost vertex;
 * offset uses the first endpoint, whose displacement is exactly its left normal.
 */
function reference(features: GeometryFeature[], kind: Kind): Guide | null {
  if (kind === 'offset') {
    const geometry = features[0]?.geometry;
    const path = geometry?.type === 'LineString' ? geometry.coordinates : geometry?.type === 'MultiLineString' ? geometry.coordinates[0] : undefined;
    if (!path || path.length < 2) return null;
    const origin = meters(path[0]!); const end = meters(path[1]!);
    const dx = end[0] - origin[0]; const dy = end[1] - origin[1]; const length = Math.hypot(dx, dy);
    return length > 0 ? { origin, normal: [-dy / length, dx / length] } : null;
  }
  let east: Coordinate | undefined;
  for (const path of paths(features)) for (const point of path) {
    const p = meters(point); if (!east || p[0] > east[0]) east = p;
  }
  return east ? { origin: east, normal: [1, 0] } : null;
}
function paths(features: GeometryFeature[]): Coordinate[][] {
  return features.flatMap(feature => geometryParts(feature.geometry).flatMap(part =>
    part.type === 'Polygon' ? part.coordinates : part.type === 'Point' ? [[part.coordinates]] : [part.coordinates]));
}

/** Shared mouse/keyboard distance control. Release reviews; only explicit Apply commits. */
export class DistanceInteraction {
  private readonly canvas: HTMLCanvasElement;
  private readonly view: Window;
  private readonly root: HTMLDivElement;
  private readonly ghost: SVGPathElement;
  private readonly ruler: SVGLineElement;
  private readonly stem: SVGLineElement;
  private readonly ticks: SVGPathElement;
  private readonly origin: SVGCircleElement;
  private readonly end: SVGCircleElement;
  private readonly handle: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private guide: Guide | null = null;
  private originals: GeometryFeature[] = [];
  private gesture: Gesture | undefined;
  private frame: number | undefined;

  constructor(private readonly map: MapLibreMap, private readonly actions: Actions) {
    this.canvas = map.getCanvas(); const doc = this.canvas.ownerDocument; this.view = doc.defaultView!;
    this.root = doc.createElement('div'); this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    this.ghost = doc.createElementNS(svg.namespaceURI, 'path') as SVGPathElement;
    this.ghost.setAttribute('fill', 'none'); this.ghost.setAttribute('stroke', '#64748b'); this.ghost.setAttribute('stroke-dasharray', '4 4');
    this.ghost.dataset.geoDistanceOriginal = '';
    this.ruler = doc.createElementNS(svg.namespaceURI, 'line') as SVGLineElement;
    this.ruler.dataset.geoDistanceRuler = ''; this.ruler.setAttribute('stroke-width', '2');
    this.stem = doc.createElementNS(svg.namespaceURI, 'line') as SVGLineElement;
    this.stem.dataset.geoDistanceStem = ''; this.stem.setAttribute('stroke-dasharray', '3 3');
    this.ticks = doc.createElementNS(svg.namespaceURI, 'path') as SVGPathElement; this.ticks.setAttribute('stroke-width', '2');
    this.origin = doc.createElementNS(svg.namespaceURI, 'circle') as SVGCircleElement; this.origin.dataset.geoDistanceOrigin = '';
    this.end = doc.createElementNS(svg.namespaceURI, 'circle') as SVGCircleElement; this.end.dataset.geoDistanceEnd = '';
    for (const dot of [this.origin, this.end]) { dot.setAttribute('r', '3'); dot.setAttribute('fill', 'white'); }
    svg.append(this.ghost, this.ruler, this.stem, this.ticks, this.origin, this.end); this.root.append(svg);
    this.handle = doc.createElement('button'); this.handle.type = 'button'; this.handle.dataset.geoDistanceHandle = '';
    this.handle.textContent = '↔';
    this.handle.style.cssText = 'position:absolute;pointer-events:auto;width:44px;height:44px;padding:0;border:8px solid transparent;border-radius:50%;background-clip:padding-box;color:white;font:20px/28px system-ui;touch-action:none;';
    this.label = doc.createElement('span'); this.label.dataset.geoDistanceLabel = '';
    this.label.style.cssText = 'position:absolute;padding:3px 7px;border-radius:5px;background:#1e293b;color:#fff;font:12px/18px system-ui;white-space:nowrap;';
    this.root.append(this.handle, this.label);
    this.handle.addEventListener('pointerdown', this.down); this.handle.addEventListener('lostpointercapture', this.interrupt);
    this.handle.addEventListener('click', this.click); this.handle.addEventListener('keydown', this.handleKey);
    this.view.addEventListener('pointermove', this.move); this.view.addEventListener('pointerup', this.up);
    this.view.addEventListener('pointercancel', this.interrupt); this.view.addEventListener('blur', this.blur);
    this.view.addEventListener('keydown', this.key, true);
    map.on('move', this.camera); map.on('resize', this.camera);
  }
  private current(): { kind: Kind; distance: number; invalid: boolean } | null {
    const state = this.actions.state();
    if (state.mode === 'buffer-features') return { kind: 'buffer', distance: state.bufferDistance!, invalid: state.bufferError !== null };
    if (state.mode === 'offset-lines') return { kind: 'offset', distance: state.offsetDistance!, invalid: state.offsetError !== null };
    return null;
  }
  render(originals: GeometryFeature[], appearance: EditorAppearance): void {
    const state = this.current(); if (!state) return;
    if (!this.root.isConnected) {
      this.originals = originals; this.guide = reference(originals, state.kind);
      this.map.getCanvasContainer().append(this.root);
    }
    this.root.dataset.geoDistance = state.kind;
    this.handle.setAttribute('aria-label', `Adjust ${state.kind} distance`);
    this.handle.title = 'Drag to change distance. Arrow keys: 1 Mercator m; Shift + arrows: 10 m. Enter applies; Escape cancels.';
    const color = state.invalid ? '#b91c1c' : appearance.selected.lineColor;
    for (const part of [this.ruler, this.stem, this.ticks, this.origin, this.end]) part.setAttribute('stroke', color);
    this.handle.style.backgroundColor = color; this.layout();
  }
  private screen(point: Coordinate): ScreenPoint | null {
    const coordinate = unproject([point[0] / radius, point[1] / radius]);
    if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[1]) >= 90) return null;
    const p = this.map.project(coordinate); return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }
  private layout(): void {
    const state = this.current(); const guide = this.guide;
    if (!this.root.isConnected || !state || !guide) return;
    const endpoint: Coordinate = [guide.origin[0] + guide.normal[0] * state.distance, guide.origin[1] + guide.normal[1] * state.distance];
    const a = this.screen(guide.origin); const b = this.screen(endpoint);
    const c = this.screen([endpoint[0] + guide.normal[0] * 10, endpoint[1] + guide.normal[1] * 10]);
    if (!a || !b || !c || Math.hypot(c.x - b.x, c.y - b.y) < 1e-9) { this.root.style.visibility = 'hidden'; return; }
    this.root.style.visibility = '';
    const length = Math.hypot(c.x - b.x, c.y - b.y); const nx = (c.x - b.x) / length; const ny = (c.y - b.y) / length;
    // A fixed visible extension keeps even zero/tiny distances easy to grab.
    // Its side never flips when a signed offset crosses zero.
    const grip = { x: b.x + nx * 36, y: b.y + ny * 36 };
    for (const [line, start, end] of [[this.ruler, a, b], [this.stem, b, grip]] as const) {
      for (const [key, value] of Object.entries({ x1: start.x, y1: start.y, x2: end.x, y2: end.y })) line.setAttribute(key, String(value));
    }
    for (const [dot, p] of [[this.origin, a], [this.end, b]] as const) { dot.setAttribute('cx', String(p.x)); dot.setAttribute('cy', String(p.y)); }
    this.ticks.setAttribute('d', [a, b].map(p => `M${p.x - ny * 5},${p.y + nx * 5}L${p.x + ny * 5},${p.y - nx * 5}`).join(''));
    const angle = Math.atan2(ny, nx);
    Object.assign(this.handle.style, { left: `${grip.x}px`, top: `${grip.y}px`, transform: `translate(-50%,-50%) rotate(${angle}rad)`,
      cursor: ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][(Math.round(angle / (Math.PI / 4)) + 8) % 4] });
    Object.assign(this.label.style, { left: `${Math.max(0, Math.min(this.canvas.clientWidth - 220, grip.x + 24))}px`, top: `${Math.max(0, Math.min(this.canvas.clientHeight - 28, grip.y - 12))}px` });
    const side = state.kind === 'offset' ? state.distance > 0 ? ' · left' : state.distance < 0 ? ' · right' : ' · original' : '';
    this.label.textContent = `${Number(state.distance.toPrecision(5))} Mercator m${side}${state.invalid ? ' · invalid' : ''}`;
    this.ghost.setAttribute('d', paths(this.originals).map(path => path.map((point, i) => {
      const p = this.map.project(point); return `${i ? 'L' : 'M'}${p.x},${p.y}`;
    }).join('')).join(''));
  }
  private world(point: ScreenPoint): Coordinate | null {
    const coordinate = this.map.unproject([point.x, point.y]).toArray();
    if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[1]) >= 90) return null;
    const p = meters(coordinate); return p.every(Number.isFinite) ? p : null;
  }
  private readonly down = (event: PointerEvent): void => {
    if (this.gesture || event.button !== 0 || event.pointerType !== 'mouse' || event.ctrlKey || event.metaKey || event.altKey) return;
    const state = this.current(); if (!state || !this.guide) return;
    const start = canvasPoint(this.canvas, event); const pointer = this.world(start); if (!pointer) return;
    event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true }); this.map.stop();
    const restore = [this.map.dragPan, this.map.dragRotate, this.map.scrollZoom, this.map.boxZoom,
      this.map.doubleClickZoom, this.map.keyboard, this.map.touchZoomRotate, this.map.touchPitch].map(handler => {
      const enabled = handler.isEnabled(); handler.disable(); return () => { if (enabled) handler.enable(); else handler.disable(); };
    });
    this.gesture = { id: event.pointerId, kind: state.kind, distance: state.distance, next: state.distance,
      start, pointer, normal: [...this.guide.normal], moved: false, cursor: this.canvas.style.cursor, restore };
    this.canvas.style.cursor = this.handle.style.cursor; this.handle.setPointerCapture(event.pointerId);
  };
  private update(event: PointerEvent): void {
    const g = this.gesture; if (!g) return;
    const point = canvasPoint(this.canvas, event); const p = this.world(point); if (!p) return;
    g.moved ||= Math.hypot(point.x - g.start.x, point.y - g.start.y) >= 3;
    const next = g.distance + (p[0] - g.pointer[0]) * g.normal[0] + (p[1] - g.pointer[1]) * g.normal[1];
    // Buffer never silently becomes an inset. Offset can pass freely through zero.
    if (Number.isFinite(next) && (g.kind === 'offset' || next > 0)) g.next = next;
  }
  private flush(): void {
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame); this.frame = undefined;
    if (this.gesture?.moved) this.actions.distance(this.gesture.kind, this.gesture.next);
  }
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
    if (rollback && this.current()?.kind === g.kind) this.actions.distance(g.kind, g.distance);
    this.layout();
  }
  clear(): void { this.stop(); this.root.remove(); this.originals = []; this.guide = null; }
  destroy(restoreHandlers: boolean): void {
    this.stop(false, restoreHandlers); this.root.remove(); this.originals = []; this.guide = null;
    this.handle.removeEventListener('pointerdown', this.down); this.handle.removeEventListener('lostpointercapture', this.interrupt);
    this.handle.removeEventListener('click', this.click); this.handle.removeEventListener('keydown', this.handleKey);
    this.view.removeEventListener('pointermove', this.move); this.view.removeEventListener('pointerup', this.up);
    this.view.removeEventListener('pointercancel', this.interrupt); this.view.removeEventListener('blur', this.blur);
    this.view.removeEventListener('keydown', this.key, true); this.map.off('move', this.camera); this.map.off('resize', this.camera);
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
    const state = this.current(); if (!state) return;
    if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = state.distance + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 10 : 1);
      if (Number.isFinite(next) && (state.kind === 'offset' || next > 0)) this.actions.distance(state.kind, next);
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.canvas.focus({ preventScroll: true });
      if (event.key === 'Enter') this.actions.finish(state.kind); else this.actions.cancel();
    }
  };
}
