import type { GeometryEditor } from './geometry-editor.js';
import type { TemplateDraft } from '../core/shape-templates.js';

export type TemplateLabelKey = 'templateChoice' | 'templateSize' | 'templateRotation'
  | 'templateLongitude' | 'templateLatitude' | 'templateInvalid';

/** Toolbar-owned inputs; host applications can instead use their own picker and the public placement API. */
export class TemplateControls {
  readonly root = document.createElement('div');
  private readonly select = document.createElement('select');
  private readonly inputs = new Map<'size' | 'rotation' | 'longitude' | 'latitude', HTMLInputElement>();
  private readonly warning = document.createElement('span');
  private optionsKey = '';
  private invalid = false;

  constructor(private readonly editor: GeometryEditor, labels: Record<TemplateLabelKey, string>, onChange: () => void, key: (event: KeyboardEvent) => void) {
    this.root.className = 'mm-toolbar-template';
    const field = (label: string, input: HTMLElement): void => {
      const element = document.createElement('label'); element.className = 'mm-toolbar-field';
      const name = document.createElement('span'); name.textContent = label;
      element.append(name, input); this.root.append(element);
    };
    this.select.dataset.template = 'templateId';
    this.select.setAttribute('aria-label', labels.templateChoice);
    field(labels.templateChoice, this.select);
    this.select.addEventListener('change', () => {
      this.editor.setTemplatePlacement({ templateId: this.select.value }); onChange();
    });
    this.select.addEventListener('keydown', key);
    for (const [name, label] of [['size', 'templateSize'], ['rotation', 'templateRotation'], ['longitude', 'templateLongitude'], ['latitude', 'templateLatitude']] as const) {
      const input = document.createElement('input'); input.type = 'number'; input.dataset.template = name;
      input.step = name === 'size' ? '10' : name === 'rotation' ? '1' : 'any';
      if (name === 'size') input.min = '0';
      if (name === 'longitude' || name === 'latitude') { const limit = name === 'longitude' ? 180 : 90; input.min = String(-limit); input.max = String(limit); }
      this.inputs.set(name, input); field(labels[label], input);
      input.addEventListener('input', () => { this.write(); onChange(); });
      input.addEventListener('keydown', key);
    }
    this.warning.className = 'mm-toolbar-template-notice'; this.warning.setAttribute('role', 'status');
    this.warning.textContent = labels.templateInvalid; this.root.append(this.warning);
  }

  get valid(): boolean { return !this.invalid; }

  private write(): void {
    const size = this.inputs.get('size')!.valueAsNumber; const rotation = this.inputs.get('rotation')!.valueAsNumber;
    const longitude = this.inputs.get('longitude')!; const latitude = this.inputs.get('latitude')!;
    this.invalid = false;
    try {
      const patch: Partial<TemplateDraft> = { size, rotation };
      if (longitude.value !== '' || latitude.value !== '') patch.position = [longitude.valueAsNumber, latitude.valueAsNumber];
      else patch.position = null;
      this.editor.setTemplatePlacement(patch);
    } catch { this.invalid = true; }
  }

  render(draft: TemplateDraft | null): void {
    this.root.hidden = draft === null;
    if (!draft) { this.invalid = false; return; }
    const definitions = this.editor.getShapeTemplates();
    const key = JSON.stringify(definitions.map(({ id, label }) => [id, label]));
    if (key !== this.optionsKey) {
      this.optionsKey = key; this.select.replaceChildren();
      for (const template of definitions) {
        const option = document.createElement('option'); option.value = template.id; option.textContent = template.label; this.select.append(option);
      }
    }
    this.select.value = draft.templateId;
    const values = { size: draft.size, rotation: draft.rotation, longitude: draft.position?.[0] ?? null, latitude: draft.position?.[1] ?? null };
    // Keep all partially typed fields while a patch is invalid, including an incomplete coordinate pair.
    if (!this.invalid) for (const [name, input] of this.inputs) {
      if ((this.root.getRootNode() as Document | ShadowRoot).activeElement !== input) input.value = values[name] === null ? '' : String(values[name]);
    }
    for (const input of this.inputs.values()) input.setAttribute('aria-invalid', String(this.invalid));
    this.warning.hidden = !this.invalid && this.editor.getState().templateError === null;
  }
}
