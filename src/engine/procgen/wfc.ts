/**
 * Wave function collapse (the tiled model): fill a grid with tiles so every pair of
 * neighbours fits, edge to edge. Every cell starts able to be any tile; repeatedly the most
 * constrained cell (least entropy: fewest, least balanced options) is collapsed to one tile at
 * random (by weight), and the choice is propagated: each neighbour drops the tiles that no
 * longer fit, and their neighbours in turn. A cell left with no options is a contradiction: it
 * starts over with the next seed.
 *
 *   const tiles = patternTiles([{ pattern: ['#.#', '#.#', '#.#'] }, ...]); // rotations made for you
 *   const wfc = new Wfc(tiles, 12, 8, { seed: 3, border: '###' });
 *   wfc.run();                       // or wfc.step() once a frame to watch it collapse
 *   wfc.result[x + y * 12];          // a tile index per cell
 *
 * Edges are sockets: north and south are read west to east, east and west north to south, so
 * two tiles fit side by side when the edges that touch are the same string.
 */
import { seeded } from '../physics/fracture';

export interface WfcTile {
  readonly name: string;
  /** North (−z, up the map), east (+x), south (+z), west (−x). */
  readonly edges: readonly [string, string, string, string];
  /** How often it is chosen, relative to the others (default 1). */
  readonly weight?: number;
}

export interface PatternTile extends WfcTile {
  /** The tile as rows of characters (north row first). */
  readonly pattern: readonly string[];
}

export interface WfcOptions {
  seed?: number;
  /** The socket every edge on the grid's outside must be (a closed map: '###'). Default: any. */
  border?: string;
  /** Cells set before solving: cell index (x + y × width) → tile index (they may break the border: a way in). */
  fixed?: Readonly<Record<number, number>>;
  /** Starts allowed before giving up on contradictions (default 30). */
  attempts?: number;
}

/** Directions: north, east, south, west, as grid steps, and the opposite of each. */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const OPP = [2, 3, 0, 1];

/** Turn a square pattern a quarter clockwise. */
function rotate(p: readonly string[]): string[] {
  const n = p.length;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => p[n - 1 - c]![r]!).join(''));
}

function edgesOf(p: readonly string[]): [string, string, string, string] {
  const n = p.length;
  const col = (c: number) => p.map((row) => row[c]!).join('');
  return [p[0]!, col(n - 1), p[n - 1]!, col(0)];
}

/**
 * Tiles from square character patterns: the edges are read off the pattern, and each pattern
 * is turned to its four quarter turns (unless `rotate: false`), repeats dropped.
 */
export function patternTiles(defs: readonly { pattern: readonly string[]; weight?: number; name?: string; rotate?: boolean }[]): PatternTile[] {
  const out: PatternTile[] = [];
  const seen = new Set<string>();
  defs.forEach((d, i) => {
    let p = [...d.pattern];
    for (let turn = 0; turn < (d.rotate === false ? 1 : 4); turn++) {
      const key = p.join('/');
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ name: `${d.name ?? `tile${i}`}${turn ? `@${turn * 90}` : ''}`, pattern: p, edges: edgesOf(p), weight: d.weight });
      }
      p = rotate(p);
    }
  });
  return out;
}

export class Wfc {
  readonly tiles: readonly WfcTile[];
  /** Options still open per cell: `wave[cell * tiles + t]` is 1 while tile t is possible. */
  readonly wave: Uint8Array;
  /** How many options each cell has left. */
  readonly options: Uint16Array;
  /** The chosen tile per cell (−1 until it has one option left). */
  readonly result: Int32Array;
  /** Starts so far (1 + the contradictions met). */
  attempt = 0;
  /** True once every cell has one tile, false while solving or after giving up. */
  done = false;
  failed = false;
  /** Cells collapsed by choice (the rest followed from propagation). */
  choices = 0;
  private readonly T: number;
  private readonly fits: Uint8Array[]; // fits[d][a * T + b]: b may sit in direction d of a
  private readonly weights: Float64Array;
  private readonly o: Required<Omit<WfcOptions, 'border' | 'fixed'>> & Pick<WfcOptions, 'border' | 'fixed'>;
  private rand: () => number;
  private readonly stack: number[] = [];

  constructor(
    tiles: readonly WfcTile[],
    readonly width: number,
    readonly height: number,
    o: WfcOptions = {},
  ) {
    if (tiles.length === 0 || tiles.length > 65535) throw new Error('Wfc: between 1 and 65535 tiles');
    this.tiles = tiles;
    this.T = tiles.length;
    this.o = { seed: 1, attempts: 30, ...o };
    const T = this.T;
    this.fits = [0, 1, 2, 3].map((d) => {
      const f = new Uint8Array(T * T);
      for (let a = 0; a < T; a++) for (let b = 0; b < T; b++) f[a * T + b] = tiles[a]!.edges[d] === tiles[b]!.edges[OPP[d]!] ? 1 : 0;
      return f;
    });
    this.weights = Float64Array.from(tiles, (t) => Math.max(1e-6, t.weight ?? 1));
    this.wave = new Uint8Array(width * height * T);
    this.options = new Uint16Array(width * height);
    this.result = new Int32Array(width * height);
    this.rand = seeded(this.o.seed);
    this.restart();
  }

  /** Start again from scratch (each start after the first uses the next seed). */
  restart(): void {
    this.rand = seeded(this.o.seed + this.attempt * 7919);
    this.attempt++;
    this.done = this.failed = false;
    this.choices = 0;
    this.wave.fill(1);
    this.options.fill(this.T);
    this.result.fill(-1);
    this.stack.length = 0;
    const { width: w, height: h } = this;
    const border = this.o.border;
    if (border !== undefined) {
      // a cell on the edge of the map keeps only tiles showing `border` to the outside
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const out = [y === 0, x === w - 1, y === h - 1, x === 0];
          if (!out.some(Boolean)) continue;
          const c = x + y * w;
          if (this.o.fixed?.[c] !== undefined) continue; // a fixed cell is a way through the border
          for (let t = 0; t < this.T; t++) if (this.wave[c * this.T + t] && out.some((o, d) => o && this.tiles[t]!.edges[d] !== border)) this.ban(c, t);
        }
      }
    }
    for (const [cell, tile] of Object.entries(this.o.fixed ?? {})) {
      const c = Number(cell);
      for (let t = 0; t < this.T; t++) if (t !== tile && this.wave[c * this.T + t]) this.ban(c, t);
    }
    // every cell checked against its neighbours once (a tile that fits nothing goes at the start)
    for (let c = 0; c < w * h; c++) this.stack.push(c);
    if (!this.propagate()) this.contradiction();
    else this.finishIfDone();
  }

  /** Solve to the end (restarting on contradictions). True if every cell has a tile. */
  run(): boolean {
    while (this.step());
    return this.done;
  }

  /**
   * One collapse: the cell with the least entropy gets one tile, and that is propagated.
   * Returns false when there is nothing left to do (solved, or given up).
   */
  step(): boolean {
    if (this.done || this.failed) return false;
    const c = this.observe();
    if (c < 0) {
      this.finishIfDone();
      return !this.done && !this.failed;
    }
    // pick a tile by weight among the cell's options
    const T = this.T;
    let sum = 0;
    for (let t = 0; t < T; t++) if (this.wave[c * T + t]) sum += this.weights[t]!;
    let r = this.rand() * sum;
    let pick = -1;
    for (let t = 0; t < T; t++) {
      if (!this.wave[c * T + t]) continue;
      pick = t;
      r -= this.weights[t]!;
      if (r <= 0) break;
    }
    for (let t = 0; t < T; t++) if (t !== pick && this.wave[c * T + t]) this.ban(c, t);
    this.choices++;
    this.stack.push(c);
    if (!this.propagate()) this.contradiction();
    else this.finishIfDone();
    return !this.done && !this.failed;
  }

  /** Shannon entropy of a cell's options, by weight (0 when it has one left). */
  entropy(c: number): number {
    const T = this.T;
    let sum = 0;
    let sumLog = 0;
    for (let t = 0; t < T; t++) {
      if (!this.wave[c * T + t]) continue;
      const w = this.weights[t]!;
      sum += w;
      sumLog += w * Math.log(w);
    }
    return sum > 0 ? Math.log(sum) - sumLog / sum : 0;
  }

  /** The undecided cell with the least entropy (a hair of noise breaks ties), or −1. */
  private observe(): number {
    let best = -1;
    let least = Infinity;
    for (let c = 0; c < this.options.length; c++) {
      if (this.options[c]! <= 1) continue;
      const e = this.entropy(c) + this.rand() * 1e-6;
      if (e < least) {
        least = e;
        best = c;
      }
    }
    return best;
  }

  private ban(c: number, t: number): void {
    this.wave[c * this.T + t] = 0;
    const n = --this.options[c]!;
    if (n === 1) {
      for (let k = 0; k < this.T; k++) if (this.wave[c * this.T + k]) this.result[c] = k;
    } else if (n === 0) this.result[c] = -1;
  }

  /** Spread bans from the cells on the stack: a neighbour's tile goes when nothing here fits it. False on a contradiction. */
  private propagate(): boolean {
    const { width: w, height: h, T } = this;
    while (this.stack.length) {
      const c = this.stack.pop()!;
      if (this.options[c] === 0) return false;
      const x = c % w;
      const y = (c - x) / w;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = nx + ny * w;
        const fits = this.fits[d]!;
        let changed = false;
        for (let b = 0; b < T; b++) {
          if (!this.wave[n * T + b]) continue;
          let supported = false;
          for (let a = 0; a < T && !supported; a++) supported = this.wave[c * T + a] === 1 && fits[a * T + b] === 1;
          if (!supported) {
            this.ban(n, b);
            changed = true;
          }
        }
        if (changed) {
          if (this.options[n] === 0) return false;
          this.stack.push(n);
        }
      }
    }
    return true;
  }

  private contradiction(): void {
    if (this.attempt >= this.o.attempts) {
      this.failed = true;
      return;
    }
    this.restart();
  }

  private finishIfDone(): void {
    if (this.failed) return;
    for (let c = 0; c < this.options.length; c++) if (this.options[c] !== 1) return;
    this.done = true;
  }
}
