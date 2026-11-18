// The film's Arena scenarios (`npm run film -- arena-*`, scripts/film-scenarios.ts) played headless
// on the Arena, as the film plays them in the browser (`place` resets the hero, the bar and the
// dummies; `skills` sets the bar; keys are the engine's keys): each one casts the skills it is
// for. The Arena plays on the game's key map (game/controls.ts `heroCodes`), so a scenario that
// presses a key nothing reads (K, once the first slot) films a hero who never acts, and the film
// itself still exits 0; here it goes red.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three/webgpu';
import type { Engine } from '../../engine';
import { KEYS, parse, SCENARIOS } from '../../../scripts/film-scenarios';
import type { SlotSpec } from '../actors/HeroController';
import { headlessGame } from '../headless';
import { Arena } from './arena';

const T = 60_000;

/** The scenarios on the Arena's default bar (cleave, fireball, frost nova, leap slam, whirlwind): the skills each films. */
const DEFAULT_BAR_FILMS: Readonly<Record<string, readonly string[]>> = {
  'arena-skills': ['fireball', 'frost-nova', 'leap-slam'],
  'arena-run-cast': ['fireball'],
  'arena-whirlwind': ['whirlwind'],
};

/** Keys that move, attack or dodge: anything else a scenario presses is a skill. */
const NOT_SKILLS = new Set(['W', 'A', 'S', 'D', 'SHIFT', 'J', 'LMB', 'SPACE'].map((k) => KEYS[k]!));

describe('the film’s Arena scenarios', () => {
  let e: Engine;
  let g: Arena;
  let defaults: (SlotSpec | null)[];

  beforeAll(async () => {
    g = new Arena();
    e = await headlessGame(g);
    e.step(2);
    defaults = g.hero.slots.map((s) => (s ? { skill: s.id, supports: [...s.supports] } : null));
  }, T);
  afterAll(() => e?.dispose());

  /** `place` as the film does it: keys up, the hero alive with full mana, no cooldowns, the default bar, fresh dummies. */
  const place = (x: number, y: number, z: number, yaw: number) => {
    for (const k of Object.values(KEYS)) e.input.setKey(k, false);
    const hero = g.hero;
    if (!hero.actor.alive || hero.actor.deadFor >= 0) hero.revive();
    hero.actor.stats.remove('film:weapon');
    defaults.forEach((s, i) => hero.setSlot(i, s));
    hero.cooldowns.clear();
    hero.actor.life = hero.actor.maxLife;
    hero.actor.mana = hero.actor.maxMana;
    for (const d of g.dummies) g.actors.remove(d);
    g.dummies.length = 0;
    g.respawns = 0;
    g.spawnDummies();
    e.step(1);
    hero.teleport([x, y, z]);
    hero.facing = (yaw * Math.PI) / 180;
    hero.hvel.set(0, 0, 0);
    e.step(20);
  };

  /** Play a scenario; the skills the hero cast from its bar, in order, and how many skill keys it pressed. */
  const play = (script: string): { cast: string[]; presses: number } => {
    const cast: string[] = [];
    let presses = 0;
    const hero = g.hero;
    const own = hero.startSkill.bind(hero);
    const spy = vi.spyOn(hero, 'startSkill').mockImplementation((skill, slot, keys) => {
      const ok = own(skill, slot, keys);
      if (ok && slot >= 0) cast.push(skill.id);
      return ok;
    });
    const set = (keys: string[], down: boolean) => keys.forEach((k) => e.input.setKey(k, down));
    try {
      for (const c of parse(script)) {
        if (['tap', 'down', 'hold'].includes(c.op) && c.keys.some((k) => !NOT_SKILLS.has(k))) presses++;
        if (c.op === 'place') place(c.n[0] ?? 0, c.n[1] ?? 0, c.n[2] ?? 0, c.n[3] ?? 0);
        else if (c.op === 'skills') {
          const specs = c.word.split(',').map((x) => ({ skill: x.split('+')[0]!, supports: x.split('+').slice(1) }));
          for (let i = 0; i < 5; i++) hero.setSlot(i, specs[i] ?? null);
          hero.actor.mana = hero.actor.maxMana;
        } else if (c.op === 'weapon') {
          const [kind, two] = c.word.split(/\s+/);
          hero.actor.stats.set('film:weapon', [{ stat: `weapon.${kind}`, kind: 'flag', value: 1 }, ...(two === '2h' ? [{ stat: 'weapon.twohand', kind: 'flag' as const, value: 1 }] : [])]);
        } else if (c.op === 'hurt') {
          const [share = 0.2, dx = 0, dz = 1] = c.n;
          hero.actor.life = Math.max(1, hero.actor.life - hero.actor.maxLife * share);
          const len = Math.hypot(dx, dz) || 1;
          hero.actor.push(new Vector3((-dx / len) * 6, 0, (-dz / len) * 6));
        } else if (c.op === 'kill') {
          hero.actor.life = 0;
          hero.actor.die(null);
        } else if (c.op === 'down') set(c.keys, true);
        else if (c.op === 'up') set(c.keys, false);
        else if (c.op === 'hold') {
          set(c.keys, true);
          e.step(c.n[0] ?? 30);
          set(c.keys, false);
        } else if (c.op === 'tap') {
          set(c.keys, true);
          e.step(2);
          set(c.keys, false);
          e.step(1);
        } else if (c.op === 'wait') e.step(c.n[0] ?? 30);
        else if (c.op === 'until') {
          for (let i = 0; i < (c.n[0] ?? 180) && hero.state !== c.word; i++) e.step(1);
        } else throw new Error(`the Arena plays no "${c.op}"`);
      }
    } finally {
      spy.mockRestore();
      for (const k of Object.values(KEYS)) e.input.setKey(k, false);
    }
    return { cast, presses };
  };

  const arena = Object.keys(SCENARIOS).filter((n) => n.startsWith('arena-'));

  it('there are scenarios for the Arena, and each one that presses a skill key says which skills it films', () => {
    expect(arena.length).toBeGreaterThan(20);
    for (const name of arena) {
      const presses = parse(SCENARIOS[name]!).filter((c) => ['tap', 'down', 'hold'].includes(c.op) && c.keys.some((k) => !NOT_SKILLS.has(k))).length;
      const bar = parse(SCENARIOS[name]!).some((c) => c.op === 'skills');
      if (presses) expect(bar || name in DEFAULT_BAR_FILMS, `${name}: a \`skills\` bar, or the default bar in DEFAULT_BAR_FILMS`).toBe(true);
    }
  });

  it.each(arena)(
    '%s casts the skills it films, one cast for each skill key it presses',
    (name) => {
      const script = SCENARIOS[name]!;
      const bar = parse(script).find((c) => c.op === 'skills');
      const films = bar ? bar.word.split(',').map((x) => x.split('+')[0]!) : (DEFAULT_BAR_FILMS[name] ?? []);
      const { cast, presses } = play(script);
      expect([...new Set(cast)], `${name}: what it cast (${script})`).toEqual(films);
      expect(cast.length, `${name}: a cast per skill key pressed`).toBeGreaterThanOrEqual(presses);
    },
    T,
  );
});
