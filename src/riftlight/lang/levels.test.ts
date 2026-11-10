// Levels' words are lines: mechanics (the codex), designed levels' and rifts' names, themes,
// shrines; a level's name is made from its spec's depth and mechanics, so a saved run shows in
// today's language, and English reads as before.
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import type { LevelSpec } from '../core/types';
import { DESIGNED_LEVELS } from '../levels/designed';
import { MECHANIC_ORDER, MECHANICS } from '../levels/mechanics';
import { SHRINES } from '../levels/plan';
import { levelSpec, riftSpec } from '../levels/rift';
import { THEMES } from '../levels/themes/themes';
import type { Worlds } from '../wire/world';
import { RealLevels } from '../wire/levels';
import { installLanguage, riftlightLines } from './index';
import { LEVELS, levelName, mechanicName, riftName, shrineName, themeName } from './levels';

const french = (lines: Record<string, string>) => installLanguage(new Lang(riftlightLines(), { fr: { by: 'test', lines } }, { code: 'fr' }));

afterEach(() => {
  installLanguage(new Lang(riftlightLines()));
});

describe('level lines', () => {
  const lines = LEVELS().lines;

  it('every mechanic, designed level, theme and shrine has its lines', () => {
    const count = (prefix: string) => Object.keys(lines).filter((id) => id.startsWith(prefix)).length;
    expect(count('level.mechanic.')).toBe(MECHANICS.all().length * 4);
    expect(count('level.name.')).toBe(DESIGNED_LEVELS.length);
    expect(count('level.theme.')).toBe(THEMES.all().length);
    expect(count('level.shrine.')).toBe(SHRINES.all().length);
  });

  it('a level’s name in English is the name its spec keeps', () => {
    for (const spec of DESIGNED_LEVELS) expect(levelName(spec)).toBe(spec.name);
    for (let d = 13; d <= 90; d += 7) for (const seed of [1, 99, 4242]) expect(levelName(riftSpec(seed, d))).toBe(riftSpec(seed, d).name);
  });

  it('in another language: from depth and mechanics, the joining lines reordering them', () => {
    french({ 'level.name.embers': 'Les Braises', 'level.mechanic.frostglass.name': 'Verregivre', 'level.rift.name': 'Faille {depth} : {mechanics}', 'level.rift.mechanics.two': '{second} et {first}' });
    expect(levelName(levelSpec(1))).toBe('Les Braises');
    const saved: LevelSpec = { ...levelSpec(1), name: 'Embers (an old save)' };
    expect(levelName(saved)).toBe('Les Braises');
    expect(riftName(37, ['frostglass', 'gravewell'])).toBe('Faille 37 : Gravewell et Verregivre');
    expect(riftName(13, ['frostglass'])).toBe('Faille 13 : Verregivre');
    expect(riftName(61, ['frostglass', 'gale', 'mire', 'gloom'])).toBe('Faille 61 : Verregivre Gale Mire'); // the first three, as riftSpec names it
    expect(mechanicName('frostglass')).toBe('Verregivre');
  });

  it('themes (a rift’s shifted one by its base) and shrines', () => {
    expect(themeName('ember-forge~h20c110s90')).toBe('Ember Forge');
    expect(shrineName('haste')).toBe('Shrine of Haste');
    french({ 'level.theme.ember_forge': 'Forge des braises', 'level.shrine.haste': 'Autel de hâte' });
    expect([themeName('ember-forge'), shrineName('haste')]).toEqual(['Forge des braises', 'Autel de hâte']);
  });

  it('the level port gives the codex its mechanics in the player’s language', () => {
    const port = new RealLevels(null as unknown as Worlds);
    const english = port.mechanics();
    expect(english.map((m) => m.id)).toEqual([...MECHANIC_ORDER]);
    for (const m of english) expect(m).toEqual({ id: m.id, name: MECHANICS.get(m.id).name, description: MECHANICS.get(m.id).description, bypass: MECHANICS.get(m.id).bypass, exploit: MECHANICS.get(m.id).exploit });
    french({ 'level.mechanic.gale.name': 'Bourrasque', 'level.mechanic.gale.exploit': 'Profite du vent.' });
    const gale = port.mechanics().find((m) => m.id === 'gale')!;
    expect([gale.name, gale.exploit, gale.bypass]).toEqual(['Bourrasque', 'Profite du vent.', MECHANICS.get('gale').bypass]);
  });
});
