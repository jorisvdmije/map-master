import type { EditorMap as MapLibreMap } from '../gl/map.js';
import type { Coordinate } from '../core/types.js';
import { adoptStylesFor } from './adopt-styles.js';

/** One measurement shown on the map. */
export interface MeasurementLabel {
  coordinate: Coordinate;
  text: string;
  /** A second, smaller line, such as a polygon's perimeter. */
  detail?: string;
  /** Segment labels are smaller than the totals of a shape. */
  kind: 'segment' | 'total';
  direction?: [Coordinate, Coordinate];
  appearance?: 'along-line';
}

const styles = `
.mm-measurements { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
.mm-measurement {
  position: absolute; left: 0; top: 0; box-sizing: border-box; padding: 2px 6px; border-radius: 4px;
  background: var(--mm-measurement-background, rgba(255, 255, 255, .94));
  color: var(--mm-measurement-color, #111827);
  box-shadow: 0 0 0 1px rgba(15, 23, 42, .14), 0 1px 3px rgba(15, 23, 42, .18);
  font: 600 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap;
}
.mm-measurement[data-kind="segment"] { padding: 1px 5px; font-size: 11px; font-weight: 500; }
.mm-measurement span { display: block; font-size: 11px; font-weight: 400; color: var(--mm-measurement-muted, #4b5563); }
.mm-measurement[data-appearance="along-line"] { background: transparent; box-shadow: none; padding: 0 3px; font-weight: 750; font-size: 13px; text-shadow: -2px -2px 0 #fff, 0 -2px 0 #fff, 2px -2px 0 #fff, -2px 0 0 #fff, 2px 0 0 #fff, -2px 2px 0 #fff, 0 2px 0 #fff, 2px 2px 0 #fff; }
`;

/** HTML labels above the map canvas. They need no map glyphs and follow the camera. */
export class MeasurementOverlay {
  private readonly container: HTMLDivElement;
  private labels: MeasurementLabel[] = [];
  private key = '';

  constructor(private readonly map: MapLibreMap) {
    this.container = map.getCanvas().ownerDocument.createElement('div');
    this.container.className = 'mm-measurements';
    this.container.dataset.mmMeasurements = '';
    map.on('move', this.position);
  }

  render(labels: MeasurementLabel[]): void {
    const key = JSON.stringify(labels);
    if (key === this.key) return;
    this.key = key;
    this.labels = labels;
    if (!labels.length) { this.container.replaceChildren(); this.container.remove(); return; }
    if (!this.container.isConnected) {
      this.map.getCanvasContainer().append(this.container);
      adoptStylesFor(this.container, styles);
    }
    const document = this.container.ownerDocument;
    while (this.container.children.length > labels.length) this.container.lastElementChild!.remove();
    labels.forEach((label, index) => {
      let element = this.container.children[index] as HTMLDivElement | undefined;
      if (!element) { element = document.createElement('div'); element.className = 'mm-measurement'; this.container.append(element); }
      element.dataset.kind = label.kind;
      if (label.appearance) element.dataset.appearance = label.appearance; else delete element.dataset.appearance;
      element.textContent = label.text;
      if (label.detail) {
        const detail = document.createElement('span');
        detail.textContent = label.detail;
        element.append(detail);
      }
    });
    this.position();
  }

  clear(): void { this.render([]); }

  destroy(): void {
    this.map.off('move', this.position);
    this.container.remove();
  }

  private readonly position = (): void => {
    this.labels.forEach((label, index) => {
      const element = this.container.children[index] as HTMLElement | undefined;
      if (!element) return;
      const { x, y } = this.map.project(label.coordinate);
      let angle = 0;
      if (label.direction) {
        const a = this.map.project(label.direction[0]), b = this.map.project(label.direction[1]);
        angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
      }
      element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) rotate(${angle}deg)`;
    });
  };
}
