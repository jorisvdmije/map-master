import type { ControlPosition, IControl, Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate, EditorMode, EditorState, GeometryFeature } from '../core/types.js';
import type { GeometryEditor } from './geometry-editor.js';
import { toolbarIcon } from './toolbar-icons.js';
import { toolbarStyles } from './toolbar-styles.js';

/** A button that {@link EditorToolbar} can show. */
export type ToolbarTool =
  | 'point' | 'line' | 'polygon' | 'hole'
  | 'edit' | 'split' | 'reshape' | 'shared-boundary'
  | 'union' | 'difference' | 'intersection'
  | 'rotate' | 'scale' | 'buffer' | 'offset' | 'simplify'
  | 'duplicate' | 'delete'
  | 'snapping' | 'constraints' | 'tracing'
  | 'undo' | 'redo';

/** Texts the toolbar shows: one per tool, plus the action panel and its fields. */
export type ToolbarLabelKey = ToolbarTool
  | 'toolbar' | 'finish' | 'save' | 'apply' | 'cancel' | 'removeLastPoint'
  | 'distance' | 'tolerance' | 'angle' | 'factor';

/** Every toolbar text, keyed by tool or action. */
export type ToolbarLabels = Record<ToolbarLabelKey, string>;

/** Options for {@link EditorToolbar}. */
export interface ToolbarOptions {
  /**
   * Buttons to show, in order. Neighbouring tools of the same kind (drawing, editing,
   * drawing aids, history) share a group. Defaults to {@link EditorToolbar.defaultTools}.
   */
  tools?: readonly ToolbarTool[];
  /** Replace button tooltips and action texts, for example to translate the toolbar. */
  labels?: Partial<ToolbarLabels>;
}

type Group = 'draw' | 'edit' | 'aids' | 'history';
interface Field {
  label: 'distance' | 'tolerance' | 'angle' | 'factor';
  unit: string;
  step: string;
  min?: string;
  read(state: EditorState): number | null;
  write(editor: GeometryEditor, value: number): void;
}

const allTools: readonly ToolbarTool[] = Object.freeze<ToolbarTool[]>([
  'point', 'line', 'polygon', 'hole',
  'edit', 'split', 'reshape', 'shared-boundary', 'union', 'difference', 'intersection',
  'rotate', 'scale', 'buffer', 'offset', 'simplify', 'duplicate', 'delete',
  'snapping', 'constraints', 'tracing',
  'undo', 'redo',
]);
const defaultTools: readonly ToolbarTool[] = Object.freeze<ToolbarTool[]>([
  'point', 'line', 'polygon', 'edit', 'split', 'union', 'difference', 'rotate', 'scale', 'delete', 'undo', 'redo',
]);

const defaultLabels: ToolbarLabels = {
  point: 'Draw marker', line: 'Draw line', polygon: 'Draw polygon', hole: 'Draw hole',
  edit: 'Edit vertices', split: 'Split polygon', reshape: 'Reshape boundary', 'shared-boundary': 'Edit shared boundary',
  union: 'Merge polygons', difference: 'Subtract polygons', intersection: 'Intersect polygons',
  rotate: 'Rotate', scale: 'Scale', buffer: 'Buffer', offset: 'Offset lines', simplify: 'Simplify',
  duplicate: 'Duplicate', delete: 'Delete',
  snapping: 'Snapping', constraints: '45° angles', tracing: 'Trace boundaries',
  undo: 'Undo', redo: 'Redo',
  toolbar: 'Geometry tools', finish: 'Finish', save: 'Save', apply: 'Apply', cancel: 'Cancel',
  removeLastPoint: 'Remove last point', distance: 'Distance', tolerance: 'Tolerance', angle: 'Angle', factor: 'Factor',
};

const groups: Record<ToolbarTool, Group> = {
  point: 'draw', line: 'draw', polygon: 'draw', hole: 'draw',
  edit: 'edit', split: 'edit', reshape: 'edit', 'shared-boundary': 'edit', union: 'edit', difference: 'edit',
  intersection: 'edit', rotate: 'edit', scale: 'edit', buffer: 'edit', offset: 'edit', simplify: 'edit',
  duplicate: 'edit', delete: 'edit',
  snapping: 'aids', constraints: 'aids', tracing: 'aids',
  undo: 'history', redo: 'history',
};

const modeTools: Partial<Record<EditorMode, ToolbarTool>> = {
  'draw-point': 'point', 'draw-line': 'line', 'draw-polygon': 'polygon', 'draw-hole': 'hole',
  'edit-point': 'edit', 'edit-line': 'edit', 'edit-polygon': 'edit',
  'split-polygon': 'split', 'reshape-polygon': 'reshape', 'edit-shared-boundary': 'shared-boundary',
  'union-polygons': 'union', 'difference-polygons': 'difference', 'intersection-polygons': 'intersection',
  'rotate-features': 'rotate', 'scale-features': 'scale', 'buffer-features': 'buffer',
  'offset-lines': 'offset', 'simplify-features': 'simplify',
};

const fields: Partial<Record<EditorMode, Field>> = {
  'buffer-features': { label: 'distance', unit: 'm', step: '1', min: '0', read: (s) => s.bufferDistance, write: (e, v) => { e.setBufferDistance(v); } },
  'offset-lines': { label: 'distance', unit: 'm', step: '1', read: (s) => s.offsetDistance, write: (e, v) => { e.setOffsetDistance(v); } },
  'simplify-features': { label: 'tolerance', unit: 'm', step: '0.5', min: '0', read: (s) => s.simplificationTolerance, write: (e, v) => { e.setSimplificationTolerance(v); } },
  'rotate-features': { label: 'angle', unit: '°', step: '1', read: (s) => s.rotationAngle, write: (e, v) => { e.setRotationAngle(v); } },
  'scale-features': { label: 'factor', unit: '×', step: '0.1', min: '0', read: (s) => s.scaleFactor, write: (e, v) => { e.setScaleFactor(v); } },
};

// Modes whose last placed point can be removed from the action panel.
const removable: ReadonlySet<EditorMode> = new Set<EditorMode>(['draw-line', 'draw-polygon', 'draw-hole', 'split-polygon', 'reshape-polygon']);
// One-shot commands rather than modes or settings: they have no pressed state.
const commands: ReadonlySet<ToolbarTool> = new Set<ToolbarTool>(['duplicate', 'delete', 'undo', 'redo']);
// Leaving these modes for another tool discards no user input.
const previewOnly: ReadonlySet<EditorMode> = new Set<EditorMode>(['union-polygons', 'difference-polygons', 'intersection-polygons']);

const isPoint = (f: GeometryFeature): boolean => f.geometry.type === 'Point';
const isPolygonal = (f: GeometryFeature): boolean => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon';
const isSimplePolygon = (f: GeometryFeature): boolean => f.geometry.type === 'Polygon' && f.geometry.coordinates.length === 1;
const isLineal = (f: GeometryFeature): boolean => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString';
const format = (value: number | null): string => value === null ? '' : String(Math.round(value * 100) / 100);

function validTools(value: unknown): readonly ToolbarTool[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('Toolbar tools must be a non-empty array.');
  const tools = value as unknown[];
  for (const [index, tool] of tools.entries()) {
    if (typeof tool !== 'string' || !allTools.includes(tool as ToolbarTool)) throw new TypeError(`Unknown toolbar tool: ${String(tool)}`);
    if (tools.indexOf(tool) !== index) throw new TypeError(`Repeated toolbar tool: ${tool}`);
  }
  return tools as ToolbarTool[];
}

const styledRoots = new WeakSet<Node>();
function injectStyles(root: Document | ShadowRoot): void {
  if (styledRoots.has(root)) return;
  styledRoots.add(root);
  const view = (root instanceof Document ? root : root.ownerDocument).defaultView;
  // Constructed style sheets also work under a Content Security Policy without 'unsafe-inline'.
  if (view && 'replaceSync' in view.CSSStyleSheet.prototype) {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(toolbarStyles);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  }
  const style = (root instanceof Document ? root : root.ownerDocument).createElement('style');
  style.textContent = toolbarStyles;
  (root instanceof Document ? root.head : root).append(style);
}

/**
 * A ready-made MapLibre control with buttons for drawing, editing, geometry tools,
 * drawing aids and Undo/Redo. It only calls public {@link GeometryEditor} methods, so it
 * can be combined with your own controls.
 *
 * While one of its tools is active, a panel next to the tool's button offers Finish/Apply,
 * Remove last point, Cancel and the tool's distance, angle or factor. Buttons are disabled when the
 * current selection does not qualify. The toolbar injects its own styles; theme it with
 * the `--mm-toolbar-*` CSS custom properties.
 *
 * @example
 * ```ts
 * const editor = new GeometryEditor(map);
 * map.addControl(new EditorToolbar(editor), 'top-left');
 *
 * // Choose and order the buttons:
 * map.addControl(new EditorToolbar(editor, { tools: ['polygon', 'edit', 'buffer', 'undo', 'redo'] }));
 * ```
 */
export class EditorToolbar implements IControl {
  /** Every available tool, in the standard order. */
  static readonly allTools: readonly ToolbarTool[] = allTools;
  /** The tools shown when no `tools` option is given. */
  static readonly defaultTools: readonly ToolbarTool[] = defaultTools;

  private readonly labels: ToolbarLabels;
  private readonly root: HTMLElement;
  private readonly buttons = new Map<ToolbarTool, HTMLButtonElement>();
  private readonly actions: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly removeLast: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly field: HTMLLabelElement;
  private readonly fieldName: HTMLElement;
  private readonly fieldUnit: HTMLElement;
  private readonly input: HTMLInputElement;
  private map: MapLibreMap | null = null;
  private unsubscribe: (() => void) | null = null;
  private selection: { key: string; features: GeometryFeature[] } = { key: '', features: [] };
  private fieldMode: EditorMode | null = null;
  private fieldInvalid = false;
  private focusTool: ToolbarTool | null = null;

  /**
   * Create a toolbar for an editor. Add it to the editor's map with `map.addControl`.
   * @throws TypeError if `tools` is empty or contains an unknown or repeated tool, or a label is not a string.
   */
  constructor(private readonly editor: GeometryEditor, options: ToolbarOptions = {}) {
    const tools = validTools(options.tools ?? defaultTools);
    for (const [key, value] of Object.entries(options.labels ?? {})) {
      if (!(key in defaultLabels)) throw new TypeError(`Unknown toolbar label: ${key}`);
      if (typeof value !== 'string') throw new TypeError(`Toolbar label ${key} must be a string.`);
    }
    this.labels = { ...defaultLabels, ...options.labels };

    this.root = document.createElement('div');
    this.root.className = 'maplibregl-ctrl mm-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-orientation', 'vertical');
    this.root.setAttribute('aria-label', this.labels.toolbar);
    let group: HTMLElement | null = null;
    let previous: Group | null = null;
    for (const tool of tools) {
      if (groups[tool] !== previous) {
        group = document.createElement('div');
        group.className = 'mm-toolbar-group';
        group.setAttribute('role', 'group');
        this.root.append(group);
        previous = groups[tool];
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mm-toolbar-button';
      button.dataset.tool = tool;
      button.setAttribute('aria-label', this.labels[tool]);
      if (!commands.has(tool)) button.setAttribute('aria-pressed', 'false');
      button.dataset.tooltip = this.labels[tool];
      button.append(toolbarIcon(document, tool));
      button.addEventListener('click', (event) => { this.activate(tool, event); });
      button.addEventListener('focus', () => { this.focusTool = tool; });
      group!.append(button);
      this.buttons.set(tool, button);
    }

    this.actions = document.createElement('div');
    this.actions.className = 'mm-toolbar-actions';
    this.actions.hidden = true;
    this.field = document.createElement('label');
    this.field.className = 'mm-toolbar-field';
    this.fieldName = document.createElement('span');
    this.input = document.createElement('input');
    this.input.type = 'number';
    this.fieldUnit = document.createElement('span');
    this.field.append(this.fieldName, this.input, this.fieldUnit);
    this.primary = this.action('finish', () => { this.editor.finish(); });
    this.primary.dataset.primary = 'true';
    this.removeLast = this.action('removeLastPoint', () => { this.removeLastPoint(); });
    this.cancel = this.action('cancel', () => { this.editor.cancel(); });
    this.actions.append(this.field, this.primary, this.removeLast, this.cancel);
    this.root.append(this.actions);

    this.input.addEventListener('input', this.changeField);
    this.input.addEventListener('keydown', this.fieldKey);
    this.root.addEventListener('keydown', this.navigate);
  }

  /** Called by `map.addControl`; returns the toolbar element. */
  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    this.unsubscribe = this.editor.onChange(() => { this.update(); });
    this.update();
    // MapLibre inserts the element right after onAdd; styles and placement need its position.
    queueMicrotask(() => {
      if (this.map !== map) return;
      const root = this.root.getRootNode();
      if (root instanceof Document || root instanceof ShadowRoot) injectStyles(root);
      this.update();
    });
    return this.root;
  }

  /** Called by `map.removeControl`; removes the element and stops listening to the editor. */
  onRemove(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.map = null;
    this.root.remove();
  }

  /** The toolbar is placed top-left unless `map.addControl` names another position. */
  getDefaultPosition(): ControlPosition { return 'top-left'; }

  private action(label: ToolbarLabelKey, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mm-toolbar-action';
    button.textContent = this.labels[label];
    button.addEventListener('click', run);
    return button;
  }

  private removeLastPoint(): void {
    const mode = this.editor.getState().mode;
    if (mode === 'split-polygon') this.editor.removeSplitPoint();
    else if (mode === 'reshape-polygon') this.editor.removeReshapePoint();
    else this.editor.removeLastDrawStep();
  }

  private selected(state: EditorState): GeometryFeature[] {
    const key = `${state.dataRevision}:${JSON.stringify(state.selectedFeatureIds)}`;
    if (this.selection.key !== key) {
      const features = state.selectedFeatureIds.map((id) => this.editor.getFeature(id)).filter((f): f is GeometryFeature => f !== null);
      this.selection = { key, features };
    }
    return this.selection.features;
  }

  private available(tool: ToolbarTool, state: EditorState): boolean {
    const features = this.selected(state);
    const locked = state.selectedFeatureIds.some((id) => this.editor.isFeatureLocked(id));
    const single = features.length === 1 ? features[0]! : null;
    switch (tool) {
      case 'point': case 'line': case 'polygon': return true;
      case 'hole': return single !== null && isPolygonal(single) && !locked;
      case 'edit': return single !== null && !locked;
      case 'split': return single?.geometry.type === 'Polygon' && !locked;
      case 'reshape': return single !== null && isSimplePolygon(single) && !locked;
      case 'shared-boundary': return features.length === 2 && features.every(isSimplePolygon) && !locked;
      case 'union': case 'difference': case 'intersection': return features.length >= 2 && features.every(isPolygonal) && !locked;
      case 'rotate': case 'scale': case 'buffer': case 'delete': return features.length > 0 && !locked;
      case 'simplify': return features.some((f) => !isPoint(f)) && !locked;
      case 'offset': return features.length > 0 && features.every(isLineal) && !locked;
      case 'duplicate': return features.length > 0;
      case 'snapping': case 'constraints': case 'tracing': return true;
      case 'undo': return state.canUndo;
      case 'redo': return state.canRedo;
    }
  }

  private enabled(tool: ToolbarTool, state: EditorState): boolean {
    const group = groups[tool];
    if (group === 'aids' || group === 'history') return this.available(tool, state);
    if (state.mode === 'idle') return this.available(tool, state);
    if (modeTools[state.mode] === tool) return true;
    // Switching tools is offered only while it discards no points or values.
    const empty = state.vertexCount === 0 && (state.mode === 'draw-point' || state.mode === 'draw-line' || state.mode === 'draw-polygon');
    return (empty || previewOnly.has(state.mode)) && this.available(tool, state);
  }

  private pressed(tool: ToolbarTool, state: EditorState): boolean {
    if (tool === 'snapping') return this.editor.getSnapping().enabled;
    if (tool === 'constraints') return this.editor.getDrawingConstraints().enabled;
    if (tool === 'tracing') return this.editor.getTracing().enabled;
    return modeTools[state.mode] === tool;
  }

  private activate(tool: ToolbarTool, event: MouseEvent): void {
    const state = this.editor.getState();
    if (!this.enabled(tool, state)) return;
    const group = groups[tool];
    if ((group === 'draw' || group === 'edit') && state.mode !== 'idle') {
      const active = modeTools[state.mode] === tool;
      this.editor.cancel();
      if (active) return;
    }
    switch (tool) {
      case 'point': this.editor.draw('Point'); break;
      case 'line': this.editor.draw('LineString'); break;
      case 'polygon': this.editor.draw('Polygon'); break;
      case 'hole': this.editor.drawHole(); break;
      case 'edit': this.editor.editSelected(); break;
      case 'split': this.editor.splitSelected(); break;
      case 'reshape': this.editor.reshapeSelected(); break;
      case 'shared-boundary': this.editor.editSharedBoundary(); break;
      case 'union': this.editor.unionSelection(); break;
      case 'difference': this.editor.differenceSelection(); break;
      case 'intersection': this.editor.intersectionSelection(); break;
      case 'rotate': this.editor.rotateSelection(); break;
      case 'scale': this.editor.scaleSelection(); break;
      case 'buffer': this.editor.bufferSelection(); break;
      case 'offset': this.editor.offsetSelection(); break;
      case 'simplify': this.editor.simplifySelection(); break;
      case 'duplicate': this.editor.duplicateSelection(this.duplicateOffset()); break;
      case 'delete': this.editor.deleteSelection(); break;
      case 'snapping': this.editor.setSnapping({ enabled: !this.editor.getSnapping().enabled }); break;
      case 'constraints': this.editor.setDrawingConstraints({ enabled: !this.editor.getDrawingConstraints().enabled }); break;
      case 'tracing': {
        const enabled = !this.editor.getTracing().enabled;
        // Tracing follows snapped boundaries, so it needs snapping.
        if (enabled && !this.editor.getSnapping().enabled) this.editor.setSnapping({ enabled: true });
        this.editor.setTracing({ enabled });
        break;
      }
      case 'undo': this.editor.undo(); break;
      case 'redo': this.editor.redo(); break;
    }
    this.update();
    // Pointer users continue on the map, where Enter and Escape finish or cancel; keyboard
    // users keep their place in the toolbar unless the button they used is now disabled.
    if (event.detail > 0 && group !== 'aids') this.map?.getCanvas().focus({ preventScroll: true });
    else if (this.buttons.get(tool)!.disabled) [...this.buttons.values()].find((button) => button.tabIndex === 0)?.focus();
  }

  /** Copies land 24 screen pixels right and down of the originals. */
  private duplicateOffset(): Coordinate {
    if (!this.map) return [0, 0];
    const canvas = this.map.getCanvas();
    const x = canvas.clientWidth / 2;
    const y = canvas.clientHeight / 2;
    const from = this.map.unproject([x, y]);
    const to = this.map.unproject([x + 24, y + 24]);
    return [to.lng - from.lng, to.lat - from.lat];
  }

  private readonly changeField = (): void => {
    const field = fields[this.editor.getState().mode];
    if (!field) return;
    const value = this.input.valueAsNumber;
    let valid = Number.isFinite(value);
    if (valid) {
      try { field.write(this.editor, value); } catch { valid = false; }
    }
    this.fieldInvalid = !valid;
    this.update();
  };

  private readonly fieldKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && !this.primary.disabled) { event.preventDefault(); this.editor.finish(); }
    if (event.key === 'Escape') { event.preventDefault(); this.editor.cancel(); }
  };

  // Arrow keys move between toolbar buttons; Tab leaves the button column.
  private readonly navigate = (event: KeyboardEvent): void => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.classList.contains('mm-toolbar-button')) return;
    const buttons = [...this.buttons.values()].filter((button) => !button.disabled);
    const index = buttons.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % buttons.length
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1;
    if (index < 0 || next < 0) return;
    event.preventDefault();
    buttons[next]!.focus();
  };

  private update(): void {
    const state = this.editor.getState();
    const active = modeTools[state.mode] ?? null;
    if (this.fieldMode !== state.mode) { this.fieldMode = state.mode; this.fieldInvalid = false; }
    this.root.classList.toggle('mm-toolbar--end', this.root.closest('.maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right') !== null);

    let tabStop: HTMLButtonElement | null = null;
    for (const [tool, button] of this.buttons) {
      button.disabled = !this.enabled(tool, state);
      if (!commands.has(tool)) button.setAttribute('aria-pressed', String(this.pressed(tool, state)));
      if (tool === active) button.dataset.active = 'true';
      else delete button.dataset.active;
      if (!button.disabled && (tabStop === null || tool === this.focusTool)) tabStop = button;
    }
    for (const button of this.buttons.values()) button.tabIndex = button === tabStop ? 0 : -1;

    // The panel belongs to the active tool's button; modes started elsewhere are left to their caller.
    const anchor = active === null ? undefined : this.buttons.get(active);
    this.actions.hidden = anchor === undefined;
    if (anchor === undefined) return;
    this.actions.style.top = `${anchor.offsetTop}px`;

    const field = fields[state.mode];
    this.field.hidden = !field;
    if (field) {
      this.fieldName.textContent = this.labels[field.label];
      this.fieldUnit.textContent = field.unit;
      this.input.step = field.step;
      if (field.min === undefined) this.input.removeAttribute('min');
      else this.input.min = field.min;
      if (document.activeElement !== this.input && !this.fieldInvalid) this.input.value = format(field.read(state));
    }
    this.input.setAttribute('aria-invalid', String(this.fieldInvalid));

    this.primary.hidden = state.mode === 'draw-point';
    this.primary.textContent = this.labels[state.mode.startsWith('draw-') ? 'finish' : state.mode.startsWith('edit-') ? 'save' : 'apply'];
    this.primary.disabled = !state.canFinish || this.fieldInvalid;
    this.removeLast.hidden = !removable.has(state.mode);
    this.removeLast.disabled = state.vertexCount === 0;
  }
}
