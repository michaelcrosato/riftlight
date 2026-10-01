/**
 * STUB TreePort (replaced by tree's treeMods + TreeView at integration): a ring of twelve
 * passive nodes around a start node. A node can be allocated when it touches the start or
 * an allocated node; the mystic's respec refunds leaf nodes for gold.
 */
import { describeMod, flat, inc, type Mod } from '../../core/mods';
import { inside, type Rect, type UiCanvas, type UiEvent, wrap } from '../../ui/kit';
import type { Panel, PanelHost, TreePort } from '../ports';

interface Node {
  id: string;
  name: string;
  mods: Mod[];
  links: string[];
  notable?: boolean;
  /** Ring angle in turns. */
  a: number;
  ring: number;
}

const RING: Omit<Node, 'links' | 'a' | 'ring'>[] = [
  { id: 'n1', name: 'Vigour', mods: [flat('life', 10)] },
  { id: 'n2', name: 'Edge', mods: [inc('damage', 0.08)] },
  { id: 'n3', name: 'Stride', mods: [inc('move.speed', 0.04)] },
  { id: 'n4', name: 'Focus', mods: [flat('mana', 12)] },
  { id: 'n5', name: 'Tempo', mods: [inc('attack.speed', 0.05)] },
  { id: 'n6', name: 'Precision', mods: [flat('crit.chance', 2)] },
];
const OUTER: Omit<Node, 'links' | 'a' | 'ring'>[] = [
  { id: 'o1', name: 'Giant’s Blood', mods: [flat('life', 30), inc('life', 0.1)], notable: true },
  { id: 'o2', name: 'Butcher', mods: [inc('damage', 0.2)], notable: true },
  { id: 'o3', name: 'Windrunner', mods: [inc('move.speed', 0.1)], notable: true },
  { id: 'o4', name: 'Wellspring', mods: [flat('mana.regen', 3), flat('mana', 20)], notable: true },
  { id: 'o5', name: 'Frenzy', mods: [inc('attack.speed', 0.12)], notable: true },
  { id: 'o6', name: 'Assassin', mods: [flat('crit.chance', 5)], notable: true },
];

const NODES: Node[] = [
  { id: 'start', name: 'Wanderer', mods: [], links: RING.map((n) => n.id), a: 0, ring: 0 },
  ...RING.map((n, i) => ({ ...n, a: i / 6, ring: 1, links: ['start', RING[(i + 1) % 6]!.id, RING[(i + 5) % 6]!.id, OUTER[i]!.id] })),
  ...OUTER.map((n, i) => ({ ...n, a: i / 6, ring: 2, links: [RING[i]!.id] })),
];
const byId = new Map(NODES.map((n) => [n.id, n]));

export const stubTree: TreePort = {
  mods(allocated: readonly string[]): readonly Mod[] {
    return allocated.flatMap((id) => byId.get(id)?.mods ?? []);
  },
  points(level: number): number {
    return Math.max(0, level - 1);
  },
  view(host: PanelHost, options: { respec: boolean }): Panel {
    return new TreeView(host, options.respec);
  },
};

const RESPEC_COST = 25;

class TreeView implements Panel {
  readonly id = 'tree';
  readonly title: string;
  readonly size = { w: 300, h: 180 };
  private focus = 'start';
  private rects = new Map<string, Rect>();

  constructor(
    private readonly host: PanelHost,
    private readonly respec: boolean,
  ) {
    this.title = respec ? 'Passive tree · respec' : 'Passive tree';
  }

  private get allocated(): string[] {
    return this.host.save().hero.allocated;
  }

  private canAllocate(id: string): boolean {
    const set = new Set(['start', ...this.allocated]);
    if (set.has(id)) return false;
    return byId.get(id)!.links.some((l) => set.has(l));
  }

  /** A leaf: removing it keeps every other allocated node connected to the start. */
  private canRefund(id: string): boolean {
    if (!this.allocated.includes(id)) return false;
    const rest = new Set(this.allocated.filter((a) => a !== id));
    const seen = new Set(['start']);
    const queue = ['start'];
    while (queue.length)
      for (const l of byId.get(queue.shift()!)!.links) {
        if (!rest.has(l) || seen.has(l)) continue;
        seen.add(l);
        queue.push(l);
      }
    return [...rest].every((r) => seen.has(r));
  }

  private points(): number {
    return stubTree.points(this.host.level()) - this.allocated.length;
  }

  private act(id: string): void {
    if (this.canAllocate(id) && this.points() > 0) {
      this.allocated.push(id);
      this.host.sound('click');
      this.host.changed('tree');
    } else if (this.respec && this.canRefund(id)) {
      if (!this.host.addGold(-RESPEC_COST)) return this.host.sound('error');
      this.allocated.splice(this.allocated.indexOf(id), 1);
      this.host.sound('sell');
      this.host.changed('tree');
    } else this.host.sound('error');
  }

  draw(ui: UiCanvas, r: Rect): void {
    const cx = r.x + 92;
    const cy = r.y + r.h / 2 - 2;
    const pos = (n: Node) => ({ x: Math.round(cx + Math.sin(n.a * Math.PI * 2) * n.ring * 36), y: Math.round(cy - Math.cos(n.a * Math.PI * 2) * n.ring * 36) });
    const set = new Set(['start', ...this.allocated]);
    // links
    for (const n of NODES)
      for (const l of n.links) {
        if (l < n.id) continue;
        const a = pos(n);
        const b = pos(byId.get(l)!);
        const on = set.has(n.id) && set.has(l);
        const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        for (let s = 0; s <= steps; s += 2) ui.rect(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps, 1, 1, on ? 'sand' : 'slate');
      }
    this.rects.clear();
    for (const n of NODES) {
      const p = pos(n);
      const s = n.ring === 0 ? 9 : n.notable ? 9 : 7;
      const rect = { x: p.x - (s >> 1), y: p.y - (s >> 1), w: s, h: s };
      this.rects.set(n.id, rect);
      const alloc = set.has(n.id);
      const avail = this.canAllocate(n.id) && this.points() > 0;
      ui.rect(rect.x - 1, rect.y - 1, s + 2, s + 2, this.focus === n.id ? 'white' : 'ink');
      ui.rect(rect.x, rect.y, s, s, alloc ? (n.notable ? 'orange' : 'sand') : avail ? 'teal' : 'night');
      if (n.notable) ui.rect(rect.x + 3, rect.y + 3, s - 6, s - 6, alloc ? 'white' : 'slate');
    }
    // info
    const n = byId.get(this.focus)!;
    const x = r.x + 186;
    let y = r.y + 6;
    ui.text(x, y, n.name.toUpperCase(), { color: n.notable ? 'orange' : 'sand' });
    y += 11;
    for (const m of n.mods)
      for (const line of wrap(describeMod(m).toUpperCase(), r.w - 190)) {
        ui.text(x, y, line, { color: 'sky' });
        y += 9;
      }
    ui.text(x, r.y + r.h - 40, `POINTS ${this.points()}`, { color: this.points() > 0 ? 'lime' : 'mist' });
    if (this.respec) ui.mini(x, r.y + r.h - 28, `REFUND A LEAF: ${RESPEC_COST} GOLD`, 'mist');
    const label = set.has(n.id) && n.id !== 'start' ? (this.respec ? 'REFUND' : 'ALLOCATED') : 'ALLOCATE';
    ui.prompt(x, r.y + r.h - 14, 'F', 'A', label);
  }

  input(e: UiEvent): boolean {
    if (e.kind === 'confirm') {
      this.act(this.focus);
      return true;
    }
    if (e.kind === 'nav') {
      // move to the linked node in that screen direction
      const here = this.rects.get(this.focus)!;
      const [dx, dy] = e.dir === 'left' ? [-1, 0] : e.dir === 'right' ? [1, 0] : e.dir === 'up' ? [0, -1] : [0, 1];
      let best: string | null = null;
      let bestScore = Infinity;
      for (const [id, r] of this.rects) {
        if (id === this.focus) continue;
        const vx = r.x - here.x;
        const vy = r.y - here.y;
        const along = vx * dx + vy * dy;
        if (along <= 0) continue;
        const score = along + Math.abs(vx * dy - vy * dx) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = id;
        }
      }
      if (best) this.focus = best;
      return true;
    }
    if (e.kind === 'pointer') {
      for (const [id, r] of this.rects)
        if (inside({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }, e.x, e.y)) {
          this.focus = id;
          if (e.type === 'down') this.act(id);
          return true;
        }
    }
    return false;
  }
}
