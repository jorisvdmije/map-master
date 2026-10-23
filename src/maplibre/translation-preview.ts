import type { Map as MapLibreMap } from 'maplibre-gl';
import { geometryParts } from '../core/geometry.js';
import type { Coordinate, GeometryFeature } from '../core/types.js';

/** Screen-space paths keep one continuous dash phase across tile boundaries.
 * Reuse paths throughout a drag so geometry updates never restart the animation.
 */
export class TranslationPreview {
  private readonly svg: SVGSVGElement;
  private readonly paths: SVGPathElement[] = [];
  private readonly animations = new Map<SVGPathElement, Animation>();
  private features: GeometryFeature[] = [];

  constructor(private readonly map: MapLibreMap) {
    this.svg = map.getCanvas().ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.dataset.geoTranslationPreview = '';
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;';
  }

  render(features: GeometryFeature[]): void {
    this.features = features;
    const geometries = features.flatMap((feature) => geometryParts(feature.geometry));
    while (this.paths.length > geometries.length) {
      const path = this.paths.pop()!; path.remove();
      this.animations.get(path)?.cancel(); this.animations.delete(path);
    }
    for (const [index, geometry] of geometries.entries()) {
      let path = this.paths[index];
      if (!path) {
        path = this.svg.ownerDocument.createElementNS(this.svg.namespaceURI, 'path') as SVGPathElement;
        path.setAttribute('stroke', '#df772e'); path.setAttribute('stroke-width', '3');
        path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('stroke-dasharray', '1 8'); path.setAttribute('fill-rule', 'evenodd');
        this.svg.append(path); this.paths.push(path);
        if (!this.svg.ownerDocument.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          this.animations.set(path, path.animate([{ strokeDashoffset: '0' }, { strokeDashoffset: '-9' }], { duration: 600, iterations: Infinity }));
        }
      }
      path.setAttribute('fill', geometry.type === 'Polygon' ? '#df772e' : 'none');
      path.setAttribute('fill-opacity', '0.22');
      const line = (coordinates: Coordinate[]): string => coordinates.map((coordinate, i) => {
        const { x, y } = this.map.project(coordinate);
        return `${i === 0 ? 'M' : 'L'}${x},${y}`;
      }).join(' ');
      path.setAttribute('d', geometry.type === 'Polygon'
        ? geometry.coordinates.map((ring) => `${line(ring)}Z`).join(' ') : line(geometry.coordinates));
    }
    if (!this.svg.isConnected) {
      this.map.getCanvasContainer().append(this.svg);
      this.map.on('move', this.refresh); this.map.on('resize', this.refresh);
    }
  }

  private readonly refresh = (): void => { if (this.svg.isConnected) this.render(this.features); };

  clear(): void {
    this.map.off('move', this.refresh); this.map.off('resize', this.refresh);
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear(); this.paths.length = 0; this.features = [];
    this.svg.replaceChildren(); this.svg.remove();
  }
}
