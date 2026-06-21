// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '**/fixtures/**',
      'services/voice-server/vendor/**',
      'services/voice-server/prefix/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node script files (e.g. the voice-server fake bridge) run under `node`.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setInterval: 'readonly',
      },
    },
  },
  {
    rules: {
      // Allow intentionally-unused args/vars when prefixed with `_` (common in
      // interface-satisfying no-op stubs).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
