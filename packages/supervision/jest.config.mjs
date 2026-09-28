/** Run Supervision's owner tests as emitted ESM against the production module. */
export default { testEnvironment: 'node', roots: ['<rootDir>/.test-build/test'], testMatch: ['**/*.test.js'], transform: {} };
