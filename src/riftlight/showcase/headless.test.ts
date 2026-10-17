// The showcase and the save files headless: what needs a page (pointer lock, a picture, a file
// download or picker) does nothing, and the game plays on.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight();
}, T);
afterAll(() => h?.engine.dispose());

it(
  'the Hall of Beasts, photo mode, save export / import and the way to Engine World run without a page',
  async () => {
    const { engine, game, rl } = h;
    rl.newRun({ seed: 5 });
    await rl.bestiary.open();
    engine.step(30); // every frame reads pointer lock in a page
    expect(rl.bestiary.state()).toMatchObject({ active: true });
    await rl.bestiary.close();
    rl.photo.open();
    engine.input.setKey('KeyP', true); // the shutter: no picture headless, and no unhandled rejection
    engine.step(2);
    engine.input.setKey('KeyP', false);
    engine.step(2);
    expect(rl.photo.state()).toMatchObject({ active: true, last: null });
    rl.save(0);
    game.exportSlot(0);
    game.importSlot(0);
    engine.step(2);
    game.engineWorld(); // leaving for Engine World: no page to leave headless
    expect(engine.errors).toEqual([]);
  },
  T,
);
