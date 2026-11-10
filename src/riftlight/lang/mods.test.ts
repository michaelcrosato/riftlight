// Every bonus reads from lines (lang/mods.ts): the shapes fill as English always read, and every
// stat, tag and condition the game's content carries has its line, so no mod shows a raw id.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Lang } from '../../engine/lang/lang';
import { flag, flat, inc, more, override, type Mod } from '../core/mods';
import { canonicalStat } from '../core/stats';
import { lineKey } from './area';
import { riftlightLines } from './index';
import { hasStatName, modText } from './mods';

describe('modText', () => {
  it('fills the sentence shapes', () => {
    expect(modText(inc('damage', 0.2, ['melee']))).toBe('20% increased damage with melee skills');
    expect(modText(inc('mana.cost', -0.08))).toBe('8% reduced mana cost of skills');
    expect(modText(more('attack.speed', -0.1))).toBe('10% less attack speed');
    expect(modText(more('damage', 0.3, ['spell'], 'lowLife'))).toBe('30% more damage with spells while on low life');
    expect(modText(flat('life', 25))).toBe('+25 maximum life');
    expect(modText(flat('life', -5))).toBe('-5 maximum life');
    expect(modText(flat('res.fire', 0.3))).toBe('+30% fire resistance');
    expect(modText(flat('chance.bleed', -0.125))).toBe('-12.5% chance to cause bleeding');
    expect(modText(flat('crit.multi', 0.25, ['twohand', 'melee']))).toBe('+25% critical strike multiplier with two-handed weapons and melee skills');
    expect(modText(override('life', 1))).toBe('maximum life is 1');
    expect(modText(override('crit.chance', 0))).toBe('critical strike chance is 0%');
    expect(modText(flag('cannotCrit'))).toBe('never deal critical strikes');
    expect(modText(flat('skill.level', 1, ['fire']))).toBe('+1 to level of fire skill gems');
    expect(modText(flat('skill.level', 2))).toBe('+2 to level of all skill gems');
    expect(modText(flat('life.regen', 2.5))).toBe('+2.5 life regenerated per second');
  });

  it('numbers follow the language, words the translation', () => {
    const fr = new Lang(riftlightLines(), { fr: { by: 'test', lines: { 'mod.inc': '{value} % de {stat} en plus', 'stat.fire_damage': 'dégâts de feu' } } }, { code: 'fr' });
    expect(modText(inc('fire.damage', 0.125), fr)).toBe('12,5 % de dégâts de feu en plus');
  });
});

/** Every `.ts` file of the game (not tests). */
function sources(): { file: string; text: string }[] {
  const root = new URL('../', import.meta.url).pathname;
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((file) => ({ file, text: readFileSync(root + file, 'utf8') }));
}

/** Every mod (and mod roll, affix tier) reachable from these modules' exports. */
function modsIn(...modules: unknown[]): Mod[] {
  const out: Mod[] = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || depth > 10 || seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (typeof o.stat === 'string' && typeof o.kind === 'string') out.push(o as unknown as Mod);
    if (v instanceof Map) for (const x of v.values()) walk(x, depth + 1);
    const all = (o as { all?: unknown }).all;
    if (typeof all === 'function') walk((all as () => unknown).call(o), depth + 1);
    for (const x of Array.isArray(v) ? v : Object.values(o)) walk(x, depth + 1);
  };
  for (const m of modules) walk(m, 0);
  return out;
}

describe('the game names every stat, tag and condition its mods carry', () => {
  it('stats: every stat written in a mod (flat/inc/more/override/flag, `stat:`, tree rolls) has a line', () => {
    const missing = new Set<string>();
    for (const { file, text } of sources()) {
      if (file.startsWith('lang/') || file.startsWith('balance/')) continue; // balance writes probe stats for tools
      for (const m of text.matchAll(/(?<![\w.])(?:flat|inc|more|override|flag|R)\(\s*'([a-zA-Z][\w.]*)'/g)) if (!hasStatName(m[1]!) && !m[1]!.startsWith('local.')) missing.add(`${file}: ${m[1]}`);
      for (const m of text.matchAll(/\bstat: '([a-zA-Z][\w.]*)'/g)) if (!hasStatName(m[1]!) && !m[1]!.startsWith('local.')) missing.add(`${file}: ${m[1]}`);
    }
    expect([...missing]).toEqual([]);
  });

  it('tags and conditions: every scope and condition in the content has a line', async () => {
    const mods = modsIn(await import('../loot/content'), await import('../tree'), await import('../skills'), await import('../combat/charges'), await import('../monsters'));
    expect(mods.length).toBeGreaterThan(500);
    const lines = riftlightLines().lines;
    const missing = new Set<string>();
    for (const m of mods) {
      if (canonicalStat(m.stat) !== 'skill.level') for (const tag of m.tags ?? []) if (!lines[lineKey('mod.scope', tag)]) missing.add(`scope ${tag}`);
      if (canonicalStat(m.stat) === 'skill.level') for (const tag of m.tags ?? []) if (!lines[lineKey('tag', tag)]) missing.add(`tag ${tag}`);
      if (m.when && !lines[lineKey('when', m.when)]) missing.add(`when ${m.when}`);
      if (!hasStatName(m.stat.replace(/^local\./, '')) && !/^local\.(added|physical|block)/.test(m.stat)) missing.add(`stat ${m.stat}`);
    }
    expect([...missing]).toEqual([]);
  });
});
