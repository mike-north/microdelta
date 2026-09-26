import tseslint from 'typescript-eslint';

import { contextImports } from './tooling/context-imports.mjs';
import { documentedSuppressions } from './tooling/documented-suppressions.mjs';

/** Both assertion spellings can launder an unvalidated value through unknown. */
const assertionKinds = ['TSAsExpression', 'TSTypeAssertion'];

/** Active TypeScript uses a real program; archived drafts and build output do not. */
export default [
  { ignores: ['**/dist/**', '**/.test-build/**', '**/node_modules/**', 'docs/archive/**'] },
  {
    files: ['packages/**/*.ts', 'experiments/**/*.ts', 'fixtures/declarations/producer/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      microdelta: { rules: { 'context-imports': contextImports, 'documented-suppressions': documentedSuppressions } },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'microdelta/context-imports': 'error',
      'microdelta/documented-suppressions': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: 10,
      }],
      'no-restricted-syntax': ['error', ...assertionKinds.flatMap(outer => assertionKinds.map(inner => ({
        selector: `${outer}[expression.type="${inner}"][expression.typeAnnotation.type="TSUnknownKeyword"]`,
        message: 'Double assertions through unknown bypass checked narrowing; validate the value at its boundary.',
      })))],
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
