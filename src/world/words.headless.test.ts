// Engine World's words on a pad and a phone, headless: every room's card (about, try), its station
// guide, its pads' notes, its floor labels and its Tweak rows, filled in (`keyText`) for a pad and
// for a phone, name no keyboard key bare. A key in a line is a `{key:action}` tag (WORLD_CONTROLS,
// a room's own `controls`), so it reads "Square" on a pad and "HIT" on a phone; a keyboard or a
// mouse is named only where the words say so ("on a keyboard Shift+E", "with a mouse, a right
// click..."). One engine for the file (the World shell is one per process).
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../engine';
import { keyText } from './controls';
import type { worldApi } from './index';
import { guideBlocks } from './ui/panels';
import { headlessWorld, roomGame, WORLD_T } from './testWorld';

let engine: Engine;
let w: typeof worldApi;

beforeAll(async () => {
  // touch: as a phone's page, which shows touch controls, so a touch names them
  ({ engine, w } = await headlessWorld('atrium', 1, { touch: true }));
}, WORLD_T);
afterAll(() => engine?.dispose());

/**
 * A keyboard key or a mouse named bare: "(J)", "(J, K)", "(T changes it)", "(jump, C)", a floor
 * label's "· J", the Tab or Enter key, the mouse wheel, a right click.
 */
const BARE = [
  /\([A-Z](?:,\s*[A-Z])*\)/,
  /\([A-Z] (?:changes|does|opens|turns|to|for)\b/,
  /,\s*[A-Z]\)/,
  /· [A-Z](?=$|\s+·)/,
  /\bTab\b|\bTAB\b/,
  /\bEnter\b(?! the Gungeon)/,
  /\bmouse wheel\b|\bright[- ]click/i,
  /\bShift\+/,
];

/** Words that say which device they are for are fine: "on a keyboard Shift+E: ten at a time", "with a mouse, a right click...". */
const qualified = (text: string) => text.replace(/\b(?:on a keyboard|with a mouse)\b[^;.)]*/gi, '');

/** Every word a room shows a player: its card, guide, pads, floor labels and Tweak rows (labels and hints). */
function roomWords(): string[] {
  const g = roomGame(engine);
  const def = g.def;
  const knobs = g.logic.knobs ?? [];
  const fill = (s: string) => keyText(engine, s);
  return [
    def.about,
    ...def.try,
    ...guideBlocks(def, g.kit.pads, knobs, fill).flatMap((b) => ('text' in b ? [b.text] : [])),
    ...g.kit.pads.flatMap((p) => [p.def.label, p.def.note]),
    ...g.kit.labels.map((l) => l.text),
    ...knobs.flatMap((k) => [k.label, k.hint ?? '']),
  ].map(fill);
}

it(
  'every room\'s card, guide, pads, floor labels and Tweak rows name a pad\'s buttons on a pad and a phone\'s on a phone, never a bare key',
  async () => {
    const bad: string[] = [];
    const rooms = w.rooms();
    try {
      for (const r of rooms) {
        await w.goto(r.id, { instant: true });
        engine.step(3);
        for (const device of ['pad', 'touch'] as const) {
          engine.input.noteDevice(device);
          for (const text of new Set(roomWords())) {
            const hit = BARE.find((re) => re.test(qualified(text)));
            if (hit) bad.push(`${r.id} (${device}): ${text}`);
          }
        }
        engine.input.noteDevice('keyboard');
      }
    } finally {
      engine.input.noteDevice('keyboard');
    }
    expect(bad).toEqual([]);
    expect(rooms.length, 'every room was read').toBeGreaterThanOrEqual(40);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T * 4,
);

it('names the hero\'s moves and Tweak for the device: J, T and C on a keyboard; Square, Options and Circle on a pad; HIT, ≡ and DUCK on a phone', () => {
  const line = 'Punch ({key:attack}), crouch ({key:crouch}), more in Tweak ({key:tweak})';
  try {
    engine.input.noteDevice('keyboard');
    expect(keyText(engine, line)).toBe('Punch (J), crouch (C), more in Tweak (T)');
    engine.input.noteDevice('pad');
    expect(keyText(engine, line)).toBe('Punch (Square), crouch (Circle), more in Tweak (Options)');
    engine.input.noteDevice('touch');
    expect(keyText(engine, line)).toBe('Punch (HIT), crouch (DUCK), more in Tweak (≡)');
  } finally {
    engine.input.noteDevice('keyboard');
  }
});
