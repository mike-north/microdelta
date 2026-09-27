/** The active quality gates preserve API contracts without requiring dormant formal-tool experiments. */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

/** Keep the retirement guard scoped to all executable package scripts and project tooling, not historical records. */
function assertNoRetiredFormalToolEntrypoints(root, eslint, tsconfig, workspacePackages) {
  const executableScripts = Object.entries(root.scripts)
    .map(([name, command]) => `${name}\n${command}`)
    .join('\n');
  const retiredFormalTool = /exp-5|exp5|cml/iu;

  assert.doesNotMatch(executableScripts, retiredFormalTool, 'package scripts must not reference retired formal tools');
  for (const workspace of workspacePackages) {
    const scripts = Object.entries(workspace.manifest.scripts ?? {})
      .map(([name, command]) => `${name}\n${command}`)
      .join('\n');
    assert.doesNotMatch(
      scripts,
      retiredFormalTool,
      `workspace package scripts in ${workspace.packagePath} must not reference retired formal tools`,
    );
  }
  assert.doesNotMatch(eslint, retiredFormalTool, 'ESLint configuration must not reference retired formal tools');
  assert.ok(
    !tsconfig.exclude?.some(path => retiredFormalTool.test(path)),
    'retired formal-tool fixtures must not need a TypeScript exclusion',
  );
}

/** Read the package manifests selected by the root workspace's packages/* pattern. */
async function readWorkspacePackages() {
  const entries = await readdir(new URL('../packages/', import.meta.url), { withFileTypes: true });
  return Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const packagePath = `packages/${entry.name}/package.json`;
    const manifest = JSON.parse(await readFile(new URL(`../${packagePath}`, import.meta.url), 'utf8'));
    return { packagePath, manifest };
  }));
}

/** The mutation cases prove active entrypoint edits cannot evade the retirement guard. */
test('active formal-tool entrypoint guard includes script names and rejects case-insensitive CML mutations', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const eslint = await readFile(new URL('../eslint.config.mjs', import.meta.url), 'utf8');
  const tsconfig = JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'));
  const workspacePackages = await readWorkspacePackages();
  const archivedRecord = await readFile(new URL('../docs/archive/experiments/exp-5.md', import.meta.url), 'utf8');

  assert.doesNotThrow(() => assertNoRetiredFormalToolEntrypoints(root, eslint, tsconfig, workspacePackages));
  assert.match(archivedRecord, /CML/u, 'historical evidence must remain available');

  const namedEntrypointMutation = {
    ...root,
    scripts: { ...root.scripts, 'check:cml-fixture': 'node tooling/ordinary-check.mjs' },
  };
  assert.throws(
    () => assertNoRetiredFormalToolEntrypoints(namedEntrypointMutation, eslint, tsconfig, workspacePackages),
    /package scripts/u,
    'a retired tool in an active script name must be rejected',
  );

  const valuedEntrypointMutation = {
    ...root,
    scripts: { ...root.scripts, 'check:ordinary-fixture': 'node tooling/generate-cml-fixture.mjs' },
  };
  assert.throws(
    () => assertNoRetiredFormalToolEntrypoints(valuedEntrypointMutation, eslint, tsconfig, workspacePackages),
    /package scripts/u,
    'a lower-case retired tool reference in an active command must be rejected',
  );

  assert.throws(
    () => assertNoRetiredFormalToolEntrypoints(root, `${eslint}\n// cml integration`, tsconfig, workspacePackages),
    /eslint/iu,
    'lint configuration references must be rejected without case sensitivity',
  );
});

/** npm lifecycle and namespaced scripts are executable entrypoints even without a build/check/test prefix. */
test('formal-tool guard rejects retired references in every package script, including lifecycle hooks', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const eslint = await readFile(new URL('../eslint.config.mjs', import.meta.url), 'utf8');
  const tsconfig = JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'));
  const workspacePackages = await readWorkspacePackages();
  const rootMutations = [
    ['prebuild', 'node tooling/generate-cml-fixture.mjs'],
    ['posttest', 'node tooling/ordinary-hook.mjs --mode CML'],
    ['prebuild:fixtures', 'node tooling/ordinary-hook.mjs --mode cml'],
  ];
  for (const [name, command] of rootMutations) {
    const mutatedRoot = { ...root, scripts: { ...root.scripts, [name]: command } };
    assert.throws(
      () => assertNoRetiredFormalToolEntrypoints(mutatedRoot, eslint, tsconfig, workspacePackages),
      /package scripts/u,
      `${name} must remain checked as a root lifecycle or namespaced script`,
    );
  }

  const mutations = [
    ['packages/tracking/package.json', 'build:cml-fixture', 'node tooling/ordinary-hook.mjs'],
    ['packages/history/package.json', 'test:ordinary-fixture', 'node tooling/ordinary-hook.mjs --mode CML'],
  ];

  for (const [packagePath, name, command] of mutations) {
    const workspace = workspacePackages.find(candidate => candidate.packagePath === packagePath);
    assert.ok(workspace, `${packagePath} must be an actual root workspace manifest`);
    const mutatedWorkspace = {
      ...workspace,
      manifest: { ...workspace.manifest, scripts: { ...workspace.manifest.scripts, [name]: command } },
    };
    assert.throws(
      () => assertNoRetiredFormalToolEntrypoints(
        root,
        eslint,
        tsconfig,
        workspacePackages.map(workspace => workspace.packagePath === packagePath ? mutatedWorkspace : workspace),
      ),
      /workspace package scripts/u,
      `${packagePath} ${name} must be rejected as an active workspace package script`,
    );
  }
});

/** Removing the experiment must leave the package declaration-contract gate in ordinary builds. */
test('normal builds continue comparing API Extractor declaration reports', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(root.scripts.build, /npm run build:fixtures/u);
  assert.match(root.scripts['build:fixtures'], /api-extractor run --config fixtures\/declarations\/producer\/api-extractor\.json/u);
});
