import * as editor from '@geo/editor';
import type { Map } from 'maplibre-gl';

// A strict consumer must resolve the shipped declarations, with no source alias.
const publicApi: typeof import('@geo/editor') = editor;
void publicApi;

export function integrateGeometry(map: Map): editor.GeometryFeatureCollection {
  const tool = new editor.GeometryEditor(map);
  tool.draw('Polygon');
  tool.onCreate((feature) => {
    if (feature.geometry.type === 'Polygon') {
      const rings: editor.Coordinate[][] = feature.geometry.coordinates;
      void rings;
    }
  });
  tool.onChange((state) => {
    const error: editor.ValidationError | null = state.validationError;
    const selectedId: string | null = state.selectedFeatureId;
    void [error, selectedId];
  });
  // @ts-expect-error unsupported geometry must be rejected by the public types
  tool.draw('Circle');
  tool.cancel();
  tool.select(null);
  const selected: editor.GeometryFeature | null = tool.getSelected();
  void selected;
  const result = tool.exportGeoJSON();
  tool.destroy();
  return result;
}

// Compile the real public API against a host-supplied MapLibre map.
export function integrate(map: Map): editor.LineCollection {
  const tool = new editor.LineEditor(map);
  tool.startLine();
  const selected: editor.LineFeature | null = tool.getSelected();
  void selected;
  tool.onCreate((feature) => {
    const id: string = feature.id;
    const type: 'LineString' = feature.geometry.type;
    void [id, type];
  });
  const result = tool.exportGeoJSON();
  tool.destroy();
  return result;
}
