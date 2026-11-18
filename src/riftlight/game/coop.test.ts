// Couch co-op, headless (docs/game/shell.md *Couch co-op*): player 1 on a pad, a second pad joins
// through the pause menu's Couch co-op (all of it pad input, recorded); the guest's hero stands
// beside player 1 at player 1's level, reads its own pad by player 1's rules and never drives
// player 1; the two clear depth 1 together (player 1 the playtest bot, the guest a pad script), and
// the recording replays to the same fingerprint. A save-state is refused while a guest plays. Then
// the town join, the leash, rising after a fall, leaving, and the camera's zoom. One engine, tests in
// order.
import { type Mesh, type MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HUB_COLORS, type GamepadLike, type Recording, TWIN_POLLS } from '../../engine';
import type { Actor } from '../actors/Actor';
import { AIM } from '../actors/aim';
import type { ActorLike } from '../core/types';
import { currentRiftlightApi, type HeadlessRiftlight, headlessRiftlight, hudTexts, makeRiftlight, settle } from '../headless';
import { t } from '../lang';
import { overlaps } from '../ui/layout';
import { project, worldBox } from '../ui/world';
import { COOP } from './coop';
import { cameraBasis } from './controls';

const T = 120_000;
let h: HeadlessRiftlight;

type Pad = { l?: [number, number]; r?: [number, number]; pressed?: number[] };
/** Pads by slot, as the browser lists them: `l` and `r` the sticks (x right, y forward), `pressed` buttons down. */
let pads: (Pad | null)[] = [];
const fake = (p: Pad | null, index: number): GamepadLike | null =>
  p && {
    connected: true,
    mapping: 'standard',
    index,
    axes: [p.l?.[0] ?? 0, -(p.l?.[1] ?? 0), p.r?.[0] ?? 0, -(p.r?.[1] ?? 0)],
    buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: !!p.pressed?.includes(i), value: p.pressed?.includes(i) ? 1 : 0 })),
  };
const setPads = (next: (Pad | null)[]) => {
  pads = next;
  h.engine.input.setGamepads(pads.map(fake));
};
/** Pad `slot`'s button `b` pressed for a frame and let go. */
const tap = (slot: number, b: number) => {
  setPads(pads.map((p, i) => (i === slot ? { ...p, pressed: [b] } : p)));
  h.engine.step(1);
  setPads(pads.map((p, i) => (i === slot ? { ...p, pressed: [] } : p)));
  h.engine.step(1);
};
/**
 * Cross on pad `slot`, held for `TWIN_POLLS` frames and let go: a join (player 1 on a pad, the
 * engine waits `TWIN_POLLS` - 1 polls for a twin's press before it joins: `input.joinWith`).
 */
const join = (slot: number) => {
  setPads(pads.map((p, i) => (i === slot ? { ...p, pressed: [0] } : p)));
  h.engine.step(TWIN_POLLS);
  setPads(pads.map((p, i) => (i === slot ? { ...p, pressed: [] } : p)));
  h.engine.step(1);
};
const focused = () => h.rl.ui.widgets().find((w) => w.focus)?.id;
/** Rings in seat colours under player 1's hero (`seatRing`). */
const p1Rings = () => {
  const out: string[] = [];
  h.game.hero.object.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.geometry?.type === 'RingGeometry') out.push(`#${(m.material as MeshBasicNodeMaterial).color.getHexString()}`);
  });
  return out;
};
const guest = () => h.game.coop.guests[0];

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 717 });
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('couch co-op', () => {
  let rec: Recording;
  let fingerprint = '';
  let guestKills = 0;

  it(
    'a second pad joins through the pause menu (pad input only), its hero beside player 1 at player 1’s level, in seat 2’s colour',
    async () => {
      const { rl, game, engine } = h;
      rl.newRun({ seed: 717 });
      await rl.enterDepth(1);
      engine.step(3);
      setPads([{}, {}]);
      tap(0, 3); // player 1 picks up pad 0
      expect([engine.input.device, engine.input.padIndex]).toEqual(['pad', 0]);
      await engine.restore(await engine.snapshot()); // the recording starts here: player 1 alone
      tap(0, 9); // Options: the pause menu
      expect(rl.ui.stack()).toEqual(['pause']);
      for (let n = 0; n < 12 && focused() !== 'coop'; n++) tap(0, 13); // the d-pad down to Couch co-op
      tap(0, 0); // Cross
      expect(rl.ui.stack()).toEqual(['pause', 'coop']);
      expect(rl.ui.widgets().map((w) => w.id)).toEqual(['seat1', 'seat2', 'seat3', 'seat4', 'g', 'join']);
      tap(0, 0); // player 1's own Cross joins nobody
      expect(game.coop.guests).toEqual([]);
      engine.step(TWIN_POLLS); // past the window a twin's Cross would come in
      join(1); // Cross on pad 1: it joins
      await settle(); // the guest's hero is made (a model already loaded: microtasks)
      expect(game.coop.seats).toEqual([2]);
      expect([...engine.input.joined]).toEqual([1]);
      expect(rl.ui.stack(), 'the press that joined pressed nothing in the menu').toEqual(['pause', 'coop']);
      engine.step(2);
      expect(rl.ui.widgets().map((w) => w.id)).toContain('leave2');
      tap(0, 1); // Circle: back to the pause menu
      tap(0, 1); // Circle: play
      expect(rl.ui.stack()).toEqual([]);
      const g = guest()!;
      expect([g.seat, g.slot, g.color]).toEqual([2, 1, HUB_COLORS[1]]);
      const hero = g.hero!;
      expect(hero.actor.level, 'player 1’s level').toBe(game.save.hero.level);
      expect(hero.actor.position.distanceTo(game.hero.actor.position)).toBeLessThan(COOP.beside + 0.2);
      expect(hero.actor.alive).toBe(true);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the two clear depth 1: player 1 the playtest bot, the guest a pad (its kills count); the recording replays to the same fingerprint',
    async () => {
      const { rl, game, engine } = h;
      const g = guest()!.hero!;
      const off = game.events.on('kill', ({ killer }) => {
        if (killer && killer === g.actor) guestKills++;
      });
      const right = new Vector3();
      const forward = new Vector3();
      rl.bot.start();
      for (let f = 0; f < 60 * 240 && !game.cleared; f++) {
        // the guest: to the nearest monster near player 1, its stick on it, Cross held when close
        cameraBasis(engine, right, forward);
        const gp = g.actor.position;
        const p1 = game.hero.actor.position;
        let best: ActorLike | null = null;
        for (const m of game.level!.actors()) if (m.alive && m.faction === 'monster' && m.position.distanceTo(p1) < 12 && (!best || m.position.distanceTo(gp) < best.position.distanceTo(gp))) best = m;
        const to = (best?.position ?? p1).clone().sub(gp).setY(0);
        const d = to.length();
        const s: [number, number] = d > 0.01 ? [to.dot(right) / d, to.dot(forward) / d] : [0, 0];
        setPads([{}, { l: d > (best ? 1.6 : 2.5) ? s : [0, 0], r: best ? s : [0, 0], pressed: best && d < 3 ? [0] : [] }]);
        rl.bot.advance(1);
      }
      off();
      setPads([{}, {}]);
      engine.step(5);
      expect(game.cleared, 'depth 1 cleared').toBe(true);
      expect(guestKills, 'the guest fought').toBeGreaterThan(0);
      expect([game.save.hero.level > 1, g.actor.level], 'player 1 levelled up, and the guest with them').toEqual([true, game.save.hero.level]);
      expect(game.dead).toBe(false);
      fingerprint = engine.fingerprint();
      expect(game.fingerprint(), 'the guests are in the fingerprint').toContain('coop ');
      rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
      expect(rec.frames.some((f) => f.join?.includes(1)), 'the join is in the recording').toBe(true);
      expect(rec.frames.filter((f) => f.pads).length, 'and the guest’s pad').toBeGreaterThan(100);
      const again = makeRiftlight(game.store, engine.seed);
      await engine.replay(rec, () => engine.loadGame(again));
      expect(engine.fingerprint()).toBe(fingerprint);
      expect(again.coop.seats, 'the replay seated the guest again').toEqual([2]);
      expect(engine.errors).toEqual([]);
      // the replayed game plays on, live (what follows changes the game between frames: not replayable)
      h = { engine, game: again, rl: currentRiftlightApi()! };
    },
    T,
  );

  it('the guest reads its own pad (move, aim assist, attack) and never drives player 1; player 1’s pad never drives the guest', () => {
    const { game, engine, rl } = h;
    game.dev.ai = false;
    for (let f = 0; f < COOP.rise * 60 + 30 && !guest()!.hero!.actor.alive; f++) engine.step(1); // a guest that fell in the fight rises first
    engine.step(30); // player 1 at rest
    const p1 = game.hero.actor.position.clone();
    const g = guest()!.hero!;
    const from = g.actor.position.clone();
    const right = new Vector3();
    const forward = new Vector3();
    cameraBasis(engine, right, forward);
    // its stick away from player 1 (as the screen shows it)
    const away = from.clone().sub(p1).setY(0).normalize();
    setPads([{}, { l: [away.dot(right), away.dot(forward)] }]);
    engine.step(20);
    expect(game.hero.actor.position.distanceTo(p1), 'player 1 stands').toBeLessThan(0.02);
    expect(g.actor.position.clone().sub(from).dot(away), 'the guest walked along its stick').toBeGreaterThan(1.5);
    // its right stick aims with player 1's aim assist: a monster 10° off it is aimed at (on, away
    // from player 1, whose own skills might take it first)
    for (const m of game.level!.monsters()) m.actor.life = 0; // whatever the fight left: out of the way
    engine.step(2);
    const gp = g.actor.position;
    const ang = Math.atan2(away.dot(forward), away.dot(right));
    const r = ang + (10 * Math.PI) / 180;
    const at = gp.clone().addScaledVector(right, Math.cos(r) * 4).addScaledVector(forward, Math.sin(r) * 4);
    const foe = rl.spawn({ seed: 5, x: at.x, z: at.z })!;
    const it = (game.level!.actors() as readonly ActorLike[]).find((a) => a.id === foe.id)!;
    setPads([{}, { r: [Math.cos(ang), Math.sin(ang)] }]);
    engine.step(2);
    expect(it.alive).toBe(true);
    expect(guest()!.intent.aim.distanceTo(it.position), 'aim assist on the guest’s stick').toBeLessThan(1e-6);
    expect(AIM.assist).toBeGreaterThan(10);
    // player 1's pad: player 1 moves, the guest doesn't
    const g0 = g.actor.position.clone();
    setPads([{ l: [0, 1] }, {}]);
    engine.step(10);
    expect(game.hero.actor.position.distanceTo(p1)).toBeGreaterThan(0.5);
    expect(g.actor.position.distanceTo(g0), 'the guest stands').toBeLessThan(0.05);
    setPads([{}, {}]);
    it.life = 0;
    engine.step(2);
    game.dev.ai = true;
    expect(engine.errors).toEqual([]);
  });

  it('a save-state is refused while a guest plays (a couch session replays from its recording)', async () => {
    const { engine, game } = h;
    expect(game.coop.guests.length).toBe(1);
    await expect(engine.snapshot()).rejects.toThrow(/couch co-op/);
  });

  it('the town: another pad joins with Cross while player 1 is on a pad (never on the keyboard), and the town says how', async () => {
    const { rl, game, engine } = h;
    rl.toTown();
    engine.step(5);
    expect(game.coop.guests.map((g) => g.hero?.actor.position.distanceTo(game.hero.actor.position) ?? 99).every((d) => d < COOP.beside + 0.2), 'the guest came along, beside player 1').toBe(true);
    setPads([{}, {}, {}]);
    engine.input.noteDevice('keyboard');
    engine.step(1);
    tap(2, 0); // player 1 on the keyboard: pad 2's Cross is not a join here (the menu is the way)
    expect(game.coop.seats).toEqual([2]);
    tap(0, 3); // player 1 on pad 0
    const said = h.game.ctx.hud;
    let lines: string[] = [];
    const text = said.text.bind(said);
    said.text = (x, y, s, o) => (lines.push(s), text(x, y, s, o));
    engine.step(1);
    said.text = text;
    expect(lines.some((l) => /another controller/.test(l)), 'the town says how to join').toBe(true);
    join(2);
    await settle();
    engine.step(1);
    expect(game.coop.seats).toEqual([2, 3]);
    lines = [];
    expect(engine.errors).toEqual([]);
  });

  it('each seat stands clear on screen (seat 4 well below player 1: no hero’s body or tag over another’s body or ring); player 1 has seat 1’s ring and a P1 tag while guests play', () => {
    const { game, engine } = h;
    engine.step(2);
    const cam = engine.camera.camera;
    const ui = game.ui;
    const where = 'in town';
    const p = game.hero.actor.position.clone();
    const spots = [p, ...[2, 3, 4].map((seat) => game.besideSpot(p, seat))];
    const right = new Vector3();
    const forward = new Vector3();
    cameraBasis(engine, right, forward);
    // each hero from its head down to the front of its ring at its feet (`seatRing`: 0.56 m)
    const bodies = spots.map((at) => {
      const b = worldBox(at, 1.9, 0.9, cam, ui)!;
      const front = project(at.clone().addScaledVector(forward, -0.56), cam, ui)!;
      return { ...b, h: Math.max(b.h, front.y - b.y) };
    });
    const tags = spots.map((at, k) => {
      const c = project(at.clone().setY(at.y + 2.3), cam, ui)!;
      const w = ui.measure(t('hud.coop.seat', { seat: k + 1 }));
      return { x: c.x - Math.floor(w / 2), y: c.y, w: w + 1, h: 8 };
    });
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        expect(overlaps(bodies[i]!, bodies[j]!, 0), `${where}: P${i + 1}'s body ${JSON.stringify(bodies[i])} over P${j + 1}'s ${JSON.stringify(bodies[j])}`).toBe(false);
        expect(overlaps(tags[i]!, bodies[j]!, 0), `${where}: P${i + 1}'s tag ${JSON.stringify(tags[i])} over P${j + 1}'s body or ring ${JSON.stringify(bodies[j])}`).toBe(false);
      }
    expect(p1Rings(), 'player 1’s ring in seat 1’s colour').toEqual([HUB_COLORS[0]]);
    expect(hudTexts(engine).map((x) => x.text), 'a tag over every hero').toEqual(expect.arrayContaining(['P1', 'P2', 'P3']));
    expect(engine.errors).toEqual([]);
  });

  it('a straggler past the leash comes back beside player 1; a fallen guest rises beside player 1; the camera zooms out to its cap', () => {
    const { game, engine } = h;
    const third = game.coop.guests.find((g) => g.seat === 3)!.hero!;
    // pushed far off (a knock-back, a blink): back beside player 1 on the next step
    third.snap!(game.hero.actor.position.clone().add(new Vector3(COOP.leash + 3, 0, 0)), 0);
    engine.step(1);
    expect(third.actor.position.distanceTo(game.hero.actor.position)).toBeLessThan(COOP.beside + 0.2);
    // down: it lies until COOP.rise s, then rises beside player 1
    (third.actor as Actor).die(null, true);
    engine.step(Math.ceil(COOP.rise * 60) - 30);
    expect(third.actor.alive).toBe(false);
    expect(game.coop.strips().find((s) => s.seat === 3)!.rise).toBeGreaterThan(0);
    engine.step(40);
    expect(third.actor.alive).toBe(true);
    // the camera keeps everyone in view: it zooms out as they spread up the screen (its short side
    // here), down to its cap; a 16:9 view holds a long spread across as it is
    expect(game.coop.zoom()).toBe(1);
    const second = game.coop.guests.find((g) => g.seat === 2)!.hero!;
    const right = new Vector3();
    const forward = new Vector3();
    cameraBasis(engine, right, forward);
    const p1 = game.hero.actor.position.clone();
    second.snap!(p1.clone().addScaledVector(right, 9), 0);
    expect(game.coop.zoom(), 'across: in view as it is').toBe(1);
    second.snap!(p1.clone().addScaledVector(forward, 12), 0);
    expect(game.coop.zoom()).toBeLessThan(1);
    expect(game.coop.zoom()).toBeGreaterThan(COOP.zoomOut);
    second.snap!(p1.clone().addScaledVector(forward, 40), 0);
    expect(game.coop.zoom(), 'no farther than its cap').toBe(COOP.zoomOut);
    engine.step(1);
    expect(second.actor.position.distanceTo(game.hero.actor.position), 'and the leash brings it back').toBeLessThan(COOP.beside + 0.2);
    expect(engine.errors).toEqual([]);
  });

  it('a guest leaves from the Couch co-op menu; the title sends everyone home', () => {
    const { rl, game, engine } = h;
    rl.press('Escape');
    rl.ui.click('coop');
    engine.step(1);
    expect(rl.ui.widgets().map((w) => w.id)).toEqual(expect.arrayContaining(['leave2', 'leave3']));
    rl.ui.click('leave2');
    engine.step(1);
    expect([game.coop.seats, [...engine.input.joined]]).toEqual([[3], [2]]);
    rl.ui.close();
    rl.ui.close();
    engine.step(1);
    rl.toTitle();
    engine.step(1);
    expect([game.coop.guests.length, [...engine.input.joined]]).toEqual([0, []]);
    expect(p1Rings(), 'alone: player 1’s ring goes').toEqual([]);
    expect(engine.errors).toEqual([]);
  });
});
