import { Color, type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { analyzeClip, compileClip, restPoseOf, validateClip } from '../../engine/animation';
import { HERO_RIG } from '../../game/hero/rig';
import { Rng } from '../core/rng';
import { bfs } from '../game/nav';
import { PlaytestBot } from '../game/bot';
import { generateLayout } from '../game/stubs/layout';
import { collideBlockers, Kit } from './kit';
import { NPC_CLIPS } from './npcClips';
import { TOWNSFOLK } from './npcModel';
import { NPCS } from './npcs';
import type { ShellServices } from '../game/ports';
import { iso, Town } from './Town';

describe('townsfolk', () => {
  for (const [id, build] of Object.entries(TOWNSFOLK)) {
    it(`${id}: the model wears the hero rig and every clip measures clean`, () => {
      const model = build();
      const rest = restPoseOf(model, HERO_RIG);
      for (const sole of HERO_RIG.soles) expect(model.getObjectByName(sole), sole).toBeTruthy();
      for (const def of NPC_CLIPS[id] ?? []) {
        expect(validateClip(def, HERO_RIG), def.name).toEqual([]);
        const report = analyzeClip(model, HERO_RIG, def, compileClip(def, HERO_RIG, rest));
        expect(report.problems, `${id} ${def.name}`).toEqual([]);
      }
    });
  }

  it('every NPC has its idle, talk and greet clips', () => {
    for (const def of Object.values(NPCS)) {
      const names = (NPC_CLIPS[def.id] ?? []).map((c) => c.name);
      for (const clip of [def.idle, def.talk, def.greet].filter(Boolean)) expect(names, `${def.id}: ${clip}`).toContain(clip);
      expect(def.barks.length).toBeGreaterThan(0);
    }
  });
});

describe('town lights', () => {
  it('borrows its lights once while active, gives them back on deactivate', () => {
    let taken = 0;
    let given = 0;
    const lights = { acquire: () => (taken++, { intensity: 0 }), release: () => given++ };
    const engine = { sun: { color: new Color(), intensity: 0 }, ambient: { color: new Color(), intensity: 0 } };
    const town = new Town({ rng: new Rng(1), lights, ctx: { engine } } as unknown as ShellServices);
    town.activate();
    const once = taken;
    expect(once).toBeGreaterThan(0);
    town.activate(); // the title, then the town: still the same lights
    expect(taken).toBe(once);
    town.deactivate();
    expect(given).toBe(once);
    town.activate();
    expect(taken).toBe(once * 2);
  });
});

describe('town layout', () => {
  it('maps screen-space metres onto the 45° iso ground', () => {
    const [x, z] = iso(1, 0); // screen right
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(z).toBeCloseTo(-Math.SQRT1_2);
    const [ux, uz] = iso(0, 1); // up the screen = away from the camera
    expect(ux).toBeCloseTo(-Math.SQRT1_2);
    expect(uz).toBeCloseTo(-Math.SQRT1_2);
  });

  it('pushes circles out of round and turned-box blockers', () => {
    const p = new Vector3(0.1, 0, 0);
    collideBlockers(p, 0.5, [{ kind: 'circle', x: 0, z: 0, r: 1 }]);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.5);
    const q = new Vector3(0, 0, 0.9);
    collideBlockers(q, 0.4, [{ kind: 'box', x: 0, z: 0, hw: 2, hd: 1, rot: Math.PI / 2 }]);
    // turned 90°: the box is 2 long along z and 1 deep along x, so the circle leaves along x
    expect(Math.abs(q.x)).toBeCloseTo(1.4);
    expect(q.z).toBeCloseTo(0.9);
  });

  it('a library model blocks its whole footprint, turned with it and its frame', () => {
    const k = new Kit();
    let len = 0;
    let depth = 0;
    // a 1.6 m log along its x, turned 90° in a frame turned 90° more: it lies along world x,
    // its centre 1 m along the frame's +Z (world +x) from (5, 3)
    k.frame(5, 3, 90, () => {
      [len, , depth] = k.model('log', [0, 0, 1], { yaw: 90 }).bounds.size;
    });
    expect(k.blockers.length).toBe(1);
    // near either end of the log, and beside it, a small circle is pushed off
    for (const [x, z] of [
      [6 + len / 2 - 0.1, 3],
      [6 - len / 2 + 0.1, 3],
      [6, 3 + depth / 2 - 0.05],
    ]) {
      const p = new Vector3(x, 0, z);
      collideBlockers(p, 0.1, k.blockers);
      expect(p.distanceTo(new Vector3(x, 0, z)), `${x}, ${z}`).toBeGreaterThan(0.05);
    }
    // and clear of it, nothing moves
    const free = new Vector3(6, 0, 3 + depth / 2 + 0.2);
    collideBlockers(free, 0.1, k.blockers);
    expect(free.z).toBeCloseTo(3 + depth / 2 + 0.2);
  });

  it('the blocker holds every vertex of an off-centre model at uneven turns, and nothing to spare', () => {
    // the cart's footprint is off its origin; a 30° frame and a 25° turn catch a wrong sign or an unturned centre
    const k = new Kit();
    let object!: Object3D;
    k.frame(-2, 4, 30, () => {
      object = k.model('cart', [0.4, 0, 1.3], { yaw: 25 }).object;
    });
    k.build();
    object.updateWorldMatrix(true, true);
    const b = k.blockers[0]!;
    if (b.kind !== 'box') throw new Error('expected a box blocker');
    // into the box's frame, as collideBlockers does
    const local = (v: Vector3) => {
      const [c, s, dx, dz] = [Math.cos(b.rot), Math.sin(b.rot), v.x - b.x, v.z - b.z];
      return [dx * c - dz * s, dx * s + dz * c] as const;
    };
    let [ex, ez] = [0, 0];
    object.traverse((o) => {
      const pos = (o as Mesh).isMesh ? (o as Mesh).geometry.getAttribute('position') : null;
      for (let i = 0; pos && i < pos.count; i++) {
        const [lx, lz] = local(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
        expect(Math.abs(lx)).toBeLessThanOrEqual(b.hw + 1e-6);
        expect(Math.abs(lz)).toBeLessThanOrEqual(b.hd + 1e-6);
        ex = Math.max(ex, Math.abs(lx));
        ez = Math.max(ez, Math.abs(lz));
      }
    });
    // and it's tight: some vertex reaches each side
    expect(ex).toBeCloseTo(b.hw, 5);
    expect(ez).toBeCloseTo(b.hd, 5);
  });
});

describe('stub level + bot navigation', () => {
  it('generates a connected chain of rooms from start to exit', () => {
    for (const seed of [1, 2, 3, 42]) {
      const L = generateLayout(new Rng(seed), 5);
      expect(L.rooms.length).toBe(5);
      expect(L.cell(L.start.x, L.start.z)).toBe(1);
      expect(L.cell(L.exit.x, L.exit.z)).toBe(1);
      expect(L.path.length).toBeGreaterThan(5);
      expect(bfs(L, L.start, L.exit)).toEqual(L.path);
      // every floor cell is enclosed by walls (no floor on the border)
      for (let x = 0; x < L.width; x++) expect(L.cell(x, 0)).not.toBe(1);
    }
  });

  it('the bot walks the critical path toward the exit and dodges telegraphs', () => {
    const L = generateLayout(new Rng(7), 4);
    const hero = { actor: { position: new Vector3(L.start.x + 0.5, 0, L.start.z + 0.5), radius: 0.4 }, skills: () => [{ slot: 'dodge', id: 'roll', remaining: 0, usable: true }] };
    const exit = new Vector3(L.exit.x + 0.5, 0, L.exit.z + 0.5);
    const level = { layout: L, origin: { x: 0, z: 0 }, exit, exitOpen: false, telegraphs: () => [] as unknown[], monsters: () => [] };
    const bot = new PlaytestBot();
    const v = { hero, level, loot: [], frame: 0 } as unknown as Parameters<PlaytestBot['decide']>[0];
    const i = bot.decide(v);
    const next = L.path[Math.min(3, L.path.length - 1)]!;
    const want = new Vector3(next.x + 0.5 - hero.actor.position.x, 0, next.z + 0.5 - hero.actor.position.z).normalize();
    expect(i.move.x * want.x + i.move.z * want.z).toBeGreaterThan(0.9);
    // a slam about to land on the hero: step away and roll
    (level as { telegraphs: () => unknown[] }).telegraphs = () => [{ at: hero.actor.position.clone().add(new Vector3(0.5, 0, 0)), radius: 1.5, remaining: 0.2 }];
    const d = bot.decide(v);
    expect(d.move.x).toBeLessThan(-0.9);
    expect(d.dodge).toBe(true);
  });
});
