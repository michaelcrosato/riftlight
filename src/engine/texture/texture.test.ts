import { NearestFilter, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';
import { bakeTexture, hudSprite, MAX_SEAM_EXCESS, PATTERNS, spriteSheet, TEXTURE_LIBRARY, TextureCatalog, TextureError, textureMap, textureMetrics, validateTexture, type Layer, type TextureDef } from '.';

const def = (layers: Layer[], extra: Partial<TextureDef> = {}): TextureDef => ({ id: 'tex-test', about: 'a test texture', tags: [], size: [8, 8], palette: { a: 'ink', b: 'orange', c: 'sand' }, layers, ...extra });
const at = (b: ReturnType<typeof bakeTexture>, x: number, y: number) => b.indices[y * b.width + x];
const problems = (d: TextureDef) => validateTexture(d).problems;
const warnings = (d: TextureDef) => validateTexture(d).warnings;

describe('bakeTexture', () => {
  it('pixels: legend slots, transparent . and space, at, mirror', () => {
    const b = bakeTexture(def([{ pixels: ['ab.', 'c b'], legend: { a: 'a', b: 'b', c: 'c' }, at: [1, 2] }]));
    expect([at(b, 1, 2), at(b, 2, 2), at(b, 3, 2), at(b, 1, 3), at(b, 2, 3), at(b, 3, 3)]).toEqual([1, 2, 0, 3, 0, 2]);
    expect(at(b, 0, 0)).toBe(0);
    const m = bakeTexture(def([{ pixels: ['ab'], legend: { a: 'a', b: 'b' }, mirror: 'x' }]));
    expect([0, 1, 2, 3].map((x) => at(m, x, 0))).toEqual([1, 2, 2, 1]);
    const v = bakeTexture(def([{ pixels: ['a', 'b'], legend: { a: 'a', b: 'b' }, mirror: 'y' }]));
    expect([0, 1, 2, 3].map((y) => at(v, 0, y))).toEqual([1, 2, 2, 1]);
  });

  it('RGBA from the palette, re-bindable, transparent texels zero', () => {
    const d = def([{ pixels: ['b.'], legend: { b: 'b' } }]);
    const b = bakeTexture(d);
    expect([...b.rgba.subarray(0, 8)]).toEqual([(PALETTE.orange >> 16) & 255, (PALETTE.orange >> 8) & 255, PALETTE.orange & 255, 255, 0, 0, 0, 0]);
    expect([...bakeTexture(d, { palette: { b: 'cyan' } }).rgba.subarray(0, 3)]).toEqual([(PALETTE.cyan >> 16) & 255, (PALETTE.cyan >> 8) & 255, PALETTE.cyan & 255]);
  });

  it('path fill and stroke, outline round opaque texels', () => {
    const square = bakeTexture(def([{ path: 'M2 2 H6 V6 H2 Z', fill: 'b' }]));
    expect(square.indices.filter((v) => v === 2).length).toBe(16);
    const ring = bakeTexture(def([{ pixels: ['..', '.bb', '.bb'], legend: { b: 'b' } }, { outline: 'a' }]));
    expect(ring.indices.filter((v) => v === 1).length).toBe(8); // the 4-neighbour ring of a 2×2 square
    const stroked = bakeTexture(def([{ path: 'M1 1 H6 V6 H1 Z', stroke: 'c' }]));
    expect(at(stroked, 1, 1)).toBe(3);
    expect(at(stroked, 3, 3)).toBe(0); // inside left empty
  });

  it('patterns are deterministic and fill with the ramp; overlays leave the rest', () => {
    const d = def([{ pattern: 'noise', colors: ['a', 'b', 'c'], seed: 3 }], { size: [16, 16], tile: true });
    expect(bakeTexture(d).indices).toEqual(bakeTexture(d).indices);
    expect(new Set(bakeTexture(d).indices)).toEqual(new Set([1, 2, 3]));
    expect(bakeTexture({ ...d, layers: [{ pattern: 'noise', colors: ['a', 'b', 'c'], seed: 4 }] }).indices).not.toEqual(bakeTexture(d).indices);
    const over = bakeTexture(def([{ pattern: 'checker', colors: ['a', 'a'] }, { pattern: 'scatter', colors: 'c', count: 3, seed: 1 }]));
    const counts = [1, 2, 3].map((v) => over.indices.filter((x) => x === v).length);
    expect(counts[0]! + counts[2]!).toBe(64);
    expect(counts[2]).toBeGreaterThan(0);
  });

  /**
   * Runs of one key along every row and column of a 3×3 tiling (the first and last run of each
   * line cut off, so every run counted is whole): their lengths by key and axis. A layout that
   * doesn't fit its size puts a sliver (or a doubled cell) on the wrap, which a run shows.
   */
  const runs = (b: ReturnType<typeof bakeTexture>, key: (v: number) => number) => {
    const W = b.width * 3;
    const H = b.height * 3;
    const get = (x: number, y: number) => key(b.indices[(y % b.height) * b.width + (x % b.width)]!);
    const out = { x: new Map<number, number[]>(), y: new Map<number, number[]>() };
    const line = (n: number, at: (i: number) => number, into: Map<number, number[]>) => {
      const found: [number, number][] = [];
      let start = 0;
      for (let i = 1; i <= n; i++) {
        if (i < n && at(i) === at(start)) continue;
        found.push([at(start), i - start]);
        start = i;
      }
      for (const [k, len] of found.slice(1, -1)) into.set(k, [...(into.get(k) ?? []), len]);
    };
    for (let y = 0; y < H; y++) line(W, (x) => get(x, y), out.x);
    for (let x = 0; x < W; x++) line(H, (y) => get(x, y), out.y);
    return out;
  };
  const even = (lengths: number[] | undefined) => (lengths?.length ? Math.max(...lengths) - Math.min(...lengths) : 0);
  const SIZES: [number, number][] = [[8, 8], [16, 16], [32, 16], [16, 32]];

  it('tiling layouts fit their size: no sliver of a brick, board, tile or checker cell on the wrap', () => {
    const joint = (v: number) => (v === 1 ? 0 : 1);
    for (const size of SIZES) {
      for (const seed of [1, 2]) {
        for (const w of [2, 3, 5, 6, 8, 11]) {
          for (const h of [2, 3, 4, 6, 7]) {
            for (const offset of [0, 0.3, 0.5]) {
              const b = bakeTexture(def([{ pattern: 'bricks', colors: ['a', 'b', 'c'], w, h, mortar: 1, offset, seed }], { size, tile: true }));
              const r = runs(b, joint);
              // courses that shift come in pairs: an odd count would line up the joints of the first and last
              const courses = Array.from({ length: b.height }, (_, y) => b.indices.subarray(y * b.width, (y + 1) * b.width).every((v) => v === 1)).filter(Boolean).length;
              if (offset > 0) expect(courses % 2, `bricks h ${h} offset ${offset} on ${size}: ${courses} courses`).toBe(0);
              expect(even(r.x.get(1)), `bricks w ${w} h ${h} offset ${offset} on ${size} (rows)`).toBeLessThanOrEqual(1);
              expect(even(r.y.get(1)), `bricks w ${w} h ${h} offset ${offset} on ${size} (columns)`).toBeLessThanOrEqual(1);
            }
          }
          for (const length of [4, 5, 7, 12, 20]) {
            const b = bakeTexture(def([{ pattern: 'planks', colors: ['a', 'b', 'c'], w, length, gap: 1, grain: 0, seed }], { size, tile: true }));
            const r = runs(b, joint);
            expect(even(r.x.get(1)), `planks w ${w} length ${length} on ${size} (along)`).toBeLessThanOrEqual(1);
            expect(even(r.y.get(1)), `planks w ${w} length ${length} on ${size} (across)`).toBeLessThanOrEqual(1);
          }
        }
        for (const cell of [1, 2, 3, 5, 6]) {
          const r = runs(bakeTexture(def([{ pattern: 'checker', colors: ['a', 'c'], cell }], { size, tile: true })), (v) => v);
          for (const k of [1, 3]) for (const axis of ['x', 'y'] as const) expect(even(r[axis].get(k)), `checker cell ${cell} on ${size}`).toBeLessThanOrEqual(1);
        }
      }
    }
  }, 30_000); // hundreds of layouts across sizes and parameters (~2 s alone, more on a loaded box)

  it('tiling stripes run whole cycles: every band follows the one before, across the wrap too', () => {
    for (const size of SIZES) {
      for (const width of [1, 2, 3, 5]) {
        for (const colors of [['a', 'b'], ['a', 'b', 'c']]) {
          for (const dir of ['x', 'y', 'diag'] as const) {
            const b = bakeTexture(def([{ pattern: 'stripes', colors, width, dir }], { size, tile: true }));
            const n = colors.length;
            // along each row (x, diag) or column (y), twice round: each change steps to the next slot
            const steps: number[] = [];
            for (let i = 1; i < 2 * (dir === 'y' ? b.height : b.width); i++) {
              const [x0, y0, x1, y1] = dir === 'y' ? [0, i - 1, 0, i] : [i - 1, 0, i, 0];
              const a = b.indices[(y0 % b.height) * b.width + (x0 % b.width)]!;
              const c = b.indices[(y1 % b.height) * b.width + (x1 % b.width)]!;
              if (a !== c) steps.push((c - a + n) % n);
            }
            expect(new Set(steps), `stripes width ${width} ${dir} over ${n} on ${size}`).toEqual(new Set([1]));
          }
        }
      }
    }
  });

  it('tiling cobbles, scatter and cracks wrap: stones close across the edge, shapes and walks carry on', () => {
    for (const size of SIZES) {
      for (const seed of [1, 2, 3, 4, 5]) {
        for (const cells of [2, 3, 4, 6]) {
          // two touching texels of different stones always have a joint between them, the wrap included
          const b = bakeTexture(def([{ pattern: 'cobbles', colors: ['a', 'b', 'c'], cells, gap: 1, seed }], { size, tile: true }));
          const v = (x: number, y: number) => b.indices[(((y % b.height) + b.height) % b.height) * b.width + (((x % b.width) + b.width) % b.width)]!;
          for (let y = 0; y < b.height; y++) {
            for (let x = 0; x < b.width; x++) {
              for (const [dx, dy] of [[1, 0], [0, 1]]) {
                const p = v(x, y);
                const q = v(x + dx!, y + dy!);
                if (p !== 1 && q !== 1) expect(p, `cobbles ${cells} seed ${seed} on ${size} at ${x},${y}`).toBe(q);
              }
            }
          }
        }
      }
    }
    // a star whose arms cross the edge keeps all five texels; a long crack keeps walking
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const star = bakeTexture(def([{ pattern: 'scatter', colors: 'c', count: 1, size: 3, shape: 'star', seed }], { tile: true }));
      expect(star.indices.filter((x) => x === 3).length, `star seed ${seed}`).toBe(5);
    }
    const walked = (tile: boolean) => [1, 2, 3, 4, 5, 6].reduce((n, seed) => n + bakeTexture(def([{ pattern: 'cracks', colors: 'a', count: 1, length: 64, seed }], { tile })).indices.filter((x) => x === 1).length, 0);
    expect(walked(true)).toBeGreaterThan(walked(false) * 1.5);
  });

  it('noise is continuous across the wrap when tiling, and not otherwise', () => {
    const field = (tile: boolean) => PATTERNS.noise!.field({ w: 32, h: 32, tile, n: 8, seed: 9, p: { scale: 4, octaves: 2 } });
    const jumps = (f: Float32Array) => {
      let wrap = 0;
      let inside = 0;
      for (let y = 0; y < 32; y++) {
        wrap += Math.abs(f[y * 32 + 31]! - f[y * 32]!);
        for (let x = 0; x < 31; x++) inside += Math.abs(f[y * 32 + x]! - f[y * 32 + x + 1]!);
      }
      return { wrap: wrap / 32, inside: inside / (32 * 31) };
    };
    const tiled = jumps(field(true));
    const open = jumps(field(false));
    expect(tiled.wrap).toBeLessThan(tiled.inside * 2);
    expect(open.wrap).toBeGreaterThan(open.inside * 2);
  });

  it('dither mixes neighbouring ramp steps', () => {
    const plain = bakeTexture(def([{ pattern: 'gradient', colors: ['a', 'c'], dir: 'x' }], { size: [16, 4] }));
    const dithered = bakeTexture(def([{ pattern: 'gradient', colors: ['a', 'c'], dir: 'x', dither: true }], { size: [16, 4] }));
    const changes = (b: ReturnType<typeof bakeTexture>) => [...Array(16).keys()].slice(1).filter((x) => at(b, x, 0) !== at(b, x - 1, 0)).length;
    expect(changes(plain)).toBe(1);
    expect(changes(dithered)).toBeGreaterThan(2);
  });
});

describe('validateTexture', () => {
  it('problems: unknown slot, legend, params, frames, colours, ragged rows, about and tags', () => {
    expect(problems(def([{ pixels: ['x'], legend: { x: 'gold' } }]))[0]).toMatch(/slot 'gold', which the palette does not declare/);
    expect(problems(def([{ pixels: ['ab'], legend: { a: 'a' } }]))[0]).toMatch(/pixel 'b', which its legend doesn't name/);
    expect(problems(def([{ pattern: 'bricks', colors: ['a', 'b'], w: 99 }]))[0]).toMatch(/bricks w = 99: use a whole number from 2 to 64/);
    expect(problems(def([{ pattern: 'bricks', colors: ['a', 'b'], w: 2.5 }]))[0]).toMatch(/bricks w = 2.5: use a whole number/);
    expect(problems(def([{ pattern: 'bricks', colors: ['a', 'b'], offset: 0.25 }]))).toEqual([]); // offset is a fraction
    expect(problems(def([{ pattern: 'stripes', colors: ['a', 'b'], dir: 'up' }]))[0]).toMatch(/stripes dir = "up": use one of y, x, diag/);
    expect(problems(def([{ pattern: 'checker', colors: ['a', 'b'], size: 3 }]))[0]).toMatch(/sets 'size', which checker doesn't take/);
    expect(problems(def([{ pattern: 'wobble' as 'noise', colors: 'a' }]))[0]).toMatch(/pattern "wobble", which doesn't exist/);
    expect(problems(def([{ pattern: 'toString' as 'noise', colors: 'a' }]))[0]).toMatch(/pattern "toString", which doesn't exist/);
    expect(problems(def([{ pattern: 'noise', colors: [] }]))[0]).toMatch(/no colors/);
    expect(problems(def([{ pattern: 'noise', colors: 'a', seed: 'x' as unknown as number }]))[0]).toMatch(/seed "x": use a whole number/);
    expect(problems(def([{ pattern: 'checker', colors: ['a', 'b'] }], { frames: 3 })).join()).toMatch(/3 frames don't divide its width 8/);
    expect(problems(def([{ pattern: 'checker', colors: ['a', 'b'] }], { palette: { a: 'brown' as 'ink', b: 'red' } })).join()).toMatch(/'a' is "brown", not a PALETTE colour/);
    expect(problems(def([{ pixels: ['aa', 'a'], legend: { a: 'a' } }])).join()).toMatch(/ragged rows/);
    expect(problems({ id: 'bare', size: [4, 4], palette: { a: 'ink' }, layers: [{ pixels: ['a'], legend: { a: 'a' } }] } as unknown as TextureDef)).toEqual([expect.stringMatching(/no `about`/), expect.stringMatching(/no `tags`/)]);
    expect(problems(def([]))[0]).toMatch(/no layers/);
    // malformed layers are problems, not crashes
    expect(problems(def([{ pixels: ['a'], legend: { a: 'a' }, mirrror: 'x' } as unknown as Layer]))[0]).toMatch(/sets 'mirrror', which a pixels layer doesn't take/);
    expect(problems(def([{ pixels: ['a'], legend: { a: 'a' }, mirror: 'z' as 'x' }]))[0]).toMatch(/mirror "z"/);
    expect(problems(def([{ path: 'M0 0 H4 V4 Z', fill: 'a', strok: 'b' } as unknown as Layer]))[0]).toMatch(/sets 'strok', which a path layer doesn't take/);
    expect(problems(def([{ outline: 'a', fill: 'b' } as unknown as Layer]))[0]).toMatch(/sets 'fill', which a outline layer doesn't take/);
    expect(problems(def([{ pixels: ['a'], legend: { a: 'a' }, pattern: 'noise', colors: 'a' } as unknown as Layer]))[0]).toMatch(/is pixels and pattern at once/);
    expect(problems(def([{ pixels: ['a'] } as unknown as Layer]))[0]).toMatch(/has no legend/);
    expect(problems({ id: 'x', about: '', tags: [], palette: { a: 'ink' }, layers: [] } as unknown as TextureDef).join()).toMatch(/isn't \[width, height\]/);
    expect(problems({ id: 'x', about: '', tags: [], size: [4, 4] } as unknown as TextureDef).join()).toMatch(/no palette.*no layers/);
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`s${i}`, 'ink'])) as Record<string, 'ink'>;
    expect(problems(def([{ pixels: ['a'], legend: { a: 's0' } }], { palette: many })).join()).toMatch(/256 slots: at most 255/);
    expect(bakeTexture(def([{ pixels: ['a'], legend: { a: 'a' } }]), { palette: { gold: 'sand' } }).problems[0]).toMatch(/re-binds slot 'gold'/);
    expect(bakeTexture(def([{ pixels: ['a'], legend: { a: 'a' } }]), { palette: { a: -1 } }).problems[0]).toMatch(/re-bound to -1, not a colour/);
  });

  it('warnings: a seam, salt and pepper, not a power of two, unused slots and legend keys', () => {
    expect(warnings(def([{ pattern: 'gradient', colors: ['a', 'b', 'c'] }], { tile: true })).join()).toMatch(/edges don't meet/);
    // drawn pixels whose edges don't meet, and ones that do; generated patterns wrap by construction
    const edge = (row: string) => warnings(def([{ pixels: Array(8).fill(row), legend: { a: 'a', b: 'b', c: 'c' } }], { size: [8, 8], tile: true })).join();
    expect(edge('aaaacccc')).not.toMatch(/edges don't meet/); // a joint on the wrap is one more joint
    expect(edge('aabbbbcc')).toMatch(/edges don't meet/); // dark, mid, light: the wrap jumps light to dark
    // cobbles seed 3 on 16 jumps more across its wrap than across any line inside, though it wraps by
    // construction: generated layers aren't measured, alone or under a drawn pixel that doesn't touch the edge
    const cobbles: Layer = { pattern: 'cobbles', colors: ['a', 'b', 'c'], cells: 4, seed: 3 };
    expect(textureMetrics(bakeTexture(def([cobbles], { size: [16, 16], tile: true })), true).seam!.wrap).toBeGreaterThan(textureMetrics(bakeTexture(def([cobbles], { size: [16, 16], tile: true })), true).seam!.inside + MAX_SEAM_EXCESS);
    expect(warnings(def([cobbles], { size: [16, 16], tile: true })).join()).not.toMatch(/edges don't meet/);
    expect(warnings(def([cobbles, { pixels: ['b'], legend: { b: 'b' }, at: [8, 8] }], { size: [16, 16], tile: true })).join()).not.toMatch(/edges don't meet/);
    expect(warnings(def([{ pattern: 'checker', colors: ['a', 'c'] }], { palette: { a: 'ink', c: 'sand' } })).join()).toMatch(/have no neighbour of their colour/);
    expect(warnings(def([{ pattern: 'checker', colors: ['a', 'c'], cell: 2 }], { palette: { a: 'ink', c: 'sand' } }))).toEqual([]);
    expect(warnings(def([{ pattern: 'noise', colors: ['a', 'b', 'c'] }], { size: [12, 12], tile: true })).join()).toMatch(/isn't a power of two/);
    expect(warnings(def([{ pattern: 'checker', colors: ['a', 'b'], cell: 2 }])).join()).toMatch(/palette slot 'c' never drawn/);
    expect(warnings(def([{ pixels: ['aa'], legend: { a: 'a', z: 'b' } }], { palette: { a: 'ink', b: 'red' } })).join()).toMatch(/legend names 'z', which no row uses/);
  });

  it('the library is clean', () => {
    for (const d of TEXTURE_LIBRARY.all()) expect(validateTexture(d), d.id).toMatchObject({ problems: [], warnings: [] });
  });
});

describe('converters', () => {
  const tiles = def([{ pattern: 'bricks', colors: ['a', 'b', 'c'] }], { id: 'conv-tiles', size: [16, 8], tile: true });

  it('textureMap: nearest, sRGB, repeat when tiling, shared, cached per palette, rows bottom first', () => {
    const t = textureMap(tiles);
    expect([t.magFilter, t.minFilter, t.generateMipmaps, t.colorSpace, t.wrapS, t.wrapT, t.userData.shared]).toEqual([NearestFilter, NearestFilter, false, SRGBColorSpace, RepeatWrapping, RepeatWrapping, true]);
    expect(textureMap(tiles)).toBe(t);
    expect(textureMap(tiles, { palette: { b: 'blue' } })).not.toBe(t);
    const b = bakeTexture(tiles);
    const data = t.image.data as Uint8Array;
    expect([...data.subarray(0, 16 * 4)]).toEqual([...b.rgba.subarray(7 * 16 * 4, 8 * 16 * 4)]); // the bottom row first
    expect(textureMap(def([{ pixels: ['a'], legend: { a: 'a' } }], { id: 'conv-clamp' })).wrapS).toBe(ClampToEdgeWrapping);
    expect(() => textureMap(def([{ pixels: ['x'], legend: {} }]))).toThrow(TextureError);
    // every problem stops it: ragged rows, no layers, frames that don't divide the width
    expect(() => textureMap(def([{ pixels: ['aa', 'a'], legend: { a: 'a' } }]))).toThrow(/ragged rows/);
    expect(() => textureMap(def([]))).toThrow(/no layers/);
    expect(() => hudSprite(def([{ pixels: ['a'], legend: { a: 'a' } }], { frames: 3 }))).toThrow(/3 frames don't divide/);
    // the cache doesn't care which order a palette's keys come in
    expect(textureMap(tiles, { palette: { b: 'blue', c: 'red' } })).toBe(textureMap(tiles, { palette: { c: 'red', b: 'blue' } }));
  });

  it('an outline stays inside its sprite frame', () => {
    // a texel on frame 0's right edge: its outline doesn't reach into frame 1
    const b = bakeTexture(def([{ pixels: ['...a....'], legend: { a: 'b' }, at: [0, 1] }, { outline: 'a' }], { frames: 2 }));
    expect(at(b, 2, 1)).toBe(1);
    expect(at(b, 4, 1)).toBe(0);
  });

  it('spriteSheet: frames left to right, rows top first', () => {
    const sheet = spriteSheet(def([{ pattern: 'checker', colors: ['a', 'b'] }], { size: [16, 4], frames: 4 }));
    expect([sheet.frame, sheet.cols, sheet.rows, sheet.frames, sheet.texture.flipY]).toEqual([[4, 4], 4, 1, 4, false]);
  });

  it('hudSprite: a character per slot, . for transparent, one frame', () => {
    const two = def([{ pixels: ['ab..', 'c..b'], legend: { a: 'a', b: 'b', c: 'c' } }], { size: [4, 2], frames: 2 });
    const s = hudSprite(two, { frame: 1 });
    expect(s.rows).toEqual(['..', '.b']);
    expect(hudSprite(two, { frame: 1.5 }).rows).toEqual(['..', '.b']); // a fraction is the frame it falls in
    expect(s.colors).toEqual({ a: 'ink', b: 'orange', c: 'sand' });
  });

  it('ids resolve through the library or a catalog of your own', () => {
    expect(textureMap('bricks').name).toBe('tex:bricks');
    const own = new TextureCatalog([{ ...tiles, id: 'mine' }]);
    expect(textureMap('mine', { catalog: own }).name).toBe('tex:mine');
    expect(() => own.add({ ...tiles, id: 'mine' })).toThrow(/already in this catalog/);
    expect(() => textureMap('nope')).toThrow(/no texture "nope"/);
  });
});
