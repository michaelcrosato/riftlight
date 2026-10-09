/**
 * Rooms as ASCII maps: one character per cell (1 m by default), north (−Z) at the top,
 * centred on the room's origin. A legend maps characters to floor heights, blocks and
 * markers; neighbouring cells that build the same thing merge into one box (one collider,
 * and one draw once the static meshes are merged), so a 24 × 18 room is a few dozen boxes,
 * not hundreds. Pure (no three.js), unit-tested.
 *
 *   ##########
 *   #........#      '#' wall, '.' floor, ' ' nothing (a pit), 'S' a marker on the floor,
 *   #..S..11.#      digits / letters: whatever the room's legend says (a step, a pad...)
 *   ####..####
 */

export interface CellRect {
  /** Column and row of the top-left cell, and the size in cells. */
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
  /** The key the cells shared. */
  readonly key: string;
}

/**
 * Greedy rectangles over a grid: each run of equal keys grows right, then down while the
 * whole run below matches. `keyOf` returns null for cells that build nothing.
 */
export function mergeCells(width: number, height: number, keyOf: (col: number, row: number) => string | null): CellRect[] {
  const used = new Uint8Array(width * height);
  const out: CellRect[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (used[row * width + col]) continue;
      const key = keyOf(col, row);
      if (key === null) continue;
      let w = 1;
      while (col + w < width && !used[row * width + col + w] && keyOf(col + w, row) === key) w++;
      let h = 1;
      grow: while (row + h < height) {
        for (let c = col; c < col + w; c++) if (used[(row + h) * width + c] || keyOf(c, row + h) !== key) break grow;
        h++;
      }
      for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) used[r * width + c] = 1;
      out.push({ col, row, cols: w, rows: h, key });
    }
  }
  return out;
}

/** A parsed map: its size and the character at each cell (' ' outside the drawn rows). */
export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly rows: readonly string[];

  constructor(
    rows: readonly string[],
    /** Metres per cell. */
    readonly cell = 1,
  ) {
    this.rows = rows;
    this.height = rows.length;
    this.width = Math.max(0, ...rows.map((r) => r.length));
  }

  at(col: number, row: number): string {
    return this.rows[row]?.[col] ?? ' ';
  }

  /** World x, z of a cell's centre (the map is centred on the origin). */
  center(col: number, row: number): [number, number] {
    return [(col + 0.5 - this.width / 2) * this.cell, (row + 0.5 - this.height / 2) * this.cell];
  }

  /** World centre and size (x, z) of a rectangle of cells. */
  rect(r: CellRect): { x: number; z: number; w: number; d: number } {
    return {
      x: (r.col + r.cols / 2 - this.width / 2) * this.cell,
      z: (r.row + r.rows / 2 - this.height / 2) * this.cell,
      w: r.cols * this.cell,
      d: r.rows * this.cell,
    };
  }

  /** Every cell holding `ch`, as world x, z. */
  find(ch: string): [number, number][] {
    const out: [number, number][] = [];
    for (let row = 0; row < this.height; row++) for (let col = 0; col < this.width; col++) if (this.at(col, row) === ch) out.push(this.center(col, row));
    return out;
  }

  /** Merged rectangles of the cells whose character passes `test`, keyed by `keyOf`. */
  merge(keyOf: (ch: string, col: number, row: number) => string | null): CellRect[] {
    return mergeCells(this.width, this.height, (c, r) => keyOf(this.at(c, r), c, r));
  }

  /** Cells (as rectangles) that are one connected run of the same character: pads, zones. */
  islands(ch: string): CellRect[] {
    return this.merge((c) => (c === ch ? ch : null));
  }
}
