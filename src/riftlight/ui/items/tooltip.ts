/**
 * Item tooltips: a pure layout (`tooltipLines`) and a painter (`drawTooltip`), shared by
 * the in-game windows and the `npm run loot -- tooltip` PNG renderer.
 *
 * Order: name (rarity colour) and base, base stats (locally modified values in blue) ·
 * requirements, implicit mods, explicit mods (Alt: affix tier and prefix/suffix) ·
 * corrupted, unique flavour, price, "compared to equipped" deltas (green/red).
 */
import type { Item } from '../../core/types';
import { type StatDelta } from '../../loot/compare';
import { AFFIXES, CORRUPTIONS, CURRENCY, GEMS, UNIQUES } from '../../loot/content';
import { itemClass, itemColour } from '../../loot/filter';
import { baseOf, defenceStats, requiredLevel, weaponStats } from '../../loot/itemMods';
import { describeItemMods } from '../../loot/stats';
import { LINE_H, type Painter, panel, textWidth, UI, wrap } from './paint';

export interface TipLine {
  readonly text: string;
  readonly color: number;
  /** A separator rule instead of text. */
  readonly sep?: boolean;
  readonly center?: boolean;
}

export interface TooltipOptions {
  /** Alt held: show affix tiers. */
  showTiers?: boolean;
  /** Deltas from `compareEquip` ("compared to equipped"). */
  compare?: readonly StatDelta[];
  /** Hero level: requirements above it show red. */
  heroLevel?: number;
  /** A price line, e.g. { label: 'buy', gold: 120 }. */
  price?: { label: string; gold: number; affordable?: boolean };
  /** A hint line at the bottom (e.g. "right-click to equip"). */
  hint?: string;
  /** Characters per line (default TIP_CHARS; narrow screens pass less). */
  chars?: number;
  /** Extra lines after the body (the skill panel adds a socketed gem's resolved numbers). */
  extra?: readonly { text: string; color: number }[];
}

/** Characters per tooltip line (6 px each). */
export const TIP_CHARS = 36;

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const range = (r: readonly [number, number]) => `${r[0]}-${r[1]}`;

export function tooltipLines(item: Item, opts: TooltipOptions = {}): TipLine[] {
  const base = baseOf(item);
  const colour = itemColour(item);
  const lines: TipLine[] = [];
  const add = (text: string, color: number, center = false) => {
    for (const t of wrap(text, opts.chars ?? TIP_CHARS)) lines.push({ text: t, color, center });
  };
  const sep = () => lines.push({ text: '', color: UI.panelEdge, sep: true });

  // --- header
  if (item.gem) {
    add(item.name, colour, true);
    add(`${item.gem.support ? 'Support' : 'Skill'} gem, level ${item.gem.level}`, UI.dim, true);
  } else {
    const qty = item.quantity && item.quantity > 1 ? ` x${item.quantity}` : '';
    add(`${item.name}${qty}`, colour, true);
    if ((item.rarity === 'rare' || item.rarity === 'unique') && itemClass(item) !== 'currency') add(base.name, colour, true);
  }
  sep();

  // --- currency / gem bodies
  const cls = itemClass(item);
  if (cls === 'currency') {
    const c = CURRENCY.get(item.base);
    add(`Stack size ${item.quantity ?? 1}/${c.stack}`, UI.dim);
    add(c.description, UI.text);
    add('Right-click, then click an item to use', UI.dim);
    return finish(lines, opts, sep, add);
  }
  if (cls === 'gem' && item.gem) {
    const g = GEMS.has(item.gem.id) ? GEMS.get(item.gem.id) : null;
    if (g?.tags?.length) add(g.tags.join(', '), UI.dim);
    if (g?.description) add(g.description, UI.text);
    add(item.gem.support ? 'Link it to a skill with matching tags' : 'Socket it in a skill slot to use it', UI.dim);
    const need = requiredLevel(item);
    add(`Requires level ${need}`, opts.heroLevel !== undefined && opts.heroLevel < need ? UI.bad : UI.dim);
    return finish(lines, opts, sep, add);
  }

  // --- base stats
  const w = weaponStats(item);
  const tag = (base.tags ?? []).find((t) => ['onehand', 'twohand'].includes(t));
  add(`${base.look ?? base.slot}${tag ? `, ${tag === 'twohand' ? 'two-handed' : 'one-handed'}` : ''}`, UI.dim);
  if (w) {
    for (const [type, r] of Object.entries(w.damage)) {
      const modded = type === 'physical' ? w.modified.physical : w.modified.elemental;
      add(`${type} damage: ${range(r)}`, modded ? UI.explicit : UI.text);
    }
    add(`Attacks per second: ${w.aps.toFixed(2)}`, w.modified.aps ? UI.explicit : UI.text);
    add(`Critical chance: ${pct(w.crit)}`, w.modified.crit ? UI.explicit : UI.text);
    add(`DPS: ${w.dps}`, UI.dim);
  }
  const d = defenceStats(item);
  if (d) {
    if (d.block) add(`Chance to block: ${pct(d.block)}`, d.modified.block ? UI.explicit : UI.text);
    if (d.armour) add(`Armour: ${d.armour}`, d.modified.armour ? UI.explicit : UI.text);
    if (d.evasion) add(`Evasion: ${d.evasion}`, d.modified.evasion ? UI.explicit : UI.text);
    if (d.es) add(`Energy shield: ${d.es}`, d.modified.es ? UI.explicit : UI.text);
  }
  const need = requiredLevel(item);
  add(`Requires level ${need}, item level ${item.level}`, opts.heroLevel !== undefined && opts.heroLevel < need ? UI.bad : UI.dim);

  // --- mods
  const implicit = [...base.implicit];
  if (implicit.length || item.implicits?.length) {
    sep();
    for (const t of describeItemMods(implicit)) add(t, UI.implicit);
    for (const a of item.implicits ?? []) for (const t of describeItemMods(a.mods)) add(t, UI.bad);
  }
  if (item.unique) {
    sep();
    for (const t of describeItemMods(UNIQUES.get(item.unique).mods)) add(t, UI.explicit);
  } else if (item.affixes.length) {
    sep();
    for (const a of item.affixes) {
      const def = AFFIXES.has(a.id) ? AFFIXES.get(a.id) : CORRUPTIONS.get(a.id);
      if (opts.showTiers) add(`${def.type === 'prefix' ? 'Prefix' : 'Suffix'} '${def.name}' T${def.tiers.length - a.tier}`, UI.dim);
      for (const t of describeItemMods(a.mods)) add(t, UI.explicit);
    }
  }
  if (item.corrupted) add('Corrupted', UI.bad, true);
  if (item.unique) {
    sep();
    add(UNIQUES.get(item.unique).flavour, UI.flavour, true);
  }
  return finish(lines, opts, sep, add);
}

function finish(lines: TipLine[], opts: TooltipOptions, sep: () => void, add: (t: string, c: number, center?: boolean) => void): TipLine[] {
  if (opts.extra?.length) {
    sep();
    for (const e of opts.extra) add(e.text, e.color);
  }
  if (opts.price) {
    sep();
    add(`${opts.price.label}: ${opts.price.gold} gold`, opts.price.affordable === false ? UI.bad : UI.gold, true);
  }
  if (opts.compare?.length) {
    sep();
    add('Compared to equipped:', UI.dim);
    for (const d of opts.compare.slice(0, 12)) add(d.text, d.better ? UI.better : UI.worse);
  }
  if (opts.hint) add(opts.hint, UI.dim, true);
  return lines;
}

export function measureTooltip(lines: readonly TipLine[]): { w: number; h: number } {
  const w = Math.max(60, ...lines.map((l) => textWidth(l.text))) + 10;
  const h = lines.reduce((s, l) => s + (l.sep ? 5 : LINE_H), 0) + 7;
  return { w, h };
}

/** Paint a tooltip with its top-left at (x, y); returns its size. */
export function drawTooltip(p: Painter, x: number, y: number, lines: readonly TipLine[], edge?: number): { w: number; h: number } {
  const size = measureTooltip(lines);
  panel(p, x, y, size.w, size.h, edge ?? lines[0]?.color ?? UI.panelEdge);
  let cy = y + 4;
  for (const l of lines) {
    if (l.sep) {
      p.rect(x + 4, cy + 2, size.w - 8, 1, UI.panelEdge);
      cy += 5;
      continue;
    }
    const tx = l.center ? x + Math.floor((size.w - textWidth(l.text)) / 2) : x + 5;
    p.text(tx, cy, l.text, l.color);
    cy += LINE_H;
  }
  return size;
}
