/**
 * Item tooltips: a pure layout (`tooltipLines`) and a painter (`drawTooltip`), shared by
 * the in-game windows and the `npm run loot -- tooltip` PNG renderer.
 *
 * Order: name (rarity colour) and base, base stats (locally modified values in blue) ·
 * requirements, implicit mods, explicit mods (Alt: affix tier and prefix/suffix) ·
 * corrupted, unique flavour, price, "compared to equipped" deltas (green/red). Every word is a
 * line (lang/items.ts) in the player's language; lines wrap at the width as drawn.
 */
import type { Item } from '../../core/types';
import { lang, t } from '../../lang';
import { type StatDelta } from '../../loot/compare';
import { CURRENCY, GEMS, UNIQUES } from '../../loot/content';
import { itemClass, itemColour } from '../../loot/filter';
import { baseOf, defenceStats, requiredLevel, weaponStats } from '../../loot/itemMods';
import { tagWord } from '../../lang/mods';
import { affixDef, affixName, baseName, className, currencyDescription, damageName, gemDescription, itemName, listText, uniqueFlavour } from '../../loot/names';
import { gemProgress } from '../../loot/sockets';
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
  /** A price line: what the vendor asks ('buy') or pays ('sell'). */
  price?: { kind: 'buy' | 'sell'; gold: number; affordable?: boolean };
  /** A hint line at the bottom (e.g. "Right-click: equip"), in the player's language. */
  hint?: string;
  /** Widest line in art pixels (default TIP_W; narrow screens pass less). Longer text wraps. */
  width?: number;
  /** Extra lines after the body (the skill panel adds a socketed gem's resolved numbers). */
  extra?: readonly { text: string; color: number }[];
}

/** Widest tooltip line in art pixels (36 letters of the pixel font). */
export const TIP_W = 216;

const fmt = (v: number, o?: Intl.NumberFormatOptions) => lang().formatNumber(v, o);
const pct = (v: number) => fmt(v, { style: 'percent', maximumFractionDigits: 1 });
/** 950, 9,500, 12.4K, 3.1M: compact from ten thousand, in the language's way. */
const shortNum = (v: number) => (v >= 1e4 ? fmt(v, { notation: 'compact', maximumFractionDigits: 1 }) : fmt(Math.round(v)));

export function tooltipLines(item: Item, opts: TooltipOptions = {}): TipLine[] {
  const base = baseOf(item);
  const colour = itemColour(item);
  const lines: TipLine[] = [];
  const add = (text: string, color: number, center = false) => {
    for (const line of wrap(text, opts.width ?? TIP_W)) lines.push({ text: line, color, center });
  };
  const sep = () => lines.push({ text: '', color: UI.panelEdge, sep: true });

  // --- header
  if (item.gem) {
    add(itemName(item), colour, true);
    add(t(item.gem.support ? 'item.tip.gem.support' : 'item.tip.gem.skill', { level: item.gem.level }), UI.dim, true);
  } else {
    const q = item.quantity ?? 1;
    add(q > 1 ? t('item.tip.stack', { name: itemName(item), count: q }) : itemName(item), colour, true);
    if ((item.rarity === 'rare' || item.rarity === 'unique') && itemClass(item) !== 'currency') add(baseName(base.id), colour, true);
  }
  sep();

  // --- currency / gem bodies
  const cls = itemClass(item);
  if (cls === 'currency') {
    const c = CURRENCY.get(item.base);
    add(t('item.tip.stack_size', { size: item.quantity ?? 1, max: c.stack }), UI.dim);
    add(currencyDescription(c.id), UI.text);
    add(t('item.tip.use_orb'), UI.dim);
    return finish(lines, opts, sep, add);
  }
  if (cls === 'gem' && item.gem) {
    const g = GEMS.has(item.gem.id) ? GEMS.get(item.gem.id) : null;
    if (g?.tags?.length) add(listText(g.tags.map((tag) => tagWord(tag))), UI.dim);
    const description = g ? gemDescription(g.id, g.support) : null;
    if (description) add(description, UI.text);
    add(t(item.gem.support ? 'item.tip.support_hint' : 'item.tip.skill_hint'), UI.dim);
    const need = requiredLevel(item);
    add(t('item.tip.requires_level', { level: need }), opts.heroLevel !== undefined && opts.heroLevel < need ? UI.bad : UI.dim);
    // gem XP: socketed gems earn the hero's XP and level up (loot/sockets.ts addGemXp)
    const prog = gemProgress(item, opts.heroLevel);
    if (prog?.max) add(t('item.tip.gem_max'), UI.dim);
    else if (prog) {
      add(t('item.tip.gem_xp', { xp: shortNum(prog.xp), next: shortNum(prog.next), percent: fmt(Math.floor(prog.fraction * 100) / 100, { style: 'percent' }) }), UI.text);
      if (prog.waiting) add(t('item.tip.gem_waits', { level: prog.nextReq ?? 0 }), UI.bad);
    }
    return finish(lines, opts, sep, add);
  }

  // --- base stats
  const w = weaponStats(item);
  const tag = (base.tags ?? []).find((x) => ['onehand', 'twohand'].includes(x));
  const kind = className(base.look ?? base.slot);
  add(tag ? t(tag === 'twohand' ? 'item.tip.two_handed' : 'item.tip.one_handed', { class: kind }) : kind, UI.dim);
  if (w) {
    for (const [type, r] of Object.entries(w.damage)) {
      const modded = type === 'physical' ? w.modified.physical : w.modified.elemental;
      add(t('item.tip.damage', { type: damageName(type), min: r[0], max: r[1] }), modded ? UI.explicit : UI.text);
    }
    add(t('item.tip.aps', { aps: fmt(w.aps, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }), w.modified.aps ? UI.explicit : UI.text);
    add(t('item.tip.crit', { chance: pct(w.crit) }), w.modified.crit ? UI.explicit : UI.text);
    add(t('item.tip.dps', { dps: w.dps }), UI.dim);
  }
  const d = defenceStats(item);
  if (d) {
    if (d.block) add(t('item.tip.block', { chance: pct(d.block) }), d.modified.block ? UI.explicit : UI.text);
    if (d.armour) add(t('item.tip.armour', { armour: d.armour }), d.modified.armour ? UI.explicit : UI.text);
    if (d.evasion) add(t('item.tip.evasion', { evasion: d.evasion }), d.modified.evasion ? UI.explicit : UI.text);
    if (d.es) add(t('item.tip.energy_shield', { es: d.es }), d.modified.es ? UI.explicit : UI.text);
  }
  const need = requiredLevel(item);
  add(t('item.tip.requires_level_item', { level: need, item_level: item.level }), opts.heroLevel !== undefined && opts.heroLevel < need ? UI.bad : UI.dim);

  // --- mods
  const implicit = [...base.implicit];
  if (implicit.length || item.implicits?.length) {
    sep();
    for (const line of describeItemMods(implicit)) add(line, UI.implicit);
    for (const a of item.implicits ?? []) for (const line of describeItemMods(a.mods)) add(line, UI.bad);
  }
  if (item.unique) {
    sep();
    for (const line of describeItemMods(UNIQUES.get(item.unique).mods)) add(line, UI.explicit);
  } else if (item.affixes.length) {
    sep();
    for (const a of item.affixes) {
      const def = affixDef(a.id);
      if (opts.showTiers && def) add(t(def.type === 'prefix' ? 'item.tip.prefix' : 'item.tip.suffix', { name: affixName(def.id), tier: def.tiers.length - a.tier }), UI.dim);
      for (const line of describeItemMods(a.mods)) add(line, UI.explicit);
    }
  }
  if (item.corrupted) add(t('item.tip.corrupted'), UI.bad, true);
  if (item.unique) {
    sep();
    add(uniqueFlavour(item.unique), UI.flavour, true);
  }
  return finish(lines, opts, sep, add);
}

function finish(lines: TipLine[], opts: TooltipOptions, sep: () => void, add: (text: string, c: number, center?: boolean) => void): TipLine[] {
  if (opts.extra?.length) {
    sep();
    for (const e of opts.extra) add(e.text, e.color);
  }
  if (opts.price) {
    sep();
    add(t(opts.price.kind === 'buy' ? 'item.tip.buy' : 'item.tip.sell', { count: opts.price.gold }), opts.price.affordable === false ? UI.bad : UI.gold, true);
  }
  if (opts.compare?.length) {
    sep();
    add(t('item.tip.compared'), UI.dim);
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
