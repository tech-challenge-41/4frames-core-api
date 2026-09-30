const { ignores, configs } = require('@eduzz/eslint-config');

module.exports = [
  ...configs,
  {
    files: ['**/*.ts'],
    rules: { 'max-lines': ['error', { max: 10000 }] }
  },
  {
    // Scripts do k6 e do Node do host nos testes de carga: sintaxe atual, sem o TypeScript.
    files: ['tests/load/**/*.{js,mjs}'],
    languageOptions: { parserOptions: { ecmaVersion: 'latest' } }
  },
  { ignores: ignores('**/dist/**', '**/coverage/**', '**/generated/**') }
];
