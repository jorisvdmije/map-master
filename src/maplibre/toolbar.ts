import type { ShapeTemplate } from '../core/shape-templates.js';
import { TemplateControls, type TemplateLabelKey } from './template-controls.js';
import { defaultTextMarkerStyle, type TextMarkerOptions } from '../core/text-marker.js';
import type { KeyboardTool } from '../core/keyboard-shortcuts.js';
import { toolAvailable, runTool } from './editor-tools.js';
import type { ControlPosition, IControl, EditorMap as MapLibreMap } from '../gl/map.js';
import type { Coordinate, EditorMode, EditorState, GeometryFeature, LassoOptions } from '../core/types.js';
import type { GeometryEditor } from './geometry-editor.js';
import { geometryParts } from '../core/geometry.js';
import { toolbarIcon } from './toolbar-icons.js';
import { toolbarStyles } from './toolbar-styles.js';
import { adoptStyles } from './adopt-styles.js';
import { controlHeight, fitControlPanel } from './control-layout.js';

/** A button that {@link EditorToolbar} can show. */
export type ToolbarTool = KeyboardTool;

/** Texts the toolbar shows: one per tool, plus the action panel and its fields. */
export type ToolbarLabelKey = ToolbarTool | TemplateLabelKey
  | 'layerHistoryBlocked' | 'outsideAllowed' | 'intersectsExcluded' | 'insideExcluded' | 'geofencingFailed' | 'pinInvalid' | 'toolbar' | 'finish' | 'save' | 'apply' | 'cancel' | 'removeLastPoint'
  | 'distance' | 'tolerance' | 'angle' | 'factor' | 'collapse' | 'expand'
  | 'holeChoice' | 'holeNumber' | 'partNumber' | 'holeOverlap'
  | 'lassoOperation' | 'replaceSelection' | 'addToSelection' | 'subtractFromSelection'
  | 'lassoMatch' | 'intersects' | 'contains' | 'lassoInvalid'
  | 'labelText' | 'fontSize' | 'textColor' | 'textBackground' | 'fontWeight' | 'normal' | 'bold' | 'textAlign' | 'left' | 'center' | 'right';

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
  /** Choose the initial template with an application-owned picker; null keeps the current tool. */
  templatePicker?: (templates: readonly ShapeTemplate[], editor: GeometryEditor) => string | null;
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
  'point', 'text', 'template', 'line', 'polygon', 'rectangle', 'circle', 'ellipse', 'freehand', 'hole', 'part',
  'pin', 'unpin', 'lasso', 'edit', 'remove-hole', 'split', 'cut', 'reshape', 'shared-boundary', 'union', 'difference', 'intersection', 'combine', 'explode',
  'rotate', 'scale', 'buffer', 'offset', 'simplify', 'duplicate', 'delete',
  'geofencing', 'guides', 'snapping', 'constraints', 'tracing', 'measure', 'zoom',
  'undo', 'redo',
]);
const defaultTools: readonly ToolbarTool[] = Object.freeze<ToolbarTool[]>([
  'point', 'line', 'polygon', 'edit', 'split', 'union', 'difference', 'rotate', 'scale', 'delete', 'undo', 'redo',
]);

const defaultLabels: ToolbarLabels = {
  layerHistoryBlocked: 'History is blocked by data layer settings.',
  geofencing: 'Geofencing', outsideAllowed: 'Keep the complete shape inside the allowed area.', intersectsExcluded: 'Keep the shape clear of the excluded area, including its boundary.', insideExcluded: 'The shape must not be contained in the excluded area.', geofencingFailed: 'The area check failed. Correct the shape or cancel.',
  pin: 'Pin shared vertices', unpin: 'Unpin vertices', pinInvalid: 'A linked feature is locked or would become invalid. Move the vertex back or cancel.',
  template: 'Place template', templateChoice: 'Template', templateSize: 'Size (Mercator m)', templateRotation: 'Rotation (°)',
  templateLongitude: 'Longitude', templateLatitude: 'Latitude', templateInvalid: 'Enter valid placement values. Keep the complete shape inside the supported Mercator world.',
  text: 'Draw text', labelText: 'Text', fontSize: 'Text size', textColor: 'Text color', textBackground: 'Text background',
  fontWeight: 'Weight', normal: 'Normal', bold: 'Bold', textAlign: 'Alignment', left: 'Left', center: 'Center', right: 'Right',
  point: 'Draw marker', line: 'Draw line', polygon: 'Draw polygon', rectangle: 'Draw rectangle', circle: 'Draw circle', ellipse: 'Draw ellipse',
  freehand: 'Draw freehand', hole: 'Draw hole', part: 'Add part',
  edit: 'Edit vertices', split: 'Split polygon', cut: 'Cut', reshape: 'Reshape boundary', 'shared-boundary': 'Edit shared boundary',
  'remove-hole': 'Remove hole', holeChoice: 'Hole', holeNumber: 'Hole', partNumber: 'Part',
  holeOverlap: 'This hole contains another polygon part. Choose another hole or cancel.',
  lasso: 'Lasso selection', lassoOperation: 'Action', replaceSelection: 'Replace', addToSelection: 'Add', subtractFromSelection: 'Remove',
  lassoMatch: 'Match', intersects: 'Touches', contains: 'Fully inside', lassoInvalid: 'Draw a loop with at least three corners, without crossing its own path.',
  union: 'Merge polygons', difference: 'Subtract polygons', intersection: 'Intersect polygons',
  combine: 'Combine into multipart', explode: 'Separate parts',
  rotate: 'Rotate', scale: 'Scale', buffer: 'Buffer', offset: 'Offset lines', simplify: 'Simplify',
  duplicate: 'Duplicate', delete: 'Delete',
  guides: 'Alignment guides', snapping: 'Snapping', constraints: '45° angles', tracing: 'Trace boundaries', measure: 'Measurements', zoom: 'Zoom to features',
  undo: 'Undo', redo: 'Redo',
  toolbar: 'Geometry tools', finish: 'Finish', save: 'Save', apply: 'Apply', cancel: 'Cancel',
  removeLastPoint: 'Remove last point', distance: 'Distance', tolerance: 'Tolerance', angle: 'Angle', factor: 'Factor',
  collapse: 'Hide tools', expand: 'Show tools',
};

const groups: Record<ToolbarTool, Group> = {
  pin: 'edit', unpin: 'edit', template: 'draw', text: 'draw', point: 'draw', line: 'draw', polygon: 'draw', rectangle: 'draw', circle: 'draw', ellipse: 'draw', freehand: 'draw', hole: 'draw', part: 'draw',
  edit: 'edit', split: 'edit', cut: 'edit', reshape: 'edit', 'shared-boundary': 'edit', union: 'edit', difference: 'edit',
  intersection: 'edit', combine: 'edit', explode: 'edit', rotate: 'edit', scale: 'edit', buffer: 'edit', offset: 'edit', simplify: 'edit',
  duplicate: 'edit', delete: 'edit', 'remove-hole': 'edit', lasso: 'edit',
  geofencing: 'aids', guides: 'aids', snapping: 'aids', constraints: 'aids', tracing: 'aids', measure: 'aids', zoom: 'aids',
  undo: 'history', redo: 'history',
};

const modeTools: Partial<Record<EditorMode, ToolbarTool>> = {
  'draw-template': 'template', 'draw-text': 'text', 'draw-point': 'point', 'draw-line': 'line', 'draw-polygon': 'polygon', 'draw-hole': 'hole',
  'draw-rectangle': 'rectangle', 'draw-circle': 'circle', 'draw-ellipse': 'ellipse', 'draw-freehand': 'freehand', 'draw-part': 'part', 'draw-cut': 'cut',
  'edit-point': 'edit', 'edit-line': 'edit', 'edit-polygon': 'edit',
  'remove-hole': 'remove-hole',
  'select-lasso': 'lasso',
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
const selfFinishing: ReadonlySet<EditorMode> = new Set<EditorMode>(['draw-point', 'draw-rectangle', 'draw-circle', 'draw-ellipse', 'draw-freehand', 'select-lasso']);
// Drawing modes another tool may replace before the first point is placed.
const drawing: ReadonlySet<EditorMode> = new Set<EditorMode>(['draw-text', 'draw-point', 'draw-line', 'draw-polygon', 'draw-rectangle', 'draw-circle', 'draw-ellipse', 'draw-freehand', 'draw-cut']);
// One-shot commands rather than modes or settings: they have no pressed state.
const commands: ReadonlySet<ToolbarTool> = new Set<ToolbarTool>(['pin', 'unpin', 'combine', 'explode', 'duplicate', 'delete', 'zoom', 'undo', 'redo']);
// Leaving these modes for another tool discards no user input.
const previewOnly: ReadonlySet<EditorMode> = new Set<EditorMode>(['union-polygons', 'difference-polygons', 'intersection-polygons', 'remove-hole', 'select-lasso']);

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
 * A ready-made GL map control with buttons for drawing, editing, geometry tools,
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

  private readonly templatePicker: ToolbarOptions['templatePicker'];
  private readonly labels: ToolbarLabels;
  private readonly root: HTMLElement;
  private readonly column: HTMLElement;
  private readonly tooltip: HTMLElement;
  private tooltipAnchor: HTMLButtonElement | null = null;
  private lastActive: ToolbarTool | null = null;
  private observer: ResizeObserver | null = null;
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
  private readonly holeField: HTMLLabelElement;
  private readonly holeSelect: HTMLSelectElement;
  private readonly holeWarning: HTMLElement;
  private readonly pinWarning: HTMLElement;
  private readonly geofenceNotice: HTMLElement;
  private holeOptionsKey = '';
  private readonly templateControls: TemplateControls;
  private readonly textFields: HTMLElement;
  private readonly textInput: HTMLTextAreaElement;
  private readonly textStyleInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private textInvalid = false;
  private readonly lassoFields: HTMLElement;
  private readonly lassoOperation: HTMLSelectElement;
  private readonly lassoMatch: HTMLSelectElement;
  private readonly lassoWarning: HTMLElement;
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
    if (options.templatePicker !== undefined && typeof options.templatePicker !== 'function') throw new TypeError('templatePicker must be a function.');
    this.templatePicker = options.templatePicker;
    for (const [key, value] of Object.entries(options.labels ?? {})) {
      if (!(key in defaultLabels)) throw new TypeError(`Unknown toolbar label: ${key}`);
      if (typeof value !== 'string') throw new TypeError(`Toolbar label ${key} must be a string.`);
    }
    this.labels = { ...defaultLabels, ...options.labels };

    this.root = document.createElement('div');
    this.root.className = 'maplibregl-ctrl mapboxgl-ctrl mm-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-orientation', 'vertical');
    this.root.setAttribute('aria-label', this.labels.toolbar);
    this.column = document.createElement('div');
    this.column.className = 'mm-toolbar-tools';
    this.root.append(this.column);
    this.column.addEventListener('scroll', this.layout, { passive: true });
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'mm-toolbar-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    this.root.addEventListener('pointerover', this.showTooltip);
    this.root.addEventListener('focusin', this.showTooltip);
    this.root.addEventListener('pointerout', this.hideTooltip);
    this.root.addEventListener('focusout', this.hideTooltip);
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
    this.holeField = document.createElement('label');
    this.holeField.className = 'mm-toolbar-field mm-toolbar-hole';
    const holeLabel = document.createElement('span');
    holeLabel.textContent = this.labels.holeChoice;
    this.holeSelect = document.createElement('select');
    this.holeSelect.addEventListener('change', () => {
      const [partIndex, ringIndex] = this.holeSelect.value.split(':').map(Number);
      this.editor.setHoleToRemove(ringIndex!, partIndex);
    });
    this.holeSelect.addEventListener('keydown', this.fieldKey);
    this.holeField.append(holeLabel, this.holeSelect);
    this.holeWarning = document.createElement('span');
    this.holeWarning.className = 'mm-toolbar-notice';
    this.holeWarning.setAttribute('role', 'status');
    this.holeWarning.textContent = this.labels.holeOverlap;
    this.lassoFields = document.createElement('div');
    this.lassoFields.className = 'mm-toolbar-lasso';
    this.lassoOperation = this.choice('lassoOperation', [['replace', 'replaceSelection'], ['add', 'addToSelection'], ['subtract', 'subtractFromSelection']], (value) => {
      this.editor.setLassoOptions({ operation: value as LassoOptions['operation'] });
    });
    this.lassoMatch = this.choice('lassoMatch', [['intersects', 'intersects'], ['contains', 'contains']], (value) => {
      this.editor.setLassoOptions({ match: value as LassoOptions['match'] });
    });
    this.pinWarning = document.createElement('span');
    this.pinWarning.className = 'mm-toolbar-notice';
    this.pinWarning.setAttribute('role', 'status');
    this.pinWarning.textContent = this.labels.pinInvalid;
    this.lassoWarning = document.createElement('span');
    this.lassoWarning.className = 'mm-toolbar-notice';
    this.lassoWarning.setAttribute('role', 'status');
    this.lassoWarning.textContent = this.labels.lassoInvalid;
    this.textFields = document.createElement('div');
    this.textFields.className = 'mm-toolbar-text';
    const textLabel = document.createElement('label'); textLabel.className = 'mm-toolbar-field';
    const textName = document.createElement('span'); textName.textContent = this.labels.labelText;
    this.textInput = document.createElement('textarea'); this.textInput.rows = 2; this.textInput.maxLength = 2000;
    this.textInput.dataset.textMarker = 'text';
    this.textInput.addEventListener('input', () => { this.changeText({ text: this.textInput.value }); });
    this.textInput.addEventListener('keydown', (event) => {
      // Enter inserts a newline. Mod+Enter saves; Escape cancels, except during composition.
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault(); this.editor.cancel();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !this.primary.disabled) {
        event.preventDefault(); this.editor.finish();
      }
    });
    textLabel.append(textName, this.textInput); this.textFields.append(textLabel);
    for (const [key, label, type] of [['fontSize', 'fontSize', 'number'], ['color', 'textColor', 'color'], ['backgroundColor', 'textBackground', 'color']] as const) {
      const field = document.createElement('label'); field.className = 'mm-toolbar-field';
      const name = document.createElement('span'); name.textContent = this.labels[label];
      const input = document.createElement('input'); input.type = type; input.dataset.textMarker = key;
      if (type === 'number') { input.min = '8'; input.max = '96'; input.step = '1'; }
      input.addEventListener('input', () => { this.changeText({ style: { [key]: type === 'number' ? input.valueAsNumber : input.value } }); });
      input.addEventListener('keydown', this.fieldKey);
      this.textStyleInputs.set(key, input); field.append(name, input); this.textFields.append(field);
    }
    for (const [key, options] of [['fontWeight', ['normal', 'bold']], ['textAlign', ['left', 'center', 'right']]] as const) {
      const field = document.createElement('label'); field.className = 'mm-toolbar-field';
      const name = document.createElement('span'); name.textContent = this.labels[key];
      const select = document.createElement('select'); select.dataset.textMarker = key;
      for (const value of options) {
        const option = document.createElement('option'); option.value = value; option.textContent = this.labels[value]; select.append(option);
      }
      select.addEventListener('change', () => { this.changeText({ style: { [key]: select.value } }); });
      select.addEventListener('keydown', this.fieldKey);
      this.textStyleInputs.set(key, select); field.append(name, select); this.textFields.append(field);
    }
    this.templateControls = new TemplateControls(editor, this.labels, () => { this.update(); }, this.fieldKey);
    this.primary = this.action('finish', () => { this.editor.finish(); });
    this.primary.dataset.primary = 'true';
    this.removeLast = this.action('removeLastPoint', () => { this.removeLastPoint(); });
    this.cancel = this.action('cancel', () => { this.editor.cancel(); });
    this.actions.append(this.field, this.holeField, this.lassoFields, this.textFields, this.templateControls.root, this.primary, this.removeLast, this.cancel, this.holeWarning, this.lassoWarning, this.pinWarning);
    this.root.append(this.actions);
    this.geofenceNotice = document.createElement('div');
    this.geofenceNotice.className = 'mm-geofencing-notice';
    this.geofenceNotice.setAttribute('role', 'status');
    this.root.append(this.geofenceNotice, this.tooltip);

    this.input.addEventListener('input', this.changeField);
    this.input.addEventListener('keydown', this.fieldKey);
    this.root.addEventListener('keydown', this.navigate);
  }

  /** Called by `map.addControl`; returns the toolbar element. */
  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    map.on('resize', this.resize);
    this.observer = new ResizeObserver(this.layout);
    this.observer.observe(map.getCanvas());
    this.observer.observe(this.root);
    this.observer.observe(this.actions);
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
    this.map?.off('resize', this.resize);
    this.observer?.disconnect();
    this.observer = null;
    this.tooltipAnchor = null;
    this.tooltip.hidden = true;
    this.map = null;
    this.root.remove();
  }

  /** The toolbar is placed top-left unless `map.addControl` names another position. */
  getDefaultPosition(): ControlPosition { return 'top-left'; }

  private readonly resize = (): void => { this.update(); };

  private group(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'mm-toolbar-group';
    group.setAttribute('role', 'group');
    this.column.append(group);
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

  private choice(label: ToolbarLabelKey, options: readonly (readonly [string, ToolbarLabelKey])[], run: (value: string) => void): HTMLSelectElement {
    const field = document.createElement('label'); field.className = 'mm-toolbar-field';
    const name = document.createElement('span'); name.textContent = this.labels[label];
    const select = document.createElement('select'); select.dataset.lasso = label;
    for (const [value, key] of options) {
      const option = document.createElement('option'); option.value = value; option.textContent = this.labels[key]; select.append(option);
    }
    select.addEventListener('change', () => { run(select.value); });
    select.addEventListener('keydown', this.fieldKey);
    field.append(name, select); this.lassoFields.append(field);
    return select;
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
    return toolAvailable(this.editor, tool, state, this.selected(state));
  }

  private enabled(tool: ToolbarTool, state: EditorState): boolean {
    const group = groups[tool];
    if (group === 'aids' || group === 'history') return this.available(tool, state);
    if (state.mode === 'idle') return this.available(tool, state);
    if (modeTools[state.mode] === tool) return true;
    // Switching tools is offered only while it discards no points or values.
    const text = this.editor.getTextMarkerDraft();
    const empty = state.vertexCount === 0 && drawing.has(state.mode)
      && (text === null || text.text === '' && text.style === undefined);
    return (empty || previewOnly.has(state.mode)) && this.available(tool, state);
  }

  private pressed(tool: ToolbarTool, state: EditorState): boolean {
    if (tool === 'geofencing') return this.editor.getGeofencing().enabled;
    if (tool === 'guides') return this.editor.getAlignmentGuides().enabled;
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
    let templateId: string | undefined;
    if (tool === 'template' && state.mode !== 'draw-template' && this.templatePicker) {
      const templates = this.editor.getShapeTemplates();
      const choice = this.templatePicker(templates, this.editor);
      if (choice === null) return;
      if (!templates.some(template => template.id === choice)) throw new RangeError(`Unknown shape template: ${String(choice)}`);
      templateId = choice;
    }
    if ((group === 'draw' || group === 'edit') && state.mode !== 'idle') {
      const active = modeTools[state.mode] === tool;
      this.editor.cancel();
      if (active) return;
    }
    if (tool === 'template' && templateId !== undefined) this.editor.drawTemplate(templateId);
    else runTool(this.editor, tool, this.duplicateOffset());
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

  private changeText(patch: Partial<TextMarkerOptions>): void {
    try { this.editor.setTextMarker(patch); this.textInvalid = false; }
    catch { this.textInvalid = true; }
    this.update();
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
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
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
    const target = buttons[next]!;
    target.focus({ preventScroll: true });
    this.reveal(target);
  };

  /** Enabled, visible buttons in order, including the collapse toggle. */
  private navigable(): HTMLButtonElement[] {
    return [...this.root.querySelectorAll<HTMLButtonElement>('.mm-toolbar-button')].filter((button) => !button.disabled && !button.closest('[hidden]'));
  }

  private update(): void {
    const state = this.editor.getState();
    const active = modeTools[state.mode] ?? null;
    this.geofenceNotice.hidden = state.geofencingViolations.length === 0;
    const explanations = { 'outside-allowed-area': 'outsideAllowed', 'intersects-excluded-area': 'intersectsExcluded', 'inside-excluded-area': 'insideExcluded', 'geofencing-calculation-failed': 'geofencingFailed' } as const;
    this.geofenceNotice.textContent = state.geofencingViolations.map(violation => `${this.labels[explanations[violation.code]]} (${violation.areaIds.join(', ')})`).join(' ');
    const text = this.editor.getTextMarkerDraft();
    const template = this.editor.getTemplateDraft();
    this.templateControls.render(template);
    if (this.fieldMode !== state.mode) { this.fieldMode = state.mode; this.fieldInvalid = false; this.textInvalid = false; }
    this.root.classList.toggle('mm-toolbar--end', this.root.closest('.maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right, .mapboxgl-ctrl-top-right, .mapboxgl-ctrl-bottom-right') !== null);

    if (this.toggle) {
      const label = this.labels[this.collapsed ? 'expand' : 'collapse'];
      this.toggle.setAttribute('aria-label', label);
      this.toggle.dataset.tooltip = label;
      this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
      for (const group of this.root.querySelectorAll<HTMLElement>('.mm-toolbar-group:not([data-toggle])')) group.hidden = this.collapsed;
    }
    for (const [tool, button] of this.buttons) {
      this.shortcutHint(button, tool, this.labels[tool]);
      button.disabled = !this.enabled(tool, state);
      if ((tool === 'undo' || tool === 'redo') && button.disabled) {
        const layers = this.editor.getHistoryDataLayerIssues(tool);
        if (layers.length) {
          button.dataset.tooltip += ` · ${this.labels.layerHistoryBlocked} (${[...new Set(layers.map(issue => issue.layerId))].join(', ')})`;
          button.title = button.dataset.tooltip ?? this.labels[tool];
        }
        const blocked = this.editor.getHistoryGeofencingViolations(tool);
        if (blocked.length) {
          button.dataset.tooltip += ` · ${blocked.map(violation => `${this.labels[explanations[violation.code]]} (${violation.areaIds.join(', ')})`).join(' ')}`;
          button.title = button.dataset.tooltip ?? this.labels[tool];
        }
      }
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
    if (this.root.isConnected) {
      if (anchor && active !== this.lastActive) this.reveal(anchor);
      this.lastActive = active;
    }
    this.actions.hidden = anchor === undefined;
    const noticeHost = anchor ? this.actions : this.root;
    if (this.geofenceNotice.parentElement !== noticeHost) noticeHost.append(this.geofenceNotice);
    if (anchor === undefined) { this.layout(); return; }
    this.actions.dataset.mode = state.mode;

    this.textFields.hidden = text === null;
    this.actions.dataset.text = String(text !== null);
    if (text) {
      const root = this.root.getRootNode() as Document | ShadowRoot;
      if (root.activeElement !== this.textInput) this.textInput.value = text.text;
      const style = { ...defaultTextMarkerStyle, ...text.style };
      for (const [key, input] of this.textStyleInputs) {
        if (root.activeElement === input) continue;
        let value = String(style[key as keyof typeof style]);
        if (input instanceof HTMLInputElement && input.type === 'color' && value.length === 4) value = '#' + [...value.slice(1)].map(char => char + char).join('');
        input.value = value;
      }
      this.textInput.setAttribute('aria-invalid', String(!text.text.trim()));
      this.textStyleInputs.get('fontSize')!.setAttribute('aria-invalid', String(this.textInvalid));
    }
    const field = fields[state.mode];
    this.lassoFields.hidden = state.mode !== 'select-lasso';
    this.lassoWarning.hidden = state.mode !== 'select-lasso' || state.validationError === null;
    if (state.mode === 'select-lasso') {
      const options = this.editor.getLassoOptions()!;
      this.lassoOperation.value = options.operation; this.lassoMatch.value = options.match;
    }
    this.holeField.hidden = state.mode !== 'remove-hole';
    this.holeWarning.hidden = state.mode !== 'remove-hole' || state.validationError === null;
    if (state.mode === 'remove-hole') {
      if (this.holeOptionsKey !== this.selection.key) {
        this.holeSelect.replaceChildren();
        for (const [partIndex, part] of geometryParts(this.selected(state)[0]!.geometry).entries()) {
          if (part.type !== 'Polygon') continue;
          for (let ringIndex = 1; ringIndex < part.coordinates.length; ringIndex++) {
            const option = document.createElement('option');
            option.value = `${partIndex}:${ringIndex}`;
            option.textContent = `${this.labels.partNumber} ${partIndex + 1} · ${this.labels.holeNumber} ${ringIndex}`;
            this.holeSelect.append(option);
          }
        }
        this.holeOptionsKey = this.selection.key;
      }
      this.holeSelect.value = `${state.activePartIndex}:${state.activeRingIndex}`;
      this.holeSelect.setAttribute('aria-invalid', String(state.validationError !== null));
    }
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

    this.pinWarning.hidden = state.pinningError === null;
    this.primary.hidden = selfFinishing.has(state.mode);
    this.primary.textContent = this.labels[state.mode === 'draw-cut' ? 'apply' : state.mode.startsWith('draw-') ? 'finish' : state.mode.startsWith('edit-') ? 'save' : 'apply'];
    this.primary.disabled = !state.canFinish || this.fieldInvalid || this.textInvalid || !this.templateControls.valid;
    this.shortcutHint(this.primary, 'finish', this.primary.textContent);
    this.shortcutHint(this.cancel, 'cancel', this.labels.cancel);
    this.shortcutHint(this.removeLast, 'delete', this.labels.removeLastPoint);
    this.removeLast.hidden = !removable.has(state.mode);
    this.removeLast.disabled = state.vertexCount === 0;
    this.layout();
  }

  private readonly layout = (): void => {
    if (!this.map || !this.root.isConnected) return;
    const canvas = this.map.getCanvas();
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    this.column.style.maxHeight = `${controlHeight(this.root, canvas)}px`;
    const end = this.root.classList.contains('mm-toolbar--end');
    if (!this.actions.hidden) {
      const tool = modeTools[this.editor.getState().mode];
      const anchor = tool && this.buttons.get(tool);
      if (anchor) fitControlPanel(this.actions, this.root, canvas, anchor, end);
    }
    if (!this.geofenceNotice.hidden && this.geofenceNotice.parentElement === this.root) {
      fitControlPanel(this.geofenceNotice, this.root, canvas, this.column, end);
    }
    if (this.tooltipAnchor && !this.tooltip.hidden) {
      if (!this.tooltipAnchor.checkVisibility() || this.tooltipAnchor.dataset.active === 'true') this.tooltip.hidden = true;
      else fitControlPanel(this.tooltip, this.root, canvas, this.tooltipAnchor, end);
    }
  };

  private reveal(button: HTMLButtonElement): void {
    const frame = this.column.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const scale = frame.height / this.column.offsetHeight || 1;
    this.column.scrollTop += (Math.min(0, rect.top - frame.top) + Math.max(0, rect.bottom - frame.bottom)) / scale;
  }

  private readonly showTooltip = (event: Event): void => {
    const button = event.target instanceof Element ? event.target.closest('.mm-toolbar-button') : null;
    if (!(button instanceof HTMLButtonElement) || button.dataset.active === 'true' || !button.dataset.tooltip) return;
    this.tooltipAnchor = button;
    this.tooltip.textContent = button.dataset.tooltip;
    this.tooltip.hidden = false;
    this.layout();
  };

  private readonly hideTooltip = (event: Event): void => {
    const next = event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null;
    if (next instanceof Node && this.tooltipAnchor?.contains(next)) return;
    this.tooltipAnchor = null;
    this.tooltip.hidden = true;
  };

  private shortcutHint(button: HTMLButtonElement, action: import('../core/keyboard-shortcuts.js').KeyboardAction, label: string): void {
    const shortcut = this.editor.getKeyboardShortcutLabel(action);
    const aria = this.editor.getKeyboardShortcutAria(action);
    button.dataset.tooltip = shortcut ? `${label} (${shortcut})` : label;
    button.title = button.dataset.tooltip;
    if (aria) button.setAttribute('aria-keyshortcuts', aria);
    else button.removeAttribute('aria-keyshortcuts');
  }
}
