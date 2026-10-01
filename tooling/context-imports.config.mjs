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
    // into the workspace's source. The one exception is the Accounting port a
    // facade caller injects: until Resource Accounting is registered for
    // publishing, the caller opens its durable adapter itself, over the Node
    // SQLite capability, so the example may import exactly those names from
    // those two package entries, and never a deep subpath of either.
    files: ['examples/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
    rules: {
      'no-restricted-imports': ['error', { paths: [
        { name: '@microdelta/accounting', allowImportNames: ['openDurableAccounting', 'IDurableAccounting'], message: 'The example imports only the Accounting adapter it injects into the facade.' },
        { name: '@microdelta/machine-node', allowImportNames: ['createNodeSqlite'], message: 'The example imports only the SQLite capability the Accounting adapter opens with.' },
      ], patterns: [
        { group: ['@microdelta/*', '!@microdelta/accounting', '!@microdelta/machine-node'], message: 'The example consumes only the microdelta facade (and the Accounting port it injects).' },
        { group: ['@microdelta/*/**'], message: 'The example never imports a deep subpath of a workspace package.' },
        { group: ['../../../*', '../../../../*'], message: 'The example must not reach into workspace source.' },
      ] }],
    },
  },
];
