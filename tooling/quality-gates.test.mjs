/**
 * The quality-gate fixtures exercise the actual compiler and ESLint entrypoints
 * for source, test, and live experiment code without checking in invalid TS.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { ESLint } from 'eslint';

/** The checkout root anchors probes to the same paths that normal checks cover. */
const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Each scope must have compiler and lint coverage, including future experiments. */
const scopes = [
  { name: 'production', directory: 'packages/definition/src', project: 'packages/definition/tsconfig.json' },
  { name: 'test', directory: 'packages/history/test', project: 'packages/history/tsconfig.json' },
  { name: 'experiment', directory: 'experiments', project: 'tsconfig.json' },
];

/** Temporary probes keep intentionally invalid programs out of normal builds. */
async function withProbe(scope, source, inspect, extension = '.ts') {
  const directory = path.join(root, scope.directory);
  const file = path.join(directory, `quality-probe-${randomUUID()}${extension}`);
  await mkdir(directory, { recursive: true });
  await writeFile(file, source);
  try {
    return await inspect(file);
  } finally {
    await rm(file);
  }
}

/** Compiler diagnostics are checked by code, not by phrasing that can drift. */
function compilerResult(project) {
  return spawnSync(process.execPath, [tsc, '--noEmit', '-p', project], {
    cwd: root,
    encoding: 'utf8',
  });
}

/** ESLint runs its checked-in config against each real scoped file path. */
async function lint(file) {
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintFiles([file]);
  assert.ok(result, `Expected an ESLint result for ${file}`);
  return result.messages.map(message => message.ruleId);
}

for (const scope of scopes) {
  test(`${scope.name}: implicit any fails strict compilation`, async () => {
    await withProbe(scope, 'export function missingType(value) { return value; }\n', async () => {
      const result = compilerResult(scope.project);
      assert.notEqual(result.status, 0, `${scope.name}: implicit any unexpectedly compiled`);
      assert.match(result.stdout + result.stderr, /TS7006/, `${scope.name}: ${result.stdout}${result.stderr}`);
    });
  });

  test(`${scope.name}: explicit any and a floating promise fail lint`, async () => {
    await withProbe(scope, 'export const escaped: any = 1;\nPromise.resolve();\n', async file => {
      const rules = await lint(file);
      assert.ok(rules.includes('@typescript-eslint/no-explicit-any'), `${scope.name}: ${rules}`);
      assert.ok(rules.includes('@typescript-eslint/no-floating-promises'), `${scope.name}: ${rules}`);
    });
  });

  test(`${scope.name}: unknown narrowing and an awaited promise pass`, async () => {
    const source = 'export function label(value: unknown): string { return typeof value === "string" ? value : "unknown"; }\nexport async function done(): Promise<void> { await Promise.resolve(); }\n';
    await withProbe(scope, source, async file => {
      const result = compilerResult(scope.project);
      assert.equal(result.status, 0, `${scope.name}: ${result.stdout}${result.stderr}`);
      assert.deepEqual(await lint(file), [], scope.name);
    });
  });
}

test('undocumented TS and ESLint suppressions and broad double assertions fail lint', async () => {
  const scope = scopes[0];
  const source = '// @ts-expect-error\nconst mismatch: number = "wrong";\n// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst escaped: any = mismatch;\nexport const unchecked = mismatch as unknown as string;\n';
  await withProbe(scope, source, async file => {
    const rules = await lint(file);
    assert.ok(rules.includes('@typescript-eslint/ban-ts-comment'), `${rules}`);
    assert.ok(rules.includes('microdelta/documented-suppressions'), `${rules}`);
    assert.ok(rules.includes('no-restricted-syntax'), `${rules}`);
    const check = spawnSync(npm, ['run', 'check:suppressions'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(check.status, 0);
    assert.match(check.stdout + check.stderr, /specific reason|undocumented suppression/iu);
  });
});

test('specific suppression explanations pass lint', async () => {
  const scope = scopes[0];
  const source = '// @ts-expect-error: The fixture intentionally supplies the wrong field type.\nconst mismatch: number = "wrong";\n// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Boundary shape is intentionally untyped in this fixture.\nconst escaped: any = mismatch;\nexport const retained: unknown = escaped;\n';
  await withProbe(scope, source, async file => {
    assert.deepEqual(await lint(file), []);
    const check = spawnSync(npm, ['run', 'check:suppressions'], { cwd: root, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
  });
});


/** Active package files must not disappear from the lint gate when moved. */
test('a new package TS location fails closed without a compiler program', async () => {
  const scope = { name: 'unconfigured', directory: 'packages/core/extra' };
  await withProbe(scope, 'export const value: unknown = 1;\n', async () => {
    const result = spawnSync(npm, ['run', 'check:lint', '--workspace', 'microdelta'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'A new package TS file must not be silently skipped');
    assert.match(result.stdout + result.stderr, /project service|not found by.*project|parsing error/iu);
  });
});

/** The workspace command must detect violations in nested live experiments. */
test('workspace check covers a newly nested experiment', async () => {
  const scope = { name: 'nested experiment', directory: 'experiments/nested' };
  await withProbe(scope, 'export const escaped: any = 1;\n', async () => {
    const result = spawnSync(npm, ['run', 'check:experiments'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'The live experiment check must reject explicit any');
    assert.match(result.stdout + result.stderr, /no-explicit-any/u);
  });
});

test('strict optional, indexed, and declaration checks reject their counterexamples', async () => {
  const scope = scopes[0];
  const optionalAndIndex = 'interface IOption { value?: string }\nexport const option: IOption = { value: undefined };\nexport const first: string = ["one"][1];\n';
  await withProbe(scope, optionalAndIndex, async () => {
    const result = compilerResult(scope.project);
    assert.match(result.stdout + result.stderr, /TS2375/u);
    assert.match(result.stdout + result.stderr, /TS2322/u);
  });
  await withProbe(scope, 'declare const impossible: MissingLibraryType;\nexport {};\n', async () => {
    const result = compilerResult(scope.project);
    assert.match(result.stdout + result.stderr, /TS2304/u);
  }, '.d.ts');
});

test('file-wide ESLint disable cannot hide active TS violations', async () => {
  await withProbe(scopes[0], '/* eslint-disable */\nexport const escaped: any = 1;\n', async file => {
    const rules = await lint(file);
    const check = spawnSync(npm, ['run', 'check:suppressions'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(check.status, 0, `File-wide disable escaped: ${rules}`);
    assert.match(check.stdout + check.stderr, /file-wide.*disable/iu);
  });
});

/** Type-contract fixtures are tests even though tsd builds their declarations later. */
test('type-contract test files receive explicit-any and floating-promise lint', async () => {
  const scope = { name: 'type test', directory: 'packages/core/test-d' };
  await withProbe(scope, 'export const escaped: any = 1;\nPromise.resolve();\n', async file => {
    const rules = await lint(file);
    assert.ok(rules.includes('@typescript-eslint/no-explicit-any'), `${rules}`);
    assert.ok(rules.includes('@typescript-eslint/no-floating-promises'), `${rules}`);
  });
});

test('unsafe JSON values cannot escape through typed returns or arguments', async () => {
  const source = 'export function result(): { value: string } { return JSON.parse("{}"); }\nfunction consume(value: { value: string }): void { void value; }\nconsume(JSON.parse("{}"));\n';
  await withProbe(scopes[0], source, async file => {
    const rules = await lint(file);
    assert.ok(rules.includes('@typescript-eslint/no-unsafe-return'), `${rules}`);
    assert.ok(rules.includes('@typescript-eslint/no-unsafe-argument'), `${rules}`);
  });
});

test('unsupported live TypeScript extensions fail the checked command', async () => {
  for (const extension of ['.mts', '.cts', '.tsx']) {
    await withProbe({ name: 'alternate syntax', directory: 'experiments/nested' }, 'export const value: unknown = 1;\n', async () => {
      const result = spawnSync(npm, ['run', 'check:suppressions'], { cwd: root, encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${extension} escaped all active checks`);
      assert.match(result.stdout + result.stderr, /unsupported TypeScript extension/iu);
    }, extension);
  }
});

/** Only actual compiler directives count; source text may discuss them freely. */
test('suppression scan ignores template, regexp, and explanatory prose text', async () => {
  const source = [
    'export const template = `prefix ${1}',
    '// @ts-ignore',
    'suffix`;',
    'export const regexp = /\\/\\/ @ts-ignore/u;',
    '// This comment describes why @ts-ignore is forbidden.',
  ].join('\n');
  await withProbe(scopes[0], source, async () => {
    const result = spawnSync(npm, ['run', 'check:suppressions'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

/** Production lint combines type information with the existing import boundary. */
test('configured type-aware lint retains component dependency enforcement', async () => {
  await withProbe(scopes[0], 'import { createMemoryStore } from "@microdelta/history";\nvoid createMemoryStore;\n', async file => {
    const rules = await lint(file);
    assert.ok(rules.includes('microdelta/context-imports'), `${rules}`);
  });
});

/** Inline ESLint rule configuration cannot turn off the checked default. */
test('inline ESLint severity changes fail the independent suppression check', async () => {
  const source = '/* eslint @typescript-eslint/no-explicit-any: "off" */\nexport const escaped: any = 1;\n';
  await withProbe(scopes[0], source, async () => {
    const result = spawnSync(npm, ['run', 'check:suppressions'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Inline rule configuration bypassed the checked lint policy');
    assert.match(result.stdout + result.stderr, /inline ESLint rule configuration/iu);
  });
});

/** Both TypeScript assertion spellings can otherwise hide an unchecked bridge. */
test('double assertions through unknown fail for as, angle, and mixed spellings', async () => {
  const variants = [
    'export const asForm = 123 as unknown as string;',
    'export const angleForm = <string><unknown>123;',
    'export const outerAngle = <string>(123 as unknown);',
    'export const outerAs = (<unknown>123) as string;',
  ];
  await withProbe(scopes[0], `${variants.join('\n')}\n`, async file => {
    const rules = await lint(file);
    assert.equal(rules.filter(rule => rule === 'no-restricted-syntax').length, variants.length, `${rules}`);
  });
});
