// The build systems the passive tree and loot feed, in the combat arena headless (was e2e
// `riftlight-builds`' arena checks), with the skill bar curse, totem, trap, aura, discharge:
// kills grant charges of every kind (pips orbit the hero, the charges a stat source),
// Vulnerability hexes the dummies (rune and tint, more damage taken), Fireball + Spell Totem plants
// a totem that casts at the dummies, Fireball + Trap throws a trap that releases a fireball when
// a dummy walks in, Haste reserves a quarter of the mana pool, Discharge spends every charge.
// Pictures stay in e2e. One engine for the file, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import { headlessGame } from '../headless';
import { Arena } from './arena';

const T = 30_000;
const BAR = 'vulnerability,fireball+spell-totem,fireball+trap-support,haste-aura,discharge';

interface Logged {
  type: string;
  frame: number;
  sourceTags: readonly string[];
  total: number;
  target: string | null;
  outcome?: string;
}

describe('the build systems in the arena', () => {
  let e: Engine;
  let g: Arena;
  const log: Logged[] = [];

  beforeAll(async () => {
    g = new Arena({ skills: BAR });
    e = await headlessGame(g);
    e.step(2);
    g.actors.events.onAny((type, payload) => {
      type Who = { name?: string; tags?: readonly string[] };
      const p = payload as { hit?: { source?: Who }; actor?: Who; result?: { total?: number }; target?: Who; outcome?: string } | undefined;
      log.push({ type: String(type), frame: e.frame, sourceTags: p?.hit?.source?.tags ?? p?.actor?.tags ?? [], total: p?.result?.total ?? 0, target: p?.target?.name ?? null, outcome: p?.outcome });
    });
    // a hero who can afford everything, and dummies that stand still to be measured
    const a = g.hero.actor;
    a.stats.set('e2e', [
      { stat: 'mana', kind: 'flat', value: 400 },
      { stat: 'life', kind: 'flat', value: 2000 },
      { stat: 'mana.regen', kind: 'flat', value: 40 },
      { stat: 'charge.onKill', kind: 'flat', value: 1 },
    ]);
    a.mana = a.maxMana;
    a.life = a.maxLife;
    for (const d of g.dummies) d.brain = null;
  }, T);
  afterAll(() => e?.dispose());

  /** Press a key for two frames, as a tap. */
  const press = (code: string) => {
    e.input.setKey(code, true);
    e.step(2);
    e.input.setKey(code, false);
  };

  it('the skill bar: curse, totem, trap, aura (reserving), discharge', () => {
    const slots = g.hero.slots.map((x) => x && { id: x.id, placement: x.placement, reservation: x.reservation });
    expect(slots.map((x) => x?.id)).toEqual(['vulnerability', 'fireball', 'fireball', 'haste-aura', 'discharge']);
    expect(slots[1]?.placement).toBe('totem');
    expect(slots[2]?.placement).toBe('trap');
    expect(slots[3]?.reservation).toBeGreaterThan(0);
  });

  it(
    'three dummies killed with the basic attack: each kill grants a charge of every kind, nine pips orbit the hero and the charges are a stat source',
    () => {
      const a = g.hero.actor;
      let kills = 0;
      for (const d of g.dummies.filter((x) => x.name === 'dummy').slice(0, 3)) {
        // one swing kills it: the hero stands in front and swings with J
        d.life = 1;
        g.hero.teleport([d.position.x, 0, d.position.z + 1.3]);
        g.hero.facing = Math.PI;
        e.step(4);
        press('KeyJ');
        for (let i = 0; i < 40 && d.alive; i++) e.step(1);
        if (!d.alive) kills++;
        e.step(20);
      }
      g.hero.teleport([0, 0, 3]);
      g.hero.facing = Math.PI;
      e.step(30);
      expect(kills).toBe(3);
      expect({ ...a.charges.count }).toEqual({ endurance: 3, frenzy: 3, power: 3 });
      expect(a.status?.pipCount, 'charge pips').toBe(9);
      expect(a.stats.explain('damage').some((x) => x.source === 'charges'), 'the charges a damage source').toBe(true);
    },
    T,
  );

  it(
    'Vulnerability curses the dummies: each shows a rune circle and a tint, and takes 30% more physical damage',
    () => {
      g.spawnDummies();
      for (const d of g.dummies) d.brain = null;
      g.hero.teleport([0, 0, 1]);
      g.hero.facing = Math.PI;
      e.step(4);
      const from = log.length;
      press('KeyK');
      e.step(40);
      const cursed = g.dummies.filter((d) => d.curses.has('vulnerability'));
      expect(cursed.length, 'cursed dummies').toBeGreaterThan(0);
      expect(log.slice(from).filter((l) => l.type === 'curse' && l.outcome === 'applied').length, 'curse events').toBeGreaterThanOrEqual(cursed.length);
      expect(cursed.filter((d) => d.status?.cursed && d.fx.tinted).length, 'shown with a rune and a tint').toBe(cursed.length);
      expect(cursed[0]!.stats.get('damage.taken', ['physical'])).toBeCloseTo(1.3, 2);
      e.step(20);
    },
    T,
  );

  it(
    'Fireball + Spell Totem plants a totem for the hero that casts fireballs that hit the dummies',
    () => {
      g.hero.teleport([0, 0, 3]);
      g.hero.facing = Math.PI;
      e.step(10);
      const from = log.length;
      press('KeyQ');
      e.step(150);
      const t = g.actors.actors.find((x) => x.tags.includes('totem'));
      const after = log.slice(from);
      expect(t?.alive, 'a totem').toBe(true);
      expect(t?.owner, "the hero's").toBe(g.hero.actor);
      expect(after.filter((l) => l.type === 'skill' && l.sourceTags.includes('totem')).length, 'casts').toBeGreaterThan(0);
      expect(after.filter((l) => l.type === 'hit' && l.total > 0 && l.sourceTags.includes('totem')).length, 'hits').toBeGreaterThan(0);
    },
    T,
  );

  it(
    'Fireball + Trap throws an armed trap that releases its fireball when a dummy comes near',
    () => {
      g.spawnDummies();
      for (const d of g.dummies) d.brain = null;
      g.hero.teleport([5, 0, 6]);
      g.hero.facing = 0;
      e.step(4);
      const from = log.length;
      press('KeyE');
      e.step(60);
      expect(g.combat.active('trap').length, 'traps').toBe(1);
      expect(g.combat.active('trap').some((t) => !(t as { sprung?: boolean }).sprung), 'armed').toBe(true);
      // a dummy walks onto it
      const at = (g.combat.active('trap')[0] as { at?: { x: number; z: number } } | undefined)?.at;
      const d = g.dummies.find((x) => x.name === 'dummy')!;
      expect(at).toBeTruthy();
      d.mover.teleport(at!.x + 0.3, 0, at!.z);
      d.position.copy(d.mover.position);
      e.step(40);
      const after = log.slice(from);
      expect(after.filter((l) => l.type === 'skill' && l.sourceTags.includes('proxy')).length, 'releases').toBeGreaterThan(0);
      expect(after.filter((l) => l.type === 'hit' && l.total > 0 && l.target === 'dummy').length, 'hits on a dummy').toBeGreaterThan(0);
    },
    T,
  );

  it(
    'Haste reserves 25% of the mana pool and gives it back toggled off; Discharge spends every charge',
    () => {
      const a = g.hero.actor;
      g.hero.teleport([0, 0, 2]);
      a.mana = a.maxMana;
      e.step(30);
      press('KeyR');
      e.step(60);
      expect(a.reservedFraction).toBeCloseTo(0.25, 6);
      expect(a.mana).toBeLessThanOrEqual(a.maxMana * 0.75 + 1e-6);
      press('KeyR');
      e.step(30);
      expect(a.reservedFraction, 'toggled off').toBe(0);
      // Discharge: every charge for one big storm
      expect(a.charges.total, 'charges held').toBe(9);
      a.mana = a.maxMana;
      press('KeyF');
      e.step(60);
      expect(a.charges.total, 'after Discharge').toBe(0);
      expect(e.errors).toEqual([]);
    },
    T,
  );
});
