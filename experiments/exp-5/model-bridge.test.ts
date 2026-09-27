/** EXP-5 checks actual native parser and maintained API-model output together. */
import { expect, test } from '@jest/globals';
import { ApiModel, ApiReleaseTagMixin, ReleaseTag } from '@microsoft/api-extractor-model';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { inspectClassPrivacy, loadApiSnapshot, loadCmlSnapshot, loadManifest } from './model-bridge.js';
import { compareCorrespondence } from './conformance.js';

/** The fixture paths are explicit, not inferred from CML display labels. */
const experiment = resolve(import.meta.dirname, '..');
const producer = resolve(experiment, 'fixture/packages/producer');
const consumer = resolve(experiment, 'fixture/packages/consumer');
const manifest = await loadManifest(resolve(experiment, 'mapping.json'));
const mapping = manifest.mapping;

test('native CML and generated API models match only the explicit bounded subset', async () => {
  const cml = await loadCmlSnapshot(resolve(experiment, 'build/cml-facts.json'));
  const api = loadApiSnapshot(manifest.artifacts);
  expect(compareCorrespondence(cml, api, mapping).diagnostics).toEqual([]);
  const record = api.packages[0]?.exports.find(item => item.name === 'RecordEntity');
  expect(record?.members.find(member => member.name === '_localCode')).toMatchObject({ visibility: 'public', releaseTag: 'internal' });
  expect(record?.members.find(member => member.name === 'childCode')).toMatchObject({ visibility: 'protected', releaseTag: 'public' });
});

test('compiler privacy and API release tiers remain separate facts', async () => {
  expect(inspectClassPrivacy(resolve(producer, 'src/index.ts'), 'RecordEntity')).toEqual({
    publicMembers: ['rename', '_localCode', 'inspectLocal'],
    protectedMembers: ['childCode'],
    privateMembers: ['privateCode'],
    hardPrivateMembers: ['#hardCode'],
  });
  const model = new ApiModel();
  const packageModel = model.loadPackage(resolve(producer, 'dist/producer.api.json'));
  const exports = packageModel.entryPoints.flatMap(entry => entry.members);
  for (const [name, tier] of [['alphaRecord', ReleaseTag.Alpha], ['betaRecord', ReleaseTag.Beta], ['RecordEntity', ReleaseTag.Public]] as const) {
    const item = exports.find(candidate => candidate.displayName === name);
    expect(item && ApiReleaseTagMixin.isBaseClassOf(item) ? item.releaseTag : undefined).toBe(tier);
  }
});

test('a manifest cannot relabel a different API package as the mapped owner', () => {
  expect(() => loadApiSnapshot([{
    name: '@microdelta/exp5-producer',
    apiJson: resolve(consumer, 'dist/consumer.api.json'),
    declaration: resolve(consumer, 'dist/src/index.d.ts'),
  }])).toThrow(/package identity/u);
});

test('a changed native CML operation produces a failing parsed-model comparison', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'microdelta-exp5-cml-'));
  try {
    const source = await readFile(resolve(experiment, 'model.cml'), 'utf8');
    expect(source).toContain('String rename(String nextLabel)');
    const changedFile = resolve(temporary, 'changed.cml');
    const outputFile = resolve(temporary, 'changed.json');
    await writeFile(changedFile, source.replace('String rename(String nextLabel)', 'String relabel(String nextLabel)'));
    const run = spawnSync(resolve(experiment, 'gradlew'), [
      'extractCml', `-PcmlFile=${changedFile}`, `-PoutputFile=${outputFile}`, '--no-daemon', '--quiet',
    ], { cwd: experiment, encoding: 'utf8', env: process.env });
    expect(run.status).toBe(0);
    const cml = await loadCmlSnapshot(outputFile);
    const api = loadApiSnapshot([
      { name: '@microdelta/exp5-producer', apiJson: resolve(producer, 'dist/producer.api.json'), declaration: resolve(producer, 'dist/src/index.d.ts') },
      { name: '@microdelta/exp5-consumer', apiJson: resolve(consumer, 'dist/consumer.api.json'), declaration: resolve(consumer, 'dist/src/index.d.ts') },
    ]);
    expect(compareCorrespondence(cml, api, mapping).diagnostics.join('\n')).toMatch(/rename.*missing/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a changed generated API model produces a failing maintained-model comparison', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'microdelta-exp5-api-'));
  try {
    const original = await readFile(resolve(producer, 'dist/producer.api.json'), 'utf8');
    expect(original).toContain('"name": "rename"');
    const changedFile = resolve(temporary, 'producer.api.json');
    await writeFile(changedFile, original.replace('"name": "rename"', '"name": "relabel"'));
    const cml = await loadCmlSnapshot(resolve(experiment, 'build/cml-facts.json'));
    const api = loadApiSnapshot([
      { name: '@microdelta/exp5-producer', apiJson: changedFile, declaration: resolve(producer, 'dist/src/index.d.ts') },
      { name: '@microdelta/exp5-consumer', apiJson: resolve(consumer, 'dist/consumer.api.json'), declaration: resolve(consumer, 'dist/src/index.d.ts') },
    ]);
    expect(compareCorrespondence(cml, api, mapping).diagnostics.join('\n')).toMatch(/rename.*missing/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a changed TypeScript source produces a failing regenerated API model', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'microdelta-exp5-ts-'));
  try {
    await mkdir(resolve(temporary, 'src'));
    await copyFile(resolve(producer, 'package.json'), resolve(temporary, 'package.json'));
    await copyFile(resolve(producer, 'api-extractor.json'), resolve(temporary, 'api-extractor.json'));
    const original = await readFile(resolve(producer, 'src/index.ts'), 'utf8');
    expect(original).toContain('public rename(nextLabel: string)');
    await writeFile(resolve(temporary, 'src/index.ts'), original.replace('public rename(nextLabel: string)', 'public relabel(nextLabel: string)'));
    await writeFile(resolve(temporary, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
        declaration: true, noEmitOnError: true, rootDir: '.', outDir: 'dist', skipLibCheck: false, types: [],
      },
      include: ['src/**/*.ts'],
    }));
    const typescript = spawnSync(resolve(experiment, '../../node_modules/.bin/tsc'), ['-p', resolve(temporary, 'tsconfig.json')],
      { cwd: temporary, encoding: 'utf8' });
    expect(typescript.status).toBe(0);
    const extractor = spawnSync(resolve(experiment, '../../node_modules/.bin/api-extractor'),
      ['run', '--config', resolve(temporary, 'api-extractor.json')], { cwd: temporary, encoding: 'utf8' });
    expect(extractor.status).toBe(0);
    const cml = await loadCmlSnapshot(resolve(experiment, 'build/cml-facts.json'));
    const api = loadApiSnapshot([
      { name: '@microdelta/exp5-producer', apiJson: resolve(temporary, 'dist/producer.api.json'), declaration: resolve(temporary, 'dist/src/index.d.ts') },
      { name: '@microdelta/exp5-consumer', apiJson: resolve(consumer, 'dist/consumer.api.json'), declaration: resolve(consumer, 'dist/src/index.d.ts') },
    ]);
    expect(compareCorrespondence(cml, api, mapping).diagnostics.join('\n')).toMatch(/rename.*missing/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a same-named local type cannot impersonate the producer reference', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'microdelta-exp5-owner-'));
  try {
    await mkdir(resolve(temporary, 'src'));
    await copyFile(resolve(consumer, 'package.json'), resolve(temporary, 'package.json'));
    await copyFile(resolve(consumer, 'api-extractor.json'), resolve(temporary, 'api-extractor.json'));
    await writeFile(resolve(temporary, 'src/index.ts'), `/** Local-shadow negative fixture. @packageDocumentation */
/** A same-named local class is not the producer contract. @public */
export class RecordEntity { public readonly label: string = ''; }
/** A consumer operation with the same printed signature but wrong owner. @public */
export class ReportService {
  /** The result exposes the same scalar shape. @public */
  public formatRecord(record: RecordEntity): string { return record.label; }
}
`);
    await writeFile(resolve(temporary, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
        declaration: true, noEmitOnError: true, rootDir: '.', outDir: 'dist', skipLibCheck: false, types: [],
      }, include: ['src/**/*.ts'],
    }));
    await writeFile(resolve(temporary, 'tsconfig.api.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [] },
      files: ['dist/src/index.d.ts'],
    }));
    const typescript = spawnSync(resolve(experiment, '../../node_modules/.bin/tsc'), ['-p', resolve(temporary, 'tsconfig.json')],
      { cwd: temporary, encoding: 'utf8' });
    expect(typescript.status).toBe(0);
    const extractor = spawnSync(resolve(experiment, '../../node_modules/.bin/api-extractor'),
      ['run', '--config', resolve(temporary, 'api-extractor.json')], { cwd: temporary, encoding: 'utf8' });
    expect(extractor.status).toBe(0);
    const cml = await loadCmlSnapshot(resolve(experiment, 'build/cml-facts.json'));
    const api = loadApiSnapshot([
      { name: '@microdelta/exp5-producer', apiJson: resolve(producer, 'dist/producer.api.json'), declaration: resolve(producer, 'dist/src/index.d.ts') },
      { name: '@microdelta/exp5-consumer', apiJson: resolve(temporary, 'dist/consumer.api.json'), declaration: resolve(temporary, 'dist/src/index.d.ts') },
    ]);
    expect(compareCorrespondence(cml, api, mapping).diagnostics.join('\n')).toMatch(/reference/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('changing the compiler-visible @internal declaration fails CML package correspondence', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'microdelta-exp5-tier-'));
  try {
    const original = await readFile(resolve(producer, 'dist/src/index.d.ts'), 'utf8');
    expect(original).toContain('@internal */');
    const changedFile = resolve(temporary, 'index.d.ts');
    await writeFile(changedFile, original.replace('Package visibility maps to this own-package-only release contract. @internal',
      'Package visibility maps to this own-package-only release contract. @public'));
    const cml = await loadCmlSnapshot(resolve(experiment, 'build/cml-facts.json'));
    const api = loadApiSnapshot([
      { name: '@microdelta/exp5-producer', apiJson: resolve(producer, 'dist/producer.api.json'), declaration: changedFile },
      { name: '@microdelta/exp5-consumer', apiJson: resolve(consumer, 'dist/consumer.api.json'), declaration: resolve(consumer, 'dist/src/index.d.ts') },
    ]);
    expect(compareCorrespondence(cml, api, mapping).diagnostics.join('\n')).toMatch(/_localCode.*missing/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
