import { describe, expect, it } from 'vitest';
import { parseSong } from '../../engine/audio';
import { Rng } from '../core/rng';
import type { Genome } from '../core/types';
import { exportSave, newSave, parseSave } from '../game/save';
import { crossover, generateGenome, mutate, validateGenome } from '../monsters';
import { ARCADE_STAGE, ARCADE_SONG } from './arcade/stage';
import { HALL_SONG } from './bestiary/hall';
import { PHOTO_LOOKS } from './photo/PhotoMode';
import { ARCADE_REWARD, BESTIARY_LIMIT, type BestiaryEntry, exhibitOrder, recordArcadeRun, recordKill, sanitizeShowcase, showcaseOf, speciesKey } from './save';
import { FILTER_IDS, FILTER_PRESETS } from '../../engine/render/filters';

const genome = (seed: number, o: Parameters<typeof generateGenome>[1] = {}): Genome => generateGenome(new Rng(seed), { depth: 3, ...o });

describe('bestiary records', () => {
  it('counts pack mates as one species and keeps the toughest specimen', () => {
    const list: BestiaryEntry[] = [];
    const g = genome(1);
    recordKill(list, g, { name: 'Cinder Hound', rank: 'normal', depth: 2 });
    const mate = { ...g, seed: 999, genes: { ...g.genes, length: 0.1 } }; // same body plan, parts, archetype
    recordKill(list, mate, { name: 'Cinder Hound', rank: 'normal', depth: 3 });
    const rare = { ...g, rank: 'rare' as const };
    const e = recordKill(list, rare, { name: 'Hasted Cinder Hound', rank: 'rare', depth: 4 });
    expect(list).toHaveLength(1);
    expect(e.kills).toBe(3);
    expect(e.first).toBe(2);
    expect(e.last).toBe(4);
    expect(e.rank).toBe('rare');
    expect(e.name).toBe('Hasted Cinder Hound');
  });

  it('keys bosses by name and lists them first', () => {
    const list: BestiaryEntry[] = [];
    for (let s = 0; s < 6; s++) recordKill(list, genome(10 + s), { name: `M${s}`, rank: 'normal', depth: 1 });
    recordKill(list, { ...genome(50, { rank: 'boss' }), rank: 'boss' }, { name: 'Vorgath, the Emberhide', rank: 'boss', depth: 1 });
    expect(speciesKey({ ...genome(50), rank: 'boss' }, 'Vorgath, the Emberhide')).toBe('boss:Vorgath, the Emberhide');
    expect(exhibitOrder(list)[0]!.rank).toBe('boss');
  });

  it(`never keeps more than ${BESTIARY_LIMIT} species, and the bosses stay`, () => {
    const list: BestiaryEntry[] = [];
    recordKill(list, { ...genome(7, { rank: 'boss' }), rank: 'boss' }, { name: 'Boss', rank: 'boss', depth: 1 });
    for (let s = 0; s < BESTIARY_LIMIT + 20; s++) recordKill(list, genome(100 + s), { name: `M${s}`, rank: 'normal', depth: 1 });
    expect(list.length).toBeLessThanOrEqual(BESTIARY_LIMIT);
    expect(list.some((e) => e.rank === 'boss')).toBe(true);
  });

  it('survives a save round trip, and junk is cleaned', () => {
    const save = newSave(5);
    const sc = showcaseOf(save);
    recordKill(sc.bestiary, genome(3), { name: 'Stone Serpent', rank: 'magic', depth: 6 });
    recordArcadeRun(sc.arcade, { time: 21.5, coins: 12 });
    const back = parseSave(exportSave(save, 0));
    expect(back.showcase?.bestiary[0]?.name).toBe('Stone Serpent');
    expect(back.showcase?.bestiary[0]?.genome.plan).toBe(sc.bestiary[0]!.genome.plan);
    expect(back.showcase?.arcade.best).toBe(21.5);
    const junk = sanitizeShowcase({ arcade: { best: -3, coins: 'x' }, bestiary: [{ key: 1 }, null, { key: 'a', genome: { plan: 'blob', parts: [] }, kills: 0 }] });
    expect(junk.arcade.best).toBe(0);
    expect(junk.bestiary).toHaveLength(1);
    expect(junk.bestiary[0]!.kills).toBe(1);
    expect(parseSave(exportSave(newSave(1), 0)).showcase).toBeUndefined();
  });

  it('breeding two kills gives a buildable child (the altar)', () => {
    for (let s = 0; s < 20; s++) {
      const rng = new Rng(s).fork('breed');
      const child = mutate(crossover(genome(s), genome(s + 100), rng), rng.fork('mutate'), 0.25);
      expect(validateGenome(child)).toEqual([]);
    }
  });
});

describe('arcade', () => {
  it('pays a little gold and keeps the best time', () => {
    const r = showcaseOf(newSave(1)).arcade;
    const first = recordArcadeRun(r, { time: 20, coins: 10 });
    expect(first).toEqual({ reward: ARCADE_REWARD.finish + 10 * ARCADE_REWARD.perCoin + ARCADE_REWARD.newBest, newBest: true });
    const slower = recordArcadeRun(r, { time: 25, coins: 15 });
    expect(slower.newBest).toBe(false);
    expect(r.best).toBe(20);
    expect(r.coins).toBe(15);
    expect(r.clears).toBe(2);
  });

  it('the course is sound: coins outside blocks, the flag on the ground, checkpoints on floors', () => {
    const S = ARCADE_STAGE;
    const solid = (x: number, y: number) => S.blocks.some((b) => x > b.x[0] && x < b.x[1] && y > b.y[0] && y < b.y[1]);
    for (const [x, y] of S.coins) expect(solid(x, y + 0.4), `coin at ${x},${y}`).toBe(false);
    const ground = (x: number) => S.blocks.some((b) => x > b.x[0] && x < b.x[1] && Math.abs(b.y[1]) < 1e-6);
    expect(ground(S.flag)).toBe(true);
    for (const [x, y] of S.checkpoints) expect(S.blocks.some((b) => x >= b.x[0] && x <= b.x[1] && Math.abs(b.y[1] - y) < 1e-6)).toBe(true);
    // the cracked slabs are the only way down to the flag: a solid block left of them, the gate right
    const s0 = S.breakable[0]!;
    expect(solid(s0.x[0] - 0.5, s0.y[1] - 0.5)).toBe(true);
    expect(solid(S.breakable.at(-1)!.x[1] + 0.5, s0.y[1] + 0.5)).toBe(true);
  });

  it('songs parse', () => {
    expect(() => parseSong(ARCADE_SONG)).not.toThrow();
    expect(() => parseSong(HALL_SONG)).not.toThrow();
  });
});

describe('photo mode', () => {
  it('offers every look preset and every single filter', () => {
    const stacks = PHOTO_LOOKS.map((l) => l.filters.join());
    for (const p of Object.values(FILTER_PRESETS)) expect(stacks).toContain(p.join());
    for (const id of FILTER_IDS) expect(stacks).toContain(id);
  });
});
