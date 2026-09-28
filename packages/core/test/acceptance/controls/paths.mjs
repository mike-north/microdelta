/**
 * Filesystem locations for the acceptance control runner. The runner lives
 * five directories below the repository root; its emitted production targets
 * and Jest configuration are addressed from that root on the local filesystem.
 */

/**
 * The repository root, as a local filesystem path, for a module URL inside
 * `packages/core/test/acceptance/controls/`.
 * @param moduleUrl - The runner module's `import.meta.url`.
 * @returns The repository root directory path.
 */
export function repositoryRoot(moduleUrl) {
  return new URL('../../../../../', moduleUrl).pathname;
}
