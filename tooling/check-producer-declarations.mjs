/**
 * PKG-004 declaration preflight runs before sibling compilation. TypeScript may
 * fall back from a missing paths target to a source-bearing installed package;
 * this check makes that failure explicit and forbids source aliases in any
 * checked package or declaration-consumer tsconfig.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/** The checkout root anchors generated declaration expectations. */
const root = fileURLToPath(new URL('../', import.meta.url));

/** Only active configs participate; generated output and archives are excluded. */
async function* configs(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && !['dist', '.test-build', 'node_modules'].includes(entry.name)) {
      yield* configs(filename);
    } else if (entry.isFile() && /^tsconfig(?:\.[^.]+)?\.json$/u.test(entry.name)) {
      yield filename;
    }
  }
}

/** A target must name generated declarations before TypeScript can resolve it. */
async function inspectConfig(filename) {
  const parsed = ts.readConfigFile(filename, ts.sys.readFile);
  if (parsed.error) {
    return [`Invalid TypeScript project: ${filename}`];
  }
  const options = parsed.config.compilerOptions ?? {};
  const origin = path.resolve(path.dirname(filename), options.baseUrl ?? '.');
  const problems = [];
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    for (const target of targets) {
      const absolute = path.resolve(origin, target);
      if (target.includes('*') || !target.endsWith('.d.ts') || /(?:^|[\\/])src[\\/]/u.test(absolute)) {
        problems.push(`Source alias bypasses declared package surface: ${filename}: ${alias} -> ${target}`);
      } else if (!(await stat(absolute).then(item => item.isFile()).catch(() => false))) {
        problems.push(`Missing producer declaration: ${filename}: ${alias} -> ${absolute}`);
      }
    }
  }
  return problems;
}

/** Default expectations cover every generated production and fixture tier. */
const required = [
  ['core', 'microdelta'], ['definition', 'definition'], ['tracking', 'tracking'], ['history', 'history'],
].flatMap(([directory, basename]) => ['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
  path.join(root, `packages/${directory}/dist/api/${basename}.${tier}.d.ts`)));
required.push(...['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
  path.join(root, `fixtures/declarations/producer/dist/api/fixture.${tier}.d.ts`)));

/** A single config argument isolates negative fixtures from the workspace gate. */
const selected = process.argv[2] === '--config' && process.argv.length === 4 ? [path.resolve(process.argv[3])] : null;
if (process.argv.length > 2 && !selected) {
  throw new Error('Usage: check-producer-declarations.mjs [--config path]');
}
const problems = [];
if (!selected) {
  for (const filename of required) {
    if (!(await stat(filename).then(item => item.isFile()).catch(() => false))) {
      problems.push(`Missing producer declaration: ${filename}`);
    }
  }
}
const files = selected ?? [];
if (!selected) {
  for (const directory of ['packages', 'fixtures/declarations']) {
    for await (const filename of configs(path.join(root, directory))) {
      files.push(filename);
    }
  }
}
for (const filename of files) {
  problems.push(...await inspectConfig(filename));
}
if (problems.length) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exitCode = 1;
}
