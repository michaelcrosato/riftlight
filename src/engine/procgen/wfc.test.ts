import { describe, expect, it } from 'vitest';
import { patternTiles, Wfc, type WfcTile } from './wfc';

/** A small dungeon set: rock, corridors (straight, corner, T, cross, dead end), rooms. */
const DUNGEON = patternTiles([
  { name: 'rock', pattern: ['###', '###', '###'], weight: 3 },
  { name: 'hall', pattern: ['#.#', '#.#', '#.#'], weight: 2 },
  { name: 'corner', pattern: ['#.#', '#..', '###'] },
  { name: 'tee', pattern: ['#.#', '...', '###'], weight: 0.5 },
  { name: 'cross', pattern: ['#.#', '...', '#.#'], weight: 0.3 },
  { name: 'end', pattern: ['#.#', '#.#', '###'], weight: 0.3 },
  { name: 'floor', pattern: ['...', '...', '...'], weight: 2 },
  { name: 'wall', pattern: ['###', '...', '...'] },
  { name: 'nook', pattern: ['###', '#..', '#..'] },
  { name: 'door', pattern: ['#.#', '...', '...'], weight: 0.4 },
]);

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const OPP = [2, 3, 0, 1];

function check(wfc: Wfc, tiles: readonly WfcTile[], border?: string) {
  const { width: w, height: h } = wfc;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[wfc.result[x + y * w]!]!;
      expect(t).toBeDefined();
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          if (border !== undefined) expect(t.edges[d]).toBe(border);
          continue;
        }
        expect(t.edges[d]).toBe(tiles[wfc.result[nx + ny * w]!]!.edges[OPP[d]!]);
      }
    }
  }
}

describe('patternTiles', () => {
  it('reads edges off the pattern and makes each distinct quarter turn', () => {
    const [corner, ...turns] = patternTiles([{ name: 'c', pattern: ['#.#', '#..', '###'] }]);
    expect(corner!.edges).toEqual(['#.#', '#.#', '###', '###']); // north, east (top to bottom), south, west
    expect(turns.length).toBe(3);
    expect(turns[0]!.pattern).toEqual(['###', '#..', '#.#']); // a quarter turn clockwise: the opening now faces east and south
    expect(patternTiles([{ pattern: ['#.#', '...', '#.#'] }]).length).toBe(1); // the cross is the same every way
    expect(patternTiles([{ pattern: ['#.#', '#.#', '#.#'] }]).length).toBe(2);
    expect(patternTiles([{ pattern: ['#.#', '#..', '###'], rotate: false }]).length).toBe(1);
  });
});

describe('Wfc', () => {
  it('fills the grid so every neighbour fits and the border is closed', () => {
    const wfc = new Wfc(DUNGEON, 14, 10, { seed: 4, border: '###' });
    expect(wfc.run()).toBe(true);
    check(wfc, DUNGEON, '###');
    // it is a dungeon, not solid rock: open tiles and corridors both appear
    const names = new Set(Array.from(wfc.result, (t) => DUNGEON[t]!.name.split('@')[0]));
    expect(names.has('rock')).toBe(true);
    expect(names.size).toBeGreaterThan(4);
  });

  it('is the same for a seed, different for another', () => {
    const a = new Wfc(DUNGEON, 10, 8, { seed: 9, border: '###' });
    const b = new Wfc(DUNGEON, 10, 8, { seed: 9, border: '###' });
    const c = new Wfc(DUNGEON, 10, 8, { seed: 10, border: '###' });
    a.run();
    b.run();
    c.run();
    expect(Array.from(a.result)).toEqual(Array.from(b.result));
    expect(Array.from(c.result)).not.toEqual(Array.from(a.result));
  });

  it('keeps the cells it is given, even through a closed border (a way in)', () => {
    const hall = DUNGEON.findIndex((t) => t.name === 'hall');
    const entry = 5 + 7 * 10; // bottom middle
    const wfc = new Wfc(DUNGEON, 10, 8, { seed: 2, border: '###', fixed: { [entry]: hall, 0: 0 } });
    expect(wfc.run()).toBe(true);
    expect(wfc.result[entry]).toBe(hall);
    expect(wfc.result[0]).toBe(0);
    // every other edge cell still shows rock to the outside
    for (let x = 0; x < 10; x++) if (x !== 5) expect(DUNGEON[wfc.result[x + 7 * 10]!]!.edges[2]).toBe('###');
    // and a fixed cell that can't fit its neighbours is a contradiction, every time
    const rock = DUNGEON.findIndex((t) => t.name === 'rock');
    const stuck = new Wfc(DUNGEON, 10, 8, { seed: 2, border: '###', attempts: 3, fixed: { [entry]: hall, [entry - 10]: rock } });
    expect(stuck.run()).toBe(false);
    expect(stuck.failed).toBe(true);
  });

  it('gives up after its attempts when the tiles can never fit', () => {
    const tiles: WfcTile[] = [
      { name: 'a', edges: ['x', 'y', 'x', 'y'] },
      { name: 'b', edges: ['z', 'z', 'z', 'z'] },
    ]; // each fits beside itself, never beside the other: solvable
    const never: WfcTile[] = [{ name: 'n', edges: ['a', 'b', 'c', 'd'] }]; // its east never meets its west
    const wfc = new Wfc(never, 3, 3, { attempts: 5 });
    expect(wfc.run()).toBe(false);
    expect(wfc.failed).toBe(true);
    expect(wfc.attempt).toBe(5);
    expect(new Wfc(tiles, 4, 4).run()).toBe(true); // a fits beside a, b beside b: either fills it
  });

  it('step by step ends where run does, collapsing one choice at a time', () => {
    const a = new Wfc(DUNGEON, 9, 7, { seed: 6, border: '###' });
    let steps = 0;
    let undecided = a.options.filter((n) => n > 1).length;
    while (a.step()) {
      steps++;
      const now = a.options.filter((n) => n > 1).length;
      if (a.attempt === 1) expect(now).toBeLessThan(undecided); // each step decides at least one cell
      undecided = now;
    }
    const b = new Wfc(DUNGEON, 9, 7, { seed: 6, border: '###' });
    b.run();
    expect(a.done).toBe(true);
    expect(Array.from(a.result)).toEqual(Array.from(b.result));
    expect(steps).toBeGreaterThan(3);
    expect(a.entropy(0)).toBe(0); // decided cells have none left
  });

  it('takes options given as undefined as their defaults', () => {
    const never: WfcTile[] = [{ name: 'n', edges: ['a', 'b', 'c', 'd'] }];
    const wfc = new Wfc(never, 3, 3, { attempts: undefined, seed: undefined });
    expect(wfc.run()).toBe(false); // gives up after the default 30, not a stack overflow
    expect(wfc.attempt).toBe(30);
    const ok = new Wfc(DUNGEON, 6, 5, { seed: undefined, border: '###' });
    const one = new Wfc(DUNGEON, 6, 5, { seed: 1, border: '###' });
    expect(ok.run()).toBe(true);
    one.run();
    expect(Array.from(ok.result)).toEqual(Array.from(one.result)); // the default seed is 1
  });
});
