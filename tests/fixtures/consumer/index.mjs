import assert from 'node:assert/strict';
import * as editor from '@jorisvdmije/map-master';

assert.equal(typeof editor, 'object');
assert.equal(typeof editor.LineEditor, 'function');
assert.equal(typeof editor.GeometryEditor, 'function');

// Consumers must use the public entry point rather than build internals.
await assert.rejects(import('@jorisvdmije/map-master/dist/index.js'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
});
