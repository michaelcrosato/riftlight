/**
 * The passive tree view: a full-screen pixel-art overlay. A 2D canvas at art resolution
 * (480×270 by default), using the engine's framing mode so it is exactly as crisp as
 * the HUD. Embedded views share the game's fill mode; standalone views use adaptive.
 *
 *   const view = new TreeView({ container, state, audio: ctx.audio, onChange: (c, s) => save(s) });
 *   view.open();  view.close();  view.isOpen();
 *
 * Controls: drag / WASD / arrows / right stick pan; wheel / pinch / Q E / triggers zoom;
 * hover or tap shows the tooltip with the path cost; click / Enter / A allocates the path;
 * right-click / long-press / Backspace / X refunds; Tab / Y shows the stat summary; / or F
 * searches; Escape (or `closeKeys`) / B closes. The left stick drives a cursor that snaps to
 * the nearest node; the d-pad steps from node to node.
 *
 * While open the view takes the keyboard (key events don't reach the game) and polls the
 * first standard gamepad itself; the shell should pause the game while it is open. A view in
 * a game passes `defer`: what the player does to the tree (allocate, refund, close) goes to it
 * instead of happening, and the game hands it back to `perform` from its recorded input, so a
 * replay of the game does the same to the tree.
 */
import { computeFraming, RESOLUTIONS, type AspectMode, type Framing, type Resolution } from '../../../engine/framing';
import { drawDeviceText, surfaceScale } from '../../../engine/hud/deviceText';
import { wrapText } from '../../../engine/hud/wrap';
import { PALETTE, type PaletteColor } from '../../../engine/palette';
import { lang, t } from '../../lang/index';
import { REGIONS } from '../../tree/data/regions';
import { kindName, nodeFlavour, nodeLines, nodeName, regionName } from '../../tree/text';
import { defaultTree, PassiveTree, searchTree, summarizeMods, TreeState } from '../../tree/tree';
import type { TreeNode } from '../../tree/types';
import { clampCam, PointIndex, stepToward, toScreen, toTree, zoomAt, ZOOM_LIMITS, type TreeCam } from './camera';
import { css, pack, PixelBuffer, textWidth } from './pixels';
import { activateNode, refundNode, registerTreeSounds, type TreeAction, type TreeOutcome, type TreeRules } from './actions';

export type { TreeAction, TreeAudio } from './actions';

export interface TreeViewOptions extends TreeRules {
  /** Element the overlay fills (the engine's container, or a page's #app). */
  container: HTMLElement;
  /** Default: the game's tree. */
  tree?: PassiveTree;
  /** Default: an empty allocation with unlimited points. */
  state?: TreeState;
  /** Art resolution height (and 16:9 fallback). Default 480×270. */
  resolution?: Resolution;
  /** Match the containing game's presentation. Standalone views default to adaptive. */
  aspect?: AspectMode;
  /** Key codes that close the view. Default ['Escape']; [] = can't be closed by key. */
  closeKeys?: readonly string[];
  /** Gamepad B closes the view (default true when closeKeys isn't empty). */
  padCloses?: boolean;
  onClose?: () => void;
  /** Current gold, shown in the top bar. */
  gold?: () => number;
  /**
   * Take what the player does instead of doing it (a game: `ctx.input.send` it, then `perform`
   * it when it arrives, so the recording keeps it). Absent: it happens at once.
   */
  defer?: (action: TreeAction) => void;
}



const C = Object.fromEntries(Object.entries(PALETTE).map(([k]) => [k, pack(k as PaletteColor)])) as Record<PaletteColor, number>;
const TOP = 12;
const BOTTOM = 10;
const PULSE = 0.45;

interface Line {
  text: string;
  color: number;
}

export class TreeView {
  readonly tree: PassiveTree;
  private stateRef: TreeState;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly search: HTMLInputElement;
  private readonly g: CanvasRenderingContext2D | null;
  private buf: PixelBuffer;
  private image: ImageData | null = null;
  /** The bitmap at art size, scaled onto the canvas when the frame holds device-font text. */
  private artCanvas: HTMLCanvasElement | null = null;
  private framing: Framing | null = null;
  private readonly index: PointIndex<TreeNode>;
  private readonly links: [TreeNode, TreeNode][] = [];
  private cam: TreeCam = { x: 0, y: 0, zoom: 0.12 };
  private opened = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private dirty = true;
  private frames = 0;
  private readonly held = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number; type: string }>();
  private drag: { x: number; y: number; cam: TreeCam; moved: boolean; button: number; type: string; down: number } | null = null;
  private pinch: { dist: number; cam: TreeCam; mx: number; my: number } | null = null;
  private longPress = 0;
  private cursor = { x: 240, y: 135 };
  private padCursor = false;
  private padHeld: boolean[] = [];
  private padStick = false;
  private hover: string | null = null;
  private tapped: { id: string; at: number } | null = null;
  private preview: { id: string; path: string[] | null; version: number } | null = null;
  private ownedCache: { version: number; owned: Set<string>; frontier: Set<string> } | null = null;
  private readonly pulses = new Map<string, { t0: number; color: number }>();
  private message: { text: string; color: number; until: number } | null = null;
  private query = '';
  private matches = new Set<string>();
  private matchList: string[] = [];
  private matchIndex = -1;
  private showStats = false;
  private statsScroll = 0;
  private readonly ac = new AbortController();
  private openAc: AbortController | null = null;

  constructor(private readonly options: TreeViewOptions) {
    this.tree = options.tree ?? defaultTree();
    this.stateRef = options.state ?? new TreeState(this.tree);
    this.index = new PointIndex(this.tree.nodes, 120);
    for (const n of this.tree.nodes) for (const l of n.links) if (l > n.id) this.links.push([n, this.tree.node(l)]);
    const res = options.resolution ?? RESOLUTIONS.default;
    this.buf = new PixelBuffer(res.width, res.height);
    registerTreeSounds(options.audio);

    const root = (this.root = document.createElement('div'));
    root.className = 'rift-tree';
    root.dataset.riftTree = 'true';
    Object.assign(root.style, { position: 'absolute', inset: '0', zIndex: '30', background: '#0d0e16', display: 'none', touchAction: 'none', userSelect: 'none', overflow: 'hidden' });
    const canvas = (this.canvas = document.createElement('canvas'));
    canvas.dataset.riftTree = 'canvas';
    canvas.dataset.hud = 'true'; // a 2D overlay, not a rendering canvas (see the e2e canvas count)
    Object.assign(canvas.style, { position: 'absolute', imageRendering: 'pixelated' });
    const search = (this.search = document.createElement('input'));
    search.type = 'text';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.setAttribute('aria-label', t('tree.view.search_label'));
    search.dataset.riftTree = 'search';
    Object.assign(search.style, { position: 'absolute', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', border: '0', padding: '0' });
    root.append(canvas, search);
    options.container.appendChild(root);
    this.g = canvas.getContext('2d');

    search.addEventListener('input', () => this.setQuery(search.value), { signal: this.ac.signal });
    search.addEventListener('blur', () => (this.dirty = true), { signal: this.ac.signal });
  }

  // ---------------------------------------------------------------- public API

  get state(): TreeState {
    return this.stateRef;
  }

  /** Swap the allocation (after a load or a full respec in the shell). */
  setState(state: TreeState): void {
    this.stateRef = state;
    this.preview = null;
    this.dirty = true;
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.root.style.display = '';
    const ac = (this.openAc = new AbortController());
    const sig = { signal: ac.signal };
    const r = this.root;
    r.addEventListener('pointerdown', (e) => this.onPointerDown(e), sig);
    r.addEventListener('pointermove', (e) => this.onPointerMove(e), sig);
    r.addEventListener('pointerup', (e) => this.onPointerUp(e), sig);
    r.addEventListener('pointercancel', (e) => this.onPointerUp(e, true), sig);
    r.addEventListener('wheel', (e) => this.onWheel(e), { ...sig, passive: false });
    r.addEventListener('contextmenu', (e) => e.preventDefault(), sig);
    window.addEventListener('keydown', (e) => this.onKey(e, true), { ...sig, capture: true });
    window.addEventListener('keyup', (e) => this.onKey(e, false), { ...sig, capture: true });
    window.addEventListener('resize', () => this.resize(), sig);
    window.addEventListener('blur', () => this.held.clear(), sig);
    this.padHeld = [];
    this.resize();
    this.dirty = true;
    this.last = performance.now(); // real time: UI animation
    const loop = (now: number) => {
      if (!this.opened) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.update(dt);
    };
    this.raf = requestAnimationFrame(loop);
    this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    cancelAnimationFrame(this.raf);
    this.openAc?.abort();
    this.openAc = null;
    this.held.clear();
    this.pointers.clear();
    this.drag = this.pinch = null;
    this.search.blur();
    this.root.style.display = 'none';
    this.options.onClose?.();
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  dispose(): void {
    this.close();
    this.ac.abort();
    this.root.remove();
  }

  /** Centre the camera on a node (and optionally set the zoom). */
  focus(id: string | null, zoom = this.cam.zoom): void {
    const n = id ? this.tree.get(id) : undefined;
    this.cam = { x: n?.x ?? 0, y: n?.y ?? 0, zoom };
    this.dirty = true;
  }

  /** Redraw on the next frame (e.g. the shell changed points or gold). */
  refresh(): void {
    this.preview = null;
    this.dirty = true;
  }

  /** Allocate the path to a node as a click would. Returns the allocated ids. */
  allocate(id: string): string[] {
    return this.activate(id);
  }

  /** Refund a node as a right-click would. */
  refund(id: string): boolean {
    return this.refundNode(id);
  }

  /** Do what the player did (`defer` handed it over): allocate, refund or close. */
  perform(action: TreeAction): void {
    if (action.kind === 'activate') this.activate(action.id);
    else if (action.kind === 'refund') this.refundNode(action.id);
    else this.close();
    this.dirty = true;
  }

  /** The player did something to the tree: hand it to `defer`, or do it now. */
  private act(action: TreeAction): void {
    if (this.options.defer) this.options.defer(action);
    else this.perform(action);
  }

  /** Tooling/tests: the view's state. */
  debug() {
    return {
      open: this.opened,
      cam: { ...this.cam },
      hover: this.hover,
      spent: this.stateRef.spent,
      points: this.stateRef.points,
      matches: this.matchList.length,
      frames: this.frames,
      art: { width: this.buf.width, height: this.buf.height },
      scale: this.framing?.scale ?? 0,
      showStats: this.showStats,
      cursor: { ...this.cursor },
    };
  }

  /** Tooling/tests: the screen position (art pixels) of a node. */
  screenOf(id: string): [number, number] | null {
    const n = this.tree.get(id);
    return n ? toScreen(this.cam, this.buf.width, this.buf.height, n.x, n.y) : null;
  }

  /** Tooling/tests: the last painted frame. */
  pixels(): Uint8ClampedArray {
    return this.buf.bytes;
  }

  /** Tooling/tests: set the search text as if typed. */
  setQuery(q: string): void {
    this.query = q;
    this.search.value = q;
    this.matchList = q.trim() ? searchTree(this.tree, q) : [];
    this.matches = new Set(this.matchList);
    this.matchIndex = -1;
    this.dirty = true;
  }

  // ---------------------------------------------------------------- input

  private art(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return [this.cursor.x, this.cursor.y];
    return [((e.clientX - rect.left) / rect.width) * this.buf.width, ((e.clientY - rect.top) / rect.height) * this.buf.height];
  }

  private twoPointers(): [{ x: number; y: number }, { x: number; y: number }] {
    const [a, b] = [...this.pointers.values()];
    return [a ?? this.cursor, b ?? a ?? this.cursor];
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.target === this.search) return;
    e.preventDefault();
    this.root.setPointerCapture?.(e.pointerId);
    const [x, y] = this.art(e);
    const close = this.closeBox();
    if (close && x >= close.x && y < close.h && this.pointers.size === 0) {
      this.act({ kind: 'close' });
      return;
    }
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    this.padCursor = false;
    this.cursor = { x, y };
    if (this.inSearchBox(x, y)) {
      this.search.focus();
      return;
    }
    if (document.activeElement === this.search) this.search.blur();
    if (this.pointers.size === 1) {
      this.drag = { x, y, cam: { ...this.cam }, moved: false, button: e.button, type: e.pointerType, down: performance.now() }; // real time: UI gesture timing
      this.updateHover();
      if (e.pointerType === 'touch') {
        clearTimeout(this.longPress);
        this.longPress = window.setTimeout(() => {
          if (this.drag && !this.drag.moved && this.hover) {
            this.drag.moved = true;
            this.act({ kind: 'refund', id: this.hover });
          }
        }, 550);
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = this.twoPointers();
      this.pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cam: { ...this.cam }, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      if (this.drag) this.drag.moved = true;
      clearTimeout(this.longPress);
    }
    this.dirty = true;
  }

  private onPointerMove(e: PointerEvent): void {
    const [x, y] = this.art(e);
    const p = this.pointers.get(e.pointerId);
    if (p) [p.x, p.y] = [x, y];
    this.padCursor = false;
    this.cursor = { x, y };
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = this.twoPointers();
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const z = zoomAt(this.pinch.cam, this.buf.width, this.buf.height, this.pinch.mx, this.pinch.my, dist / this.pinch.dist);
      this.cam = this.clamp({ ...z, x: z.x - (mx - this.pinch.mx) / z.zoom, y: z.y - (my - this.pinch.my) / z.zoom });
    } else if (this.drag) {
      const dx = x - this.drag.x;
      const dy = y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > (this.drag.type === 'touch' ? 4 : 2)) {
        this.drag.moved = true;
        clearTimeout(this.longPress);
      }
      if (this.drag.moved) this.cam = this.clamp({ ...this.drag.cam, x: this.drag.cam.x - dx / this.cam.zoom, y: this.drag.cam.y - dy / this.cam.zoom });
    }
    this.updateHover();
    this.dirty = true;
  }

  private onPointerUp(e: PointerEvent, cancel = false): void {
    this.pointers.delete(e.pointerId);
    clearTimeout(this.longPress);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    if (this.pointers.size === 0) this.drag = null;
    if (!d || d.moved || cancel || this.pointers.size > 0) return;
    this.updateHover();
    const id = this.hover;
    if (!id) return;
    if (d.button === 2) {
      this.act({ kind: 'refund', id });
    } else if (d.type === 'touch') {
      // First tap shows the tooltip; a second tap on the same node allocates.
      if (this.tapped?.id === id && performance.now() - this.tapped.at < 4000) { // real time: UI gesture timing (a double tap)
        this.act({ kind: 'activate', id });
        this.tapped = null;
      } else this.tapped = { id, at: performance.now() }; // real time: UI gesture timing (a double tap)
    } else if (d.button === 0) this.act({ kind: 'activate', id });
    this.dirty = true;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const [x, y] = this.art(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (this.showStats && x > this.buf.width - 182) {
      this.statsScroll = Math.max(0, this.statsScroll + Math.sign(dy) * 3);
    } else {
      this.cam = this.clamp(zoomAt(this.cam, this.buf.width, this.buf.height, x, y, Math.exp(-dy * 0.0015)));
      this.updateHover();
    }
    this.dirty = true;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.opened) return;
    if (!down) {
      this.held.delete(e.code);
      return;
    }
    // The tree owns the keyboard while it is open: the game never sees these presses.
    e.stopImmediatePropagation();
    if (e.target === this.search) {
      if (e.code === 'Escape') this.search.blur();
      else if (e.code === 'Enter') this.nextMatch();
      this.dirty = true;
      return;
    }
    const code = e.code;
    const closeKeys = this.options.closeKeys ?? ['Escape'];
    if (closeKeys.includes(code)) {
      e.preventDefault();
      this.act({ kind: 'close' });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && code === 'KeyF') {
      e.preventDefault();
      this.search.focus();
      return;
    }
    switch (code) {
      case 'Slash':
      case 'KeyF':
        e.preventDefault();
        this.search.focus();
        break;
      case 'Tab':
        e.preventDefault();
        this.showStats = !this.showStats;
        break;
      case 'Enter':
      case 'Space':
        e.preventDefault();
        if (this.hover) this.act({ kind: 'activate', id: this.hover });
        break;
      case 'Backspace':
      case 'Delete':
      case 'KeyX':
        e.preventDefault();
        if (this.hover) this.act({ kind: 'refund', id: this.hover });
        break;
      case 'KeyH':
      case 'Home':
        this.focus(null, 0.12);
        break;
      case 'KeyN':
        this.nextMatch();
        break;
      default:
        if (/^(Key[WASDQE]|Arrow\w+|Minus|Equal|NumpadAdd|NumpadSubtract)$/.test(code)) {
          e.preventDefault();
          this.held.add(code);
        }
    }
    this.dirty = true;
  }

  private nextMatch(): void {
    if (!this.matchList.length) return;
    this.matchIndex = (this.matchIndex + 1) % this.matchList.length;
    const id = this.matchList[this.matchIndex]!;
    this.focus(id, Math.max(this.cam.zoom, 0.2));
    this.cursor = { x: this.buf.width / 2, y: this.buf.height / 2 };
    this.hover = id;
  }

  private pollPad(dt: number): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected && p.mapping === 'standard');
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : v);
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const edge = (i: number) => pressed(i) && !this.padHeld[i];
    const W = this.buf.width;
    const H = this.buf.height;
    // Left stick: the cursor (camera follows at the edges); released → snap to the nearest node.
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    if (lx || ly) {
      this.padCursor = true;
      this.padStick = true;
      const sp = 170 * dt;
      this.cursor.x += lx * sp;
      this.cursor.y += ly * sp;
      const m = 24;
      const px = this.cursor.x < m ? this.cursor.x - m : this.cursor.x > W - m ? this.cursor.x - (W - m) : 0;
      const py = this.cursor.y < TOP + m ? this.cursor.y - TOP - m : this.cursor.y > H - BOTTOM - m ? this.cursor.y - (H - BOTTOM - m) : 0;
      this.cursor.x = Math.min(W - m, Math.max(m, this.cursor.x));
      this.cursor.y = Math.min(H - BOTTOM - m, Math.max(TOP + m, this.cursor.y));
      if (px || py) this.cam = this.clamp({ ...this.cam, x: this.cam.x + (px * 6) / this.cam.zoom, y: this.cam.y + (py * 6) / this.cam.zoom });
      this.updateHover();
      this.dirty = true;
    } else if (this.padStick) {
      this.padStick = false;
      this.snapCursor();
    }
    // Right stick pans, triggers zoom.
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    if (rx || ry) {
      this.cam = this.clamp({ ...this.cam, x: this.cam.x + (rx * 260 * dt) / this.cam.zoom, y: this.cam.y + (ry * 260 * dt) / this.cam.zoom });
      this.updateHover();
      this.dirty = true;
    }
    const zoom = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
    if (Math.abs(zoom) > 0.1) {
      const [cx, cy] = this.padCursor ? [this.cursor.x, this.cursor.y] : [W / 2, H / 2];
      this.cam = this.clamp(zoomAt(this.cam, W, H, cx, cy, Math.exp(zoom * 1.6 * dt)));
      this.updateHover();
      this.dirty = true;
    }
    if (edge(0) && this.hover) this.act({ kind: 'activate', id: this.hover });
    if (edge(2) && this.hover) this.act({ kind: 'refund', id: this.hover });
    if (edge(3)) this.showStats = !this.showStats;
    if (edge(1) && (this.options.padCloses ?? (this.options.closeKeys ?? ['Escape']).length > 0)) this.act({ kind: 'close' });
    const dirs: [number, number, number][] = [
      [12, 0, -1],
      [13, 0, 1],
      [14, -1, 0],
      [15, 1, 0],
    ];
    for (const [b, dx, dy] of dirs) if (edge(b)) this.step(dx, dy);
    this.padHeld = pad.buttons.map((b) => b.pressed);
    if (this.padHeld.some(Boolean)) this.dirty = true;
  }

  /** D-pad: move the cursor to the next node in a direction (its links first). */
  private step(dx: number, dy: number): void {
    const from = this.hover ? this.tree.get(this.hover) : null;
    const [tx, ty] = toTree(this.cam, this.buf.width, this.buf.height, this.cursor.x, this.cursor.y);
    const origin = from ?? { x: tx, y: ty };
    const linked = from ? from.links.map((l) => this.tree.node(l)) : [];
    const r = 400;
    const next = stepToward(origin, dx, dy, linked) ?? stepToward(origin, dx, dy, this.index.inRect(origin.x - r, origin.y - r, origin.x + r, origin.y + r));
    if (!next) return;
    this.moveCursorTo(next);
    this.options.audio?.play('treeTick');
  }

  private snapCursor(): void {
    const [tx, ty] = toTree(this.cam, this.buf.width, this.buf.height, this.cursor.x, this.cursor.y);
    const n = this.index.nearest(tx, ty, 48 / this.cam.zoom);
    if (n) {
      this.moveCursorTo(n);
      this.options.audio?.play('treeTick');
    }
  }

  private moveCursorTo(n: TreeNode): void {
    this.padCursor = true;
    let [sx, sy] = toScreen(this.cam, this.buf.width, this.buf.height, n.x, n.y);
    if (sx < 30 || sy < TOP + 30 || sx > this.buf.width - 30 || sy > this.buf.height - BOTTOM - 30) {
      this.cam = this.clamp({ ...this.cam, x: n.x, y: n.y });
      [sx, sy] = toScreen(this.cam, this.buf.width, this.buf.height, n.x, n.y);
    }
    this.cursor = { x: sx, y: sy };
    this.hover = n.id;
    this.dirty = true;
  }

  private updateHover(): void {
    const [tx, ty] = toTree(this.cam, this.buf.width, this.buf.height, this.cursor.x, this.cursor.y);
    const radius = (this.padCursor ? 10 : 7) / this.cam.zoom;
    const n = this.cursor.y > TOP && this.cursor.y < this.buf.height - BOTTOM ? this.index.nearest(tx, ty, Math.max(radius, 14)) : null;
    const id = n?.id ?? null;
    if (id !== this.hover) {
      this.hover = id;
      this.dirty = true;
    }
  }

  private clamp(cam: TreeCam): TreeCam {
    const b = this.index.bounds;
    const fit = Math.min(this.buf.width / (b.x1 - b.x0 + 200), (this.buf.height - TOP - BOTTOM) / (b.y1 - b.y0 + 200));
    const zoom = Math.min(ZOOM_LIMITS.max, Math.max(Math.min(ZOOM_LIMITS.min, fit), cam.zoom));
    return clampCam({ ...cam, zoom }, b);
  }

  private inSearchBox(x: number, y: number): boolean {
    const b = this.searchBox();
    return x >= b.x && x < b.x + b.w && y >= 0 && y < TOP;
  }

  /** The top bar's close box (touch and mouse), when the view can be closed. */
  private closeBox(): { x: number; w: number; h: number } | null {
    if (!(this.options.closeKeys ?? ['Escape']).length) return null;
    return { x: this.buf.width - 16, w: 16, h: TOP };
  }

  /** A phone in portrait: the top bar drops the title and shortens everything. */
  private get narrowBar(): boolean {
    return this.buf.width < 300;
  }

  private searchBox() {
    if (this.narrowBar) return { x: 2, y: 1, w: 44, h: TOP - 2 };
    const w = Math.min(130, Math.max(70, this.buf.width - 260));
    return { x: Math.round((this.buf.width - w) / 2), y: 1, w, h: TOP - 2 };
  }

  // ---------------------------------------------------------------- actions

  private activate(id: string): string[] {
    const o = activateNode(this.tree, this.stateRef, id, this.options);
    this.show(o);
    return o.kind === 'allocate' ? [...o.ids] : [];
  }

  private refundNode(id: string): boolean {
    const o = refundNode(this.tree, this.stateRef, id, this.options);
    this.show(o);
    return o.kind === 'refund';
  }

  /** What an action did, on screen: a pulse along the nodes and a line of text. */
  private show(o: TreeOutcome): void {
    if (o.kind === 'deny') this.say(o.text, C.red);
    else if (o.kind === 'mastery') this.pulse(o.ids, C.cyan);
    else if (o.kind === 'allocate') {
      this.pulse(o.ids, C.sand);
      this.say(t('tree.msg.taken', { count: o.ids.length, name: nodeName(o.node) }), C.sand);
      this.preview = null;
    } else if (o.kind === 'refund') {
      this.pulse([o.id], C.red);
      this.say(o.cost > 0 ? t('tree.msg.refunded_gold', { cost: o.cost }) : t('tree.msg.refunded'), C.orange);
      this.preview = null;
    }
  }

  private say(text: string, color: number): void {
    this.message = { text, color, until: this.time + 1.6 };
    this.dirty = true;
  }

  private pulse(ids: readonly string[], color: number): void {
    ids.forEach((id, i) => this.pulses.set(id, { t0: this.time + i * 0.04, color }));
    this.dirty = true;
  }

  // ---------------------------------------------------------------- frame

  private resize(): void {
    const c = this.options.container;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    const res = this.options.resolution ?? RESOLUTIONS.default;
    const f = (this.framing = computeFraming(w, h, window.devicePixelRatio || 1, res, this.options.aspect ?? 'adaptive'));
    if (f.artWidth !== this.buf.width || f.artHeight !== this.buf.height) {
      const [tx, ty] = [this.cam.x, this.cam.y];
      this.buf = new PixelBuffer(f.artWidth, f.artHeight);
      this.image = null;
      this.cam = { ...this.cam, x: tx, y: ty };
    }
    this.canvas.width = f.artWidth;
    this.canvas.height = f.artHeight;
    Object.assign(this.canvas.style, { width: `${f.cssWidth}px`, height: `${f.cssHeight}px`, left: `${f.offsetX}px`, top: `${f.offsetY}px` });
    this.dirty = true;
  }

  private update(dt: number): void {
    this.time += dt;
    const W = this.buf.width;
    const H = this.buf.height;
    let vx = 0;
    let vy = 0;
    const has = (...codes: string[]) => codes.some((c) => this.held.has(c));
    if (has('KeyA', 'ArrowLeft')) vx -= 1;
    if (has('KeyD', 'ArrowRight')) vx += 1;
    if (has('KeyW', 'ArrowUp')) vy -= 1;
    if (has('KeyS', 'ArrowDown')) vy += 1;
    if (vx || vy) {
      this.cam = this.clamp({ ...this.cam, x: this.cam.x + (vx * 240 * dt) / this.cam.zoom, y: this.cam.y + (vy * 240 * dt) / this.cam.zoom });
      this.updateHover();
      this.dirty = true;
    }
    const z = (has('KeyE', 'Equal', 'NumpadAdd') ? 1 : 0) - (has('KeyQ', 'Minus', 'NumpadSubtract') ? 1 : 0);
    if (z) {
      this.cam = this.clamp(zoomAt(this.cam, W, H, W / 2, H / 2, Math.exp(z * 1.8 * dt)));
      this.updateHover();
      this.dirty = true;
    }
    this.pollPad(dt);
    if (this.message && this.time > this.message.until) {
      this.message = null;
      this.dirty = true;
    }
    for (const [id, p] of this.pulses) if (this.time - p.t0 > PULSE) this.pulses.delete(id);
    if (this.pulses.size || this.matches.size || document.activeElement === this.search) this.dirty = true;
    if (this.dirty) this.render();
  }

  private owned(): { owned: Set<string>; frontier: Set<string> } {
    const v = this.stateRef.version;
    if (this.ownedCache?.version !== v || this.ownedCache.owned.size !== this.stateRef.allocated.size + this.tree.roots.size) {
      const owned = this.stateRef.owned();
      const frontier = new Set<string>();
      for (const id of owned) if (this.tree.passable(id) || this.tree.roots.has(id)) for (const l of this.tree.neighbours(id)) if (!owned.has(l)) frontier.add(l);
      this.ownedCache = { version: v, owned, frontier };
    }
    return this.ownedCache;
  }

  private previewPath(): Set<string> {
    const id = this.hover;
    if (!id || this.stateRef.isAllocated(id)) return new Set();
    if (this.preview?.id !== id || this.preview.version !== this.stateRef.version) this.preview = { id, path: this.stateRef.pathTo(id), version: this.stateRef.version };
    return new Set(this.preview.path ?? []);
  }

  /** Paint one frame (public for tools: draws even when nothing changed). */
  render(): void {
    this.dirty = false;
    this.frames++;
    const b = this.buf;
    const W = b.width;
    const H = b.height;
    const z = this.cam.zoom;
    const { owned, frontier } = this.owned();
    const path = this.previewPath();
    const canAfford = path.size <= this.stateRef.unspent;
    const tier = z >= 0.3 ? 2 : z >= 0.13 ? 1 : 0;
    const S = (x: number, y: number) => toScreen(this.cam, W, H, x, y);
    b.clear(C.ink);

    // Region names, large, when zoomed out.
    if (z < 0.09) {
      for (const r of REGIONS.all()) {
        const a = (r.angle * Math.PI) / 180;
        const [sx, sy] = S(Math.cos(a) * 1500, Math.sin(a) * 1500);
        const name = regionName(r.id);
        b.text(name, sx - textWidth(name, 2) / 2, sy - 7, pack(r.dim), 2);
      }
    }

    // Links.
    const margin = 4;
    for (const [n, m] of this.links) {
      const [ax, ay] = S(n.x, n.y);
      const [bx, by] = S(m.x, m.y);
      if ((ax < -margin && bx < -margin) || (ay < -margin && by < -margin) || (ax > W + margin && bx > W + margin) || (ay > H + margin && by > H + margin)) continue;
      const on = owned.has(n.id) && owned.has(m.id);
      const pre = (path.has(n.id) || owned.has(n.id)) && (path.has(m.id) || owned.has(m.id)) && (path.has(n.id) || path.has(m.id));
      if (on) b.thickLine(ax, ay, bx, by, C.sand, tier >= 1 ? C.orange : undefined);
      else if (pre) b.thickLine(ax, ay, bx, by, canAfford ? C.cyan : C.red, tier >= 1 ? C.navy : undefined);
      else b.line(ax, ay, bx, by, n.region === m.region && REGIONS.has(n.region) ? pack(REGIONS.get(n.region).dim) : C.night);
    }

    // Nodes.
    const [x0, y0] = toTree(this.cam, W, H, -12, -12);
    const [x1, y1] = toTree(this.cam, W, H, W + 12, H + 12);
    const visible = this.index.inRect(x0, y0, x1, y1);
    const blink = Math.floor(this.time * 4) % 2 === 0;
    for (const n of visible) {
      const [sx, sy] = S(n.x, n.y);
      const region = REGIONS.has(n.region) ? REGIONS.get(n.region) : null;
      const col = region ? pack(region.color) : C.white;
      const dim = region ? pack(region.dim) : C.slate;
      const isOwned = owned.has(n.id);
      const onPath = path.has(n.id);
      const near = frontier.has(n.id);
      const r = radius(n.kind, tier);
      switch (n.kind) {
        case 'small':
          b.disc(sx, sy, r, isOwned ? C.sand : onPath ? C.cyan : col);
          if (r >= 1 && (near || (isOwned && tier === 2))) b.set(sx, sy, isOwned ? C.white : C.ink);
          break;
        case 'notable':
          b.disc(sx, sy, r, C.ink);
          b.ring(sx, sy, r, isOwned ? C.sand : onPath ? C.cyan : col);
          if (r >= 3) b.disc(sx, sy, r - 2, isOwned ? C.white : near ? col : dim);
          break;
        case 'keystone':
          b.disc(sx, sy, r + 1, C.ink);
          if (tier >= 1) {
            b.diamond(sx, sy, r + 3, isOwned ? C.sand : C.orange);
            b.disc(sx, sy, r, C.ink);
          }
          b.ring(sx, sy, r, isOwned ? C.white : C.sand);
          b.disc(sx, sy, Math.max(0, r - 2), isOwned ? C.sand : onPath ? C.cyan : col);
          if (r >= 4) b.disc(sx, sy, 1, C.ink);
          break;
        case 'mastery':
          b.diamond(sx, sy, r, isOwned ? C.sand : C.cyan);
          if (r >= 2) b.diamond(sx, sy, r - 2, isOwned ? C.white : C.ink);
          break;
        case 'start':
          b.disc(sx, sy, r, C.white);
          b.disc(sx, sy, Math.max(0, r - 2), col);
          break;
        default:
          b.disc(sx, sy, r, C.mist);
      }
      if (this.matches.has(n.id) && blink) b.ring(sx, sy, r + 3, C.lime);
      const p = this.pulses.get(n.id);
      if (p && this.time >= p.t0) {
        const k = (this.time - p.t0) / PULSE;
        b.ring(sx, sy, Math.round(r + 2 + k * 9), k < 0.5 ? p.color : C.orange);
      }
      if (n.id === this.hover) b.ring(sx, sy, r + 2, C.white);
    }

    // Labels: keystones when not fully zoomed out, notables when close.
    if (z >= 0.06) {
      for (const n of visible) {
        if (n.kind !== 'keystone' && !(tier === 2 && (n.kind === 'notable' || n.kind === 'mastery'))) continue;
        const [sx, sy] = S(n.x, n.y);
        const name = nodeName(n);
        const tw = textWidth(name);
        b.text(name, sx - tw / 2, sy + radius(n.kind, tier) + (n.kind === 'keystone' && tier >= 1 ? 5 : 3), n.kind === 'keystone' ? C.sand : C.mist, 1, C.ink);
      }
    }

    // Controller cursor.
    if (this.padCursor) {
      const cx = Math.round(this.cursor.x);
      const cy = Math.round(this.cursor.y);
      for (const [dx, dy] of [
        [-5, 0],
        [-4, 0],
        [4, 0],
        [5, 0],
        [0, -5],
        [0, -4],
        [0, 4],
        [0, 5],
      ] as const)
        b.set(cx + dx, cy + dy, C.white);
    }

    this.drawChrome(owned);
    if (this.showStats) this.drawStats();
    if (this.hover) this.drawTooltip(this.tree.node(this.hover), path);
    if (this.message) {
      const rows = wrapText(this.message.text, W - 16);
      const tw = Math.max(...rows.map((r) => textWidth(r)));
      const mx = Math.round((W - tw) / 2);
      const my = H - BOTTOM - 7 - rows.length * 9;
      b.panel(mx - 4, my - 3, tw + 8, rows.length * 9 + 4, C.ink);
      b.frame(mx - 4, my - 3, tw + 8, rows.length * 9 + 4, this.message.color);
      rows.forEach((r, i) => b.text(r, mx, my + i * 9, this.message!.color));
    }
    this.blit();
  }

  private drawChrome(owned: Set<string>): void {
    const b = this.buf;
    const W = b.width;
    const H = b.height;
    b.panel(0, 0, W, TOP, C.night);
    b.rect(0, TOP, W, 1, C.ink);
    const narrow = this.narrowBar;
    const box = this.searchBox();
    const s = this.stateRef;
    const close = this.closeBox();
    const right = close ? close.x - 3 : W - 4;
    // the right of the bar: points (and gold where it pays for something), short forms when the long ones don't fit
    const count = this.query ? textWidth(lang().formatNumber(this.matchList.length)) + 8 : 0;
    const room = right - (box.x + box.w + 4 + count);
    const parts = (short: boolean): string[] => {
      const pts = Number.isFinite(s.points) ? t(short ? 'tree.view.points_short' : 'tree.view.points', { left: s.unspent, total: s.points }) : t('tree.view.spent', { count: owned.size - this.tree.roots.size });
      // a phone shows the gold only where it pays for something (the respec)
      const gold = this.options.gold && (!narrow || this.options.spendGold) ? t(short ? 'tree.view.gold_short' : 'tree.view.gold', { gold: this.options.gold() }) : null;
      return gold ? [pts, gold] : [pts];
    };
    const width = (p: string[]) => p.reduce((w, x) => w + textWidth(x), 0) + (p.length - 1) * 8;
    let shown = parts(narrow);
    if (!narrow && width(shown) > room) shown = parts(true);
    let x = right - width(shown);
    for (const p of shown) x += b.text(p, x, 3, s.unspent > 0 ? C.lime : C.mist) + 8;
    if (!narrow) {
      const title = t('tree.view.title');
      if (textWidth(title) <= box.x - 8) b.text(title, 4, 3, C.sand);
    }
    if (close) {
      b.rect(close.x, 0, close.w, TOP, C.plum);
      b.text('×', close.x + 5, 3, C.white);
    }
    const focused = document.activeElement === this.search;
    b.rect(box.x, box.y, box.w, box.h, C.ink);
    b.frame(box.x, box.y, box.w, box.h, focused ? C.white : C.slate);
    const fits = box.w - 6;
    let label = this.query;
    if (!label && !focused) {
      label = t(narrow ? 'tree.view.search_short' : 'tree.view.search');
      if (textWidth(label) > fits) label = t('tree.view.search_short');
      while (label && textWidth(label) > fits) label = [...label].slice(0, -1).join('');
    }
    // typed text keeps its end in view
    while (label && textWidth(label) > fits) label = [...label].slice(1).join('');
    b.text(label, box.x + 3, box.y + 2, this.query ? C.white : C.slate);
    if (focused && Math.floor(this.time * 3) % 2 === 0) b.rect(box.x + 3 + (label ? textWidth(label) + 1 : 0), box.y + 2, 1, 7, C.white);
    if (this.query) b.text(lang().formatNumber(this.matchList.length), box.x + box.w + 4, 3, this.matchList.length ? C.lime : C.red);
    // Bottom hints: as many as fit, the most useful first (shown in their usual order).
    b.panel(0, H - BOTTOM, W, BOTTOM, C.night);
    const refunds = !this.options.refundBlocked?.();
    const hints = narrow
      ? this.padCursor
        ? ['tree.pad.take', 'tree.pad.close']
        : ['tree.hint.tap']
      : this.padCursor
        ? ['tree.pad.move', 'tree.pad.take', ...(refunds ? ['tree.pad.refund'] : []), 'tree.pad.stats', 'tree.pad.zoom', 'tree.pad.close']
        : ['tree.hint.pan', 'tree.hint.zoom', 'tree.hint.take', ...(refunds ? ['tree.hint.refund'] : []), 'tree.hint.stats', 'tree.hint.find'];
    const priority = ['tree.hint.take', 'tree.pad.take', 'tree.pad.close', 'tree.hint.tap', 'tree.hint.refund', 'tree.pad.refund', 'tree.hint.stats', 'tree.pad.stats', 'tree.hint.find', 'tree.pad.move', 'tree.hint.pan', 'tree.hint.zoom', 'tree.pad.zoom'];
    const gap = 12;
    const keep = new Set<string>();
    let used = -gap;
    for (const id of [...hints].sort((a, c) => priority.indexOf(a) - priority.indexOf(c))) {
      const w = textWidth(t(id)) + gap;
      if (used + w <= W - 4) {
        keep.add(id);
        used += w;
      }
    }
    let hx = Math.max(2, Math.round((W - used) / 2));
    for (const id of hints) if (keep.has(id)) hx += b.text(t(id), hx, H - BOTTOM + 2, C.slate) + gap;
  }

  private drawStats(): void {
    const b = this.buf;
    const W = b.width;
    const H = b.height;
    const w = 180;
    const x = W - w;
    const y = TOP + 1;
    const h = H - TOP - BOTTOM - 1;
    b.panel(x, y, w, h, C.ink);
    b.rect(x, y, 1, h, C.slate);
    const lines: Line[] = [{ text: t('tree.summary.allocated', { count: this.stateRef.spent }), color: C.sand }];
    for (const g of summarizeMods(this.stateRef.mods())) {
      lines.push({ text: '', color: C.ink });
      for (const part of wrapText(g.title, w - 10)) lines.push({ text: part, color: C.sand });
      for (const l of g.lines) for (const part of wrapText(l, w - 10)) lines.push({ text: part, color: C.white });
    }
    if (lines.length === 1) lines.push({ text: '', color: C.ink }, { text: t('tree.summary.nothing'), color: C.slate });
    const rows = Math.floor((h - 6) / 9);
    this.statsScroll = Math.min(this.statsScroll, Math.max(0, lines.length - rows));
    lines.slice(this.statsScroll, this.statsScroll + rows).forEach((l, i) => b.text(l.text, x + 5, y + 4 + i * 9, l.color));
  }

  private drawTooltip(n: TreeNode, path: Set<string>): void {
    const b = this.buf;
    const W = b.width;
    const H = b.height;
    const s = this.stateRef;
    const region = REGIONS.has(n.region) ? REGIONS.get(n.region) : null;
    const lines: Line[] = [];
    const wide = Math.min(204, W - 14);
    const add = (text: string, color: number) => {
      for (const part of wrapText(text, wide)) lines.push({ text: part, color });
    };
    add(nodeName(n), n.kind === 'keystone' ? C.sand : n.kind === 'mastery' ? C.cyan : n.kind === 'small' ? C.mist : C.white);
    add(t('tree.tip.kind_region', { kind: kindName(n.kind), region: regionName(n.region) }), region ? pack(region.color) : C.white);
    for (const l of nodeLines(n, s.masteries.get(n.id))) add(l, C.white);
    const flavour = n.kind !== 'small' ? nodeFlavour(n) : null;
    if (flavour) add(flavour, C.slate);
    if (this.tree.roots.has(n.id)) add(t('tree.tip.gate'), C.lime);
    else if (s.allocated.has(n.id)) {
      const cost = this.options.refundCost?.(1) ?? 0;
      if (n.options?.length) add(t('tree.tip.next_choice'), C.cyan);
      const blocked = this.options.refundBlocked?.() ?? null;
      if (blocked) add(blocked, C.slate);
      else if (s.canDeallocate(n.id)) add(cost ? t('tree.tip.refund_cost', { cost }) : t('tree.tip.refund'), C.orange);
      else add(t('tree.tip.depends'), C.slate);
    } else if (!this.preview?.path) add(t('tree.tip.unreachable'), C.red);
    else {
      const cost = path.size;
      if (cost <= s.unspent) add(t('tree.tip.take', { count: cost, left: s.unspent }), C.cyan);
      else add(t('tree.tip.needs', { count: cost, left: Math.max(0, s.unspent) }), C.red);
    }
    const w = Math.max(...lines.map((l) => textWidth(l.text))) + 10;
    const h = lines.length * 9 + 6;
    const [nx, ny] = toScreen(this.cam, W, H, n.x, n.y);
    let x = nx + 12;
    if (x + w > W - 2) x = nx - 12 - w;
    x = Math.max(2, Math.min(W - w - 2, x));
    const y = Math.max(TOP + 2, Math.min(H - BOTTOM - h - 2, ny - 10));
    b.panel(x, y, w, h, C.ink);
    b.frame(x, y, w, h, region ? pack(region.color) : C.white);
    lines.forEach((l, i) => b.text(l.text, x + 5, y + 4 + i * 9, l.color));
  }

  /**
   * The frame onto the canvas: the bitmap at art size; when the frame holds device-font text
   * (a language the pixel font can't draw), the bitmap scaled `k` device pixels per art pixel
   * (`surfaceScale`, no smoothing) and the text drawn over it at that resolution, in paint order:
   * a panel painted after a text is laid over it again, so a tooltip covers the labels under it.
   */
  private blit(): void {
    const g = this.g;
    if (!g) return;
    const b = this.buf;
    if (!this.image || this.image.width !== b.width || this.image.height !== b.height) this.image = new ImageData(b.bytes, b.width, b.height);
    const k = b.deviceText ? surfaceScale(this.framing?.scale ?? 1, true) : 1;
    const c = this.canvas;
    if (c.width !== b.width * k || c.height !== b.height * k) {
      c.width = b.width * k;
      c.height = b.height * k;
    }
    if (!b.deviceText) {
      g.putImageData(this.image, 0, 0);
      return;
    }
    const art = (this.artCanvas ??= document.createElement('canvas'));
    if (art.width !== b.width || art.height !== b.height) {
      art.width = b.width;
      art.height = b.height;
    }
    art.getContext('2d')?.putImageData(this.image, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(art, 0, 0, b.width * k, b.height * k);
    for (const o of b.overlay) {
      if (o.kind === 'text') {
        drawDeviceText(g, o.text, o.x, o.y, k, o.scale, css(o.color));
        continue;
      }
      const x0 = Math.max(0, o.x);
      const y0 = Math.max(0, o.y);
      const x1 = Math.min(b.width, o.x + o.w);
      const y1 = Math.min(b.height, o.y + o.h);
      if (x1 > x0 && y1 > y0) g.drawImage(art, x0, y0, x1 - x0, y1 - y0, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    }
  }
}

function radius(kind: TreeNode['kind'], tier: number): number {
  switch (kind) {
    case 'small':
      return [0, 1, 2][tier]!;
    case 'notable':
      return [1, 3, 4][tier]!;
    case 'keystone':
      return [3, 4, 6][tier]!;
    case 'mastery':
      return [1, 3, 4][tier]!;
    case 'start':
      return [2, 4, 5][tier]!;
    default:
      return 1;
  }
}
