/** Changeset release preparation stays reviewable and never publishes packages. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'node_modules/@changesets/cli/bin.js');

/** Create a disposable workspace so release generation cannot edit project packages. */
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-changesets-'));
  await mkdir(path.join(directory, 'packages/base'), { recursive: true });
  await mkdir(path.join(directory, 'packages/consumer'), { recursive: true });
  await mkdir(path.join(directory, '.changeset'), { recursive: true });
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({
    name: '@fixture/workspace',
    private: true,
    version: '0.0.0',
    workspaces: ['packages/*'],
  }));
  await writeFile(path.join(directory, 'packages/base/package.json'), JSON.stringify({
    name: '@fixture/base',
    version: '1.0.0',
    private: true,
  }));
  await writeFile(path.join(directory, 'packages/consumer/package.json'), JSON.stringify({
    name: '@fixture/consumer',
    version: '1.0.0',
    private: true,
    dependencies: { '@fixture/base': '1.0.0' },
  }));
  await writeFile(path.join(directory, '.changeset/config.json'), JSON.stringify({
    changelog: '@changesets/cli/changelog',
    commit: false,
    fixed: [],
    linked: [],
    access: 'restricted',
    baseBranch: 'main',
    changedFilePatterns: ['**'],
    prettier: false,
    privatePackages: { version: true, tag: false },
    updateInternalDependencies: 'patch',
    ignore: [],
    bumpVersionsWithWorkspaceProtocolOnly: false,
  }));
  await writeFile(path.join(directory, '.changeset/release.md'), [
    '---',
    '"@fixture/base": patch',
    '---',
    '',
    'Correct the base package behavior.',
    '',
  ].join('\n'));
  const initialLock = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline'], {
    cwd: directory,
    encoding: 'utf8',
  });
  assert.equal(initialLock.status, 0, initialLock.stderr);
  const git = (...args) => spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
  for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'fixture@example.test'], ['config', 'user.name', 'Fixture'], ['add', '.'], ['commit', '-m', 'fixture base']]) {
    const result = git(...args);
    assert.equal(result.status, 0, result.stderr);
  }
  return directory;
}

/** Run the locally installed CLI without downloading packages or touching the checkout. */
function run(directory, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
  });
}

test('workspace pins a Node 20-compatible Changesets CLI and names reviewable tasks', async () => {
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(workspace.devDependencies['@changesets/cli'], '2.31.1');
  assert.match(workspace.scripts['changeset:add'], /changeset/u);
  assert.match(workspace.scripts['changeset:status'], /changeset status/u);
  assert.match(workspace.scripts['changeset:version'], /changeset version/u);
  assert.match(workspace.scripts['changeset:version'], /npm install --package-lock-only --ignore-scripts --no-audit --no-fund/u);
});

test('manual release preparation creates a version PR without publishing', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /contents:\s*write/u);
  assert.match(workflow, /pull-requests:\s*write/u);
  assert.match(workflow, /changesets\/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d/u);
  assert.match(workflow, /version:\s*npm run changeset:version/u);
  assert.match(workflow, /createGithubReleases:\s*false/u);
  assert.doesNotMatch(workflow, /^\s*publish:/mu);
  assert.match(workflow, /branch:\s*main/u);
  assert.match(workflow, /github\.ref != 'refs\/heads\/main'/u);
  assert.doesNotMatch(workflow, /pull_request_target|npm run changeset:publish|changeset publish|npm publish|id-token:\s*write/u);
});

test('automatic version PRs request checks against their exact generated branch', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const check = await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8');
  const metadata = await readFile(path.join(root, '.github/workflows/pr-metadata.yml'), 'utf8');
  assert.match(workflow, /^  push:\n    branches: \[main\]\n  workflow_dispatch:/mu);
  assert.match(workflow, /actions:\s*write/u);
  assert.match(workflow, /contents:\s*write/u);
  assert.match(workflow, /pull-requests:\s*write/u);
  assert.match(workflow, /npm run changeset:status -- --output/u);
  assert.match(workflow, /actions\/github-script@v7/u);
  assert.match(workflow, /createWorkflowDispatch/u);
  assert.match(workflow, /ref: pull\.head\.ref/u);
  assert.match(workflow, /outputs\.pullRequestNumber/u);
  assert.match(workflow, /changesets\/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d/u);
  assert.match(check, /on: \[push, pull_request, workflow_dispatch\]/u);
  assert.match(metadata, /workflow_dispatch:/u);
  assert.match(metadata, /pr_number:/u);
  assert.doesNotMatch(workflow, /npm (?:run )?publish|changeset publish|npm publish|pull_request_target|auto-merge|enable-pull-request-automerge/iu);
});

test('release workflow uses the documented version-only v1.9.0 action interface', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const guide = await readFile(path.join(root, 'docs/releasing.md'), 'utf8');
  const actionSha = 'a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d';
  assert.match(guide, new RegExp(`changesets/action/tree/${actionSha}`, 'u'));
  assert.match(guide, new RegExp(`changesets/action/blob/${actionSha}/action\\.yml`, 'u'));
  assert.match(guide, /`version`, optional `publish`, and `createGithubReleases` inputs/u);
  assert.match(guide, /`pullRequestNumber` output/u);
  assert.match(guide, /selects the CLI `version` command for Changesets 2\.x/u);
  assert.match(workflow, new RegExp(`changesets/action@${actionSha}`, 'u'));
  assert.match(workflow, /version:\s*npm run changeset:version/u);
  assert.match(workflow, /outputs\.pullRequestNumber/u);
  assert.match(workflow, /createGithubReleases:\s*false/u);
  assert.doesNotMatch(workflow, /^\s*publish:/mu);
});

test('release PR generation records its package plan in the standard PR evidence shape', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-body-'));
  const releasePlan = path.join(directory, 'plan.json');
  try {
    await writeFile(releasePlan, JSON.stringify({ releases: [{ name: '@microdelta/tracking', type: 'patch' }] }));
    const result = spawnSync(process.execPath, [path.join(root, 'tooling/release-pr-body.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, RELEASE_PLAN_PATH: releasePlan },
    });
    assert.equal(result.status, 0, result.stderr);
    const body = result.stdout;
    assert.match(body, /^## Problem and resulting behavior$/mu);
    assert.match(body, /^## Governing issue and contracts\n\nRefs #31\b/mu);
    assert.match(body, /^## Acceptance evidence$/mu);
    assert.match(body, /^## Risks and limitations$/mu);
    assert.match(body, /^## Attribution\n\nImplementer: Changesets automation/mu);
    assert.match(body, /^Agent assistance: None$/mu);
    assert.doesNotMatch(body, /TODO|TBD|PLACEHOLDER|checks passed|reviewed and merged/iu);
    assert.match(body, /@microdelta\/tracking.*patch/iu);
    const bodyPath = path.join(directory, 'body.md');
    await writeFile(bodyPath, body);
    const checked = spawnSync(process.execPath, [path.join(root, 'tooling/pr-metadata.mjs'), '--body-file', bodyPath], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release PR evidence rejects malformed or unsafe package plan entries', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-body-invalid-'));
  const releasePlan = path.join(directory, 'plan.json');
  try {
    await writeFile(releasePlan, JSON.stringify({ releases: [{ name: '## Risks', type: 'patch' }] }));
    const result = spawnSync(process.execPath, [path.join(root, 'tooling/release-pr-body.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, RELEASE_PLAN_PATH: releasePlan },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /invalid package entry/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('private workspace packages are versioned without creating private package tags', async () => {
  const config = JSON.parse(await readFile(path.join(root, '.changeset/config.json'), 'utf8'));
  assert.deepEqual(config.privatePackages, { version: true, tag: false });
  assert.equal(config.baseBranch, 'main');
  const workspace = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.ok(Object.values(workspace.scripts).every(script => !/changeset publish/u.test(script)));
});

test('every workspace package with declarations checks committed reports without rewriting them', async () => {
  const directories = await readdir(path.join(root, 'packages'), { withFileTypes: true });
  const packages = directories.filter(entry => entry.isDirectory());
  assert.ok(packages.length > 0);
  for (const directory of packages) {
    const packageRoot = path.join(root, 'packages', directory.name);
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const configs = (await readdir(packageRoot)).filter(name => /^api-extractor.*\.json$/u.test(name));
    assert.ok(configs.length > 0, `${manifest.name} needs an API Extractor report configuration`);
    for (const name of configs) {
      const config = JSON.parse(await readFile(path.join(packageRoot, name), 'utf8'));
      assert.equal(config.apiReport?.enabled, true, `${manifest.name}/${name} must compare its committed API report`);
      assert.ok(manifest.scripts?.build?.includes(`api-extractor run --config ${name}`), `${manifest.name} build must check ${name}`);
      assert.ok(!manifest.scripts.build.includes('--local'), `${manifest.name} build must not rewrite ${name}`);
    }
  }
});

test('private packages receive versions and changelogs and internal ranges stay coherent', async () => {
  const directory = await fixture();
  try {
    const status = run(directory, 'status', '--output', 'release-plan.json');
    assert.equal(status.status, 0, status.stderr);
    const plan = JSON.parse(await readFile(path.join(directory, 'release-plan.json'), 'utf8'));
    assert.ok(plan.releases.some(release => release.name === '@fixture/base' && release.type === 'patch'));

    const version = run(directory, 'version');
    assert.equal(version.status, 0, version.stderr);
    const lockUpdate = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(lockUpdate.status, 0, lockUpdate.stderr);
    const base = JSON.parse(await readFile(path.join(directory, 'packages/base/package.json'), 'utf8'));
    const consumer = JSON.parse(await readFile(path.join(directory, 'packages/consumer/package.json'), 'utf8'));
    assert.equal(base.version, '1.0.1');
    assert.equal(consumer.dependencies['@fixture/base'], '1.0.1');
    const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages['packages/base'].version, '1.0.1');
    assert.equal(lock.packages['packages/consumer'].version, '1.0.1');
    assert.equal(lock.packages['packages/consumer'].dependencies['@fixture/base'], '1.0.1');
    const install = spawnSync('npm', ['ci', '--ignore-scripts', '--offline'], { cwd: directory, encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    assert.match(await readFile(path.join(directory, 'packages/base/CHANGELOG.md'), 'utf8'), /Correct the base package behavior/u);
    assert.match(await readFile(path.join(directory, 'packages/consumer/CHANGELOG.md'), 'utf8'), /@fixture\/base/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('no-change and documentation-only work does not invent package releases', async () => {
  const directory = await fixture();
  try {
    await rm(path.join(directory, '.changeset/release.md'));
    await writeFile(path.join(directory, 'README.md'), 'Documentation-only adjustment.\n');
    const status = run(directory, 'status', '--output', 'release-plan.json');
    assert.equal(status.status, 0, status.stderr);
    const plan = JSON.parse(await readFile(path.join(directory, 'release-plan.json'), 'utf8'));
    assert.deepEqual(plan.releases, []);

    const version = run(directory, 'version');
    assert.equal(version.status, 0, version.stderr);
    const base = JSON.parse(await readFile(path.join(directory, 'packages/base/package.json'), 'utf8'));
    assert.equal(base.version, '1.0.0');
    assert.equal(await readFile(path.join(directory, 'packages/base/CHANGELOG.md'), 'utf8').then(() => true, () => false), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('malformed changeset configuration fails with a diagnostic', async () => {
  const directory = await fixture();
  try {
    await writeFile(path.join(directory, '.changeset/config.json'), '{ invalid');
    const result = run(directory, 'status');
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /config|JSON|parse/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
