/** Tests execute compiled ESM without a second transform pipeline. */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/.test-build/test'],
  testMatch: ['**/*.test.js'],
  transform: {},
};
