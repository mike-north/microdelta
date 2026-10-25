/**
 * Proves private-alpha declarations compose through explicit generated paths
 * while ordinary Node imports still resolve through the built workspace.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import test from 'node:test';

const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(fixtureDirectory, '../../..');

/** Compile one generated-declaration consumer configuration without emitting. */
function diagnosticsFor(configName) {
  const configPath = path.join(fixtureDirectory, configName);
  const read = ts.readConfigFile(configPath, ts.sys.readFile.bind(ts.sys));
  assert.equal(read.error, undefined, `Cannot read ${configName}`);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, fixtureDirectory, undefined, configPath);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
}

test('facade-only alpha paths expose the actual transitive TS2305 boundary', () => {
  const diagnostics = diagnosticsFor('tsconfig.alpha-facade-only.json');
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.code === 2305 && ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes('IAbortSignal')),
    'expected the alpha facade to require its imported alpha owner declarations',
  );
});

test('the explicit alpha declaration closure compiles the import-only consumer', () => {
  assert.deepEqual(diagnosticsFor('tsconfig.alpha-six.json'), []);
});

test('the sibling consumer loads the built facade through normal Node package resolution', async () => {
  const facade = await import('microdelta');
  assert.equal(typeof facade.authoring, 'function');
});

test('a consumer beside the checkout compiles with relative alpha paths and loads the package export', async (context) => {
  const siblingRoot = mkdtempSync(path.join(os.tmpdir(), 'microdelta-alpha-consumer-'));
  context.after(() => rmSync(siblingRoot, { force: true, recursive: true }));

  const checkout = path.join(siblingRoot, 'microdelta');
  symlinkSync(repositoryRoot, checkout, 'dir');
  const consumer = path.join(siblingRoot, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(path.join(consumer, 'alpha-import-only.ts'), "import { authoring } from 'microdelta';\nvoid authoring;\n");

  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      noEmitOnError: true,
      skipLibCheck: false,
      types: [],
      baseUrl: '../microdelta',
      paths: {
        microdelta: ['packages/core/dist/api/microdelta.alpha.d.ts'],
        '@microdelta/definition': ['packages/definition/dist/api/definition.alpha.d.ts'],
        '@microdelta/history': ['packages/history/dist/api/history.alpha.d.ts'],
        '@microdelta/materialization': ['packages/materialization/dist/api/materialization.alpha.d.ts'],
        '@microdelta/resolution': ['packages/resolution/dist/api/resolution.alpha.d.ts'],
        '@microdelta/supervision': ['packages/supervision/dist/api/supervision.alpha.d.ts'],
        '@microdelta/tracking': ['packages/tracking/dist/api/tracking.alpha.d.ts'],
      },
    },
    files: ['alpha-import-only.ts'],
  };
  const configPath = path.join(consumer, 'tsconfig.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const diagnostics = diagnosticsForConfig(configPath, consumer);
  assert.deepEqual(diagnostics, [], 'relative declaration mappings should compile from beside the checkout');

  const consumerModules = path.join(consumer, 'node_modules');
  mkdirSync(consumerModules);
  symlinkSync(path.join(checkout, 'packages/core'), path.join(consumerModules, 'microdelta'), 'dir');
  const runtimeProbe = path.join(consumer, 'runtime-import.mjs');
  writeFileSync(runtimeProbe, "import { authoring } from 'microdelta';\nif (typeof authoring !== 'function') throw new TypeError('Expected the built facade export');\n");
  const runtimeModule = await import(pathToFileURL(runtimeProbe).href);
  assert.notEqual(runtimeModule, undefined);
  assert.equal(JSON.stringify(config).includes(repositoryRoot), false, 'consumer configuration must not contain an absolute checkout path');
});

/** Compile a config located in an arbitrary consumer directory. */
function diagnosticsForConfig(configPath, configDirectory) {
  const read = ts.readConfigFile(configPath, ts.sys.readFile.bind(ts.sys));
  assert.equal(read.error, undefined, `Cannot read ${configPath}`);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, configDirectory, undefined, configPath);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
}
