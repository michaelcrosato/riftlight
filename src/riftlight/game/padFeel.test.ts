// PadFeel against the engine's real DualSense: the light bar's colour is asked for every frame and
// the engine sends only changes, so a colour asked for while a replay played (dropped then) goes
// out once play is live again; a pulse still to come is dropped by `cancel`.
import { describe, expect, it } from 'vitest';
import { DualSense, type GameContext, HubSettings, type HubSettingsSource, type Rumble } from '../../engine';
import { PadFeel, RUMBLE } from './padFeel';

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
