import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as mapbox from '@jorisvdmije/map-master/mapbox';
import * as root from '@jorisvdmije/map-master';

assert.equal(mapbox.GeometryEditor, root.GeometryEditor);
assert.equal(typeof mapbox.EditorToolbar, 'function');
assert.equal(typeof mapbox.DataLayerControl, 'function');
assert.equal(mapbox.measure({ type: 'Point', coordinates: [4, 52] }).length, 0);
assert.throws(() => createRequire(import.meta.url).resolve('maplibre-gl'), { code: 'MODULE_NOT_FOUND' });
