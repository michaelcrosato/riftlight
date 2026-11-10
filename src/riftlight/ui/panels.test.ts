import { afterEach, describe, expect, it } from 'vitest';
import { strays as straysIn } from '../../../scripts/lang-strays.mjs';
import { Lang, textWidthPx } from '../../engine';
import { describeMod, flat, StatSheet } from '../core/mods';
import type { MechanicInfo, WorldLoot } from '../game/ports';
import type { Recap } from '../game/recap';
import { installLanguage, lang, riftlightLines, t } from '../lang';
import type { UiCanvas } from './kit';
import { CharacterSheet, Codex, DeathRecap, dialogue, LootWindow, SHEET_STATS, sourceLabel } from './panels';

// The panels' words are lines (docs/game/lang.md): drawn under the test language en-XA, every word
// they write themselves is bracketed; what they are handed (a monster's name, a mod, a mechanic)
// comes in the player's language from its own area.

const english = () => installLanguage(new Lang(riftlightLines()));
afterEach(english);

/** A canvas that keeps the text drawn on it (text, mini, buttons). */
function recorder(w = 480, h = 270): { ui: UiCanvas; drawn: string[] } {
  const drawn: string[] = [];
  const keep = (s: string) => (drawn.push(s), textWidthPx(s));
  const ui = {
    w,
    h,
    pad: false,
    pointer: { x: -1, y: -1, down: false, used: false },
    measure: (s: string, scale = 1) => textWidthPx(s, scale),
    hover: () => false,
    text: (_x: number, _y: number, s: string) => keep(s),
    mini: (_x: number, _y: number, s: string) => keep(s),
    button: (r: unknown, label: string) => (keep(label), r),
    prompt: (_x: number, _y: number, _a: string, label: string) => keep(label),
    glyphWidth: () => 7,
    rect: () => {},
    outline: () => {},
    bar: () => {},
    panel: () => {},
    sprite: () => {},
  };
  return { ui: ui as unknown as UiCanvas, drawn };
}

/** Text drawn that isn't a line under en-XA (scripts/lang-strays.mjs: the audit's test). */
function strays(drawn: readonly string[]): string[] {
  return drawn.filter((s) => straysIn(s, riftlightLines().names).length);
}

/** Text cut to fit (`clip` ends it with a `.` where under en-XA a line ends with `]`). */
const cut = (drawn: readonly string[]) => drawn.filter((s) => /[^\].0-9]\.$/.test(s) && s.startsWith('['));

const RECT = (w: number, h: number) => ({ x: 10, y: 10, w, h });

describe('the panels in any language', () => {
  it('the character sheet: a label line per stat, every source of a bonus named by a line', () => {
    const lines = riftlightLines().lines;
    for (const stat of SHEET_STATS) expect(lines[`panel.character.stat.${stat.replace(/\./g, '_')}`], stat).toBeTypeOf('string');
    expect(sourceLabel('tree')).toBe('Passive tree');
    expect(sourceLabel('item:ring2')).toBe('Ring 2');
    expect(sourceLabel('item:tail')).toBe('Gear');
    expect(sourceLabel('mechanic:mire:haste')).toBe('Rift mechanic');
    expect(sourceLabel('e2e')).toBe('Other');
  });

  it('under en-XA every word the panels write is a line (wide and on a phone)', () => {
    installLanguage(new Lang(riftlightLines(), {}, { code: 'en-XA' }));
    const outside = new Set<string>();
    const sheet = new StatSheet({ life: 120, mana: 40, 'move.speed': 4.2, 'crit.chance': 0.05 });
    const mod = flat('life', 25);
    sheet.set('item:helm', [mod]);
    sheet.set('mechanic:mire', [flat('life', 3)]);
    outside.add(describeMod(mod)).add(describeMod(flat('life', 3)));
    const mechanic: MechanicInfo = { id: 'mire', name: '[Míré]', description: '[Múd slóws.]', bypass: '[Wálk áróúñd.]', exploit: '[Dásh.]' } as MechanicInfo;
    const recap: Recap = {
      byType: { physical: 40, fire: 120, cold: 0, lightning: 3, chaos: 0 },
      total: 163,
      hits: 9,
      sources: [{ name: '[Çíñdér Hóúñd]', total: 140, hits: 6 }],
      killer: '[Çíñdér Hóúñd]',
      killingBlow: { total: 52, type: 'fire', crit: true },
      tip: '[Fíré húrt móst.]',
    };
    const loot = [{ label: '[Íróñ Swórd]', color: 'white' }] as unknown as WorldLoot[];
    for (const [w, h] of [
      [480, 270],
      [124, 260],
    ] as const) {
      const { ui, drawn } = recorder(w, h);
      const fit = <P extends { fit(w: number, h: number): void; size: { w: number; h: number } }>(p: P) => (p.fit(w - 8, h - 30), RECT(p.size.w, p.size.h));
      const character = new CharacterSheet(() => sheet, () => '[Lévél 3]');
      for (let i = 0; i < SHEET_STATS.length; i++) {
        character.draw(ui, fit(character));
        character.input({ kind: 'nav', dir: 'down' });
      }
      const codex = new Codex(() => [mechanic, { ...mechanic, id: 'gale' }], () => ['mire']);
      codex.draw(ui, fit(codex));
      codex.input({ kind: 'nav', dir: 'down' });
      codex.draw(ui, fit(codex));
      if (codex.narrow) {
        codex.input({ kind: 'confirm' });
        codex.draw(ui, fit(codex));
      }
      for (const r of [recap, { ...recap, killer: null, killingBlow: null, sources: [] }]) {
        const death = new DeathRecap(r, { xp: 1200, gold: 45 } as never, '[Déptħ 3]', () => {});
        death.draw(ui, fit(death), 0);
      }
      for (const items of [loot, Array.from({ length: 9 }, () => loot[0]!), []]) {
        const window = new LootWindow(() => items, () => ['[Çléáréd] · [12 kíllś]'], () => true, () => {});
        window.draw(ui, fit(window));
      }
      dialogue(ui, 'town.npc.brann.talk.1', RECT(200, 100));
      const titles = [character, codex, new DeathRecap(recap, { xp: 0, gold: 0 } as never, '', () => {}), new LootWindow(() => [], () => [], () => true, () => {})].map((p) => p.title);
      expect(strays([...drawn, ...titles].filter((s) => !outside.has(s))), `${w}x${h}`).toEqual([]);
      // the wide panels make room for a longer language; a phone's sheet shortens its labels (the last resort)
      if (w > 300) expect(cut(drawn), 'cut to fit').toEqual([]);
      expect(drawn.length).toBeGreaterThan(40);
    }
  });

  it('numbers in the panels are the language’s; a count picks its plural form', () => {
    expect(t('panel.loot.more', { count: 1 })).toBe('+1 more');
    expect(t('panel.death.lost', { xp: 12500, gold: 3 })).toBe('Lost 12,500 XP and 3 gold');
    installLanguage(new Lang(riftlightLines(), { de: { by: 'test', lines: { 'panel.death.lost': '{xp} EP und {gold} Gold verloren' } } }, { code: 'de' }));
    expect(t('panel.death.lost', { xp: 12500, gold: 3 })).toBe('12.500 EP und 3 Gold verloren');
    const { ui, drawn } = recorder();
    const sheet = new CharacterSheet(() => new StatSheet({ 'move.speed': 4.25, 'crit.chance': 0.12 }), () => '');
    sheet.draw(ui, RECT(330, 176));
    expect(drawn).toContain(`${lang().formatNumber(4.3, { minimumFractionDigits: 1 })} m/s`);
    expect(drawn).toContain('12\u00a0%'); // German puts a no-break space before %
  });
});
