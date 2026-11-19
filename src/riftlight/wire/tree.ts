/**
 * The real TreePort: R2's passive tree (`src/riftlight/tree`) and its view (`ui/tree`)
 * behind the game shell's port. `new Riftlight()` uses it by default.
 *
 * - `mods(allocated)` is `treeMods`: the hero's `tree` Mod source.
 * - `points(level, deepest)` is `pointBudget(level, deepest).total`: one point per level
 *   after the first, one per designed level cleared, one per five rift depths.
 * - `view(host, { respec })` is the full-screen `TreeView` as an overlay Panel. P (or the
 *   pause menu) allocates; only the mystic (Oru, `respec: true`) refunds, for
 *   `respecCost(1, level)` gold a point. Every change writes `save.hero.allocated` and
 *   tells the shell (`changed('tree')`, which re-applies the Mod source).
 *
 * Input: while open the TreeView owns the keyboard (it captures keys, so Escape / P close
 * it and never reach the pause menu), the mouse and touch. The pad is player 1's from the
 * engine's input (`ctx.input`: the pad in use through its remaps, never a couch guest's;
 * recorded), handed to the view each frame (`draw`): its sticks, triggers, d-pad and ✕ □ △. Opened
 * with the pad in use, the pad's cursor starts on the node hovered last as a tree closed (the
 * port keeps it), else on the start the allocation grows from (`TreeCursor.padStart`). The
 * shell's `back` (pad B, the agent API) closes it through the panel stack. Q / E are the
 * shell's (`pages`: the game hears them and pages round the character screens, as L1 / R1 do,
 * which the view never reads); its bottom bar names them. What the
 * player does to the tree (allocate, refund, close) is sent through `ctx.input.send` and done
 * when it arrives (`draw`), so a recording of the game keeps it and a replay does the same.
 * Without a page (`Engine.headless`) the panel opens with no view: the pad moves a cursor of its
 * own (`TreeCursor`) and the same actions (`ui/tree/actions.ts`) apply to its state, so a replay in
 * Node does the same to the tree too.
 */
import type { Mod } from '../core/mods';
import { t } from '../lang';
import { defaultTree, type PassiveTree, pointBudget, respecCost, TreeState, treeMods } from '../tree/tree';
import { KEYS, pagePad, touchpadSwipes } from '../game/controls';
import type { Panel, PanelHost, TreePort } from '../game/ports';
import type { UiCanvas, UiEvent } from '../ui/kit';
import { activateNode, refundNode, registerTreeSounds, type TreeAction, type TreeRules } from '../ui/tree/actions';
import { TreeCursor, type TreePadInput } from '../ui/tree/cursor';
import { type TreeHint, type TreeHintMode, type TreePages, treeHints, TreeView } from '../ui/tree/TreeView';

/** The point budget of a save right now. */
export function treePoints(host: PanelHost): number {
  return pointBudget(host.level(), host.save().deepest).total;
}

/** The passive tree as a shell Panel (an overlay: the TreeView paints its own canvas). */
export class TreePanel implements Panel {
  readonly id = 'tree';
  readonly title: string;
  readonly overlay = true;
  readonly size = { w: 480, h: 270 };
  /** Oru's respec is a tree view of its own, not a character screen: L1 / R1 don't page away from it (`Panel.ring`). */
  readonly ring?: false;
  view: TreeView | null = null;
  state: TreeState | null = null;
  /** Without a page: the cursor the pad moves (the view has its own). */
  private nav: TreeCursor | null = null;
  private tree: PassiveTree | null = null;
  private rules: TreeRules | null = null;
  private closing = false;
  /** The time of the last frame drawn (-1: none since it opened). */
  private last = -1;
  /**
   * The character screens either side of the tree (none from Oru's respec): Q / E, and the pad's L1
   * / R1 with a DualSense's swipes while they page (`touchpadSwipes`: 52in1's setting, a guest's
   * DualSense), read each time the bar is drawn.
   */
  readonly pages: TreePages | undefined;

  constructor(
    readonly host: PanelHost,
    readonly respec: boolean,
    /** The node hovered last as a tree closed (the port's, kept from one opening to the next): the pad's cursor starts there (`open`). */
    private readonly memory: { hover: string | null } = { hover: null },
  ) {
    this.title = respec ? 'Passive tree · respec' : 'Passive tree';
    if (respec) this.ring = false;
    const engine = host.services.ctx.engine;
    this.pages = respec
      ? undefined
      : {
          keys: [...KEYS.pagePrev, ...KEYS.pageNext].filter((c) => !c.startsWith('Pad')),
          get pad() {
            return pagePad(touchpadSwipes(engine));
          },
        };
  }

  open(): void {
    const host = this.host;
    const save = host.save();
    const ctx = host.services.ctx;
    const tree = defaultTree();
    const state = (this.state = TreeState.load(tree, save.hero.allocated, treePoints(host)));
    // a save over budget (a lower level after an import, a changed tree) loses its furthest nodes here
    const serial = state.serialize();
    if (serial.join() !== save.hero.allocated.join()) {
      save.hero.allocated = serial;
      host.changed('tree');
    }
    const rules: TreeRules = {
      audio: ctx.audio,
      refundCost: this.respec ? (n) => respecCost(n, host.level()) : undefined,
      spendGold: this.respec ? (g) => host.addGold(-g) : undefined,
      refundBlocked: this.respec ? undefined : () => t('tree.deny.refund_oru'),
      onChange: (_change, s) => {
        host.save().hero.allocated = s.serialize();
        host.changed('tree');
        host.changed('gold');
      },
    };
    this.rules = rules;
    this.tree = tree;
    this.last = -1;
    registerTreeSounds(ctx.audio);
    // the view is the page's (a canvas over the game); headless the actions apply without one
    const container = ctx.engine.renderer.container;
    // opened with the pad in use (Pause → Passive tree, L1 / R1 from another screen, R2 at Oru):
    // its cursor on the node hovered last, else the start, so the cross and the tooltip show at
    // once and Cross takes that node (the device is the engine's: recorded, so a replay agrees)
    const pad = ctx.engine.controls.device === 'pad';
    if (!container) {
      const res = ctx.engine.renderer.resolution;
      this.nav = new TreeCursor(tree, res.width, res.height);
      if (pad) this.nav.padStart(this.memory.hover, state.allocated);
      return;
    }
    this.view = new TreeView({
      ...rules,
      container,
      tree,
      state,
      resolution: ctx.engine.renderer.baseResolution,
      aspect: ctx.engine.renderer.aspect,
      touchDensity: ctx.engine.renderer.touchDensity, // a phone's art density, as the game's
      device: () => ctx.engine.controls.device, // its hints name the device in use
      hidePointer: () => !ctx.engine.input.playing, // the OS pointer hides on the pad as over the canvas, never in a replay
      closeKeys: ['Escape', 'KeyP'],
      padCloses: false, // pad B arrives as the shell's `back`
      padGlyphs: () => ctx.engine.controls.style,
      // the character screens' ring: Q / E (and L1 / R1 or a swipe on a DualSense's touchpad, the
      // shell's own read) page from the tree too; Oru's respec is no screen of the ring (Q / E zoom there)
      pages: this.pages,
      gold: () => host.gold(),
      // what Oru said as he opened the respec: under the view's top bar (the shell's line would be under its canvas)
      talk: () => host.talk?.() ?? null,
      onClose: () => {
        if (!this.closing) host.close();
      },
      defer: (action) => this.send(action),
    });
    this.view.open();
    if (pad) this.view.padStart(this.memory.hover);
  }

  /** What the pad did to the tree is sent, as the view sends what the mouse did: done when it arrives (`draw`), recorded. */
  private send(action: TreeAction): void {
    this.host.services.ctx.input.send({ rl: 'tree', action });
  }

  /** The bottom bar's hints on a device, as the view draws them now (`treeHints`): tools and tests. */
  hints(mode: TreeHintMode): TreeHint[] {
    return treeHints({ mode, refunds: !this.rules?.refundBlocked?.(), style: this.host.services.ctx.engine.controls.style, pages: this.pages });
  }

  /**
   * Tooling and tests: the node under the cursor and where it is (the view's, or without a page the
   * pad's own), and the townsperson's line the view shows (without a page: the one it would show).
   */
  debug(): { hover: string | null; cursor: { x: number; y: number }; talk: string | null } {
    const v = this.view?.debug();
    if (v) return { hover: v.hover, cursor: v.cursor, talk: v.talk?.text ?? null };
    return { hover: this.nav?.hover ?? null, cursor: { ...(this.nav?.cursor ?? { x: 0, y: 0 }) }, talk: this.host.talk?.() ?? null };
  }

  close(): void {
    this.closing = true;
    this.memory.hover = this.view?.hovered ?? this.nav?.hover ?? this.memory.hover;
    this.view?.dispose();
    this.view = null;
    this.nav = null;
  }

  /** Do what the player did to the tree: through the view (its pulses and messages), or straight on the state. */
  perform(action: TreeAction): void {
    if (this.view) return this.view.perform(action);
    const state = this.state;
    if (!state || !this.tree || !this.rules) return;
    if (action.kind === 'activate') activateNode(this.tree, state, action.id, this.rules);
    else if (action.kind === 'refund') refundNode(this.tree, state, action.id, this.rules);
    else if (!this.closing) this.host.close();
  }

  /**
   * Each frame: what the player did to the tree (live or replayed), the pad (player 1's, from the
   * engine's input: not on the frame it opened, whose press opened it), and points that follow the
   * hero's level and deepest depth.
   */
  draw(_ui?: UiCanvas, _rect?: { x: number; y: number; w: number; h: number }, time = 0): void {
    const input = this.host.services.ctx.input;
    for (const c of input.commands) {
      const m = c as { rl?: string; action?: TreeAction } | null;
      if (m?.rl === 'tree' && m.action) this.perform(m.action);
    }
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    const first = this.last < 0;
    this.last = time;
    if (!first && !this.closing) this.pad(input, dt);
    const state = this.state;
    if (!state) return;
    const points = treePoints(this.host);
    if (state.points !== points) {
      state.points = points;
      this.view?.refresh();
    }
  }

  /** The pad this frame: the view's cursor, or without a page the panel's own; ✕ □ act as a click would (sent). */
  private pad(input: TreePadInput, dt: number): void {
    if (this.view) return this.view.pad(input, dt);
    const ask = this.nav?.pad(input, dt);
    if (ask?.take) this.send({ kind: 'activate', id: ask.take });
    if (ask?.refund) this.send({ kind: 'refund', id: ask.refund });
  }

  /** The view takes its own keys and pointer, the pad its own (`draw`); only `back` (pad B, the agent API) is the shell's. */
  input(e: UiEvent): boolean {
    return e.kind !== 'back';
  }

  covers(): boolean {
    return true;
  }
}

export function realTreePort(): TreePort {
  /** The node hovered last as a tree closed (`TreePanel.memory`). */
  const memory = { hover: null as string | null };
  return {
    mods(allocated: readonly string[]): readonly Mod[] {
      return treeMods(allocated);
    },
    points(level: number, deepest = 0): number {
      return pointBudget(level, deepest).total;
    },
    view(host: PanelHost, options: { respec: boolean }): Panel {
      return new TreePanel(host, options.respec, memory);
    },
  };
}
