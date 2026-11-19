// R2's latch, headless through a fake 52in1: R2 is interact, so a DualSense's R2 pushes back and
// gives way (`LATCH`, an adaptive trigger) while there is something to interact with on the pad (the
// stash, a townsperson, loot, the portal), and holds through the pull that used it, R2 read as a
// browser reads it (pressed early in its travel): it lets go once R2 is up. It lets go walking away,
// in a panel or the pause, in photo mode, loading, off the pad, with the DualSense in a couch guest's
// hands, on the title, dead, while a save-state restores and in a session round. The engine is asked
// only when it changes; a replay sends none, and the latch goes out the first live frame after one.
// One engine for the play's tests, in order; a session round has its own.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type HubSettingsSource, HubSession, LocalHub, type Recording, type TriggerEffect } from '../../engine';
import type { Item } from '../core/types';
import type { RealLoot } from '../wire/loot';
import { currentRiftlightApi, type HeadlessRiftlight, headlessRiftlight, makeRiftlight, settle } from '../headless';
import { t } from '../lang';
import { LATCH, PRESS } from './padFeel';
import { Riftlight } from './Riftlight';
import { SaveStore } from './save';

const T = 30_000;

/** A fake 52in1 with a DualSense open to games: what its triggers were sent goes in `sent`, in order. */
const fakeHub = (sent: [string, TriggerEffect | null][]): HubSettingsSource => ({ dualsense: { connected: true, lightbar: true, triggers: true, motion: false, touchpad: false, speaker: false, aim: false, light: () => {}, trigger: (which: string, effect: TriggerEffect | null) => void sent.push([which, effect]) } as never });
/** R2 as the controller has it: the last effect `sent` to the right trigger or both, null when let go. */
const right = (sent: [string, TriggerEffect | null][]): TriggerEffect | null => [...sent].reverse().find(([which]) => which !== 'left')?.[1] ?? null;
/**
 * A pad in the standard layout: the left stick `l`, `pressed` buttons down, R2 at `rt` of its
 * travel, pressed past `PRESS` as a browser has it (Chrome: 30/255).
 */
const pad = (pressed: number[] = [], l: [number, number] = [0, 0], rt = 0) => ({
  connected: true,
  mapping: 'standard',
  index: 0,
  axes: [...l, 0, 0],
  buttons: Array.from({ length: 18 }, (_, i) => (i === 7 && !pressed.includes(i) ? { pressed: rt > PRESS, value: rt } : { pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});
/** R2 pulled all the way in 0.05 steps, a frame each, and let go the same way. */
const RAMP = [...Array.from({ length: 20 }, (_, i) => (i + 1) / 20), ...Array.from({ length: 20 }, (_, i) => (19 - i) / 20)];

describe('R2’s latch', () => {
  let h: HeadlessRiftlight;
  const sent: [string, TriggerEffect | null][] = [];
  const r2 = () => right(sent);
  /** Pad button `b` pressed for a frame and let go. */
  const tap = (b: number) => {
    h.engine.input.setGamepads([pad([b])]);
    h.engine.step(1);
    h.engine.input.setGamepads([pad()]);
    h.engine.step(1);
  };
  /**
   * R2 pulled all the way and let go (`RAMP`) on the pad: the R2 value whose frame `done` first held
   * (the press registered), and each frame R2 was let go, with its value and whether it was coming up.
   */
  const pull = (done: () => boolean) => {
    h.engine.input.noteDevice('pad');
    let fired: number | null = null;
    const letGo: { rt: number; up: boolean }[] = [];
    RAMP.forEach((rt, i) => {
      h.engine.input.setGamepads([pad([], [0, 0], rt)]);
      h.engine.step(1);
      if (fired === null && done()) fired = rt;
      if (r2() === null) letGo.push({ rt, up: i >= 20 });
    });
    return { fired, letGo: letGo[0] ?? null };
  };
  /** Where R2 lets go of a full pull: the first frame it is up again (`PRESS` or less, coming up). */
  const UP = { rt: RAMP.find((rt, i) => i >= 20 && rt <= PRESS)!, up: true };
  const stack = () => h.rl.state().ui;
  let drops = 0;
  /** A rare belt on the ground at the hero's feet, landed (a rare: no loot filter hides it). */
  const dropHere = (game: Riftlight) => {
    const item = { uid: `latch-${++drops}`, base: 'leather-belt', rarity: 'rare', level: 5, name: 'Belt', affixes: [] } as unknown as Item;
    (game.ports.loot as RealLoot).spawn([{ kind: 'item', item }], game.hero.actor.position.clone(), game.level!, game.services.rng);
    h.engine.step(40);
    expect(game.interactOffer()?.verb, 'it is in reach').toBe(t('touch.verb.take'));
  };
  /** Into a level with the start clear (its own pack gone), the hero unable to die; `loading` checks the frame it starts. */
  const level = async (loading?: () => void) => {
    const going = h.rl.enterDepth(1);
    loading?.();
    await going;
    h.engine.step(3);
    h.game.dev.ai = false;
    h.game.dev.god = true;
    for (const m of h.game.level!.monsters()) m.actor.life = 0;
    h.engine.step(2);
  };
  /** Walk to a townsperson or the stash: in reach, on the pad. */
  const visit = (id: string) => {
    const it = h.game.town.interactables.find((x) => x.id === id)!;
    expect(h.rl.moveTo(it.position.x, it.position.z, { radius: Math.min(1.2, it.radius - 0.4) }).arrived).toBe(true);
    h.engine.input.noteDevice('pad');
    h.engine.step(1);
    expect(h.game.town.nearest(h.game.hero.actor.position)?.id).toBe(id);
  };

  beforeAll(async () => {
    h = await headlessRiftlight({ seed: 616, options: { hubSettings: fakeHub(sent) } });
    h.engine.input.setGamepads([pad()]);
    h.engine.input.noteDevice('pad');
    h.engine.step(2);
  }, T);
  afterAll(() => h?.engine.dispose());

  it('in town the stash and a townsperson latch it; R2 opens their window, the latch holding through the pull, and it lets go once R2 is up; closed it latches again; off the pad it lets go', { timeout: T }, () => {
    const { rl, engine } = h;
    expect(sent, 'the title at boot: nothing sent').toEqual([]);
    rl.newRun({ seed: 616 });
    visit('stash');
    expect(r2(), 'at the stash').toEqual(LATCH);
    expect(sent.at(-1), 'on R2 alone').toEqual(['right', LATCH]);
    const asked = vi.spyOn(engine.dualsense, 'trigger');
    engine.step(30);
    expect(asked, 'asked of the engine only when it changes').not.toHaveBeenCalled();
    asked.mockRestore();
    const stash = pull(() => stack()[0] === 'stash');
    expect(stash.fired, 'R2 opens the stash where the browser presses it').toBeGreaterThan(PRESS);
    expect(stash.letGo, 'held through the whole pull, let go once R2 is up').toEqual(UP);
    expect(stack()).toEqual(['stash']);
    tap(1); // Circle closes it
    expect(stack()).toEqual([]);
    expect(r2(), 'closed: the stash is still in reach').toEqual(LATCH);
    // a townsperson with a window: Ilsa's wares
    visit('ilsa');
    expect(r2()).toEqual(LATCH);
    const ilsa = pull(() => stack()[0] === 'vendor');
    expect(ilsa.fired, 'R2 talks to Ilsa and opens her wares').not.toBeNull();
    expect(ilsa.letGo, 'held through the whole pull, let go once R2 is up').toEqual(UP);
    tap(1);
    expect(stack()).toEqual([]);
    expect(r2(), 'closed: Ilsa is still in reach').toEqual(LATCH);
    engine.input.noteDevice('keyboard');
    engine.step(1);
    expect(r2(), 'the keyboard: let go').toBeNull();
    engine.input.noteDevice('pad');
    engine.step(1);
    expect(r2()).toEqual(LATCH);
    expect(engine.errors).toEqual([]);
  });

  it('a couch guest holding the DualSense: let go, latched again once it leaves; the title lets go', { timeout: T }, async () => {
    const { rl, engine, game } = h;
    expect(r2(), 'Ilsa in reach').toEqual(LATCH);
    const xbox = { ...pad(), index: 0, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)' };
    const sense = { ...pad(), index: 1, id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' };
    engine.input.setGamepads([xbox, sense]);
    engine.step(1);
    expect(game.coop.join(1), 'the DualSense sits down as player 2').not.toBeNull();
    await settle();
    engine.step(2);
    expect([engine.input.device, engine.input.dualSenseGuest, game.interactOffer() !== null], 'player 1 on the Xbox pad, Ilsa in reach').toEqual(['pad', true, true]);
    expect(r2(), 'the DualSense is the guest’s: let go').toBeNull();
    game.coop.leaveAll();
    engine.input.setGamepads([pad()]);
    engine.input.noteDevice('pad');
    engine.step(2);
    expect(engine.input.dualSenseGuest).toBe(false);
    expect(r2(), 'player 1’s again: latched').toEqual(LATCH);
    rl.toTitle();
    engine.step(1);
    expect(r2(), 'the title: let go').toBeNull();
    rl.newRun({ seed: 616 });
    visit('stash');
    expect(r2()).toEqual(LATCH);
    expect(engine.errors).toEqual([]);
  });

  it('a pull that started with nothing on offer never latches: on the title, and in the open stash (R2 its next tab)', { timeout: T }, () => {
    const { rl, engine } = h;
    /** R2's effect each frame of a full pull (`RAMP`) on the pad. */
    const during = () => {
      engine.input.noteDevice('pad');
      return RAMP.map((rt) => {
        engine.input.setGamepads([pad([], [0, 0], rt)]);
        engine.step(1);
        return r2();
      });
    };
    rl.toTitle();
    engine.step(1);
    expect(during().filter(Boolean), 'the title: never latched').toEqual([]);
    rl.newRun({ seed: 616 });
    visit('stash');
    expect(r2(), 'the stash in reach').toEqual(LATCH);
    rl.ui.open('stash');
    engine.step(1);
    expect(stack()[0]).toBe('stash');
    expect(r2(), 'its window open: let go').toBeNull();
    expect(during().filter(Boolean), 'R2 pages the stash: never latched').toEqual([]);
    rl.ui.close('stash');
    engine.input.setGamepads([pad()]);
    engine.step(2);
    expect(r2(), 'closed, in reach again: latched').toEqual(LATCH);
    expect(engine.errors).toEqual([]);
  });

  it('lets go loading a level; loot latches it, and an item window, the pause and photo mode let go; R2 takes it and lets go once up; walking away lets go; the portal holds through the pull that goes home', { timeout: T }, async () => {
    const { rl, game, engine } = h;
    expect(r2(), 'the stash in reach').toEqual(LATCH);
    await level(() => expect(r2(), 'loading (no frame runs while the level builds): let go at once').toBeNull());
    expect(game.interactOffer(), 'nothing at the start').toBeNull();
    expect(r2()).toBeNull();
    dropHere(game);
    expect(r2(), 'loot in reach').toEqual(LATCH);
    tap(8); // Create: the inventory
    expect(stack()).toEqual(['inventory']);
    expect(r2(), 'an item window: let go').toBeNull();
    tap(8);
    expect(r2(), 'closed').toEqual(LATCH);
    tap(9); // Options: the pause
    expect(stack()).toEqual(['pause']);
    expect(r2(), 'the pause: let go').toBeNull();
    tap(9);
    expect(r2(), 'resumed').toEqual(LATCH);
    game.showcase.photo.open();
    engine.step(1);
    expect(r2(), 'photo mode: let go').toBeNull();
    game.showcase.photo.close();
    engine.step(1);
    expect(r2()).toEqual(LATCH);
    const items = rl.state().loot.items;
    const take = pull(() => rl.state().loot.items === items - 1);
    expect(take.fired, 'R2 takes it').not.toBeNull();
    expect(take.letGo, 'nothing left to take, but held through the pull: let go once R2 is up').toEqual(UP);
    dropHere(game);
    expect(r2()).toEqual(LATCH);
    // walk away from it, up the screen
    engine.input.setGamepads([pad([], [0, -1])]);
    engine.step(45);
    engine.input.setGamepads([pad()]);
    engine.step(1);
    expect(game.interactOffer(), 'walked out of reach').toBeNull();
    expect(r2(), 'walked away: let go').toBeNull();
    // the portal, once the level is clear
    rl.killAll();
    rl.pickupAll();
    engine.step(30);
    expect(rl.state().exitOpen).toBe(true);
    const exit = game.level!.exit;
    expect(rl.moveTo(exit.x, exit.z, { radius: 1.5 }).arrived).toBe(true);
    engine.input.noteDevice('pad');
    engine.step(1);
    expect(game.interactOffer()?.verb, 'the portal').toBe(t('touch.verb.go'));
    expect(r2(), 'the open portal').toEqual(LATCH);
    const home = pull(() => game.screen === 'town');
    expect(home.fired, 'R2 goes through it, home').not.toBeNull();
    expect(game.interactOffer(), 'nothing in reach where the portal lands').toBeNull();
    expect(home.letGo, 'held through the pull, let go once R2 is up').toEqual(UP);
    expect(engine.errors).toEqual([]);
  });

  it('lets go while a save-state restores; a replay sends none, and the first live frame after it latches R2 again; dead, it lets go', { timeout: T }, async () => {
    const { game, engine } = h;
    await level();
    dropHere(game);
    expect(r2()).toEqual(LATCH);
    await engine.restore(await engine.snapshot()); // the recording starts here
    expect(r2(), 'restored (no frame ran): let go').toBeNull();
    engine.step(1);
    expect(r2(), 'the loot is still in reach').toEqual(LATCH);
    tap(8); // the inventory: let go
    expect(r2()).toBeNull();
    tap(8); // closed: latched again
    engine.step(5);
    expect(r2()).toEqual(LATCH);
    const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    const before = sent.length;
    const again = makeRiftlight(game.store, engine.seed);
    await engine.replay(rec, () => engine.loadGame(again));
    expect(
      sent.slice(before).filter(([, e]) => e !== null),
      'the replay sends no latch (its inventory let go and latched again)',
    ).toEqual([]);
    expect(r2(), 'the live game’s left with it (the engine let go)').toBeNull();
    expect(engine.input.device, 'the replay ended on the pad').toBe('pad');
    engine.step(1);
    expect(again.interactOffer()?.verb).toBe(t('touch.verb.take'));
    expect(r2(), 'the first live frame: latched').toEqual(LATCH);
    // dead
    again.dev.god = false;
    engine.step(10); // god mode's last moment of grace runs out
    const foe = currentRiftlightApi()!.spawn({ seed: 9 })!;
    const actor = again.level!.monsters().find((m) => m.actor.id === foe.id)!.actor;
    again.hero.actor.takeHit({ source: actor, tags: ['test'], damage: { chaos: 1e9 }, crit: false });
    engine.step(2);
    expect(currentRiftlightApi()!.state().dead).toBe(true);
    expect(r2(), 'dead: let go').toBeNull();
    expect(engine.errors).toEqual([]);
  });
});

describe('R2’s latch in a session round', () => {
  let h: HeadlessRiftlight | null = null;
  afterAll(() => h?.engine.dispose());

  it('stays let go with loot in reach on the pad (R2 does nothing in a round)', { timeout: 60_000 }, async () => {
    const sent: [string, TriggerEffect | null][] = [];
    const hub = new LocalHub({ mode: 'parallel', players: 1, seed: 4242, latencyMs: 50 });
    const session = (await HubSession.join({ mode: 'parallel', seats: [1, 4], client: hub.client(0), autoFlush: false }))!;
    const game = new Riftlight({}, { store: new SaveStore(null), session });
    h = await headlessRiftlight({ game, seed: session.info.seed, options: { hubSettings: fakeHub(sent) } });
    const { engine } = h;
    session.attach(engine);
    engine.input.setGamepads([pad()]);
    for (let f = 0; f < 600 && !hub.allReady; f++) {
      engine.step(1);
      hub.advance(1000 / 60);
      session.flush();
      await settle();
    }
    expect([hub.allReady, game.screen], 'the round’s level is built').toEqual([true, 'level']);
    const item = { uid: 'latch-round', base: 'leather-belt', rarity: 'rare', level: 5, name: 'Belt', affixes: [] } as unknown as Item;
    (game.ports.loot as RealLoot).spawn([{ kind: 'item', item }], game.hero.actor.position.clone(), game.level!, game.services.rng);
    engine.input.noteDevice('pad');
    engine.step(40);
    expect([engine.input.device, game.interactOffer()?.verb], 'loot in reach, on the pad').toEqual(['pad', t('touch.verb.take')]);
    expect(right(sent), 'a round: let go').toBeNull();
    expect(engine.errors).toEqual([]);
  });
});
