import type { Map as MapLibreMap } from 'maplibre-gl';
import type { EditorState, GeometryFeature, LineCollection, LineFeature } from '../core/types.js';
import { GeometryEditor } from './geometry-editor.js';

const isLine = (feature: GeometryFeature): feature is LineFeature => feature.geometry.type === 'LineString';

/** Compatibility facade for the first milestone. Use GeometryEditor for new integrations. */
export class LineEditor {
  private readonly editor: GeometryEditor;

  constructor(map: MapLibreMap) { this.editor = new GeometryEditor(map); }

  startLine(): void { this.editor.draw('LineString'); }
  cancel(): void { this.editor.cancel(); }
  destroy(): void { this.editor.destroy(); }
  getState(): EditorState { return this.editor.getState(); }
  select(id: string | null): void { this.editor.select(id); }
  getSelected(): LineFeature | null {
    const feature = this.editor.getSelected();
    return feature && isLine(feature) ? feature : null;
  }

  finish(): LineFeature | null {
    const feature = this.editor.finish();
    return feature && isLine(feature) ? feature : null;
  }

  deleteSelected(): LineFeature | null {
    const feature = this.editor.deleteSelected();
    return feature && isLine(feature) ? feature : null;
  }

  exportGeoJSON(): LineCollection {
    return { type: 'FeatureCollection', features: this.editor.exportGeoJSON().features.filter(isLine) };
  }

  onCreate(listener: (feature: LineFeature) => void): () => void {
    return this.editor.onCreate((feature) => { if (isLine(feature)) listener(feature); });
  }

  onDelete(listener: (feature: LineFeature) => void): () => void {
    return this.editor.onDelete((feature) => { if (isLine(feature)) listener(feature); });
  }

  onChange(listener: (state: EditorState) => void): () => void {
    return this.editor.onChange(listener);
  }
}
