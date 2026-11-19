// Riftlight's motion aim, headless, through a fake 52in1 whose DualSense the test turns: Settings →
// Controller has Motion aim and its sensitivity while 52in1 lets games read the controller's
// motion; on the pad, turning the controller turns the aim (left turns it left) and it stays where
// it was turned, the right stick still sets it outright, the aim assist still snaps it to a monster
// near its line, it lets go `AIM.hold` s after the last turn; off, or on the keyboard, a turn does
// nothing; and a recording replays to the same aim, frame for frame. One engine, tests in order.
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HubSettingsSource, Recording } from '../../engine';
import { AIM } from '../actors/aim';
import type { ActorLike } from '../core/types';
import { type HeadlessRiftlight, headlessRiftlight, makeRiftlight } from '../headless';
import type { Riftlight } from './Riftlight';
import { cameraBasis } from './controls';

const T = 60_000;
let h: HeadlessRiftlight;

/** A 52in1 whose DualSense's gyro the test sets (degrees a second: `y` + turns it left), its motion open to games, its own Motion aim on. */
function movingHub() {
  const now = { gyro: { x: 0, y: 0, z: 0 } };
  const dualsense = { connected: true, lightbar: false, triggers: false, motion: true, touchpad: false, speaker: false, aim: true };
  Object.defineProperty(dualsense, 'gyro', { enumerable: true, get: () => now.gyro });
  Object.defineProperty(dualsense, 'touches', { enumerable: true, get: () => [] });
  const target = Object.assign(new EventTarget(), { dualsense });
  return { source: target as HubSettingsSource, target, now, dualsense };
}
const hub = movingHub();

/** A pad in the standard layout, its right stick at `r` (y down, as the Gamepad API has it). */
const pad = (r: [number, number] = [0, 0], pressed: number[] = []) => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, ...r], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
type Inside = { intent: { aim: Vector3 }; motionAim: { x: number; z: number; idle: number } | null; readIntent(...a: unknown[]): unknown };
const inside = (game: Riftlight = h.game) => game as unknown as Inside;
const right = new Vector3();
const forward = new Vector3();
/** Where the hero aims, as the screen shows it: degrees from the screen's right, counter-clockwise (90 = up the screen). */
const angle = (game: Riftlight = h.game) => {
  cameraBasis(h.engine, right, forward);
  const d = inside(game).intent.aim.clone().sub(game.hero.actor.position);
  return (Math.atan2(d.dot(forward), d.dot(right)) * 180) / Math.PI;
};
/** `a` - `b` in degrees, wrapped to -180..180. */
const turned = (a: number, b: number) => ((((a - b + 540) % 360) + 360) % 360) - 180;
/** The controller turning at `y` degrees a second (+ left) for `frames` frames. */
const turn = (y: number, frames: number) => {
  hub.now.gyro = { x: 0, y, z: 0 };
  h.engine.step(frames);
  hub.now.gyro = { x: 0, y: 0, z: 0 };
};
/** Degrees the aim turns for `frames` frames at `y` degrees a second (past the still hand's 4, at sensitivity 1). */
const expected = (y: number, frames: number) => Math.sign(y) * (Math.abs(y) - 4) * (frames / 60) * AIM.gyro;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 616, options: { hubSettings: hub.source } });
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('motion aim in Riftlight', () => {
  it('Settings → Controller has Motion aim and its sensitivity while 52in1 lets games read a DualSense’s motion', () => {
    const { rl, engine } = h;
    const ids = () => rl.ui.widgets().map((w) => w.id);
    expect(engine.input.motion, 'on, as 52in1’s own Motion aim is; leaning no stick').toEqual({ on: true, sensitivity: 1, lean: false });
    rl.ui.click('settings');
    engine.step(1);
    expect(ids(), 'the Settings list: the Controller page').toContain('controller');
    expect(ids()).not.toContain('motion');
    expect(engine.renderer.resolution, 'the art of a 1920×1080 screen').toEqual({ width: 480, height: 270 });
    expect(rl.ui.widgets().filter((w) => !w.rect).map((w) => w.id), 'every row in view, none behind a ▼').toEqual([]);
    rl.ui.click('controller');
    engine.step(1);
    expect(ids()).toEqual(['padGlyphs', 'vibration', 'motion', 'motionSensitivity', 'voice', 'voiceSensitivity']); // and the voice (voice.test.ts)
    expect(rl.ui.widgets().filter((w) => !w.rect).map((w) => w.id), 'the Controller page: every row in view at 1920×1080').toEqual([]);
    rl.ui.click('motion');
    expect([engine.settings.values.motion, engine.input.motion.on]).toEqual([false, false]);
    rl.ui.click('motion');
    expect([engine.settings.values.motion, engine.input.motion.on]).toEqual([true, true]);
    rl.ui.click('motionSensitivity');
    expect([engine.settings.values.motionSensitivity, engine.input.motion.sensitivity]).toEqual([1.25, 1.25]);
    engine.settings.set({ motionSensitivity: undefined });
    // 52in1 stops letting games read the controller's motion: the rows go
    hub.dualsense.motion = false;
    hub.target.dispatchEvent(new Event('change'));
    engine.step(1);
    expect(ids()).not.toContain('motion');
    expect(ids()).not.toContain('motionSensitivity');
    expect(engine.input.motion.on).toBe(false);
    hub.dualsense.motion = true;
    hub.target.dispatchEvent(new Event('change'));
    engine.step(1);
    expect(ids()).toContain('motion');
    rl.ui.close();
    rl.ui.close();
    engine.step(1);
    expect(engine.errors).toEqual([]);
  });

  it(
    'turning the controller turns the aim and it stays; the stick sets it outright; the assist snaps it; it lets go after a while; off or on the keyboard nothing turns',
    async () => {
      const { rl, game, engine } = h;
      rl.newRun({ seed: 616 });
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false; // the monsters stand where they are put
      game.dev.god = true;
      for (const m of game.level!.monsters()) m.actor.life = 0; // the level's own pack: out of the way
      engine.step(2);
      engine.input.setGamepads([pad()]);
      engine.input.noteDevice('pad');
      engine.step(2);
      expect(inside().motionAim, 'not steering until the controller turns').toBeNull();
      const a0 = angle();
      turn(-64, 30); // right, 60° past still a second for half a second: the aim turns 60° clockwise
      expect(turned(angle(), a0)).toBeCloseTo(expected(-64, 30), 3);
      expect(inside().intent.aim.distanceTo(game.hero.actor.position), 'nobody near the line: its reach along it').toBeCloseTo(AIM.reach, 3);
      const a1 = angle();
      turn(2, 60); // a hand holding still (under 4° a second): it stays where it was turned
      expect(turned(angle(), a1)).toBeCloseTo(0, 6);
      turn(34, 30); // left: 30° the other way
      expect(turned(angle(), a1)).toBeCloseTo(expected(34, 30), 3);
      // motion aim off: a turn does nothing
      engine.settings.set({ motion: false });
      const a2 = angle();
      turn(-200, 20);
      expect(turned(angle(), a2), 'off').toBeCloseTo(0, 6);
      engine.settings.set({ motion: true });
      // the right stick sets the direction outright, and motion aim turns on from there
      const stick = (deg: number, frames = 3) => {
        const r = (deg * Math.PI) / 180;
        engine.input.setGamepads([pad([Math.cos(r) * 0.9, -Math.sin(r) * 0.9])]);
        engine.step(frames);
      };
      stick(200);
      expect(turned(angle(), 200)).toBeCloseTo(0, 3);
      engine.input.setGamepads([pad()]);
      turn(-64, 1); // let go: it keeps the stick's direction (a frame of turn: 2°)
      expect(turned(angle(), 200)).toBeCloseTo(expected(-64, 1), 3);
      // while the stick leans, its direction wins over a turn
      stick(120, 2);
      hub.now.gyro = { x: 0, y: -200, z: 0 };
      engine.step(2);
      hub.now.gyro = { x: 0, y: 0, z: 0 };
      expect(turned(angle(), 120)).toBeCloseTo(0, 3);
      engine.input.setGamepads([pad()]);
      engine.step(1);
      // the aim assist: a monster 10° off the kept line, 4 m out, is aimed at
      cameraBasis(engine, right, forward);
      const p = game.hero.actor.position;
      const at = (deg: number, m: number) => {
        const r = (deg * Math.PI) / 180;
        return p.clone().addScaledVector(right, Math.cos(r) * m).addScaledVector(forward, Math.sin(r) * m);
      };
      const near = rl.spawn({ seed: 9, x: at(130, 4).x, z: at(130, 4).z })!;
      engine.step(2);
      const foe = () => (game.level!.actors() as readonly ActorLike[]).find((x) => x.id === near.id)!;
      expect(inside().intent.aim.distanceTo(foe().position), 'snapped to the monster').toBeLessThan(1e-6);
      foe().life = 0;
      engine.step(2);
      // left alone, it lets go after AIM.hold s: the cone auto-aim again
      expect(inside().motionAim).not.toBeNull();
      engine.step(Math.ceil(AIM.hold * 60) + 2);
      expect(inside().motionAim, 'let go').toBeNull();
      // the keyboard: a turn does nothing (the pad is not in use)
      turn(-64, 2);
      expect(inside().motionAim).not.toBeNull();
      engine.input.noteDevice('keyboard');
      engine.step(1);
      expect([engine.input.device, inside().motionAim]).toEqual(['keyboard', null]);
      const a3 = angle();
      turn(-200, 20);
      expect([turned(angle(), a3), inside().motionAim]).toEqual([0, null]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'motion aim turned off lets go of the kept direction (the Settings row, or 52in1); so do a new run, a load, a level, town, a death; a panel open stops a turn turning it',
    async () => {
      const { rl, game, engine } = h;
      engine.input.setGamepads([pad()]);
      engine.input.noteDevice('pad');
      engine.step(1);
      /** The controller turned: motion aim keeps a direction. */
      const steer = () => {
        turn(-64, 5);
        expect(inside().motionAim, 'steering').not.toBeNull();
      };
      /** Cross pressed and let go `n` times, a second apart: an attack each time. */
      const crosses = (n: number) => {
        for (let k = 0; k < n; k++) {
          engine.input.setGamepads([pad([0, 0], [0])]);
          engine.step(2);
          engine.input.setGamepads([pad()]);
          engine.step(58);
        }
      };
      // off in the Settings menu: let go, and attacks never bring it back
      steer();
      expect(rl.ui.open('settings')).toBe(true);
      rl.ui.click('controller');
      rl.ui.click('motion');
      expect(engine.input.motion.on).toBe(false);
      rl.ui.close();
      rl.ui.close();
      engine.step(2);
      expect(inside().motionAim, 'let go when motion aim went off').toBeNull();
      crosses(8);
      turn(-200, 10);
      expect(inside().motionAim, 'off: nothing turns').toBeNull();
      engine.settings.set({ motion: undefined });
      // 52in1 stops letting games read the controller's motion: the same
      steer();
      hub.dualsense.motion = false;
      hub.target.dispatchEvent(new Event('change'));
      engine.step(2);
      expect([engine.input.motion.on, inside().motionAim]).toEqual([false, null]);
      hub.dualsense.motion = true;
      hub.target.dispatchEvent(new Event('change'));
      engine.step(1);
      // a panel open (the inventory: the world plays on under it): a turn browses, it doesn't aim
      expect(rl.ui.open('inventory')).toBe(true);
      turn(-64, 10);
      expect(inside().motionAim, 'under the inventory').toBeNull();
      rl.ui.close();
      engine.step(1);
      // a death, town, a level, a new run, a load: each starts without the old line
      steer();
      (game.hero.actor as unknown as { die(): void }).die();
      engine.step(2);
      expect([game.dead, inside().motionAim], 'dead').toEqual([true, null]);
      rl.toTown();
      engine.step(2);
      steer();
      await rl.enterDepth(1);
      engine.step(1);
      expect(inside().motionAim, 'into a level').toBeNull();
      steer();
      rl.toTown();
      expect(inside().motionAim, 'into town').toBeNull();
      engine.step(1);
      steer();
      rl.save();
      rl.newRun({ seed: 616 });
      expect(inside().motionAim, 'a new run').toBeNull();
      engine.step(1);
      steer();
      expect(rl.load()).toBe(true);
      expect(inside().motionAim, 'a load').toBeNull();
      // back where the next test starts: depth 1, the monsters out of the way
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false;
      game.dev.god = true;
      for (const m of game.level!.monsters()) m.actor.life = 0;
      engine.step(2);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a save-state taken while steering, restored with motion aim off, lets go of the kept direction (Cross never keeps it alive)',
    async () => {
      const { engine } = h;
      engine.input.setGamepads([pad()]);
      engine.input.noteDevice('pad');
      engine.settings.set({ motion: undefined });
      turn(-64, 10);
      expect(inside().motionAim, 'steering').not.toBeNull();
      const steering = await engine.snapshot();
      engine.settings.set({ motion: false });
      engine.step(2);
      expect(inside().motionAim, 'off: let go').toBeNull();
      await engine.restore(steering);
      expect([inside().motionAim !== null, engine.input.motion.on], 'the save-state keeps the line; motion aim stays off').toEqual([true, false]);
      // Cross attacks along the kept line, which would keep it from letting go `AIM.hold` s on
      for (let k = 0; k < 3; k++) {
        engine.input.setGamepads([pad([0, 0], [0])]);
        engine.step(2);
        engine.input.setGamepads([pad()]);
        engine.step(10);
      }
      expect(inside().motionAim, 'let go: motion aim is off').toBeNull();
      engine.settings.set({ motion: undefined });
      engine.step(1);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a recording replays to the same aim, frame for frame, from a snapshot taken mid-turn',
    async () => {
      const { game, engine, rl } = h;
      engine.input.setGamepads([pad()]);
      engine.input.noteDevice('pad');
      turn(-64, 10);
      // a monster 12° off the line the controller keeps: the aim is on it, the kept line is not
      const kept = inside().motionAim!;
      cameraBasis(engine, right, forward);
      const line = Math.atan2(kept.x * forward.x + kept.z * forward.z, kept.x * right.x + kept.z * right.z) + (12 * Math.PI) / 180;
      const p = game.hero.actor.position;
      const at = p.clone().addScaledVector(right, Math.cos(line) * 4).addScaledVector(forward, Math.sin(line) * 4);
      const foe = rl.spawn({ seed: 11, x: at.x, z: at.z })!;
      engine.step(2);
      expect(inside().intent.aim.distanceTo((game.level!.actors() as readonly ActorLike[]).find((x) => x.id === foe.id)!.position), 'on the monster').toBeLessThan(1e-6);
      expect(inside().motionAim, 'steering when the recording starts').not.toBeNull();
      const steering = { ...inside().motionAim };
      await engine.restore(await engine.snapshot()); // the recording starts at this moment
      expect(inside().motionAim, 'a save-state keeps motion aim’s line').toEqual(steering);
      /** Every aim the hero is handed, in order. */
      const watch = (g: Riftlight) => {
        const aims: number[][] = [];
        const own = inside(g).readIntent.bind(g);
        inside(g).readIntent = (...a: unknown[]) => {
          const out = own(...a);
          aims.push(inside(g).intent.aim.toArray());
          return out;
        };
        return aims;
      };
      const live = watch(game);
      turn(-64, 20);
      turn(90, 10);
      engine.input.setGamepads([pad([0.9, 0])]);
      engine.step(4);
      engine.input.setGamepads([pad([0, 0], [0])]); // Cross: attack along it
      turn(-40, 6);
      engine.input.setGamepads([pad()]);
      turn(50, 12);
      // motion aim off for a moment (it lets go of the line), and on again
      engine.settings.set({ motion: false });
      engine.step(3);
      expect(inside().motionAim, 'off: let go').toBeNull();
      engine.settings.set({ motion: undefined });
      turn(-30, 8);
      engine.step(5);
      const fingerprint = engine.fingerprint();
      const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
      expect(rec.frames.filter((f) => f.turn).length, 'the turns are in the recording').toBeGreaterThan(40);
      const again = makeRiftlight(game.store, engine.seed);
      let replayed: number[][] = [];
      await engine.replay(rec, async () => {
        await engine.loadGame(again);
        replayed = watch(again);
      });
      expect(replayed).toEqual(live);
      expect(engine.fingerprint()).toBe(fingerprint);
      expect(inside(again).motionAim).toEqual(inside(game).motionAim);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
