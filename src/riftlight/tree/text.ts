/**
 * The passive tree's words in the player's language (docs/game/lang.md): a node's name, flavour,
 * kind and tooltip lines, a small node's title made from its mods, a region's name. The lines are
 * in lang/tree.ts (and lang/mods.ts for mods); a node keeps its English in `name` and `flavour`
 * (tools, logs) and where its lines are in `text`. Tree data never imports this: the language
 * sits above the data it names.
 */
import type { Lang } from '../../engine/lang/lang';
import type { Mod } from '../core/mods';
import { canonicalStat } from '../core/stats';
import { lineKey } from '../lang/area';
import { lang, sourceLang } from '../lang/index';
import { modList, modText } from '../lang/mods';
import type { NodeLine, TreeNode } from './types';

type In = Pick<Lang, 't' | 'has'>;

export { sourceLang }; // the game's own language (English): generated data keeps it

/** A tree mod in the player's language: the game's one mod describer (lang/mods.ts). */
export function describeTreeMod(m: Mod, l: In = lang()): string {
  return modText(m, l);
}

const title = (s: string) => s.replace(/(^|\s)\w/g, (c) => c.toUpperCase());

/** A small node's title from its mods: "Melee Damage", "Life and Armour". */
export function smallName(mods: readonly Mod[], l: In = lang()): string {
  const one = (m: Mod) => {
    const stat = canonicalStat(m.stat);
    let name = l.has(lineKey('tree.small.stat', stat)) ? l.t(lineKey('tree.small.stat', stat)) : title(stat.replace(/\./g, ' '));
    for (const tag of [...(m.tags ?? [])].reverse()) name = l.t('tree.small.scoped', { scope: l.has(lineKey('tree.small.tag', tag)) ? l.t(lineKey('tree.small.tag', tag)) : title(tag), stat: name });
    if (m.when) name = l.t('tree.small.condition', { name, condition: l.has(lineKey('tree.small.when', m.when)) ? l.t(lineKey('tree.small.when', m.when)) : title(m.when) });
    return name;
  };
  const names = [...new Set(mods.map(one))];
  return names.length ? names.reduce((first, second) => l.t('tree.small.and', { first, second })) : '';
}

/** A region's name ("Might"), or the heart's for the centre. */
export function regionName(id: string, l: In = lang()): string {
  const line = lineKey('tree.region', id, 'name');
  return l.has(line) ? l.t(line) : l.t('tree.region.heart');
}

/** A kind of node ("Notable", "Keystone"). */
export function kindName(kind: TreeNode['kind'], l: In = lang()): string {
  return l.t(lineKey('tree.kind', kind));
}

/** A node's line `<text>.<part>` when the game has it. */
function own(n: TreeNode, part: string, l: In): string | null {
  return n.text && l.has(`${n.text}.${part}`) ? l.t(`${n.text}.${part}`) : null;
}

/** A node's name in the player's language. */
export function nodeName(n: TreeNode, l: In = lang()): string {
  if (n.kind === 'small') return smallName(n.mods, l);
  if (n.kind === 'start' && n.text && l.has(`${n.text}.name`)) return l.t('tree.start.name', { region: l.t(`${n.text}.name`) });
  return own(n, 'name', l) ?? n.name;
}

/** A node's flavour in the player's language (masteries: what to do with one), or null. */
export function nodeFlavour(n: TreeNode, l: In = lang()): string | null {
  if (n.kind === 'mastery') return l.t('tree.mastery.flavour');
  if (!n.flavour) return null;
  return own(n, 'flavour', l) ?? n.flavour;
}

/** One hand-written tooltip line (the `i`th of the node's `lines`). */
export function ruleLine(n: TreeNode, line: NodeLine, i: number, l: In = lang()): string {
  if (typeof line === 'object' && 'stat' in line) return modText(line, l);
  const id = `${n.text}.line.${i + 1}`;
  if (n.text && l.has(id)) return l.t(id, typeof line === 'string' ? undefined : line.values);
  if (typeof line === 'string') return line;
  const text = typeof line.text === 'string' ? line.text : (line.text.other ?? Object.values(line.text)[0] ?? '');
  return text.replace(/\{(\w+)\}/g, (tag, k: string) => (k in line.values ? String(line.values[k]) : tag));
}

/** Tooltip lines for a node: hand-written lines, else its described mods (masteries: every option, the chosen one marked). */
export function nodeLines(n: TreeNode, choice?: string, l: In = lang()): string[] {
  if (n.lines?.length) return n.lines.map((line, i) => ruleLine(n, line, i, l));
  if (n.options?.length) return n.options.map((o) => `${o.id === choice ? '> ' : '  '}${modList(o.mods.map((m) => modText(m, l)), l)}`);
  return n.mods.map((m) => modText(m, l));
}
