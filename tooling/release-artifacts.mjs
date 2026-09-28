/**
 * Pack and verify the first-party release artifacts.
 *
 * Produces, in `--out`, one npm tarball per package in the release graph plus
 * `release-manifest.json` (repository, commit, dependency-ordered packages
 * with tarball integrity). These are the exact bytes the publish job later
 * sends to npm. Verification happens before anything leaves the runner:
 * the graph is validated (see release-graph.mjs), each tarball's file list
 * must contain its runtime and public declaration entry points and no source
 * or credentials, and the whole graph is installed into a scratch consumer
 * from the tarballs alone. That install must resolve every first-party package
 * to a local tarball (never the registry), import every package root at
 * runtime, and typecheck every exported entry through its public declarations.
 * Third-party dependencies resolve normally. `--release` additionally refuses
 * the reserved bootstrap version; the package job always passes it.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ReleasePlanError, isFirstParty, planRelease, readWorkspace, trustedPublisher } from './release-graph.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

/** Files that would leak credentials or local configuration if published. */
const forbiddenFile = /(?:^|\/)(?:\.npmrc|\.env(?:\..*)?)$/u;

/** Normalize a manifest target (`./dist/x.js`) to a tarball-relative path. */
function normalizeTarget(target) {
  return target.replace(/^\.\//u, '');
}

/** Walk an `exports` value, yielding each condition path and its target. */
function* exportTargets(value, label) {
  if (typeof value === 'string') {
    yield [label, value];
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) yield* exportTargets(nested, `${label}.${key}`);
  }
}

/**
 * Diagnostics for one packed file list. The manifest's entry points must all
 * be present; every type entry must be a generated public-tier rollup so the
 * default consumer never sees alpha or internal declarations; TypeScript
 * source and credential files must never be published.
 */
export function inspectPackedFiles(manifest, files) {
  const problems = [];
  const present = new Set(files);
  if (!present.has('package.json')) problems.push('package.json is not in the tarball');
  const entries = [];
  if (typeof manifest.main === 'string') entries.push(['main', manifest.main]);
  if (typeof manifest.types === 'string') entries.push(['types', manifest.types]);
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    for (const [label, target] of exportTargets(value, `exports["${subpath}"]`)) entries.push([label, target]);
  }
  for (const [label, target] of entries) {
    const file = normalizeTarget(target);
    if (file.includes('*')) problems.push(`${label} uses a pattern (${target}); list explicit entry points`);
    else if (!present.has(file)) problems.push(`${label} target ${file} is not in the tarball`);
    if ((label === 'types' || label.endsWith('.types')) && !file.endsWith('.public.d.ts')) {
      problems.push(`${label} must name a generated .public.d.ts declaration, not ${file}`);
    }
  }
  for (const file of files) {
    if (/\.[cm]?ts$/u.test(file) && !/\.d\.[cm]?ts$/u.test(file)) problems.push(`${file} is TypeScript source`);
    if (forbiddenFile.test(file)) problems.push(`${file} must not be published`);
  }
  return problems;
}

/** Run a command, failing with its output rather than continuing. */
function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

/** SHA-512 Subresource Integrity string, the form npm records as dist.integrity. */
async function integrityOf(file) {
  return `sha512-${createHash('sha512').update(await readFile(file)).digest('base64')}`;
}

/** Pack every planned package into `out`, returning manifest entries in order. */
async function packAll(workspaceRoot, plan, workspace, out) {
  const entries = [];
  const problems = [];
  for (const planned of plan.packages) {
    const { manifest } = workspace.packages.find(entry => entry.manifest.name === planned.name);
    const [packed] = JSON.parse(run('npm', ['pack', '--workspace', planned.name, '--pack-destination', out, '--json', '--ignore-scripts'], { cwd: workspaceRoot }));
    for (const problem of inspectPackedFiles(manifest, packed.files.map(file => file.path))) problems.push(`${planned.name}: ${problem}`);
    const integrity = await integrityOf(path.join(out, packed.filename));
    if (integrity !== packed.integrity) problems.push(`${planned.name}: packed integrity changed while reading the tarball`);
    entries.push({ name: planned.name, version: planned.version, tarball: packed.filename, integrity, manifest });
  }
  if (problems.length > 0) throw new ReleasePlanError(problems);
  return entries;
}

/**
 * Install all tarballs into a scratch consumer and prove the graph works as
 * an external user would receive it.
 */
async function verifyInstall(entries, out) {
  const consumer = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-consumer-'));
  try {
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'microdelta-release-consumer', private: true, type: 'module' }));
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', ...entries.map(entry => path.join(out, entry.tarball))], { cwd: consumer });

    const lock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
    const problems = [];
    const installed = new Map();
    for (const [location, record] of Object.entries(lock.packages ?? {})) {
      const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
      if (!location.includes('node_modules/') || !isFirstParty(name)) continue;
      installed.set(name, record);
      if (!String(record.resolved ?? '').startsWith('file:')) problems.push(`${name} resolved from ${record.resolved}, not a local release tarball`);
      if (location !== `node_modules/${name}`) problems.push(`${name} was installed a second time at ${location}; versions are incoherent`);
    }
    for (const entry of entries) {
      const record = installed.get(entry.name);
      if (record === undefined) problems.push(`${entry.name} was not installed`);
      else if (record.version !== entry.version) problems.push(`${entry.name} installed ${record.version}, expected ${entry.version}`);
    }
    if (problems.length > 0) throw new ReleasePlanError(problems);
    process.stdout.write(`Installed ${entries.length} first-party packages from local tarballs.\n`);

    // Runtime: every package root must load from its built files.
    const imports = entries.map(entry => `await import(${JSON.stringify(entry.name)});`).join('\n');
    run(process.execPath, ['--input-type=module', '--eval', imports], { cwd: consumer });
    process.stdout.write('Every package root imports at runtime.\n');

    // Types: every exported entry resolves to public declarations that
    // typecheck strictly with normal package resolution (no project paths).
    const specifiers = entries.flatMap(entry => Object.keys(entry.manifest.exports ?? { '.': null }).map(subpath => (
      subpath === '.' ? entry.name : `${entry.name}/${subpath.replace(/^\.\//u, '')}`
    )));
    const source = specifiers.map((specifier, index) => `import * as entry${index} from ${JSON.stringify(specifier)};\nexport { entry${index} };`).join('\n');
    await writeFile(path.join(consumer, 'index.ts'), `${source}\n`);
    await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',
        types: ['node'],
        typeRoots: [path.join(repositoryRoot, 'node_modules/@types')],
      },
      files: ['index.ts'],
    }));
    run(process.execPath, [path.join(repositoryRoot, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: consumer });
    process.stdout.write('Public declarations typecheck for every package entry.\n');
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

/** The commit these artifacts represent: the Actions commit, else local HEAD. */
function currentCommit(workspaceRoot) {
  return process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot }).trim();
}

/** Parse arguments, plan, pack, verify, and write the release manifest. */
async function main() {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const out = option('--out');
  if (!out) throw new Error('usage: release-artifacts.mjs --out <directory> [--release] [--workspace <root>]');
  const workspaceRoot = path.resolve(option('--workspace') ?? repositoryRoot);
  const release = args.includes('--release');

  // Plan first: a refused graph never produces any artifact.
  const workspace = await readWorkspace(workspaceRoot);
  const plan = planRelease(workspace, { release });

  const target = path.resolve(out);
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length > 0) throw new Error(`${target} must be empty so stale tarballs cannot be published`);
  const entries = await packAll(workspaceRoot, plan, workspace, target);
  await verifyInstall(entries, target);

  const manifest = {
    repository: trustedPublisher.repository,
    commit: currentCommit(workspaceRoot),
    packages: entries.map(({ name, version, tarball, integrity }) => ({ name, version, tarball, integrity })),
  };
  await writeFile(path.join(target, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const entry of manifest.packages) process.stdout.write(`${entry.name}@${entry.version} ${entry.tarball} ${entry.integrity}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`Release artifact verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
