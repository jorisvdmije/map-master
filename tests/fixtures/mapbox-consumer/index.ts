import type { Map, FitBoundsOptions } from 'mapbox-gl';
import { GeometryEditor, EditorToolbar, DataLayerControl, type GeometryFeatureCollection, type EditorOptions } from '@jorisvdmije/map-master/mapbox';

export function integrateMapbox(map: Map, options: EditorOptions): GeometryFeatureCollection {
  const editor = new GeometryEditor(map, options);
  const toolbar = new EditorToolbar(editor, { tools: ['polygon', 'lasso', 'text', 'undo', 'redo'] });
  const layers = new DataLayerControl(editor);
  map.addControl(toolbar, 'top-left'); map.addControl(layers, 'top-right');
  const camera: FitBoundsOptions = { padding: 50, duration: 0, offset: [2, 3] };
  editor.zoomToFeatures(undefined, camera);
  editor.draw('Polygon'); editor.cancel();
  editor.setKeyboardShortcuts({ polygon: [{ key: 'p' }] });
  editor.addDataLayer({ id: 'parcels' }); editor.setActiveDataLayer('parcels');
  const result = editor.exportGeoJSON();
  // @ts-expect-error drawing types remain checked through the Mapbox entry point
  editor.draw('Unknown');
  map.removeControl(toolbar); map.removeControl(layers); editor.destroy();
  return result;
}
