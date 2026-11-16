/** Ordinary deterministic regressions exclude the separately gated native entrypoint. */
export default { rootDir: import.meta.dirname, roots: ['<rootDir>/../../.test-build/experiments/exp-wal-coordinated-snapshot/test'], testMatch: ['**/*.test.js'], transform: {}, testEnvironment: 'node' };
