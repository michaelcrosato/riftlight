import { describe, expect, it } from 'vitest';
import { PALETTE, type PaletteColor } from '../../palette';
import { Rng } from '../../random';
import { oklab } from '../oklab';
import { hexString, mapColours, slotName, type ColourSample } from './colours';

type Family = 'warm' | 'grey' | 'green' | 'blue' | 'purple';
/**
 * The labelled fixture (docs/assets/importing.md *Colours*): source colours a kit might use, each
 * with the palette entries a person would accept for it. Woods include the pale ones a nearest
 * match turned white; pinks must never go white.
 */
const FIXTURE: readonly (readonly [name: string, hex: number, family: Family, ok: readonly PaletteColor[]])[] = [
  ['wood brown', 0x8b5a2b, 'warm', ['orange', 'red']],
  ['burlywood', 0xdeb887, 'warm', ['sand', 'orange']],
  ['wheat (pale wood)', 0xf5deb3, 'warm', ['sand', 'orange']],
  ['beige (pale wood)', 0xe0c8a0, 'warm', ['sand', 'orange']],
  ['light brown', 0xc19a6b, 'warm', ['orange', 'sand']],
  ['sienna', 0xa0522d, 'warm', ['orange', 'red']],
  ['sandy brown', 0xf4a460, 'warm', ['orange', 'sand']],
  ['moccasin', 0xffe4b5, 'warm', ['sand']],
  ['gold', 0xffd700, 'warm', ['sand']],
  ['dark orange', 0xff8c00, 'warm', ['orange']],
  ['pure red', 0xff0000, 'warm', ['red', 'orange']],
  ['firebrick', 0xb22222, 'warm', ['red']],
  ['dark red', 0x8b0000, 'warm', ['red', 'plum']],
  ['pink', 0xffc0cb, 'warm', ['red', 'orange']],
  ['dusty pink', 0xe8a0a8, 'warm', ['red', 'orange']],
  ['hot pink', 0xff69b4, 'warm', ['red', 'orange', 'plum']],
  ['grey', 0x808080, 'grey', ['slate', 'mist']],
  ['silver', 0xc0c0c0, 'grey', ['mist', 'white']],
  ['dark grey', 0x404040, 'grey', ['night', 'ink', 'slate']],
  ['near white', 0xf0f0f0, 'grey', ['white']],
  ['near black', 0x101010, 'grey', ['ink']],
  ['slate grey', 0x708090, 'grey', ['slate', 'mist']],
  ['light steel', 0xb0b8c0, 'grey', ['mist']],
  ['warm stone', 0x9a9488, 'grey', ['mist', 'slate']],
  ['forest green', 0x228b22, 'green', ['green', 'teal']],
  ['lawn green', 0x7cfc00, 'green', ['lime', 'green']],
  ['light green', 0x90ee90, 'green', ['lime', 'green']],
  ['sea green', 0x2e8b57, 'green', ['green', 'teal']],
  ['olive', 0x556b2f, 'green', ['green', 'teal']],
  ['teal', 0x008080, 'blue', ['teal']],
  ['navy', 0x000080, 'blue', ['navy', 'blue']],
  ['royal blue', 0x4169e1, 'blue', ['blue']],
  ['sky blue', 0x87ceeb, 'blue', ['sky', 'cyan']],
  ['cyan', 0x00ffff, 'blue', ['cyan']],
  ['purple', 0x800080, 'purple', ['plum']],
  ['slate blue', 0x6a5acd, 'purple', ['blue', 'navy', 'plum']],
];
const WARM: readonly PaletteColor[] = ['red', 'orange', 'sand', 'plum'];
const NEUTRAL: readonly PaletteColor[] = ['ink', 'night', 'slate', 'mist', 'white'];

const one = (hex: number) => mapColours([{ hex, area: 1 }]).slots[0]!.colour;
const entryOf = (m: ReturnType<typeof mapColours>, hex: number) => m.slots.find((s) => s.members.includes(hex))!.colour;

describe('mapColours: the labelled fixture', () => {
  it('maps every fixture colour to an acceptable entry', () => {
    const wrong = FIXTURE.filter(([, hex, , ok]) => !ok.includes(one(hex))).map(([name, hex]) => `${name} ${hexString(hex)} → ${one(hex)}`);
    expect(wrong).toEqual([]);
  });

  it('warm stays warm, grey stays grey, and pink never goes white', () => {
    for (const [name, hex, family] of FIXTURE) {
      if (family === 'warm') expect(WARM, name).toContain(one(hex));
      if (family === 'grey') expect(NEUTRAL, name).toContain(one(hex));
      else expect(NEUTRAL, name).not.toContain(one(hex));
    }
    for (const pink of [0xffc0cb, 0xffb6c1, 0xe8a0a8, 0xf4c2c2, 0xff69b4]) expect(['red', 'orange'], hexString(pink)).toContain(one(pink));
  });

  it('distinct colours in one model stay distinct, at their own entries', () => {
    // a Kenney-like chair: wood, dark metal, a red carpet and a pink cushion
    const chair: ColourSample[] = [
      { hex: 0xc8915c, area: 5, name: 'wood' },
      { hex: 0x4a4a4a, area: 1, name: 'metalDark' },
      { hex: 0xb03a48, area: 3, name: 'carpet' },
      { hex: 0xf0a0b0, area: 0.5, name: 'cushion' },
    ];
    const m = mapColours(chair);
    expect(m.slots.map((s) => s.slot)).toEqual(['wood', 'carpet', 'metalDark', 'cushion']);
    expect(new Set(m.slots.map((s) => s.colour)).size).toBe(4);
    expect(WARM).toContain(entryOf(m, 0xc8915c));
    expect(entryOf(m, 0xb03a48)).toBe('red');
    expect(NEUTRAL).toContain(entryOf(m, 0x4a4a4a));
    expect(['red', 'orange']).toContain(entryOf(m, 0xf0a0b0));
    // the palette's own colours, up to 6 in a model, always map to themselves (round trips are exact)
    const names = Object.keys(PALETTE) as PaletteColor[];
    const rng = new Rng('palette subsets');
    for (let k = 0; k < 200; k++) {
      const pick = rng.shuffle([...names]).slice(0, 2 + (k % 5));
      const pm = mapColours(pick.map((n, i) => ({ hex: PALETTE[n], area: 1 + ((i * 7) % 5) })));
      for (const n of pick) expect(entryOf(pm, PALETTE[n]), `${n} among ${pick.join(', ')}`).toBe(n);
    }
  });

  it('keeps lightness order within a family', () => {
    const woods = mapColours([
      { hex: 0x8f563b, area: 3, name: 'darkWood' },
      { hex: 0xd9a066, area: 2, name: 'lightWood' },
    ]);
    const L = (n: PaletteColor) => oklab(PALETTE[n]).L;
    expect(WARM).toContain(entryOf(woods, 0x8f563b));
    expect(WARM).toContain(entryOf(woods, 0xd9a066));
    expect(L(entryOf(woods, 0xd9a066))).toBeGreaterThan(L(entryOf(woods, 0x8f563b)));
    // pairs whose cheapest entries come out the wrong way round: the order pass swaps them
    for (const [light, dark] of [
      [0xf26474, 0xcd2b14], // a salmon cushion and a brick
      [0x10c149, 0x72911c], // a bright leaf and an olive one
    ] as const) {
      const m = mapColours([
        { hex: light, area: 2 },
        { hex: dark, area: 1 },
      ]);
      expect(L(entryOf(m, light)), `${hexString(light)} over ${hexString(dark)}`).toBeGreaterThan(L(entryOf(m, dark)));
    }
    const greys = mapColours([0xf4f4f4, 0xb0b0b0, 0x606060, 0x151515].map((hex, i) => ({ hex, area: 4 - i })));
    const ls = [0xf4f4f4, 0xb0b0b0, 0x606060, 0x151515].map((h) => L(entryOf(greys, h)));
    expect(ls).toEqual([...ls].sort((a, b) => b - a));
    expect(new Set(ls).size).toBe(4);
  });

  it('absorbs a baked gradient into one slot and caps the slots at 6', () => {
    const greens = [0x2f6b39, 0x327240, 0x367845, 0x3a7d44, 0x3e844c].map((hex) => ({ hex, area: 1, name: 'colormap' }));
    const g = mapColours([...greens, { hex: 0x6b6b6b, area: 2, name: 'colormap' }]);
    expect(g.slots.map((s) => [s.slot, s.colour, s.members.length])).toEqual([
      ['c1', 'green', 5],
      ['c2', 'slate', 1],
    ]);
    const ten = (Object.values(PALETTE) as number[]).slice(0, 10).map((hex) => ({ hex, area: 1 }));
    expect(mapColours(ten).slots).toHaveLength(6);
    expect(mapColours(ten, { max: 16 }).slots).toHaveLength(10);
  });

  it('clusters thousands of distinct colours (a pack, vertex-colour gradients) in well under a second', () => {
    const rng = new Rng('many colours');
    const samples = Array.from({ length: 2000 }, () => ({ hex: rng.int(0, 0xffffff), area: rng.range(0.1, 1) }));
    for (const max of [6, 16]) {
      const t0 = performance.now(); // real time: the mapper's own budget
      const m = mapColours(samples, { max });
      const ms = performance.now() - t0; // real time: the mapper's own budget
      expect(m.slots).toHaveLength(max);
      expect(Object.keys(m.of)).toHaveLength(new Set(samples.map((s) => s.hex)).size); // every colour has its slot
      expect(ms, `max ${max}: ${ms.toFixed(0)} ms`).toBeLessThan(500);
    }
  });

  it('is deterministic and ignores input order', () => {
    const samples = FIXTURE.slice(0, 12).map(([name, hex], i) => ({ hex, area: 1 + (i % 4), name }));
    const a = mapColours(samples);
    expect(mapColours(samples)).toEqual(a);
    expect(mapColours([...samples].reverse())).toEqual(a);
    expect(mapColours(new Rng('order').shuffle([...samples]))).toEqual(a);
  });
});

describe('slot names', () => {
  it('come from material names that mean something, else c1, c2…', () => {
    expect(['wood', 'metal_dark', 'metalDark', 'M_Wood_01', 'Material.001', 'colormap', 'lambert2', '', 'a', 'Leaves_High'].map((n) => slotName(n))).toEqual(['wood', 'metalDark', 'metalDark', 'wood', null, null, null, null, null, 'leavesHigh']);
    const m = mapColours([
      { hex: 0xb13e53, area: 2, name: 'wood' },
      { hex: 0x3b5dc9, area: 1, name: 'wood' },
      { hex: 0x38b764, area: 0.5, name: 'Material.002' },
    ]);
    expect(m.slots.map((s) => s.slot)).toEqual(['wood', 'wood2', 'c1']);
    expect(m.of).toEqual({ '#b13e53': 'wood', '#3b5dc9': 'wood2', '#38b764': 'c1' });
  });
});
