import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-single', 'bundle', 'node_modules', '.scratch', 'public', '.claude/worktrees'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright page.evaluate callbacks run in the browser.
    files: ['scripts/e2e.mjs', 'scripts/e2e-moves.mjs', 'scripts/e2e-systems.mjs', 'scripts/e2e-riftlight.mjs', 'scripts/bundle/check.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
