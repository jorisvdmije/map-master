import type { Map as MapLibreMap } from 'maplibre-gl';
import { geometryParts, type Geometry } from '../core/geometry.js';
import type { Coordinate } from '../core/types.js';
import { resolveAppearance, type PointAppearance, type DraftAppearance } from '../core/appearance.js';

type Point = { x: number; y: number };
const spacing = 9;

/** Explicit dots measured from each edge's own start, never from the ring perimeter.
 * Clip the index range, not the edge origin, so viewport/tile boundaries cannot
 * shift the pattern or make offscreen edges allocate unbounded numbers of dots.
 */
export function edgeDots(start: Point, end: Point, width: number, height: number, inset = 0, margin = 2): Point[] {
  const dx = end.x - start.x; const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return [];
  let low = 0; let high = 1;
  for (const [origin, delta, maximum] of [[start.x, dx, width], [start.y, dy, height]] as const) {
    if (delta === 0) { if (origin < -margin || origin > maximum + margin) return []; continue; }
    const a = (-margin - origin) / delta; const b = (maximum + margin - origin) / delta;
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b));
  }
  const first = Math.max(Math.ceil(low * length / spacing), Math.ceil(inset / spacing));
  const last = Math.min(Math.floor(high * length / spacing), Math.ceil((length - inset) / spacing) - 1);
  const dots: Point[] = [];
  for (let index = first; index <= last; index++) {
    const t = index * spacing / length;
    dots.push({ x: start.x + dx * t, y: start.y + dy * t });
  }
  return dots;
}

/** Shared border for drawing, vertex editing, overlays and translation.
 * Filled translation previews also stay here until committed map tiles are ready.
 */
export class PreviewBorder {
  private readonly svg: SVGSVGElement;
  private geometries: Geometry[] = [];
  private inset = 0;

  constructor(private readonly map: MapLibreMap, kind: 'draft-border' | 'translation-preview', private appearance: DraftAppearance, private readonly filled = false, private marker: PointAppearance = resolveAppearance().draftMarker) {
    this.svg = map.getCanvas().ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute(`data-geo-${kind}`, '');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;';
  }

  setAppearance(appearance: DraftAppearance, marker: PointAppearance = this.marker): void {
    this.marker = marker;
    const resize = this.appearance.lineWidth !== appearance.lineWidth;
    this.appearance = appearance;
    // Only wider/narrower dots require re-clipping. Color/opacity changes keep paths intact.
    if (resize && this.svg.isConnected) this.render(this.geometries, this.inset);
    else for (const group of this.svg.children) this.styleGroup(group);
  }

  private styleGroup(group: Element): void {
    const marker = group.querySelector('[data-geo-marker]');
    marker?.setAttribute('r', String(this.marker.radius));
    marker?.setAttribute('fill', this.marker.color);
    marker?.setAttribute('fill-opacity', String(this.marker.opacity));
    marker?.setAttribute('stroke', this.marker.strokeColor);
    marker?.setAttribute('stroke-width', String(this.marker.strokeWidth));
    marker?.setAttribute('stroke-opacity', String(this.marker.opacity));
    const border = group.querySelector('[data-geo-border]')!;
    border.setAttribute('stroke', this.appearance.lineColor);
    border.setAttribute('stroke-width', String(this.appearance.lineWidth));
    border.setAttribute('stroke-opacity', String(this.appearance.lineOpacity));
    const fill = group.querySelector('[data-geo-fill]');
    fill?.setAttribute('fill', this.appearance.fillColor);
    fill?.setAttribute('fill-opacity', String(this.appearance.fillOpacity));
  }

  render(geometries: Geometry[], inset = 0): void {
    this.geometries = geometries; this.inset = inset;
    const parts = geometries.flatMap(geometryParts);
    while (this.svg.children.length > parts.length) this.svg.lastElementChild!.remove();
    for (const [index, geometry] of parts.entries()) {
      let group = this.svg.children[index];
      if (!group) {
        group = this.svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
        if (this.filled) {
          const fill = this.path(); fill.setAttribute('data-geo-fill', '');
          fill.setAttribute('fill-rule', 'evenodd'); group.append(fill);
        }
        const marker = this.svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
        marker.setAttribute('data-geo-marker', ''); group.append(marker);
        const border = this.path(); border.setAttribute('data-geo-border', '');
        border.setAttribute('fill', 'none'); border.setAttribute('stroke-linecap', 'round');
        group.append(border); this.svg.append(group);
      }
      this.styleGroup(group);
      const marker = group.querySelector('[data-geo-marker]')!;
      marker.setAttribute('display', geometry.type === 'Point' ? 'inline' : 'none');
      if (geometry.type === 'Point') {
        const point = this.map.project(geometry.coordinates);
        marker.setAttribute('cx', String(point.x)); marker.setAttribute('cy', String(point.y));
        group.querySelector('[data-geo-border]')!.setAttribute('d', '');
        group.querySelector('[data-geo-fill]')?.setAttribute('d', '');
        continue;
      }
      const rings = geometry.type === 'Polygon' ? geometry.coordinates : [geometry.coordinates];
      const projected = rings.map((ring) => ring.map((coordinate: Coordinate) => this.map.project(coordinate)));
      const canvas = this.map.getCanvas(); const dots: Point[] = [];
      for (const ring of projected) {
        for (let i = 1; i < ring.length; i++) dots.push(...edgeDots(ring[i - 1]!, ring[i]!, canvas.clientWidth, canvas.clientHeight, inset, Math.max(2, this.appearance.lineWidth / 2)));
      }
      group.querySelector('[data-geo-border]')!.setAttribute('d', dots.map(({ x, y }) => `M${x},${y}h0`).join(' '));
      group.querySelector('[data-geo-fill]')?.setAttribute('d', geometry.type === 'Polygon'
        ? projected.map((ring) => ring.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + 'Z').join(' ') : '');
    }
    if (parts.length === 0) { this.clear(); return; }
    if (!this.svg.isConnected) {
      this.map.getCanvasContainer().append(this.svg);
      this.map.on('move', this.refresh); this.map.on('resize', this.refresh);
    }
  }

  private path(): SVGPathElement { return this.svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'); }
  private readonly refresh = (): void => { if (this.svg.isConnected) this.render(this.geometries, this.inset); };

  clear(): void {
    this.map.off('move', this.refresh); this.map.off('resize', this.refresh);
    this.geometries = []; this.svg.replaceChildren(); this.svg.remove();
  }
}
