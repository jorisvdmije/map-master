import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate, SnapResult } from '../core/types.js';
import type { EditorAppearance } from '../core/appearance.js';
import type { ScreenPoint } from '../core/snapping.js';
import { project } from '../core/mercator-transform.js';

/** Constant-size overlay: one moving anchor, ruler and displacement label. */
export class TranslationGuide {
  private readonly root: HTMLDivElement;
  private readonly line: SVGLineElement;
  private readonly dot: SVGCircleElement;
  private readonly label: HTMLSpanElement;

  constructor(private readonly map: MapLibreMap) {
    const doc = map.getCanvas().ownerDocument;
    this.root = doc.createElement('div'); this.root.dataset.geoTranslationGuide = '';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    this.line = doc.createElementNS(svg.namespaceURI, 'line') as SVGLineElement;
    this.line.setAttribute('stroke-dasharray', '4 4');
    this.dot = doc.createElementNS(svg.namespaceURI, 'circle') as SVGCircleElement;
    this.dot.dataset.geoTranslationAnchor = ''; this.dot.setAttribute('stroke-width', '2');
    svg.append(this.line, this.dot);
    this.label = doc.createElement('span'); this.label.dataset.geoTranslationLabel = '';
    this.label.style.cssText = 'position:absolute;padding:3px 7px;border-radius:5px;background:#1e293b;color:#fff;font:12px/18px system-ui;white-space:nowrap;';
    this.root.append(svg, this.label);
  }

  render(anchor: Coordinate, delta: Coordinate, pointer: ScreenPoint, snap: SnapResult | null, axis: 'east-west' | 'north-south' | null, valid: boolean, appearance: EditorAppearance): void {
    const end: Coordinate = [anchor[0] + delta[0], anchor[1] + delta[1]];
    const a = this.map.project(anchor); const b = this.map.project(end);
    const visible = [a.x, a.y, b.x, b.y].every(Number.isFinite);
    this.line.style.display = this.dot.style.display = visible ? '' : 'none';
    if (visible) {
      for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) this.line.setAttribute(key, String(value));
      this.dot.setAttribute('cx', String(b.x)); this.dot.setAttribute('cy', String(b.y));
    }
    const color = !valid ? '#b91c1c' : snap ? appearance.snap.color : appearance.selected.lineColor;
    this.line.setAttribute('stroke', color); this.dot.setAttribute('stroke', snap ? appearance.snap.strokeColor : color);
    this.dot.setAttribute('fill', snap ? appearance.snap.color : '#fff');
    this.dot.setAttribute('stroke-width', String(snap ? appearance.snap.strokeWidth : 2));
    this.dot.setAttribute('opacity', String(snap ? appearance.snap.opacity : 1));
    this.dot.setAttribute('r', String(snap ? snap.kind === 'edge' ? appearance.snap.edgeRadius : appearance.snap.radius : 5));
    this.root.dataset.snap = snap?.kind ?? ''; this.root.dataset.axis = axis ?? '';
    const startMeters = project(anchor); const endMeters = project(end);
    const east = (endMeters[0] - startMeters[0]) * 6378137; const north = (endMeters[1] - startMeters[1]) * 6378137;
    const measurable = Math.abs(anchor[1]) < 90 && Math.abs(end[1]) < 90 && [east, north].every(Number.isFinite);
    const format = (value: number) => String(Number(value.toPrecision(5)));
    const distance = measurable ? `${format(Math.hypot(east, north))} Mercator m · E ${format(east)} · N ${format(north)}` : 'Distance unavailable';
    this.label.textContent = `${distance}${axis ? ` · ${axis}` : snap ? ` · ${snap.kind} snap` : ''}${valid ? '' : ' · invalid'}`;
    this.label.style.backgroundColor = valid ? '#1e293b' : '#b91c1c';
    if (!this.root.isConnected) this.map.getCanvasContainer().append(this.root);
    const canvas = this.map.getCanvas();
    this.label.style.left = `${Math.max(0, Math.min(canvas.clientWidth - this.label.offsetWidth, pointer.x + 18))}px`;
    this.label.style.top = `${Math.max(0, Math.min(canvas.clientHeight - this.label.offsetHeight, pointer.y + 18))}px`;
  }

  clear(): void { this.root.remove(); }
}
