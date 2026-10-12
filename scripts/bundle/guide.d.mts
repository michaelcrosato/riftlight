/** A named code block of docs/GUIDE.md or docs/GUIDE-ASSETS.md (see guide.mjs). */
export interface GuideBlock {
  name: string;
  code: string;
  line: number;
}

export function guideBlocks(markdown: string): GuideBlock[];

/** Whether a block is a game (it ends by starting the engine) rather than a module a game imports. */
export function startsEngine(code: string): boolean;
