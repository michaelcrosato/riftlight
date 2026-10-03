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
 * it and never reach the pause menu), the mouse, touch and the pad's sticks and A / X / Y;
 * the shell's `back` (pad B, the agent API) closes it through the panel stack.
 */
import type { Mod } from '../core/mods';
import { defaultTree, pointBudget, respecCost, TreeState, treeMods } from '../tree/tree';
import type { Panel, PanelHost, TreePort } from '../game/ports';
import type { UiEvent } from '../ui/kit';
import { TreeView } from '../ui/tree/TreeView';

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
  view: TreeView | null = null;
  state: TreeState | null = null;
  private closing = false;

  constructor(
    readonly host: PanelHost,
    readonly respec: boolean,
  ) {
    this.title = respec ? 'Passive tree · respec' : 'Passive tree';
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
    this.view = new TreeView({
      container: ctx.engine.renderer.container,
      tree,
      state,
      audio: ctx.audio,
      resolution: ctx.engine.renderer.baseResolution,
      aspect: ctx.engine.renderer.aspect,
      closeKeys: ['Escape', 'KeyP'],
      padCloses: false, // pad B arrives as the shell's `back`
      refundCost: this.respec ? (n) => respecCost(n, host.level()) : undefined,
      spendGold: this.respec ? (g) => host.addGold(-g) : undefined,
      refundBlocked: this.respec ? undefined : () => 'ONLY ORU THE MYSTIC CAN REFUND',
      gold: () => host.gold(),
      onChange: (_change, s) => {
        host.save().hero.allocated = s.serialize();
        host.changed('tree');
        host.changed('gold');
      },
      onClose: () => {
        if (!this.closing) host.close();
      },
    });
    this.view.open();
  }

  close(): void {
    this.closing = true;
    this.view?.dispose();
    this.view = null;
  }

  /** Each frame: points follow the hero's level and deepest depth (level-ups while open). */
  draw(): void {
    const state = this.state;
    if (!state) return;
    const points = treePoints(this.host);
    if (state.points !== points) {
      state.points = points;
      this.view?.refresh();
    }
  }

  /** The view takes its own keys, pointer and pad; only `back` (pad B, the agent API) is the shell's. */
  input(e: UiEvent): boolean {
    return e.kind !== 'back';
  }

  covers(): boolean {
    return true;
  }
}

export function realTreePort(): TreePort {
  return {
    mods(allocated: readonly string[]): readonly Mod[] {
      return treeMods(allocated);
    },
    points(level: number, deepest = 0): number {
      return pointBudget(level, deepest).total;
    },
    view(host: PanelHost, options: { respec: boolean }): Panel {
      return new TreePanel(host, options.respec);
    },
  };
}
