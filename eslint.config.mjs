import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
      '.lighthouseci/**',
    ],
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.{js,mjs}', '*.mjs', '*.cjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
  {
    files: ['.generated/inline-script.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: js.configs.recommended.rules,
  },
];
