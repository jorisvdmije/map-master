import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Coordinate, DrawingConstraintsOptions, TransactionEvent, SnappingOptions, SnapResult, FeatureId, EditorState, EditorOptions, HistoryEvent, GeometryFeature, LineCollection, LineFeature } from '../core/types.js';
import { GeometryEditor } from './geometry-editor.js';

const isLine = (feature: GeometryFeature): feature is LineFeature => feature.geometry.type === 'LineString';

/** Compatibility facade for the first milestone. Use GeometryEditor for new integrations. */
export class LineEditor {
  private readonly editor: GeometryEditor;

  constructor(map: MapLibreMap, options: EditorOptions = {}) { this.editor = new GeometryEditor(map, options); }

  getDrawingConstraints(): DrawingConstraintsOptions { return this.editor.getDrawingConstraints(); }
  setDrawingConstraints(options: Partial<DrawingConstraintsOptions>): void { this.editor.setDrawingConstraints(options); }
  getSnapping(): SnappingOptions { return this.editor.getSnapping(); }
  setSnapping(options: Partial<SnappingOptions>): void { this.editor.setSnapping(options); }
  getSnap(): SnapResult | null { return this.editor.getSnap(); }
  onSnap(listener: (result: SnapResult | null) => void): () => void { return this.editor.onSnap(listener); }
  startLine(): void { this.editor.draw('LineString'); }
  cancel(): void { this.editor.cancel(); }
  destroy(): void { this.editor.destroy(); }
  undo(): boolean { return this.editor.undo(); }
  redo(): boolean { return this.editor.redo(); }
  clearHistory(): void { this.editor.clearHistory(); }
  onHistory(listener: (event: HistoryEvent) => void): () => void { return this.editor.onHistory(listener); }
  getState(): EditorState { return this.editor.getState(); }
  select(id: FeatureId | null): void { this.editor.select(id); }
  selectMany(ids: readonly FeatureId[]): void { this.editor.selectMany(ids); }
  toggleSelection(id: FeatureId): void { this.editor.toggleSelection(id); }
  getSelection(): LineFeature[] { return this.editor.getSelection().filter(isLine); }
  deleteSelection(): TransactionEvent | null { return this.editor.deleteSelection(); }
  translateSelection(delta: Coordinate): TransactionEvent | null { return this.editor.translateSelection(delta); }
  duplicateSelection(delta: Coordinate = [0, 0]): TransactionEvent | null { return this.editor.duplicateSelection(delta); }
  onTransaction(listener: (event: TransactionEvent) => void): () => void { return this.editor.onTransaction(listener); }
  editSelected(): boolean { return this.editor.editSelected(); }
  getDraft(): Coordinate[] { return this.editor.getDraft(); }
  selectVertex(index: number | null): void { this.editor.selectVertex(index); }
  moveVertex(index: number, coordinate: Coordinate): void { this.editor.moveVertex(index, coordinate); }
  insertVertex(index: number, coordinate: Coordinate): void { this.editor.insertVertex(index, coordinate); }
  removeVertex(index: number): boolean { return this.editor.removeVertex(index); }
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

  onUpdate(listener: (feature: LineFeature) => void): () => void {
    return this.editor.onUpdate((feature) => { if (isLine(feature)) listener(feature); });
  }

  onChange(listener: (state: EditorState) => void): () => void {
    return this.editor.onChange(listener);
  }
}
