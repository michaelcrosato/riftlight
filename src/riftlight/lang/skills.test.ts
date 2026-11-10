// Gems, ailments and charges read from lines (lang/skills.ts), and every tag a gem shows has its word.
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine/lang/lang';
import { AILMENTS } from '../combat/ailments';
import { CHARGE_TYPES } from '../combat/charges';
import { ACTIVE_SKILLS } from '../skills/actives';
import { SUPPORT_GEMS } from '../skills/supports';
import { lineKey } from './area';
import { installLanguage, riftlightLines } from './index';
import { tagWord } from './mods';
import { ailmentName, chargeDescription, chargeName, curseName, skillDescription, skillName, supportDescription, supportName } from './skills';

afterEach(() => installLanguage(new Lang(riftlightLines())));

describe('skill lines', () => {
  const lines = riftlightLines().lines;

  it('every gem has a name and a description; every tag a gem carries, its word', () => {
    for (const s of ACTIVE_SKILLS) expect([lines[lineKey('skill', s.id, 'name')], lines[lineKey('skill', s.id, 'description')]]).toEqual([s.name, s.description]);
    for (const s of SUPPORT_GEMS) expect([lines[lineKey('support', s.id, 'name')], lines[lineKey('support', s.id, 'description')]]).toEqual([s.name, s.description]);
    const tags = new Set([...ACTIVE_SKILLS.flatMap((s) => s.tags ?? []), ...SUPPORT_GEMS.flatMap((s) => [...s.requires, ...(s.tags ?? []), ...(s.excludes ?? []), ...(s.changes?.addTags ?? [])])]);
    expect([...tags].filter((tag) => !lines[lineKey('tag', tag)])).toEqual([]);
    for (const a of AILMENTS.all()) expect(lines[lineKey('ailment', a.id)]).toBe(a.name);
    for (const c of CHARGE_TYPES) expect(lines[lineKey('charge', c)]).toMatch(/ charges$/);
  });

  it('the helpers show them in the player\'s language', () => {
    expect([skillName('fireball'), supportName('gmp'), ailmentName('ignite'), chargeName('frenzy'), tagWord('projectile')]).toEqual(['Fireball', 'Greater Multiple Projectiles', 'Ignite', 'Frenzy charges', 'projectile']);
    expect(curseName({ id: 'vulnerability', name: 'Vulnerability' })).toBe('Vulnerability');
    expect(curseName({ id: 'old-curse', name: 'Old Curse' })).toBe('Old Curse');
    const fake = installLanguage(new Lang(riftlightLines(), {}, { code: 'en-XA' }));
    fake.controlLabel = () => 'Space';
    for (const text of [skillName('arc'), skillDescription('arc'), supportName('chain'), supportDescription('chain'), ailmentName('chill'), chargeName('power'), chargeDescription('power'), curseName({ id: 'enfeeble' })]) expect(text, text).toMatch(/^\[.*\]$/s);
    expect(skillDescription('dodge-roll')).toContain('Space'); // the key is a control tag, filled for the device in use
  });
});
