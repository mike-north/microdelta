/** EXP-2 executes emitted ESM, so runtime assertions exercise the checked source. */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/.test-build'],
  testMatch: ['**/*.test.js'],
  transform: {},
};
