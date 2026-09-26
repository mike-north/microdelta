/**
 * API Extractor policy probes mutate an isolated fixture package so release-tag
 * and report failures are attributable to the real declaration generator.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/** All probes use the checked fixture and the pinned tool binaries. */
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'fixtures/declarations/producer');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const extractor = path.join(root, 'node_modules/@microsoft/api-extractor/bin/api-extractor');

/** Isolated copies let negative API changes fail without editing reviewed reports. */
async function withProducer(inspect) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-api-policy-'));
  try {
    await mkdir(path.join(directory, 'src'), { recursive: true });
    await mkdir(path.join(directory, 'etc'), { recursive: true });
    for (const filename of ['package.json', 'tsconfig.json', 'api-extractor.json']) {
      await cp(path.join(fixture, filename), path.join(directory, filename));
    }
    const sourceFile = path.join(directory, 'src/index.ts');
    await cp(path.join(fixture, 'src/index.ts'), sourceFile);
    return await inspect({ directory, sourceFile });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Compile first so API Extractor sees the same declaration input as CI. */
function extract(directory, local = false) {
  const compiled = spawnSync(process.execPath, [tsc, '-p', path.join(directory, 'tsconfig.json')], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  return spawnSync(process.execPath, [extractor, 'run', '--config', path.join(directory, 'api-extractor.json'), ...(local ? ['--local'] : [])], {
    cwd: root, encoding: 'utf8',
  });
}

test('API Extractor rejects unclassified exports and internal names without underscore', async () => {
  for (const [extra, expected] of [
    ["export const unclassified = 'x';", /ae-missing-release-tag/u],
    ["/** An own-package diagnostic. @internal */ export const badInternal = 'x';", /ae-internal-missing-underscore/u],
  ]) {
    await withProducer(async ({ directory, sourceFile }) => {
      await writeFile(sourceFile, `${await readFile(sourceFile, 'utf8')}\n${extra}\n`);
      const result = extract(directory, true);
      assert.notEqual(result.status, 0, `${extra} unexpectedly passed API Extractor`);
      assert.match(result.stdout + result.stderr, expected);
    });
  }
});

test('public, beta, and alpha declarations cannot leak internal types', async () => {
  for (const tier of ['public', 'beta', 'alpha']) {
    await withProducer(async ({ directory, sourceFile }) => {
      const extra = `/** A forbidden ${tier} signature. @${tier} */\nexport function leaked${tier}(): _IInternalValue { return { secret: '${tier}' }; }`;
      await writeFile(sourceFile, `${await readFile(sourceFile, 'utf8')}\n${extra}\n`);
      const result = extract(directory, true);
      assert.notEqual(result.status, 0, `${tier} hidden-type leak unexpectedly passed`);
      assert.match(result.stdout + result.stderr, /ae-incompatible-release-tags/u);
    });
  }
});

test('an unreviewed public API change fails API report comparison', async () => {
  await withProducer(async ({ directory, sourceFile }) => {
    const baseline = extract(directory, true);
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    const extra = '/** A changed public contract. @public */\nexport function changedPublic(): string { return "changed"; }';
    await writeFile(sourceFile, `${await readFile(sourceFile, 'utf8')}\n${extra}\n`);
    const result = extract(directory);
    assert.notEqual(result.status, 0, 'Unreviewed API report drift passed');
    assert.match(result.stdout + result.stderr, /changed the API signature/iu);
  });
});

/** Both a changed signature and a changed release tier require report review. */
test('signature and release-tag drift fail the checked API report', async () => {
  for (const mutate of [
    source => source.replace("publicValue(): string { return 'public'; }", 'publicValue(): number { return 1; }'),
    source => source.replace('A user-facing fixture result. @public', 'A user-facing fixture result. @alpha'),
  ]) {
    await withProducer(async ({ directory, sourceFile }) => {
      const baseline = extract(directory, true);
      assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
      const before = await readFile(sourceFile, 'utf8');
      const after = mutate(before);
      assert.notEqual(after, before, 'The deliberate contract mutation did not apply');
      await writeFile(sourceFile, after);
      const result = extract(directory);
      assert.notEqual(result.status, 0, 'Unreviewed contract mutation passed');
      assert.match(result.stdout + result.stderr, /changed the API signature/iu);
    });
  }
});
