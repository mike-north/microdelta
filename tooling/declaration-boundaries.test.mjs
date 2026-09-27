/**
 * PKG-003/004/007 consumer fixtures compile against generated declaration files
 * through the same package metadata and alpha paths used by real consumers.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { verifyHistoryShims } from './history-declaration-shims.mjs';

/** The package matrix covers the facade, implemented owners, and Value support contract. */
const root = fileURLToPath(new URL('../', import.meta.url));
const packages = [
  { directory: 'core', basename: 'microdelta' },
  { directory: 'definition', basename: 'definition' },
  { directory: 'tracking', basename: 'tracking' },
  { directory: 'history', basename: 'history' },
  { directory: 'value', basename: 'value' },
];
const fixture = path.join(root, 'fixtures/declarations/producer');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const tiers = ['untrimmed', 'alpha', 'beta', 'public'];

/** A clean consumer project reports compiler diagnostics without emitting JS. */
async function compile(source, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-tier-'));
  try {
    await writeFile(path.join(directory, 'package.json'), '{\"private\":true,\"type\":\"module\"}\n');
    await writeFile(path.join(directory, 'consumer.ts'), source);
    for (const file of options.extraFiles ?? []) {
      await writeFile(path.join(directory, file.name), file.contents);
    }
    if (options.external) {
      const packageDir = path.join(directory, 'node_modules/@microdelta/fixture-producer');
      await mkdir(packageDir, { recursive: true });
      await cp(path.join(fixture, 'dist'), path.join(packageDir, 'dist'), { recursive: true });
      const manifest = JSON.parse(await readFile(path.join(fixture, 'package.json'), 'utf8'));
      if (options.external === 'beta') {
        manifest.version = '0.0.0-beta.0';
        manifest.types = './dist/api/fixture.beta.d.ts';
        manifest.exports['.'].types = './dist/api/fixture.beta.d.ts';
      }
      await writeFile(path.join(packageDir, 'package.json'), `${JSON.stringify(manifest)}\n`);
    }
    for (const installedPackage of options.externalPackages ?? (options.externalPackage ? [options.externalPackage] : [])) {
      const packageName = installedPackage === 'core' ? 'microdelta' : '@microdelta/history';
      const packageDir = path.join(directory, 'node_modules', packageName);
      await mkdir(packageDir, { recursive: true });
      await cp(path.join(root, 'packages', installedPackage, 'dist'), path.join(packageDir, 'dist'), { recursive: true });
      await cp(path.join(root, 'packages', installedPackage, 'package.json'), path.join(packageDir, 'package.json'));
    }
    const compilerOptions = {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noEmit: true, skipLibCheck: false, types: options.types ?? [],
    };
    if (options.paths || options.pathMap) {
      compilerOptions.baseUrl = directory;
      compilerOptions.paths = options.pathMap ?? { [options.pathPackage ?? '@microdelta/fixture-producer']: [options.paths] };
    }
    await writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['consumer.ts'] }));
    return spawnSync(process.execPath, [tsc, '-p', directory], { cwd: root, encoding: 'utf8' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A failing compiler fixture must fail on an export boundary, not missing setup. */
function rejected(result, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly compiled`);
  assert.match(result.stdout + result.stderr, /TS2305/u, `${label}: ${result.stdout}${result.stderr}`);
}

test('actual packages and fixture producer generate all release views and API reports', () => {
  for (const { directory, basename } of packages) {
    for (const tier of tiers) {
      const filename = path.join(root, `packages/${directory}/dist/api/${basename}.${tier}.d.ts`);
      assert.ok(existsSync(filename), `Missing generated ${tier} view: ${filename}`);
    }
    assert.ok(existsSync(path.join(root, `packages/${directory}/etc/${basename}.api.md`)), `${basename} API report`);
  }
  for (const tier of tiers) {
    assert.ok(existsSync(path.join(fixture, `dist/api/fixture.${tier}.d.ts`)), `Fixture ${tier} view`);
  }
  assert.ok(existsSync(path.join(fixture, 'etc/fixture.api.md')), 'Fixture API report');
});

/** A public compatibility subpath is a reviewed declaration surface as well. */
test('Store conformance subpaths use closed generated release tiers', async () => {
  for (const { directory, basename } of packages.filter(({ directory }) => ['core', 'history'].includes(directory))) {
    const packageDir = path.join(root, 'packages', directory);
    const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
    const publicPath = `./dist/api/${basename}.conformance.store.public.d.ts`;
    assert.equal(manifest.exports['./conformance/store'].types, publicPath);
    for (const tier of tiers) {
      assert.ok(existsSync(path.join(packageDir, `dist/api/${basename}.conformance.store.${tier}.d.ts`)), `${basename} conformance ${tier} view`);
    }
    assert.ok(existsSync(path.join(packageDir, `etc/${basename}.conformance.store.api.md`)), `${basename} conformance API report`);
    const publicView = await readFile(path.join(packageDir, publicPath), 'utf8');
    assert.doesNotMatch(publicView, /\.\.\/.*(?:src|test)\//u, `${basename} conformance public types escape their rollup`);
  }
});

/** A normal consumer resolves the published subpath, not compiler test output. */
test('external Store conformance consumers use the public package export', async () => {
  for (const [directory, packageName] of [['core', 'microdelta'], ['history', '@microdelta/history']]) {
    const result = await compile(`import { storeConformance, type StoreConformanceOptions } from '${packageName}/conformance/store';\nconst options: StoreConformanceOptions | undefined = undefined;\nvoid storeConformance;\nvoid options;\n`, { externalPackages: directory === 'core' ? ['core', 'history'] : ['history'] });
    assert.equal(result.status, 0, `${packageName} conformance public import: ${result.stdout}${result.stderr}`);
  }
});

/** The facade and its compatibility subpath preserve History's opaque brand. */
test('normal package consumers compose facade, History, and conformance types', async () => {
  const source = [
    "import { createMemoryStore, type Fingerprint as FacadeFingerprint, type Store as FacadeStore } from 'microdelta';",
    "import { type Fingerprint as HistoryFingerprint, type Store as HistoryStore } from '@microdelta/history';",
    "import { storeConformance } from 'microdelta/conformance/store';",
    "import { storeConformance as historyConformance } from '@microdelta/history/conformance/store';",
    'declare const fingerprint: HistoryFingerprint;',
    'const facadeFingerprint: FacadeFingerprint = fingerprint;',
    'const facadeStore: FacadeStore = createMemoryStore();',
    'const historyStore: HistoryStore = createMemoryStore();',
    "storeConformance('consumer', { fingerprintAlgorithm: 'sha256', create: () => createMemoryStore() });",
    "historyConformance('consumer', { fingerprintAlgorithm: 'sha256', create: () => createMemoryStore() });",
    'void facadeFingerprint; void facadeStore; void historyStore;',
  ].join('\n');
  const result = await compile(source, { externalPackages: ['core', 'history'] });
  assert.equal(result.status, 0, `Public Store type identity diverged: ${result.stdout}${result.stderr}`);
  for (const packageName of ['microdelta', '@microdelta/history']) {
    for (const symbol of ['storeConformance', 'StoreConformanceOptions', 'ValueReadProbe']) {
      rejected(await compile(`import { ${symbol} } from '${packageName}';\nvoid ${symbol};\n`, { externalPackages: ['core', 'history'] }), `${packageName} root gained ${symbol}`);
    }
  }
  const bareString = await compile("import { type Fingerprint } from '@microdelta/history';\nconst fingerprint: Fingerprint = 'ordinary string';\nvoid fingerprint;\n", { externalPackages: ['history'] });
  assert.notEqual(bareString.status, 0, 'The History fingerprint brand accepted an ordinary string');
  assert.match(bareString.stdout + bareString.stderr, /TS2322/u);
});

test('own untrimmed consumer sees internal exports but not unexported source', async () => {
  const view = path.join(fixture, 'dist/api/fixture.untrimmed.d.ts');
  const positive = await compile("import { _internalValue } from '@microdelta/fixture-producer';\nconst value: string = _internalValue();\n", { paths: view });
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  rejected(await compile("import { hiddenValue } from '@microdelta/fixture-producer';\nvoid hiddenValue;\n", { paths: view }), 'unexported source');
});

test('approved sibling uses only alpha declarations', async () => {
  const view = path.join(fixture, 'dist/api/fixture.alpha.d.ts');
  const positive = await compile("import { alphaValue, betaValue, publicValue } from '@microdelta/fixture-producer';\nconst values: string[] = [alphaValue(), betaValue(), publicValue()];\n", { paths: view });
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  rejected(await compile("import { _internalValue } from '@microdelta/fixture-producer';\nvoid _internalValue;\n", { paths: view }), 'sibling internal export');
});

test('normal external package resolution exposes public only', async () => {
  const positive = await compile("import { publicValue } from '@microdelta/fixture-producer';\nconst value: string = publicValue();\n", { external: 'public' });
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  for (const symbol of ['betaValue', 'alphaValue', '_internalValue']) {
    rejected(await compile(`import { ${symbol} } from '@microdelta/fixture-producer';\nvoid ${symbol};\n`, { external: 'public' }), `public consumer ${symbol}`);
  }
});

test('separately selected beta package version exposes beta and public only', async () => {
  const positive = await compile("import { betaValue, publicValue } from '@microdelta/fixture-producer';\nconst values: string[] = [betaValue(), publicValue()];\n", { external: 'beta' });
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  for (const symbol of ['alphaValue', '_internalValue']) {
    rejected(await compile(`import { ${symbol} } from '@microdelta/fixture-producer';\nvoid ${symbol};\n`, { external: 'beta' }), `beta consumer ${symbol}`);
  }
});

test('legitimate runtime package imports resolve built JS without TS path rewriting', async () => {
  const facade = await import('microdelta');
  const history = await import('@microdelta/history');
  const definition = await import('@microdelta/definition');
  const tracking = await import('@microdelta/tracking');
  const machineNode = await import('@microdelta/machine-node');
  assert.equal(typeof definition.nameOf, 'function');
  assert.equal(typeof tracking.createTracking, 'function');
  assert.equal(typeof machineNode.createNodeMachine, 'function');
  for (const name of ['microdelta/conformance/store', '@microdelta/history/conformance/store']) {
    const entry = import.meta.resolve(name);
    assert.ok((await readFile(new URL(entry))).byteLength > 0, `${name} built entry`);
  }
  assert.equal(typeof facade.createMemoryStore, 'function');
  assert.equal(typeof history.createMemoryStore, 'function');
});

/** Every production trimmed view must stand alone under full library checking. */
test('each actual package declaration view typechecks without hidden references', async () => {
  for (const { directory, basename } of packages) {
    const packageName = directory === 'core' ? 'microdelta' : `@microdelta/${directory}`;
    for (const tier of tiers) {
      const view = path.join(root, `packages/${directory}/dist/api/${basename}.${tier}.d.ts`);
      const source = `type ISurface = typeof import('${packageName}');\nconst surface: ISurface | undefined = undefined;\nvoid surface;\n`;
      const result = await compile(source, { paths: view, pathPackage: packageName });
      assert.equal(result.status, 0, `${packageName}/${tier}: ${result.stdout}${result.stderr}`);
    }
  }
  for (const [directory, basename] of [['core', 'microdelta'], ['history', 'history']]) {
    const packageName = directory === 'core' ? 'microdelta' : '@microdelta/history';
    for (const tier of tiers) {
      const view = path.join(root, `packages/${directory}/dist/api/${basename}.conformance.store.${tier}.d.ts`);
      const alias = `${packageName}/conformance/store`;
      const source = `type ISurface = typeof import('${alias}');\nconst surface: ISurface | undefined = undefined;\nvoid surface;\n`;
      const result = await compile(source, { paths: view, pathPackage: alias });
      assert.equal(result.status, 0, `${alias}/${tier}: ${result.stdout}${result.stderr}`);
    }
  }
});

/** Both History entries in one tier resolve the same opaque Store identity. */
test('each History release tier composes root and conformance callbacks', async () => {
  for (const tier of tiers) {
    const api = path.join(root, 'packages/history/dist/api');
    const result = await compile("import { createMemoryStore } from '@microdelta/history';\nimport { storeConformance } from '@microdelta/history/conformance/store';\nconst snapshot = { snapshot<T>(value: T): T { return value; } };\nstoreConformance('tier', { fingerprintAlgorithm: 'sha256', create: () => createMemoryStore(snapshot) });\n", {
      pathMap: {
        '@microdelta/history': [path.join(api, `history.${tier}.d.ts`)],
        '@microdelta/history/conformance/store': [path.join(api, `history.conformance.store.${tier}.d.ts`)],
      },
    });
    assert.equal(result.status, 0, `${tier} History entries diverged: ${result.stdout}${result.stderr}`);
  }
});

/** Checked shims cannot point at a more permissive or missing shared tier. */
test('History entry shims fail closed on wrong tier, missing canonical, and export drift', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-history-shims-'));
  try {
    const api = path.join(directory, 'dist/api');
    await mkdir(path.dirname(api), { recursive: true });
    await cp(path.join(root, 'packages/history/dist/api'), api, { recursive: true });
    await verifyHistoryShims(directory);
    const shim = path.join(api, 'history.public.d.ts');
    const original = await readFile(shim, 'utf8');
    await writeFile(shim, original.replace('history.shared.public.js', 'history.shared.untrimmed.js'));
    await assert.rejects(verifyHistoryShims(directory), /wrong tier|does not match/iu);
    await writeFile(shim, original);
    await rm(path.join(api, 'history.shared.public.d.ts'));
    await assert.rejects(verifyHistoryShims(directory), /ENOENT|missing canonical/iu);
    await cp(path.join(root, 'packages/history/dist/api/history.shared.public.d.ts'), path.join(api, 'history.shared.public.d.ts'));
    const raw = path.join(api, 'history.root.raw.public.d.ts');
    const rawOriginal = await readFile(raw, 'utf8');
    await writeFile(raw, `${rawOriginal}\nexport declare const invented: string;\n`);
    await assert.rejects(verifyHistoryShims(directory), /absent or mismatched/iu);
    await writeFile(raw, `${rawOriginal}\nexport { ResultKey as AlternateResultKey };\n`);
    await assert.rejects(verifyHistoryShims(directory), /Unsupported declaration re-export/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Compiler paths must exist before resolution and never point at sibling source. */
test('missing producer declarations and test-only source aliases fail explicitly', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-missing-alpha-'));
  try {
    const installed = path.join(directory, 'node_modules/@microdelta/fixture-producer');
    await mkdir(path.join(installed, 'src'), { recursive: true });
    await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: '@microdelta/fixture-producer', types: './src/index.ts' }));
    await writeFile(path.join(installed, 'src/index.ts'), 'export const alphaValue = (): string => "source fallback";\n');
    const config = path.join(directory, 'tsconfig.json');
    const gate = path.join(root, 'tooling/check-producer-declarations.mjs');
    await writeFile(config, JSON.stringify({ compilerOptions: { paths: {
      '@microdelta/fixture-producer': ['./missing/fixture.alpha.d.ts'],
    } } }));
    let result = spawnSync(process.execPath, [gate, '--config', config], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Missing alpha declaration fell through to installed source package');
    assert.match(result.stdout + result.stderr, /missing producer declaration/iu);
    await writeFile(config, JSON.stringify({ compilerOptions: { paths: {
      '@source/fixture': ['./node_modules/@microdelta/fixture-producer/src/index.ts'],
    } } }));
    result = spawnSync(process.execPath, [gate, '--config', config], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Test-only alias reached sibling source');
    assert.match(result.stdout + result.stderr, /source alias|sibling source/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Value's sibling path is checked against the generated alpha artifact. */
test('a missing Value alpha declaration fails for its declared package path', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-value-alpha-'));
  try {
    const packageDir = path.join(directory, 'packages', 'tracking');
    await mkdir(packageDir, { recursive: true });
    const config = path.join(packageDir, 'tsconfig.json');
    const gate = path.join(root, 'tooling/check-producer-declarations.mjs');
    await writeFile(config, JSON.stringify({ compilerOptions: { paths: {
      '@microdelta/value': ['./missing/value.alpha.d.ts'],
    } }, files: [] }));
    const result = spawnSync(process.execPath, [gate, '--config', config], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Missing Value alpha declaration unexpectedly passed preflight');
    assert.match(result.stdout + result.stderr, /missing producer declaration.*value\.alpha\.d\.ts/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A compiler's effective config and import spelling must agree with its owner. */
test('inherited paths and invented aliases cannot expose sibling source or untrimmed declarations', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-path-bypass-'));
  try {
    const gate = path.join(root, 'tooling/check-producer-declarations.mjs');
    const history = path.join(root, 'packages/history/dist/api/history.untrimmed.d.ts');
    const config = path.join(directory, 'tsconfig.json');
    const shared = path.join(directory, 'shared-options.json');
    await writeFile(path.join(directory, 'sibling.ts'), 'export const privateValue = 1;\n');
    await writeFile(shared, JSON.stringify({ compilerOptions: { paths: {
      'private-history': ['./sibling.ts'],
    } } }));
    await writeFile(config, JSON.stringify({ extends: './shared-options.json', files: [] }));
    let result = spawnSync(process.execPath, [gate, '--config', config], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Inherited source alias escaped declaration preflight');
    assert.match(result.stdout + result.stderr, /source alias|approved package|declared package/iu);

    await writeFile(config, JSON.stringify({ compilerOptions: { paths: {
      'private-history': [history],
    } }, files: [] }));
    result = spawnSync(process.execPath, [gate, '--config', config], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Invented alias exposed an existing untrimmed declaration');
    assert.match(result.stdout + result.stderr, /approved package|declared package|alias/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Actual facade source consumes History's approved alpha entry and subpath. */
test('facade compiler maps both History imports to generated alpha declarations', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'packages/core/tsconfig.json'), 'utf8'));
  assert.deepEqual(config.compilerOptions.paths, {
    '@microdelta/history': ['../history/dist/api/history.alpha.d.ts'],
    '@microdelta/history/conformance/store': ['../history/dist/api/history.conformance.store.alpha.d.ts'],
    '@microdelta/machine-node': ['../machine-node/dist/api/machine-node.alpha.d.ts'],
    '@microdelta/tracking': ['../tracking/dist/api/tracking.alpha.d.ts'],
  });
});

/** Public context declarations must remain usable without ambient Node types. */
test('generated Machine, Tracking, History, and Value declarations compile as portable consumers', async () => {
  const source = [
    "import { createTracking } from '@microdelta/tracking';",
    "import { createMemoryStore } from '@microdelta/history';",
    "import { createNodeMachine } from '@microdelta/machine-node';",
    "import { encodeValue, fingerprint, type ISha256Capability } from '@microdelta/value';",
    "import type { IAsyncContextCapability } from '@microdelta/machine';",
    'const host = createNodeMachine();',
    'const context: IAsyncContextCapability = host;',
    'const hasher: ISha256Capability = host;',
    'createTracking(context);',
    'createMemoryStore(host);',
    "fingerprint(encodeValue('Ada'), hasher);",
  ].join('\n');
  const api = path.join(root, 'packages');
  const result = await compile(source, { types: [], pathMap: {
    '@microdelta/machine': [path.join(api, 'machine/dist/api/machine.alpha.d.ts')],
    '@microdelta/machine-node': [path.join(api, 'machine-node/dist/api/machine-node.alpha.d.ts')],
    '@microdelta/value': [path.join(api, 'value/dist/api/value.alpha.d.ts')],
    '@microdelta/tracking': [path.join(api, 'tracking/dist/api/tracking.alpha.d.ts')],
    '@microdelta/history': [path.join(api, 'history/dist/api/history.alpha.d.ts')],
  } });
  assert.equal(result.status, 0, `Portable package consumer failed: ${result.stdout}${result.stderr}`);
});

/** A generated declaration cannot pull an implicit Node ambient type into a consumer. */
test('types-empty consumers reject a deliberate Node declaration leak', async () => {
  const result = await compile("import type { ILeaked } from './node-leak.js';\nexport const value: ILeaked | undefined = undefined;\n", {
    types: [],
    extraFiles: [{ name: 'node-leak.d.ts', contents: 'export interface ILeaked { readonly timer: NodeJS.Timeout; }\n' }],
  });
  assert.notEqual(result.status, 0, 'Node ambient declaration leak unexpectedly compiled');
  assert.match(result.stdout + result.stderr, /NodeJS|TS2503/u);
});

/** A generated declaration is still forbidden when its tier or edge is wrong. */
test('real package configs reject wrong sibling tiers and forbidden context edges', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-wrong-tier-'));
  try {
    const gate = path.join(root, 'tooling/check-producer-declarations.mjs');
    const view = path.join(root, 'packages/history/dist/api/history.untrimmed.d.ts');
    for (const [owner, target] of [['core', view], ['tracking', path.join(root, 'packages/history/dist/api/history.alpha.d.ts')]]) {
      const packageDir = path.join(directory, 'packages', owner);
      await mkdir(packageDir, { recursive: true });
      const config = path.join(packageDir, 'tsconfig.json');
      await writeFile(config, JSON.stringify({ compilerOptions: { paths: {
        '@microdelta/history': [target],
      } }, files: [] }));
      const result = spawnSync(process.execPath, [gate, '--config', config], { cwd: root, encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${owner} imported History through an unapproved edge or tier`);
      assert.match(result.stdout + result.stderr, /unapproved.*alias or tier/iu);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A package with no source imports still needs an explicitly owned role. */
test('unknown package compiler config fails closed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-unknown-owner-'));
  try {
    const packageDir = path.join(directory, 'packages/unknown');
    await mkdir(packageDir, { recursive: true });
    const config = path.join(packageDir, 'tsconfig.json');
    await writeFile(config, JSON.stringify({ files: [] }));
    const result = spawnSync(process.execPath, [path.join(root, 'tooling/check-producer-declarations.mjs'), '--config', config], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Unknown package config escaped owner registry');
    assert.match(result.stdout + result.stderr, /unknown package or context/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
