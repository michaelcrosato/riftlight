// The named code blocks of docs/GUIDE.md, docs/GUIDE-CONTROLS.md (the kit's CONTROLS.md),
// docs/GUIDE-RECIPES.md (RECIPES.md) and docs/GUIDE-ASSETS.md: a fence whose info string is
// `js <name>` is a whole game (it imports from './pixel-engine.js' and starts the engine) or, in
// GUIDE-ASSETS.md, a module a game imports ('./<name>.js', the game's own models). `quickstart`
// becomes the kit's game.js, every other one examples/<name>.js, with a page when it starts the
// engine. src/guide.test.ts, src/guide-controls.test.ts, src/guide-recipes.test.ts and
// src/guide-assets.test.ts check them; the bundle e2e suite plays every game, so the guides' code
// can't rot. Plain ```js fences are snippets and aren't run. A fence `html <name>` is the head of
// that game's page (52in1's tags): its page carries 52in1's session client first, then the tags
// (`examplePage`), as docs/GUIDE-CONTROLS.md section 6 says.

/** @returns {{ name: string, code: string, line: number }[]} */
export function guideBlocks(markdown) {
  const blocks = [];
  const re = /^```js ([a-z][a-z0-9-]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  for (let m; (m = re.exec(markdown)); ) {
    blocks.push({ name: m[1], code: m[2], line: markdown.slice(0, m.index).split('\n').length });
  }
  return blocks;
}

/** Whether a block is a game (it ends by starting the engine, where there is a page) rather than a module a game imports. */
export function startsEngine(code) {
  return /^(if \(typeof document !== 'undefined'\) )?await Engine\.start\(/m.test(code);
}

/** The `html <name>` fences: each game's head tags, by the game's name. @returns {Map<string, string>} */
export function guideHeads(markdown) {
  const heads = new Map();
  for (const m of markdown.matchAll(/^```html ([a-z][a-z0-9-]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm)) heads.set(m[1], m[2]);
  return heads;
}

/**
 * A page of the kit for `script`: with `head` (a game's `html <name>` fence), 52in1's session client
 * (`client`: scripts/hub/session.js, `SESSION_CLIENT`) is its first script, right after <meta charset>,
 * and the tags follow it before anything else, where 52in1's catalogue looks for them. A head that
 * gives the page's title and icon (52in1's catalogue does) keeps them: `title` and the blank icon
 * are for a page without.
 */
export function examplePage({ title, script, head = '', client = '' }) {
  if (head && !client.startsWith('/*! aihub-session ')) throw new Error(`bundle: ${script}'s page has hub tags but no session client`);
  // the client byte for byte (52in1 replaces an unmodified copy with each new version)
  const tags = head ? `\n${head.replace(/^(?=.)/gm, '    ').trimEnd()}` : '';
  const icon = /<link rel="icon"/.test(head) ? '' : '\n    <link rel="icon" href="data:," />';
  const own = /<title>/.test(head) ? '' : `\n    <title>${title}</title>`;
  // the viewport before the head's tags (its game-lines block is a script: nothing of the catalogue's after it)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />${head ? `\n    <script>${client}</script>` : ''}
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />${tags}${icon}${own}
    <style>html, body { margin: 0; height: 100%; background: #0d0b14; } #app { position: fixed; inset: 0; }</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./${script}"></script>
  </body>
</html>
`;
}
