/**
 * 2D import (docs/plans/asset-system.md §7.5, docs/assets/importing.md *Pixel-art sheets*): a pixel-art sheet (a
 * decoded PNG) sliced on a grid into TextureDefs of `pixels` layers: one def per cell, or one def
 * of frames for an animation strip. Slicing is exact: every pixel keeps its place, alpha under
 * the threshold is transparent, and a cell with no opaque pixel is skipped.
 *
 * Colours go through the mesh importer's mapper (`mapColours`, §7.3) once for the whole sheet,
 * so a colour reads the same in every cell. Each distinct source colour keeps a legend character
 * of its own (a hint at its PALETTE entry where one is free: `i` for ink); the legend maps it to
 * its slot and the palette binds the slot to an entry. Two source colours on one slot show as two
 * characters on that slot, and `merges` lists every PALETTE entry two or more source colours
 * landed on, so a bad merge is a one-line fix: point the character at a slot of its own.
 *
 *   const sheet = importSheet(decodePng(bytes, inflateSync), {
 *     as: 'dungeon', grid: [16, 16], tile: true,
 *     source: { url: 'src/game/art/dungeon.ts', licence: 'LicenseRef-own', file: 'dungeon.png' },
 *   });
 *
 * (Anyone else's sheet, CC0 included, comes in only through a pack whose `PACK_SOURCES` entry is
 * approved: `source.pack` names it, and `validateTexture` refuses the def otherwise.)
 */
import { IMPORT_ID, ImportError } from '../model/import/common';
import { hexString, mapColours, type ColourMap } from '../model/import/colours';
import { describeImport } from '../model/import/describe';
import type { PackSheet } from '../model/packs/sources';
import type { Provenance } from '../model/types';
import { isPaletteName, type PaletteColor } from '../palette';
import type { RgbaImage } from '../png';
import type { TexSlot, TextureDef } from './types';

/** What `source.tool` records. */
export const SHEET_IMPORT_TOOL = 'npm run tex -- import';
/** Alpha (0–255) under which a pixel is transparent, by default. */
export const ALPHA_THRESHOLD = 128;
/** Most texels a side (`bakeTexture`'s limit). */
const MAX_SIDE = 1024;
/** Legend characters, in the order they are handed out: every printable ASCII but `.`, space, quotes and backslash. */
export const LEGEND_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=@^~!?<>/|:;_()[]{},"ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface SheetImportOptions {
  /** The ids' prefix (`IMPORT_ID`: `tiles`, `kit/tiles`): cells are `<as>-<index>` (or `<as>-<name>`), a strip of frames is `<as>`. */
  readonly as: string;
  /** A cell's size in pixels, width × height; the sheet must be whole cells. */
  readonly grid: readonly [w: number, h: number];
  /** What the caller knows of the source (url, licence, pack, file, author, sha256); the import adds `tool` and `colours`. */
  readonly source: Omit<Provenance, 'tool' | 'colours' | 'fidelity'>;
  /** The cells are surfaces that tile: each def gets `tile: true` (the check measures the seam). */
  readonly tile?: boolean;
  /** One def of frames, left to right, from the cells in reading order (an animation strip). */
  readonly frames?: boolean;
  /** Cells to import by index, in reading order (row by row from the top; default every cell). */
  readonly cells?: readonly number[];
  /** Names by cell index, in reading order: cell `i` becomes `<as>-<names[i]>` ('' keeps the index). */
  readonly names?: readonly string[];
  /** Alpha (0–255) under which a pixel is transparent (default `ALPHA_THRESHOLD`). */
  readonly alpha?: number;
  /** Slots re-bound after mapping, for every def at once: `{ c3: 'sand' }`. */
  readonly palette?: Readonly<Record<TexSlot, PaletteColor>>;
  readonly tags?: readonly string[];
}

/** A distinct opaque source colour of the imported cells and where it went. */
export interface SheetColour {
  /** Source sRGB, 0xrrggbb. */
  readonly hex: number;
  /** Its legend character in every def (the same in any import of the sheet). */
  readonly char: string;
  readonly slot: TexSlot;
  /** The PALETTE entry it bakes as (after any re-binding). */
  readonly colour: PaletteColor;
  /** Opaque pixels of it in the imported cells. */
  readonly pixels: number;
}

/** Two or more distinct source colours that bake as one PALETTE entry. */
export interface SheetMerge {
  readonly colour: PaletteColor;
  /** Biggest first. They share a slot when the mapper clustered them, else their slots share the entry. */
  readonly sources: readonly SheetColour[];
}

export interface SheetCell {
  /** Index in reading order: row × columns + column. */
  readonly index: number;
  readonly column: number;
  readonly row: number;
  /** Opaque pixels in it. */
  readonly opaque: number;
  /** Picked (`cells`, default every cell). */
  readonly picked: boolean;
  /** The def it went into, or null: not picked, or picked and skipped as fully transparent. */
  readonly id: string | null;
}

export interface SheetImport {
  readonly defs: readonly TextureDef[];
  /** Every distinct opaque source colour of the imported cells, biggest first. */
  readonly colours: readonly SheetColour[];
  /** Every PALETTE entry two or more of those colours bake as, biggest first. */
  readonly merges: readonly SheetMerge[];
  /** The mapper's result (slots and their entries, before `palette` re-binds them). */
  readonly map: ColourMap;
  /** Every cell of the grid, in reading order. */
  readonly cells: readonly SheetCell[];
  readonly columns: number;
  readonly rows: number;
}

const whole = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Cell indices as text, runs of three or more joined: `0, 2, 3` or `0 to 7, 9`. */
function cellList(cells: readonly number[]): string {
  const runs: number[][] = [];
  for (const i of cells) {
    const run = runs[runs.length - 1];
    if (run && i === run[run.length - 1]! + 1) run.push(i);
    else runs.push([i]);
  }
  return runs.map((r) => (r.length > 2 ? `${r[0]} to ${r[r.length - 1]}` : r.join(', '))).join(', ');
}

/** Legend characters for the colours, biggest first: a free letter of the entry's name, else the next free one. */
function legendChars(colours: readonly { hex: number; entry: PaletteColor }[]): string[] {
  const taken = new Set<string>();
  return colours.map(({ entry }) => {
    const ch = [...new Set(entry.toLowerCase().replace(/[^a-z]/g, ''))].find((c) => !taken.has(c)) ?? [...LEGEND_CHARS].find((c) => !taken.has(c))!;
    taken.add(ch);
    return ch;
  });
}

/** Slice a pixel-art sheet into TextureDefs (see the file comment). Throws `ImportError` saying what to fix. */
export function importSheet(img: RgbaImage, o: SheetImportOptions): SheetImport {
  const [gw, gh] = Array.isArray(o.grid) ? o.grid : [Number.NaN, Number.NaN];
  if (!whole(gw, 1, MAX_SIDE) || !whole(gh, 1, MAX_SIDE)) throw new ImportError(`grid ${JSON.stringify(o.grid)} isn't [width, height], two whole numbers of pixels from 1 to ${MAX_SIDE}`);
  if (img.width % gw || img.height % gh) throw new ImportError(`the sheet is ${img.width} x ${img.height}, not whole ${gw} x ${gh} cells: pick the grid its cells are drawn on, or crop it to ${img.width - (img.width % gw)} x ${img.height - (img.height % gh)}`);
  if (!IMPORT_ID.test(o.as)) throw new ImportError(`id prefix '${o.as}' isn't like tiles or kit/tiles (${IMPORT_ID}): ids name files`);
  const alpha = o.alpha ?? ALPHA_THRESHOLD;
  if (!whole(alpha, 0, 255)) throw new ImportError(`alpha threshold ${o.alpha} isn't a whole number from 0 to 255`);
  const columns = img.width / gw;
  const rows = img.height / gh;
  const count = columns * rows;
  const picked = o.cells ? [...new Set(o.cells)].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i);
  const outside = picked.filter((i) => !whole(i, 0, count - 1));
  if (outside.length) throw new ImportError(`cells ${outside.join(', ')} aren't on the sheet: it has ${count} (0 to ${count - 1}, row by row from the top, ${columns} a row)`);
  const names = (o.names ?? []).map((n) => n.trim());
  for (const n of names) if (n && !/^[a-z0-9][a-z0-9-]*$/.test(n)) throw new ImportError(`cell name '${n}' isn't lower-case letters, digits and dashes`);
  const dup = names.find((n, i) => n && names.indexOf(n) !== i);
  if (dup) throw new ImportError(`cell name '${dup}' is given twice`);

  // the sheet's colours, counted over every cell (picked or not), so a colour maps the same in any import of it
  const d = img.data;
  const opaque = (k: number) => d[k * 4 + 3]! >= alpha;
  const hexAt = (k: number) => (d[k * 4]! << 16) | (d[k * 4 + 1]! << 8) | d[k * 4 + 2]!;
  const counts = new Map<number, number>();
  for (let k = 0; k < img.width * img.height; k++) if (opaque(k)) counts.set(hexAt(k), (counts.get(hexAt(k)) ?? 0) + 1);
  if (!counts.size) throw new ImportError(`the sheet has no opaque pixel (alpha ${alpha} or more)`);
  if (counts.size > LEGEND_CHARS.length) throw new ImportError(`the sheet has ${counts.size} distinct colours, over ${LEGEND_CHARS.length}: pixel art has a few dozen. Is it smoothed, scaled or a photo? (the photo importer isn't built: docs/assets/importing.md *Pixel-art sheets*)`);
  const map = mapColours([...counts].map(([hex, area]) => ({ hex, area })), { min: 1, max: 16 });

  // re-bindings, then each colour's slot, entry and character
  const slots = map.slots.map((s) => s.slot);
  for (const [slot, colour] of Object.entries(o.palette ?? {})) {
    if (!slots.includes(slot)) throw new ImportError(`the palette re-binds slot '${slot}', which the sheet doesn't have (${slots.join(', ')})`);
    if (!isPaletteName(colour)) throw new ImportError(`the palette re-binds slot '${slot}' to ${JSON.stringify(colour)}, not a PALETTE colour`);
  }
  const entryOf = Object.fromEntries(map.slots.map((s) => [s.slot, o.palette?.[s.slot] ?? s.colour])) as Record<TexSlot, PaletteColor>;
  const order = [...counts].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  const mapped = order.map(([hex]) => {
    const slot = map.of[hexString(hex)]!;
    return { hex, slot, entry: map.slots.find((s) => s.slot === slot)!.colour };
  });
  const chars = legendChars(mapped);
  /** Every colour of the sheet: its character, slot and entry (the same whichever cells are imported). */
  const sheetColours = mapped.map((m, i) => ({ hex: m.hex, char: chars[i]!, slot: m.slot, colour: entryOf[m.slot]! }));
  const byHex = new Map(sheetColours.map((c) => [c.hex, c]));

  /** A cell's rows of legend characters ('.' transparent), how many pixels are opaque, and of which colours. */
  const cellRows = (i: number) => {
    const x0 = (i % columns) * gw;
    const y0 = Math.floor(i / columns) * gh;
    let n = 0;
    const out: string[] = [];
    const of = new Map<number, number>();
    for (let y = 0; y < gh; y++) {
      let r = '';
      for (let x = 0; x < gw; x++) {
        const k = (y0 + y) * img.width + x0 + x;
        if (!opaque(k)) r += '.';
        else {
          r += byHex.get(hexAt(k))!.char;
          of.set(hexAt(k), (of.get(hexAt(k)) ?? 0) + 1);
          n++;
        }
      }
      out.push(r);
    }
    return { rows: out, opaque: n, of };
  };
  const all = Array.from({ length: count }, (_, i) => cellRows(i));

  /** The def's palette, legend and source colours: only what its rows use, in slot and colour order. */
  const used = (rows: readonly string[]) => {
    const inRows = new Set(rows.join(''));
    const cs = sheetColours.filter((c) => inRows.has(c.char));
    const usedSlots = slots.filter((s) => cs.some((c) => c.slot === s));
    return {
      palette: Object.fromEntries(usedSlots.map((s) => [s, entryOf[s]!])),
      legend: Object.fromEntries(cs.map((c) => [c.char, c.slot])),
      colours: Object.fromEntries(usedSlots.map((s) => [s, hexString(map.slots.find((m) => m.slot === s)!.source)])),
    };
  };
  const tags = o.tags ?? ['imported', ...(o.source.pack ? [o.source.pack] : [])];
  const file = o.source.file ?? o.source.url;
  const at = (i: number) => `column ${i % columns}, row ${Math.floor(i / columns)}`;
  const defOf = (id: string, about: string, w: number, rows: readonly string[], frames?: number): TextureDef => {
    const u = used(rows);
    return {
      id,
      about,
      tags,
      size: [w, gh],
      ...(o.tile ? { tile: true } : {}),
      ...(frames ? { frames } : {}),
      palette: u.palette,
      layers: [{ pixels: rows, legend: u.legend }],
      source: { ...o.source, tool: SHEET_IMPORT_TOOL, colours: u.colours },
    };
  };

  const ids = new Map<number, string>();
  const defs: TextureDef[] = [];
  if (o.frames) {
    // a strip: the picked cells in order, blank ones at either end dropped (a blank frame inside stays)
    const first = picked.findIndex((i) => all[i]!.opaque);
    if (first < 0) throw new ImportError(`the picked cells are all transparent: no frames to import`);
    const last = picked.length - 1 - [...picked].reverse().findIndex((i) => all[i]!.opaque);
    const strip = picked.slice(first, last + 1);
    if (strip.length * gw > MAX_SIDE) throw new ImportError(`${strip.length} frames of ${gw} are ${strip.length * gw} texels wide, over ${MAX_SIDE}: import fewer cells at a time (cells)`);
    const rowsOf = Array.from({ length: gh }, (_, y) => strip.map((i) => all[i]!.rows[y]).join(''));
    const span = strip.length > 1 ? `cells ${cellList(strip)}` : `cell ${strip[0]}`;
    defs.push(defOf(o.as, `${strip.length} frames of ${gw} x ${gh}: ${span} of ${file}`, strip.length * gw, rowsOf, strip.length));
    for (const i of strip) ids.set(i, o.as);
  } else {
    for (const i of picked) {
      if (!all[i]!.opaque) continue;
      const id = `${o.as}-${names[i] || i}`;
      ids.set(i, id);
      defs.push(defOf(id, `Cell ${i} (${at(i)}) of ${file}, ${gw} x ${gh}`, gw, all[i]!.rows));
    }
    if (!defs.length) throw new ImportError(`the picked cells are all transparent: nothing to import`);
  }
  const taken = new Set<string>();
  for (const def of defs) {
    if (taken.has(def.id)) throw new ImportError(`two cells would both be '${def.id}': a name is also another cell's index`);
    taken.add(def.id);
  }
  const isPicked = new Set(picked);
  const cells: SheetCell[] = all.map((c, index) => ({ index, column: index % columns, row: Math.floor(index / columns), opaque: c.opaque, picked: isPicked.has(index), id: ids.get(index) ?? null }));

  // what was imported: its colours (pixels counted in the imported cells) and the entries two or more of them bake as
  const pixels = new Map<number, number>();
  for (const i of ids.keys()) for (const [hex, n] of all[i]!.of) pixels.set(hex, (pixels.get(hex) ?? 0) + n);
  const colours: SheetColour[] = sheetColours.filter((c) => pixels.has(c.hex)).map((c) => ({ ...c, pixels: pixels.get(c.hex)! }));
  colours.sort((p, q) => q.pixels - p.pixels || p.hex - q.hex);
  const onEntry = new Map<PaletteColor, SheetColour[]>();
  for (const c of colours) onEntry.set(c.colour, [...(onEntry.get(c.colour) ?? []), c]);
  const merges: SheetMerge[] = [...onEntry]
    .filter(([, cs]) => cs.length > 1)
    .map(([colour, sources]) => ({ colour, sources }))
    .sort((p, q) => q.sources.reduce((s, c) => s + c.pixels, 0) - p.sources.reduce((s, c) => s + c.pixels, 0) || (p.colour < q.colour ? -1 : 1));
  return { defs, colours, merges, map, cells, columns, rows };
}

/** What `importPackSheet` needs beside the image: the pack, its sheet entry, the provenance. */
export interface PackSheetOptions {
  readonly pack: string;
  readonly sheet: PackSheet;
  readonly source: SheetImportOptions['source'];
  /** The pack's name, for each texture's `about`. */
  readonly title?: string;
  /** Tags every texture of the pack gets. */
  readonly tags?: readonly string[];
}

/**
 * An approved pack's sheet (its `PACK_SOURCES` entry's `sheets`, `npm run tex -- import-pack`)
 * as textures: every cell in one pass (one colour map, the sheet's `palette` re-bindings, ids
 * checked once, reading order), each `<pack>/<name>` with its name in words as `about` and
 * library tags (`describeImport`), and `tile: true` (tag `surface`) on the cells `tiles` names.
 */
export function importPackSheet(img: RgbaImage, o: PackSheetOptions): { defs: TextureDef[]; sheet: SheetImport } {
  const names = o.sheet.names ?? [];
  const tiles = new Set(o.sheet.tiles ?? []);
  const sheet = importSheet(img, { as: o.pack, grid: [o.sheet.grid[0], o.sheet.grid[1]], source: o.source, names: [...names], ...(o.sheet.palette ? { palette: o.sheet.palette } : {}) });
  const file = o.sheet.file.split('/').pop();
  const defs = sheet.defs.map((d): TextureDef => {
    const name = d.id.slice(o.pack.length + 1);
    const tile = tiles.has(name);
    const { about, tags } = describeImport(name, { pack: o.pack, title: o.title, file, tags: [...(o.tags ?? []), ...(o.sheet.tags ?? []), ...(tile ? ['surface'] : [])] });
    return { ...d, id: `${o.pack}/${name}`, about, tags, ...(tile ? { tile: true } : {}) };
  });
  return { defs, sheet };
}

