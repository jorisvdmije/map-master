import { geoJSONSource } from '../gl/map.js';
import type { ExpressionSpecification, EditorMap as MapLibreMap } from '../gl/map.js';
import type { GeofencingOptions } from '../core/geofencing.js';

let instances = 0;
/** Read-only native map overlay. It owns no editable features or pick targets. */
export class MapLibreGeofencing {
  private readonly id = `geo-geofencing-${++instances}`;
  constructor(private readonly map: MapLibreMap, private options: GeofencingOptions) {
    map.on('style.load', this.mount); this.mount();
  }
  update(options: GeofencingOptions): void { this.options = options; this.mount(); }
  private readonly mount = (): void => {
    if (!this.map.getStyle()) return;
    if (!this.options.enabled || !this.options.allowed.length && !this.options.excluded.length) { this.remove(); return; }
    const features = (['allowed', 'excluded'] as const).flatMap(group => this.options[group].map(area => ({ type: 'Feature' as const, properties: { group }, geometry: area.geometry })));
    const data = { type: 'FeatureCollection' as const, features };
    const source = geoJSONSource(this.map, this.id);
    if (source) void source.setData(data); else this.map.addSource(this.id, { type: 'geojson', data });
    const color: ExpressionSpecification = ['match', ['get', 'group'], 'allowed', '#15803d', '#b91c1c'];
    if (!this.map.getLayer(`${this.id}-fill`)) this.map.addLayer({ id: `${this.id}-fill`, type: 'fill', source: this.id, paint: { 'fill-color': color, 'fill-opacity': 0.08 } });
    if (!this.map.getLayer(`${this.id}-line`)) this.map.addLayer({ id: `${this.id}-line`, type: 'line', source: this.id, paint: { 'line-color': color, 'line-width': 2, 'line-dasharray': [4, 3] } });
  };
  private remove(): void {
    for (const suffix of ['line', 'fill']) if (this.map.getLayer(`${this.id}-${suffix}`)) this.map.removeLayer(`${this.id}-${suffix}`);
    if (this.map.getSource(this.id)) this.map.removeSource(this.id);
  }
  destroy(removeResources: boolean): void {
    this.map.off('style.load', this.mount);
    if (removeResources) this.remove();
  }
}
