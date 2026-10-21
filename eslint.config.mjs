import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'coverage/**', 'tests/fixtures/**']),
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.tools.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
