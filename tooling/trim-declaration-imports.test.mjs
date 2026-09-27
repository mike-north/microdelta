/** Release-tier rollups drop only imports made unused by declaration trimming. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/** The fixture package exercises canonical brands through actual API Extractor output. */
const root = fileURLToPath(new URL('../', import.meta.url));
const rollupTool = path.join(root, 'tooling/trim-declaration-imports.mjs');
const capturePackage = path.join(root, 'fixtures/declarations/capture-producer');
const trackingPackage = path.join(root, 'packages/tracking');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const extractor = path.join(root, 'node_modules/@microsoft/api-extractor/bin/api-extractor');

/** API Extractor produces the raw pre-cleanup rollup at the source fixture's package-relative depth. */
async function buildRawCaptureProducer() {
  const directory = await mkdtemp(path.join(root, 'fixtures/declarations/.capture-raw-'));
  for (const name of ['package.json', 'tsconfig.json', 'api-extractor.json']) {
    await cp(path.join(capturePackage, name), path.join(directory, name));
  }
  await cp(path.join(capturePackage, 'src'), path.join(directory, 'src'), { recursive: true });
  await cp(path.join(capturePackage, 'etc'), path.join(directory, 'etc'), { recursive: true });
  const compiled = spawnSync(process.execPath, [tsc, '-p', directory], { cwd: root, encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const extracted = spawnSync(process.execPath, [extractor, 'run', '--config', path.join(directory, 'api-extractor.json'), '--local'], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(extracted.status, 0, extracted.stdout + extracted.stderr);
  return directory;
}

/** Compile against installed package metadata with no source aliases or lib-check escape hatch. */
async function compileCaptureConsumer(source, tier, { trim = true, producer = capturePackage } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-capture-rollup-'));
  try {
    const packages = [
      ['@microdelta/capture-producer', producer],
      ['@microdelta/tracking', trackingPackage],
    ];
    for (const [name, producer] of packages) {
      const packageDirectory = path.join(directory, 'node_modules', name);
      await mkdir(packageDirectory, { recursive: true });
      await cp(path.join(producer, 'dist'), path.join(packageDirectory, 'dist'), { recursive: true });
      await cp(path.join(producer, 'package.json'), path.join(packageDirectory, 'package.json'));
      if (trim && name === '@microdelta/capture-producer') {
        const rollup = path.join(packageDirectory, 'dist/api', `capture.${tier}.d.ts`);
        const transformed = spawnSync(process.execPath, [rollupTool, rollup], { cwd: root, encoding: 'utf8' });
        assert.equal(transformed.status, 0, transformed.stderr || transformed.stdout);
      }
    }
    await writeFile(path.join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
    await writeFile(path.join(directory, 'consumer.ts'), source);
    const compilerOptions = {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noEmit: true, skipLibCheck: false, types: [],
    };
    if (tier === 'alpha') {
      compilerOptions.baseUrl = directory;
      compilerOptions.paths = {
        '@microdelta/capture-producer': [path.join(directory, 'node_modules/@microdelta/capture-producer/dist/api/capture.alpha.d.ts')],
        '@microdelta/tracking': [path.join(directory, 'node_modules/@microdelta/tracking/dist/api/tracking.alpha.d.ts')],
      };
    }
    await writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['consumer.ts'] }));
    const result = spawnSync(process.execPath, [tsc, '-p', directory], { cwd: root, encoding: 'utf8' });
    return { directory, result };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** The generated public rollup currently proves the orphan-import regression as exactly TS2305. */
test('unprocessed public rollup reproduces the missing alpha dependency failure', async () => {
  const rawProducer = await buildRawCaptureProducer();
  const consumer = await compileCaptureConsumer(
    "import type { IPublicCaptureProbe } from '@microdelta/capture-producer';\nconst value: IPublicCaptureProbe = { label: 'visible' };\nvoid value;\n",
    'public', { trim: false, producer: rawProducer },
  );
  try {
    const rollup = await readFile(path.join(consumer.directory, 'node_modules/@microdelta/capture-producer/dist/api/capture.public.d.ts'), 'utf8');
    assert.match(rollup, /import type \{ ITracked \} from '@microdelta\/tracking'/u, rollup);
    assert.equal(consumer.result.status, 2, consumer.result.stdout + consumer.result.stderr);
    assert.match(consumer.result.stdout + consumer.result.stderr, /TS2305/u);
    assert.doesNotMatch(consumer.result.stdout + consumer.result.stderr, /TS2694/u);
  } finally {
    await rm(consumer.directory, { recursive: true, force: true });
    await rm(rawProducer, { recursive: true, force: true });
  }
});

/** A public consumer compiles only if an alpha-only Tracking import is absent from the public rollup. */
test('public consumer compiles while the generated alpha contract remains hidden', async () => {
  const publicResult = await compileCaptureConsumer(
    "import type { IPublicCaptureProbe } from '@microdelta/capture-producer';\nconst value: IPublicCaptureProbe = { label: 'visible' };\nvoid value;\n",
    'public',
  );
  try {
    assert.equal(publicResult.result.status, 0, publicResult.result.stdout + publicResult.result.stderr);
  } finally {
    await rm(publicResult.directory, { recursive: true, force: true });
  }

  const alphaNegative = await compileCaptureConsumer(
    "import type * as Capture from '@microdelta/capture-producer';\ntype Hidden = Capture.ITrackedCaptureConfig;\ndeclare const hidden: Hidden;\nvoid hidden;\n",
    'public',
  );
  try {
    assert.equal(alphaNegative.result.status, 2, alphaNegative.result.stdout + alphaNegative.result.stderr);
    assert.match(alphaNegative.result.stdout + alphaNegative.result.stderr, /TS2694/u);
    assert.doesNotMatch(alphaNegative.result.stdout + alphaNegative.result.stderr, /TS2305/u);
  } finally {
    await rm(alphaNegative.directory, { recursive: true, force: true });
  }
});

/** Separate consumer roots prove that rollup cleanup does not clone nominal brand identity. */
test('alpha consumers retain canonical record and callable brand assignability in both directions', async () => {
  const consumer = await compileCaptureConsumer([
    "import type { ITracked } from '@microdelta/tracking';",
    "import type { ITrackedCaptureConfig } from '@microdelta/capture-producer';",
    'declare const configuration: ITrackedCaptureConfig;',
    'const canonicalInput: ITracked<{ readonly enabled: boolean; readonly rows: readonly { readonly name: string }[] }> = configuration.input;',
    'const producerInput: ITrackedCaptureConfig[\'input\'] = canonicalInput;',
    'const canonicalCallable: ITracked<(value: boolean) => boolean> = configuration.isEnabled;',
    'const producerCallable: ITrackedCaptureConfig[\'isEnabled\'] = canonicalCallable;',
    'void producerInput; void producerCallable;',
  ].join('\n'), 'alpha');
  try {
    assert.equal(consumer.result.status, 0, consumer.result.stdout + consumer.result.stderr);
  } finally {
    await rm(consumer.directory, { recursive: true, force: true });
  }
});

/** Only imports with no remaining declaration references disappear from a tier. */
test('used named, default, namespace, unique-symbol, and value-query imports remain', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-trim-imports-'));
  try {
    const filename = path.join(directory, 'input.d.ts');
    const source = [
      "import type DefaultShape from './default.js';",
      "import type * as Namespace from './namespace.js';",
      "import type { NamedShape, NominalBrand } from './named.js';",
      "import { runtimeValue } from './runtime.js';",
      'export type IDefault = DefaultShape;',
      'export type INamespace = Namespace.Value;',
      'export type INamed = NamedShape;',
      'export type INominal = NominalBrand & { readonly key: string };',
      'export type IValueQuery = typeof runtimeValue;',
    ].join('\n');
    await writeFile(filename, source);
    const result = spawnSync(process.execPath, [rollupTool, filename], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const transformed = await readFile(filename, 'utf8');
    for (const specifier of ['./default.js', './namespace.js', './named.js', './runtime.js']) {
      assert.ok(transformed.includes(`from '${specifier}'`), transformed);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** Unsupported import forms remain byte-identical on failure instead of being guessed away. */
test('side-effect and import-equals declarations fail closed without rewriting', async () => {
  for (const source of [
    "import './registration.js';\nexport interface IShape { readonly id: string }\n",
    "import Registration = require('./registration.js');\nexport type IRegistration = Registration.Value;\n",
  ]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-trim-unsupported-'));
    try {
      const filename = path.join(directory, 'input.d.ts');
      await writeFile(filename, source);
      const result = spawnSync(process.execPath, [rollupTool, filename], { cwd: root, encoding: 'utf8' });
      assert.notEqual(result.status, 0, 'Unsupported import form unexpectedly passed');
      assert.match(result.stderr, /unsupported .*import/u);
      assert.equal(await readFile(filename, 'utf8'), source);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
