// Save-states with a hero who can be hurt (docs/game/save-states.md): no god mode, depth 2
// mid-fight (hazards, mechanics, monsters), restored and played on: the whole state the same.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { PICTURE, SnapDriver, snapDiff } from './testSnapshot';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242 });
}, T);
afterAll(() => h?.engine.dispose());

it(
  'without god mode (the hero hurt), restored mid-fight at depth 2 and played on: the same state, with no game errors',
  async () => {
    const e = h.engine;
    const d = new SnapDriver(e);
    await d.newRun(2, 4242, false);
    await d.enter(2);
    const hp = d.actor.position;
    d.level!.spawn(4001, hp.clone().set(hp.x + 3, hp.y, hp.z), 'rare');
    d.fight(120, 5);
    const snap = await d.take();
    let low = Infinity;
    for (let f = 0; f < 240; f += 10) {
      d.fight(10, 21 + f);
      low = Math.min(low, d.actor.life);
    }
    const went = { print: e.fingerprint(), snap: await d.take() };
    expect(low, `life down from ${d.actor.maxLife}`).toBeLessThan(d.actor.maxLife);
    await e.restore(snap);
    for (let f = 0; f < 240; f += 10) d.fight(10, 21 + f);
    expect(e.fingerprint()).toBe(went.print);
    expect(snapDiff(went.snap, await d.take(), PICTURE)).toEqual([]);
    expect(e.state().errors).toEqual([]);
  },
  T,
);
