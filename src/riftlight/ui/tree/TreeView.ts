/**
 * The passive tree view: a full-screen pixel-art overlay. A 2D canvas at art resolution
 * (480×270, adaptive width like the engine), integer-scaled and letterboxed with the
 * engine's framing math, so it is exactly as crisp as the HUD.
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
 * first standard gamepad itself; the shell should pause the game while it is open.
 */
import type { SoundDef } from '../../../engine/audio/synth';
import { computeFraming, RESOLUTIONS, type Framing, type Resolution } from '../../../engine/framing';
import { PALETTE, type PaletteColor } from '../../../engine/palette';
import { REGIONS } from '../../tree/data/regions';
import { defaultTree, nodeLines, PassiveTree, searchTree, summarizeMods, TreeState, type TreeChange } from '../../tree/tree';
import type { TreeNode } from '../../tree/types';
import { clampCam, PointIndex, stepToward, toScreen, toTree, zoomAt, ZOOM_LIMITS, type TreeCam } from './camera';
import { pack, PixelBuffer, textWidth, wrap } from './pixels';

/** What the view needs from an AudioManager (ctx.audio). */
export interface TreeAudio {
  play(sound: string, options?: { pitch?: number; volume?: number }): unknown;
  register?(name: string, def: SoundDef): void;
}

export interface TreeViewOptions {
  /** Element the overlay fills (the engine's container, or a page's #app). */
  container: HTMLElement;
  /** Default: the game's tree. */
  tree?: PassiveTree;
  /** Default: an empty allocation with unlimited points. */
  state?: TreeState;
  audio?: TreeAudio | null;
  /** Art resolution height (and 16:9 fallback). Default 480×270. */
  resolution?: Resolution;
  /** Key codes that close the view. Default ['Escape']; [] = can't be closed by key. */
  closeKeys?: readonly string[];
  /** Gamepad B closes the view (default true when closeKeys isn't empty). */
  padCloses?: boolean;
  /** Called after every allocation, refund or mastery choice. */
  onChange?: (change: TreeChange, state: TreeState) => void;
  onClose?: () => void;
  /** Gold to refund `points` points (respecCost); 0 or absent = free. */
  refundCost?: (points: number) => number;
  /** Take gold for a refund; return false to refuse it (not enough gold). */
  spendGold?: (amount: number) => boolean;
  /** Current gold, shown in the top bar. */
  gold?: () => number;
  /** Why refunds are refused here (e.g. only the mystic refunds): a message, or null to allow them. */
  refundBlocked?: () => string | null;
}

const SOUNDS: Record<string, SoundDef> = {
  treeAllocate: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 4, 7], arpRate: 0.045, attack: 0.002, sustain: 0.06, decay: 0.16, volume: 0.18 },
  treeNotable: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 4, 7, 12], arpRate: 0.05, attack: 0.002, sustain: 0.12, decay: 0.25, volume: 0.2 },
  treeKeystone: {
    wave: 'square',
    duty: 0.5,
    freq: 261.63,
    arp: [0, 7, 12, 19, 24],
    arpRate: 0.06,
    attack: 0.002,
    sustain: 0.25,
    decay: 0.4,
    volume: 0.2,
    layers: [{ wave: 'triangle', freq: 130.81, attack: 0.002, sustain: 0.2, decay: 0.4, volume: 0.35 }],
  },
  treeRefund: { wave: 'triangle', freq: 660, freqEnd: 220, attack: 0.002, decay: 0.18, volume: 0.3 },
  treeDeny: { wave: 'square', duty: 0.5, freq: 110, attack: 0.002, sustain: 0.05, decay: 0.08, volume: 0.14 },
  treeTick: { wave: 'square', duty: 0.125, freq: 1760, attack: 0.001, decay: 0.02, volume: 0.05 },
};

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
    for (const [name, def] of Object.entries(SOUNDS)) options.audio?.register?.(name, def);

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
    search.setAttribute('aria-label', 'Search the passive tree');
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
    this.last = performance.now();
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
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    this.padCursor = false;
    this.cursor = { x, y };
    if (this.inSearchBox(x, y)) {
      this.search.focus();
      return;
    }
    if (document.activeElement === this.search) this.search.blur();
    if (this.pointers.size === 1) {
      this.drag = { x, y, cam: { ...this.cam }, moved: false, button: e.button, type: e.pointerType, down: performance.now() };
      this.updateHover();
      if (e.pointerType === 'touch') {
        clearTimeout(this.longPress);
        this.longPress = window.setTimeout(() => {
          if (this.drag && !this.drag.moved && this.hover) {
            this.drag.moved = true;
            this.refundNode(this.hover);
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
      this.refundNode(id);
    } else if (d.type === 'touch') {
      // First tap shows the tooltip; a second tap on the same node allocates.
      if (this.tapped?.id === id && performance.now() - this.tapped.at < 4000) {
        this.activate(id);
        this.tapped = null;
      } else this.tapped = { id, at: performance.now() };
    } else if (d.button === 0) this.activate(id);
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
      this.close();
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
        if (this.hover) this.activate(this.hover);
        break;
      case 'Backspace':
      case 'Delete':
      case 'KeyX':
        e.preventDefault();
        if (this.hover) this.refundNode(this.hover);
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
    if (edge(0) && this.hover) this.activate(this.hover);
    if (edge(2) && this.hover) this.refundNode(this.hover);
    if (edge(3)) this.showStats = !this.showStats;
    if (edge(1) && (this.options.padCloses ?? (this.options.closeKeys ?? ['Escape']).length > 0)) this.close();
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

  private searchBox() {
    const w = Math.min(130, Math.max(70, this.buf.width - 260));
    return { x: Math.round((this.buf.width - w) / 2), y: 1, w, h: TOP - 2 };
  }

  // ---------------------------------------------------------------- actions

  private activate(id: string): string[] {
    const s = this.stateRef;
    const node = this.tree.get(id);
    if (!node) return [];
    if (s.isAllocated(id)) {
      // An allocated mastery: cycle its option.
      const opts = node.options;
      if (opts?.length && s.allocated.has(id)) {
        const cur = opts.findIndex((o) => o.id === s.masteries.get(id));
        const next = opts[(cur + 1) % opts.length]!;
        s.choose(id, next.id);
        this.pulse([id], C.cyan);
        this.options.audio?.play('treeAllocate', { pitch: 5 });
        this.options.onChange?.({ kind: 'mastery', ids: [id] }, s);
      }
      return [];
    }
    const path = s.pathTo(id);
    if (!path) return this.deny('UNREACHABLE'), [];
    if (path.length > s.unspent) return this.deny(s.unspent <= 0 ? 'NO PASSIVE POINTS LEFT' : `NEED ${path.length} POINTS, HAVE ${s.unspent}`), [];
    const got = s.allocatePath(id);
    if (!got.length) return this.deny('CAN NOT ALLOCATE'), [];
    this.pulse(got, C.sand);
    const kind = node.kind;
    this.options.audio?.play(kind === 'keystone' ? 'treeKeystone' : kind === 'notable' ? 'treeNotable' : 'treeAllocate');
    this.say(`+${got.length} ${node.name.toUpperCase()}`, C.sand);
    this.preview = null;
    this.options.onChange?.({ kind: 'allocate', ids: got }, s);
    return got;
  }

  private refundNode(id: string): boolean {
    const s = this.stateRef;
    if (!s.allocated.has(id)) {
      if (this.tree.roots.has(id)) this.deny('THE GATES ARE FREE');
      return false;
    }
    const blocked = this.options.refundBlocked?.() ?? null;
    if (blocked) return this.deny(blocked), false;
    if (!s.canDeallocate(id)) return this.deny('OTHER NODES DEPEND ON IT'), false;
    const cost = this.options.refundCost?.(1) ?? 0;
    if (cost > 0 && this.options.spendGold && !this.options.spendGold(cost)) return this.deny(`REFUND COSTS ${cost} GOLD`), false;
    s.deallocate(id);
    this.pulse([id], C.red);
    this.options.audio?.play('treeRefund');
    this.say(cost > 0 ? `REFUNDED FOR ${cost} GOLD` : 'REFUNDED', C.orange);
    this.preview = null;
    this.options.onChange?.({ kind: 'deallocate', ids: [id] }, s);
    return true;
  }

  private deny(text: string): void {
    this.options.audio?.play('treeDeny');
    this.say(text, C.red);
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
    const f = (this.framing = computeFraming(w, h, window.devicePixelRatio || 1, res, 'adaptive'));
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
        const name = r.name.toUpperCase();
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
        const name = n.name.toUpperCase();
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
      const t = this.message.text;
      const tw = textWidth(t);
      const mx = Math.round((W - tw) / 2);
      const my = H - BOTTOM - 16;
      b.rect(mx - 4, my - 3, tw + 8, 13, C.ink);
      b.frame(mx - 4, my - 3, tw + 8, 13, this.message.color);
      b.text(t, mx, my, this.message.color);
    }
    this.blit();
  }

  private drawChrome(owned: Set<string>): void {
    const b = this.buf;
    const W = b.width;
    const H = b.height;
    b.rect(0, 0, W, TOP, C.night);
    b.rect(0, TOP, W, 1, C.ink);
    b.text('PASSIVE TREE', 4, 3, C.sand);
    const s = this.stateRef;
    const pts = Number.isFinite(s.points) ? `POINTS ${s.unspent}/${s.points}` : `SPENT ${owned.size - this.tree.roots.size}`;
    const gold = this.options.gold ? `  GOLD ${this.options.gold()}` : '';
    const right = `${pts}${gold}`;
    b.text(right, W - 4 - textWidth(right), 3, s.unspent > 0 ? C.lime : C.mist);
    const box = this.searchBox();
    const focused = document.activeElement === this.search;
    b.rect(box.x, box.y, box.w, box.h, C.ink);
    b.frame(box.x, box.y, box.w, box.h, focused ? C.white : C.slate);
    const maxChars = Math.floor((box.w - 6) / 6);
    let label = this.query ? this.query.toUpperCase() : focused ? '' : '/ SEARCH';
    if (label.length > maxChars) label = label.slice(label.length - maxChars);
    b.text(label, box.x + 3, box.y + 2, this.query ? C.white : C.slate);
    if (focused && Math.floor(this.time * 3) % 2 === 0) b.rect(box.x + 3 + label.length * 6, box.y + 2, 1, 7, C.white);
    if (this.query) {
      const t = `${this.matchList.length}`;
      b.text(t, box.x + box.w + 4, 3, this.matchList.length ? C.lime : C.red);
    }
    // Bottom hints.
    b.rect(0, H - BOTTOM, W, BOTTOM, C.night);
    const refunds = !this.options.refundBlocked?.();
    const hint = this.padCursor ? `STICK MOVE  A TAKE  ${refunds ? 'X REFUND  ' : ''}Y STATS  LT/RT ZOOM  B CLOSE` : `DRAG PAN  WHEEL ZOOM  CLICK TAKE  ${refunds ? 'R-CLICK REFUND  ' : ''}TAB STATS  / FIND`;
    b.text(hint, Math.max(2, Math.round((W - textWidth(hint)) / 2)), H - BOTTOM + 2, C.slate);
  }

  private drawStats(): void {
    const b = this.buf;
    const W = b.width;
    const H = b.height;
    const w = 180;
    const x = W - w;
    const y = TOP + 1;
    const h = H - TOP - BOTTOM - 1;
    b.rect(x, y, w, h, C.ink);
    b.rect(x, y, 1, h, C.slate);
    const lines: Line[] = [{ text: `ALLOCATED ${this.stateRef.spent}`, color: C.sand }];
    for (const g of summarizeMods(this.stateRef.mods())) {
      lines.push({ text: '', color: C.ink }, { text: g.title.toUpperCase(), color: C.sand });
      for (const l of g.lines) for (const part of wrap(l.toUpperCase(), 28)) lines.push({ text: part, color: C.white });
    }
    if (lines.length === 1) lines.push({ text: '', color: C.ink }, { text: 'NOTHING ALLOCATED YET', color: C.slate });
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
    const chars = 34;
    const titleColor = n.kind === 'keystone' ? C.sand : n.kind === 'mastery' ? C.cyan : n.kind === 'small' ? C.mist : C.white;
    for (const t of wrap(n.name.toUpperCase(), chars)) lines.push({ text: t, color: titleColor });
    lines.push({ text: `${n.kind.toUpperCase()}  ${region ? region.name.toUpperCase() : 'HEART'}`, color: region ? pack(region.color) : C.white });
    for (const l of nodeLines(n, s.masteries.get(n.id))) for (const t of wrap(l.toUpperCase(), chars)) lines.push({ text: t, color: C.white });
    if (n.flavour && n.kind !== 'small') for (const t of wrap(n.flavour.toUpperCase(), chars)) lines.push({ text: t, color: C.slate });
    let status: Line;
    if (this.tree.roots.has(n.id)) status = { text: 'A GATE: ALWAYS YOURS', color: C.lime };
    else if (s.allocated.has(n.id)) {
      const cost = this.options.refundCost?.(1) ?? 0;
      const mastery = n.options?.length ? 'CLICK: NEXT CHOICE. ' : '';
      const blocked = this.options.refundBlocked?.() ?? null;
      status = blocked
        ? { text: `${mastery}${blocked}`, color: C.slate }
        : s.canDeallocate(n.id)
          ? { text: `${mastery}R-CLICK: REFUND${cost ? ` (${cost} GOLD)` : ''}`, color: C.orange }
          : { text: `${mastery}OTHERS DEPEND ON IT`, color: C.slate };
    } else if (!this.preview?.path) status = { text: 'UNREACHABLE', color: C.red };
    else {
      const cost = path.size;
      status = cost <= s.unspent ? { text: `CLICK: TAKE ${cost} POINT${cost === 1 ? '' : 'S'} (${s.unspent} LEFT)`, color: C.cyan } : { text: `NEEDS ${cost} POINTS, ${Math.max(0, s.unspent)} LEFT`, color: C.red };
    }
    for (const t of wrap(status.text, chars)) lines.push({ text: t, color: status.color });
    const w = Math.max(...lines.map((l) => textWidth(l.text))) + 10;
    const h = lines.length * 9 + 6;
    const [nx, ny] = toScreen(this.cam, W, H, n.x, n.y);
    let x = nx + 12;
    if (x + w > W - 2) x = nx - 12 - w;
    x = Math.max(2, Math.min(W - w - 2, x));
    const y = Math.max(TOP + 2, Math.min(H - BOTTOM - h - 2, ny - 10));
    b.rect(x, y, w, h, C.ink);
    b.frame(x, y, w, h, region ? pack(region.color) : C.white);
    lines.forEach((l, i) => b.text(l.text, x + 5, y + 4 + i * 9, l.color));
  }

  private blit(): void {
    if (!this.g) return;
    const b = this.buf;
    if (!this.image || this.image.width !== b.width || this.image.height !== b.height) this.image = new ImageData(b.bytes, b.width, b.height);
    this.g.putImageData(this.image, 0, 0);
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
