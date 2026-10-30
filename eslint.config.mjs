import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

const protectedPaths = ['**/.env', '**/.env.*', '**/.local/**', '**/node_modules/**', '**/dist/**'];
export default [
  {ignores: protectedPaths},
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}', 'scripts/*.tsx'],
    languageOptions: {parser: tseslint.parser, parserOptions: {ecmaFeatures: {jsx: true}}},
    plugins: {'@typescript-eslint': tseslint.plugin, 'react-hooks': hooks},
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
      '@typescript-eslint/no-explicit-any': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
