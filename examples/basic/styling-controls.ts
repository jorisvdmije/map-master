import type { GeometryEditor, EditorStylingOptions, FeatureStyleResolver } from '@jorisvdmije/map-master';
import type { Map as MapLibreMap } from 'maplibre-gl';

/** These property names belong to this demo. The library does not interpret them. */
const styleFeature: FeatureStyleResolver = feature => {
  const color = feature.properties?.demoColor;
  const order = feature.properties?.demoOrder;
  return {
    ...(typeof color === 'string' ? { shape: { fillColor: color, lineColor: color, fillOpacity: 0.35 }, marker: { color } } : {}),
    ...(typeof order === 'number' ? { sortKey: order } : {}),
  };
};

export function bindStylingControls(editor: GeometryEditor, map: MapLibreMap, root: HTMLElement): () => void {
  const input = (name: string) => root.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const mode = root.querySelector<HTMLSelectElement>('[name="overlap-mode"]')!;
  const direction = root.querySelector<HTMLSelectElement>('[name="stripe-direction"]')!;
  const message = root.querySelector<HTMLElement>('[data-style-message]')!;
  const selection = root.querySelector<HTMLElement>('[data-style-selection]')!;
  const configure = (): void => {
    const options: EditorStylingOptions = {
      ...(input('object-colors').checked ? { feature: styleFeature, selected: { shape: { lineColor: '#2563eb', lineWidth: 6 }, marker: { strokeColor: '#2563eb', strokeWidth: 3 } } } : {}),
      overlap: { enabled: mode.value !== 'off', stripeWidth: Number(input('stripe-width').value), opacity: Number(input('stripe-opacity').value),
        direction: direction.value as 'ascending' | 'descending',
        ...(mode.value === 'custom' ? { palette: [input('stripe-a').value, input('stripe-b').value] } : {}) },
    };
    editor.setStyling(options);
  };
  const update = (): void => {
    const state = editor.getState(); const features = editor.getSelection();
    const canChange = state.mode === 'idle' && features.length > 0 && !features.some(feature => editor.isFeatureLocked(feature.id));
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-style-action]')) button.disabled = button.dataset.styleAction === 'example' ? state.mode !== 'idle' : !canChange;
    selection.textContent = features.length ? `${features.length} selected · color and order changes can be undone` : 'Select shapes to set their color and drawing order.';
    if (features.length === 1 && !root.contains(document.activeElement)) {
      const color = features[0]!.properties?.demoColor; const order = features[0]!.properties?.demoOrder;
      if (typeof color === 'string' && /^#[a-f\d]{6}$/iu.test(color)) input('object-color').value = color;
      input('object-order').value = typeof order === 'number' ? String(order) : '0';
    }
    root.querySelector<HTMLElement>('[data-custom-palette]')!.hidden = mode.value !== 'custom';
    message.textContent = editor.getStylingIssues().length ? 'Some styles could not be displayed. Standard colors are shown for those shapes.'
      : state.mode !== 'idle' && mode.value !== 'off' ? 'New overlap is calculated when changes are saved.' : 'Stripes show the colors of every shape in an overlap. Selection keeps those colors visible.';
  };
  const change = (event: Event): void => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
    if (['object-color', 'object-order'].includes(event.target.name)) return;
    configure();
  };
  const action = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-style-action]');
    if (!button || button.disabled) return;
    if (button.dataset.styleAction === 'example') {
      input('object-colors').checked = true; mode.value = 'auto'; configure();
      const [x, y] = map.getCenter().toArray();
      const colors = ['#1b998b', '#ed8b34', '#7764c0'];
      const created = editor.importGeoJSON({ type: 'FeatureCollection', features: colors.map((color, index) => {
        const left = x - 0.005 + index * 0.0025; const bottom = y - 0.002 + (index === 1 ? -0.0015 : 0.0005 * index);
        return { type: 'Feature', properties: { name: ['Meadow', 'Housing', 'Water'][index], demoColor: color, demoOrder: index },
          geometry: { type: 'Polygon', coordinates: [[[left, bottom], [left + 0.007, bottom], [left + 0.007, bottom + 0.004], [left, bottom + 0.004], [left, bottom]]] } };
      }) });
      editor.selectMany(created.features.map(feature => feature.id));
      map.fitBounds([[x - 0.006, y - 0.004], [x + 0.008, y + 0.004]], { padding: Math.min(65, map.getCanvas().clientWidth / 8, map.getCanvas().clientHeight / 8), duration: 0 });
      return;
    }
    const order = input('object-order').valueAsNumber;
    if (!Number.isFinite(order)) { input('object-order').reportValidity(); return; }
    input('object-colors').checked = true; configure();
    editor.applyTransaction({ update: editor.getSelection().map(feature => {
      const properties = { ...feature.properties };
      if (button.dataset.styleAction === 'reset') { delete properties.demoColor; delete properties.demoOrder; }
      else { properties.demoColor = input('object-color').value; properties.demoOrder = order; }
      return { ...feature, properties };
    }) });
  };
  root.addEventListener('change', change); root.addEventListener('click', action);
  const unsubscribe = editor.onChange(update); update();
  return () => { root.removeEventListener('change', change); root.removeEventListener('click', action); unsubscribe(); };
}
