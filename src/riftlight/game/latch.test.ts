// R2's latch, headless through a fake 52in1: R2 is interact, so a DualSense's R2 pushes back and
// gives way (`LATCH`, an adaptive trigger) while there is something to interact with on the pad (the
// stash, loot, the portal), and lets go walking away, taking it, in a panel or the pause, in photo
// mode, loading, off the pad and dead. The engine is asked only when it changes; a replay sends
// none, and the latch goes out the first live frame after one. One engine for the file, tests in order.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HubSettingsSource, Recording, TriggerEffect } from '../../engine';
import type { Item } from '../core/types';
import type { RealLoot } from '../wire/loot';
import { currentRiftlightApi, type HeadlessRiftlight, headlessRiftlight, makeRiftlight } from '../headless';
import { t } from '../lang';
import { LATCH } from './padFeel';
import type { Riftlight } from './Riftlight';

const T = 30_000;
let h: HeadlessRiftlight;
/** What the fake 52in1's triggers were sent, in order. */
const sent: [string, TriggerEffect | null][] = [];
/** R2 as the controller has it: the last effect sent to the right trigger or both, null when let go. */
const r2 = (): TriggerEffect | null => [...sent].reverse().find(([which]) => which !== 'left')?.[1] ?? null;

/** A pad in the standard layout: the left stick `l`, `pressed` buttons down. */
const pad = (pressed: number[] = [], l: [number, number] = [0, 0]) => ({ connected: true, mapping: 'standard', index: 0, axes: [...l, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
/** Pad button `b` pressed for a frame and let go. */
const tap = (b: number) => {
  h.engine.input.setGamepads([pad([b])]);
  h.engine.step(1);
  h.engine.input.setGamepads([pad()]);
  h.engine.step(1);
};
const R2 = 7;
const stack = () => h.rl.state().ui;
let drops = 0;
/** A rare belt on the ground at the hero's feet, landed (a rare: no loot filter hides it). */
const dropHere = (game: Riftlight) => {
  const item = { uid: `latch-${++drops}`, base: 'leather-belt', rarity: 'rare', level: 5, name: 'Belt', affixes: [] } as unknown as Item;
  (game.ports.loot as RealLoot).spawn([{ kind: 'item', item }], game.hero.actor.position.clone(), game.level!, game.services.rng);
  h.engine.step(40);
  expect(game.interactOffer()?.verb, 'it is in reach').toBe(t('touch.verb.take'));
};

beforeAll(async () => {
  const hub: HubSettingsSource = { dualsense: { connected: true, lightbar: true, triggers: true, motion: false, touchpad: false, speaker: false, aim: false, light: () => {}, trigger: (which: string, effect: TriggerEffect | null) => void sent.push([which, effect]) } as never };
  h = await headlessRiftlight({ seed: 616, options: { hubSettings: hub } });
  h.engine.input.setGamepads([pad()]);
  h.engine.input.noteDevice('pad');
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('R2’s latch', () => {
  it('lets go on the title; in town the stash latches it, R2 opens the stash and it lets go, closed it latches again; off the pad it lets go', { timeout: T }, () => {
    const { rl, game, engine } = h;
    expect(sent, 'the title: nothing to interact with').toEqual([]);
    rl.newRun({ seed: 616 });
    const stash = game.town.interactables.find((x) => x.id === 'stash')!;
    expect(rl.moveTo(stash.position.x, stash.position.z, { radius: Math.min(1.2, stash.radius - 0.4) }).arrived).toBe(true);
    engine.input.noteDevice('pad');
    engine.step(1);
    expect(r2(), 'at the stash').toEqual(LATCH);
    expect(sent.at(-1), 'on R2 alone').toEqual(['right', LATCH]);
    const asked = vi.spyOn(engine.dualsense, 'trigger');
    engine.step(30);
    expect(asked, 'asked of the engine only when it changes').not.toHaveBeenCalled();
    asked.mockRestore();
    tap(R2);
    expect(stack(), 'R2 opens the stash').toEqual(['stash']);
    expect(r2(), 'a panel: let go').toBeNull();
    tap(1); // Circle closes it
    expect(stack()).toEqual([]);
    expect(r2(), 'closed: the stash is still in reach').toEqual(LATCH);
    engine.input.noteDevice('keyboard');
    engine.step(1);
    expect(r2(), 'the keyboard: let go').toBeNull();
    engine.input.noteDevice('pad');
    engine.step(1);
    expect(r2()).toEqual(LATCH);
    expect(engine.errors).toEqual([]);
  });

  it('lets go loading a level; loot latches it, and an item window, the pause and photo mode let go; taking it or walking away lets go; the open portal latches it', { timeout: T }, async () => {
    const { rl, game, engine } = h;
    await rl.enterDepth(1);
    expect(r2(), 'loading (no frame runs while the level builds): let go at once').toBeNull();
    engine.step(3);
    game.dev.ai = false;
    game.dev.god = true;
    for (const m of game.level!.monsters()) m.actor.life = 0; // the level's own pack: out of the way
    engine.step(2);
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
    tap(R2);
    expect(rl.state().loot.items, 'R2 takes it').toBe(items - 1);
    expect(r2(), 'nothing left to take: let go').toBeNull();
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
    expect(engine.errors).toEqual([]);
  });

  it('a replay sends none, and the first live frame after it latches R2 again; dead, it lets go', { timeout: T }, async () => {
    const { game, engine } = h;
    // back from the portal to the loot: the recording starts with the latch on
    game.hero.snap!(game.level!.start, Math.PI);
    engine.step(2);
    dropHere(game);
    expect(r2()).toEqual(LATCH);
    await engine.restore(await engine.snapshot()); // the recording starts here
    engine.step(1);
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
