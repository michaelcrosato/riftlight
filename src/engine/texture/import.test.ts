// 2D import (docs/plans/asset-system.md §7.5): pixel-art sheets sliced into TextureDefs. Every
// fixture is drawn here, at test time, from known pixel grids and written with encodePng
// (principle 5: no binaries, no third-party content), then read back with the engine's decoder.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../../../scripts/png';
import { textureDefsSource } from '../../../scripts/ts-value';
import { ImportError } from '../model/import/common';
import { creditEntries, creditLines } from '../model/packs/credits';
import { OWN_LICENCE } from '../model/packs/licences';
import { PALETTE, type PaletteColor } from '../palette';
import { decodePng, type RgbaImage } from '../png';
import { bakeTexture, importPackSheet, importSheet, LEGEND_CHARS, SHEET_IMPORT_TOOL, validateTexture, type PixelsLayer, type SheetImportOptions, type TextureDef } from '.';

const NAMES = Object.keys(PALETTE) as PaletteColor[];
const SOURCE = { url: 'src/engine/texture/import.test.ts', licence: OWN_LICENCE, file: 'fixture.png' };
/** A pixel: its colour and alpha, or null (alpha 0). */
type Px = { hex: number; a?: number } | null;

/** A sheet drawn by `at`, written as a PNG and read back by the engine's decoder. */
function sheet(width: number, height: number, at: (x: number, y: number) => Px): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(x, y);
      if (p) data.set([(p.hex >> 16) & 255, (p.hex >> 8) & 255, p.hex & 255, p.a ?? 255], (y * width + x) * 4);
    }
  }
  return decodePng(new Uint8Array(encodePng({ width, height, data })), (b) => new Uint8Array(inflateSync(b)));
}

const opts = (o: Partial<SheetImportOptions> = {}): SheetImportOptions => ({ as: 'fx', grid: [16, 16], source: SOURCE, ...o });
/** Two cells of two colours each, for the credits. */
const MIXED_FOR_CREDITS = (x: number): Px => ({ hex: x < 16 ? (x < 8 ? PALETTE.sand : PALETTE.ink) : x < 24 ? PALETTE.teal : PALETTE.white });

/**
 * The tileset: 4 × 4 cells of 16 × 16, each its own layout in PALETTE colours: a fill, a diagonal,
 * a 4 × 4 square that moves along the row, a transparent 3 × 3 corner and two pixels on the alpha
 * threshold (127 transparent, 128 opaque). Cells 5 and 6 are empty (6 only under the threshold):
 * not mirror images across the diagonal, so reading the cells column by column can't pass.
 */
const TILESET = (x: number, y: number): Px => {
  const i = Math.floor(y / 16) * 4 + Math.floor(x / 16);
  const [cx, cy] = [x % 16, y % 16];
  if (i === 5) return null;
  if (i === 6) return { hex: PALETTE.red, a: 100 };
  if (cx >= 13 && cy < 3) return null;
  if (cx === 12 && cy === 0) return { hex: PALETTE.white, a: 127 };
  if (cx === 11 && cy === 0) return { hex: PALETTE[NAMES[(i + 3) % 16]!], a: 128 };
  if (cx === cy) return { hex: PALETTE[NAMES[(i + 5) % 16]!] };
  if (cx >= 2 + (i % 8) && cx < 6 + (i % 8) && cy >= 9 && cy < 13) return { hex: PALETTE[NAMES[(i + 11) % 16]!] };
  return { hex: PALETTE[NAMES[i]!] };
};

/** One 16 × 16 cell of `n` distinct colours, one a pixel (the rest transparent). */
const many = (n: number) => sheet(16, 16, (x, y) => (y * 16 + x < n ? { hex: 0x101010 + (y * 16 + x) * 0x010203 } : null));

/** The baked texel (x, y) of a def as [r, g, b, a]. */
const texel = (def: TextureDef, x: number, y: number) => {
  const b = bakeTexture(def);
  return [...b.rgba.subarray((y * b.width + x) * 4, (y * b.width + x) * 4 + 4)];
};

/**
 * Every texel of every imported cell against its source pixel: transparent under the threshold,
 * else the PALETTE colour `colourOf` says the source colour maps to. Cell for cell, pixel for pixel.
 */
function expectExact(img: RgbaImage, r: ReturnType<typeof importSheet>, colourOf: (hex: number) => PaletteColor, alpha = 128): number {
  const [gw, gh] = [img.width / r.columns, img.height / r.rows];
  const bakes = new Map(r.defs.map((d) => [d.id, bakeTexture(d)]));
  const strips = new Map<string, number[]>();
  for (const c of r.cells) if (c.id) strips.set(c.id, [...(strips.get(c.id) ?? []), c.index]);
  let checked = 0;
  for (const c of r.cells) {
    // the cell's place from its index alone (reading order), never from what the importer says
    expect([c.column, c.row], `cell ${c.index}`).toEqual([c.index % r.columns, Math.floor(c.index / r.columns)]);
    if (!c.id) continue;
    const b = bakes.get(c.id)!;
    expect(b.problems, c.id).toEqual([]);
    const f = strips.get(c.id)!.indexOf(c.index);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const s = ((Math.floor(c.index / r.columns) * gh + y) * img.width + (c.index % r.columns) * gw + x) * 4;
        const t = (y * b.width + f * gw + x) * 4;
        const got = [...b.rgba.subarray(t, t + 4)];
        if (img.data[s + 3]! < alpha) expect(got, `${c.id} (${x}, ${y})`).toEqual([0, 0, 0, 0]);
        else {
          const hex = PALETTE[colourOf((img.data[s]! << 16) | (img.data[s + 1]! << 8) | img.data[s + 2]!)];
          expect(got, `${c.id} (${x}, ${y})`).toEqual([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]);
        }
        checked++;
      }
    }
  }
  return checked;
}

describe('importSheet: slicing', () => {
  it('a 4 × 4 tileset of 16 × 16 round-trips exactly, cell for cell, pixel for pixel', () => {
    const img = sheet(64, 64, TILESET);
    const r = importSheet(img, opts({ as: 'tiles', tile: true }));
    expect([r.columns, r.rows]).toEqual([4, 4]);
    // PALETTE colours map to themselves, so the bake is the source itself
    expect(expectExact(img, r, (hex) => NAMES.find((n) => PALETTE[n] === hex)!)).toBe(14 * 256);
    expect(r.merges).toEqual([]);
    expect(r.colours.length).toBe(16);
    expect(r.defs.map((d) => d.id)).toEqual([0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => `tiles-${i}`));
    for (const d of r.defs) {
      expect(d.size).toEqual([16, 16]);
      expect(d.tile).toBe(true);
      expect(d.layers).toHaveLength(1);
      expect(validateTexture(d).problems, d.id).toEqual([]);
    }
    // and a sheet that isn't square: its top two rows, 4 × 2 cells
    const wide = sheet(64, 32, TILESET);
    const w = importSheet(wide, opts({ as: 'tiles' }));
    expect([w.columns, w.rows, w.defs.length]).toEqual([4, 2, 6]);
    expect(expectExact(wide, w, (hex) => NAMES.find((n) => PALETTE[n] === hex)!)).toBe(6 * 256);
  });

  it('skips fully transparent cells (alpha under the threshold counts) and says which', () => {
    const r = importSheet(sheet(64, 64, TILESET), opts());
    expect(r.cells.filter((c) => !c.id).map((c) => [c.index, c.opaque])).toEqual([
      [5, 0],
      [6, 0],
    ]);
    expect(r.cells.filter((c) => c.picked && !c.id).map((c) => c.index)).toEqual([5, 6]);
    // a lower threshold keeps cell 6 (alpha 100) and the 127 pixel
    const low = importSheet(sheet(64, 64, TILESET), opts({ alpha: 100 }));
    expect(low.cells[6]!.id).toBe('fx-6');
    expect(texel(low.defs.find((d) => d.id === 'fx-0')!, 12, 0)).toEqual([0xf4, 0xf4, 0xf4, 255]);
  });

  it('the alpha threshold: 127 is transparent, 128 opaque (default 128)', () => {
    const r = importSheet(sheet(64, 64, TILESET), opts());
    const d = r.defs[0]!;
    expect(texel(d, 12, 0)[3]).toBe(0);
    expect(texel(d, 11, 0)[3]).toBe(255);
    expect((d.layers[0] as PixelsLayer).pixels[0]!.slice(11, 16)).toMatch(/^[^.]\.\.\.\.$/);
  });

  it('picks cells by index and names them; the colour map is the whole sheet’s either way', () => {
    const img = sheet(64, 64, TILESET);
    const all = importSheet(img, opts());
    const some = importSheet(img, opts({ cells: [1, 3, 5], names: ['', 'grass', '', 'water'] }));
    expect(some.defs.map((d) => d.id)).toEqual(['fx-grass', 'fx-water']); // 5 is empty
    expect(some.cells.map((c) => c.id).filter(Boolean)).toEqual(['fx-grass', 'fx-water']);
    // every cell is reported, only the picked ones as picked (5 picked though it went into no def)
    expect(some.cells).toHaveLength(all.cells.length);
    expect(some.cells.filter((c) => c.picked).map((c) => c.index)).toEqual([1, 3, 5]);
    expect(importSheet(img, opts({ cells: [5, 0, 5] })).cells.filter((c) => c.picked).map((c) => c.index)).toEqual([0, 5]);
    expect(all.cells.every((c) => c.picked)).toBe(true);
    // the same cell imported alone or with the rest: same rows, legend and palette
    const strip = (d: TextureDef) => ({ ...d, id: '', about: '' });
    expect(strip(some.defs[0]!)).toEqual(strip(all.defs[1]!));
    expect(strip(some.defs[1]!)).toEqual(strip(all.defs[3]!));
  });

  it('records provenance: the caller’s source, the tool and each slot’s source colour', () => {
    const r = importSheet(sheet(64, 64, TILESET), opts());
    const d = r.defs[0]!;
    expect(d.source).toMatchObject({ ...SOURCE, tool: SHEET_IMPORT_TOOL });
    expect(Object.keys(d.source!.colours!)).toEqual(Object.keys(d.palette));
    for (const [slot, hex] of Object.entries(d.source!.colours!)) expect(parseInt(hex.slice(1), 16)).toBe(PALETTE[d.palette[slot]!]);
    expect(d.about).toBe('Cell 0 (column 0, row 0) of fixture.png, 16 x 16');
  });

  it('is deterministic', () => {
    const a = importSheet(sheet(64, 64, TILESET), opts({ tile: true }));
    const b = importSheet(sheet(64, 64, TILESET), opts({ tile: true }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('importSheet: merges', () => {
  // cell 0: sand, a near-identical sand (must merge) and teal; cell 1: orange and two off-palette
  // colours far apart (a green and a blue) that must stay apart
  const NEAR_SAND = 0xfdcb77;
  const MIXED = (x: number, y: number): Px => {
    const [cx, cy] = [x % 16, y];
    if (x < 16) return { hex: cy < 2 ? NEAR_SAND : cx < 4 ? PALETTE.teal : PALETTE.sand };
    return { hex: cy > 12 ? 0x30a060 : cx < 3 ? 0x4060d0 : PALETTE.orange };
  };

  it('reports exactly the colours that share an entry, and keeps distinct ones apart', () => {
    const img = sheet(32, 16, MIXED);
    const r = importSheet(img, opts());
    expect(r.merges.map((m) => ({ colour: m.colour, sources: m.sources.map((c) => [c.hex, c.pixels]) }))).toEqual([
      {
        colour: 'sand',
        sources: [
          [PALETTE.sand, 12 * 14],
          [NEAR_SAND, 32],
        ],
      },
    ]);
    const to = Object.fromEntries(r.colours.map((c) => [c.hex, c.colour]));
    expect(to).toEqual({ [PALETTE.sand]: 'sand', [NEAR_SAND]: 'sand', [PALETTE.teal]: 'teal', [PALETTE.orange]: 'orange', [0x30a060]: 'green', [0x4060d0]: 'blue' });
    // each source colour keeps a character: the merged pair is two characters on one slot
    const sand = r.colours.find((c) => c.hex === PALETTE.sand)!;
    const near = r.colours.find((c) => c.hex === NEAR_SAND)!;
    expect([sand.char, near.char, sand.slot === near.slot]).toEqual(['s', 'a', true]);
    expect(r.defs[0]!.layers[0]).toMatchObject({ legend: { s: sand.slot, a: sand.slot } });
    // and the bake is each pixel's mapped entry
    expect(expectExact(img, r, (hex) => to[hex]!)).toBe(2 * 256);
  });

  it('reports two distinct colours the mapper itself puts on one entry, in slots of their own', () => {
    // a pale sand and a duller one: too far apart to cluster, both nearest sand
    const DULL = 0xe0c080;
    const r = importSheet(sheet(16, 16, (x) => ({ hex: x < 10 ? PALETTE.sand : DULL })), opts());
    const [sand, dull] = [PALETTE.sand, DULL].map((hex) => r.colours.find((c) => c.hex === hex)!);
    expect([sand!.colour, dull!.colour, sand!.slot === dull!.slot]).toEqual(['sand', 'sand', false]);
    expect(r.merges.map((m) => [m.colour, m.sources.map((c) => [c.hex, c.pixels])])).toEqual([
      [
        'sand',
        [
          [PALETTE.sand, 160],
          [DULL, 96],
        ],
      ],
    ]);
  });

  it('reports the imported cells only: their colours, pixels and merges', () => {
    const img = sheet(32, 16, MIXED);
    const one = importSheet(img, opts({ cells: [1] }));
    expect(one.merges).toEqual([]); // the sands are in cell 0
    expect(one.colours.map((c) => [c.hex, c.pixels])).toEqual([
      [PALETTE.orange, 169],
      [0x30a060, 48],
      [0x4060d0, 39],
    ]);
    // characters and slots stay the sheet's
    const all = importSheet(img, opts());
    for (const c of one.colours) expect(c).toEqual(all.colours.find((a) => a.hex === c.hex));
  });

  it('reports slots that share an entry once re-bound, and refuses a slot the sheet lacks', () => {
    const img = sheet(32, 16, MIXED);
    const teal = importSheet(img, opts()).colours.find((c) => c.hex === PALETTE.teal)!.slot;
    const r = importSheet(img, opts({ palette: { [teal]: 'sand' } }));
    expect(r.merges.map((m) => [m.colour, m.sources.map((c) => c.hex)])).toEqual([['sand', [PALETTE.sand, PALETTE.teal, NEAR_SAND]]]);
    expect(r.defs[0]!.palette[teal]).toBe('sand');
    // re-binding never changes the rows: a palette fix is only a palette fix
    expect(r.defs[0]!.layers).toEqual(importSheet(img, opts()).defs[0]!.layers);
    expect(() => importSheet(img, opts({ palette: { c99: 'sand' } }))).toThrow(/re-binds slot 'c99', which the sheet doesn't have/);
  });

  it('hands out a character per colour, up to the legend budget, and refuses more', () => {
    expect(new Set(LEGEND_CHARS).size).toBe(LEGEND_CHARS.length);
    expect(LEGEND_CHARS).not.toMatch(/[.\s'\\`]/);
    const r = importSheet(many(LEGEND_CHARS.length), opts());
    expect(new Set(r.colours.map((c) => c.char)).size).toBe(LEGEND_CHARS.length);
    expect(expectExact(many(LEGEND_CHARS.length), r, (hex) => r.colours.find((c) => c.hex === hex)!.colour)).toBe(256);
    expect(() => importSheet(many(LEGEND_CHARS.length + 1), opts())).toThrow(/91 distinct colours, over 90/);
  });
});

describe('importSheet: frames', () => {
  /** A dot moving right across 8 cells of 8 × 8: frames 0–2 and 4–5 drawn, 3, 6 and 7 blank. */
  const STRIP = (x: number, y: number): Px => {
    const f = Math.floor(x / 8);
    if (f === 3 || f >= 6) return null;
    const [cx, cy] = [x % 8, y];
    if (cx === 1 + f && cy >= 2 && cy < 5) return { hex: PALETTE.sand };
    if (cy === 7) return { hex: PALETTE.slate };
    return null;
  };

  it('a strip imports as one def of frames, a blank frame inside kept and blank ends dropped', () => {
    const img = sheet(64, 8, STRIP);
    const r = importSheet(img, opts({ as: 'dot', grid: [8, 8], frames: true }));
    expect(r.defs).toHaveLength(1);
    const d = r.defs[0]!;
    expect([d.id, d.frames, d.size]).toEqual(['dot', 6, [48, 8]]);
    expect(r.cells.map((c) => c.id)).toEqual(['dot', 'dot', 'dot', 'dot', 'dot', 'dot', null, null]);
    expect(expectExact(img, r, (hex) => NAMES.find((n) => PALETTE[n] === hex)!)).toBe(6 * 64);
    expect(validateTexture(d).problems).toEqual([]);
    // a leading blank is dropped too
    const late = importSheet(img, opts({ as: 'dot', grid: [8, 8], frames: true, cells: [3, 4, 5] }));
    expect([late.defs[0]!.frames, late.cells.filter((c) => c.id).map((c) => c.index)]).toEqual([2, [4, 5]]);
    // `about` names the cells it took
    expect(d.about).toBe('6 frames of 8 x 8: cells 0 to 5 of fixture.png');
    expect(importSheet(img, opts({ as: 'dot', grid: [8, 8], frames: true, cells: [0, 2, 4, 5] })).defs[0]!.about).toBe('4 frames of 8 x 8: cells 0, 2, 4, 5 of fixture.png');
  });
});

describe('the draft (`npm run tex -- import` writes it)', () => {
  it('is the defs: written as source and imported back, every one equal, every legend character included', async () => {
    const strip = sheet(64, 8, (x, y) => (x % 8 === y ? { hex: PALETTE.sand } : null));
    const defs = [...importSheet(many(LEGEND_CHARS.length), opts({ as: 'many' })).defs, ...['new', 'eval'].flatMap((as) => importSheet(strip, opts({ as, grid: [8, 8], frames: true, tile: true })).defs)];
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const dir = join(root, '.scratch/test/tex-import');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `draft-${process.pid}.ts`);
    const text = textureDefsSource(defs, relative(dir, join(root, 'src/engine/texture')).split(sep).join('/'));
    writeFileSync(file, text);
    // the draft has no types, so it is a module as it stands: Node parses it as strictly as the
    // tools' loader does (vitest's transform lets `export const eval` through; Node and tsx don't)
    const mjs = file.replace(/\.ts$/, '.mjs');
    writeFileSync(mjs, text);
    try {
      const parsed = spawnSync(process.execPath, ['--check', mjs], { encoding: 'utf8' });
      expect(parsed.status, parsed.stderr).toBe(0);
      const mod = (await import(pathToFileURL(file).href)) as Record<string, TextureDef>;
      expect(Object.keys(mod).sort()).toEqual(['many0', 'teval', 'tnew']);
      expect([mod.many0, mod.tnew, mod.teval]).toEqual(defs);
    } finally {
      rmSync(file, { force: true });
      rmSync(mjs, { force: true });
    }
  });
});

describe('importSheet: refusals say what to do', () => {
  const img = sheet(64, 64, TILESET);
  it('refuses a grid the sheet is not whole cells of, cells off the sheet, clashing names, empty picks', () => {
    expect(() => importSheet(img, opts({ grid: [24, 24] }))).toThrow(ImportError);
    expect(() => importSheet(img, opts({ grid: [24, 24] }))).toThrow(/not whole 24 x 24 cells: .* crop it to 48 x 48/);
    expect(() => importSheet(img, opts({ cells: [3, 16] }))).toThrow(/cells 16 aren't on the sheet: it has 16/);
    expect(() => importSheet(img, opts({ names: ['a', 'a'] }))).toThrow(/'a' is given twice/);
    expect(() => importSheet(img, opts({ names: ['', '2'] }))).toThrow(/two cells would both be 'fx-2'/);
    expect(() => importSheet(img, opts({ cells: [5, 6] }))).toThrow(/all transparent/);
    expect(() => importSheet(img, opts({ cells: [5, 6], frames: true }))).toThrow(/all transparent/);
    expect(() => importSheet(img, opts({ as: 'Bad Name' }))).toThrow(/prefix/);
    expect(() => importSheet(img, opts({ as: '../tiles' }))).toThrow(/ids name files/);
    expect(importSheet(img, opts({ as: 'kit/tiles', cells: [0] })).defs.map((d) => d.id)).toEqual(['kit/tiles-0']);
    expect(() => importSheet(sheet(16, 16, () => null), opts())).toThrow(/no opaque pixel/);
  });
});

describe('licences on textures (the models’ rule)', () => {
  const def = importSheet(sheet(64, 64, TILESET), opts()).defs[0]!;
  const with_ = (source: Partial<NonNullable<TextureDef['source']>>) => validateTexture({ ...def, source: { ...def.source!, ...source } as TextureDef['source'] }).problems;

  it('allows our own work from inside the repo; refuses anyone else’s outside an approved pack, a missing url or licence, or one not allowed', () => {
    expect(with_({})).toEqual([]);
    expect(with_({ url: 'https://github.com/michaelcrosato/riftlight/blob/main/art/tiles.png' })).toEqual([]);
    expect(with_({ url: 'https://example.test/tiles.png' })).toEqual([expect.stringMatching(/own work with an outside source/)]);
    expect(with_({ url: '../elsewhere/tiles.png' })).toEqual([expect.stringMatching(/own work with an outside source/)]);
    // a lone third-party file, CC0 included, names no approved pack
    expect(with_({ licence: 'CC0-1.0', url: 'https://example.test/tiles.png' })).toEqual([expect.stringMatching(/'CC0-1.0' is not allowed without an approved pack/)]);
    expect(with_({ licence: '' })).toEqual([expect.stringMatching(/no licence/)]);
    expect(with_({ url: '' })).toEqual([expect.stringMatching(/no url/)]);
    expect(with_({ licence: 'CC-BY-SA-4.0' })).toEqual([expect.stringMatching(/'CC-BY-SA-4.0' is not allowed/)]);
    expect(with_({ licence: 'CC-BY-4.0' })).toEqual([expect.stringMatching(/not allowed without an approved pack/)]);
    // someone else's pack, CC0 or not, only once PACK_SOURCES approves it (none is, yet)
    expect(with_({ licence: 'CC0-1.0', pack: 'thirdparty' })).toEqual([expect.stringMatching(/pack 'thirdparty', which is not approved in PACK_SOURCES/)]);
    expect(with_({ licence: 'CC-BY-4.0', pack: 'thirdparty' })).toEqual([expect.stringMatching(/which is not approved in PACK_SOURCES/)]);
    // a texture with no source (drawn here, not imported) owes nothing
    expect(validateTexture({ ...def, source: undefined }).problems).toEqual([]);
  });

  it('model -- credits lists imported textures, grouped with models from the same source', () => {
    const textures = importSheet(sheet(32, 16, MIXED_FOR_CREDITS), opts({ as: 'mixed' })).defs;
    const model = { id: 'own-chair', source: { url: SOURCE.url, licence: OWN_LICENCE, author: 'riftlight' } };
    const entries = creditEntries([model, { id: 'drawn' }], [...textures, { id: 'drawn-tex' }]);
    expect(entries).toEqual([{ what: SOURCE.url, author: 'riftlight', licence: OWN_LICENCE, name: 'our own work', credit: 'none', url: SOURCE.url, models: ['own-chair'], textures: ['mixed-0', 'mixed-1'] }]);
    expect(creditLines(entries).at(-1)).toBe(`- **${SOURCE.url}** by riftlight, our own work (${OWN_LICENCE}): ${SOURCE.url}. Models: own-chair. Textures: mixed-0, mixed-1.`);
    expect(creditLines(creditEntries([], [])).at(-1)).toBe('Nothing imported yet: nothing to credit.');
  });
});

describe("a pack's sheet (tex -- import-pack)", () => {
  // four cells, 2 x 2: green, sky, red, blue
  const four = () => sheet(32, 32, (x, y) => ({ hex: [PALETTE.green, PALETTE.sky, PALETTE.red, PALETTE.blue][(y >> 4) * 2 + (x >> 4)]! }));
  const SRC = { ...SOURCE, pack: 'fx-pack' };

  it('names, tags and tiles each cell, in reading order, unnamed cells kept in place', () => {
    const { defs } = importPackSheet(four(), { pack: 'fx-pack', title: 'Fx Pack 1.0', tags: ['sprite'], source: SRC, sheet: { file: 'Tiles/sheet.png', grid: [16, 16], names: ['grass', '', 'knight', 'water'], tiles: ['grass', 'water'], tags: ['town'] } });
    expect(defs.map((d) => d.id)).toEqual(['fx-pack/grass', 'fx-pack/1', 'fx-pack/knight', 'fx-pack/water']);
    expect(defs.map((d) => d.tile === true)).toEqual([true, false, false, true]);
    expect(defs[0]!.about).toBe('Grass (imported from Fx Pack 1.0: sheet.png)');
    expect(defs[0]!.tags).toEqual(['imported', 'fx-pack', 'sprite', 'town', 'surface', 'nature', 'plant', 'grass']);
    expect(defs[2]!.tags).toEqual(['imported', 'fx-pack', 'sprite', 'town', 'character']);
    for (const d of defs) expect(validateTexture(d).problems, d.id).toEqual([]);
  });

  it('a sheet of nothing but tiles imports; ids that collide are refused; the sheet re-binds its own slots', () => {
    const all = importPackSheet(four(), { pack: 'fx-pack', source: SRC, sheet: { file: 's.png', grid: [16, 16], names: ['a', 'b', 'c', 'd'], tiles: ['a', 'b', 'c', 'd'] } });
    expect(all.defs.every((d) => d.tile)).toBe(true);
    expect(() => importPackSheet(four(), { pack: 'fx-pack', source: SRC, sheet: { file: 's.png', grid: [16, 16], names: ['', '', '', '0'] } })).toThrow(ImportError);
    const plain = importPackSheet(four(), { pack: 'fx-pack', source: SRC, sheet: { file: 's.png', grid: [16, 16] } });
    const slot = Object.keys(plain.defs[2]!.palette)[0]!;
    expect(plain.defs[2]!.palette[slot]).toBe('red');
    const rebound = importPackSheet(four(), { pack: 'fx-pack', source: SRC, sheet: { file: 's.png', grid: [16, 16], palette: { [slot]: 'orange' } } });
    expect(rebound.defs[2]!.palette[slot]).toBe('orange');
  });
});

