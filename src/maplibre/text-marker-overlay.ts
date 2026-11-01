import type { EditorMap as MapLibreMap } from '../gl/map.js';
import { defaultTextMarkerStyle, isTextMarker, type TextMarkerOptions } from '../core/text-marker.js';
import type { Coordinate, FeatureId, GeometryFeature } from '../core/types.js';
import { adoptStylesFor } from './adopt-styles.js';

type Label = { id: FeatureId; coordinate: Coordinate; options: TextMarkerOptions; preview?: boolean };
const styles = `
.mm-text-markers { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
.mm-text-marker { position: absolute; left: 0; top: 0; box-sizing: border-box; padding: 4px 7px;
  border-radius: 4px; font-family: system-ui, sans-serif; line-height: 1.3; white-space: pre-wrap;
  overflow-wrap: anywhere; max-width: min(320px, 80%); max-height: 240px; overflow: hidden;
  box-shadow: 0 1px 4px #0003; unicode-bidi: plaintext; }
.mm-text-marker[data-selected="true"] { outline: 2px solid #2563eb; }
.mm-text-marker[data-preview="true"] { outline: 2px dashed #df772e; }
`;

/** Safe, glyph-independent labels. Pointer events reach the map; picking uses visible label bounds. */
export class TextMarkerOverlay {
  private readonly container: HTMLDivElement;
  private committed: Label[] = [];
  private preview: Label[] = [];
  private selected = new Set<FeatureId>();
  private hidden = new Set<FeatureId>();
  private labels: Label[] = [];
  private readonly elements = new Map<string, HTMLDivElement>();

  constructor(private readonly map: MapLibreMap) {
    this.container = map.getCanvas().ownerDocument.createElement('div');
    this.container.className = 'mm-text-markers';
    map.on('move', this.position);
    map.on('resize', this.position);
  }

  setCommitted(features: GeometryFeature[]): void {
    this.committed = features.filter(isTextMarker).map(feature => ({ id: feature.id,
      coordinate: feature.geometry.coordinates, options: feature.properties.mapMasterText }));
    this.render();
  }
  setSelection(ids: Set<FeatureId>): void { this.selected = ids; this.render(); }
  setHidden(ids: Set<FeatureId>): void { this.hidden = ids; this.render(); }
  setPreview(features: GeometryFeature[]): void {
    this.setDraft(features.filter(isTextMarker).map(feature => ({ id: feature.id,
      coordinate: feature.geometry.coordinates, options: feature.properties.mapMasterText, preview: true })));
  }
  setDraft(labels: Label[]): void { this.preview = labels; this.render(); }

  private render(): void {
    this.labels = [...this.committed.filter(label => !this.hidden.has(label.id)), ...this.preview];
    if (!this.labels.length) { this.container.remove(); this.container.replaceChildren(); this.elements.clear(); return; }
    if (!this.container.isConnected) {
      this.map.getCanvasContainer().append(this.container);
      adoptStylesFor(this.container, styles);
    }
    const keys = new Set<string>();
    for (const label of this.labels) {
      const key = `${label.preview ? 'preview' : 'feature'}:${JSON.stringify(label.id)}`;
      keys.add(key);
      let element = this.elements.get(key);
      if (!element) {
        element = this.container.ownerDocument.createElement('div');
        element.className = 'mm-text-marker'; element.dir = 'auto'; this.elements.set(key, element);
      }
      element.dataset.featureId = JSON.stringify(label.id);
      element.dataset.selected = String(this.selected.has(label.id));
      element.dataset.preview = String(label.preview === true);
      // Never parse label content as HTML, markup or CSS.
      element.textContent = label.options.text || '…';
      element.title = label.options.text;
      const style = { ...defaultTextMarkerStyle, ...label.options.style };
      element.style.color = style.color; element.style.backgroundColor = style.backgroundColor;
      element.style.fontSize = `${style.fontSize}px`; element.style.fontWeight = style.fontWeight;
      element.style.textAlign = style.textAlign;
      this.container.append(element);
    }
    for (const [key, element] of this.elements) if (!keys.has(key)) { element.remove(); this.elements.delete(key); }
    this.position();
  }

  /** Topmost visible labels first. Coordinates are map CSS pixels, like queryRenderedFeatures. */
  pick(a: { x: number; y: number }, b = a): FeatureId[] {
    const canvas = this.map.getCanvas(); const bounds = canvas.getBoundingClientRect();
    const scaleX = bounds.width / canvas.clientWidth; const scaleY = bounds.height / canvas.clientHeight;
    const left = bounds.left + Math.min(a.x, b.x) * scaleX; const right = bounds.left + Math.max(a.x, b.x) * scaleX;
    const top = bounds.top + Math.min(a.y, b.y) * scaleY; const bottom = bounds.top + Math.max(a.y, b.y) * scaleY;
    const ids: FeatureId[] = [];
    for (const label of [...this.labels].reverse()) {
      if (label.preview) continue;
      const element = this.elements.get(`feature:${JSON.stringify(label.id)}`)!;
      const rect = element.getBoundingClientRect();
      if (rect.right >= Math.max(left, bounds.left) && rect.left <= Math.min(right, bounds.right)
        && rect.bottom >= Math.max(top, bounds.top) && rect.top <= Math.min(bottom, bounds.bottom)) ids.push(label.id);
    }
    return ids;
  }

  private readonly position = (): void => {
    for (const label of this.labels) {
      const element = this.elements.get(`${label.preview ? 'preview' : 'feature'}:${JSON.stringify(label.id)}`)!;
      const { x, y } = this.map.project(label.coordinate);
      element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  };

  destroy(): void {
    this.map.off('move', this.position); this.map.off('resize', this.position);
    this.container.remove(); this.elements.clear(); this.labels = []; this.committed = []; this.preview = [];
  }
}
