import type { GeometryEditor, GeometryFeature } from '@jorisvdmije/map-master';

const format = (value: number) => String(Number(value.toPrecision(6)));
function paths(feature: GeometryFeature): number[][][] {
  const geometry = feature.geometry;
  switch (geometry.type) {
    case 'Point': return [[geometry.coordinates]];
    case 'LineString': return [geometry.coordinates];
    case 'Polygon': case 'MultiLineString': return geometry.coordinates;
    case 'MultiPolygon': return geometry.coordinates.flat();
  }
}
function count(features: GeometryFeature[]): number {
  return features.reduce((total, feature) => total + paths(feature).reduce((sum, path) =>
    sum + path.length - (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon' ? 1 : 0), 0), 0);
}
function initialMaximum(features: GeometryFeature[]): number {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const feature of features) for (const path of paths(feature)) for (const [lng, lat] of path) {
    const x = 6378137 * lng! * Math.PI / 180;
    const y = 6378137 * Math.asinh(Math.tan(lat! * Math.PI / 180));
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return Math.max(1, Math.hypot(maxX - minX, maxY - minY) / 10);
}

/** Demo controls; geometry validation/history remain exclusively in the editor. */
export class SimplificationControls {
  private readonly field: HTMLInputElement;
  private readonly slider: HTMLInputElement;
  private readonly range: HTMLElement;
  private readonly total: HTMLElement;
  private readonly reduction: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly view: Window;
  private readonly events = new AbortController();
  private active = false;
  private originalCount = 0;
  private maximum = 1;
  private pending: number | undefined;
  private frame: number | undefined;

  constructor(private readonly editor: GeometryEditor, private readonly root: HTMLElement, private readonly validity: (valid: boolean) => void) {
    this.field = root.querySelector<HTMLInputElement>('#simplification-tolerance')!;
    this.slider = root.querySelector<HTMLInputElement>('#simplification-slider')!;
    this.range = root.querySelector('#simplification-range')!;
    this.total = root.querySelector('#simplification-count')!;
    this.reduction = root.querySelector('#simplification-reduction')!;
    this.feedback = root.querySelector('#simplification-feedback')!;
    this.view = root.ownerDocument.defaultView!;
    const options = { signal: this.events.signal };
    this.field.addEventListener('input', () => {
      this.dropPending();
      const value = this.field.valueAsNumber;
      const valid = Number.isFinite(value) && value >= 0;
      this.field.setCustomValidity(valid ? '' : 'Enter a nonnegative tolerance.');
      if (!valid || !this.editor.setSimplificationTolerance(value)) this.update();
    }, options);
    this.field.addEventListener('blur', () => {
      this.field.setCustomValidity('');
      this.field.value = String(this.editor.getState().simplificationTolerance ?? 0);
      this.update();
    }, options);
    this.slider.addEventListener('input', () => {
      if (!this.active) return;
      const value = this.slider.valueAsNumber;
      this.field.setCustomValidity(''); this.field.value = String(value);
      this.slider.setAttribute('aria-valuetext', `${format(value)} Mercator meters`);
      this.pending = value; this.validity(false);
      this.feedback.textContent = 'Updating preview…';
      if (this.frame === undefined) this.frame = this.view.requestAnimationFrame(() => { this.frame = undefined; this.flush(); });
    }, options);
    this.slider.addEventListener('change', () => { this.flush(); }, options);
    this.slider.addEventListener('keydown', event => {
      if (!this.active || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); this.dropPending(); this.editor.cancel(); return; }
      if (event.key === 'Enter') {
        event.preventDefault(); this.flush();
        if (this.editor.getState().canFinish) this.editor.finishSimplification();
        return;
      }
      const current = this.pending ?? this.editor.getState().simplificationTolerance!;
      const step = this.maximum / (event.shiftKey ? 100 : 1000);
      const value = event.key === 'Home' ? 0 : event.key === 'End' ? this.maximum
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + step
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - step
        : event.key === 'PageUp' ? current + this.maximum / 10
        : event.key === 'PageDown' ? current - this.maximum / 10 : null;
      if (value === null) return;
      event.preventDefault(); this.dropPending(); this.field.setCustomValidity('');
      if (!this.editor.setSimplificationTolerance(Math.min(this.maximum, Math.max(0, value)))) this.update();
    }, options);
  }

  update(): void {
    const state = this.editor.getState();
    this.dropPending(); // An external API/state change takes precedence over queued input.
    this.root.hidden = state.mode !== 'simplify-features';
    if (this.root.hidden) {
      this.active = false; this.field.setCustomValidity(''); this.field.value = '0'; this.slider.value = '0';
      this.total.textContent = ''; this.reduction.textContent = ''; this.feedback.textContent = ''; return;
    }
    if (!this.active) {
      const originals = this.editor.getSelection(); this.originalCount = count(originals);
      this.maximum = initialMaximum(originals); this.active = true;
    }
    const tolerance = state.simplificationTolerance!;
    this.maximum = Math.max(this.maximum, tolerance);
    this.slider.max = String(this.maximum); this.slider.value = String(tolerance);
    this.slider.setAttribute('aria-valuetext', `${format(tolerance)} Mercator meters`);
    this.range.textContent = `0 – ${format(this.maximum)} Mercator m`;
    if (this.root.ownerDocument.activeElement !== this.field) this.field.value = String(tolerance);
    const preview = this.editor.getSimplificationPreview(); const remaining = preview ? count(preview.features) : null;
    this.total.textContent = `${this.originalCount} → ${remaining ?? '—'} vertices`;
    this.reduction.textContent = remaining === null ? 'No valid preview' : `${format(100 * (this.originalCount - remaining) / Math.max(1, this.originalCount))}% fewer vertices`;
    const valid = this.field.validity.valid && state.canFinish;
    this.feedback.classList.toggle('is-invalid', !valid);
    this.feedback.textContent = !this.field.validity.valid ? 'Enter a nonnegative tolerance. The last preview is retained.'
      : !preview ? 'Invalid result. Lower the tolerance; the original geometry is shown.'
      : `Preview at ${format(tolerance)} Mercator m. Apply saves; Undo restores the original.`;
    this.validity(valid);
  }

  private flush(): void {
    const value = this.pending; this.dropPending();
    if (value !== undefined && this.editor.getState().mode === 'simplify-features') {
      if (!this.editor.setSimplificationTolerance(value)) this.update();
    }
  }
  private dropPending(): void {
    if (this.frame !== undefined) this.view.cancelAnimationFrame(this.frame);
    this.frame = undefined; this.pending = undefined;
  }
  destroy(): void { this.dropPending(); this.events.abort(); }
}
