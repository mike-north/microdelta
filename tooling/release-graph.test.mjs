/**
 * The npm release graph is complete, trusted, coherent, and publishable in
 * dependency order before any registry side effect can happen.
 *
 * @see https://docs.npmjs.com/trusted-publishers
 * @see https://docs.npmjs.com/cli/v11/configuring-npm/package-json#repository
 * @see https://docs.npmjs.com/cli/v11/configuring-npm/package-json#publishconfig
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ReleasePlanError,
  bootstrapVersion,
  planRelease,
  readWorkspace,
  registeredPackages,
  trustedPublisher,
} from './release-graph.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** A publishable manifest in the shape the real workspace must use. */
function manifest(name, directory, version, dependencies = {}) {
  return {
    name,
    version,
    license: 'UNLICENSED',
    type: 'module',
    files: ['dist'],
    repository: {
      type: 'git',
      url: 'git+https://github.com/mike-north/microdelta.git',
      directory: `packages/${directory}`,
    },
    publishConfig: { access: 'public' },
    dependencies,
  };
}

/** The current first-party graph shape: facade over History/Tracking/Value/Machine. */
function releaseWorkspace(version = '0.1.0') {
  return {
    root: { name: '@microdelta/workspace', private: true, workspaces: ['packages/*'] },
    packages: [
      { directory: 'packages/core', manifest: manifest('microdelta', 'core', version, { '@microdelta/history': version, '@microdelta/value': version }) },
      { directory: 'packages/history', manifest: manifest('@microdelta/history', 'history', version, { '@microdelta/machine': version, '@microdelta/value': version }) },
      { directory: 'packages/value', manifest: manifest('@microdelta/value', 'value', version, { '@microdelta/machine': version }) },
      { directory: 'packages/machine', manifest: manifest('@microdelta/machine', 'machine', version, { 'better-sqlite3': '12.9.0' }) },
    ],
  };
}

/** Capture every diagnostic so negative tests prove the specific refusal. */
function problems(workspace, options) {
  try {
    planRelease(workspace, options);
  } catch (error) {
    assert.ok(error instanceof ReleasePlanError, String(error));
    return error.problems.join('\n');
  }
  assert.fail('release plan was unexpectedly accepted');
}

test('trust identity is exactly the npm-registered repository and release workflow', () => {
  assert.deepEqual({ ...trustedPublisher }, { repository: 'mike-north/microdelta', workflow: 'release.yml' });
  assert.equal(bootstrapVersion, '0.0.0');
  assert.deepEqual([...registeredPackages].sort(), [
    '@microdelta/definition',
    '@microdelta/history',
    '@microdelta/machine',
    '@microdelta/machine-node',
    '@microdelta/materialization',
    '@microdelta/resolution',
    '@microdelta/supervision',
    '@microdelta/tracking',
    '@microdelta/value',
    'microdelta',
  ]);
});

test('a coherent graph publishes dependencies before their dependents', () => {
  const plan = planRelease(releaseWorkspace(), { release: true });
  const order = plan.packages.map(entry => entry.name);
  assert.deepEqual(order, ['@microdelta/machine', '@microdelta/value', '@microdelta/history', 'microdelta']);
  assert.deepEqual(plan.packages.map(entry => entry.version), ['0.1.0', '0.1.0', '0.1.0', '0.1.0']);
});

test('the checked-in workspace is a complete trusted graph containing the facade closure', async () => {
  const workspace = await readWorkspace(root);
  const plan = planRelease(workspace, { release: false });
  const names = plan.packages.map(entry => entry.name);
  for (const name of ['microdelta', '@microdelta/history', '@microdelta/machine-node', '@microdelta/tracking', '@microdelta/value', '@microdelta/machine']) {
    assert.ok(names.includes(name), `${name} belongs to the facade runtime closure`);
  }
  for (const name of names) assert.ok(registeredPackages.includes(name), `${name} must have npm trust`);
  assert.equal(names.at(-1), 'microdelta');
  assert.ok(names.indexOf('@microdelta/machine') < names.indexOf('@microdelta/machine-node'));
  assert.equal(workspace.root.private, true);
});

/**
 * Issue #56 registers the Resolution owner, which the facade's assembly
 * depends on. Resolution was registered for trusted publishing ahead of its
 * workspace package; its package must now satisfy the same release contract
 * and publish after every owner whose declarations it consumes.
 */
test('the checked-in Resolution owner is a trusted, ordered member of the facade closure', async () => {
  const workspace = await readWorkspace(root);
  const plan = planRelease(workspace, { release: false });
  const names = plan.packages.map(entry => entry.name);
  assert.ok(names.includes('@microdelta/resolution'), 'Resolution belongs to the facade runtime closure');
  for (const owner of ['@microdelta/definition', '@microdelta/tracking', '@microdelta/history', '@microdelta/materialization']) {
    assert.ok(names.indexOf(owner) < names.indexOf('@microdelta/resolution'), `${owner} publishes before Resolution`);
  }
  assert.ok(names.indexOf('@microdelta/resolution') < names.indexOf('microdelta'));
  const resolution = plan.packages.find(entry => entry.name === '@microdelta/resolution');
  assert.equal(resolution?.directory, 'packages/resolution');
});

/**
 * Issue #57 adds the Run Supervision owner, which the facade's workspace run
 * path depends on. Supervision was registered for trusted publishing ahead of
 * its workspace package; its package must satisfy the same release contract
 * and publish after the owners whose declarations it consumes.
 */
test('the checked-in Supervision owner is a trusted, ordered member of the facade closure', async () => {
  const workspace = await readWorkspace(root);
  const plan = planRelease(workspace, { release: false });
  const names = plan.packages.map(entry => entry.name);
  assert.ok(names.includes('@microdelta/supervision'), 'Supervision belongs to the facade runtime closure');
  for (const owner of ['@microdelta/definition', '@microdelta/resolution']) {
    assert.ok(names.indexOf(owner) < names.indexOf('@microdelta/supervision'), `${owner} publishes before Supervision`);
  }
  assert.ok(names.indexOf('@microdelta/supervision') < names.indexOf('microdelta'));
  const supervision = plan.packages.find(entry => entry.name === '@microdelta/supervision');
  assert.equal(supervision?.directory, 'packages/supervision');
});

test('a newly added transitive owner without npm trust is refused', () => {
  const workspace = releaseWorkspace();
  workspace.packages[1].manifest.dependencies['@microdelta/accounting'] = '0.1.0';
  workspace.packages.push({ directory: 'packages/accounting', manifest: manifest('@microdelta/accounting', 'accounting', '0.1.0') });
  assert.match(problems(workspace, { release: true }), /@microdelta\/accounting.*not registered for npm trusted publishing/u);
});

test('a first-party dependency missing from the workspace is refused', () => {
  const workspace = releaseWorkspace();
  workspace.packages[0].manifest.dependencies['@microdelta/resolution'] = '0.1.0';
  assert.match(problems(workspace, { release: true }), /microdelta depends on @microdelta\/resolution, which is not a workspace package/u);
});

test('a private package reachable from the publish graph is refused', () => {
  const workspace = releaseWorkspace();
  workspace.packages[2].manifest.private = true;
  assert.match(problems(workspace, { release: true }), /@microdelta\/value is private but required by/u);
});

test('an unreachable private workspace package is excluded rather than published', () => {
  const workspace = releaseWorkspace();
  workspace.packages.push({ directory: 'packages/scratch', manifest: { name: '@microdelta/scratch', version: '0.0.0', private: true } });
  const plan = planRelease(workspace, { release: true });
  assert.ok(!plan.packages.some(entry => entry.name === '@microdelta/scratch'));
});

test('internal version conflicts are refused', () => {
  const workspace = releaseWorkspace();
  workspace.packages[1].manifest.dependencies['@microdelta/value'] = '0.0.9';
  assert.match(problems(workspace, { release: true }), /@microdelta\/history requires @microdelta\/value@0\.0\.9 but the workspace version is 0\.1\.0/u);
});

test('non-exact and local-protocol first-party ranges are refused', () => {
  const workspace = releaseWorkspace();
  workspace.packages[1].manifest.dependencies['@microdelta/value'] = '^0.1.0';
  workspace.packages[2].manifest.dependencies['@microdelta/machine'] = 'workspace:*';
  const text = problems(workspace, { release: true });
  assert.match(text, /@microdelta\/history requires @microdelta\/value@\^0\.1\.0/u);
  assert.match(text, /@microdelta\/value uses local protocol workspace:\* for @microdelta\/machine/u);
});

test('the reserved bootstrap version is never selected for release', () => {
  assert.match(problems(releaseWorkspace(bootstrapVersion), { release: true }), /microdelta@0\.0\.0 is the reserved npm bootstrap version/u);
  assert.doesNotThrow(() => planRelease(releaseWorkspace(bootstrapVersion), { release: false }));
});

test('invalid versions are refused', () => {
  const workspace = releaseWorkspace();
  workspace.packages[3].manifest.version = 'next';
  assert.match(problems(workspace, { release: false }), /@microdelta\/machine has invalid version next/u);
});

test('publication metadata must match the trusted repository and public access', () => {
  const workspace = releaseWorkspace();
  workspace.packages[0].manifest.repository.url = 'git+https://github.com/someone/fork.git';
  workspace.packages[1].manifest.repository.directory = 'packages/elsewhere';
  delete workspace.packages[2].manifest.publishConfig;
  const text = problems(workspace, { release: true });
  assert.match(text, /microdelta repository\.url must be git\+https:\/\/github\.com\/mike-north\/microdelta\.git/u);
  assert.match(text, /@microdelta\/history repository\.directory must be packages\/history/u);
  assert.match(text, /@microdelta\/value publishConfig\.access must be public/u);
});

test('publishConfig cannot redirect publication to another registry or tag', () => {
  const workspace = releaseWorkspace();
  workspace.packages[0].manifest.publishConfig = { access: 'public', registry: 'https://example.test/' };
  assert.match(problems(workspace, { release: true }), /microdelta publishConfig may only set access/u);
});

test('the workspace root must stay private and the facade must be publishable', () => {
  const workspace = releaseWorkspace();
  workspace.root.private = false;
  workspace.packages[0].manifest.private = true;
  const text = problems(workspace, { release: true });
  assert.match(text, /workspace root must remain private/u);
  assert.match(text, /microdelta is private but required by the release entry/u);
});

test('non-first-party workspace names and dependency cycles are refused', () => {
  const workspace = releaseWorkspace();
  workspace.packages.push({ directory: 'packages/other', manifest: manifest('left-pad', 'other', '0.1.0') });
  workspace.packages[3].manifest.dependencies['@microdelta/value'] = '0.1.0';
  const text = problems(workspace, { release: true });
  assert.match(text, /left-pad is not a first-party microdelta package name/u);
  assert.match(text, /dependency cycle/u);
});

test('workspace discovery reads manifests from the declared workspace directories', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-graph-'));
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/*'] }));
    await mkdir(path.join(directory, 'packages/core'), { recursive: true });
    await mkdir(path.join(directory, 'packages/empty'), { recursive: true });
    await writeFile(path.join(directory, 'packages/core/package.json'), JSON.stringify(manifest('microdelta', 'core', '0.1.0')));
    const workspace = await readWorkspace(directory);
    assert.deepEqual(workspace.packages.map(entry => [entry.directory, entry.manifest.name]), [['packages/core', 'microdelta']]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI checks the workspace graph and reports each refusal', async () => {
  const { spawnSync } = await import('node:child_process');
  const passing = spawnSync(process.execPath, [path.join(root, 'tooling/release-graph.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /Release publish order: .*microdelta@/u);

  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-graph-cli-'));
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/*'] }));
    await mkdir(path.join(directory, 'packages/core'), { recursive: true });
    await writeFile(path.join(directory, 'packages/core/package.json'), JSON.stringify({ ...manifest('microdelta', 'core', '0.1.0', { '@microdelta/accounting': '0.1.0' }) }));
    const failing = spawnSync(process.execPath, [path.join(root, 'tooling/release-graph.mjs'), '--workspace', directory], { encoding: 'utf8' });
    assert.equal(failing.status, 1);
    assert.match(failing.stderr, /microdelta depends on @microdelta\/accounting, which is not a workspace package/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
