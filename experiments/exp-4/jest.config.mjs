/** Only emitted EXP-4 test files run; source remains strict TypeScript. */
export default {
  rootDir: import.meta.dirname,
  roots: ['<rootDir>/.test-build/test'],
  testMatch: ['**/*.test.js'],
  transform: {},
  testEnvironment: 'node',
};
