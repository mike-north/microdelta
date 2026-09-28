/** PKG-008 fails if CI or an aggregate script omits a required boundary gate. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { missingFoundationGates } from './foundation-wiring.mjs';

/** The checked fixture is the actual script and workflow configuration. */
const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async filename => JSON.parse(await readFile(path.join(root, filename), 'utf8'));

/** Each exported entrypoint has a configured comparison report. */
async function extractors() {
  const names = ['core', 'definition', 'tracking', 'history', 'value', 'materialization', 'resolution', 'supervision'];
  const files = names.map(name => `packages/${name}/api-extractor.json`);
  files.push('packages/core/api-extractor-conformance.json', 'packages/history/api-extractor-conformance.json', 'packages/history/api-extractor-shared.json', 'fixtures/declarations/producer/api-extractor.json', 'fixtures/declarations/capture-producer/api-extractor.json', 'fixtures/declarations/forged/api-extractor.json');
  return Object.fromEntries(await Promise.all(files.map(async filename => [filename, await readJson(filename)])));
}

test('clean CI reaches build, declaration, import, lint, and consumer gates', async () => {
  const workspace = await readJson('package.json');
  const packages = Object.fromEntries(await Promise.all(['core', 'definition', 'tracking', 'history', 'value', 'materialization', 'resolution', 'supervision'].map(async name => [
    name, await readJson(`packages/${name}/package.json`),
  ])));
  const workflow = await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8');
  const eslintConfig = await readFile(path.join(root, 'eslint.config.mjs'), 'utf8');
  assert.deepEqual(missingFoundationGates({ workspace, packages, workflow, extractors: await extractors(), eslintConfig }), []);
});

test('the declaration checker accepts the generated alpha package path needed by external rollups', () => {
  for (const filename of [
    'fixtures/declarations/capture-producer/tsconfig.json',
    'fixtures/declarations/consumer-alpha/tsconfig.public.json',
  ]) {
    const result = spawnSync(process.execPath, [
      path.join(root, 'tooling/check-producer-declarations.mjs'),
      '--config',
      path.join(root, filename),
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${filename}: ${result.stderr || result.stdout}`);
  }
});

test('Value package build, checks, declaration views, and package order are required', async () => {
  const workspace = await readJson('package.json');
  const names = ['core', 'definition', 'tracking', 'history', 'value', 'materialization', 'resolution', 'supervision'];
  const packages = Object.fromEntries(await Promise.all(names.map(async name => [name, await readJson(`packages/${name}/package.json`)])));
  const configs = await extractors();
  const result = missingFoundationGates({
    workspace,
    packages,
    workflow: await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8'),
    extractors: configs,
    eslintConfig: await readFile(path.join(root, 'eslint.config.mjs'), 'utf8'),
  });
  assert.deepEqual(result, []);
  const packageBuild = workspace.scripts['build:packages'];
  assert.ok(packageBuild.indexOf('@microdelta/machine') < packageBuild.indexOf('@microdelta/value'));
  assert.ok(packageBuild.indexOf('@microdelta/value') < packageBuild.indexOf('@microdelta/tracking'));
  assert.ok(packageBuild.indexOf('@microdelta/history') < packageBuild.indexOf('@microdelta/materialization'));
  // Resolution consumes Materialization's declarations and the facade's tests consume Resolution's.
  assert.ok(packageBuild.indexOf('@microdelta/materialization') < packageBuild.indexOf('@microdelta/resolution'));
  assert.ok(packageBuild.indexOf('@microdelta/resolution') < packageBuild.indexOf('--workspace microdelta'));
  // Supervision consumes Resolution's declarations and the facade consumes Supervision's.
  assert.ok(packageBuild.indexOf('@microdelta/resolution') < packageBuild.indexOf('@microdelta/supervision'));
  assert.ok(packageBuild.indexOf('@microdelta/supervision') < packageBuild.indexOf('--workspace microdelta'));

  const skippedBuild = structuredClone(workspace);
  skippedBuild.scripts['build:packages'] = skippedBuild.scripts['build:packages'].replace('npm run build --workspace @microdelta/value', 'true');
  assert.match(missingFoundationGates({
    workspace: skippedBuild,
    packages,
    workflow: '',
    extractors: configs,
  }).join('\n'), /build:packages.*@microdelta\/value/u);

  const skippedResolution = structuredClone(workspace);
  skippedResolution.scripts['build:packages'] = skippedResolution.scripts['build:packages'].replace('npm run build --workspace @microdelta/resolution', 'true');
  assert.match(missingFoundationGates({
    workspace: skippedResolution,
    packages,
    workflow: '',
    extractors: configs,
  }).join('\n'), /build:packages.*@microdelta\/resolution/u);
  const skippedSupervision = structuredClone(workspace);
  skippedSupervision.scripts['build:packages'] = skippedSupervision.scripts['build:packages'].replace('npm run build --workspace @microdelta/supervision', 'true');
  assert.match(missingFoundationGates({
    workspace: skippedSupervision,
    packages,
    workflow: '',
    extractors: configs,
  }).join('\n'), /build:packages.*@microdelta\/supervision/u);
  const untestedResolution = structuredClone(packages);
  untestedResolution.resolution.scripts.test = 'npm run test:types';
  assert.match(missingFoundationGates({
    workspace,
    packages: untestedResolution,
    workflow: '',
    extractors: configs,
  }).join('\n'), /resolution test.*test:unit/u);
});

test('skipping an import, declaration, or API report checker is detected', async () => {
  const workspace = await readJson('package.json');
  const packages = Object.fromEntries(await Promise.all(['core', 'definition', 'tracking', 'history', 'value', 'materialization', 'resolution', 'supervision'].map(async name => [
    name, await readJson(`packages/${name}/package.json`),
  ])));
  const workflow = await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8');
  const eslintConfig = await readFile(path.join(root, 'eslint.config.mjs'), 'utf8');
  const configs = await extractors();
  const copied = () => ({ workspace: structuredClone(workspace), packages: structuredClone(packages), workflow, extractors: structuredClone(configs), eslintConfig });
  for (const command of ['check:imports', 'check:declarations', 'check:fixtures']) {
    const fixture = copied();
    fixture.workspace.scripts['check:workspace'] = fixture.workspace.scripts['check:workspace'].replace(`npm run ${command}`, 'true');
    assert.match(missingFoundationGates(fixture).join('\n'), new RegExp(command, 'u'));
  }
  for (const command of ['check:imports', 'check:declarations']) {
    const fixture = copied();
    fixture.workspace.scripts[command] = 'true';
    assert.match(missingFoundationGates(fixture).join('\n'), new RegExp(command, 'u'));
  }
  const fixture = copied();
  fixture.packages.history.scripts.build = fixture.packages.history.scripts.build.replace('api-extractor run --config api-extractor-conformance.json', 'true');
  assert.match(missingFoundationGates(fixture).join('\n'), /history.*api-extractor-conformance/u);
  const noReport = copied();
  noReport.extractors['packages/core/api-extractor-conformance.json'].apiReport.enabled = false;
  assert.match(missingFoundationGates(noReport).join('\n'), /core.*api-extractor-conformance.*API report/u);
  const noShimCheck = copied();
  noShimCheck.workspace.scripts['check:declarations'] = 'node tooling/check-producer-declarations.mjs';
  assert.match(missingFoundationGates(noShimCheck).join('\n'), /check:declarations.*history-declaration-shims/u);
  const noSharedBuild = copied();
  noSharedBuild.packages.history.scripts.build = noSharedBuild.packages.history.scripts.build.replace('api-extractor run --config api-extractor-shared.json', 'true');
  assert.match(missingFoundationGates(noSharedBuild).join('\n'), /history.*api-extractor-shared/u);
  const localReport = copied();
  localReport.packages.core.scripts.build += ' --local';
  assert.match(missingFoundationGates(localReport).join('\n'), /core.*local.*API report/iu);
  const noTypes = copied();
  noTypes.packages.tracking.scripts.check = 'npm run check:lint';
  assert.match(missingFoundationGates(noTypes).join('\n'), /tracking.*check:types/u);
  const noExperimentBuild = copied();
  noExperimentBuild.workspace.scripts.build = noExperimentBuild.workspace.scripts.build.replace('npm run build:experiments', 'true');
  assert.match(missingFoundationGates(noExperimentBuild).join('\n'), /build.*build:experiments/u);
  const noExperimentTest = copied();
  noExperimentTest.workspace.scripts.test = noExperimentTest.workspace.scripts.test.replace('npm run test:experiments', 'true');
  assert.match(missingFoundationGates(noExperimentTest).join('\n'), /test.*test:experiments/u);
  const noCaptureExtractor = copied();
  noCaptureExtractor.workspace.scripts['build:fixtures'] = noCaptureExtractor.workspace.scripts['build:fixtures']
    .replace(' && api-extractor run --config fixtures/declarations/capture-producer/api-extractor.json', '');
  assert.match(missingFoundationGates(noCaptureExtractor).join('\n'), /build:fixtures.*capture-producer/u);
  const noForgedExtractor = copied();
  noForgedExtractor.workspace.scripts['build:fixtures'] = noForgedExtractor.workspace.scripts['build:fixtures']
    .replace(' && api-extractor run --config fixtures/declarations/forged/api-extractor.json', '');
  assert.match(missingFoundationGates(noForgedExtractor).join('\n'), /build:fixtures.*forged/u);
  const noCaptureLint = copied();
  noCaptureLint.eslintConfig = noCaptureLint.eslintConfig.replace("'microdelta/tracked-captures': 'error',", "'microdelta/tracked-captures': 'off',");
  assert.match(missingFoundationGates(noCaptureLint).join('\n'), /root typed ESLint config.*microdelta\/tracked-captures/u);
  const noCaptureFixture = copied();
  noCaptureFixture.workspace.scripts['check:fixtures'] = noCaptureFixture.workspace.scripts['check:fixtures']
    .replace('tsc --noEmit -p fixtures/declarations/consumer-alpha/tsconfig.json && ', '');
  assert.match(missingFoundationGates(noCaptureFixture).join('\n'), /check:fixtures.*consumer-alpha/u);
  const noCaptureProducer = copied();
  noCaptureProducer.workspace.scripts['check:fixtures'] = noCaptureProducer.workspace.scripts['check:fixtures']
    .replace('tsc --noEmit -p fixtures/declarations/capture-producer/tsconfig.json && ', '');
  assert.match(missingFoundationGates(noCaptureProducer).join('\n'), /check:fixtures.*capture-producer/u);
  const noForgedFixture = copied();
  noForgedFixture.workspace.scripts['check:fixtures'] = noForgedFixture.workspace.scripts['check:fixtures']
    .replace('tsc --noEmit -p fixtures/declarations/forged/tsconfig.json && ', '');
  assert.match(missingFoundationGates(noForgedFixture).join('\n'), /check:fixtures.*forged/u);
  const noExperimentImportGate = copied();
  noExperimentImportGate.workspace.scripts['check:imports'] = noExperimentImportGate.workspace.scripts['check:imports'].replace('packages experiments', 'packages');
  assert.match(missingFoundationGates(noExperimentImportGate).join('\n'), /check:imports.*experiments/u);
  const noTest = copied();
  noTest.workflow = noTest.workflow.replace('- run: npm test', '- run: true');
  assert.match(missingFoundationGates(noTest).join('\n'), /CI.*npm test/u);
});

test('the release workflow audit and first-party graph check are required checks', async () => {
  const workspace = await readJson('package.json');
  const names = ['core', 'definition', 'tracking', 'history', 'value', 'materialization'];
  const packages = Object.fromEntries(await Promise.all(names.map(async name => [name, await readJson(`packages/${name}/package.json`)])));
  const inputs = {
    packages,
    workflow: await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8'),
    extractors: await extractors(),
    eslintConfig: await readFile(path.join(root, 'eslint.config.mjs'), 'utf8'),
  };
  assert.match(workspace.scripts['check:workspace'], /npm run check:release/u);
  const omitted = { ...workspace, scripts: { ...workspace.scripts, 'check:workspace': workspace.scripts['check:workspace'].replace('"npm run check:release"', '') } };
  assert.ok(missingFoundationGates({ ...inputs, workspace: omitted }).includes('check:workspace skips npm run check:release'));
  const hollow = { ...workspace, scripts: { ...workspace.scripts, 'check:release': 'node tooling/release-workflow.mjs' } };
  assert.ok(missingFoundationGates({ ...inputs, workspace: hollow }).includes('check:release skips node tooling/release-graph.mjs'));
});
