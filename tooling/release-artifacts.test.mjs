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
import { inspectPackedFiles, undeclaredFirstPartyImports, verifyNodeSqlite } from './release-artifacts.mjs';

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
    for (const name of ['@microdelta/machine', '@microdelta/value', '@microdelta/history', '@microdelta/machine-node', '@microdelta/tracking', '@microdelta/definition', '@microdelta/materialization', '@microdelta/resolution', '@microdelta/supervision']) {
      assert.ok(names.includes(name), `${name} must be packed for the facade closure`);
    }
    for (const entry of release.packages) assert.match(entry.integrity, /^sha512-/u);
    assert.match(result.stdout, /Every emitted first-party import is a declared dependency/u);
    for (const name of names) {
      assert.match(result.stdout, new RegExp(`Isolated install of ${name.replace('/', '\\/')}@[^ ]+ resolved its first-party dependencies from local tarballs, imported, and typechecked`, 'u'));
    }
    // Issue #64 review finding 4: the native driver must be installed normally
    // and exercised, not merely imported with install scripts suppressed.
    assert.match(result.stdout, /Node SQLite capability wrote, reopened and read a temporary database through the installed @microdelta\/machine-node tarball/u);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

/**
 * A dependency-free two-package workspace (facade over Machine) with built
 * files written directly, so install verification runs offline and each
 * negative case breaks exactly one thing.
 */
async function builtFixture({
  machineDeclaration = 'export declare const ready: true;\n',
  facadeRuntime = "export { ready } from '@microdelta/machine';\n",
  facadeDeclaration = "export { ready } from '@microdelta/machine';\n",
  facadeDependencies = { '@microdelta/machine': '0.1.0' },
  extraPackages = [],
} = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-fixture-'));
  await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/*'] }));
  const packages = [
    ['core', 'microdelta', facadeDependencies, facadeRuntime, facadeDeclaration],
    ['machine', '@microdelta/machine', {}, 'export const ready = true;\n', machineDeclaration],
    ...extraPackages,
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

/** Whether the refused fixture left a publishable release manifest behind. */
async function wroteManifest(workspace) {
  return readFile(path.join(workspace, 'out/release-manifest.json')).then(() => true, () => false);
}

// Issue #64 review finding 3: installing every tarball directly let a facade
// import Machine without declaring it. A consumer installing only the facade
// then failed with ERR_MODULE_NOT_FOUND.
test('an emitted first-party runtime import without a declared dependency is refused', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture({ facadeDependencies: {} });
  try {
    const result = packFixture(workspace);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /microdelta imports @microdelta\/machine in dist\/index\.js but does not declare it as a runtime dependency/u);
    assert.equal(await wroteManifest(workspace), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a public declaration import without a declared dependency is refused', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture({
    facadeDependencies: {},
    facadeRuntime: 'export const ready = true;\n',
    facadeDeclaration: "import type { ready as machineReady } from '@microdelta/machine';\nexport declare const ready: typeof machineReady;\n",
  });
  try {
    const result = packFixture(workspace);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /microdelta imports @microdelta\/machine in dist\/index\.public\.d\.ts but does not declare it/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('an isolated install catches a first-party import the static scan cannot see', { timeout: 120_000 }, async () => {
  // A computed specifier hides the edge from the emitted-import scan; installing
  // the facade alone (siblings only via overrides) must still fail to import it.
  const workspace = await builtFixture({
    facadeDependencies: {},
    facadeRuntime: "const name = ['@microdelta', 'machine'].join('/');\nexport const { ready } = await import(name);\n",
    facadeDeclaration: 'export declare const ready: true;\n',
  });
  try {
    const result = packFixture(workspace);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND[\s\S]*@microdelta\/machine|@microdelta\/machine[\s\S]*ERR_MODULE_NOT_FOUND/u);
    assert.equal(await wroteManifest(workspace), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a healthy graph installs each package alone with siblings only from local tarballs', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture();
  try {
    const result = packFixture(workspace);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Isolated install of microdelta@0\.1\.0 resolved its first-party dependencies from local tarballs/u);
    assert.match(result.stdout, /Isolated install of @microdelta\/machine@0\.1\.0 resolved/u);
    assert.match(result.stdout, /@microdelta\/machine-node is not in this release graph; the native SQLite check does not apply/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a new registered owner declared by the facade is packed and installed transitively', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture({
    facadeDependencies: { '@microdelta/machine': '0.1.0', '@microdelta/resolution': '0.1.0' },
    facadeRuntime: "export { ready } from '@microdelta/machine';\nexport { resolved } from '@microdelta/resolution';\n",
    facadeDeclaration: "export { ready } from '@microdelta/machine';\nexport { resolved } from '@microdelta/resolution';\n",
    extraPackages: [['resolution', '@microdelta/resolution', { '@microdelta/machine': '0.1.0' }, "import '@microdelta/machine';\nexport const resolved = true;\n", 'export declare const resolved: true;\n']],
  });
  try {
    const result = packFixture(workspace);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const release = JSON.parse(await readFile(path.join(workspace, 'out/release-manifest.json'), 'utf8'));
    assert.deepEqual(release.packages.map(entry => entry.name), ['@microdelta/machine', '@microdelta/resolution', 'microdelta']);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a new unregistered owner used by the facade is refused before packing', { timeout: 120_000 }, async () => {
  const workspace = await builtFixture({
    facadeDependencies: { '@microdelta/machine': '0.1.0', '@microdelta/accounting': '0.1.0' },
    extraPackages: [['accounting', '@microdelta/accounting', {}, 'export const counted = true;\n', 'export declare const counted: true;\n']],
  });
  try {
    const result = packFixture(workspace);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /@microdelta\/accounting is not registered for npm trusted publishing/u);
    assert.equal(await readdir(path.join(workspace, 'out')).then(() => true, () => false), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('the emitted-import scan names each undeclared first-party specifier form', () => {
  const manifest = { name: 'microdelta', dependencies: { '@microdelta/value': '0.1.0' }, peerDependencies: { '@microdelta/history': '0.1.0' } };
  const files = new Map([
    ['dist/a.js', "import { x } from '@microdelta/value';\nexport * from '@microdelta/machine/sub';\nconst y = await import(\"@microdelta/tracking\");\n"],
    ['dist/b.d.ts', "import type { Store } from '@microdelta/history';\nexport type { A } from '@microdelta/definition';\n"],
    ['dist/c.cjs', "const self = require('microdelta');\nconst other = require('left-pad');\n"],
    ['dist/c.js.map', '{"sources":["import \'@microdelta/materialization\'"]}'],
  ]);
  assert.deepEqual(undeclaredFirstPartyImports(manifest, files), [
    { file: 'dist/a.js', dependency: '@microdelta/machine' },
    { file: 'dist/a.js', dependency: '@microdelta/tracking' },
    { file: 'dist/b.d.ts', dependency: '@microdelta/definition' },
  ]);
});

/**
 * Pack Machine and its Node adapter from the built workspace and install the
 * adapter into a scratch consumer, optionally suppressing install scripts so
 * better-sqlite3 has no native binding.
 */
async function nodeAdapterConsumer({ ignoreScripts }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-sqlite-consumer-'));
  const tarballs = {};
  for (const name of ['@microdelta/machine', '@microdelta/machine-node']) {
    const packed = spawnSync('npm', ['pack', '--workspace', name, '--pack-destination', directory, '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    tarballs[name] = path.join(directory, JSON.parse(packed.stdout)[0].filename);
  }
  const consumer = path.join(directory, 'consumer');
  await mkdir(consumer);
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'sqlite-consumer',
    private: true,
    type: 'module',
    dependencies: { '@microdelta/machine-node': `file:${tarballs['@microdelta/machine-node']}` },
    overrides: { '@microdelta/machine': `file:${tarballs['@microdelta/machine']}` },
  }));
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', ...(ignoreScripts ? ['--ignore-scripts'] : [])], { cwd: consumer, encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  return { directory, consumer };
}

test('the installed Node SQLite capability writes, reopens and reads a temporary database', { timeout: 300_000 }, async () => {
  const { directory, consumer } = await nodeAdapterConsumer({ ignoreScripts: false });
  try {
    assert.deepEqual(verifyNodeSqlite(consumer), { written: 'microdelta release check', reopened: 'microdelta release check' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a missing native SQLite binding fails validation even though the package root imports', { timeout: 300_000 }, async () => {
  const { directory, consumer } = await nodeAdapterConsumer({ ignoreScripts: true });
  try {
    const rootImport = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('@microdelta/machine-node')"], { cwd: consumer, encoding: 'utf8' });
    assert.equal(rootImport.status, 0, `root import alone must not detect the missing binding: ${rootImport.stderr}`);
    assert.throws(() => verifyNodeSqlite(consumer), /Node SQLite capability check failed[\s\S]*(?:bindings|better_sqlite3\.node)/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
