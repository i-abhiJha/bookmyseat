export default {
  testEnvironment: 'node',
  transform: {}, // native ESM, no Babel transform needed
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 15000,
};
