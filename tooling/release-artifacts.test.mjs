/**
 * Release artifacts are the exact tarballs later published. They must contain
 * coherent runtime entry points and public declarations, and the whole
 * first-party graph must install from them without consulting npm for any
 * microdelta package. Runs after `npm run build` (the `npm test` prelude).
 *
 * @see https://docs.npmjs.com/cli/v11/commands/npm-pack
 * @see https://nodejs.org/api/packages.html#package-entry-points
 * @see https://www.typescriptlang.org/docs/handbook/modules/reference.html#packagejson-exports
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectPackedFiles } from './release-artifacts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** A package manifest whose entries point at built runtime and public declarations. */
function manifest() {
  return {
    name: '@microdelta/value',
    version: '0.1.0',
    main: './dist/src/index.js',
    types: './dist/api/value.public.d.ts',
    exports: { '.': { types: './dist/api/value.public.d.ts', import: './dist/src/index.js' } },
  };
}

const packed = ['package.json', 'README.md', 'dist/src/index.js', 'dist/api/value.public.d.ts'];

test('a complete packed file list is accepted', () => {
  assert.deepEqual(inspectPackedFiles(manifest(), packed), []);
});

test('missing runtime or declaration entry files are refused', () => {
  const problems = inspectPackedFiles(manifest(), ['package.json', 'dist/api/value.public.d.ts']);
  assert.ok(problems.some(problem => /exports\["\."\]\.import target dist\/src\/index\.js is not in the tarball/u.test(problem)), problems.join('\n'));
  assert.ok(problems.some(problem => /main target dist\/src\/index\.js is not in the tarball/u.test(problem)));
});

test('type entries must be generated public declarations, never alpha or untrimmed views', () => {
  const alpha = manifest();
  alpha.types = './dist/api/value.alpha.d.ts';
  alpha.exports['.'].types = './dist/api/value.d.ts';
  const problems = inspectPackedFiles(alpha, [...packed, 'dist/api/value.alpha.d.ts', 'dist/api/value.d.ts']);
  assert.ok(problems.some(problem => /types must name a generated \.public\.d\.ts declaration/u.test(problem)), problems.join('\n'));
  assert.ok(problems.some(problem => /exports\["\."\]\.types must name a generated \.public\.d\.ts declaration/u.test(problem)));
});

test('source, credentials, and local configuration never enter a tarball', () => {
  const problems = inspectPackedFiles(manifest(), [...packed, 'src/index.ts', '.npmrc', 'dist/.env']);
  assert.ok(problems.some(problem => /src\/index\.ts is TypeScript source/u.test(problem)));
  assert.ok(problems.some(problem => /\.npmrc must not be published/u.test(problem)));
  assert.ok(problems.some(problem => /dist\/\.env must not be published/u.test(problem)));
});

test('the real workspace packs and installs as one coherent first-party graph from tarballs', { timeout: 300_000 }, async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-artifacts-'));
  try {
    const result = spawnSync(process.execPath, [path.join(root, 'tooling/release-artifacts.mjs'), '--out', out], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_SHA: 'f'.repeat(40) },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const release = JSON.parse(await readFile(path.join(out, 'release-manifest.json'), 'utf8'));
    assert.equal(release.repository, 'mike-north/microdelta');
    assert.equal(release.commit, 'f'.repeat(40));
    const names = release.packages.map(entry => entry.name);
    assert.equal(names.at(-1), 'microdelta');
    for (const name of ['@microdelta/machine', '@microdelta/value', '@microdelta/history', '@microdelta/machine-node', '@microdelta/tracking']) {
      assert.ok(names.includes(name), `${name} must be packed for the facade closure`);
    }
    for (const entry of release.packages) assert.match(entry.integrity, /^sha512-/u);
    assert.match(result.stdout, /Installed \d+ first-party packages from local tarballs/u);
    assert.match(result.stdout, /Public declarations typecheck for every package entry/u);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

/**
 * A dependency-free two-package workspace (facade over Machine) with built
 * files written directly, so install verification runs offline and each
 * negative case breaks exactly one thing.
 */
async function builtFixture({ machineDeclaration = 'export declare const ready: true;\n', facadeRuntime = "export { ready } from '@microdelta/machine';\n" } = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-fixture-'));
  await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/*'] }));
  const packages = [
    ['core', 'microdelta', { '@microdelta/machine': '0.1.0' }, facadeRuntime, "export { ready } from '@microdelta/machine';\n"],
    ['machine', '@microdelta/machine', {}, 'export const ready = true;\n', machineDeclaration],
  ];
  for (const [directory, name, dependencies, runtime, declaration] of packages) {
    const base = path.join(workspace, 'packages', directory);
    await mkdir(path.join(base, 'dist'), { recursive: true });
    await writeFile(path.join(base, 'dist/index.js'), runtime);
    await writeFile(path.join(base, 'dist/index.public.d.ts'), declaration);
    await writeFile(path.join(base, 'package.json'), JSON.stringify({
      name,
      version: '0.1.0',
      license: 'UNLICENSED',
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.public.d.ts',
      exports: { '.': { types: './dist/index.public.d.ts', import: './dist/index.js' } },
      files: ['dist'],
      repository: { type: 'git', url: 'git+https://github.com/mike-north/microdelta.git', directory: `packages/${directory}` },
      publishConfig: { access: 'public' },
      dependencies,
    }));
  }
  return workspace;
}

/** Pack a fixture in release mode into a fresh output directory. */
function packFixture(workspace) {
  return spawnSync(process.execPath, [path.join(root, 'tooling/release-artifacts.mjs'), '--release', '--workspace', workspace, '--out', path.join(workspace, 'out')], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: '1'.repeat(40) },
  });
}

test('a minimal coherent fixture graph passes release packing offline', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture();
  try {
    const result = packFixture(workspace);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const release = JSON.parse(await readFile(path.join(workspace, 'out/release-manifest.json'), 'utf8'));
    assert.deepEqual(release.packages.map(entry => `${entry.name}@${entry.version}`), ['@microdelta/machine@0.1.0', 'microdelta@0.1.0']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('public declarations that do not typecheck across packages are refused', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture({ machineDeclaration: 'export declare const other: true;\n' });
  try {
    const result = packFixture(workspace);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /has no exported member named 'ready'|has no exported member 'ready'/u);
    assert.equal(await readFile(path.join(workspace, 'out/release-manifest.json')).then(() => true, () => false), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a package root that fails at runtime import is refused', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture({ facadeRuntime: "export { ready } from '@microdelta/machine';\nthrow new Error('facade failed to load');\n" });
  try {
    const result = packFixture(workspace);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /facade failed to load/u);
    assert.equal(await readFile(path.join(workspace, 'out/release-manifest.json')).then(() => true, () => false), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('release mode refuses a reserved bootstrap version before packing anything', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-bootstrap-'));
  const out = path.join(workspace, 'out');
  try {
    await mkdir(path.join(workspace, 'packages/core'), { recursive: true });
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/*'] }));
    await writeFile(path.join(workspace, 'packages/core/package.json'), JSON.stringify({
      name: 'microdelta',
      version: '0.0.0',
      files: ['dist'],
      repository: { type: 'git', url: 'git+https://github.com/mike-north/microdelta.git', directory: 'packages/core' },
      publishConfig: { access: 'public' },
    }));
    const result = spawnSync(process.execPath, [path.join(root, 'tooling/release-artifacts.mjs'), '--release', '--workspace', workspace, '--out', out], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /microdelta@0\.0\.0 is the reserved npm bootstrap version/u);
    assert.equal(await readdir(out).then(() => true, () => false), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
