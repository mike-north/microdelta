/**
 * First-party npm release graph for microdelta.
 *
 * This module decides *which* workspace packages a release publishes and in
 * what order, and refuses any graph that could produce a broken or
 * unauthorized registry state. It never contacts npm. The graph is the facade
 * (`microdelta`) plus every non-private workspace package, closed over
 * first-party runtime dependencies. Each member must be registered for npm
 * trusted publishing against `trustedPublisher`, must depend on siblings at
 * their exact workspace versions, and must publish publicly from this
 * repository. Registration itself is an operator action on npmjs.com; the list
 * below records it so an unregistered new owner fails before any publish.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The single identity npm trusts to publish every first-party package: this
 * repository's `release.yml` workflow. Renaming the workflow file or moving the
 * repository breaks every trust connection and requires re-registration.
 */
export const trustedPublisher = Object.freeze({ repository: 'mike-north/microdelta', workflow: 'release.yml' });

/** The repository URL npm compares with provenance; it must match exactly. */
export const repositoryUrl = `git+https://github.com/${trustedPublisher.repository}.git`;

/**
 * Package names with a saved npm trusted-publisher connection to
 * `trustedPublisher` (read back 2026-09-27; see docs/validation). Resolution
 * and Supervision are registered ahead of their workspace packages. Adding a
 * name here is only truthful after the npm-side connection exists.
 */
export const registeredPackages = Object.freeze([
  'microdelta',
  '@microdelta/machine',
  '@microdelta/value',
  '@microdelta/history',
  '@microdelta/machine-node',
  '@microdelta/tracking',
  '@microdelta/definition',
  '@microdelta/materialization',
  '@microdelta/resolution',
  '@microdelta/supervision',
]);

/**
 * Version already occupied on npm by manifest/README-only namespace bootstrap
 * packages. It is never an implementation release, and npm versions are
 * immutable, so no release may select it.
 */
export const bootstrapVersion = '0.0.0';

/** The package whose runtime closure must always be complete. */
export const releaseEntry = 'microdelta';

/** Runtime dependency fields a consumer's install resolves. */
const runtimeDependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/** Specifiers that only resolve inside this checkout. */
const localProtocol = /^(?:workspace|file|link|portal):/u;

/** Strict SemVer 2.0.0 (no leading `v`, no ranges). */
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

/** Whether a package name belongs to this project's npm namespace. */
export function isFirstParty(name) {
  return name === releaseEntry || (typeof name === 'string' && /^@microdelta\/[a-z0-9-]+$/u.test(name));
}

/** A refused release plan, carrying every diagnostic rather than the first. */
export class ReleasePlanError extends Error {
  constructor(problems) {
    super(`Release plan refused:\n- ${problems.join('\n- ')}`);
    this.name = 'ReleasePlanError';
    this.problems = problems;
  }
}

/**
 * Read the root manifest and every manifest in its `packages/*` workspaces.
 * Directories without a manifest are ignored, matching npm workspace globbing.
 */
export async function readWorkspace(rootDirectory) {
  const root = JSON.parse(await readFile(path.join(rootDirectory, 'package.json'), 'utf8'));
  const patterns = Array.isArray(root.workspaces) ? root.workspaces : [];
  const packages = [];
  for (const pattern of patterns) {
    if (!/^[^*]+\/\*$/u.test(pattern)) throw new ReleasePlanError([`unsupported workspace pattern ${pattern}`]);
    const parent = pattern.slice(0, -2);
    const entries = await readdir(path.join(rootDirectory, parent), { withFileTypes: true });
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const directory = `${parent}/${entry.name}`;
      const text = await readFile(path.join(rootDirectory, directory, 'package.json'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (text !== undefined) packages.push({ directory, manifest: JSON.parse(text) });
    }
  }
  return { root, packages };
}

/** First-party runtime dependency specifiers declared by one manifest. */
function firstPartyDependencies(manifest) {
  const result = [];
  for (const field of runtimeDependencyFields) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (isFirstParty(name)) result.push({ name, spec, field });
    }
  }
  return result;
}

/** Publication metadata every released manifest must carry. */
function publicationProblems(manifest, directory) {
  const problems = [];
  const { name } = manifest;
  if (!registeredPackages.includes(name)) {
    problems.push(`${name} is not registered for npm trusted publishing with ${trustedPublisher.repository} ${trustedPublisher.workflow}; configure npm first, then record it`);
  }
  if (manifest.repository?.url !== repositoryUrl) problems.push(`${name} repository.url must be ${repositoryUrl}`);
  if (manifest.repository?.directory !== directory) problems.push(`${name} repository.directory must be ${directory}`);
  if (manifest.publishConfig?.access !== 'public') problems.push(`${name} publishConfig.access must be public`);
  const extra = Object.keys(manifest.publishConfig ?? {}).filter(key => key !== 'access');
  if (extra.length > 0) problems.push(`${name} publishConfig may only set access (found ${extra.join(', ')})`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) problems.push(`${name} must list its published files`);
  return problems;
}

/**
 * Validate the workspace and return the dependency-ordered publish list.
 *
 * `release: true` additionally refuses the reserved bootstrap version; it is
 * used when packing an actual release commit. Without it the same structural
 * checks run on ordinary checkouts whose versions are still unreleased.
 */
export function planRelease(workspace, { release }) {
  const problems = [];
  if (workspace.root.private !== true) problems.push('workspace root must remain private');

  const byName = new Map();
  for (const entry of workspace.packages) {
    const { name } = entry.manifest;
    if (!isFirstParty(name)) problems.push(`${name} is not a first-party microdelta package name`);
    if (byName.has(name)) problems.push(`${name} is declared by more than one workspace directory`);
    byName.set(name, entry);
  }

  // The closure starts from the facade and every package meant to be public,
  // then follows first-party runtime edges so a private or missing owner is
  // detected where it is required.
  const selected = new Map();
  const requiredBy = new Map();
  const queue = [];
  const require = (name, by) => {
    if (!requiredBy.has(name)) requiredBy.set(name, by);
    if (!selected.has(name)) queue.push(name);
    selected.set(name, true);
  };
  require(releaseEntry, 'the release entry');
  for (const entry of workspace.packages) {
    if (entry.manifest.private !== true && isFirstParty(entry.manifest.name)) require(entry.manifest.name, 'its own public manifest');
  }
  while (queue.length > 0) {
    const name = queue.shift();
    const entry = byName.get(name);
    if (entry === undefined) continue;
    for (const dependency of firstPartyDependencies(entry.manifest)) require(dependency.name, name);
  }

  const members = [];
  for (const name of selected.keys()) {
    const entry = byName.get(name);
    if (entry === undefined) {
      problems.push(`${requiredBy.get(name)} depends on ${name}, which is not a workspace package`);
      continue;
    }
    const { manifest, directory } = entry;
    if (manifest.private === true) {
      problems.push(`${name} is private but required by ${requiredBy.get(name)}`);
      continue;
    }
    if (typeof manifest.version !== 'string' || !semver.test(manifest.version)) {
      problems.push(`${name} has invalid version ${manifest.version}`);
    } else if (release && manifest.version === bootstrapVersion) {
      problems.push(`${name}@${bootstrapVersion} is the reserved npm bootstrap version; add a changeset so the release selects a new version`);
    }
    problems.push(...publicationProblems(manifest, directory));
    for (const field of runtimeDependencyFields) {
      for (const [dependency, spec] of Object.entries(manifest[field] ?? {})) {
        if (localProtocol.test(spec)) problems.push(`${name} uses local protocol ${spec} for ${dependency}`);
      }
    }
    for (const dependency of firstPartyDependencies(manifest)) {
      const target = byName.get(dependency.name);
      if (target === undefined || localProtocol.test(dependency.spec)) continue;
      if (dependency.spec !== target.manifest.version) {
        problems.push(`${name} requires ${dependency.name}@${dependency.spec} but the workspace version is ${target.manifest.version}; first-party ranges must pin the exact released version`);
      }
    }
    members.push(entry);
  }

  const order = topologicalOrder(members, byName, problems);
  if (problems.length > 0) throw new ReleasePlanError(problems);
  return {
    packages: order.map(entry => ({ name: entry.manifest.name, version: entry.manifest.version, directory: entry.directory })),
  };
}

/**
 * Dependencies before dependents, ties broken by name so repeated runs publish
 * in the same order. A cycle is refused: no order could publish it safely.
 */
function topologicalOrder(members, byName, problems) {
  const names = new Set(members.map(entry => entry.manifest.name));
  const pending = new Map(members.map(entry => [
    entry.manifest.name,
    new Set(firstPartyDependencies(entry.manifest).map(item => item.name).filter(name => names.has(name) && byName.has(name))),
  ]));
  const order = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(([, deps]) => deps.size === 0).map(([name]) => name).sort();
    if (ready.length === 0) {
      problems.push(`dependency cycle among ${[...pending.keys()].sort().join(', ')}`);
      break;
    }
    for (const name of ready) {
      pending.delete(name);
      order.push(byName.get(name));
      for (const deps of pending.values()) deps.delete(name);
    }
  }
  return order;
}

/**
 * CLI for `npm run check:release`: validates the checked-out graph
 * structurally on every CI run, so a new or changed first-party owner that
 * would break a later release fails in its own pull request. Versions are not
 * required to be releasable here; the package job applies `release: true`.
 */
async function main() {
  const index = process.argv.indexOf('--workspace');
  const directory = index === -1 ? fileURLToPath(new URL('../', import.meta.url)) : path.resolve(process.argv[index + 1]);
  const plan = planRelease(await readWorkspace(directory), { release: false });
  process.stdout.write(`Release publish order: ${plan.packages.map(entry => `${entry.name}@${entry.version}`).join(' -> ')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
