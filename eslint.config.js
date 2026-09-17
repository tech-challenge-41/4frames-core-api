const { ignores, configs } = require('@eduzz/eslint-config');

module.exports = [
  ...configs,
  {
    files: ['**/*.ts'],
    rules: { 'max-lines': ['error', { max: 10000 }] }
  },
  { ignores: ignores() }
];
