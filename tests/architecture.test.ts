import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint({
  // lintText replaces the same project files repeatedly. CI's single-run
  // optimization can instead read their on-disk contents on the first call.
  overrideConfig: {
    languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
  },
});

it.each([
  ['src/core/types.ts', "import type { Map } from 'maplibre-gl'; export type Host = Map;"],
  ['src/core/types.ts', "export { GeometryEditor } from '../maplibre/geometry-editor.js';"],
  ['src/core/types.ts', "export { GeometryEditor } from '../index.js';"],
  ['src/maplibre/renderer.ts', "export { readFileSync } from 'node:fs';"],
  ['src/maplibre/renderer.ts', "export { readFileSync } from 'fs';"],
  ['examples/basic/main.ts', "export { GeometryEditor } from '../../src/index.js';"],
  ['examples/basic/main.ts', "export { GeometryEditor } from '../../dist/index.js';"],
])('rejects a dependency across the architecture boundary: %s, %s', async (filePath, source) => {
  // Use an existing project path so the real typed lint configuration applies.
  const [result] = await eslint.lintText(source, { filePath });
  expect(result?.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ ruleId: 'no-restricted-imports' }),
  ]));
});

it.each([
  ['src/core/types.ts', "export { validatePolygon } from './polygon.js';"],
  ['src/maplibre/renderer.ts', "export type { EditorState } from '../core/types.js';"],
  ['examples/basic/main.ts', "export { GeometryEditor } from '@jorisvdmije/map-master'; import 'maplibre-gl/dist/maplibre-gl.css';"],
])('allows supported dependencies: %s, %s', async (filePath, source) => {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result?.messages).toEqual([]);
});
