/** TRK-4's declared capture syntax is checked against real TypeScript programs. */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import ts from 'typescript';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';

import { trackedCaptures } from './tracked-captures.mjs';

/** The core project resolves Tracking and producer consumers through generated alpha declarations. */
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'fixtures/declarations/consumer-alpha/src/tracked-captures.fixture.ts');
const consumerConfig = path.join(root, 'fixtures/declarations/consumer-alpha/tsconfig.json');

test('alpha consumer resolves real generated producer and Tracking declarations', () => {
  const config = ts.readConfigFile(consumerConfig, ts.sys.readFile.bind(ts.sys));
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(consumerConfig), undefined, consumerConfig);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const sources = program.getSourceFiles().map(source => source.fileName.replaceAll('\\\\', '/'));
  assert.ok(sources.some(source => source.endsWith('/packages/tracking/dist/api/tracking.alpha.d.ts')), sources.join('\n'));
  assert.ok(sources.some(source => source.endsWith('/fixtures/declarations/capture-producer/dist/api/capture.alpha.d.ts')), sources.join('\n'));
  assert.ok(sources.some(source => source.endsWith('/fixtures/declarations/forged/dist/api/forged.alpha.d.ts')), sources.join('\n'));
});

test('typed capture fixture accepts branded influences and flags each documented negative', async () => {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintFiles([fixture]);
  assert.ok(result, 'ESLint should return the real TypeScript fixture result');
  assert.deepEqual(result.messages, [], JSON.stringify(result.messages, null, 2));
  const findings = result.suppressedMessages.filter(message => message.ruleId === 'microdelta/tracked-captures');
  assert.ok(findings.length >= 10, JSON.stringify(result.suppressedMessages, null, 2));
  assert.ok(findings.some(message => /External influence 'extracted'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'maybe'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'configuration'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'externalFlag'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'scalarCell'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'externalHelper'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'fake'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'forged'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'Object'/u.test(message.message)));
  assert.ok(findings.some(message => /External influence 'Math'/u.test(message.message)));
  assert.ok(findings.some(message => /outside the linted direct-callback syntax/u.test(message.message)));
});

test('typed capture checking fails closed when parser services have no TypeScript program', async () => {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { microdelta: { rules: { 'tracked-captures': trackedCaptures } } },
      rules: { 'microdelta/tracked-captures': 'error' },
    }],
  });
  const [result] = await eslint.lintText('export const ordinary = 1;\n', { filePath: fixture });
  assert.ok(result);
  assert.equal(result.messages.length, 1, JSON.stringify(result.messages, null, 2));
  assert.equal(result.messages[0]?.messageId, 'missingTypes');
});

test('shadowed Math methods do not inherit global builtin authority', async () => {
  const eslint = new ESLint({ cwd: root });
  const source = [
    "import type { ITrackingObserver } from '@microdelta/tracking';",
    'declare const observer: ITrackingObserver;',
    'declare const helper: (...values: number[]) => number;',
    "const Math: Pick<typeof globalThis.Math, 'max'> = { max: helper };",
    'observer.capture(() => Math.max(1, 2));',
  ].join('\n');
  const [result] = await eslint.lintText(source, { filePath: fixture });
  assert.ok(result);
  assert.equal(result.messages.length, 1, JSON.stringify(result.messages, null, 2));
  assert.match(result.messages[0]?.message ?? '', /External influence 'Math'/u);
});

test('immutable language globals are allowed while callback-local shadows remain captures', async () => {
  const eslint = new ESLint({ cwd: root });
  const source = [
    "import type { ITrackingObserver } from '@microdelta/tracking';",
    'declare const observer: ITrackingObserver;',
    'observer.capture(() => [undefined, NaN, Infinity]);',
    '{ const undefined = 1; observer.capture(() => undefined); }',
  ].join('\n');
  const [result] = await eslint.lintText(source, { filePath: fixture });
  assert.ok(result);
  assert.equal(result.messages.length, 1, JSON.stringify(result.messages, null, 2));
  assert.match(result.messages[0]?.message ?? '', /External influence 'undefined'/u);
});

test('callback receiver access is diagnosed as outside the supported capture syntax', async () => {
  const eslint = new ESLint({ cwd: root });
  const source = [
    "import type { ITrackingObserver } from '@microdelta/tracking';",
    'declare const observer: ITrackingObserver;',
    'class Holder { value = 1; run() { return observer.capture(() => this.value); } }',
  ].join('\n');
  const [result] = await eslint.lintText(source, { filePath: fixture });
  assert.ok(result);
  assert.equal(result.messages.length, 1, JSON.stringify(result.messages, null, 2));
  assert.match(result.messages[0]?.message ?? '', /outside the linted direct-callback syntax/u);
});

test('literal-computed canonical observer boundaries are diagnosed as unsupported syntax', async () => {
  const eslint = new ESLint({ cwd: root });
  const source = [
    "import type { ITrackingObserver } from '@microdelta/tracking';",
    'declare const observer: ITrackingObserver;',
    'declare const external: boolean;',
    "observer['capture'](() => external);",
  ].join('\n');
  const [result] = await eslint.lintText(source, { filePath: fixture });
  assert.ok(result);
  assert.equal(result.messages.length, 1, JSON.stringify(result.messages, null, 2));
  assert.match(result.messages[0]?.message ?? '', /outside the linted direct-callback syntax/u);
});

test('Tracking source programs retain capture checks when the separate ITracking declaration is present', async () => {
  const eslint = new ESLint({ cwd: root });
  const source = [
    "import type { ITrackingObserver } from '../src/index.js';",
    'declare const observer: ITrackingObserver;',
    'declare const untracked: boolean;',
    'observer.capture(() => untracked);',
  ].join('\n');
  const [result] = await eslint.lintText(source, {
    filePath: path.join(root, 'packages/tracking/test/observer.test.ts'),
  });
  assert.ok(result);
  assert.equal(result.messages.length, 1, JSON.stringify(result.messages, null, 2));
  assert.match(result.messages[0]?.message ?? '', /External influence 'untracked'/u);
});
