import type { ControlPosition, IControl, EditorMap } from '../gl/map.js';
import type { DataLayer } from '../core/data-layers.js';
import type { GeometryEditor } from './geometry-editor.js';
import { adoptStylesFor } from './adopt-styles.js';
import { controlHeight } from './control-layout.js';

const defaultLabels = {
  title: 'Data layers', active: 'Draw in', none: 'No drawing layer', scope: 'Select from', all: 'All visible layers', activeOnly: 'Active layer',
  visible: 'Visible', editable: 'Editable', locked: 'Locked', selectable: 'Selectable', snapping: 'Snapping', color: 'Color',
  forward: 'Bring forward', backward: 'Send backward', move: 'Move selection', moveTarget: 'Destination layer',
};
export type DataLayerControlLabels = typeof defaultLabels;
export interface DataLayerControlOptions { collapsed?: boolean; labels?: Partial<DataLayerControlLabels> }
const styles = `
.mm-data-layers{font:12px/1.4 system-ui;background:#fff;border-radius:5px;box-shadow:0 1px 5px #0004;color:#1e293b;box-sizing:border-box;max-width:calc(100vw - 60px)}
.mm-data-layers button,.mm-data-layers select,.mm-data-layers input{font:inherit;color:inherit}
.mm-data-layers>button{display:block;width:100%;height:auto;padding:8px 12px;border:0;background:white;cursor:pointer;border-radius:5px}
.mm-data-layers [hidden]{display:none!important}
.mm-data-layers-panel{width:286px;max-width:100%;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:10px;box-sizing:border-box}
.mm-data-layers-panel>label{display:grid;grid-template-columns:75px 1fr;align-items:center;gap:6px;margin-bottom:8px}
.mm-data-layers-panel select{min-width:0;width:100%;padding:4px;border:1px solid #cbd5e1;border-radius:4px}
.mm-data-layer-row{padding:9px 0;border-top:1px solid #e2e8f0}
.mm-data-layer-row>strong{display:block;margin-bottom:5px;overflow-wrap:anywhere}
.mm-data-layer-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
.mm-data-layer-fields label{display:flex;align-items:center;flex-wrap:wrap;gap:4px;overflow-wrap:anywhere}
.mm-data-layer-fields input[type=color]{width:28px;height:22px;padding:0;border:0;background:none}
.mm-data-layer-order{display:flex;gap:5px;margin-top:6px}
.mm-data-layers-panel button{padding:4px 7px;border:1px solid #cbd5e1;border-radius:4px;background:#f8fafc;cursor:pointer;width:auto;height:auto}
.mm-data-layers-panel button:disabled{opacity:.45;cursor:default}
.mm-data-layers :focus-visible{outline:2px solid #2563eb;outline-offset:2px}
`;

/** Optional accessible host control; layer configuration itself is not feature history. */
export class DataLayerControl implements IControl {
  private readonly root: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly labels: DataLayerControlLabels;
  private collapsed: boolean;
  private key = '';
  private moveTarget: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private map: EditorMap | null = null;
  private observer: ResizeObserver | null = null;

  constructor(private readonly editor: GeometryEditor, options: DataLayerControlOptions = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'collapsed' && key !== 'labels')
      || options.collapsed !== undefined && typeof options.collapsed !== 'boolean') throw new TypeError('Invalid data layer control options.');
    if (options.labels !== undefined && (!options.labels || typeof options.labels !== 'object' || Array.isArray(options.labels)
      || Object.entries(options.labels).some(([key, value]) => !Object.hasOwn(defaultLabels, key) || typeof value !== 'string' || !value))) throw new TypeError('Invalid data layer labels.');
    this.labels = { ...defaultLabels, ...options.labels }; this.collapsed = options.collapsed ?? true;
    this.root = document.createElement('div'); this.root.className = 'maplibregl-ctrl mapboxgl-ctrl mm-data-layers';
    this.toggle = document.createElement('button'); this.toggle.type = 'button'; this.toggle.textContent = this.labels.title;
    this.toggle.addEventListener('click', () => { this.setCollapsed(!this.collapsed); });
    this.panel = document.createElement('div'); this.panel.className = 'mm-data-layers-panel'; this.panel.setAttribute('role', 'group'); this.panel.setAttribute('aria-label', this.labels.title);
    this.root.append(this.toggle, this.panel); this.setCollapsed(this.collapsed);
  }
  getDefaultPosition(): ControlPosition { return 'top-right'; }
  onAdd(map: EditorMap): HTMLElement {
    this.map = map;
    map.on('resize', this.layout);
    this.observer = new ResizeObserver(this.layout);
    this.observer.observe(map.getCanvas());
    this.observer.observe(this.root);
    this.unsubscribe = this.editor.onChange(() => { this.render(); }); this.render();
    queueMicrotask(() => { if (this.map === map && this.root.isConnected) { adoptStylesFor(this.root, styles); this.layout(); } });
    return this.root;
  }
  onRemove(): void {
    this.unsubscribe?.(); this.unsubscribe = null;
    this.map?.off('resize', this.layout); this.map = null;
    this.observer?.disconnect(); this.observer = null;
    this.root.remove();
  }
  isCollapsed(): boolean { return this.collapsed; }
  setCollapsed(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('collapsed must be boolean.');
    this.collapsed = value; this.panel.hidden = value; this.toggle.setAttribute('aria-expanded', String(!value));
    this.layout();
  }

  private readonly layout = (): void => {
    if (!this.map || !this.root.isConnected) return;
    const canvas = this.map.getCanvas();
    this.root.style.maxWidth = `${Math.max(0, canvas.clientWidth - 20)}px`;
    this.panel.style.maxHeight = `${Math.max(0, controlHeight(this.root, canvas) - this.toggle.offsetHeight)}px`;
  };

  private select(label: string, key: string, choices: readonly { value: string; label: string; disabled?: boolean }[], value: string, disabled: boolean, update: (value: string) => void): HTMLSelectElement {
    const field = document.createElement('label'); field.append(document.createTextNode(label));
    const input = document.createElement('select'); input.dataset.controlKey = key;
    for (const choice of choices) { const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; option.disabled = choice.disabled ?? false; input.append(option); }
    input.value = value; input.disabled = disabled; input.addEventListener('change', () => { update(input.value); });
    field.append(input); this.panel.append(field); return input;
  }
  private button(label: string, key: string, disabled: boolean, run: () => void): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.controlKey = key; button.disabled = disabled;
    button.addEventListener('click', run); return button;
  }
  private render(): void {
    const state = this.editor.getState(); const key = JSON.stringify([state.dataLayerRevision, state.mode, state.selectedFeatureIds, state.selectedFeatureIds.map(id => this.editor.isFeatureLocked(id))]);
    if (key === this.key) return; this.key = key;
    const focused = this.root.getRootNode() as Document | ShadowRoot;
    const focusKey = this.root.contains(focused.activeElement) ? (focused.activeElement as HTMLElement | null)?.dataset.controlKey : undefined;
    this.panel.replaceChildren();
    const layers = this.editor.getDataLayers();
    const writable = (layer: DataLayer) => layer.visible && layer.editable && !layer.locked;
    const choices = layers.map(layer => ({ value: layer.id, label: layer.name, disabled: !writable(layer) }));
    this.select(this.labels.active, 'active', [{ value: '', label: this.labels.none }, ...choices], state.activeDataLayerId ?? '', state.mode !== 'idle', value => { this.editor.setActiveDataLayer(value || null); });
    this.select(this.labels.scope, 'scope', [{ value: 'all', label: this.labels.all }, { value: 'active', label: this.labels.activeOnly }], state.dataLayerSelectionScope, false, value => { this.editor.setDataLayerSelectionScope(value as 'all' | 'active'); });
    if (!layers.some(layer => layer.id === this.moveTarget && writable(layer))) this.moveTarget = state.activeDataLayerId;
    this.select(this.labels.moveTarget, 'destination', choices, this.moveTarget ?? '', state.mode !== 'idle', value => { this.moveTarget = value; this.key = ''; this.render(); });
    this.panel.append(this.button(this.labels.move, 'move', state.mode !== 'idle' || !this.moveTarget || !state.selectedFeatureIds.length || state.selectedFeatureIds.some(id => this.editor.isFeatureLocked(id)), () => { if (this.moveTarget) this.editor.moveFeaturesToDataLayer(state.selectedFeatureIds, this.moveTarget); }));
    for (const layer of [...layers].reverse()) {
      const row = document.createElement('div'); row.className = 'mm-data-layer-row'; row.dataset.dataLayerId = layer.id;
      const name = document.createElement('strong'); name.textContent = layer.name; row.append(name);
      const fields = document.createElement('div'); fields.className = 'mm-data-layer-fields'; row.append(fields);
      for (const property of ['visible', 'editable', 'locked', 'selectable', 'snapping'] as const) {
        const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = layer[property];
        input.dataset.controlKey = `${layer.id}:${property}`; input.setAttribute('aria-label', `${this.labels[property]} ${layer.name}`);
        input.addEventListener('change', () => { this.editor.updateDataLayer(layer.id, { [property]: input.checked }); });
        label.append(input, document.createTextNode(this.labels[property])); fields.append(label);
      }
      const colorLabel = document.createElement('label'); const color = document.createElement('input'); color.type = 'color';
      const hex = layer.style.shape?.fillColor ?? layer.style.marker?.color ?? this.editor.getAppearance().feature.fillColor;
      color.value = hex.length === 4 ? '#' + hex.slice(1).split('').map(value => value + value).join('') : hex;
      color.setAttribute('aria-label', `${this.labels.color} ${layer.name}`); color.dataset.controlKey = `${layer.id}:color`;
      color.addEventListener('change', () => { this.editor.updateDataLayer(layer.id, { style: { ...layer.style, shape: { ...layer.style.shape, fillColor: color.value, lineColor: color.value }, marker: { ...layer.style.marker, color: color.value } } }); });
      colorLabel.append(color, document.createTextNode(this.labels.color)); fields.append(colorLabel);
      const index = layers.findIndex(value => value.id === layer.id); const order = document.createElement('div'); order.className = 'mm-data-layer-order';
      const move = (delta: number) => { const ids = layers.map(layer => layer.id); [ids[index], ids[index + delta]] = [ids[index + delta]!, ids[index]!]; this.editor.reorderDataLayers(ids); };
      order.append(this.button(this.labels.forward, `${layer.id}:forward`, index === layers.length - 1, () => { move(1); }), this.button(this.labels.backward, `${layer.id}:backward`, index === 0, () => { move(-1); }));
      row.append(order); this.panel.append(row);
    }
    if (focusKey) [...this.panel.querySelectorAll<HTMLElement>('[data-control-key]')].find(element => element.dataset.controlKey === focusKey)?.focus({ preventScroll: true });
  }
}
