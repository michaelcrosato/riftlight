/**
 * The lines of monsters: parts, archetypes, elite modifiers, skills, bosses and their names (monsters/, wire/monsters.ts). docs/game/lang.md has the rules for a line.
 *
 * Built from the registries (their English is the line), so a part, an elite modifier or a boss
 * added as data brings its lines along. The helpers below show them: `partName`, `planName`,
 * `archetypeName`, `eliteName`, `bossNameShown`... (`monsterName` is wire/monsters.ts's).
 */
import type { BossDef } from '../monsters/bosses';
import { BOSS_ATTACKS } from '../monsters/bosses/attacks';
import { DESIGNED_BOSSES } from '../monsters/bosses/designed';
import { BOSS_PHASES, bossNameParts, EPITHETS } from '../monsters/bosses/names';
import { ARCHETYPES } from '../monsters/brains/archetypes';
import { ELITE_MODS } from '../monsters/brains/elite';
import { MONSTER_SKILLS } from '../monsters/brains/skills';
import { PLAN_WORD, THEME_WORD } from '../monsters/names';
import { PARTS } from '../monsters/parts';
import { PLANS } from '../monsters/plans';
import { type LineArea, lineKey } from './area';
import { lang, t } from './index';
import type { Lang } from '../../engine/lang/lang';

/** Every monster line (a function: the registries are read when the list is made). */
export function MONSTERS(): LineArea {
  const lines: Record<string, string> = {};
  const notes: Record<string, string> = {};
  const add = (id: string, line: string, note?: string) => {
    lines[id] = line;
    if (note) notes[id] = note;
  };

  // a monster's name: words and the joining lines
  add('monster.name.normal', '{theme} {body}', 'A monster’s name ("Cinder Hound"): {theme} a word for its element or kind (monster.word.theme), {body} a word for its body (monster.word.body). Shown on the death screen ("Slain by …") and in the bestiary.');
  add('monster.name.elite', '{elite} {theme} {body}', 'An elite monster’s name ("Hasted Cinder Hound"): {elite} its first elite modifier (monster.elite.*.name), then as monster.name.normal.');
  for (const [id, word] of Object.entries(THEME_WORD)) add(lineKey('monster.word.theme', id), word, `The word for a ${id === 'none' ? 'monster of no particular kind (a rift monster)' : `${id} monster`}, before its body word in its name (monster.name.normal).`);
  for (const [id, word] of Object.entries(PLAN_WORD)) add(lineKey('monster.word.body', id), word, `The word for a monster ${id === 'none' ? 'of no particular shape' : `with a ${id} body`}, the last word of its name (monster.name.normal).`);

  // bodies, parts, behaviours, modifiers, skills
  for (const p of PLANS.all()) add(lineKey('monster.plan', p.id, 'name'), p.name, 'A monster body shape, on the bestiary card.');
  for (const p of PARTS.all()) add(lineKey('monster.part', p.id), p.name, 'A monster body part, listed on the bestiary card.');
  for (const a of ARCHETYPES.all()) {
    add(lineKey('monster.archetype', a.id, 'name'), a.name, 'How a monster fights (its behaviour), on the bestiary card.');
    add(lineKey('monster.archetype', a.id, 'desc'), a.description, `What a ${a.name} monster does in a fight; "you" is the player's hero.`);
  }
  for (const e of ELITE_MODS.all()) {
    add(lineKey('monster.elite', e.id, 'name'), e.name, 'An elite monster’s modifier; also the first word of an elite monster’s name (monster.name.elite: "Hasted Cinder Hound"), so an adjective-like form reads best.');
    add(lineKey('monster.elite', e.id, 'desc'), e.description, `What the ${e.name} modifier does; "you" is the player's hero.`);
  }
  for (const s of MONSTER_SKILLS.all()) {
    add(lineKey('monster.skill', s.id, 'name'), s.name, 'A monster’s attack or spell.');
    if (s.description !== s.name) add(lineKey('monster.skill', s.id, 'desc'), s.description);
  }

  // bosses
  for (const a of BOSS_ATTACKS.all()) {
    add(lineKey('monster.attack', a.id, 'name'), a.name, 'A boss’s signature attack.');
    add(lineKey('monster.attack', a.id, 'desc'), a.description, `What the boss attack ${a.name} does; "you" is the player's hero.`);
  }
  for (const b of DESIGNED_BOSSES) {
    add(lineKey('monster.boss', b.id, 'name'), b.name, `The boss of level ${b.level}: an invented name, then an epithet. Keep the name, translate the epithet; on the boss's life bar.`);
    add(lineKey('monster.boss', b.id, 'flavour'), b.flavour, `A line about the boss ${b.name}, with a hint for beating it.`);
  }
  add('monster.boss.name', '{name}, the {epithet}', 'A rift boss’s name ("Vorgath, the Emberhide"): {name} is invented (keep it as it is), {epithet} one of monster.boss.epithet.*. On the boss’s life bar.');
  for (const e of new Set(Object.values(EPITHETS).flat())) add(lineKey('monster.boss.epithet', e), e, 'A rift boss’s epithet, after its name (monster.boss.name: "{name}, the {epithet}").');
  for (const p of BOSS_PHASES) add(lineKey('monster.boss.phase', p), p, 'A phase of a boss fight (the boss gets stronger as its life falls).');

  return { lines, notes };
}

/** A body part's name (`monster.part.<partId>`); an unknown part shows its id. */
export function partName(id: string): string {
  return PARTS.has(id) ? t(lineKey('monster.part', id)) : id;
}

/** A body plan's name (`monster.plan.<id>.name`). */
export function planName(id: string): string {
  return PLANS.has(id) ? t(lineKey('monster.plan', id, 'name')) : id;
}

/** An archetype's name (`monster.archetype.<id>.name`). */
export function archetypeName(id: string): string {
  return ARCHETYPES.has(id) ? t(lineKey('monster.archetype', id, 'name')) : id;
}

/** What an archetype does (`monster.archetype.<id>.desc`). */
export function archetypeDescription(id: string): string {
  return ARCHETYPES.has(id) ? t(lineKey('monster.archetype', id, 'desc')) : '';
}

/** An elite modifier's name (`monster.elite.<id>.name`). */
export function eliteName(id: string, language: Pick<Lang, 't'> = lang()): string {
  return ELITE_MODS.has(id) ? language.t(lineKey('monster.elite', id, 'name')) : id;
}

/** What an elite modifier does (`monster.elite.<id>.desc`). */
export function eliteDescription(id: string): string {
  return ELITE_MODS.has(id) ? t(lineKey('monster.elite', id, 'desc')) : '';
}

/** A monster skill's name (`monster.skill.<id>.name`). */
export function monsterSkillName(id: string): string {
  return MONSTER_SKILLS.has(id) ? t(lineKey('monster.skill', id, 'name')) : id;
}

/** A boss attack's name (`monster.attack.<id>.name`). */
export function bossAttackName(id: string): string {
  return BOSS_ATTACKS.has(id) ? t(lineKey('monster.attack', id, 'name')) : id;
}

/** What a boss attack does (`monster.attack.<id>.desc`). */
export function bossAttackDescription(id: string): string {
  return BOSS_ATTACKS.has(id) ? t(lineKey('monster.attack', id, 'desc')) : '';
}

/** A boss phase's name (`BossPhase.name`: `monster.boss.phase.<name>`). */
export function bossPhaseName(name: string): string {
  return (BOSS_PHASES as readonly string[]).includes(name) ? t(lineKey('monster.boss.phase', name)) : name;
}

const DESIGNED_BY_NAME = new Map<string, string>();

/**
 * A boss's name in the player's language, from its `BossDef` or its English name (`BossDef.name`,
 * the data a save or the bestiary keeps): a designed boss's line, a rift boss's invented name
 * and translated epithet through `monster.boss.name`; any other name as it is.
 */
export function bossNameShown(boss: Pick<BossDef, 'id' | 'name'> | string): string {
  const name = typeof boss === 'string' ? boss : boss.name;
  if (!DESIGNED_BY_NAME.size) for (const b of DESIGNED_BOSSES) DESIGNED_BY_NAME.set(b.name, b.id);
  const designed = typeof boss !== 'string' && DESIGNED_BOSSES.some((b) => b.id === boss.id) ? boss.id : DESIGNED_BY_NAME.get(name);
  if (designed) return t(lineKey('monster.boss', designed, 'name'));
  const parts = bossNameParts(name);
  return parts ? t('monster.boss.name', { name: parts.name, epithet: t(lineKey('monster.boss.epithet', parts.epithet)) }) : name;
}

/** A designed boss's flavour line; a rift boss's (never shown) as it is. */
export function bossFlavour(boss: Pick<BossDef, 'id' | 'flavour'>): string {
  return DESIGNED_BOSSES.some((b) => b.id === boss.id) ? t(lineKey('monster.boss', boss.id, 'flavour')) : boss.flavour;
}
