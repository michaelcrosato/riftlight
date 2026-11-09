import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // scripts/hub/session.js and scripts/hub/harness/ are the AI Hub's own, vendored unmodified (docs/game/session.md)
  { ignores: ['dist', 'dist-single', 'bundle', 'node_modules', '.scratch', 'public', '.claude/worktrees', 'scripts/hub/session.js', 'scripts/hub/harness'] },
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
    files: ['scripts/e2e.mjs', 'scripts/e2e-moves.mjs', 'scripts/e2e-systems.mjs', 'scripts/e2e-riftlight.mjs', 'scripts/e2e-hub.mjs', 'scripts/lang-audit.mjs', 'scripts/bundle/check.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
