/**
 * PKG-004 declaration preflight runs before sibling compilation. TypeScript may
 * fall back from a missing paths target to a source-bearing installed package;
 * this check makes that failure explicit and forbids source aliases in any
 * checked package or declaration-consumer tsconfig.
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { roleByDirectory, roleByPackage, roles } from './package-architecture.mjs';

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

/** Context ownership determines the allowed tier, independently of TS resolution. */
function configOwner(filename) {
  const parts = filename.split(path.sep);
  const index = parts.lastIndexOf('packages');
  return index < 0 ? null : roleByDirectory[parts[index + 1]] ?? null;
}

/** First-party package specifiers a generated declaration imports. */
const firstPartySpecifier = /\bfrom\s+['"](microdelta|@microdelta\/[a-z0-9-]+)['"]/gu;

/**
 * Roles whose alpha rollups an owner's approved producers name, transitively.
 * Type-checking an approved producer's generated alpha declaration requires
 * resolving every first-party package it imports, including packages the owner
 * has no edge to (Resolution's rollup names History and Tracking types). This
 * closure admits exactly those alpha rollups for type resolution; it grants no
 * source edge, which the import rule still enforces.
 */
async function declarationClosure(owner) {
  const closure = new Set();
  const pending = [...roles[owner].uses];
  while (pending.length > 0) {
    const role = pending.pop();
    const directory = roles[role]?.directory;
    if (!directory || closure.has(role)) {
      continue;
    }
    closure.add(role);
    const basename = role === 'facade' ? 'microdelta' : directory;
    const text = await readFile(path.join(root, `packages/${directory}/dist/api/${basename}.alpha.d.ts`), 'utf8').catch(() => '');
    for (const match of text.matchAll(firstPartySpecifier)) {
      const imported = roleByPackage[match[1]];
      if (imported && !closure.has(imported)) {
        pending.push(imported);
      }
    }
  }
  return closure;
}

/** Exact producer artifacts prevent aliases from selecting an unintended tier. */
async function expectedDeclaration(alias, owner, filename) {
  const publicConsumer = filename.endsWith(`${path.sep}consumer-alpha${path.sep}tsconfig.public.json`);
  const fixtureTier = publicConsumer ? 'public' : 'alpha';
  if (alias === '@microdelta/fixture-producer') {
    return path.join(root, `fixtures/declarations/producer/dist/api/fixture.${fixtureTier}.d.ts`);
  }
  if (alias === '@microdelta/capture-producer') {
    return path.join(root, `fixtures/declarations/capture-producer/dist/api/capture.${fixtureTier}.d.ts`);
  }
  const subpath = '/conformance/store';
  const packageName = alias.endsWith(subpath) ? alias.slice(0, -subpath.length) : alias;
  const role = roleByPackage[packageName];
  if (!role || (alias !== packageName && !['microdelta/conformance/store', '@microdelta/history/conformance/store'].includes(alias))) {
    return null;
  }
  const approvedEdge = !owner || role === owner || roles[owner].uses.includes(role);
  if (!approvedEdge && (publicConsumer || !(await declarationClosure(owner)).has(role))) {
    return null;
  }
  const directory = roles[role].directory;
  if (!directory) {
    return null;
  }
  const basename = role === 'facade' ? 'microdelta' : directory;
  const tier = publicConsumer ? 'public' : owner === role ? 'untrimmed' : 'alpha';
  const suffix = alias === packageName ? '' : '.conformance.store';
  return path.join(root, `packages/${directory}/dist/api/${basename}${suffix}.${tier}.d.ts`);
}

/** Resolve inherited compiler paths; raw JSON misses `extends` and base origins. */
async function inspectConfig(filename) {
  const parsed = ts.getParsedCommandLineOfConfigFile(filename, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic() {},
  });
  if (!parsed) {
    return [`Invalid TypeScript project: ${filename}`];
  }
  const options = parsed.options;
  const origin = options.baseUrl ?? options.pathsBasePath ?? path.dirname(filename);
  const owner = configOwner(filename);
  const problems = [];
  if (filename.split(path.sep).includes('packages') && !owner) {
    problems.push(`Unknown package or context: ${filename}`);
  }
  for (const [alias, targets] of Object.entries(options.paths ?? {})) {
    for (const target of targets) {
      const absolute = path.resolve(origin, target);
      if (target.includes('*') || !target.endsWith('.d.ts') || /(?:^|[\\/])src[\\/]/u.test(absolute)) {
        problems.push(`Source alias bypasses declared package surface: ${filename}: ${alias} -> ${target}`);
      } else if (!(await stat(absolute).then(item => item.isFile()).catch(() => false))) {
        problems.push(`Missing producer declaration: ${filename}: ${alias} -> ${absolute}`);
      } else {
        const expected = await expectedDeclaration(alias, owner, filename);
        // A workspace package symlink may resolve to the exact owner-approved
        // declaration; compare real targets without allowing a different tier.
        const approvedSymlink = expected !== null && await realpath(absolute).then(async actual =>
          actual === await realpath(expected).catch(() => ''),
        ).catch(() => false);
        if (!expected || (absolute !== expected && !approvedSymlink)) {
          problems.push(`Unapproved declared package alias or tier: ${filename}: ${alias} -> ${absolute}`);
        }
      }
    }
  }
  return problems;
}

/** Default expectations cover every generated production and fixture tier. */
const required = [
  ['core', 'microdelta'], ['definition', 'definition'], ['tracking', 'tracking'], ['history', 'history'], ['value', 'value'],
  ['materialization', 'materialization'], ['resolution', 'resolution'], ['supervision', 'supervision'],
].flatMap(([directory, basename]) => ['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
  path.join(root, `packages/${directory}/dist/api/${basename}.${tier}.d.ts`)));
required.push(...['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
  path.join(root, `fixtures/declarations/producer/dist/api/fixture.${tier}.d.ts`)));
required.push(...['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
  path.join(root, `fixtures/declarations/capture-producer/dist/api/capture.${tier}.d.ts`)));
required.push(...['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
  path.join(root, `fixtures/declarations/forged/dist/api/forged.${tier}.d.ts`)));
for (const [directory, basename] of [['core', 'microdelta'], ['history', 'history']]) {
  required.push(...['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
    path.join(root, `packages/${directory}/dist/api/${basename}.conformance.store.${tier}.d.ts`)));
}
required.push(...['untrimmed', 'alpha', 'beta', 'public'].map(tier =>
  path.join(root, `packages/history/dist/api/history.shared.${tier}.d.ts`)));

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
