// The named code blocks of docs/GUIDE.md and docs/GUIDE-ASSETS.md: a fence whose info string is
// `js <name>` is a whole game (it imports from './pixel-engine.js' and starts the engine) or, in
// GUIDE-ASSETS.md, a module a game imports ('./<name>.js', the game's own models). `quickstart`
// becomes the kit's game.js, every other one examples/<name>.js, with a page when it starts the
// engine. The bundle e2e suite plays every game, so the guides' code can't rot. Plain ```js
// fences are snippets and aren't run.

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
