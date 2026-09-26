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

/** The package matrix covers the facade and every implemented owner. */
const root = fileURLToPath(new URL('../', import.meta.url));
const packages = [
  { directory: 'core', basename: 'microdelta' },
  { directory: 'definition', basename: 'definition' },
  { directory: 'tracking', basename: 'tracking' },
  { directory: 'history', basename: 'history' },
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
    const compilerOptions = {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noEmit: true, skipLibCheck: false,
    };
    if (options.paths) {
      compilerOptions.baseUrl = directory;
      compilerOptions.paths = { [options.pathPackage ?? '@microdelta/fixture-producer']: [options.paths] };
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
  assert.equal(typeof definition.nameOf, 'function');
  assert.equal(typeof tracking.createTag, 'function');
  for (const name of ['microdelta/conformance/store', '@microdelta/history/conformance/store']) {
    const entry = import.meta.resolve(name);
    assert.ok((await readFile(new URL(entry))).byteLength > 0, `${name} built entry`);
  }
  assert.equal(typeof facade.createMemoryStore, 'function');
  assert.equal(facade.createMemoryStore, history.createMemoryStore);
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
