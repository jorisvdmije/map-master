import type { Coordinate } from '../core/types.js';
import type * as GeoJSON from 'geojson';
import type { ScreenPoint } from '../core/snapping.js';

// The editor's map boundary. Native MapLibre and Mapbox maps satisfy this
// structurally; no renderer, worker or renderer declarations enter this module.
export type ExpressionSpecification = [string, ...unknown[]];
type FilterSpecification = ['==', string, string | number | boolean] | ['!=', string, string | number | boolean] | ['all', ...FilterSpecification[]];
export type LayerSpecification = { [Kind in 'fill' | 'line' | 'circle']: {
  id: string;
  type: Kind;
  source: string;
  filter?: FilterSpecification;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
} }['fill' | 'line' | 'circle'];
type LngLatLike = Coordinate | { lng: number; lat: number } | { lon: number; lat: number };
interface LngLat {
  lng: number; lat: number;
  toArray(): Coordinate;
  wrap(): LngLat;
}
export interface MapMouseEvent {
  originalEvent: MouseEvent;
  point: ScreenPoint;
  lngLat: LngLat;
}
export interface FitBoundsOptions {
  center?: LngLatLike;
  zoom?: number; bearing?: number; pitch?: number; roll?: number; elevation?: number;
  padding?: number | Partial<{ top: number; right: number; bottom: number; left: number }>;
  absolutePadding?: boolean;
  offset?: [number, number] | ScreenPoint;
  maxZoom?: number; minZoom?: number; curve?: number; speed?: number; screenSpeed?: number;
  maxDuration?: number; duration?: number;
  easing?: (time: number) => number;
  animate?: boolean; essential?: boolean; freezeElevation?: boolean; linear?: boolean;
}
interface GestureHandler {
  isEnabled(): boolean;
  enable(): unknown;
  disable(): unknown;
}
export interface GeoJSONSource {
  // MapLibre 6 resolves when its worker finishes; Mapbox 3 returns the source.
  setData(data: GeoJSON.GeoJSON): unknown;
}
export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export interface IControl {
  onAdd(map: EditorMap): HTMLElement;
  onRemove(): void;
  getDefaultPosition?(): ControlPosition;
}
export interface EditorMap {
  getCanvas(): HTMLCanvasElement;
  getCanvasContainer(): HTMLElement;
  getStyle(): { sources: Record<string, unknown>; layers: { id: string }[] } | undefined;
  getSource(id: string): unknown;
  getLayer(id: string): unknown;
  addSource(id: string, source: { type: 'geojson'; data: GeoJSON.GeoJSON; promoteId?: string }): unknown;
  removeSource(id: string): unknown;
  addLayer(layer: LayerSpecification): unknown;
  removeLayer(id: string): unknown;
  moveLayer(id: string): unknown;
  setLayoutProperty(id: string, name: string, value: unknown): unknown;
  setPaintProperty(id: string, name: string, value: unknown): unknown;
  setFeatureState(target: { source: string; id: string }, state: Record<string, unknown>): unknown;
  removeFeatureState(target: { source: string; id: string }, key: string): unknown;
  isSourceLoaded(id: string): boolean;
  queryRenderedFeatures(bounds: [number, number] | [[number, number], [number, number]], options: { layers: string[] }): (GeoJSON.Feature & { layer?: { id: string } })[];
  hasImage(id: string): boolean;
  addImage(id: string, image: { width: number; height: number; data: Uint8Array }, options: { pixelRatio: number }): unknown;
  removeImage(id: string): unknown;
  project(coordinate: Coordinate): ScreenPoint;
  unproject(point: [number, number]): LngLat;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  getRoll?(): number;
  getPadding(): Partial<{ top: number; right: number; bottom: number; left: number }>;
  fitBounds(bounds: [Coordinate, Coordinate], options: object): unknown;
  stop(): unknown;
  triggerRepaint(): unknown;
  on(type: 'click' | 'mousemove' | 'mouseout', listener: (event: MapMouseEvent) => void): unknown;
  on(type: 'move' | 'resize' | 'style.load' | 'remove' | 'idle' | 'render', listener: () => void): unknown;
  off(type: 'click' | 'mousemove' | 'mouseout', listener: (event: MapMouseEvent) => void): unknown;
  off(type: 'move' | 'resize' | 'style.load' | 'remove' | 'idle' | 'render', listener: () => void): unknown;
  dragPan: GestureHandler;
  boxZoom: GestureHandler;
  doubleClickZoom: GestureHandler;
  dragRotate: GestureHandler;
  scrollZoom: GestureHandler;
  keyboard: GestureHandler;
  touchPitch: GestureHandler;
  touchZoomRotate: GestureHandler;
}

/** Editor-owned source IDs always refer to GeoJSON, on either renderer. */
export function geoJSONSource(map: EditorMap, id: string): GeoJSONSource | undefined {
  return map.getSource(id) as GeoJSONSource | undefined;
}
