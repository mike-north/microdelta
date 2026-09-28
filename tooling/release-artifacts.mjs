/**
 * Pack and verify the first-party release artifacts.
 *
 * Produces, in `--out`, one npm tarball per package in the release graph plus
 * `release-manifest.json` (repository, commit, dependency-ordered packages
 * with tarball integrity). These are the exact bytes the publish job later
 * sends to npm. Verification happens before anything leaves the runner:
 * the graph is validated (see release-graph.mjs); each tarball's file list
 * must contain its runtime and public declaration entry points and no source
 * or credentials; every first-party package that a tarball's emitted
 * JavaScript or declarations import must be a declared dependency; and each
 * package is installed *alone* into a scratch consumer, with its declared
 * first-party closure redirected to the local tarballs. That install must
 * never take a first-party package from the registry, must import the package
 * root, and must typecheck every exported entry through its public
 * declarations, so an undeclared dependency cannot hide behind a sibling
 * tarball installed beside it. Finally, the Node adapter is installed with
 * install scripts enabled and its SQLite capability writes, reopens and reads
 * a temporary database, proving the native binding a normal install builds
 * actually loads. Third-party dependencies resolve normally. `--release`
 * additionally refuses the reserved bootstrap version; the package job always
 * passes it.
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
    entries.push({ name: planned.name, version: planned.version, tarball: packed.filename, integrity, manifest, files: packed.files.map(file => file.path) });
  }
  if (problems.length > 0) throw new ReleasePlanError(problems);
  return entries;
}

/** Emitted files whose import specifiers a consumer's runtime or compiler resolves. */
const emittedModule = /\.(?:[cm]?js|d\.[cm]?ts)$/u;

/**
 * Static module specifiers: `from '…'` (imports, re-exports, type imports),
 * side-effect `import '…'`, literal dynamic `import('…')`, and `require('…')`.
 * Computed specifiers are invisible here; the isolated install covers them.
 */
const specifierPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/gu;

/** The package a bare specifier names (`@scope/name/sub` → `@scope/name`). */
function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * First-party packages that a package's emitted JavaScript or declarations
 * import without declaring them in `dependencies`, `optionalDependencies`, or
 * `peerDependencies`. A consumer installing that package from npm would not
 * receive such a package, even though a scratch install of every tarball
 * would hide the omission. Self-references are allowed. `files` maps
 * tarball-relative paths to contents; each `{ file, dependency }` is reported
 * once, in order of appearance.
 */
export function undeclaredFirstPartyImports(manifest, files) {
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const findings = [];
  for (const [file, content] of files) {
    if (!emittedModule.test(file)) continue;
    const seen = new Set();
    for (const match of content.matchAll(specifierPattern)) {
      const dependency = packageNameOf(match[2]);
      if (!isFirstParty(dependency) || declared.has(dependency) || seen.has(dependency)) continue;
      seen.add(dependency);
      findings.push({ file, dependency });
    }
  }
  return findings;
}

/** Read every emitted module of one tarball as it will be published. */
async function tarballModules(tarball, files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-extract-'));
  try {
    run('tar', ['-xzf', tarball, '-C', directory]);
    const contents = new Map();
    for (const file of files.filter(name => emittedModule.test(name))) {
      contents.set(file, await readFile(path.join(directory, 'package', file), 'utf8'));
    }
    return contents;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Refuse any package whose published modules import an undeclared first-party package. */
async function verifyDeclaredImports(entries, out) {
  const problems = [];
  for (const entry of entries) {
    const modules = await tarballModules(path.join(out, entry.tarball), entry.files);
    for (const { file, dependency } of undeclaredFirstPartyImports(entry.manifest, modules)) {
      problems.push(`${entry.name} imports ${dependency} in ${file} but does not declare it as a runtime dependency`);
    }
  }
  if (problems.length > 0) throw new ReleasePlanError(problems);
  process.stdout.write('Every emitted first-party import is a declared dependency.\n');
}

/**
 * Create a scratch consumer that depends on exactly one release package.
 * Every other first-party package is available only through `overrides`,
 * which redirect *declared* dependencies to local tarballs and never add an
 * undeclared one. This mirrors a user installing that one package from npm
 * without letting the registry supply any first-party version.
 */
async function isolatedConsumer(entry, entries, out, { ignoreScripts }) {
  const consumer = await mkdtemp(path.join(os.tmpdir(), 'microdelta-release-consumer-'));
  const tarball = candidate => `file:${path.join(out, candidate.tarball)}`;
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'microdelta-release-consumer',
    private: true,
    type: 'module',
    dependencies: { [entry.name]: tarball(entry) },
    overrides: Object.fromEntries(entries.filter(other => other.name !== entry.name).map(other => [other.name, tarball(other)])),
  }));
  run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', ...(ignoreScripts ? ['--ignore-scripts'] : [])], { cwd: consumer });
  return consumer;
}

/** Every installed first-party package must be the release tarball at its release version. */
async function verifyLocalResolution(consumer, entries) {
  const lock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
  const expected = new Map(entries.map(entry => [entry.name, entry.version]));
  const problems = [];
  for (const [location, record] of Object.entries(lock.packages ?? {})) {
    if (!location.includes('node_modules/')) continue;
    const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!isFirstParty(name)) continue;
    if (!String(record.resolved ?? '').startsWith('file:')) problems.push(`${name} resolved from ${record.resolved}, not a local release tarball`);
    if (location !== `node_modules/${name}`) problems.push(`${name} was installed a second time at ${location}; versions are incoherent`);
    if (!expected.has(name)) problems.push(`${name} was installed but is not part of this release`);
    else if (record.version !== expected.get(name)) problems.push(`${name} installed ${record.version}, expected ${expected.get(name)}`);
  }
  if (problems.length > 0) throw new ReleasePlanError(problems);
}

/** Strictly typecheck the given specifiers through their published declarations. */
async function typecheck(consumer, specifiers) {
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
}

/**
 * Install each package alone and prove it works as an external user would
 * receive it: its declared first-party closure resolves only to local
 * tarballs at release versions, its root imports at runtime, and every
 * exported entry typechecks through its public declarations. Install scripts
 * are suppressed here; the native check below installs normally.
 */
async function verifyIsolatedInstalls(entries, out) {
  for (const entry of entries) {
    const consumer = await isolatedConsumer(entry, entries, out, { ignoreScripts: true });
    try {
      await verifyLocalResolution(consumer, entries);
      run(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(entry.name)});`], { cwd: consumer });
      await typecheck(consumer, Object.keys(entry.manifest.exports ?? { '.': null }).map(subpath => (
        subpath === '.' ? entry.name : `${entry.name}/${subpath.replace(/^\.\//u, '')}`
      )));
      process.stdout.write(`Isolated install of ${entry.name}@${entry.version} resolved its first-party dependencies from local tarballs, imported, and typechecked.\n`);
    } finally {
      await rm(consumer, { recursive: true, force: true });
    }
  }
}

/** The owner of Node's native SQLite binding, whose install step must really run. */
const nodeAdapter = '@microdelta/machine-node';

/** A value written and read back to show the native binding stores data. */
const sqliteProbeValue = 'microdelta release check';

/**
 * Exercise the installed Node SQLite capability in `consumer`: open a
 * temporary database file, create a table, write a row in a transaction,
 * read it, close, reopen the same file, read it again, and close. This loads
 * better-sqlite3's native binding, which importing the package root does not.
 * It uses the adapter's runtime export only; no declaration tier changes.
 * Throws with the child's diagnostics when the binding is missing or broken.
 */
export function verifyNodeSqlite(consumer) {
  const script = [
    `import { createNodeSqlite } from ${JSON.stringify(nodeAdapter)};`,
    "import { mkdtempSync, rmSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import { join } from 'node:path';",
    "const directory = mkdtempSync(join(tmpdir(), 'microdelta-sqlite-check-'));",
    'try {',
    "  const file = join(directory, 'check.sqlite');",
    '  const sqlite = createNodeSqlite();',
    '  let connection = sqlite.openSqlite(file);',
    "  connection.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, note TEXT NOT NULL)');",
    `  connection.transaction(() => connection.prepare('INSERT INTO evidence (id, note) VALUES (1, ?)').run(${JSON.stringify(sqliteProbeValue)}));`,
    "  const written = connection.prepare('SELECT note FROM evidence WHERE id = 1').get()?.note;",
    '  connection.close();',
    '  connection = sqlite.openSqlite(file);',
    "  const reopened = connection.prepare('SELECT note FROM evidence WHERE id = 1').get()?.note;",
    '  connection.close();',
    '  process.stdout.write(JSON.stringify({ written, reopened }));',
    '} finally {',
    '  rmSync(directory, { recursive: true, force: true });',
    '}',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { cwd: consumer, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Node SQLite capability check failed:\n${result.stderr.trim() || result.stdout.trim()}`);
  const evidence = JSON.parse(result.stdout);
  if (evidence.written !== sqliteProbeValue || evidence.reopened !== sqliteProbeValue) {
    throw new Error(`Node SQLite capability check failed: read back ${JSON.stringify(evidence)}`);
  }
  return evidence;
}

/**
 * Install the Node adapter alone with dependency install scripts enabled, as
 * a consumer's normal `npm install` does, then exercise its SQLite
 * capability. Runs only in the package job, which holds no OIDC permission.
 */
async function verifyNativeSqlite(entries, out) {
  const entry = entries.find(candidate => candidate.name === nodeAdapter);
  if (entry === undefined) {
    process.stdout.write(`${nodeAdapter} is not in this release graph; the native SQLite check does not apply.\n`);
    return;
  }
  const consumer = await isolatedConsumer(entry, entries, out, { ignoreScripts: false });
  try {
    await verifyLocalResolution(consumer, entries);
    verifyNodeSqlite(consumer);
    process.stdout.write(`Node SQLite capability wrote, reopened and read a temporary database through the installed ${nodeAdapter} tarball.\n`);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

/** Every release check that runs against the packed tarballs. */
async function verifyInstall(entries, out) {
  await verifyDeclaredImports(entries, out);
  await verifyIsolatedInstalls(entries, out);
  await verifyNativeSqlite(entries, out);
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

