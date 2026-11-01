import type { EditorMap as MapLibreMap } from '../gl/map.js';
import { AlignmentIndex, alignmentPaths, alignmentGuidesOptions, type AlignmentGuidesOptions, type AlignmentPath, type AlignmentResult } from '../core/alignment-guides.js';
import type { Coordinate, FeatureId, GeometryFeatureCollection } from '../core/types.js';
import type { EditorAppearance } from '../core/appearance.js';
import type { ScreenPoint } from '../core/snapping.js';

/** Camera/revision cache and constant-size SVG overlay. The editor owns its lifecycle. */
export class MapLibreAlignmentGuides {
  private options: AlignmentGuidesOptions;
  private revision = -1;
  private collection: GeometryFeatureCollection = { type: 'FeatureCollection', features: [] };
  private index: AlignmentIndex | undefined;
  private key = '';
  private localPaths: AlignmentPath[] = [];
  private localIndex: AlignmentIndex | undefined;
  private result: AlignmentResult | null = null;
  private readonly svg: SVGSVGElement;

  constructor(private readonly map: MapLibreMap, options?: Partial<AlignmentGuidesOptions>) {
    this.options = alignmentGuidesOptions(options);
    this.svg = map.getCanvas().ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.dataset.geoAlignmentGuides = ''; this.svg.setAttribute('aria-hidden', 'true');
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:2;';
  }
  getOptions(): AlignmentGuidesOptions { return { ...this.options }; }
  setOptions(update: Partial<AlignmentGuidesOptions>): boolean {
    const next = alignmentGuidesOptions(update, this.options);
    if (JSON.stringify(next) === JSON.stringify(this.options)) return false;
    this.options = next;
    if (!next.enabled) { this.clear(); this.invalidateCamera(); this.collection = { type: 'FeatureCollection', features: [] }; this.revision = -1; }
    return true;
  }
  getResult(): AlignmentResult | null {
    return this.result ? { ...this.result, coordinate: [...this.result.coordinate], guides: this.result.guides.map(guide => ({ ...guide, start: { ...guide.start }, end: { ...guide.end } })) } : null;
  }
  setLocalPaths(paths: AlignmentPath[]): void { this.localPaths = paths; this.localIndex = undefined; }
  endEdit(): void { this.setLocalPaths([]); this.clear(); }
  invalidateCamera(): void { this.index = undefined; this.localIndex = undefined; this.clear(); }

  resolve(point: ScreenPoint, revision: number, read: () => GeometryFeatureCollection, excluded: ReadonlySet<FeatureId>, appearance: EditorAppearance, recent?: readonly Coordinate[]): AlignmentResult | null {
    if (!this.options.enabled) { this.clear(); return null; }
    if (this.revision !== revision) { this.collection = read(); this.revision = revision; this.index = undefined; }
    const key = JSON.stringify([...excluded]);
    if (this.key !== key) { this.key = key; this.index = undefined; }
    const canvas = this.map.getCanvas(); const width = canvas.clientWidth; const height = canvas.clientHeight;
    const project = (coordinate: Coordinate) => this.map.project(coordinate);
    this.index ??= new AlignmentIndex(alignmentPaths(this.collection, excluded), project, width, height);
    if (this.localPaths.length) this.localIndex ??= new AlignmentIndex(this.localPaths, project, width, height);
    // New drawing supplies at most the last three placed points and the first corner.
    const local = recent?.length ? new AlignmentIndex([
      { featureId: null, coordinates: recent.slice(-3), closed: false },
      ...(recent.length > 3 ? [{ featureId: null, coordinates: [recent[0]!], closed: false }] : []),
    ], project, width, height) : this.localIndex;
    const query = this.index.query(point, this.options, local);
    if (!query.point) { this.clear(); return null; }
    const coordinate = this.map.unproject([query.point.x, query.point.y]).wrap().toArray();
    if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90) { this.clear(); return null; }
    this.result = { coordinate, distance: query.distance, guides: query.guides, examinedCandidates: query.examinedCandidates, limited: query.limited };
    this.render(appearance); return this.result;
  }

  render(appearance: EditorAppearance): void {
    if (!this.result) return;
    this.svg.replaceChildren();
    for (const guide of this.result.guides) {
      const line = this.svg.ownerDocument.createElementNS(this.svg.namespaceURI, 'line');
      line.setAttribute('data-kind', guide.kind);
      for (const [key, value] of Object.entries({ x1: guide.start.x, y1: guide.start.y, x2: guide.end.x, y2: guide.end.y })) line.setAttribute(key, String(value));
      line.setAttribute('stroke', appearance.snap.color); line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-dasharray', '5 4');
      this.svg.append(line);
      const circle = this.svg.ownerDocument.createElementNS(this.svg.namespaceURI, 'circle');
      circle.setAttribute('cx', String(guide.start.x)); circle.setAttribute('cy', String(guide.start.y)); circle.setAttribute('r', '3');
      circle.setAttribute('fill', '#ffffff'); circle.setAttribute('stroke', appearance.snap.color); this.svg.append(circle);
    }
    this.svg.style.opacity = String(appearance.snap.opacity);
    if (!this.svg.isConnected) this.map.getCanvasContainer().append(this.svg);
  }
  clear(): void { this.result = null; this.svg.replaceChildren(); this.svg.remove(); }
  destroy(): void { this.endEdit(); this.index = undefined; this.localIndex = undefined; this.collection = { type: 'FeatureCollection', features: [] }; }
}
