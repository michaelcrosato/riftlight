// Couch co-op and a DualSense, headless: the light bar says how the hero of whoever holds the
// DualSense is (a guest's, when 52in1's DualSense is a guest's pad; the hub's own when whose is
// unknown), and each guest's pad rumbles for its own hero (a hit by its size, its crits, its fall),
// never player 1's pad for it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HubSettingsSource } from '../../engine';
import type { Actor } from '../actors/Actor';
import { type HeadlessRiftlight, headlessRiftlight, settle } from '../headless';
import { RUMBLE } from './padFeel';

const T = 30_000;
let h: HeadlessRiftlight;
const lights: (string | null)[] = [];
const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
const SENSE = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
const pad = (index: number, id: string, pressed: number[] = []) => ({ connected: true, mapping: 'standard', index, id, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
const GREEN = '#38b764';
const RED = new Set(['#b13e53', '#5d275d']);

beforeAll(async () => {
  const hub: HubSettingsSource = { dualsense: { connected: true, lightbar: true, triggers: true, motion: false, touchpad: false, speaker: false, aim: false, light: (c: string | null) => void lights.push(c), trigger: () => {} } as never };
  h = await headlessRiftlight({ seed: 717, options: { hubSettings: hub } });
  h.rl.newRun({ seed: 717 });
  await h.rl.enterDepth(1);
  h.engine.step(3);
  h.game.dev.ai = false;
}, T);
afterAll(() => h?.engine.dispose());

describe('couch co-op with a DualSense', () => {
  it('the light bar is the hero of whoever holds the DualSense: a guest’s, then player 1’s again once it leaves', { timeout: T }, async () => {
    const { engine, game } = h;
    const p1 = game.hero.actor;
    // player 1 on the DualSense: its hero's life
    engine.input.setGamepads([pad(0, SENSE, [0])]);
    engine.step(2);
    p1.life = p1.stats.get('life') * 0.1;
    engine.step(80);
    expect(new Set(lights.slice(-3)), 'player 1 at a tenth: red, pulsing').toEqual(RED);
    // player 1 takes an Xbox pad; the DualSense sits down as player 2
    engine.input.setGamepads([pad(0, XBOX, [0]), pad(1, SENSE)]);
    engine.step(1);
    expect(game.coop.join(1), 'the DualSense joins').not.toBeNull();
    await settle();
    engine.step(3);
    const guest = game.coop.guests[0]!.hero!.actor;
    expect([engine.input.dualSenseGuest, engine.input.dualSenseGuestSlot]).toEqual([true, 1]);
    guest.life = guest.stats.get('life');
    engine.step(2);
    expect(lights.at(-1), 'the guest’s hero, whole: green (player 1 is at a tenth)').toBe(GREEN);
    guest.life = guest.stats.get('life') * 0.1;
    engine.step(80);
    expect(new Set(lights.slice(-3)), 'the guest at a tenth: red, pulsing').toEqual(RED);
    // two guests on DualSenses: whose 52in1 reads is unknown, the light goes back to the hub
    engine.input.setGamepads([pad(0, XBOX, [0]), pad(1, SENSE), pad(2, SENSE)]);
    engine.step(1);
    expect(game.coop.join(2), 'a second DualSense joins').not.toBeNull();
    engine.step(1);
    expect([engine.input.dualSenseGuest, engine.input.dualSenseGuestSlot, game.coop.guests[1]!.hero], 'its hero still being made').toEqual([true, null, null]);
    expect(lights.at(-1), 'whose is unknown: the hub’s').toBeNull();
    await settle();
    engine.step(3);
    expect(lights.at(-1), 'still unknown with both heroes made').toBeNull();
    // the guest leaves: the DualSense is player 1's again, at a tenth; whole again
    game.coop.leaveAll();
    engine.input.setGamepads([pad(0, SENSE, [0])]);
    p1.life = p1.stats.get('life');
    engine.step(3);
    expect([engine.input.dualSenseGuest, lights.at(-1)], 'player 1’s again: green').toEqual([false, GREEN]);
    expect(engine.errors).toEqual([]);
  });

  it('a guest’s pad rumbles for its own hero (a hit by its size, a crit it deals, its fall), never player 1’s', { timeout: T }, async () => {
    const { engine, game } = h;
    engine.input.setGamepads([pad(0, XBOX, [0]), pad(1, SENSE)]);
    engine.step(1);
    expect(game.coop.join(1)).not.toBeNull();
    await settle();
    engine.step(3);
    const guest = game.coop.guests[0]!.hero!.actor;
    const foe = game.level!.monsters().find((m) => m.actor.alive)!.actor;
    const theirs = vi.spyOn(engine.input.player(1), 'rumble');
    const p1s = vi.spyOn(engine.input, 'rumble');
    try {
      guest.life = guest.stats.get('life');
      guest.takeHit({ source: foe, tags: ['test'], damage: { physical: guest.stats.get('life') * 0.05 }, crit: false });
      const small = theirs.mock.calls.at(-1)?.[0];
      guest.takeHit({ source: foe, tags: ['test'], damage: { physical: guest.stats.get('life') * 0.3 }, crit: false });
      const big = theirs.mock.calls.at(-1)?.[0];
      expect(small && big, 'the guest’s pad rumbled for each hit').toBeTruthy();
      expect(big!.strong!, 'a bigger hit rumbles harder').toBeGreaterThan(small!.strong!);
      foe.takeHit({ source: guest, tags: ['test'], damage: { physical: 1 }, crit: true });
      expect(theirs.mock.calls.at(-1)?.[0], 'a crit it dealt').toEqual(RUMBLE.crit);
      guest.takeHit({ source: foe, tags: ['test'], damage: { chaos: 1e9 }, crit: false });
      expect(theirs.mock.calls.at(-1)?.[0], 'it falls').toEqual(RUMBLE.death);
      // it rises; then a poison's tick fells it, between the poison's hit events (no killing hit)
      for (let f = 0; f < 600 && !guest.alive; f++) engine.step(1);
      expect(guest.alive, 'risen').toBe(true);
      theirs.mockClear();
      guest.life = 1;
      (guest as Actor).applyAilment({ id: 'poison', magnitude: 1000, duration: 3 }, foe);
      for (let f = 0; f < 30 && guest.alive; f++) engine.step(1);
      expect(guest.alive).toBe(false);
      expect(theirs.mock.calls.map((c) => c[0]), 'a poison fells it: its fall rumbles').toContainEqual(RUMBLE.death);
      expect(p1s, 'player 1’s pad: nothing for the guest').not.toHaveBeenCalled();
    } finally {
      theirs.mockRestore();
      p1s.mockRestore();
      game.coop.leaveAll();
    }
    expect(engine.errors).toEqual([]);
  });
});
