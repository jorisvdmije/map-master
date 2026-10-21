import * as editor from '@geo/editor';
import type { Map } from 'maplibre-gl';

// A strict consumer must resolve the shipped declarations, with no source alias.
const publicApi: typeof import('@geo/editor') = editor;
void publicApi;

// Compile the real public API against a host-supplied MapLibre map.
export function integrate(map: Map): editor.LineCollection {
  const tool = new editor.LineEditor(map);
  tool.startLine();
  tool.onCreate((feature) => {
    const id: string = feature.id;
    const type: 'LineString' = feature.geometry.type;
    void [id, type];
  });
  const result = tool.exportGeoJSON();
  tool.destroy();
  return result;
}
