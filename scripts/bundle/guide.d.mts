/** A named code block of docs/GUIDE.md (see guide.mjs). */
export interface GuideBlock {
  name: string;
  code: string;
  line: number;
}

export function guideBlocks(markdown: string): GuideBlock[];
