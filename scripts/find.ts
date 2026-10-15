// What `npm run model -- find` and `npm run tex -- find` print after their entries: how many
// matched and, when the limit cut them short, up to 40 more by id on one line and how many are
// left, so a search stays short and says what it left out.

/** Entries `find` prints in full unless --limit says otherwise (--json lists every one). */
export const FIND_LIMIT = 20;
/** How many of the other matches the line after the entries names; it counts the rest. */
const NAMED = 40;

/** One entry: an id and how many variants share it (models: `groupVariants`). */
export interface FindEntry {
  readonly id: string;
  readonly variants: number;
}

/** The lines after `shown` entries of `entries`, which hold `matches` assets ("model", "texture"). */
export function findFooter(kind: string, matches: number, entries: readonly FindEntry[], shown: number): string[] {
  const rest = entries.slice(shown);
  const named = rest.slice(0, NAMED).map((e) => (e.variants ? `${e.id} (+${e.variants})` : e.id));
  return [
    '',
    ...(rest.length ? [`also: ${named.join(', ')}${rest.length > NAMED ? `, and ${rest.length - NAMED} more` : ''}`] : []),
    `${matches} ${kind}(s)${entries.length < matches ? ` in ${entries.length} entries (a model's variants share one)` : ''}${rest.length ? `; ${shown} of the ${entries.length} in full (--limit ${entries.length} for all)` : ''}`,
  ];
}
