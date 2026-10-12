import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';
import { buildModel, checkModel, compileParts, expandModel, MODEL_LIBRARY, validateModel, type ModelDef, type Part } from '.';
import { diffLines, diffModels, modelFingerprint } from './diff';
import { oklab } from './oklab';
import { bakeTexture, meanColour, textureDef, TextureCatalog } from '../texture';
import { flatTriangles, GAME_VIEW, gamePxPerMetre, renderJudge, renderModelSheet, upscale } from './sheet';

const def = (parts: Part[], extra: Partial<ModelDef> = {}): ModelDef => ({ id: 'tool-test', about: 'a test model', tags: [], palette: { a: 'orange', b: 'slate', c: 'red' }, parts, ...extra });
const warnings = (d: ModelDef) => validateModel(d).warnings;
const version = (d: ModelDef) => {
  const model = expandModel(d);
  return { model, compiled: compileParts(model.parts) };
};

describe('readability warnings', () => {
  const body: Part = { box: [1, 1, 1], at: [0, 0.5, 0] };

  it('a part hidden inside another', () => {
    expect(warnings(def([body, { box: [0.2, 0.2, 0.2], at: [0, 0.5, 0], c: 'b' }]))[0]).toMatch(/^box at parts\[1\] is inside box at parts\[0\]: at most a face flush with it shows/);
    expect(warnings(def([body, { box: [0.2, 0.2, 0.2], at: [0, 1.05, 0], c: 'b' }]))).toEqual([]); // poking out of the top
    expect(warnings(def([{ ball: [1, 1, 1], at: [0, 0.5, 0] }, { box: [0.4, 0.4, 0.4], at: [0, 0.5, 0], c: 'b' }]))[0]).toMatch(/is inside ball/);
    // a part in a pivot (a drawer in a cabinet) may come out: not hidden
    expect(warnings(def([body, { name: 'drawer', pivot: true, group: [{ box: [0.2, 0.2, 0.2], at: [0, 0.5, 0], c: 'b' }] }])).join()).not.toMatch(/ is inside /);
    // two parts filling the same space: one line, not two
    expect(warnings(def([body, { box: [1, 1, 1], at: [0, 0.5, 0], c: 'b' }])).filter((x) => / is inside /.test(x))).toHaveLength(1);
    // many hidden in one container: one line
    expect(warnings(def([body, ...Array.from({ length: 5 }, (_, i): Part => ({ box: [0.1, 0.1, 0.1], at: [-0.3 + i * 0.15, 0.5, 0], c: 'b' }))])).filter((x) => / inside /.test(x))).toEqual([expect.stringMatching(/^5 parts \(.*, …\) are inside box at parts\[0\]/)]);
  });

  it('coplanar faces of different colours (z-fighting), but not bottoms on the floor', () => {
    const w = warnings(def([body, { box: [0.4, 0.2, 0.2], at: [0, 0.6, 0.4], c: 'b' }]));
    expect(w.join('\n')).toMatch(/^box at parts\[0\] \(orange\) and box at parts\[1\] \(slate\) share a face at z = 0.5 \(z-fighting\)/m);
    // near a 5 mm boundary too (plane offsets 0.5025 and 0.5028)
    const edge = def([{ box: [1, 1, 1.005], at: [0, 0.5, 0] }, { box: [0.4, 0.2, 0.2], at: [0, 0.6, 0.4028], c: 'b' }]);
    expect(warnings(edge).join()).toMatch(/z-fighting/);
    // many alike are one line per colour pair
    const tiles = def([body, ...Array.from({ length: 6 }, (_, i): Part => ({ box: [0.1, 0.1, 0.1], at: [-0.4 + i * 0.15, 0.6, 0.45], c: 'b' }))]);
    expect(warnings(tiles).filter((x) => /z-fighting/.test(x))).toEqual([expect.stringMatching(/^6 pairs of parts \(.*, …\) share faces at z = 0.5 \(z-fighting\)/)]);
    expect(warnings(def([body, { box: [0.4, 0.2, 0.2], at: [0, 0.6, 0.402], c: 'b' }])).join()).not.toMatch(/z-fighting/); // 2 mm out
    expect(warnings(def([body, { box: [0.4, 0.2, 0.2], at: [0, 0.6, 0.4] }])).join()).not.toMatch(/z-fighting/); // same colour
    expect(warnings(def([body, { box: [1, 0.2, 0.2], at: [1, 0.1, 0], c: 'b' }])).join()).not.toMatch(/z-fighting/); // both bottoms on the floor
  });

  it('an inlay counts each pair once, on the plane it shares', () => {
    const slab: Part = { name: 'slab', box: [1, 0.1, 1], at: [0, 0.05, 0] };
    const tiles = def([slab, ...Array.from({ length: 9 }, (_, i): Part => ({ box: [0.2, 0.1, 0.2], at: [-0.3 + (i % 3) * 0.3, 0.05, -0.3 + Math.floor(i / 3) * 0.3], c: 'b' }))]);
    expect(warnings(tiles).filter((x) => /z-fighting/.test(x))).toEqual([expect.stringMatching(/^9 pairs of parts .* share faces at y = 0.1 \(z-fighting\)/)]);
  });

  it('touching large masses too close in lightness', () => {
    const close = def([body, { box: [1, 1, 1], at: [1, 0.5, 0], c: 'c' }]); // orange vs red
    const dl = Math.abs(oklab(PALETTE.orange).L - oklab(PALETTE.red).L);
    expect(dl).toBeGreaterThan(0.08); // the palette's orange and red do read apart
    const near = def([body, { box: [1, 1, 1], at: [1, 0.5, 0], c: 'c' }], { palette: { a: 'teal', b: 'slate', c: 'blue' } });
    expect(Math.abs(oklab(PALETTE.teal).L - oklab(PALETTE.blue).L)).toBeLessThan(0.08);
    expect(warnings(near)[0]).toMatch(/\(teal\) and .* \(blue\) touch but differ by only 0.0\d in lightness/);
    expect(warnings(close)).toEqual([]);
    const small = def([body, { box: [0.1, 0.1, 0.1], at: [0.55, 0.5, 0], c: 'c' }], { palette: { a: 'teal', b: 'slate', c: 'blue' } });
    expect(warnings(small).join()).not.toMatch(/lightness/); // a small accent may share a lightness
  });

  it('identical rods are one warning', () => {
    const w = warnings(def([body, { box: [0.03, 0.5, 0.03], at: [0.3, 1.25, 0] }, { box: [0.03, 0.5, 0.03], at: [-0.3, 1.25, 0] }]));
    expect(w).toEqual([expect.stringMatching(/^2 parts are \(box at parts\[1\], box at parts\[2\]\) 0.03 × 0.03 m across/)]);
  });

  it('large parts of one colour that merge into one block at game scale', () => {
    // a cart's bed, two sides and its front board, all one colour
    const cart: Part[] = [
      { name: 'bed', box: [1, 0.08, 1.4], at: [0, 0.5, 0] },
      { name: 'left', box: [0.08, 0.3, 1.4], at: [0.46, 0.69, 0] },
      { name: 'right', box: [0.08, 0.3, 1.4], at: [-0.46, 0.69, 0] },
      { name: 'front', box: [1, 0.3, 0.08], at: [0, 0.69, 0.66] },
    ];
    const block = warnings(def(cart)).filter((w) => /one block/.test(w));
    expect(block).toEqual([expect.stringMatching(/^4 large orange parts \('(bed|left|right|front)', .*\) join into one block, \d+% of the model at game scale: .*a second colour or a darker shade/)]);
    expect(warnings(def(cart.map((p, i) => ({ ...p, c: i % 2 ? 'b' : 'a' })))).join()).not.toMatch(/one block/); // alternated
    expect(warnings(def(cart.map((p) => ({ ...p, name: 'plank' })))).join()).toMatch(/^4 large orange parts \('plank'\) join into one block/m); // parts, not names
    expect(warnings(def(cart.slice(0, 3))).join()).not.toMatch(/one block/); // three large parts may share a colour
    // the 40% line: a slate shed beside the cart takes a share of the pixels
    const shed = (w: number): Part => ({ name: 'shed', box: [w, 1, 1.4], at: [-0.5 - w / 2, 0.5, 0], c: 'b' });
    expect(warnings(def([...cart, shed(1)])).join()).toMatch(/join into one block, 45% of the model/);
    expect(warnings(def([...cart, shed(1.6)])).join()).not.toMatch(/one block/);
    // turned rods are rods, not large parts
    const rods = [0, 45, 90, 135].map((a): Part => ({ cyl: [0.06, 1.2, 0.06], at: [0, 0.6, 0], rot: [0, a, 40], seg: 4 }));
    expect(warnings(def(rods)).join()).not.toMatch(/one block/);
    // textured parts show their texels: never a flat block
    expect(warnings(def(cart.map((p) => ({ ...p, tex: 'planks' })))).join()).not.toMatch(/one block/);
  });

  it('a textured part counts as its mean colour for lightness, and its texture names it', () => {
    const flat = (c: 'blue' | 'orange') => new TextureCatalog([textureDef({ id: 'flat', about: 'x', tags: [], size: [8, 8], tile: true, palette: { a: c }, layers: [{ pattern: 'checker', colors: 'a' }] })]);
    const d = def([body, { box: [1, 1, 1], at: [1, 0.5, 0], tex: 'flat' }], { palette: { a: 'teal', b: 'slate', c: 'red' } });
    expect(meanColour(bakeTexture(flat('blue').get('flat')))).toBe(PALETTE.blue);
    expect(validateModel(d, { textures: flat('blue') }).warnings.join()).toMatch(/\(teal\) and .* \(texture 'flat'\) touch but differ by only 0.0\d in lightness/);
    expect(validateModel(d, { textures: flat('orange') }).warnings.join()).not.toMatch(/lightness/);
    // same texture on two touching parts: no lightness line, no z-fighting
    const twin = def([{ box: [1, 1, 1], at: [0, 0.5, 0], tex: 'bricks' }, { box: [1, 1, 1], at: [1, 0.5, 0], tex: 'bricks' }]);
    expect(validateModel(twin).warnings).toEqual([]);
  });

  it('a block the far side shows is a block', () => {
    // four slabs behind a slate wall that faces the game's camera: 27% from its yaw, 47% from 225°
    const slabs = [0, 1, 2, 3].map((i): Part => ({ box: [0.5, 0.3, 1], at: [-0.75 + i * 0.5, 0.15, 0] }));
    const wall: Part = { box: [2.6, 1, 0.12], at: [0.55, 0.5, 0.55], rot: [0, 45, 0], c: 'b' };
    expect(warnings(def([...slabs, wall])).filter((w) => /one block/.test(w))).toEqual([expect.stringMatching(/^4 large orange parts .* join into one block, 47% of the model/)]);
  });

  it('glow covering too much of the model', () => {
    const base: Part = { box: [0.8, 0.2, 0.8], at: [0, 0.1, 0], c: 'b' };
    expect(warnings(def([base, { cone: [0.6, 1, 0.6], at: [0, 0.7, 0], c: 'a', glow: true }]))).toEqual([expect.stringMatching(/^glow parts \(cone at parts\[1\]\) cover \d+% of the model at game scale: glow draws as one flat colour/)]);
    expect(warnings(def([base, { ball: [0.12, 0.1, 0.12], at: [0, 0.25, 0], c: 'a', glow: true }]))).toEqual([]); // an ember
    expect(warnings(def([{ ball: [0.12, 0.1, 0.12], at: [0, 0.05, 0], c: 'a', glow: true }]))).toEqual([]); // an ember on its own: too small to read as a shape
  });

  it('the library has no readability warnings it shouldn\'t', () => {
    for (const d of MODEL_LIBRARY.all()) expect(checkModel(d).warnings.filter((w) => / is inside | are inside |z-fighting|lightness|one block|glow parts/.test(w)), d.id).toEqual([]);
  }, 30_000); // checks every library model
});

describe('named parts', () => {
  it('compile lists named parts and groups with the parts they cover', () => {
    const v = version(MODEL_LIBRARY.get('lamp-post'));
    const lantern = v.compiled.named.find((n) => n.name === 'lantern')!;
    expect(lantern.end - lantern.start).toBe(4);
    const twins = version(def([{ mirror: [{ name: 'post', box: [0.1, 1, 0.1], at: [0.5, 0.5, 0] }] }]));
    expect(twins.compiled.named.map((n) => n.name).sort()).toEqual(['post', 'post.mirror']);
  });
});

describe('oklab', () => {
  it('matches reference values', () => {
    expect(oklab(0xffffff).L).toBeCloseTo(1, 4);
    expect(oklab(0x000000).L).toBeCloseTo(0, 6);
    const red = oklab(0xff0000);
    expect(red.L).toBeCloseTo(0.628, 3);
    expect(red.a).toBeCloseTo(0.2249, 3);
    expect(red.b).toBeCloseTo(0.1258, 3);
  });
});

describe('diffModels', () => {
  const base: Part[] = [
    { name: 'body', box: [1, 1, 1], at: [0, 0.5, 0] },
    { name: 'lid', box: [1, 0.1, 1], at: [0, 1.05, 0], c: 'b' },
    { box: [0.2, 0.2, 0.2], at: [0.6, 0.1, 0] },
  ];
  it('names parts added, removed, moved, resized and recoloured', () => {
    const a = version(def(base));
    const b = version(def([{ name: 'body', box: [1, 1.2, 1], at: [0, 0.6, 0] }, { name: 'lid', box: [1, 0.1, 1], at: [0, 1.25, 0], c: 'c' }, { name: 'knob', ball: [0.1, 0.1, 0.1], at: [0, 1.35, 0] }]));
    const d = diffModels(a, b);
    expect(d.same).toBe(false);
    expect(d.added).toEqual(["'knob'"]);
    expect(d.removed).toEqual(['box at parts[2]']);
    expect(d.moved).toEqual(["'body' moved 0.1 m (+0.1 y)", "'lid' moved 0.2 m (+0.2 y)"]);
    expect(d.resized).toEqual(["'body' 1 × 1 × 1 → 1 × 1.2 × 1 m"]);
    expect(d.recoloured).toEqual(["'lid' slate → red"]);
    expect(d.counts['size.y']).toEqual([1.1, 1.4, 0.3]);
    expect(diffLines(d).join('\n')).toMatch(/\+ added: 'knob'/);
  });
  it('an inserted part is only "added"; a turned part is "turned", not resized', () => {
    const plain: Part[] = [{ box: [1, 0.5, 1], at: [0, 0.25, 0] }, { cyl: [0.3, 0.3, 0.3], at: [0, 0.65, 0], c: 'b' }];
    const inserted = diffModels(version(def(plain)), version(def([{ ball: [0.1, 0.1, 0.1], at: [0.6, 0.05, 0] }, ...plain])));
    expect([inserted.added, inserted.removed, inserted.moved, inserted.resized, inserted.recoloured]).toEqual([['ball at parts[0]'], [], [], [], []]);
    const turned = diffModels(version(def(plain)), version(def([{ box: [1, 0.5, 1], at: [0, 0.25, 0], rot: [0, 30, 0] }, plain[1]!])));
    expect(turned.rotated).toEqual(['box at parts[0] turned 30°']);
    expect(turned.resized).toEqual([]);
  });

  it('is same for the same model, and the fingerprint sees colours', () => {
    expect(diffModels(version(def(base)), version(def(base))).same).toBe(true);
    expect(modelFingerprint(version(def(base)))).not.toBe(modelFingerprint(version(def(base, { palette: { a: 'orange', b: 'teal', c: 'red' } }))));
  });
});

describe('sheets', () => {
  it('game scale is Riftlight\'s camera: 18 px/m at zoom 1', () => {
    expect(gamePxPerMetre(1)).toBe(18);
    expect(gamePxPerMetre(GAME_VIEW.zooms.level)).toBeCloseTo(19.44, 6);
  });

  it('upscale repeats pixels', () => {
    const img = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) };
    const big = upscale(img, 2);
    expect([big.width, big.height]).toEqual([4, 2]);
    expect(Array.from(big.data.slice(4 * 5, 4 * 6))).toEqual([255, 0, 0, 255]); // (1, 1) is still red
  });

  it('renders a sheet, with the previous version in magenta', () => {
    const v = version(MODEL_LIBRARY.get('crate'));
    const input = { model: v.model, compiled: v.compiled, build: buildModel('crate'), check: checkModel('crate') };
    const plain = renderModelSheet(input);
    expect(plain.width).toBeGreaterThan(1000);
    const magenta = (img: { data: Uint8ClampedArray }) => {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 255 && img.data[i + 1] === 60 && img.data[i + 2] === 220) n++;
      return n;
    };
    expect(magenta(plain)).toBe(0);
    const before = version(def([{ box: [1.4, 0.4, 0.4], at: [0, 0.2, 0] }]));
    expect(magenta(renderModelSheet({ ...input, previous: flatTriangles(before.compiled, before.model.palette) }))).toBeGreaterThan(100);
    expect(renderJudge(buildModel('crate').object).width).toBeGreaterThan(1000);
  });
});
