/**
 * Removes this workspace's generated build outputs so a build, check, and test
 * run can start from a known state. Deletion is limited to an explicit
 * enumeration of output locations derived from the workspace layout; it never
 * follows a pattern into `node_modules`, source, `scratch/`, or tracked files.
 * (A blanket `git clean -X` also deletes ignored `dist/` directories inside
 * `node_modules`, which is the failure this module exists to prevent.)
 */
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Output directories every package, experiment, fixture, and example project may generate. */
const projectOutputDirectories = ['dist', 'temp', '.test-build'];
/** Workspace-level generated directories. */
const rootOutputDirectories = ['.test-build', 'coverage'];
/** Parents whose immediate child directories are projects with generated outputs. */
const projectParents = ['packages', 'experiments', 'examples', 'fixtures/declarations'];

/** Immediate subdirectory names of `directory`, or none when it does not exist. */
function childDirectories(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
      .map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Names of `*.tsbuildinfo` files directly inside `directory`. */
function buildInfoFiles(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.tsbuildinfo'))
      .map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Absolute paths of every generated output under `root`. Each path is a fixed
 * output name directly beneath a project directory (or the root), so no target
 * can lie inside `node_modules` or outside `root`.
 */
export function generatedOutputTargets(root) {
  const targets = rootOutputDirectories.map(name => path.join(root, name));
  for (const parent of projectParents) {
    for (const project of childDirectories(path.join(root, parent))) {
      const projectDirectory = path.join(root, parent, project);
      for (const name of projectOutputDirectories) targets.push(path.join(projectDirectory, name));
      if (parent === 'packages') {
        for (const name of buildInfoFiles(projectDirectory)) targets.push(path.join(projectDirectory, name));
      }
    }
  }
  return targets;
}

/** Remove every generated output under `root`; absent targets are not an error. */
export function cleanGeneratedOutputs(root) {
  const targets = generatedOutputTargets(root);
  for (const target of targets) rmSync(target, { recursive: true, force: true });
  return targets;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  cleanGeneratedOutputs(root);
  console.log('Removed generated build outputs.');
}
