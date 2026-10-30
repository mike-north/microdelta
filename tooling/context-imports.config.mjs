/** The same policy checks real sources and fixture-only architectural roles. */
import tseslint from 'typescript-eslint';

import { contextImports } from './context-imports.mjs';
import { exampleSourceImports } from './example-source-imports.mjs';
import { reportFixtureImports } from './report-fixture-imports.mjs';

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
    // Independent public-port oracles are test infrastructure. Their broader
    // inspection role grants no owner-source or deep-package import authority.
    files: ['fixtures/contribution-report/**/*.ts', 'fixtures/contribution-report/**/*.mjs', 'fixtures/within-person-slice/**/*.ts', 'fixtures/within-person-slice/**/*.mjs'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
    plugins: { microdelta: { rules: { 'report-fixture-imports': reportFixtureImports } } },
    rules: { 'microdelta/report-fixture-imports': 'error' },
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
    plugins: { microdelta: { rules: { 'example-source-imports': exampleSourceImports } } },
    rules: {
      // Dynamic imports have no imported-name list, so they cannot use the
      // example's narrow Accounting and Machine allowlists. Literal sources
      // keep every dynamic dependency visible to this boundary check.
      'no-restricted-syntax': ['error',
        { selector: 'ImportExpression[source.type!="Literal"]', message: 'The example requires a literal dynamic import source so its package boundary can be checked.' },
        { selector: 'ImportExpression[source.value=/^@microdelta\\//]', message: 'The example cannot dynamically import scoped owner packages; its static imports allow only specific named exports.' },
        { selector: 'ImportExpression[source.value=/^microdelta\\//]', message: 'The example imports only the facade entry, not facade subpaths.' },
      ],
      'microdelta/example-source-imports': 'error',
      'no-restricted-imports': ['error', { paths: [
        { name: '@microdelta/accounting', allowImportNames: ['openDurableAccounting', 'IDurableAccounting'], message: 'The example imports only the Accounting adapter it injects into the facade.' },
        { name: '@microdelta/machine-node', allowImportNames: ['createNodeSqlite'], message: 'The example imports only the SQLite capability the Accounting adapter opens with.' },
      ], patterns: [
        { group: ['@microdelta/*', '!@microdelta/accounting', '!@microdelta/machine-node'], message: 'The example consumes only the microdelta facade (and the Accounting port it injects).' },
        { group: ['@microdelta/*/**'], message: 'The example never imports a deep subpath of a workspace package.' },
      ] }],
    },
  },
];
