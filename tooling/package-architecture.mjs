/**
 * ARC-001/003 owner registry for source import enforcement. Entries without a
 * directory describe accepted architectural roles, not implemented packages.
 * An edge means permission to consume another role's declared contract; it
 * does not transfer the other role's invariants or grant source access.
 */
export const roles = Object.freeze({
  facade: { directory: 'core', packageName: 'microdelta', kind: 'assembly', uses: ['definition', 'tracking', 'resolution', 'history', 'supervision', 'accounting', 'value', 'materialization', 'machine-node'] },
  definition: { directory: 'definition', packageName: '@microdelta/definition', kind: 'context', uses: ['value'] },
  tracking: { directory: 'tracking', packageName: '@microdelta/tracking', kind: 'context', uses: ['value', 'machine'] },
  resolution: { directory: null, packageName: '@microdelta/resolution', kind: 'context', uses: ['definition', 'tracking', 'history', 'materialization'] },
  history: { directory: 'history', packageName: '@microdelta/history', kind: 'context', uses: ['value', 'machine'] },
  supervision: { directory: null, packageName: '@microdelta/supervision', kind: 'context', uses: ['definition', 'resolution', 'accounting'] },
  accounting: { directory: null, packageName: '@microdelta/accounting', kind: 'context', uses: [] },
  value: { directory: 'value', packageName: '@microdelta/value', kind: 'support', uses: ['machine'] },
  materialization: { directory: null, packageName: '@microdelta/materialization', kind: 'support', uses: ['history', 'tracking', 'value'] },
  machine: { directory: 'machine', packageName: '@microdelta/machine', kind: 'host-contract', uses: [] },
  'machine-node': { directory: 'machine-node', packageName: '@microdelta/machine-node', kind: 'host-implementation', uses: ['machine'] },
});

/** Reverse lookup makes an unknown workspace package fail closed. */
export const roleByDirectory = Object.freeze(Object.fromEntries(
  Object.entries(roles).filter(([, role]) => role.directory !== null).map(([name, role]) => [role.directory, name]),
));

/** Reverse lookup keeps unknown scoped imports distinct from third-party code. */
export const roleByPackage = Object.freeze(Object.fromEntries(
  Object.entries(roles).map(([name, role]) => [role.packageName, name]),
));
