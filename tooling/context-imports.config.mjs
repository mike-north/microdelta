/** The same policy checks real sources and fixture-only architectural roles. */
import tseslint from 'typescript-eslint';

import { contextImports } from './context-imports.mjs';

export default [
  { ignores: ['**/dist/**', '**/.test-build/**', '**/node_modules/**'] },
  {
    files: ['packages/**/*.ts', 'fixtures/context-roles/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
    plugins: { microdelta: { rules: { 'context-imports': contextImports } } },
    rules: { 'microdelta/context-imports': 'error' },
  },
];
