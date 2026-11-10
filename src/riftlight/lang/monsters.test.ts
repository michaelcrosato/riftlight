// Monsters' words are lines: every registry entry has its own, a monster's and a rift boss's name
// are built through joining lines (a translation may reorder them), and English reads as before.
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import { Rng } from '../core/rng';
import type { Genome } from '../core/types';
import { ARCHETYPES, BOSS_ATTACKS, bossName, ELITE_MODS, EPITHETS, generateBoss, generateGenome, genomeTags, MONSTER_SKILLS, PARTS, PLAN_WORD, PLANS, THEME_WORD } from '../monsters';
import { DESIGNED_BOSSES } from '../monsters/bosses/designed';
import { monsterName } from '../wire/monsters';
import { installLanguage, lineKey, riftlightLines } from './index';
import { archetypeName, bossNameShown, bossPhaseName, eliteName, MONSTERS, partName, planName } from './monsters';

/** Show the game in a made-up French with these lines (the rest falls back to English). */
const french = (lines: Record<string, string>) => installLanguage(new Lang(riftlightLines(), { fr: { by: 'test', lines } }, { code: 'fr' }));

afterEach(() => {
  installLanguage(new Lang(riftlightLines()));
});

describe('monster lines', () => {
  const lines = MONSTERS().lines;
  const count = (prefix: string) => Object.keys(lines).filter((id) => id.startsWith(prefix)).length;

  it('one line per registry entry, none lost to an id that slugs like another', () => {
    expect(count('monster.part.')).toBe(PARTS.all().length);
    expect(count('monster.plan.')).toBe(PLANS.all().length);
    expect(count('monster.archetype.')).toBe(ARCHETYPES.all().length * 2);
    expect(count('monster.elite.')).toBe(ELITE_MODS.all().length * 2);
    expect(count('monster.skill.')).toBe(MONSTER_SKILLS.all().filter((s) => s.description !== s.name).length + MONSTER_SKILLS.all().length);
    expect(count('monster.attack.')).toBe(BOSS_ATTACKS.all().length * 2);
    expect(count('monster.boss.epithet.')).toBe(new Set(Object.values(EPITHETS).flat()).size);
    for (const b of DESIGNED_BOSSES) expect(lines[lineKey('monster.boss', b.id, 'name')]).toBe(b.name);
    expect(count('monster.word.theme.')).toBe(Object.keys(THEME_WORD).length);
    expect(count('monster.word.body.')).toBe(Object.keys(PLAN_WORD).length);
  });

  it('the helpers show each registry entry in the player’s language', () => {
    expect([partName('head.snout'), planName('quadruped'), archetypeName('charger'), eliteName('fire-enchanted'), bossPhaseName('Wrath')]).toEqual(['Beast Snout', 'Quadruped', 'Charger', 'Fire Enchanted', 'Wrath']);
    french({ 'monster.part.head_snout': 'Museau de bête', 'monster.archetype.charger.name': 'Chargeur', 'monster.boss.phase.wrath': 'Colère' });
    expect([partName('head.snout'), archetypeName('charger'), bossPhaseName('Wrath')]).toEqual(['Museau de bête', 'Chargeur', 'Colère']);
    expect(partName('no.such.part')).toBe('no.such.part');
  });
});

describe('monster names', () => {
  /** The name as it was written before it was a line: elite modifier, theme word, body word. */
  const before = (g: Genome) => {
    const elite = g.elite[0] && ELITE_MODS.has(g.elite[0]) ? `${ELITE_MODS.get(g.elite[0]).name} ` : '';
    return `${g.rank === 'normal' ? '' : elite}${THEME_WORD[genomeTags(g)[0] ?? ''] ?? 'Rift'} ${PLAN_WORD[g.plan] ?? 'Beast'}`;
  };

  it('in English: theme word and body word, a magic or rare monster’s first elite modifier in front', () => {
    const hound = generateGenome(new Rng(7), { depth: 5, tags: ['fire'], plan: 'quadruped', rank: 'magic', elite: ['hasted'], parts: { head: 'head.snout' } });
    expect(monsterName(hound)).toMatch(/^Hasted \w+ Hound$/);
    expect(monsterName({ ...hound, rank: 'normal' })).toMatch(/^\w+ Hound$/);
    expect(monsterName({ ...hound, parts: [], plan: 'nothing' })).toBe('Hasted Rift Beast');
    for (let s = 1; s <= 60; s++) {
      const g = generateGenome(new Rng(s), { depth: 1 + (s % 30), rank: s % 3 ? 'rare' : 'normal' });
      expect(monsterName(g)).toBe(before(g));
    }
  });

  it('a translation reorders the words through the joining line', () => {
    const g = generateGenome(new Rng(3), { depth: 5, plan: 'quadruped', rank: 'magic', elite: ['hasted'], parts: { head: 'head.snout' } });
    french({ 'monster.name.elite': '{body} {theme} {elite}', 'monster.word.body.quadruped': 'Molosse', 'monster.elite.hasted.name': 'véloce' });
    const [body, theme, elite] = monsterName(g).split(' ');
    expect([body, elite]).toEqual(['Molosse', 'véloce']);
    expect(theme).toMatch(/^[A-Z]\w+$/);
  });

  it('a boss: a designed one by its line, a rift one by its invented name and translated epithet', () => {
    const vorgath = DESIGNED_BOSSES[0]!;
    expect(bossNameShown(vorgath)).toBe('Vorgath, the Emberhide');
    for (let s = 1; s <= 30; s++) {
      const rift = generateBoss(new Rng(s), 20 + s, ['embers', 'gloom']);
      expect(bossNameShown(rift)).toBe(rift.name); // English: as it always read
      expect(bossNameShown(rift.name)).toBe(rift.name);
    }
    french({ 'monster.boss.vorgath.name': 'Vorgath, l’Écorce-de-braise', 'monster.boss.name': '{epithet} {name}', 'monster.boss.epithet.ashmaw': 'Gueule-de-cendre' });
    expect(bossNameShown(vorgath)).toBe('Vorgath, l’Écorce-de-braise');
    expect(bossNameShown('Vorgath, the Emberhide')).toBe('Vorgath, l’Écorce-de-braise'); // a saved English name shows in today's language
    let rng = 1;
    let name = '';
    while (!name.endsWith('Ashmaw')) name = bossName(new Rng(rng++), ['fire']);
    expect(bossNameShown(name)).toBe(`Gueule-de-cendre ${name.split(',')[0]}`);
    expect(bossNameShown('Somebody Else')).toBe('Somebody Else');
  });
});
