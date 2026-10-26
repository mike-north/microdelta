/** Independent report oracles may consume public owner entries, but may never bypass their generated contracts. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';
import ts from 'typescript';

/** Exercise the same fixture-role configuration that the repository import gate runs. */
const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'tooling/context-imports.config.mjs' });
/** Virtual files use the actual fixture role so filesystem imports resolve from its owned tree. */
const importer = 'fixtures/contribution-report/probe.ts';
/** Surface only this role's import decision, independently from the test body's unused bindings. */
async function errors(source, filePath = importer) {
  const [result] = await eslint.lintText(source, { filePath });
  assert.ok(result);
  return result.messages.filter(message => message.ruleId === 'microdelta/report-fixture-imports');
}

test('report fixture role accepts generated/public entries and its concrete application, never deep owners or private aliases', async () => {
  const forms = [
    value => `import * as subject from '${value}';`,
    value => `export * from '${value}';`,
    value => `export { Subject } from '${value}';`,
    value => `void import('${value}');`,
    value => `type Subject = import('${value}').Subject;`,
    value => `import subject = require('${value}');`,
    value => `require('${value}');`,
  ];
  const allowed = ['microdelta', '@microdelta/history', '@microdelta/machine-node', '@microdelta/accounting', 'node:fs', '@jest/globals', 'tsd', './fixture.js', '../../examples/contribution-report/src/controlled/application.js', './.test-build/examples/contribution-report/src/controlled/application.js'];
  const forbidden = ['@microdelta/history/src/index.js', '@microdelta/history/dist/index.js', 'microdelta/dist/index.js', '#history-source', 'history-source-alias', '../../packages/history/src/index.js', '../../packages/history/dist/index.js', '../declarations/producer/src/index.js'];
  for (const form of forms) {
    for (const value of allowed) { assert.deepEqual(await errors(form(value)), [], `${form(value)} is public or fixture-owned`); }
    for (const value of forbidden) { assert.equal((await errors(form(value))).length, 1, `${form(value)} bypasses the declared package contract`); }
  }
});

test('fixture filesystem boundary follows ESM URL decoding for imports, re-exports and import types', async () => {
  const target = path.resolve('packages/history/src/index.js');
  const forms = [value => `import * as subject from '${value}';`, value => `export * from '${value}';`, value => `void import('${value}');`, value => `type Subject = import('${value}').Subject;`];
  for (const form of forms) {
    for (const value of [target, pathToFileURL(target).href, `${pathToFileURL(target).href}?version=1#entry`, pathToFileURL(target).href.replace('file:', 'FiLe:'), './%2e%2e/%2e%2e/packages/history/src/index.js']) {
      assert.equal((await errors(form(value))).length, 1, form(value));
    }
  }
});

test('nonliteral module edges are forbidden; lexical require parameters remain ordinary calls', async () => {
  assert.equal((await errors('void import(selected);')).length, 1);
  assert.equal((await errors('require(selected);')).length, 1);
  assert.deepEqual(await errors('function use(require: (value: string) => string): string { return require(selected); }'), []);
});

test('the executable example keeps its facade-only boundary despite the independent fixture role', async () => {
  const [result] = await eslint.lintText("import { openDurableHistory } from '@microdelta/history'; import { createNodeMachine } from '@microdelta/machine-node';", { filePath: 'examples/contribution-report/src/probe.ts' });
  assert.ok(result);
  assert.equal(result.messages.filter(message => message.ruleId === 'no-restricted-imports').length, 2);
});

test('fixture compilation resolves owner roots only through generated alpha declarations and remains strictly checked', () => {
  const config = path.resolve('fixtures/contribution-report/tsconfig.json');
  const loaded = ts.readConfigFile(config, ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(config), undefined, config);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.options.strict, true);
  assert.equal(parsed.options.skipLibCheck, false);
  assert.ok(parsed.fileNames.includes(path.resolve('fixtures/contribution-report/fixture.ts')));
  assert.ok(parsed.fileNames.includes(path.resolve('examples/contribution-report/src/controlled/application.ts')));
  assert.ok(Object.keys(parsed.options.paths).length > 0);
  for (const [name, values] of Object.entries(parsed.options.paths)) {
    assert.match(name, /^(?:microdelta|@microdelta\/[a-z][a-z0-9-]*)$/u);
    for (const value of values) { assert.match(value, /node_modules\/(?:@microdelta\/)?[a-z-]+\/dist\/api\/[a-z-]+\.alpha\.d\.ts$/u); }
  }
});

test('repository gates retain fixture compile, import enforcement, type-aware lint, runtime and generated contracts', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const script of ['build:fixtures', 'check:fixtures', 'test:controlled-report']) { assert.match(pkg.scripts[script], /fixtures\/contribution-report\/tsconfig\.json/u); }
  assert.match(pkg.scripts['check:imports'], /fixtures\/contribution-report/u);
  assert.match(pkg.scripts['check:fixtures'], /eslint fixtures\/contribution-report/u);
  assert.match(pkg.scripts['test:controlled-report'], /fixtures\/contribution-report\/jest\.config\.mjs/u);
  assert.match(pkg.scripts['test:controlled-report:types'], /\.test-build\/examples\/contribution-report\/src\/controlled\/application\.d\.ts/u);
  assert.match(pkg.scripts['test:controlled-report:workload'], /fixtures\/contribution-report\/workload-driver\.mjs/u);
  const typed = new ESLint({ cwd: process.cwd() });
  const config = await typed.calculateConfigForFile('fixtures/contribution-report/fixture.ts');
  assert.equal(config.languageOptions.parserOptions.projectService, true);
  assert.equal(config.rules['@typescript-eslint/no-unsafe-return'][0], 2);
});
