import assert from 'node:assert/strict';
import * as editor from '@geo/editor';

assert.equal(typeof editor, 'object');

// Consumers must use the public entry point rather than build internals.
await assert.rejects(import('@geo/editor/dist/index.js'), {
  code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
});
