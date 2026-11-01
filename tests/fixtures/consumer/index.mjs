import assert from 'node:assert/strict';
import * as editor from '@jorisvdmije/map-master';
import * as mapbox from '@jorisvdmije/map-master/mapbox';
import * as maplibre from '@jorisvdmije/map-master/maplibre';
import { createRequire } from 'node:module';

assert.equal(mapbox.GeometryEditor, editor.GeometryEditor);
assert.equal(maplibre.GeometryEditor, editor.GeometryEditor);
// Optional Mapbox support must not install it in a MapLibre application.
assert.throws(() => createRequire(import.meta.url).resolve('mapbox-gl'), { code: 'MODULE_NOT_FOUND' });

assert.equal(typeof editor, 'object');
assert.equal(typeof editor.LineEditor, 'function');
assert.equal(typeof editor.GeometryEditor, 'function');
assert.equal(typeof editor.EditorToolbar, 'function');
assert.deepEqual(editor.EditorToolbar.defaultTools.slice(0, 3), ['point', 'line', 'polygon']);
assert.equal(editor.formatDistance(editor.measure({ type: 'LineString', coordinates: [[0, 0], [0, 1]] }).length), '111 km');

// Consumers must use the public entry point rather than build internals.
await assert.rejects(import('@jorisvdmije/map-master/dist/index.js'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
});

// Tooling may read the manifest through the explicit package.json export.
const { default: manifest } = await import('@jorisvdmije/map-master/package.json', { with: { type: 'json' } });
assert.equal(manifest.name, '@jorisvdmije/map-master');
