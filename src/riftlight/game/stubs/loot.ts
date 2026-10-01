/**
 * STUB LootPort (replaced by loot's rollDrops, world loot, InventoryView, StashView and
 * VendorView at integration). Gold from every kill, a few simple item bases with 0–4
 * affixes by rarity, an inventory with equipment slots, a stash, a vendor and a reforge
 * bench. Views are pixel panels on the shared UI kit and work with mouse, keys and pads.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor, toonMaterial } from '../../../engine';
import { describeMod, flat, inc, type Mod } from '../../core/mods';
import type { Rng } from '../../core/rng';
import { RANK, SCALING } from '../../core/scaling';
import type { Item, ItemSlot, Rarity, SaveData } from '../../core/types';
import { inside, type Rect, type UiCanvas, type UiEvent, wrap } from '../../ui/kit';
import type { Drop, KillInfo, LootPort, Panel, PanelHost, ShellServices, StageWorld, WorldLoot } from '../ports';

interface Base {
  id: string;
  name: string;
  slot: ItemSlot;
  implicit: Mod[];
  icon: readonly string[];
}

const BASES: readonly Base[] = [
  { id: 'sword', name: 'Rusty Sword', slot: 'weapon', implicit: [flat('damage', 3)], icon: ['......ww', '.....wm.', '....wm..', '.o.wm...', '..om....', '.o.o....', 'o.......'] },
  { id: 'helm', name: 'Iron Helm', slot: 'helm', implicit: [flat('armour', 15)], icon: ['..mmmm..', '.mwwwwm.', 'mwmmmmwm', 'mm.mm.mm', 'mm....mm', '.m....m.'] },
  { id: 'vest', name: 'Leather Vest', slot: 'body', implicit: [flat('life', 15)], icon: ['.oo..oo.', 'oooooooo', '.oowwoo.', '.oowwoo.', '.oooooo.', '.oooooo.'] },
  { id: 'boots', name: 'Leather Boots', slot: 'boots', implicit: [inc('move.speed', 0.05)], icon: ['.oo.....', '.oo.....', '.oo..oo.', '.ooo.oo.', '.oooooo.', '..oooooo'] },
  { id: 'ring', name: 'Ruby Ring', slot: 'ring', implicit: [flat('res.fire', 12)], icon: ['...rr...', '..rwwr..', '.ssrrss.', '.s....s.', '.s....s.', '..ssss..'] },
  { id: 'amulet', name: 'Jade Amulet', slot: 'amulet', implicit: [flat('mana', 10)], icon: ['s......s', '.s....s.', '..s..s..', '...gg...', '..gwgg..', '...gg...'] },
];

const AFFIXES: readonly { name: string; make: (rng: Rng, lvl: number) => Mod }[] = [
  { name: 'Hale', make: (r, l) => flat('life', Math.round(r.range(5, 12) + l * 1.5)) },
  { name: 'Keen', make: (r) => inc('damage', Math.round(r.range(5, 15)) / 100) },
  { name: 'Azure', make: (r, l) => flat('mana', Math.round(r.range(5, 10) + l)) },
  { name: 'Swift', make: (r) => inc('attack.speed', Math.round(r.range(4, 10)) / 100) },
  { name: 'Deadly', make: (r) => flat('crit.chance', Math.round(r.range(1, 4))) },
  { name: 'Warded', make: (r) => flat('res.fire', Math.round(r.range(5, 15))) },
  { name: 'Fleet', make: (r) => inc('move.speed', Math.round(r.range(3, 6)) / 100) },
  { name: 'Iron', make: (r, l) => flat('armour', Math.round(r.range(8, 20) + l * 2)) },
];

const RARE_A = ['Grim', 'Storm', 'Ash', 'Gloom', 'Rift', 'Ember', 'Frost', 'Dusk'];
const RARE_B = ['Bite', 'Song', 'Ward', 'Fang', 'Veil', 'Mark', 'Coil', 'Spire'];

export const RARITY_COLOR: Record<Rarity, PaletteColor> = { normal: 'white', magic: 'sky', rare: 'sand', unique: 'orange' };

let uid = 1;
function makeItem(rng: Rng, level: number, rarity: Rarity, base?: Base): Item {
  const b = base ?? rng.pick(BASES);
  const n = rarity === 'magic' ? rng.int(1, 2) : rarity === 'rare' ? rng.int(3, 4) : 0;
  const picks = rng.shuffle([...AFFIXES]).slice(0, n);
  const name = rarity === 'rare' ? `${rng.pick(RARE_A)} ${rng.pick(RARE_B)}` : rarity === 'magic' ? `${b.name} of the ${picks[0]!.name}` : b.name;
  return {
    uid: `stub-${Date.now().toString(36)}-${uid++}`,
    base: b.id,
    rarity,
    level,
    name,
    affixes: picks.map((a, i) => ({ id: `${a.name.toLowerCase()}`, tier: 1 + (i % 3), mods: [a.make(rng, level)] })),
  };
}

const baseOf = (item: Item) => BASES.find((b) => b.id === item.base) ?? BASES[0]!;
export const itemMods = (item: Item): Mod[] => [...baseOf(item).implicit, ...item.affixes.flatMap((a) => a.mods)];
export const itemPrice = (item: Item) => Math.round((8 + item.level * 3) * (item.rarity === 'rare' ? 5 : item.rarity === 'magic' ? 2.2 : 1));

const EQUIP_SLOTS: readonly ItemSlot[] = ['weapon', 'helm', 'body', 'boots', 'ring', 'amulet'];
const CAPACITY = 24;

interface Ground extends WorldLoot {
  object: Group;
  t: number;
  from: Vector3;
}

class StubLoot implements LootPort {
  inventory: Item[] = [];
  equipment: Partial<Record<string, Item>> = {};
  stash: Item[] = [];
  private items: Ground[] = [];
  private nextId = 1;
  private beam = new MeshBasicNodeMaterial({ color: PALETTE.sand, transparent: true, opacity: 0.45, depthWrite: false });
  vendorStock: Item[] = [];

  rollDrops(kill: KillInfo, rng: Rng): Drop[] {
    const r = RANK[kill.rank];
    const out: Drop[] = [{ kind: 'gold', amount: Math.max(1, Math.round(SCALING.gold(kill.depth) * r.gold * rng.range(0.6, 1.4))) }];
    const tries = kill.rank === 'boss' ? 3 : r.drops;
    for (let i = 0; i < tries; i++) {
      if (!rng.chance(kill.rank === 'boss' ? 1 : 0.14)) continue;
      const roll = rng.next() * SCALING.rarityBoost(kill.depth);
      const rarity: Rarity = roll > 0.92 ? 'rare' : roll > 0.65 ? 'magic' : 'normal';
      out.push({ kind: 'item', item: makeItem(rng, kill.level, rarity) });
    }
    return out;
  }

  spawn(drops: readonly Drop[], at: Vector3, stage: StageWorld, rng: Rng): WorldLoot[] {
    const out: WorldLoot[] = [];
    drops.forEach((drop) => {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0.4, 1.3);
      const to = new Vector3(at.x + Math.cos(a) * d, 0, at.z + Math.sin(a) * d);
      stage.collide(to, 0.2);
      const object = new Group();
      if (drop.kind === 'gold') {
        const coin = new CylinderGeometry(0.13, 0.13, 0.05, 8);
        const n = Math.min(4, 1 + Math.floor(drop.amount / 12));
        for (let i = 0; i < n; i++) {
          const m = new Mesh(coin, toonMaterial(PALETTE[i % 2 ? 'orange' : 'sand']));
          m.position.set((i % 2) * 0.12 - 0.06, 0.03 + i * 0.05, Math.floor(i / 2) * 0.1);
          m.castShadow = true;
          object.add(m);
        }
      } else {
        const c = RARITY_COLOR[drop.item.rarity];
        const m = new Mesh(new BoxGeometry(0.34, 0.12, 0.22), toonMaterial(PALETTE[c]));
        m.position.y = 0.06;
        m.rotation.y = a;
        m.castShadow = true;
        object.add(m);
        if (drop.item.rarity === 'rare' || drop.item.rarity === 'unique') {
          const beam = new Mesh(new BoxGeometry(0.08, 3, 0.08), this.beam);
          beam.position.y = 1.5;
          object.add(beam);
        }
      }
      object.position.copy(at);
      stage.root.add(object);
      const label = drop.kind === 'gold' ? `${drop.amount} GOLD` : drop.item.name.toUpperCase();
      const color: PaletteColor = drop.kind === 'gold' ? 'sand' : RARITY_COLOR[drop.item.rarity];
      const g: Ground = { id: this.nextId++, drop, position: to, label, color, filtered: false, object, t: 0, from: at.clone() };
      this.items.push(g);
      out.push(g);
    });
    return out;
  }

  private services: ShellServices | null = null;

  init(services: ShellServices): void {
    this.services = services;
  }

  ground(): readonly WorldLoot[] {
    // The loot filter hides normal items (1) and magic ones too (2); gold always shows.
    const level = this.services?.settings().lootFilter ?? 0;
    for (const g of this.items) (g as { filtered: boolean }).filtered = g.drop.kind === 'item' && ((level >= 1 && g.drop.item.rarity === 'normal') || (level >= 2 && g.drop.item.rarity === 'magic'));
    return this.items;
  }

  pickup(loot: WorldLoot): { ok: boolean; gold: number; item?: Item } {
    const i = this.items.findIndex((g) => g.id === loot.id);
    if (i < 0) return { ok: false, gold: 0 };
    const g = this.items[i]!;
    if (g.drop.kind === 'item' && this.inventory.length >= CAPACITY) return { ok: false, gold: 0 };
    this.items.splice(i, 1);
    g.object.removeFromParent();
    g.object.traverse((o) => (o as Mesh).geometry?.dispose());
    if (g.drop.kind === 'gold') return { ok: true, gold: g.drop.amount };
    this.inventory.push(g.drop.item);
    return { ok: true, gold: 0, item: g.drop.item };
  }

  update(dt: number): void {
    for (const g of this.items) {
      g.t += dt;
      const k = Math.min(1, g.t / 0.45);
      g.object.position.lerpVectors(g.from, g.position, k);
      g.object.position.y = Math.sin(k * Math.PI) * 0.9 + (k >= 1 ? Math.max(0, 0.04 * Math.sin(g.t * 3)) : 0);
      if (g.drop.kind === 'item') g.object.rotation.y += dt * (k < 1 ? 9 : 0.8);
    }
  }

  clearGround(): void {
    for (const g of this.items) {
      g.object.removeFromParent();
      g.object.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    this.items = [];
  }

  gearMods(): Readonly<Record<string, readonly Mod[]>> {
    const out: Record<string, readonly Mod[]> = {};
    for (const slot of EQUIP_SLOTS) {
      const item = this.equipment[slot];
      out[`item:${slot}`] = item ? itemMods(item) : [];
    }
    return out;
  }

  load(save: SaveData): void {
    this.inventory = [...save.hero.inventory];
    this.equipment = { ...save.hero.equipment };
    this.stash = [...save.stash];
    this.clearGround();
  }

  write(save: SaveData): void {
    save.hero.inventory = [...this.inventory];
    save.hero.equipment = { ...this.equipment };
    save.stash = [...this.stash];
  }

  give(rng: Rng, level: number, rarity: Rarity = 'rare'): Item | null {
    if (this.inventory.length >= CAPACITY) return null;
    const item = makeItem(rng, level, rarity);
    this.inventory.push(item);
    return item;
  }

  counts() {
    return { inventory: this.inventory.length, capacity: CAPACITY, stash: this.stash.length };
  }

  equip(item: Item, host: PanelHost): void {
    const slot = baseOf(item).slot;
    const i = this.inventory.indexOf(item);
    if (i < 0) return;
    this.inventory.splice(i, 1);
    const old = this.equipment[slot];
    if (old) this.inventory.push(old);
    this.equipment[slot] = item;
    host.sound('equip');
    host.changed('gear');
  }

  unequip(slot: string, host: PanelHost): void {
    const item = this.equipment[slot];
    if (!item || this.inventory.length >= CAPACITY) return host.sound('error');
    delete this.equipment[slot];
    this.inventory.push(item);
    host.sound('equip');
    host.changed('gear');
  }

  inventoryView(host: PanelHost): Panel {
    return new GridPanel('inventory', 'Inventory', host, this, [
      { title: 'Equipped', items: () => EQUIP_SLOTS.map((s) => this.equipment[s] ?? null), cols: 2, labels: EQUIP_SLOTS, act: (_, i) => this.unequip(EQUIP_SLOTS[i]!, host), hint: 'UNEQUIP' },
      { title: 'Bag', items: () => pad(this.inventory, CAPACITY), cols: 6, act: (item) => item && this.equip(item, host), hint: 'EQUIP' },
    ]);
  }

  stashView(host: PanelHost): Panel {
    const move = (from: Item[], to: Item[], item: Item | null, cap: number) => {
      if (!item) return;
      if (to.length >= cap) return host.sound('error');
      from.splice(from.indexOf(item), 1);
      to.push(item);
      host.sound('click');
      host.changed('stash');
    };
    return new GridPanel('stash', 'Stash', host, this, [
      { title: 'Stash', items: () => pad(this.stash, 36), cols: 6, act: (item) => move(this.stash, this.inventory, item, CAPACITY), hint: 'TAKE' },
      { title: 'Bag', items: () => pad(this.inventory, CAPACITY), cols: 6, act: (item) => move(this.inventory, this.stash, item, 36), hint: 'STORE' },
    ]);
  }

  vendorView(host: PanelHost): Panel {
    const rng = host.services.rng.fork(`vendor:${host.level()}:${host.save().stats?.runs ?? 0}`);
    if (!this.vendorStock.length) this.vendorStock = Array.from({ length: 8 }, (_, i) => makeItem(rng.fork(i), host.level(), i < 2 ? 'rare' : 'magic'));
    return new GridPanel('vendor', 'Ilsa’s Wares', host, this, [
      {
        title: 'For sale',
        items: () => pad(this.vendorStock, 12),
        cols: 4,
        price: (item) => itemPrice(item) * 3,
        act: (item) => {
          if (!item) return;
          if (this.inventory.length >= CAPACITY || !host.addGold(-itemPrice(item) * 3)) return host.sound('error');
          this.vendorStock.splice(this.vendorStock.indexOf(item), 1);
          this.inventory.push(item);
          host.sound('buy');
          host.changed('gold');
        },
        hint: 'BUY',
      },
      {
        title: 'Your bag',
        items: () => pad(this.inventory, CAPACITY),
        cols: 6,
        price: (item) => itemPrice(item),
        act: (item) => {
          if (!item) return;
          this.inventory.splice(this.inventory.indexOf(item), 1);
          host.addGold(itemPrice(item));
          host.sound('sell');
          host.changed('gold');
        },
        hint: 'SELL',
      },
    ]);
  }

  craftingView(host: PanelHost): Panel {
    const cost = (item: Item) => Math.round(itemPrice(item) * 1.5);
    return new GridPanel('crafting', 'Brann’s Anvil', host, this, [
      {
        title: 'Reforge: reroll an item’s affixes',
        items: () => pad(this.inventory, CAPACITY),
        cols: 8,
        price: cost,
        act: (item) => {
          if (!item || item.rarity === 'normal') return host.sound('error');
          if (!host.addGold(-cost(item))) return host.sound('error');
          const i = this.inventory.indexOf(item);
          const fresh = makeItem(host.services.rng.fork(`reforge:${item.uid}:${Date.now()}`), item.level, item.rarity, baseOf(item));
          this.inventory[i] = fresh;
          host.sound('equip');
          host.changed('gold');
        },
        hint: 'REFORGE',
      },
    ]);
  }
}

function pad(items: readonly Item[], n: number): (Item | null)[] {
  return Array.from({ length: Math.max(n, items.length) }, (_, i) => items[i] ?? null);
}

interface Grid {
  title: string;
  items: () => (Item | null)[];
  cols: number;
  labels?: readonly string[];
  price?: (item: Item) => number;
  act: (item: Item | null, index: number) => void;
  hint: string;
}

const CELL = 20;

/** One or two item grids side by side, with a tooltip for the focused item. */
class GridPanel implements Panel {
  readonly size: { w: number; h: number };
  private g = 1;
  private i = 0;
  private rects: { g: number; i: number; r: Rect }[] = [];

  constructor(
    readonly id: string,
    readonly title: string,
    private readonly host: PanelHost,
    private readonly loot: StubLoot,
    private readonly grids: Grid[],
  ) {
    const w = grids.reduce((s, g) => s + g.cols * CELL + 10, 0) + 120;
    this.size = { w: Math.min(460, w), h: 180 };
    if (grids.length === 1) this.g = 0;
  }

  draw(ui: UiCanvas, r: Rect): void {
    this.rects = [];
    let x = r.x + 4;
    const gold = this.host.gold();
    this.grids.forEach((grid, gi) => {
      ui.text(x, r.y + 2, grid.title.toUpperCase(), { color: 'mist' });
      const items = grid.items();
      items.forEach((item, i) => {
        const cx = x + (i % grid.cols) * CELL;
        const cy = r.y + 13 + Math.floor(i / grid.cols) * CELL;
        const cell = { x: cx, y: cy, w: CELL - 2, h: CELL - 2 };
        this.rects.push({ g: gi, i, r: cell });
        const focus = gi === this.g && i === this.i;
        ui.rect(cell.x, cell.y, cell.w, cell.h, focus ? 'sand' : 'ink');
        ui.rect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2, item ? 'night' : 'ink');
        if (item) {
          ui.sprite(cell.x + 1, cell.y + 2, baseOf(item).icon, { w: 'white', m: 'mist', o: RARITY_COLOR[item.rarity], r: 'red', s: 'sand', g: 'green' }, 2);
          if (item.rarity !== 'normal') ui.rect(cell.x + 1, cell.y + cell.h - 2, cell.w - 2, 1, RARITY_COLOR[item.rarity]);
          if (grid.price) ui.mini(cell.x + cell.w - 1, cell.y + 1, String(grid.price(item)), grid.price(item) > gold && gi === 0 && this.grids.length > 1 ? 'red' : 'sand', 'right', 'ink');
        } else if (grid.labels?.[i]) ui.mini(cell.x + cell.w / 2, cell.y + 7, grid.labels[i]!.slice(0, 4).toUpperCase(), 'slate', 'center');
      });
      x += grid.cols * CELL + 10;
    });
    // tooltip for the focused item
    const grid = this.grids[this.g];
    const item = grid?.items()[this.i] ?? null;
    const tx = x;
    const tw = r.x + r.w - tx - 2;
    ui.rect(tx - 4, r.y + 2, 1, r.h - 14, 'slate');
    if (item && grid) {
      let y = r.y + 4;
      for (const line of wrap(item.name.toUpperCase(), tw)) {
        ui.text(tx, y, line, { color: RARITY_COLOR[item.rarity] });
        y += 9;
      }
      ui.mini(tx, y, `${item.rarity.toUpperCase()} ${baseOf(item).slot.toUpperCase()} L${item.level}`, 'slate');
      y += 8;
      for (const m of itemMods(item)) {
        for (const line of wrap(describeMod(m).toUpperCase(), tw)) {
          ui.text(tx, y, line, { color: 'sky' });
          y += 9;
        }
      }
      if (grid.price) ui.text(tx, r.y + r.h - 26, `${grid.price(item)} GOLD`, { color: 'sand' });
      ui.prompt(tx, r.y + r.h - 14, 'F', 'A', grid.hint);
    } else ui.text(tx, r.y + 4, 'EMPTY', { color: 'slate' });
    ui.text(r.x + 4, r.y + r.h - 10, `GOLD ${gold}`, { color: 'sand' });
    const c = this.loot.counts();
    ui.mini(r.x + r.w - 6, r.y + r.h - 9, `BAG ${c.inventory}/${c.capacity}`, 'mist', 'right');
  }

  input(e: UiEvent): boolean {
    const grid = this.grids[this.g]!;
    const n = grid.items().length;
    if (e.kind === 'nav') {
      const cols = grid.cols;
      if (e.dir === 'left') {
        if (this.i % cols === 0 && this.g > 0) {
          this.g--;
          this.i = Math.min(this.i, this.grids[this.g]!.items().length - 1);
        } else this.i = Math.max(0, this.i - 1);
      } else if (e.dir === 'right') {
        if ((this.i % cols === cols - 1 || this.i === n - 1) && this.g < this.grids.length - 1) {
          this.g++;
          this.i = Math.min(Math.floor(this.i / cols) * this.grids[this.g]!.cols, this.grids[this.g]!.items().length - 1);
        } else this.i = Math.min(n - 1, this.i + 1);
      } else if (e.dir === 'up') this.i = Math.max(0, this.i - cols);
      else this.i = Math.min(n - 1, this.i + cols);
      return true;
    }
    if (e.kind === 'confirm') {
      grid.act(grid.items()[this.i] ?? null, this.i);
      return true;
    }
    if (e.kind === 'pointer') {
      const hit = this.rects.find((c) => inside(c.r, e.x, e.y));
      if (!hit) return false;
      this.g = hit.g;
      this.i = hit.i;
      if (e.type === 'down') this.grids[hit.g]!.act(this.grids[hit.g]!.items()[hit.i] ?? null, hit.i);
      return true;
    }
    return false;
  }
}

export function createStubLoot(): LootPort {
  return new StubLoot();
}
