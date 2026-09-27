/** The EXP-3 suite runs emitted ESM, including fresh Node child processes. */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/../../.test-build/experiments/exp-3/test'],
  testMatch: ['**/*.test.js'],
  transform: {},
};
