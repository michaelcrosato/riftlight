/**
 * The real LootPort: R3's loot (`src/riftlight/loot`) and item windows (`ui/items`) behind
 * the game shell's port (game/ports.ts). `new Riftlight()` uses it by default.
 *
 * - **Drops**: `rollDrops` with depth / rank scaling and the hero's `item.rarity`,
 *   `item.quantity` and `gold.find` (from `services.hero()`); ~6% of items are gems from
 *   the skills registry.
 * - **World**: R3's `WorldLoot` bursts drops out in an arc, lands them with particles and a
 *   sound by class, and gives rares, uniques and loud drops a beam and a light from the
 *   engine's `ctx.lights` pool (never a new PointLight). The shell draws the labels from
 *   `ground()`; `filtered` follows `settings().lootFilter` (0 show all, 1 hide normal gear,
 *   2 rares only; currency and gems always show) plus R3's filter rules, and Alt toggles it.
 * - **Items**: one `ItemsStore` (inventory grid, equipment, stash tabs, gold mirror, skill
 *   sockets) and one `ItemsUi` overlay. The views are overlay `Panel`s in the `items` group
 *   (inventory, stash, vendor with wares and gems tabs, the crafting bench, the skill panel);
 *   the shell routes keys and the pad to them and closes them.
 * - **Save**: `load` / `write` keep grid positions (`SaveData.positions`) and the skill
 *   sockets (`save.hero.skills`); a new run starts with four starter gems socketed.
 * - **To the shell**: equipment changes → `changed('gear')` (it re-reads `gearMods()`),
 *   sockets → the save, then `changed('skills')`, gold spent or earned at a vendor →
 *   `addGold` (the save's gold is the one wallet).
 */
import { Group, Vector3 } from 'three/webgpu';
import type { GameContext, PaletteColor } from '../../engine';
import { EventBus } from '../core/events';
import type { Mod } from '../core/mods';
import { Rng } from '../core/rng';
import type { GameEvents, Item, Rarity, SaveData } from '../core/types';
import { filterTier, itemClass } from '../loot/filter';
import { rollDrops, rollItem } from '../loot/generate';
import { allItems, findItem, INVENTORY_SIZE, type LootState, lootFromSave, lootToSave, pickUp, removeItem } from '../loot/inventory';
import { EQUIP_SLOTS, itemMods, sourceKey } from '../loot/itemMods';
import { normalizeSockets, type SkillSocket, socketedGems, starterSockets } from '../loot/sockets';
import { vendorStock, type VendorKind } from '../loot/vendor';
import { type GroundDrop, WorldLoot as WorldLootSystem, type WorldLootState } from '../loot/world';
import { type Drop, ITEM_GROUP, type KillInfo, type LootPort, type Panel, type PanelHost, type ShellServices, type StageWorld, type WorldLoot } from '../game/ports';
import { ItemsStore } from '../ui/items/store';
import { type ItemsViewState, ItemsUi, type LeftPanel } from '../ui/items/ItemsUi';
import type { UiCanvas, UiEvent } from '../ui/kit';

/** Label colours by item class (the shell's labels use palette names). */
const CLASS_COLOR: Readonly<Record<string, PaletteColor>> = { normal: 'white', magic: 'sky', rare: 'sand', unique: 'orange', currency: 'mist', gem: 'cyan' };

/** Window titles: the townsfolk who own them. */
const TITLES = { stash: 'Stash', vendor: "Ilsa's wares", bench: "Brann's anvil", skills: 'Skills' } as const;

/** A drop on the ground as the shell sees it (wraps R3's GroundDrop). */
interface PortDrop extends WorldLoot {
  readonly ground: GroundDrop;
  filtered: boolean;
  tier: 'loud' | 'show' | 'dim';
}

/** The shell's view of a world drop: label and colour from what it is. */
function portDrop(g: GroundDrop, drop: Drop, tier: PortDrop['tier'], filtered: boolean): PortDrop {
  return {
    id: g.id,
    drop,
    ground: g,
    position: g.to,
    label: drop.kind === 'gold' ? `${drop.amount} GOLD` : `${drop.item.quantity && drop.item.quantity > 1 ? `${drop.item.quantity}X ` : ''}${drop.item.name.toUpperCase()}`,
    color: drop.kind === 'gold' ? 'sand' : (CLASS_COLOR[itemClass(drop.item)] ?? 'white'),
    filtered,
    tier,
  };
}

type View = 'inventory' | Exclude<LeftPanel, null>;

/** The loot as data (`RealLoot.saveState`): the items, the sockets, this visit's vendor stock, the crafting stream, the counters. */
export interface RealLootState {
  readonly state: LootState;
  readonly skills: readonly SkillSocket[];
  readonly vendor: { readonly kind: VendorKind; readonly stock: readonly Item[] };
  readonly stocks: Partial<Record<VendorKind, readonly Item[]>>;
  readonly stockKey: string;
  readonly depth: number;
  /** The crafting stream, once the item windows forked it. */
  readonly crafting: number | null;
  /** The world loot: counters, filter toggle and the drops on the ground (their meshes, beams, lights). */
  readonly world: WorldLootState | null;
  /** The shell's side of each drop on the ground, in order (by the world drop's id). */
  readonly ground: readonly { readonly id: number; readonly tier: PortDrop['tier']; readonly filtered: boolean }[];
  readonly view: ItemsViewState | null;
}

export class RealLoot implements LootPort {
  readonly store = new ItemsStore({ heroLevel: 1, sheet: null });
  services: ShellServices | null = null;
  ui: ItemsUi | null = null;
  world: WorldLootSystem | null = null;
  /** The panel showing the item windows now (one at a time: they share the overlay). */
  active: ItemsPanel | null = null;
  private host: PanelHost | null = null;
  private drops = new Map<number, PortDrop>();
  /** Where the world loot hangs now (the current stage's root). */
  private readonly root = new Group();
  private depth = 1;
  private quiet = 0;
  private lastEquipment = this.store.state.equipment;
  private stockKey = '';
  /** Has the crafting stream been forked from the run's (the first time the windows open)? */
  private crafting = false;

  constructor() {
    this.root.name = 'loot';
    this.store.onChange((s) => this.onStore(s));
    this.store.onSkills(() => {
      if (this.quiet || !this.host) return;
      this.host.save().hero.skills = this.store.skills.map((x) => ({ ...x, supports: [...x.supports] }));
      this.host.changed('skills');
    });
  }

  init(services: ShellServices): void {
    this.services = services;
  }

  private get ctx(): GameContext {
    if (!this.services) throw new Error('LootPort used before init()');
    return this.services.ctx;
  }

  /** The hero's stats (drops, comparisons, skill numbers), when the shell has a hero. */
  private heroStats() {
    return this.services?.hero?.()?.stats ?? null;
  }

  // ---------------------------------------------------------------- drops and the ground

  rollDrops(kill: KillInfo, rng: Rng): Drop[] {
    this.depth = kill.depth;
    // find stats are multipliers on the hero (base 1): the kill carries them as fractions above
    // 1 (0.3 = 30% increased); read the sheet the same way when it doesn't
    const sheet = this.heroStats();
    const frac = (given: number | undefined, stat: string) => given ?? (sheet ? Math.max(-0.9, sheet.get(stat) - 1) : 0);
    const d = rollDrops(rng, { depth: kill.depth, rank: kill.rank, itemRarity: frac(kill.itemRarity, 'item.rarity'), itemQuantity: frac(kill.itemQuantity, 'item.quantity'), goldFind: frac(kill.goldFind, 'gold.find') });
    const out: Drop[] = d.items.map((item) => ({ kind: 'item', item }));
    if (d.gold > 0) out.push({ kind: 'gold', amount: d.gold });
    return out;
  }

  private worldLoot(): WorldLootSystem {
    if (this.world) return this.world;
    const ctx = this.ctx;
    this.world = new WorldLootSystem(ctx, {
      events: new EventBus<GameEvents>(), // private: the shell's kill / gold / loot events are its own
      rng: new Rng(1).fork('loot'),
      depth: () => this.depth,
      hero: () => null, // the shell picks up (walk over gold, F, label clicks)
      onPickup: () => false,
      onGold: () => {},
      labels: false,
      blocked: () => this.ui?.isOpen ?? false,
      place: (to) => this.stage?.collide(to, 0.25),
      lights: {
        request: (at, color, intensity, distance) => {
          const h = ctx.lights.request({ position: at, color, intensity, radius: distance, priority: 2, name: 'loot beam' });
          return { release: () => h.release() };
        },
      },
    });
    this.world.root.removeFromParent();
    this.root.add(this.world.root);
    return this.world;
  }

  private stage: StageWorld | null = null;

  spawn(drops: readonly Drop[], at: Vector3, stage: StageWorld, rng: Rng): WorldLoot[] {
    const world = this.worldLoot();
    if (this.root.parent !== stage.root) stage.root.add(this.root);
    this.stage = stage;
    const out: WorldLoot[] = [];
    const from = at.clone().setY(stage.groundY(at.x, at.z));
    void rng; // landing spots come from WorldLoot's own fork per drop id
    drops.forEach((drop) => {
      const g = drop.kind === 'gold' ? world.spawnGold(drop.amount, from) : world.spawn(drop.item, from);
      const tier = drop.kind === 'item' ? filterTier(drop.item, this.depth) : 'show';
      const d = portDrop(g, drop, tier === 'hide' ? 'dim' : tier, false);
      this.drops.set(g.id, d);
      out.push(d);
    });
    return out;
  }

  /** Hidden by the settings' loot filter (Alt shows everything). */
  private hides(item: Item): boolean {
    if (this.world && !this.world.filterEnabled) return false; // Alt: show everything
    const level = this.services?.settings().lootFilter ?? 0;
    if (level <= 0) return false;
    const cls = itemClass(item);
    if (cls === 'currency' || cls === 'gem') return filterTier(item, this.depth) === 'hide';
    if (item.rarity === 'normal' || (level >= 2 && item.rarity === 'magic')) return true;
    return filterTier(item, this.depth) === 'hide';
  }

  ground(): readonly WorldLoot[] {
    const out: PortDrop[] = [];
    for (const d of this.drops.values()) {
      d.filtered = d.drop.kind === 'item' && this.hides(d.drop.item);
      d.ground.mesh.visible = !d.filtered;
      if (d.ground.beam) d.ground.beam.visible = !d.filtered;
      out.push(d);
    }
    return out;
  }

  pickup(loot: WorldLoot): { ok: boolean; gold: number; item?: Item } {
    const d = this.drops.get(loot.id);
    if (!d) return { ok: false, gold: 0 };
    if (d.drop.kind === 'gold') {
      this.removeDrop(d);
      return { ok: true, gold: d.drop.amount };
    }
    const item = d.drop.item;
    if (!allItems(this.store.state).some((x) => x.uid === item.uid)) {
      const r = pickUp(this.store.state, item);
      if (!r.ok) return { ok: false, gold: 0 };
      this.store.set(r.value);
    }
    this.removeDrop(d);
    return { ok: true, gold: 0, item };
  }

  private removeDrop(d: PortDrop): void {
    this.drops.delete(d.id);
    this.world?.remove(d.ground);
  }

  update(dt: number): void {
    this.world?.update(dt);
  }

  clearGround(): void {
    for (const d of [...this.drops.values()]) this.removeDrop(d);
    this.root.removeFromParent();
    this.stage = null;
  }

  /** The game unloads: the item windows' canvas and listeners, the world loot's meshes. */
  dispose(): void {
    this.clearGround();
    this.ui?.dispose();
    this.ui = null;
    this.crafting = false;
    this.active = null;
    this.world?.dispose();
    this.world = null;
  }

  // ---------------------------------------------------------------- gear, saves, gifts

  gearMods(): Readonly<Record<string, readonly Mod[]>> {
    const out: Record<string, readonly Mod[]> = {};
    for (const slot of EQUIP_SLOTS) {
      const item = this.store.state.equipment[slot];
      out[sourceKey(slot)] = item ? itemMods(item) : [];
    }
    return out;
  }

  load(save: SaveData): void {
    this.quiet++;
    try {
      this.ui?.closeAll();
      this.active = null;
      this.host = null; // the shell that opened a window last: the next window it opens hooks it up again
      const state = lootFromSave({ hero: save.hero, stash: save.stash, positions: save.positions });
      // gems in the sockets: a new run starts with the starter gems
      const sockets = save.hero.skills.length ? normalizeSockets(save.hero.skills) : starterSockets(new Rng(save.seed).fork('starter'));
      save.hero.skills = sockets.map((x) => ({ ...x, supports: [...x.supports] }));
      this.store.skills = sockets;
      this.store.set({ ...state, gold: save.hero.gold });
      this.lastEquipment = this.store.state.equipment;
      this.store.stocks = {};
      this.stockKey = '';
      this.clearGround();
    } finally {
      this.quiet--;
    }
  }

  write(save: SaveData): void {
    this.ui?.returnHeld();
    const l = lootToSave(this.store.state);
    save.hero.equipment = l.hero.equipment;
    save.hero.inventory = l.hero.inventory;
    save.stash = l.stash;
    save.positions = l.positions;
    save.hero.skills = this.store.skills.map((x) => ({ ...x, supports: [...x.supports] }));
  }

  /**
   * The loot as data (save-states): the bags and windows, and the drops on the ground. The
   * hero's sheet is the hero's own (its gear sources are restored with it).
   */
  saveState(): RealLootState {
    const st = this.store;
    return {
      state: st.state,
      skills: st.skills,
      vendor: st.vendor,
      stocks: st.stocks,
      stockKey: this.stockKey,
      depth: this.depth,
      crafting: this.crafting ? st.rng.state : null,
      world: this.world?.saveState() ?? null,
      ground: [...this.drops.values()].map((d) => ({ id: d.id, tier: d.tier, filtered: d.filtered })),
      view: this.ui?.viewState() ?? null,
    };
  }

  /**
   * Put the loot back as `saveState` found it. Windows and the world loot that didn't exist then
   * are dropped (made again on demand); the drops on the ground now go, and the saved ones lie on
   * `stage` again (the stage they were on, built again: needed when there are any).
   */
  loadState(s: RealLootState, stage: StageWorld | null = null): void {
    const copy = <T>(v: T): T => structuredClone(v);
    const ground = s.ground ?? [];
    const worldDrops = s.world?.drops ?? [];
    if (ground.length !== worldDrops.length || ground.some((g, i) => g.id !== worldDrops[i]!.id)) throw new Error('RealLoot.loadState: the shell\'s drops and the world\'s differ');
    if (ground.length && !stage) throw new Error('RealLoot.loadState: loot lies on the ground: give the stage it lies on');
    this.quiet++;
    try {
      this.clearGround();
      const st = this.store;
      st.state = copy(s.state);
      st.skills = copy(s.skills) as SkillSocket[];
      st.vendor = copy(s.vendor) as ItemsStore['vendor'];
      st.stocks = copy(s.stocks) as ItemsStore['stocks'];
      st.version++;
      this.lastEquipment = st.state.equipment;
      this.stockKey = s.stockKey;
      this.depth = s.depth;
      this.crafting = s.crafting !== null;
      if (s.crafting !== null) st.rng.state = s.crafting;
      if (s.world) this.worldLoot().loadState({ ...s.world, drops: worldDrops, pending: s.world.pending ?? null });
      else if (this.world) {
        this.world.dispose();
        this.world = null;
      }
      // the shell's side of each drop, on the world's (same ids, same order)
      ground.forEach((x, i) => {
        const g = this.world!.drops[i]!;
        const drop: Drop = g.item ? { kind: 'item', item: g.item } : { kind: 'gold', amount: g.gold };
        this.drops.set(g.id, portDrop(g, drop, x.tier, x.filtered));
      });
      if (stage) {
        stage.root.add(this.root);
        this.stage = stage;
      }
      if (s.view) this.itemsUi().setViewState(s.view);
      else if (this.ui) {
        this.ui.dispose();
        this.ui = null;
      }
      this.active = null;
    } finally {
      this.quiet--;
    }
  }

  peek(): unknown {
    return { state: lootToSave(this.store.state), skills: this.store.skills, held: this.ui?.held?.item.uid ?? null };
  }

  setSockets(skills: SaveData['hero']['skills']): void {
    this.quiet++;
    try {
      this.store.setSkills(normalizeSockets(skills));
    } finally {
      this.quiet--;
    }
  }

  give(rng: Rng, level: number, rarity: Rarity = 'rare'): Item | null {
    const item = rollItem(rng, { itemLevel: Math.max(1, level), rarity });
    const r = pickUp(this.store.state, item);
    if (!r.ok) return null;
    this.store.set(r.value);
    return item;
  }

  /** Dev / tests: put a specific item in the bag (false when it doesn't fit). */
  add(item: Item): boolean {
    const r = pickUp(this.store.state, item);
    if (r.ok) this.store.set(r.value);
    return r.ok;
  }

  counts() {
    return { inventory: this.store.state.inventory.items.length, capacity: INVENTORY_SIZE.w * INVENTORY_SIZE.h, stash: this.store.state.stash.reduce((n, g) => n + g.items.length, 0) };
  }

  /** Everything the hero owns, socketed gems included (tools). */
  owned(): Item[] {
    return [...allItems(this.store.state), ...socketedGems(this.store.skills)];
  }

  // ---------------------------------------------------------------- the store ↔ the shell

  /** Before a frame of the windows: gold, level and the hero's sheet come from the shell. */
  sync(host: PanelHost): void {
    this.host = host;
    this.store.heroLevel = host.level();
    const gold = host.gold();
    if (this.store.state.gold !== gold) {
      this.quiet++;
      try {
        this.store.set({ ...this.store.state, gold });
      } finally {
        this.quiet--;
      }
    }
  }

  private onStore(state: LootState): void {
    if (this.quiet || !this.host) return;
    const host = this.host;
    const gold = host.gold();
    if (state.gold !== gold) {
      if (!host.addGold(state.gold - gold)) {
        // the shell refused (not enough gold): the shell's wallet wins
        this.quiet++;
        this.store.set({ ...state, gold: host.gold() });
        this.quiet--;
      }
      host.changed('gold');
    }
    if (state.equipment !== this.lastEquipment) {
      this.lastEquipment = state.equipment;
      host.changed('gear');
    }
  }

  /** This visit's vendor stock: one per trip to town (`stats.runs`), both tabs. */
  private stock(host: PanelHost): void {
    const save = host.save();
    const visit = save.stats?.runs ?? 0;
    const depth = Math.max(1, save.deepest);
    const key = `${save.seed}:${visit}:${depth}`;
    if (key === this.stockKey) return;
    this.stockKey = key;
    const kinds: VendorKind[] = ['smith', 'gems', 'gamble'];
    this.store.stocks = Object.fromEntries(kinds.map((k) => [k, vendorStock(save.seed, depth, visit, k)]));
    this.store.vendor = { kind: 'smith', stock: this.store.stocks.smith ?? [] };
  }

  /** The item windows (created on first use: they need the page). */
  itemsUi(): ItemsUi {
    if (!this.crafting) {
      this.store.rng = (this.services?.rng ?? new Rng(1)).fork('craft');
      this.crafting = true;
    }
    if (!this.ui) {
      const ctx = this.ctx;
      this.ui = new ItemsUi(ctx, this.store, { hosted: true, sheet: () => this.heroStats(), onClose: () => this.active?.host.close(), titles: TITLES });
    }
    return this.ui;
  }

  open(panel: ItemsPanel): void {
    const ui = this.itemsUi();
    this.active = panel;
    this.sync(panel.host);
    ui.closeAll();
    if (panel.view === 'vendor') this.stock(panel.host);
    if (panel.view === 'inventory') ui.openInventory();
    else if (panel.view === 'stash') ui.openStash();
    else if (panel.view === 'vendor') ui.openVendor();
    else if (panel.view === 'bench') ui.openBench();
    else ui.openSkills();
  }

  close(panel: ItemsPanel): void {
    if (this.active !== panel) return;
    this.active = null;
    this.ui?.closeAll();
  }

  inventoryView(host: PanelHost): Panel {
    return new ItemsPanel(this, host, 'inventory', 'inventory', 'Inventory');
  }

  stashView(host: PanelHost): Panel {
    return new ItemsPanel(this, host, 'stash', 'stash', 'Stash');
  }

  vendorView(host: PanelHost): Panel {
    return new ItemsPanel(this, host, 'vendor', 'vendor', TITLES.vendor);
  }

  craftingView(host: PanelHost): Panel {
    return new ItemsPanel(this, host, 'crafting', 'bench', TITLES.bench);
  }

  skillsView(host: PanelHost): Panel {
    return new ItemsPanel(this, host, 'skills', 'skills', 'Skills');
  }

  /** Tests / tools: drop an item from the bag (it is gone, not on the ground). */
  discard(uid: string): boolean {
    const p = findItem(this.store.state.inventory, uid);
    if (!p) return false;
    this.store.set({ ...this.store.state, inventory: removeItem(this.store.state.inventory, uid) });
    return true;
  }
}

/**
 * One item window as a shell Panel: an overlay (ItemsUi paints its own canvas) in the
 * `items` group, so opening the stash while the inventory is open swaps the view.
 */
export class ItemsPanel implements Panel {
  readonly overlay = true;
  readonly group = ITEM_GROUP;
  readonly size = { w: 256, h: 182 };
  private last = -1;

  constructor(
    private readonly loot: RealLoot,
    readonly host: PanelHost,
    readonly id: string,
    readonly view: View,
    readonly title: string,
  ) {}

  open(): void {
    this.loot.open(this);
  }

  close(): void {
    this.loot.close(this);
  }

  draw(_ui: UiCanvas, _rect: { x: number; y: number; w: number; h: number }, time: number): void {
    if (this.loot.active !== this) return;
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    this.last = time;
    this.loot.sync(this.host);
    this.loot.itemsUi().update(dt);
  }

  input(e: UiEvent): boolean {
    if (this.loot.active !== this) return false;
    return this.loot.itemsUi().handle(e);
  }

  covers(x: number, y: number): boolean {
    return this.loot.active === this && this.loot.itemsUi().covers(x, y);
  }
}

export function realLootPort(): RealLoot {
  return new RealLoot();
}
