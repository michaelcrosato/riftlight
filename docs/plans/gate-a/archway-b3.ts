import { model } from '../../../src/engine/model';
import type { Part } from '../../../src/engine/model/types';

/** A mortar joint: one art pixel at game scale. */
const J = 0.06;

type Pt = [number, number];

export default model({
  id: 'archway',
  about: 'Freestanding stone archway: a round arch of pale voussoirs with a dressed keystone on two coursed piers, plinths and impost bands, coursed spandrels under a dressed cornice; open to walk through',
  tags: ['architecture', 'stone', 'town', 'building'],
  palette: { stone: 'mist', stone2: 'slate', mortar: 'night', ring: 'sand', ring2: 'white', trim: 'sand', key: 'orange', cap: 'slate' },
  size: [3.3, 3.95, 0.86],
  // a box round each stone, so the opening stays open to walk through
  collider: 'parts',
  parts: () => {
    const a = 0.85; // half the opening
    const ys = 1.85; // the spring line
    const ringT = 0.4;
    const R = a + ringT; // the arch's extrados
    const Rj = R + J; // the spandrel stops a joint short of it
    const W2 = a + 0.7; // half the width: piers 0.7 m
    const d = 0.7; // the wall's depth
    const plinth = 0.24;
    const imp = 0.16; // the impost band under the spring
    const keyUp = 0.1; // the keystone's rise over the extrados
    const keyTop = ys + R + keyUp;
    // the spandrel's courses: four up to the keystone's head, one more over it
    const ch = (keyTop + J / 2 - ys) / 4;
    const courses = [...Array.from({ length: 5 }, (_, i) => ys + i * ch), ys + 5 * ch];
    const T = courses[5]!; // the spandrel's top
    const out: Part[] = [];

    // the mortar core: the whole wall less the opening, 2 cm in from every face
    const core: Pt[] = [[a + 0.02, 0], [W2 - 0.02, 0], [W2 - 0.02, T - 0.02], [-W2 + 0.02, T - 0.02], [-W2 + 0.02, 0], [-a - 0.02, 0]];
    for (let i = 0; i <= 16; i++) {
      const t = Math.PI - (Math.PI * i) / 16;
      core.push([(a + 0.02) * Math.cos(t), ys + (a + 0.02) * Math.sin(t)]);
    }
    out.push({ slab: core, depth: d - 0.04, c: 'mortar', name: 'mortar', collide: false });

    // the piers: a plinth, coursed blocks, an impost band
    const pierCourses = 4;
    const pch = (ys - imp - plinth) / pierCourses;
    const pier: Part[] = [
      { box: [W2 - a + 0.12, plinth, d + 0.12], at: [(a + W2) / 2, plinth / 2, 0], c: 'trim', name: 'plinth' },
      // two blocks a course, split across the face and through the depth in turn, so both faces show a bond
      ...Array.from({ length: pierCourses }, (_, i): Part[] => {
        const y0 = plinth + i * pch + J / 2;
        const y1 = plinth + (i + 1) * pch - J / 2;
        const c = i % 2 ? 'stone2' : 'stone';
        const pw = W2 - a;
        const m = (a + W2) / 2;
        return i % 2
          ? [
              { box: [pw, y1 - y0, d / 2 - J / 2], at: [m, (y0 + y1) / 2, d / 4 + J / 4], c },
              { box: [pw, y1 - y0, d / 2 - J / 2], at: [m, (y0 + y1) / 2, -d / 4 - J / 4], c },
            ]
          : [
              { box: [pw / 2 - J / 2, y1 - y0, d], at: [m - pw / 4 - J / 4, (y0 + y1) / 2, 0], c },
              { box: [pw / 2 - J / 2, y1 - y0, d], at: [m + pw / 4 + J / 4, (y0 + y1) / 2, 0], c },
            ];
      }).flat(),
      { box: [W2 - a + 0.1, imp, d + 0.1], at: [(a + W2) / 2 - 0.03, ys - imp / 2, 0], c: 'trim', name: 'impost' },
    ];
    out.push({ mirror: pier });

    // the arch ring: voussoirs in two shades; the keystone hangs below them, rises into the
    // spandrel and stands proud of both faces
    const nv = 9;
    const step = 180 / nv;
    const gap = (J / ((a + R) / 2)) * (180 / Math.PI);
    const kx = (R + keyUp) * Math.sin(((step - gap) / 2) * (Math.PI / 180)) + J; // the spandrel clears it by a joint
    const ringBlock = (r0: number, r1: number, t0: number, t1: number, k = 3): Pt[] => {
      const at = (r: number, t: number): Pt => [r * Math.cos((t * Math.PI) / 180), ys + r * Math.sin((t * Math.PI) / 180)];
      const ts = Array.from({ length: k + 1 }, (_, i) => t0 + ((t1 - t0) * i) / k);
      return [...ts.map((t) => at(r1, t)), ...ts.reverse().map((t) => at(r0, t))];
    };
    out.push({ slab: ringBlock(a + 0.02, R - 0.02, 1, 179, 18), depth: d - 0.04, c: 'mortar', collide: false });
    for (let i = 0; i < nv; i++) {
      const key = i === (nv - 1) / 2;
      out.push({
        slab: ringBlock(key ? a - 0.1 : a, key ? R + keyUp : R, i * step + (i ? gap / 2 : 0), (i + 1) * step - (i < nv - 1 ? gap / 2 : 0)),
        depth: key ? d + 0.12 : d,
        c: key ? 'key' : i % 2 ? 'ring2' : 'ring',
        ...(key ? { name: 'keystone' } : {}),
      });
    }

    // the spandrel courses: running bond across the width, each block clipped a joint clear of the
    // arch and the keystone, no tip thinner than 4 cm
    const minH = 0.04;
    const floor = (x: number, y0: number) => {
      let y = y0;
      if (Math.abs(x) < Rj) y = Math.max(y, ys + Math.sqrt(Rj * Rj - x * x));
      if (Math.abs(x) < kx) y = Math.max(y, keyTop + J);
      return y;
    };
    const block = (xa: number, xb: number, y0: number, y1: number, c: string) => {
      // the stretches of x where the block stands at least minH tall
      const spans: Pt[] = [];
      const res = 0.002;
      let open: number | null = null;
      for (let x = xa; x <= xb + 1e-9; x += res) {
        const ok = floor(Math.min(x, xb), y0) < y1 - minH;
        if (ok && open === null) open = x;
        if (!ok && open !== null) {
          spans.push([open, x - res]);
          open = null;
        }
      }
      if (open !== null) spans.push([open, xb]);
      for (const [p, q] of spans) {
        if (q - p < 0.06) continue;
        const xs = new Set<number>([p, q]);
        const xk = y0 - ys < Rj ? Math.sqrt(Rj * Rj - (y0 - ys) ** 2) : 0;
        for (const k of [xk, -xk]) if (k > p && k < q) xs.add(k);
        for (const k of [kx, -kx]) {
          if (k - 1e-4 > p && k - 1e-4 < q) xs.add(k - 1e-4);
          if (k + 1e-4 > p && k + 1e-4 < q) xs.add(k + 1e-4);
        }
        for (let i = 1; i < 16; i++) xs.add(p + ((q - p) * i) / 16);
        const sorted = [...xs].sort((m, o) => m - o);
        if (sorted.every((x) => floor(x, y0) === y0)) {
          out.push({ box: [q - p, y1 - y0, d], at: [(p + q) / 2, (y0 + y1) / 2, 0], c });
          continue;
        }
        // drop points in a straight run, so the outline keeps only its corners and arc steps
        const bottom = sorted.map((x): Pt => [x, Math.min(y1 - minH, floor(x, y0))]);
        const pts: Pt[] = [[q, y1], [p, y1], ...bottom.filter((pt, i) => i === 0 || i === bottom.length - 1 || !(pt[1] === y0 && bottom[i - 1]![1] === y0 && bottom[i + 1]![1] === y0))];
        out.push({ slab: pts, depth: d, c });
      }
    };
    const n = 6;
    const bl = (2 * W2) / n;
    for (let r = 0; r + 1 < courses.length; r++) {
      const y0 = courses[r]! + J / 2;
      const y1 = courses[r + 1]! - (r + 2 === courses.length ? 0 : J / 2);
      const shifted = r % 2 === 1;
      const cuts = shifted ? [-W2, ...Array.from({ length: n }, (_, i) => -W2 + (i + 0.5) * bl), W2] : Array.from({ length: n + 1 }, (_, i) => -W2 + i * bl);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const xa = cuts[i]! + (i === 0 ? 0 : J / 2);
        const xb = cuts[i + 1]! - (i + 2 === cuts.length ? 0 : J / 2);
        block(xa, xb, y0, y1, r % 2 ? 'stone' : 'stone2');
      }
    }

    // the cornice and a pitched coping along its top, so the cap catches the light in two planes
    const cz = d / 2 + 0.08;
    out.push({ box: [2 * W2 + 0.16, 0.12, d + 0.16], at: [0, T + 0.06, 0], c: 'trim', name: 'cornice' });
    out.push({ slab: [[-cz + 0.04, 0], [cz - 0.04, 0], [cz - 0.04, 0.06], [0, 0.24], [-cz + 0.04, 0.06]], depth: 2 * W2 + 0.08, at: [0, T + 0.12, 0], rot: [0, 90, 0], c: 'cap', name: 'coping' });
    return out;
  },
});
