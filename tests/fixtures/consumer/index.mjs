import assert from 'node:assert/strict';
import * as editor from '@jorisvdmije/map-master';

assert.equal(typeof editor, 'object');
assert.equal(typeof editor.LineEditor, 'function');
assert.equal(typeof editor.GeometryEditor, 'function');

// Consumers must use the public entry point rather than build internals.
await assert.rejects(import('@jorisvdmije/map-master/dist/index.js'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
});

// Tooling may read the manifest through the explicit package.json export.
const { default: manifest } = await import('@jorisvdmije/map-master/package.json', { with: { type: 'json' } });
assert.equal(manifest.name, '@jorisvdmije/map-master');
