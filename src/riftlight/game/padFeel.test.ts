// PadFeel against the engine's real DualSense: the light bar's colour is asked for every frame and
// the engine sends only changes, so a colour asked for while a replay played (dropped then) goes
// out once play is live again; R2's latch is asked of the engine only when it changes, and one asked
// during a replay goes out once play is live; a pulse still to come is dropped by `cancel`.
import { describe, expect, it, vi } from 'vitest';
import { DualSense, type GameContext, HubSettings, type HubSettingsSource, type Rumble, type TriggerEffect } from '../../engine';
import { LATCH, PadFeel, PRESS, RUMBLE } from './padFeel';

/** A fake 52in1 with a DualSense whose light bar the game may colour; what it was sent goes in `sent`. */
const hub = (sent: (string | null)[]): HubSettingsSource => ({ dualsense: { connected: true, lightbar: true, triggers: true, motion: false, touchpad: false, speaker: false, aim: true, light: (c: string | null) => void sent.push(c), trigger: () => {} } as never });

describe('PadFeel', () => {
  it('after a replay hands control back the light bar shows what play wants, though it was asked for during the replay', () => {
    const sent: (string | null)[] = [];
    let replaying = false;
    const live = () => !replaying;
    const feel = new PadFeel({ dualsense: new DualSense(new HubSettings(hub(sent), live), live), input: { rumble: () => {} } } as unknown as GameContext);
    feel.light('#38b764'); // green: the hero is well
    feel.light('#38b764');
    expect(sent, 'sent once: the engine sends changes only').toEqual(['#38b764']);
    replaying = true;
    feel.light('#ffcd75'); // the replay's frames: the hero ends it hurt (amber), dropped
    replaying = false;
    feel.light('#ffcd75'); // the first live frame
    expect(sent, 'amber once play is live').toEqual(['#38b764', '#ffcd75']);
  });

  it('R2’s latch: asked of the engine only when it changes, letting go of both; one asked during a replay goes out once play is live', () => {
    const sent: [string, TriggerEffect | null][] = [];
    let replaying = false;
    const live = () => !replaying;
    const source = { dualsense: { connected: true, lightbar: true, triggers: true, motion: false, touchpad: false, speaker: false, aim: false, light: () => {}, trigger: (which: string, e: TriggerEffect | null) => void sent.push([which, e]) } } as never;
    const dualsense = new DualSense(new HubSettings(source, live), live);
    const asked = vi.spyOn(dualsense, 'trigger');
    const input = {
      rumble: () => {},
      get playing() {
        return replaying;
      },
    };
    const feel = new PadFeel({ dualsense, input } as unknown as GameContext);
    feel.latch(false); // nothing asked yet: nothing to let go
    feel.latch(true);
    feel.latch(true);
    expect(feel.latched).toBe(true);
    feel.latch(false);
    expect(feel.latched).toBe(false);
    expect(asked.mock.calls, 'only the changes').toEqual([
      ['right', LATCH],
      ['both', null],
    ]);
    replaying = true;
    feel.latch(true); // the replay's frames: not asked (the engine would drop it)
    expect(feel.latched, 'what the engine was asked').toBe(false);
    replaying = false;
    feel.latch(true); // the first live frame
    expect(sent, 'the controller').toEqual([
      ['right', LATCH],
      ['right', null],
      ['right', LATCH],
    ]);
  });

  it('R2’s latch pushes back before a browser says R2 is pressed, and gives way well after', () => {
    expect(LATCH.from, 'the push back comes first').toBeLessThan(PRESS);
    expect(LATCH.to - PRESS, 'then a stretch of it, and the click').toBeGreaterThanOrEqual(0.25);
  });

  it('cancel drops a pulse still to come', () => {
    const played: Rumble[] = [];
    const feel = new PadFeel({ input: { rumble: (r: Rumble) => void played.push(r) } } as unknown as GameContext);
    feel.pulses(RUMBLE.levelUp, 0.2);
    expect([played.length, feel.pending]).toEqual([1, 1]);
    feel.cancel();
    feel.update(1);
    expect(played).toEqual([RUMBLE.levelUp[0]]);
  });
});
