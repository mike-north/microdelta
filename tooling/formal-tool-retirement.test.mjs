/** The active quality gates preserve API contracts without requiring dormant formal-tool experiments. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** Keep the retirement guard scoped to executable project configuration, not historical records. */
function assertNoRetiredFormalToolEntrypoints(root, eslint, tsconfig) {
  const executableScripts = Object.entries(root.scripts)
    .filter(([name]) => name.startsWith('build') || name.startsWith('check') || name.startsWith('test'))
    .map(([name, command]) => `${name}\n${command}`)
    .join('\n');
  const retiredFormalTool = /exp-5|exp5|cml/iu;

  assert.doesNotMatch(executableScripts, retiredFormalTool, 'package scripts must not reference retired formal tools');
  assert.doesNotMatch(eslint, retiredFormalTool, 'ESLint configuration must not reference retired formal tools');
  assert.ok(
    !tsconfig.exclude?.some(path => retiredFormalTool.test(path)),
    'retired formal-tool fixtures must not need a TypeScript exclusion',
  );
}

/** The mutation cases prove active entrypoint edits cannot evade the retirement guard. */
test('active formal-tool entrypoint guard includes script names and rejects case-insensitive CML mutations', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const eslint = await readFile(new URL('../eslint.config.mjs', import.meta.url), 'utf8');
  const tsconfig = JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'));
  const archivedRecord = await readFile(new URL('../docs/archive/experiments/exp-5.md', import.meta.url), 'utf8');

  assert.doesNotThrow(() => assertNoRetiredFormalToolEntrypoints(root, eslint, tsconfig));
  assert.match(archivedRecord, /CML/u, 'historical evidence must remain available');

  const namedEntrypointMutation = {
    ...root,
    scripts: { ...root.scripts, 'check:cml-fixture': 'node tooling/ordinary-check.mjs' },
  };
  assert.throws(
    () => assertNoRetiredFormalToolEntrypoints(namedEntrypointMutation, eslint, tsconfig),
    /package scripts/u,
    'a retired tool in an active script name must be rejected',
  );

  const valuedEntrypointMutation = {
    ...root,
    scripts: { ...root.scripts, 'check:ordinary-fixture': 'node tooling/generate-cml-fixture.mjs' },
  };
  assert.throws(
    () => assertNoRetiredFormalToolEntrypoints(valuedEntrypointMutation, eslint, tsconfig),
    /package scripts/u,
    'a lower-case retired tool reference in an active command must be rejected',
  );

  assert.throws(
    () => assertNoRetiredFormalToolEntrypoints(root, `${eslint}\n// cml integration`, tsconfig),
    /eslint/iu,
    'lint configuration references must be rejected without case sensitivity',
  );
});

/** Removing the experiment must leave the package declaration-contract gate in ordinary builds. */
test('normal builds continue comparing API Extractor declaration reports', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(root.scripts.build, /npm run build:fixtures/u);
  assert.match(root.scripts['build:fixtures'], /api-extractor run --config fixtures\/declarations\/producer\/api-extractor\.json/u);
});
