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
);
