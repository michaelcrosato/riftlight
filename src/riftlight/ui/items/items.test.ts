import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import { flat } from '../../core/mods';
import type { Item } from '../../core/types';
import { currencyItem, makeUnique, rollGem, rollItem } from '../../loot/generate';
import { RARITY_COLOURS } from '../../loot/filter';
import type { Painter } from './paint';
import { wrap } from './paint';
import { drawTooltip, measureTooltip, TIP_CHARS, tooltipLines } from './tooltip';

const texts = (item: Item, opts = {}) => tooltipLines(item, opts).map((l) => l.text);

describe('tooltips', () => {
  it('lead with the name in the rarity colour, then base stats and mods', () => {
    const it = rollItem(new Rng(3), { base: 'arming-sword', itemLevel: 40, rarity: 'rare' });
    const lines = tooltipLines(it);
    expect(lines[0]!.text).toBe(it.name);
    expect(lines[0]!.color).toBe(RARITY_COLOURS.rare);
    const t = lines.map((l) => l.text).join('\n');
    expect(t).toContain('Arming Sword');
    expect(t).toMatch(/physical damage: \d+-\d+/);
    expect(t).toMatch(/Attacks per second/);
    expect(t).toMatch(/critical strike multiplier/); // the sword implicit
    expect(lines.every((l) => l.text.length <= TIP_CHARS)).toBe(true);
  });

  it('show affix tiers with Alt, flavour for uniques, comparisons in green and red', () => {
    const it = rollItem(new Rng(4), { base: 'plate-vest', itemLevel: 60, rarity: 'rare' });
    expect(texts(it).some((t) => /^(Prefix|Suffix) /.test(t))).toBe(false);
    expect(texts(it, { showTiers: true }).filter((t) => /^(Prefix|Suffix) '.+' T\d$/.test(t)).length).toBe(it.affixes.length);
    const u = makeUnique(new Rng(1), 'emberheart');
    expect(texts(u).join(' ')).toContain('The braziers of Embers');
    const cmp = tooltipLines(it, {
      compare: [
        { stat: 'life', before: 1, after: 2, delta: 1, better: true, text: '+1 maximum life' },
        { stat: 'armour', before: 2, after: 1, delta: -1, better: false, text: '-1 armour' },
      ],
    });
    const life = cmp.find((l) => l.text === '+1 maximum life')!;
    const armour = cmp.find((l) => l.text === '-1 armour')!;
    expect(life.color).not.toBe(armour.color);
  });

  it('describe currency, gems and corrupted implicits', () => {
    expect(texts(currencyItem(new Rng(1), 'kindling-shard', 3)).join(' ')).toMatch(/normal item to a magic item/);
    expect(texts(rollGem(new Rng(1), 30, false)).join(' ')).toMatch(/Skill gem, level \d+/);
    const it: Item = { ...rollItem(new Rng(2), { base: 'iron-hat', itemLevel: 10, rarity: 'normal' }), corrupted: true, implicits: [{ id: 'corrupt-life', tier: 0, mods: [{ stat: 'life', kind: 'inc', value: 0.06 }] }] };
    expect(texts(it)).toContain('Corrupted');
    expect(texts(it)).toContain('6% increased maximum life');
    expect(texts({ ...it, affixes: [{ id: 'life', tier: 0, mods: [flat('life', 12)] }] })).toContain('+12 maximum life');
  });

  it('paint inside their measured box', () => {
    const lines = tooltipLines(makeUnique(new Rng(1), 'galecaller'));
    const size = measureTooltip(lines);
    let maxX = 0;
    let maxY = 0;
    const p: Painter = {
      rect: (x, y, w, h) => {
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      },
      text: (x, y, s) => {
        maxX = Math.max(maxX, x + s.length * 6 - 1);
        maxY = Math.max(maxY, y + 7);
        return s.length * 6;
      },
    };
    expect(drawTooltip(p, 10, 20, lines)).toEqual(size);
    expect(maxX).toBeLessThanOrEqual(10 + size.w);
    expect(maxY).toBeLessThanOrEqual(20 + size.h);
  });

  it('wraps words to the line width', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});
