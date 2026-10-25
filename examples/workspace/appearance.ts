import type { EditorAppearance, GeometryEditor } from '@geo/editor';

/** Host-owned presets: the library exposes settings, not a theme registry or toolbar. */
export function bindAppearanceControl(editor: GeometryEditor, control: HTMLSelectElement): () => void {
  const original = editor.getAppearance();
  const presets: Record<string, EditorAppearance> = {
    default: original,
    ocean: {
      ...original,
      feature: { ...original.feature, lineColor: '#0369a1', fillColor: '#38bdf8', fillOpacity: 0.25 },
      selected: { ...original.selected, lineColor: '#6d28d9', fillColor: '#a78bfa' },
      draft: { ...original.draft, lineColor: '#0f766e', fillColor: '#2dd4bf', secondaryFillColor: '#f59e0b' },
      vertex: { ...original.vertex, strokeColor: '#0f766e', activeColor: '#0f766e' },
      midpoint: { ...original.midpoint, strokeColor: '#0f766e' },
      snap: { ...original.snap, color: '#be123c' },
    },
    contrast: {
      ...original,
      feature: { ...original.feature, lineColor: '#171717', lineWidth: 5, fillColor: '#facc15', fillOpacity: 0.3 },
      selected: { ...original.selected, lineColor: '#7e22ce', lineWidth: 8, fillColor: '#c084fc', fillOpacity: 0.4 },
      draft: { ...original.draft, lineColor: '#b91c1c', lineWidth: 5, fillColor: '#fca5a5', secondaryFillColor: '#38bdf8' },
      vertex: { ...original.vertex, radius: 7, activeRadius: 9, strokeColor: '#171717', strokeWidth: 3, activeColor: '#facc15', lockedColor: '#737373' },
      midpoint: { ...original.midpoint, radius: 5, strokeColor: '#171717', strokeWidth: 2 },
      snap: { ...original.snap, color: '#1d4ed8', opacity: 1 },
    },
  };
  const change = () => { editor.setAppearance(presets[control.value] ?? original); };
  control.value = 'default'; control.disabled = false;
  control.addEventListener('change', change);
  return () => { control.removeEventListener('change', change); control.disabled = true; };
}
