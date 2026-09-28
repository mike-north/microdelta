/** The same policy checks real sources and fixture-only architectural roles. */
import tseslint from 'typescript-eslint';

import { contextImports } from './context-imports.mjs';

export default [
  { ignores: ['**/dist/**', '**/.test-build/**', '**/node_modules/**'] },
  {
    files: ['packages/**/*.ts', 'fixtures/context-roles/**/*.ts', 'experiments/exp-*/src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
    plugins: { microdelta: { rules: { 'context-imports': contextImports } } },
    rules: { 'microdelta/context-imports': 'error' },
  },
  {
    // The executable example is an external consumer of the facade: it may use
    // microdelta and Node built-ins, never a scoped owner package or a path
    // into the workspace's source.
    files: ['examples/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['@microdelta/*'], message: 'The example consumes only the microdelta facade.' },
        { group: ['../../../*', '../../../../*'], message: 'The example must not reach into workspace source.' },
      ] }],
    },
  },
];
