/**
 * The tree view's camera and cursor on a `width` × `height` art-pixel view, and what the pad does
 * with them, without a page: `TreeView` draws them, and the game's tree panel moves its own where
 * there is no page (`Engine.headless`), so the pad does the same to the tree there.
 *
 * The pad is the host's input for its player (`TreePadInput`: the engine's merged input, player
 * 1's pad in use, never a couch guest's, through `gamepadButtons`, recorded), read once per game
 * frame: the left stick drives the cursor (the camera follows at the edges; let go, it snaps to
 * the nearest node), the d-pad steps from node to node, the right stick pans, the triggers zoom;
 * Cross takes, Square refunds, Triangle the stats, Circle closes (what the host lets it).
 */
import type { Input } from '../../../engine/input';
import type { PassiveTree } from '../../tree/tree';
import type { TreeNode } from '../../tree/types';
import { clampCam, PointIndex, stepToward, toScreen, toTree, zoomAt, ZOOM_LIMITS, type TreeCam } from './camera';

/** The top bar's and the bottom bar's rows (art pixels): the cursor stays between them. */
export const TOP = 12;
export const BOTTOM = 10;

/** What the tree reads of a pad: the engine's `Input` (its sticks after the deadzone, y up; triggers 0..1; this frame's presses). */
export type TreePadInput = Pick<Input, 'padAxis' | 'lookAxis' | 'triggers' | 'wasPressed'>;

/** What a frame of the pad asked (`TreeCursor.pad`): the node to take or refund (the one under the cursor), the stats, closing. */
export interface TreePadAsk {
  /** The camera or the cursor moved: draw again. */
  readonly moved: boolean;
  /** The cursor landed on a node (a tick). */
  readonly ticked: boolean;
  readonly take: string | null;
  readonly refund: string | null;
  readonly stats: boolean;
  readonly close: boolean;
}

/** The d-pad: its codes (`GAMEPAD_BUTTONS`) and the way each steps. */
const STEPS: readonly (readonly [string, number, number])[] = [
  ['ArrowUp', 0, -1],
  ['ArrowDown', 0, 1],
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
];

export class TreeCursor {
  readonly index: PointIndex<TreeNode>;
  cam: TreeCam = { x: 0, y: 0, zoom: 0.12 };
  cursor = { x: 240, y: 135 };
  /** The pad drives the cursor (its cross shows, the hints name the pad). */
  padCursor = false;
  /** The node under the cursor. */
  hover: string | null = null;
  /** The left stick is held (let go: the cursor snaps to a node). */
  private stick = false;

  constructor(
    readonly tree: PassiveTree,
    public width = 480,
    public height = 270,
  ) {
    this.index = new PointIndex(tree.nodes, 120);
  }

  /** One game frame of the pad (`dt` seconds): the cursor and the camera move, and what it asks of the tree. */
  pad(input: TreePadInput, dt: number): TreePadAsk {
    const W = this.width;
    const H = this.height;
    let moved = false;
    let ticked = false;
    const m = input.padAxis;
    if (m.x || m.y) {
      this.padCursor = true;
      this.stick = true;
      const sp = 170 * dt;
      this.cursor.x += m.x * sp;
      this.cursor.y -= m.y * sp;
      const e = 24;
      const px = this.cursor.x < e ? this.cursor.x - e : this.cursor.x > W - e ? this.cursor.x - (W - e) : 0;
      const py = this.cursor.y < TOP + e ? this.cursor.y - TOP - e : this.cursor.y > H - BOTTOM - e ? this.cursor.y - (H - BOTTOM - e) : 0;
      this.cursor.x = Math.min(W - e, Math.max(e, this.cursor.x));
      this.cursor.y = Math.min(H - BOTTOM - e, Math.max(TOP + e, this.cursor.y));
      if (px || py) this.cam = this.clamp({ ...this.cam, x: this.cam.x + (px * 6) / this.cam.zoom, y: this.cam.y + (py * 6) / this.cam.zoom });
      this.updateHover();
      moved = true;
    } else if (this.stick) {
      this.stick = false;
      ticked = this.snap();
      moved = true;
    }
    const l = input.lookAxis;
    if (l.x || l.y) {
      this.cam = this.clamp({ ...this.cam, x: this.cam.x + (l.x * 260 * dt) / this.cam.zoom, y: this.cam.y - (l.y * 260 * dt) / this.cam.zoom });
      this.updateHover();
      moved = true;
    }
    const zoom = input.triggers.right - input.triggers.left;
    if (Math.abs(zoom) > 0.1) {
      const [cx, cy] = this.padCursor ? [this.cursor.x, this.cursor.y] : [W / 2, H / 2];
      this.cam = this.clamp(zoomAt(this.cam, W, H, cx, cy, Math.exp(zoom * 1.6 * dt)));
      this.updateHover();
      moved = true;
    }
    // Cross and Square act on the node under the cursor before the d-pad steps off it
    const hover = this.hover;
    for (const [code, dx, dy] of STEPS) if (input.wasPressed(code) && this.step(dx, dy)) ticked = moved = true;
    return { moved, ticked, take: input.wasPressed('PadA') ? hover : null, refund: input.wasPressed('PadX') ? hover : null, stats: input.wasPressed('PadY'), close: input.wasPressed('PadB') };
  }

  /** The d-pad: the cursor to the next node in a direction (its links first). True when it moved. */
  step(dx: number, dy: number): boolean {
    const from = this.hover ? this.tree.get(this.hover) : null;
    const [tx, ty] = toTree(this.cam, this.width, this.height, this.cursor.x, this.cursor.y);
    const origin = from ?? { x: tx, y: ty };
    const linked = from ? from.links.map((l) => this.tree.node(l)) : [];
    const r = 400;
    const next = stepToward(origin, dx, dy, linked) ?? stepToward(origin, dx, dy, this.index.inRect(origin.x - r, origin.y - r, origin.x + r, origin.y + r));
    if (!next) return false;
    this.moveTo(next);
    return true;
  }

  /** The cursor onto the nearest node, if one is near. True when it moved. */
  snap(): boolean {
    const [tx, ty] = toTree(this.cam, this.width, this.height, this.cursor.x, this.cursor.y);
    const n = this.index.nearest(tx, ty, 48 / this.cam.zoom);
    if (n) this.moveTo(n);
    return !!n;
  }

  /** The pad's cursor on a node (the camera follows when it is near an edge). */
  moveTo(n: TreeNode): void {
    this.padCursor = true;
    let [sx, sy] = toScreen(this.cam, this.width, this.height, n.x, n.y);
    if (sx < 30 || sy < TOP + 30 || sx > this.width - 30 || sy > this.height - BOTTOM - 30) {
      this.cam = this.clamp({ ...this.cam, x: n.x, y: n.y });
      [sx, sy] = toScreen(this.cam, this.width, this.height, n.x, n.y);
    }
    this.cursor = { x: sx, y: sy };
    this.hover = n.id;
  }

  /** The node under the cursor again (it or the camera moved). True when it changed. */
  updateHover(): boolean {
    const [tx, ty] = toTree(this.cam, this.width, this.height, this.cursor.x, this.cursor.y);
    const radius = (this.padCursor ? 10 : 7) / this.cam.zoom;
    const n = this.cursor.y > TOP && this.cursor.y < this.height - BOTTOM ? this.index.nearest(tx, ty, Math.max(radius, 14)) : null;
    const id = n?.id ?? null;
    if (id === this.hover) return false;
    this.hover = id;
    return true;
  }

  /** A camera kept on the tree, its zoom in limits (out far enough to see the whole tree). */
  clamp(cam: TreeCam): TreeCam {
    const b = this.index.bounds;
    const fit = Math.min(this.width / (b.x1 - b.x0 + 200), (this.height - TOP - BOTTOM) / (b.y1 - b.y0 + 200));
    const zoom = Math.min(ZOOM_LIMITS.max, Math.max(Math.min(ZOOM_LIMITS.min, fit), cam.zoom));
    return clampCam({ ...cam, zoom }, b);
  }
}
