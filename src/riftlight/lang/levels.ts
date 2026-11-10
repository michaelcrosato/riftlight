/**
 * The lines of levels: designed levels, mechanics, themes, rifts, shrines, hazards (levels/, wire/levels.ts, wire/hazards.ts). docs/game/lang.md has the rules for a line.
 *
 * Built from the registries (their English is the line), so a mechanic, theme or shrine added as
 * data brings its lines along. A level keeps its English name in its spec (`LevelSpec.name`:
 * data, saved with the run); `levelName(spec)` is the name shown, made from its depth and
 * mechanics in the player's language.
 */
import type { LevelSpec } from '../core/types';
import { DESIGNED_LEVELS } from '../levels/designed';
import { MECHANIC_ORDER, MECHANICS } from '../levels/mechanics';
import { SHRINES } from '../levels/plan';
import { THEMES } from '../levels/themes/themes';
import { type LineArea, lineKey } from './area';
import { t } from './index';

/** Every level line (a function: the registries are read when the list is made). */
export function LEVELS(): LineArea {
  const lines: Record<string, string> = {};
  const notes: Record<string, string> = {};
  const max: Record<string, number> = {};
  const add = (id: string, line: string, note?: string) => {
    lines[id] = line;
    if (note) notes[id] = note;
  };

  for (const id of MECHANIC_ORDER) {
    const m = MECHANICS.get(id);
    add(lineKey('level.mechanic', id, 'name'), m.name, 'A level mechanic (the twist a level is built around), in the codex; rifts are named after theirs (level.rift.name).');
    max[lineKey('level.mechanic', id, 'name')] = 16; // a row of the codex's list
    add(lineKey('level.mechanic', id, 'description'), m.description, `What the ${m.name} mechanic does, in the codex.`);
    add(lineKey('level.mechanic', id, 'bypass'), m.bypass, `How to get through a ${m.name} level safely without using its mechanic (codex), said to the player.`);
    add(lineKey('level.mechanic', id, 'exploit'), m.exploit, `How to turn the ${m.name} mechanic to your advantage (codex), said to the player.`);
  }
  for (const spec of DESIGNED_LEVELS) {
    const id = spec.mechanics[0]!;
    add(lineKey('level.name', id), spec.name, `The name of level ${spec.depth}, after the mechanic it introduces (level.mechanic.${id}.name): on the level card and the level list.`);
  }
  add('level.rift.name', 'Rift {depth}: {mechanics}', 'A rift’s name (the endless levels past the twelfth): {depth} its number, {mechanics} its mechanics’ names (level.rift.mechanics.*). On the level card.');
  add('level.rift.mechanics.two', '{first} {second}', 'Two mechanics’ names (level.mechanic.*.name) in a rift’s name: "Frostglass Gravewell".');
  add('level.rift.mechanics.three', '{first} {second} {third}', 'Three mechanics’ names (level.mechanic.*.name) in a rift’s name: "Frostglass Gravewell Mire".');
  for (const th of THEMES.all()) add(lineKey('level.theme', th.id), th.name, 'A level’s look and setting (where it takes place).');
  for (const s of SHRINES.all()) add(lineKey('level.shrine', s.id), s.name, 'A shrine in a level: touching it gives the hero a short blessing.');

  return { lines, notes, max };
}

/** A mechanic's name (`level.mechanic.<id>.name`); an unknown one shows its id. */
export function mechanicName(id: string): string {
  return MECHANICS.has(id) ? t(lineKey('level.mechanic', id, 'name')) : id;
}

/** A mechanic's codex text: name, what it does, how to get past it, how to exploit it. */
export function mechanicText(id: string): { name: string; description: string; bypass: string; exploit: string } {
  if (!MECHANICS.has(id)) return { name: id, description: '', bypass: '', exploit: '' };
  const line = (part: string) => t(lineKey('level.mechanic', id, part));
  return { name: line('name'), description: line('description'), bypass: line('bypass'), exploit: line('exploit') };
}

/**
 * A level's name as shown (the level card, the level list, the death screen): a designed level's
 * line (`level.name.<mechanic>`), a rift's number and mechanics (`level.rift.name`). From the
 * spec's depth and mechanics, never its stored English `name`, so a saved run shows in today's language.
 */
export function levelName(spec: Pick<LevelSpec, 'depth' | 'mechanics'>): string {
  const first = spec.mechanics[0];
  if (spec.depth <= DESIGNED_LEVELS.length && first && DESIGNED_LEVELS.some((d) => d.mechanics[0] === first)) return t(lineKey('level.name', first));
  return riftName(spec.depth, spec.mechanics);
}

/** A rift's name: "Rift 37: Frostglass Gravewell" (its first three mechanics, as `riftSpec` names it). */
export function riftName(depth: number, mechanics: readonly string[]): string {
  const [first, second, third] = mechanics.slice(0, 3).map(mechanicName);
  const names = third ? t('level.rift.mechanics.three', { first: first!, second: second!, third }) : second ? t('level.rift.mechanics.two', { first: first!, second }) : (first ?? '');
  return t('level.rift.name', { depth, mechanics: names });
}

/** A theme's name (`level.theme.<id>`; a rift's shifted theme `base~h…` by its base). */
export function themeName(id: string): string {
  const base = id.split('~')[0]!;
  return THEMES.has(base) ? t(lineKey('level.theme', base)) : id;
}

/** A shrine's name (`level.shrine.<id>`). */
export function shrineName(id: string): string {
  return SHRINES.has(id) ? t(lineKey('level.shrine', id)) : id;
}
