/** A named code block of docs/GUIDE.md or docs/GUIDE-ASSETS.md (see guide.mjs). */
export interface GuideBlock {
  name: string;
  code: string;
  line: number;
}

export function guideBlocks(markdown: string): GuideBlock[];

/** Whether a block is a game (it ends by starting the engine) rather than a module a game imports. */
export function startsEngine(code: string): boolean;

/** The `html <name>` fences: each game's head tags (52in1's), by the game's name. */
export function guideHeads(markdown: string): Map<string, string>;

/** A kit page for `script`; with `head`, 52in1's session client (`client`, unmodified) first after <meta charset>, then the tags. */
export function examplePage(o: { title: string; script: string; head?: string; client?: string }): string;
