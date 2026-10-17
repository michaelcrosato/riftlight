/**
 * Save-state tests' driver (`snapshot*.test.ts`, docs/game/save-states.md): Riftlight played by
 * input headless (the stick, the pointer, buttons and keys through `engine.input`'s hooks), a
 * snapshot kept as JSON, and where two snapshots differ. What the e2e suite riftlight-snapshot
 * drove in a page (`window.__SNAP__`), for Node.
 */
import type { Vector3 } from 'three/webgpu';
import type { Engine, Snapshot } from '../../engine';
import type { Actor } from '../actors/Actor';
import type { LevelStage } from '../wire/levels';
import type { RealHero } from '../wire/hero';
import type { CombatWorld } from '../wire/world';
import type { RiftlightApi } from './api';
import type { Riftlight } from './Riftlight';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentRiftlightApi, type HeadlessRiftlight, headlessRiftlight, makeRiftlight, settle } from '../headless';

/**
 * Pictures only, compared right after a restore but not after playing on: a monster's look-at
 * mid cross-fade, and the hero's drawn pose (a restore lets planted feet go, so the stride may
 * settle a few frames differently; nothing in play reads it).
 */
export const PICTURE = /\.body\.look|\.hc\.animator|\.hc\.drawn/;

export class SnapDriver {
  constructor(readonly e: Engine) {}

  get game(): Riftlight {
    return this.e.game as Riftlight;
  }
  get api(): RiftlightApi {
    return currentRiftlightApi()!;
  }
  /** The real hero behind the port. */
  get hero(): RealHero {
    return this.game.hero as RealHero;
  }
  get actor(): Actor {
    return this.hero.actor;
  }
  /** The level now, as the wire builds it (null in town). */
  get level(): LevelStage | null {
    return this.game.level as LevelStage | null;
  }
  /** The combat world the hero fights in (the town's or the level's). */
  get heroWorld(): CombatWorld | null {
    return (this.hero as unknown as { world: CombatWorld | null }).world;
  }

  /** A new Riftlight on the same saves (a page's `__PIXEL_GAMES__.riftlight()`). */
  fresh = (): Promise<void> => this.e.loadGame(makeRiftlight(this.game.store, this.e.seed)); // the page's seed, as a reload's game

  /** Play `frames` by input: the stick in a slow loop, the pointer circling ahead, a swing, a skill. */
  play(frames: number, phase: number, prints: string[] | null = null): void {
    const { e } = this;
    const I = e.input;
    for (let f = 0; f < frames; f++) {
      if (prints && f % 30 === 0) prints.push(e.fingerprint());
      const a = (f + phase) * 0.021;
      I.analog.x = Math.cos(a);
      I.analog.y = Math.sin(a * 1.3);
      I.setPointer(0.35 * Math.cos(a * 2), 0.3 * Math.sin(a * 2));
      I.setButtons(f % 50 < 6 ? 1 : 0);
      I.setKey('Digit1', f % 140 === 70);
      e.step(1);
    }
    I.analog.x = I.analog.y = 0;
    I.setButtons(0);
    I.setKey('Digit1', false);
    e.step(1);
  }

  /** The pointer over a world point (normalised device coordinates through the camera). */
  pointAt(p: Vector3): void {
    const v = p.clone().setY(p.y + 0.6).project(this.e.camera.camera);
    this.e.input.setPointer(Math.max(-0.98, Math.min(0.98, v.x)), Math.max(-0.98, Math.min(0.98, v.y)));
  }

  /** The stick toward world (dx, dz), through the camera's ground basis. */
  stickToward(dx: number, dz: number): void {
    const m = this.e.camera.camera.matrixWorld.elements;
    const n = (x: number, z: number): [number, number] => {
      const l = Math.hypot(x, z) || 1;
      return [x / l, z / l];
    };
    const [rx, rz] = n(m[0]!, m[2]!);
    const [fx, fz] = n(-m[8]!, -m[10]!);
    const d = Math.hypot(dx, dz) || 1;
    this.e.input.analog.x = (dx * rx + dz * rz) / d;
    this.e.input.analog.y = (dx * fx + dz * fz) / d;
  }

  /**
   * Fight `frames` by input, deciding from what the game shows only (no memory of its own, so a
   * restored game is driven the same way): the pointer on the nearest monster, the stick to it (or
   * to the exit when none is near), the left button held in reach, a right click, the second and
   * third skills and a dodge now and then.
   */
  fight(frames: number, phase = 0): void {
    const { e } = this;
    const I = e.input;
    for (let f = 0; f < frames; f++) {
      const g = this.game;
      const hp = g.hero.actor.position;
      const ms = (g.level?.monsters() ?? []).filter((m) => m.actor.alive);
      const m = ms.length ? ms.reduce((a, b) => (a.actor.position.distanceTo(hp) <= b.actor.position.distanceTo(hp) ? a : b)) : null;
      const d = m ? m.actor.position.distanceTo(hp) : Infinity;
      if (m && d < 14) {
        this.pointAt(m.actor.position);
        if (d > 1.8) this.stickToward(m.actor.position.x - hp.x, m.actor.position.z - hp.z);
        else I.analog.x = I.analog.y = 0;
      } else if (g.level) {
        const x = g.level.exit;
        this.pointAt(x);
        this.stickToward(x.x - hp.x, x.z - hp.z);
      }
      const k = (f + phase) % 240;
      I.setButtons((k === 60 ? 2 : 0) | (d < 2.6 ? 1 : 0));
      I.setKey('Digit2', k === 120);
      I.setKey('Digit3', k === 180);
      I.setKey('Space', k === 200 && d < 3);
      e.step(1);
    }
    I.analog.x = I.analog.y = 0;
    I.setButtons(0);
    for (const c of ['Digit2', 'Digit3', 'Space']) I.setKey(c, false);
    e.step(1);
  }

  /** Press a key for one frame, then let go for `after` frames. */
  tap(code: string, after = 2): void {
    this.e.input.setKey(code, true);
    this.e.step(1);
    this.e.input.setKey(code, false);
    this.e.step(after);
  }

  /** Into a depth (the level builds in promise callbacks). */
  async enter(depth: number, tries = 60): Promise<void> {
    const entering = this.game.enterDepth(depth);
    for (let k = 0; k < tries && this.game.screen !== 'level'; k++) {
      await settle();
      this.e.step(1);
    }
    await entering;
    this.e.step(2);
  }

  /** A new run in town (the page's start of each part), in a fresh Riftlight unless the one booted just now. */
  async newRun(slot: number, seed: number, fresh = true): Promise<void> {
    if (fresh) await this.fresh();
    await settle();
    this.api.newRun({ slot, seed });
    this.e.step(3);
    await settle();
    this.e.step(3);
  }

  /** A snapshot through JSON, as it would be kept. */
  take = async (): Promise<Snapshot> => JSON.parse(JSON.stringify(await this.e.snapshot())) as Snapshot;

  /** The error a promise rejects with ('' when it resolves). */
  static refusal(p: Promise<unknown>): Promise<string> {
    return p.then(
      () => '',
      (err: Error) => err.message,
    );
  }
}

/** Where two snapshots differ (the first few paths; `ignore`: paths that are pictures only). */
export function snapDiff(a: Snapshot, b: Snapshot, ignore: RegExp | null = null): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string): void => {
    if (out.length > 6 || (ignore && ignore.test(path))) return;
    if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) {
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}: ${JSON.stringify(x)?.slice(0, 60)} vs ${JSON.stringify(y)?.slice(0, 60)}`);
      return;
    }
    const xs = x as Record<string, unknown>;
    const ys = y as Record<string, unknown>;
    for (const key of new Set([...Object.keys(xs), ...Object.keys(ys)])) walk(xs[key], ys[key], `${path}.${key}`);
  };
  walk({ ...a, engine: 0 }, { ...b, engine: 0 }, '');
  return out;
}

/** A depth's mid-fight snapshot, restored and played on (`levelRow`). */
export interface LevelRow {
  depth: number;
  label: string;
  snap: Snapshot;
  kb: number;
  effects: number;
  monsters: number;
  /** The fingerprint 180 frames of fighting on from the snapshot. */
  went: string;
  restored: string;
  /** How long the restore took (the level is built again), in ms. */
  ms: number;
  /** Where the snapshot just after the restore differs from the one restored. */
  diff: string[];
  /** Where the whole state differs after playing on the same way (pictures aside). */
  played: string[];
}

/**
 * Into `depth`, a rare and a magic monster spawned beside the hero, a fight by input, a snapshot
 * mid-fight with effects in flight, played on; restored (the level built again) and played on
 * the same way.
 */
export async function levelRow(d: SnapDriver, depth: number): Promise<LevelRow> {
  const e = d.e;
  await d.enter(depth);
  const L = d.level!;
  const hp = d.actor.position;
  L.spawn(1000 + depth, hp.clone().set(hp.x + 4, hp.y, hp.z + 1), 'rare');
  L.spawn(2000 + depth, hp.clone().set(hp.x - 3, hp.y, hp.z + 3), 'magic');
  d.fight(150, depth * 7);
  const label = `depth ${depth} (${L.spec.theme}, ${L.spec.mechanics.join('+')})`;
  const snap = await d.take();
  const effects = L.world.combat.effects.length;
  const monsters = L.monsters().length;
  d.fight(180, 999);
  const went = e.fingerprint();
  const wentSnap = await d.take();
  const t0 = performance.now(); // real time: how long a level restore takes
  await e.restore(snap);
  const ms = Math.round(performance.now() - t0); // real time: the restore measured above
  const diff = snapDiff(snap, await d.take());
  d.fight(180, 999);
  const restored = e.fingerprint();
  // everything, not only the fingerprint, after playing on (a monster's look-at mid cross-fade is a picture)
  const played = snapDiff(wentSnap, await d.take(), PICTURE);
  return { depth, label, snap, kb: +(JSON.stringify(snap).length / 1024).toFixed(1), effects, monsters, went, restored, ms, diff, played };
}

/**
 * The mid-fight tests of `depths` (a file each few depths: one engine per file, ~15 s): a new run
 * (god mode: a new hero lives through every depth, the same in every run since the snapshot keeps
 * it), each depth restored mid-fight and played on the same way, then effects in flight among
 * them (`effects`: where the depths have some), the slowest restore, and no game errors. `then`
 * runs further tests on the same engine.
 */
export function describeDepths(depths: readonly number[], o: { effects?: boolean; then?: (s: { d: () => SnapDriver; rows: LevelRow[] }) => void } = {}): void {
  const T = 60_000; // a depth's fight, snapshot and restores: seconds alone, more while the whole suite runs
  let h: HeadlessRiftlight;
  let d: SnapDriver;
  const rows: LevelRow[] = [];
  beforeAll(async () => {
    h = await headlessRiftlight({ seed: 4242 });
    d = new SnapDriver(h.engine);
    await d.newRun(2, 4242, false);
    d.game.dev.god = true;
  }, T);
  afterAll(() => h?.engine.dispose());

  describe(`Riftlight save-states mid-fight, depths ${depths.join(', ')}`, () => {
    for (const depth of depths) {
      it(
        `depth ${depth}: restored mid-fight, it plays on the same (fingerprint and state)`,
        async () => {
          const r = await levelRow(d, depth);
          rows.push(r);
          expect(r.diff, `${r.label}: the snapshot after the restore`).toEqual([]);
          expect(r.restored, `${r.label}: ${r.monsters} monsters, ${r.effects} effects in flight, ${r.kb} KB`).toBe(r.went);
          expect(r.played, `${r.label}: 180 frames on, the state`).toEqual([]);
        },
        T,
      );
    }

    it('a level restores in under 10 s (it is built again), with no game errors', () => {
      // real time: building a level again, against a pathological slowdown (the page's budget was
      // 2 s): ~1 s alone, 3-4 s with every test file running at once
      expect(Math.max(...rows.map((r) => r.ms)), 'slowest restore, ms').toBeLessThan(10_000);
      expect(d.e.state().errors).toEqual([]);
    });

    if (o.effects) {
      it('snapshots taken with combat effects in flight', () => {
        expect(rows.some((r) => r.effects > 0), rows.map((r) => `${r.label}: ${r.effects}`).join('; ')).toBe(true);
      });
    }

    o.then?.({ d: () => d, rows });
  });
}
