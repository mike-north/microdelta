/**
 * PKG-008 checks the route from clean CI commands to required foundation gates.
 * This is a wiring check, not a substitute for the compiler, API Extractor,
 * ESLint, or their behavioral fixtures. It catches accidental gate omission.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Script references are intentionally explicit so a missing gate is reviewable. */
export function missingFoundationGates({ workspace, packages, workflow, extractors, eslintConfig }) {
  const problems = [];
  const scripts = workspace.scripts ?? {};
  const includes = (label, command, fragment) => {
    if (!(command ?? '').includes(fragment)) {
      problems.push(`${label} skips ${fragment}`);
    }
  };
  includes('root typed ESLint config', eslintConfig, "'microdelta/tracked-captures': 'error'");
  includes('root typed ESLint config', eslintConfig, "'examples/**/*.ts', ");
  for (const command of ['npm ci', 'npm run check', 'npm test', 'npm run build']) {
    if (!workflow.includes(`- run: ${command}`)) {
      problems.push(`CI skips ${command}`);
    }
  }
  for (const version of ['20', '22', '24']) {
    if (!new RegExp(`\\b${version}\\b`, 'u').test(workflow)) {
      problems.push(`CI skips Node ${version}`);
    }
  }
  for (const command of ['npm run build', 'npm run check:packages', 'npm run check:workspace']) {
    includes('check', scripts.check, command);
  }
  includes('check:packages', scripts['check:packages'], 'npm run check --workspaces');
  for (const gate of ['check:imports', 'check:declarations', 'check:fixtures', 'check:experiments', 'check:examples', 'check:suppressions', 'check:wiring', 'check:release']) {
    includes('check:workspace', scripts['check:workspace'], `npm run ${gate}`);
  }
  for (const [gate, commands] of Object.entries({
    'check:imports': ['eslint -c tooling/context-imports.config.mjs packages experiments examples'],
    'check:declarations': ['node tooling/check-producer-declarations.mjs', 'node tooling/history-declaration-shims.mjs --check'],
    'check:fixtures': [
      'tsc --noEmit -p fixtures/declarations/producer/tsconfig.json',
      'tsc --noEmit -p fixtures/declarations/capture-producer/tsconfig.json',
      'tsc --noEmit -p fixtures/declarations/forged/tsconfig.json',
      'tsc --noEmit -p fixtures/declarations/consumer-alpha/tsconfig.json',
      'node tooling/check-capture-public-tier.mjs',
      'eslint fixtures/declarations/producer/src fixtures/declarations/capture-producer/src fixtures/declarations/forged/src fixtures/declarations/consumer-alpha/src',
    ],
    'check:experiments': ['tsc --noEmit -p tsconfig.json', 'tsc --noEmit -p experiments/exp-1/tsconfig.portable.json', 'eslint experiments'],
    'check:examples': ['tsc --noEmit -p examples/contribution-report/tsconfig.json', 'eslint examples'],
    'build:examples': ['tsc -p examples/contribution-report/tsconfig.json'],
    'test:examples': ['node --test examples/contribution-report/test/*.test.mjs'],
    'check:suppressions': ['node tooling/check-suppressions.mjs'],
    'check:wiring': ['node tooling/foundation-wiring.mjs'],
    'check:release': ['node tooling/release-workflow.mjs', 'node tooling/release-graph.mjs'],
  })) {
    for (const command of commands) {
      includes(gate, scripts[gate], command);
    }
  }
  for (const command of ['npm run build', 'npm run test:tooling', 'npm run test --workspaces', 'npm run test:experiments', 'npm run test:examples']) {
    includes('test', scripts.test, command);
  }
  includes('test:tooling', scripts['test:tooling'], 'node --test tooling/*.test.mjs');
  includes('build', scripts.build, 'npm run build:packages');
  includes('build', scripts.build, 'npm run build:fixtures');
  includes('build', scripts.build, 'npm run build:experiments');
  includes('build', scripts.build, 'npm run build:examples');
  includes('build:experiments', scripts['build:experiments'], 'tsc -p experiments/exp-1/tsconfig.test.json');
  includes('test:experiments', scripts['test:experiments'], 'tsd --typings experiments/exp-1/src/protocol.ts');
  includes('test:experiments', scripts['test:experiments'], 'jest');
  includes('build:fixtures', scripts['build:fixtures'], 'api-extractor run --config fixtures/declarations/producer/api-extractor.json');
  includes('build:fixtures', scripts['build:fixtures'], 'api-extractor run --config fixtures/declarations/capture-producer/api-extractor.json');
  includes('build:fixtures', scripts['build:fixtures'], 'tsc -p fixtures/declarations/forged/tsconfig.json');
  includes('build:fixtures', scripts['build:fixtures'], 'api-extractor run --config fixtures/declarations/forged/api-extractor.json');
  if ((scripts['build:fixtures'] ?? '').includes('--local')) {
    problems.push('build:fixtures uses local API report rewriting');
  }
  for (const name of ['definition', 'tracking', 'history', 'value', 'materialization', 'resolution', 'supervision', 'accounting', 'core']) {
    const packageName = name === 'core' ? 'microdelta' : `@microdelta/${name}`;
    includes('build:packages', scripts['build:packages'], `npm run build --workspace ${packageName}`);
    includes(`${name} build`, packages[name]?.scripts?.build, 'tsc -p tsconfig.build.json');
    includes(`${name} build`, packages[name]?.scripts?.build, 'api-extractor run --config api-extractor.json');
    includes(`${name} check`, packages[name]?.scripts?.check, 'npm run check:types');
    includes(`${name} check`, packages[name]?.scripts?.check, 'npm run check:lint');
    includes(`${name} check:types`, packages[name]?.scripts?.['check:types'], 'tsc --noEmit -p tsconfig.json');
    if (name === 'value') {
      includes('value check:types', packages[name]?.scripts?.['check:types'], 'tsc --noEmit -p tsconfig.portable.json');
    }
    includes(`${name} check:lint`, packages[name]?.scripts?.['check:lint'], 'eslint .');
    includes(`${name} test`, packages[name]?.scripts?.test, 'npm run test:types');
    includes(`${name} test:types`, packages[name]?.scripts?.['test:types'], 'tsd');
    if (name !== 'core') {
      includes(`${name} test`, packages[name]?.scripts?.test, 'npm run test:unit');
      includes(`${name} test:unit`, packages[name]?.scripts?.['test:unit'], 'tsc -p tsconfig.test.json');
      includes(`${name} test:unit`, packages[name]?.scripts?.['test:unit'], 'jest');
    }
    if ((packages[name]?.scripts?.build ?? '').includes('--local')) {
      problems.push(`${name} build uses local API report rewriting`);
    }
    if (name === 'history' || name === 'core') {
      includes(`${name} build`, packages[name]?.scripts?.build, 'api-extractor run --config api-extractor-conformance.json');
    }
    if (name === 'history') {
      includes(`${name} build`, packages[name]?.scripts?.build, 'api-extractor run --config api-extractor-shared.json');
      includes(`${name} build`, packages[name]?.scripts?.build, 'node ../../tooling/history-declaration-shims.mjs');
    }
  }
  for (const [filename, config] of Object.entries(extractors)) {
    if (config.apiReport?.enabled !== true) {
      problems.push(`${filename} skips API report comparison`);
    }
    if (config.dtsRollup?.enabled !== true || ['untrimmedFilePath', 'alphaTrimmedFilePath', 'betaTrimmedFilePath', 'publicTrimmedFilePath'].some(key => !config.dtsRollup[key])) {
      problems.push(`${filename} skips a declaration tier`);
    }
  }
  return problems;
}

/** Run from the workspace check independently of the test harness. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const readJson = async filename => JSON.parse(await readFile(path.join(root, filename), 'utf8'));
  const names = ['core', 'definition', 'tracking', 'history', 'value', 'materialization', 'resolution', 'supervision', 'accounting'];
  const packages = Object.fromEntries(await Promise.all(names.map(async name => [name, await readJson(`packages/${name}/package.json`)])));
  const filenames = names.map(name => `packages/${name}/api-extractor.json`);
  filenames.push('packages/core/api-extractor-conformance.json', 'packages/history/api-extractor-conformance.json', 'packages/history/api-extractor-shared.json', 'fixtures/declarations/producer/api-extractor.json', 'fixtures/declarations/capture-producer/api-extractor.json', 'fixtures/declarations/forged/api-extractor.json');
  const extractors = Object.fromEntries(await Promise.all(filenames.map(async filename => [filename, await readJson(filename)])));
  const problems = missingFoundationGates({
    workspace: await readJson('package.json'), packages, extractors,
    workflow: await readFile(path.join(root, '.github/workflows/check.yml'), 'utf8'),
    eslintConfig: await readFile(path.join(root, 'eslint.config.mjs'), 'utf8'),
  });
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exitCode = 1;
  }
}
