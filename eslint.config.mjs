import { builtinModules } from 'node:module';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'coverage/**', 'tests/fixtures/**', 'examples/basic/dist/**', '**/__screenshots__/**']),
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.tools.json', './tsconfig.example.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: builtinModules,
        patterns: [{
          group: ['node:*', '**/examples/**', '**/tests/**'],
          message: 'Library code must not depend on Node.js, demo code, or test fixtures.',
        }],
      }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: builtinModules,
        patterns: [{
          group: ['maplibre-gl', 'maplibre-gl/**', '**/maplibre/**', '**/index.js', 'node:*', '**/examples/**', '**/tests/**'],
          message: 'The core may depend on its own modules and geometry dependencies, never the map adapter, public entry point, browser, or application.',
        }],
      }],
    },
  },
  {
    files: ['examples/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/src/**', '../**/dist/**', './dist/**', '@jorisvdmije/map-master/*'],
          message: 'Examples consume the public @jorisvdmije/map-master entry point, just like an installed application.',
        }],
      }],
    },
  },
);
