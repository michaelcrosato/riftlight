/**
 * Seconds a townsperson's line shows where it has to cover something (a phone's stacked item
 * windows: `TalkPlace.over`; the passive tree's view: `TreeView`), by its length: long enough to
 * read, then out of the way. No imports: the tree's own page loads it too.
 */
export const talkSeconds = (text: string): number => Math.min(9, Math.max(4, 2 + [...text].length * 0.06));
