/** PKG-008 fails if CI or an aggregate script omits a required boundary gate. */
import assert from 'node:assert/strict';
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
  const names = ['core', 'definition', 'tracking', 'history', 'value'];
  const files = names.map(name => `packages/${name}/api-extractor.json`);
  files.push('packages/core/api-extractor-conformance.json', 'packages/history/api-extractor-conformance.json', 'packages/history/api-extractor-shared.json', 'fixtures/declarations/producer/api-extractor.json');
  return Object.fromEntries(await Promise.all(files.map(async filename => [filename, await readJson(filename)])));
}

test('clean CI reaches build, declaration, import, lint, and consumer gates', async () => {
  const workspace = await readJson('package.json');
  const packages = Object.fromEntries(await Promise.all(['core', 'definition', 'tracking', 'history', 'value'].map(async name => [
    name, await readJson(`packages/${name}/package.json`),
  ])));
  const workflow = await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8');
  assert.deepEqual(missingFoundationGates({ workspace, packages, workflow, extractors: await extractors() }), []);
});

test('Value package build, checks, declaration views, and package order are required', async () => {
  const workspace = await readJson('package.json');
  const names = ['core', 'definition', 'tracking', 'history', 'value'];
  const packages = Object.fromEntries(await Promise.all(names.map(async name => [name, await readJson(`packages/${name}/package.json`)])));
  const configs = await extractors();
  const result = missingFoundationGates({
    workspace,
    packages,
    workflow: await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8'),
    extractors: configs,
  });
  assert.deepEqual(result, []);
  const packageBuild = workspace.scripts['build:packages'];
  assert.ok(packageBuild.indexOf('@microdelta/machine') < packageBuild.indexOf('@microdelta/value'));
  assert.ok(packageBuild.indexOf('@microdelta/value') < packageBuild.indexOf('@microdelta/tracking'));

  const skippedBuild = structuredClone(workspace);
  skippedBuild.scripts['build:packages'] = skippedBuild.scripts['build:packages'].replace('npm run build --workspace @microdelta/value', 'true');
  assert.match(missingFoundationGates({
    workspace: skippedBuild,
    packages,
    workflow: '',
    extractors: configs,
  }).join('\n'), /build:packages.*@microdelta\/value/u);
});

test('skipping an import, declaration, or API report checker is detected', async () => {
  const workspace = await readJson('package.json');
  const packages = Object.fromEntries(await Promise.all(['core', 'definition', 'tracking', 'history', 'value'].map(async name => [
    name, await readJson(`packages/${name}/package.json`),
  ])));
  const workflow = await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8');
  const configs = await extractors();
  const copied = () => ({ workspace: structuredClone(workspace), packages: structuredClone(packages), workflow, extractors: structuredClone(configs) });
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
  const noExperimentImportGate = copied();
  noExperimentImportGate.workspace.scripts['check:imports'] = noExperimentImportGate.workspace.scripts['check:imports'].replace('packages experiments', 'packages');
  assert.match(missingFoundationGates(noExperimentImportGate).join('\n'), /check:imports.*experiments/u);
  const noTest = copied();
  noTest.workflow = noTest.workflow.replace('- run: npm test', '- run: true');
  assert.match(missingFoundationGates(noTest).join('\n'), /CI.*npm test/u);
});
