// The named code blocks of docs/GUIDE.md: a fence whose info string is `js <name>` is a whole
// game (it imports from './pixel-engine.js' and starts the engine). `quickstart` becomes the
// kit's game.js, every other one examples/<name>.js. The bundle e2e suite plays them all, so
// the guide's code can't rot. Plain ```js fences are snippets and aren't run.

/** @returns {{ name: string, code: string, line: number }[]} */
export function guideBlocks(markdown) {
  const blocks = [];
  const re = /^```js ([a-z][a-z0-9-]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  for (let m; (m = re.exec(markdown)); ) {
    blocks.push({ name: m[1], code: m[2], line: markdown.slice(0, m.index).split('\n').length });
  }
  return blocks;
}
