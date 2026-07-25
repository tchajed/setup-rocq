// See: https://eslint.org/docs/latest/use/configure/configuration-files

import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import jest from 'eslint-plugin-jest'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import globals from 'globals'

export default [
  {
    ignores: ['**/coverage', '**/dist', '**/linter', '**/node_modules'],
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  jest.configs['flat/recommended'],
  prettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
      },

      ecmaVersion: 2023,
      sourceType: 'module',

      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '__fixtures__/*.ts',
            '__tests__/*.ts',
            'eslint.config.mjs',
            'jest.config.js',
            'rollup.config.ts',
          ],
          // The globs above already matched the default cap of 8 files,
          // so a single new test file fails the lint with "Too many
          // files (>8) have matched the default project".  The cost of
          // raising it is lint speed on these few files.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      camelcase: 'off',
      'no-console': 'off',
      'no-shadow': 'off',
      'no-unused-vars': 'off',
      'prettier/prettier': 'error',
    },
  },
]
