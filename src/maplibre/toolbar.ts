import type { ControlPosition, IControl, Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate, EditorMode, EditorState, GeometryFeature } from '../core/types.js';
import type { GeometryEditor } from './geometry-editor.js';
import { toolbarIcon } from './toolbar-icons.js';
import { toolbarStyles } from './toolbar-styles.js';
import { adoptStyles } from './adopt-styles.js';

/** A button that {@link EditorToolbar} can show. */
export type ToolbarTool =
  | 'point' | 'line' | 'polygon' | 'rectangle' | 'circle' | 'ellipse' | 'freehand' | 'hole' | 'part'
  | 'edit' | 'split' | 'cut' | 'reshape' | 'shared-boundary'
  | 'union' | 'difference' | 'intersection' | 'combine' | 'explode'
  | 'rotate' | 'scale' | 'buffer' | 'offset' | 'simplify'
  | 'duplicate' | 'delete'
  | 'snapping' | 'constraints' | 'tracing' | 'measure' | 'zoom'
  | 'undo' | 'redo';

/** Texts the toolbar shows: one per tool, plus the action panel and its fields. */
export type ToolbarLabelKey = ToolbarTool
  | 'toolbar' | 'finish' | 'save' | 'apply' | 'cancel' | 'removeLastPoint'
  | 'distance' | 'tolerance' | 'angle' | 'factor' | 'collapse' | 'expand';

/** Every toolbar text, keyed by tool or action. */
export type ToolbarLabels = Record<ToolbarLabelKey, string>;

/** An application button added to {@link EditorToolbar} with the `buttons` option. */
export interface ToolbarButton {
  /** Unique name, exposed as the button's `data-tool` attribute. */
  id: string;
  /** Tooltip and accessible name. */
  label: string;
  /**
   * An SVG or other element to show; it is cloned into the button. Without an icon the
   * button shows the label's first letter.
   */
  icon?: Element;
  /** Runs when the button is clicked. */
  onClick(editor: GeometryEditor): void;
  /** Whether the button can be used; called after every editor change. Defaults to always. */
  enabled?(state: EditorState, editor: GeometryEditor): boolean;
  /** Makes the button a toggle and returns whether it is on; called after every editor change. */
  pressed?(state: EditorState, editor: GeometryEditor): boolean;
}

/** Options for {@link EditorToolbar}. */
export interface ToolbarOptions {
  /**
   * Buttons to show, in order. Neighbouring tools of the same kind (drawing, editing,
   * drawing aids, history) share a group. Defaults to {@link EditorToolbar.defaultTools}.
   */
  tools?: readonly ToolbarTool[];
  /** Replace button tooltips and action texts, for example to translate the toolbar. */
  labels?: Partial<ToolbarLabels>;
  /** Application buttons, shown in their own group after the built-in tools. */
  buttons?: readonly ToolbarButton[];
  /** Add a button that hides and shows the tools, for small maps. Default false. */
  collapsible?: boolean;
  /** Start collapsed when `collapsible` is true. Default false. */
  collapsed?: boolean;
}

type Group = 'draw' | 'edit' | 'aids' | 'history' | 'custom';
interface Field {
  label: 'distance' | 'tolerance' | 'angle' | 'factor';
  unit: string;
  step: string;
  min?: string;
  read(state: EditorState): number | null;
  write(editor: GeometryEditor, value: number): void;
}

const allTools: readonly ToolbarTool[] = Object.freeze<ToolbarTool[]>([
  'point', 'line', 'polygon', 'rectangle', 'circle', 'ellipse', 'freehand', 'hole', 'part',
  'edit', 'split', 'cut', 'reshape', 'shared-boundary', 'union', 'difference', 'intersection', 'combine', 'explode',
  'rotate', 'scale', 'buffer', 'offset', 'simplify', 'duplicate', 'delete',
  'snapping', 'constraints', 'tracing', 'measure', 'zoom',
  'undo', 'redo',
]);
const defaultTools: readonly ToolbarTool[] = Object.freeze<ToolbarTool[]>([
  'point', 'line', 'polygon', 'edit', 'split', 'union', 'difference', 'rotate', 'scale', 'delete', 'undo', 'redo',
]);

const defaultLabels: ToolbarLabels = {
  point: 'Draw marker', line: 'Draw line', polygon: 'Draw polygon', rectangle: 'Draw rectangle', circle: 'Draw circle', ellipse: 'Draw ellipse',
  freehand: 'Draw freehand', hole: 'Draw hole', part: 'Add part',
  edit: 'Edit vertices', split: 'Split polygon', cut: 'Cut', reshape: 'Reshape boundary', 'shared-boundary': 'Edit shared boundary',
  union: 'Merge polygons', difference: 'Subtract polygons', intersection: 'Intersect polygons',
  combine: 'Combine into multipart', explode: 'Separate parts',
  rotate: 'Rotate', scale: 'Scale', buffer: 'Buffer', offset: 'Offset lines', simplify: 'Simplify',
  duplicate: 'Duplicate', delete: 'Delete',
  snapping: 'Snapping', constraints: '45° angles', tracing: 'Trace boundaries', measure: 'Measurements', zoom: 'Zoom to features',
  undo: 'Undo', redo: 'Redo',
  toolbar: 'Geometry tools', finish: 'Finish', save: 'Save', apply: 'Apply', cancel: 'Cancel',
  removeLastPoint: 'Remove last point', distance: 'Distance', tolerance: 'Tolerance', angle: 'Angle', factor: 'Factor',
  collapse: 'Hide tools', expand: 'Show tools',
};

const groups: Record<ToolbarTool, Group> = {
  point: 'draw', line: 'draw', polygon: 'draw', rectangle: 'draw', circle: 'draw', ellipse: 'draw', freehand: 'draw', hole: 'draw', part: 'draw',
  edit: 'edit', split: 'edit', cut: 'edit', reshape: 'edit', 'shared-boundary': 'edit', union: 'edit', difference: 'edit',
  intersection: 'edit', combine: 'edit', explode: 'edit', rotate: 'edit', scale: 'edit', buffer: 'edit', offset: 'edit', simplify: 'edit',
  duplicate: 'edit', delete: 'edit',
  snapping: 'aids', constraints: 'aids', tracing: 'aids', measure: 'aids', zoom: 'aids',
  undo: 'history', redo: 'history',
};

const modeTools: Partial<Record<EditorMode, ToolbarTool>> = {
  'draw-point': 'point', 'draw-line': 'line', 'draw-polygon': 'polygon', 'draw-hole': 'hole',
  'draw-rectangle': 'rectangle', 'draw-circle': 'circle', 'draw-ellipse': 'ellipse', 'draw-freehand': 'freehand', 'draw-part': 'part', 'draw-cut': 'cut',
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
const removable: ReadonlySet<EditorMode> = new Set<EditorMode>(['draw-line', 'draw-polygon', 'draw-hole', 'draw-part', 'draw-cut', 'draw-rectangle', 'draw-circle', 'draw-ellipse', 'split-polygon', 'reshape-polygon']);
// Shapes complete themselves on the last click or when the pointer is released.
const selfFinishing: ReadonlySet<EditorMode> = new Set<EditorMode>(['draw-point', 'draw-rectangle', 'draw-circle', 'draw-ellipse', 'draw-freehand']);
// Drawing modes another tool may replace before the first point is placed.
const drawing: ReadonlySet<EditorMode> = new Set<EditorMode>(['draw-point', 'draw-line', 'draw-polygon', 'draw-rectangle', 'draw-circle', 'draw-ellipse', 'draw-freehand', 'draw-cut']);
// One-shot commands rather than modes or settings: they have no pressed state.
const commands: ReadonlySet<ToolbarTool> = new Set<ToolbarTool>(['combine', 'explode', 'duplicate', 'delete', 'zoom', 'undo', 'redo']);
// Leaving these modes for another tool discards no user input.
const previewOnly: ReadonlySet<EditorMode> = new Set<EditorMode>(['union-polygons', 'difference-polygons', 'intersection-polygons']);

const isPoint = (f: GeometryFeature): boolean => f.geometry.type === 'Point';
const isPolygonal = (f: GeometryFeature): boolean => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon';
const isSimplePolygon = (f: GeometryFeature): boolean => f.geometry.type === 'Polygon' && f.geometry.coordinates.length === 1;
const isLineal = (f: GeometryFeature): boolean => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString';
const isMultipart = (f: GeometryFeature): boolean => f.geometry.type === 'MultiPolygon' || f.geometry.type === 'MultiLineString';
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

function validButtons(value: unknown, tools: readonly ToolbarTool[]): readonly ToolbarButton[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('Toolbar buttons must be an array.');
  const ids = new Set<string>(tools);
  for (const button of value as unknown[]) {
    const candidate = button as Partial<ToolbarButton> | null;
    if (typeof candidate !== 'object' || candidate === null || typeof candidate.id !== 'string' || !candidate.id) throw new TypeError('Toolbar buttons need a non-empty string id.');
    if (ids.has(candidate.id)) throw new TypeError(`Repeated toolbar tool: ${candidate.id}`);
    ids.add(candidate.id);
    if (typeof candidate.label !== 'string' || !candidate.label) throw new TypeError(`Toolbar button ${candidate.id} needs a label.`);
    if (typeof candidate.onClick !== 'function') throw new TypeError(`Toolbar button ${candidate.id} needs an onClick function.`);
    for (const key of ['enabled', 'pressed'] as const) {
      if (candidate[key] !== undefined && typeof candidate[key] !== 'function') throw new TypeError(`Toolbar button ${candidate.id}: ${key} must be a function.`);
    }
    if (candidate.icon !== undefined && !(candidate.icon instanceof Element)) throw new TypeError(`Toolbar button ${candidate.id}: icon must be an element.`);
  }
  return value as ToolbarButton[];
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
  private readonly custom = new Map<HTMLButtonElement, ToolbarButton>();
  private readonly toggle: HTMLButtonElement | null = null;
  private collapsed: boolean;
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
  private focusButton: HTMLButtonElement | null = null;

  /**
   * Create a toolbar for an editor. Add it to the editor's map with `map.addControl`.
   * @throws TypeError if `tools` is empty or contains an unknown or repeated tool, a label is
   * not a string, or a custom button is incomplete.
   */
  constructor(private readonly editor: GeometryEditor, options: ToolbarOptions = {}) {
    const tools = validTools(options.tools ?? defaultTools);
    const custom = validButtons(options.buttons, tools);
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
    this.collapsed = options.collapsible === true && options.collapsed === true;
    if (options.collapsible) {
      const group = this.group();
      group.dataset.toggle = 'true';
      this.toggle = this.button('toggle', '', toolbarIcon(document, 'toggle'));
      this.toggle.addEventListener('click', () => { this.collapsed = !this.collapsed; this.update(); });
      group.append(this.toggle);
    }
    let group: HTMLElement | null = null;
    let previous: Group | null = null;
    for (const tool of tools) {
      if (groups[tool] !== previous) {
        group = this.group();
        previous = groups[tool];
      }
      const button = this.button(tool, this.labels[tool], toolbarIcon(document, tool));
      if (!commands.has(tool)) button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', (event) => { this.activate(tool, event); });
      group!.append(button);
      this.buttons.set(tool, button);
    }
    if (custom.length) group = this.group();
    for (const definition of custom) {
      const icon = definition.icon ? definition.icon.cloneNode(true) as Element : document.createElement('span');
      if (!definition.icon) { icon.textContent = definition.label.charAt(0).toUpperCase(); icon.className = 'mm-toolbar-letter'; }
      icon.setAttribute('aria-hidden', 'true');
      const button = this.button(definition.id, definition.label, icon);
      if (definition.pressed) button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', (event) => {
        if (button.disabled) return;
        definition.onClick(this.editor);
        this.update();
        if (event.detail > 0 && !definition.pressed) this.map?.getCanvas().focus({ preventScroll: true });
      });
      group!.append(button);
      this.custom.set(button, definition);
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
      if (root instanceof Document || root instanceof ShadowRoot) adoptStyles(root, toolbarStyles);
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

  private group(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'mm-toolbar-group';
    group.setAttribute('role', 'group');
    this.root.append(group);
    return group;
  }

  private button(id: string, label: string, icon: Element): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mm-toolbar-button';
    button.dataset.tool = id;
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
    button.append(icon);
    button.addEventListener('focus', () => { this.focusButton = button; });
    return button;
  }

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
      case 'point': case 'line': case 'polygon': case 'rectangle': case 'circle': case 'ellipse': case 'freehand': return true;
      case 'hole': return single !== null && isPolygonal(single) && !locked;
      case 'part': return single !== null && !isPoint(single) && !locked;
      case 'cut': return state.featureCount > 0 && !locked;
      case 'combine': return features.length >= 2 && (features.every(isPolygonal) || features.every(isLineal)) && !locked;
      case 'explode': return features.some(isMultipart) && !locked;
      case 'edit': return single !== null && !locked;
      case 'split': return single?.geometry.type === 'Polygon' && !locked;
      case 'reshape': return single !== null && isSimplePolygon(single) && !locked;
      case 'shared-boundary': return features.length === 2 && features.every(isSimplePolygon) && !locked;
      case 'union': case 'difference': case 'intersection': return features.length >= 2 && features.every(isPolygonal) && !locked;
      case 'rotate': case 'scale': case 'buffer': case 'delete': return features.length > 0 && !locked;
      case 'simplify': return features.some((f) => !isPoint(f)) && !locked;
      case 'offset': return features.length > 0 && features.every(isLineal) && !locked;
      case 'duplicate': return features.length > 0;
      case 'snapping': case 'constraints': case 'tracing': case 'measure': return true;
      case 'zoom': return state.featureCount > 0;
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
    const empty = state.vertexCount === 0 && drawing.has(state.mode);
    return (empty || previewOnly.has(state.mode)) && this.available(tool, state);
  }

  private pressed(tool: ToolbarTool, state: EditorState): boolean {
    if (tool === 'snapping') return this.editor.getSnapping().enabled;
    if (tool === 'constraints') return this.editor.getDrawingConstraints().enabled;
    if (tool === 'tracing') return this.editor.getTracing().enabled;
    if (tool === 'measure') return this.editor.getMeasurements().enabled;
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
      case 'rectangle': this.editor.draw('Rectangle'); break;
      case 'circle': this.editor.draw('Circle'); break;
      case 'ellipse': this.editor.draw('Ellipse'); break;
      case 'freehand': this.editor.draw('Freehand'); break;
      case 'hole': this.editor.drawHole(); break;
      case 'part': this.editor.drawPart(); break;
      case 'cut': this.editor.drawCut(); break;
      case 'combine': this.editor.combineSelection(); break;
      case 'explode': this.editor.explodeSelection(); break;
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
      case 'measure': this.editor.setMeasurements({ enabled: !this.editor.getMeasurements().enabled }); break;
      case 'zoom': this.editor.zoomToFeatures(); break;
      case 'undo': this.editor.undo(); break;
      case 'redo': this.editor.redo(); break;
    }
    this.update();
    // Pointer users continue on the map, where Enter and Escape finish or cancel; keyboard
    // users keep their place in the toolbar unless the button they used is now disabled.
    if (event.detail > 0 && group !== 'aids') this.map?.getCanvas().focus({ preventScroll: true });
    else if (this.buttons.get(tool)!.disabled) this.navigable().find((button) => button.tabIndex === 0)?.focus();
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
    const buttons = this.navigable();
    const index = buttons.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % buttons.length
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1;
    if (index < 0 || next < 0) return;
    event.preventDefault();
    buttons[next]!.focus();
  };

  /** Enabled, visible buttons in order, including the collapse toggle. */
  private navigable(): HTMLButtonElement[] {
    return [...this.root.querySelectorAll<HTMLButtonElement>('.mm-toolbar-button')].filter((button) => !button.disabled && !button.closest('[hidden]'));
  }

  private update(): void {
    const state = this.editor.getState();
    const active = modeTools[state.mode] ?? null;
    if (this.fieldMode !== state.mode) { this.fieldMode = state.mode; this.fieldInvalid = false; }
    this.root.classList.toggle('mm-toolbar--end', this.root.closest('.maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right') !== null);

    if (this.toggle) {
      const label = this.labels[this.collapsed ? 'expand' : 'collapse'];
      this.toggle.setAttribute('aria-label', label);
      this.toggle.dataset.tooltip = label;
      this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
      for (const group of this.root.querySelectorAll<HTMLElement>('.mm-toolbar-group:not([data-toggle])')) group.hidden = this.collapsed;
    }
    for (const [tool, button] of this.buttons) {
      button.disabled = !this.enabled(tool, state);
      if (!commands.has(tool)) button.setAttribute('aria-pressed', String(this.pressed(tool, state)));
      if (tool === active) button.dataset.active = 'true';
      else delete button.dataset.active;
    }
    for (const [button, definition] of this.custom) {
      button.disabled = definition.enabled ? !definition.enabled(state, this.editor) : false;
      if (definition.pressed) button.setAttribute('aria-pressed', String(definition.pressed(state, this.editor)));
    }
    const navigable = this.navigable();
    const tabStop = navigable.includes(this.focusButton!) ? this.focusButton : navigable[0] ?? null;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.mm-toolbar-button')) button.tabIndex = button === tabStop ? 0 : -1;

    // The panel belongs to the active tool's button; modes started elsewhere are left to their caller.
    const anchor = active === null || this.collapsed ? undefined : this.buttons.get(active);
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

    this.primary.hidden = selfFinishing.has(state.mode);
    this.primary.textContent = this.labels[state.mode === 'draw-cut' ? 'apply' : state.mode.startsWith('draw-') ? 'finish' : state.mode.startsWith('edit-') ? 'save' : 'apply'];
    this.primary.disabled = !state.canFinish || this.fieldInvalid;
    this.removeLast.hidden = !removable.has(state.mode);
    this.removeLast.disabled = state.vertexCount === 0;
  }
}
