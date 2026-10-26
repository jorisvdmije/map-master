import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { FeatureId, GeometryEditor, GeometryFeature } from '@jorisvdmije/map-master';

/** Demo UI built entirely on the public editor API; no UI is imposed on hosts. */
export class SelectionControls {
  private readonly summary: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly choices: HTMLDetailsElement;
  private readonly choiceSummary: HTMLElement;
  private readonly list: HTMLElement;
  private readonly view: Window;
  private readonly rows = new Map<FeatureId, { select: HTMLButtonElement; add: HTMLInputElement; label: HTMLElement }>();
  private revision: number;
  private idleBeforeClick = false;

  constructor(private readonly editor: GeometryEditor, private readonly map: MapLibreMap,
    private readonly root: HTMLElement, private readonly sources: Record<string, HTMLButtonElement>,
    private readonly more: () => void) {
    this.summary = root.querySelector('[data-selection-summary]')!;
    this.toolbar = root.querySelector('[role="toolbar"]')!;
    this.choices = root.querySelector('details')!;
    this.choiceSummary = this.choices.querySelector('summary')!;
    this.list = root.querySelector('[data-overlap-list]')!;
    this.view = root.ownerDocument.defaultView!;
    this.revision = editor.getState().dataRevision;
    this.root.addEventListener('click', this.action);
    this.root.addEventListener('keydown', this.key);
    map.getCanvas().addEventListener('pointerdown', this.beforeClick, true);
    map.getCanvas().addEventListener('keydown', this.shiftDown);
    this.view.addEventListener('keyup', this.shiftUp);
    this.view.addEventListener('blur', this.restoreToolbar);
    map.on('click', this.pick);
    map.on('movestart', this.clearChoices);
    map.on('resize', this.clearChoices);
    map.on('style.load', this.clearChoices);
  }

  update(): void {
    const state = this.editor.getState();
    const ids = state.selectedFeatureIds;
    const focused = this.root.contains(document.activeElement);
    this.root.hidden = state.mode !== 'idle' || ids.length === 0;
    if (this.root.hidden || state.dataRevision !== this.revision) this.clearChoices();
    this.revision = state.dataRevision;
    const locked = ids.filter(id => this.editor.isFeatureLocked(id)).length;
    this.summary.textContent = `${ids.length} selected${locked ? ` · ${locked} locked` : ''}`;
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      const source = this.sources[button.dataset.action!];
      button.disabled = source ? source.disabled : false;
    }
    for (const [id, row] of this.rows) {
      const selected = ids.includes(id);
      row.select.setAttribute('aria-pressed', String(selected));
      row.add.checked = selected;
      row.label.textContent = this.editor.isFeatureLocked(id) ? 'Locked' : '';
    }
    this.refreshTabStop();
    // An action can remove/hide the focused control synchronously.
    if (this.root.hidden && focused) this.map.getCanvas().focus({ preventScroll: true });
  }

  destroy(): void {
    this.root.removeEventListener('click', this.action);
    this.root.removeEventListener('keydown', this.key);
    this.map.getCanvas().removeEventListener('pointerdown', this.beforeClick, true);
    this.map.getCanvas().removeEventListener('keydown', this.shiftDown);
    this.view.removeEventListener('keyup', this.shiftUp);
    this.view.removeEventListener('blur', this.restoreToolbar);
    this.map.off('click', this.pick);
    this.map.off('movestart', this.clearChoices);
    this.map.off('resize', this.clearChoices);
    this.map.off('style.load', this.clearChoices);
    this.clearChoices();
    this.restoreToolbar();
    this.root.hidden = true;
  }

  private readonly beforeClick = (event: PointerEvent): void => {
    this.idleBeforeClick = this.editor.getState().mode === 'idle';
    this.root.classList.toggle('selection-gesture', event.shiftKey);
  };

  // Leave the entire canvas available for additive map selection, including the
  // area behind the toolbar. Shift+Tab inside the toolbar keeps normal focus.
  private readonly shiftDown = (event: KeyboardEvent): void => {
    if (event.key === 'Shift' && !event.ctrlKey && !event.metaKey && !event.altKey) this.root.classList.add('selection-gesture');
  };
  private readonly shiftUp = (event: KeyboardEvent): void => {
    if (!event.shiftKey) this.restoreToolbar();
  };
  private readonly restoreToolbar = (): void => { this.root.classList.remove('selection-gesture'); };

  private readonly pick = (event: MapMouseEvent): void => {
    const input = event.originalEvent;
    if (!this.idleBeforeClick || this.editor.getState().mode !== 'idle' || input.button !== 0
      || input.ctrlKey || input.metaKey || input.shiftKey || input.altKey || input.detail > 1) return;
    this.clearChoices();
    const features = this.editor.queryFeatures(event.point);
    if (features.length < 2 || this.editor.getState().selectedFeatureIds.length === 0) return;
    this.choiceSummary.textContent = `${features.length} shapes here`;
    for (const feature of features) this.addChoice(feature);
    this.choices.hidden = false;
    this.update();
  };

  private addChoice(feature: GeometryFeature): void {
    const id = feature.id;
    const name = typeof feature.properties?.name === 'string' && feature.properties.name.trim()
      ? feature.properties.name : feature.geometry.type;
    const row = document.createElement('div'); row.className = 'overlap-row';
    const select = document.createElement('button'); select.type = 'button';
    select.className = 'overlap-pick';
    const identity = `${name} · ${JSON.stringify(id)}`;
    select.setAttribute('aria-label', `Select ${identity}`);
    const title = document.createElement('strong'); title.textContent = name;
    const detail = document.createElement('span'); detail.textContent = `${feature.geometry.type} · ${JSON.stringify(id)}`;
    select.append(title, detail);
    const label = document.createElement('small'); label.className = 'overlap-lock';
    const add = document.createElement('input'); add.type = 'checkbox';
    add.setAttribute('aria-label', `Include ${identity} in selection`);
    select.addEventListener('click', () => { this.editor.select(id); });
    add.addEventListener('change', () => { this.editor.toggleSelection(id); });
    row.append(select, label, add); this.list.append(row);
    this.rows.set(id, { select, add, label });
  }

  private readonly clearChoices = (): void => {
    const focused = this.choices.contains(document.activeElement);
    this.choices.open = false; this.choices.hidden = true;
    this.rows.clear(); this.list.replaceChildren();
    if (focused) this.map.getCanvas().focus({ preventScroll: true });
  };

  private readonly action = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button || button.disabled) return;
    if (button.dataset.action === 'more') { this.more(); return; }
    const source = this.sources[button.dataset.action!];
    if (!source || source.disabled) return;
    source.click();
    // Source actions may focus a specific input; preserve that useful destination.
    if (document.activeElement === button || document.activeElement === document.body) this.map.getCanvas().focus({ preventScroll: true });
  };

  private refreshTabStop(): HTMLButtonElement[] {
    const buttons = [...this.toolbar.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.disabled);
    const active = buttons.find(button => button === document.activeElement) ?? buttons[0];
    for (const button of this.toolbar.querySelectorAll<HTMLButtonElement>('button')) button.tabIndex = button === active ? 0 : -1;
    return buttons;
  }

  private readonly key = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (this.choices.open) { this.choices.open = false; this.choiceSummary.focus(); }
      else { this.editor.select(null); this.map.getCanvas().focus({ preventScroll: true }); }
      return;
    }
    if (!this.toolbar.contains(event.target as Node)) return;
    const buttons = this.refreshTabStop();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % buttons.length
      : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1;
    if (next < 0) return;
    event.preventDefault(); buttons[next]!.focus(); this.refreshTabStop();
  };
}
