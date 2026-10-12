/**
 * The attribution list (`npm run model -- credits`, docs/plans/asset-system.md §7.7): every
 * imported model and texture with a `source`, grouped by pack (or url), with what its licence
 * owes the author (`LICENCES`).
 */
import type { Provenance } from '../types';
import { LICENCES, type LicenceTerms } from './licences';

/** Anything imported: a ModelDef or a TextureDef. */
interface Sourced {
  readonly id: string;
  readonly source?: Provenance;
}

export interface CreditEntry {
  /** The pack, or the url when it came from no pack. */
  readonly what: string;
  readonly author: string;
  readonly licence: string;
  readonly name: string;
  readonly credit: LicenceTerms['credit'];
  readonly url: string;
  readonly models: readonly string[];
  readonly textures: readonly string[];
}

/** Credits for the models and textures that carry a `source`, in the order first met. */
export function creditEntries(models: readonly Sourced[], textures: readonly Sourced[]): CreditEntry[] {
  const groups = new Map<string, { kind: 'model' | 'texture'; d: Sourced }[]>();
  const all = [...models.map((d) => ({ kind: 'model' as const, d })), ...textures.map((d) => ({ kind: 'texture' as const, d }))];
  for (const x of all) {
    if (!x.d.source) continue;
    const key = x.d.source.pack ?? x.d.source.url;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  return [...groups].map(([what, xs]) => {
    const s = xs[0]!.d.source!;
    const terms = Object.hasOwn(LICENCES, s.licence) ? LICENCES[s.licence] : undefined;
    const ids = (kind: string) => xs.filter((x) => x.kind === kind).map((x) => x.d.id);
    return { what, author: s.author ?? 'unknown', licence: s.licence, name: terms?.name ?? s.licence, credit: terms?.credit ?? 'required', url: s.url, models: ids('model'), textures: ids('texture') };
  });
}

/** One entry as a Markdown list item: what, who, the licence and what it owes, the url, the ids. */
export function creditLine(e: CreditEntry): string {
  const owed = e.credit === 'required' ? ', credit required' : e.credit === 'optional' ? ', credit optional' : '';
  return `- **${e.what}** by ${e.author}, ${e.name} (${e.licence}${owed}): ${e.url}.${e.models.length ? ` Models: ${e.models.join(', ')}.` : ''}${e.textures.length ? ` Textures: ${e.textures.join(', ')}.` : ''}`;
}

/** The list as Markdown lines (credits.md). */
export function creditLines(entries: readonly CreditEntry[]): string[] {
  const lines = ['# Credits', '', "Imported models and textures and where they came from, from each one's `source` (`npm run model -- credits`).", ''];
  if (!entries.length) lines.push('Nothing imported yet: nothing to credit.');
  lines.push(...entries.map(creditLine));
  return lines;
}
