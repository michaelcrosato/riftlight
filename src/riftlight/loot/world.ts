/**
 * Loot in the world: drops burst out of a kill in a small arc, land with particles and a
 * sound by rarity, then lie on the ground as a chunky toon mesh per item class, with a
 * name label (ctx.hud), a light beam and a dynamic light for rares and uniques.
 *
 * - Listens to `kill` on the GameEventBus, rolls drops (`rollDrops`) and emits `loot` and
 *   `gold`. Listens to `loot` / `gold` (from anyone: chests, bosses, tests) and spawns them.
 * - Pickup: walking over gold collects it; currency is auto-looted the same way (option);
 *   items are picked up by clicking their label or with F (interact) when near.
 * - The loot filter (data/filter.ts) hides or dims labels by rarity and depth; Alt toggles
 *   it off and on.
 *
 * Call `update(dt)` once per frame *after* the shell's `ctx.hud.clear()`: labels are HUD
 * text drawn every frame.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  PointLight,
  Vector3,
} from 'three/webgpu';
import type { GameContext, PaletteColor } from '../../engine';
import { toonMaterial } from '../../engine';
import { PALETTE } from '../../engine/palette';
import type { StatSheet } from '../core/mods';
import type { Rng } from '../core/rng';
import type { GameEventBus, Item } from '../core/types';
import { CURRENCY } from './content';
import { LOOT_SOUNDS } from './data/sounds';
import { filterTier, type FilterRule, type FilterTier, GOLD_COLOUR, itemClass, itemColour, LOOT_FILTER } from './filter';
import { rollDrops } from './generate';
import { baseOf } from './itemMods';

/** A dynamic light lent by a light pool (the levels system may provide one). */
export interface LightHandle {
  release(): void;
}
export interface LightPool {
  /** Ask for a light at `at`; null when the pool is exhausted. */
  request(at: Vector3, color: number, intensity: number, distance: number): LightHandle | null;
}

/** Fallback pool: a few three PointLights created up front (adding lights later would recompile every material). */
export class PointLightPool implements LightPool {
  readonly lights: PointLight[] = [];
  private readonly used = new Set<PointLight>();
  constructor(parent: Object3D, size = 3) {
    for (let i = 0; i < size; i++) {
      const l = new PointLight(0xffffff, 0, 4, 2);
      l.castShadow = false;
      l.position.set(0, -100, 0);
      parent.add(l);
      this.lights.push(l);
    }
  }
  request(at: Vector3, color: number, intensity: number, distance: number): LightHandle | null {
    const l = this.lights.find((x) => !this.used.has(x));
    if (!l) return null;
    this.used.add(l);
    l.color.setHex(color);
    l.intensity = intensity;
    l.distance = distance;
    l.position.copy(at);
    return {
      release: () => {
        l.intensity = 0;
        l.position.set(0, -100, 0);
        this.used.delete(l);
      },
    };
  }
}

export interface WorldLootOptions {
  events: GameEventBus;
  /** Drops fork from it per kill (`kill:<n>`), so a run's loot is reproducible. */
  rng: Rng;
  /** Current depth (filter and drop level). */
  depth: number | (() => number);
  /** Hero feet position (pickups), or null when there's no hero. */
  hero: () => Vector3 | null;
  /** The hero's StatSheet: `item.rarity`, `item.quantity`, `gold.find` scale drops. */
  heroStats?: () => StatSheet | null;
  /** Put an item in the inventory; return false when it doesn't fit (it stays on the ground). */
  onPickup: (item: Item) => boolean;
  onGold: (amount: number) => void;
  lights?: LightPool;
  /** Walk over currency to collect it. Default true. */
  autoLootCurrency?: boolean;
  filter?: readonly FilterRule[];
  /** True while item windows are open (no pickups, no Alt toggle). */
  blocked?: () => boolean;
}

export interface GroundDrop {
  readonly id: number;
  readonly item: Item | null;
  readonly gold: number;
  readonly mesh: Group;
  readonly from: Vector3;
  readonly to: Vector3;
  /** 0..1 along the arc; 1 = landed. */
  t: number;
  readonly tier: FilterTier;
  beam: Mesh | null;
  light: LightHandle | null;
  /** Label rect in art pixels this frame (null when hidden). */
  label: { x: number; y: number; w: number; h: number } | null;
}

const ARC_TIME = 0.5;
const ARC_HEIGHT = 1.1;
const GOLD_RADIUS = 0.9;
const INTERACT_RADIUS = 2.2;
const CLICK_RADIUS = 3;

const PALETTE_NAME: Readonly<Record<string, PaletteColor>> = { normal: 'white', magic: 'sky', rare: 'sand', unique: 'orange', currency: 'mist', gem: 'cyan' };

export class WorldLoot {
  readonly drops: GroundDrop[] = [];
  /** Alt toggles this: false shows everything the filter hides. */
  filterEnabled = true;
  /** Counters for tools and tests. */
  readonly stats = { kills: 0, dropped: 0, gold: 0, pickedUp: 0, goldCollected: 0 };
  readonly root = new Group();
  private nextId = 1;
  private readonly offs: (() => void)[] = [];
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly beamMaterials = new Map<number, MeshBasicNodeMaterial>();
  private readonly lights: LightPool;
  private readonly abort = new AbortController();
  private pending: GroundDrop | null = null;
  private readonly tmp = new Vector3();

  constructor(
    private readonly ctx: GameContext,
    private readonly opts: WorldLootOptions,
  ) {
    this.root.name = 'WorldLoot';
    ctx.scene.add(this.root);
    this.lights = opts.lights ?? new PointLightPool(this.root);
    for (const [id, def] of Object.entries(LOOT_SOUNDS)) ctx.audio.register(id, def);
    ctx.particles.register('loot-burst', {
      count: [8, 12], life: [0.3, 0.6], speed: [1.2, 2.6], spread: 70, gravity: 3, drag: 2, size: [2, 1], colors: ['white', 'sand'], radius: 0.1,
    });
    this.offs.push(
      opts.events.on('kill', (e) => {
        if (e.target.faction !== 'monster') return;
        this.dropFor(e.target.position, e.rank, e.depth);
      }),
      opts.events.on('loot', (e) => this.spawn(e.item, e.at)),
      opts.events.on('gold', (e) => this.spawnGold(e.amount, e.at)),
    );
    ctx.engine.renderer.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointer(e), { signal: this.abort.signal });
  }

  get depth(): number {
    return typeof this.opts.depth === 'function' ? this.opts.depth() : this.opts.depth;
  }

  /** Roll a kill's drops at `at` and emit them (`loot` per item, `gold` once). */
  dropFor(at: Vector3, rank: Parameters<typeof rollDrops>[1]['rank'], depth = this.depth): void {
    const n = this.stats.kills++;
    const sheet = this.opts.heroStats?.() ?? null;
    const drops = rollDrops(this.opts.rng.fork(`kill:${n}`), {
      depth,
      rank,
      itemRarity: sheet ? sheet.get('item.rarity') : 0,
      itemQuantity: sheet ? sheet.get('item.quantity') : 0,
      goldFind: sheet ? sheet.get('gold.find') : 0,
    });
    for (const item of drops.items) this.opts.events.emit('loot', { item, at: at.clone() });
    if (drops.gold > 0) this.opts.events.emit('gold', { amount: drops.gold, at: at.clone() });
  }

  /** Put an item on the ground, bursting out of `at`. */
  spawn(item: Item, at: Vector3): GroundDrop {
    return this.add(item, 0, at);
  }

  spawnGold(amount: number, at: Vector3): GroundDrop {
    return this.add(null, amount, at);
  }

  private add(item: Item | null, gold: number, at: Vector3): GroundDrop {
    const id = this.nextId++;
    const r = this.opts.rng.fork(`land:${id}`);
    const angle = r.range(0, Math.PI * 2);
    const dist = r.range(0.5, 1.5);
    const to = new Vector3(at.x + Math.cos(angle) * dist, at.y, at.z + Math.sin(angle) * dist);
    const from = new Vector3(at.x, at.y + 0.6, at.z);
    const mesh = this.buildMesh(item, gold);
    mesh.position.copy(from);
    mesh.rotation.y = r.range(0, Math.PI * 2);
    this.root.add(mesh);
    const tier: FilterTier = item ? filterTier(item, this.depth, this.opts.filter ?? LOOT_FILTER) : 'show';
    const drop: GroundDrop = { id, item, gold, mesh, from, to, t: 0, tier, beam: null, light: null, label: null };
    this.drops.push(drop);
    if (item) this.stats.dropped++;
    else this.stats.gold += gold;
    return drop;
  }

  /** Remove a drop from the world (picked up or cleared). */
  remove(drop: GroundDrop): void {
    const i = this.drops.indexOf(drop);
    if (i >= 0) this.drops.splice(i, 1);
    this.root.remove(drop.mesh);
    drop.light?.release();
    drop.light = null;
    if (this.pending === drop) this.pending = null;
  }

  /** Try to pick up a drop now (ignores distance). Returns true when it left the ground. */
  pickup(drop: GroundDrop): boolean {
    if (drop.item) {
      if (!this.opts.onPickup(drop.item)) {
        this.ctx.audio.play('loot-deny');
        return false;
      }
      this.stats.pickedUp++;
      this.ctx.audio.play('loot-pickup');
    } else {
      this.opts.onGold(drop.gold);
      this.stats.goldCollected += drop.gold;
      this.ctx.audio.play('loot-gold');
      this.ctx.particles.burst('sparkle', drop.mesh.position, { count: 6 });
    }
    this.remove(drop);
    return true;
  }

  /** Pick up the nearest visible item within interact range of the hero (F). */
  pickupNearest(): boolean {
    const hero = this.opts.hero();
    if (!hero) return false;
    let best: GroundDrop | null = null;
    let bestD = INTERACT_RADIUS;
    for (const d of this.drops) {
      if (d.t < 1 || !this.isVisible(d)) continue;
      const dist = flatDist(hero, d.mesh.position);
      if (dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    return best ? this.pickup(best) : false;
  }

  /** The drop whose label covers art pixel (x, y). */
  labelAt(x: number, y: number): GroundDrop | null {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      const l = d.label;
      if (l && x >= l.x && y >= l.y && x < l.x + l.w && y < l.y + l.h) return d;
    }
    return null;
  }

  /** Click on a label at art (x, y): picks it up when close, else walks-to-pick when the hero gets there. */
  clickAt(x: number, y: number): boolean {
    const d = this.labelAt(x, y);
    if (!d) return false;
    const hero = this.opts.hero();
    if (hero && flatDist(hero, d.mesh.position) <= CLICK_RADIUS) this.pickup(d);
    else this.pending = d;
    return true;
  }

  isVisible(d: GroundDrop): boolean {
    return !(this.filterEnabled && d.tier === 'hide');
  }

  /** Per frame: arcs, landing effects, filter, pickups, labels. */
  update(dt: number): void {
    const { ctx } = this;
    const blocked = this.opts.blocked?.() ?? false;
    if (!blocked && ctx.input.wasPressed('AltLeft', 'AltRight')) this.filterEnabled = !this.filterEnabled;
    for (const d of [...this.drops]) {
      if (d.t < 1) {
        d.t = Math.min(1, d.t + dt / ARC_TIME);
        const t = d.t;
        d.mesh.position.lerpVectors(d.from, d.to, t);
        d.mesh.position.y = d.from.y + (d.to.y - d.from.y) * t + Math.sin(Math.PI * t) * ARC_HEIGHT;
        d.mesh.rotation.x = (1 - t) * 6;
        if (d.t >= 1) this.land(d);
      }
      d.mesh.visible = this.isVisible(d);
      if (d.beam) d.beam.visible = d.mesh.visible;
    }
    const hero = this.opts.hero();
    if (hero && !blocked) {
      for (const d of [...this.drops]) {
        if (d.t < 1) continue;
        const near = flatDist(hero, d.mesh.position);
        const auto = !d.item || (this.opts.autoLootCurrency !== false && itemClass(d.item) === 'currency');
        if (auto && near < GOLD_RADIUS) this.pickup(d);
        else if (this.pending === d && near < 1.2) this.pickup(d);
      }
      if (ctx.input.wasPressed('KeyF')) this.pickupNearest();
    }
    this.drawLabels();
  }

  private land(d: GroundDrop): void {
    const cls = d.item ? itemClass(d.item) : 'gold';
    const colourName: PaletteColor = d.item ? (PALETTE_NAME[cls] ?? 'white') : 'sand';
    this.ctx.particles.burst('loot-burst', d.to, { colors: [colourName, 'white'], count: d.tier === 'loud' ? 18 : 8 });
    if (!this.isVisible(d)) return;
    this.ctx.audio.play(d.item ? `loot-${cls}` : 'loot-gold', d.tier === 'loud' ? { volume: 1 } : {});
    if (d.item && (d.item.rarity === 'rare' || d.item.rarity === 'unique' || d.tier === 'loud')) {
      const colour = itemColour(d.item);
      d.beam = new Mesh(this.geometry('beam'), this.beamMaterial(colour));
      d.beam.position.set(0, 2.5, 0);
      d.beam.renderOrder = 2;
      d.mesh.add(d.beam);
      d.light = this.lights.request(this.tmp.copy(d.to).setY(d.to.y + 0.8), colour, d.item.rarity === 'unique' ? 6 : 4, 4);
    }
  }

  private drawLabels(): void {
    const { hud, camera, engine } = this.ctx;
    const res = engine.renderer.resolution;
    const cam = camera.camera;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    // Nearest the camera first so they win the stacking.
    const order = this.drops.filter((d) => d.t >= 1 && d.mesh.visible).sort((a, b) => a.mesh.position.z - b.mesh.position.z);
    for (const d of this.drops) d.label = null;
    for (const d of order) {
      if (d.item && this.filterEnabled && d.tier === 'hide') continue;
      const p = this.tmp.copy(d.mesh.position).setY(d.mesh.position.y + 0.35).project(cam);
      if (p.z > 1 || p.x < -1.2 || p.x > 1.2 || p.y < -1.2 || p.y > 1.2) continue;
      const text = this.labelText(d);
      const m = hud.measure(text);
      const w = m.width + 4;
      const h = m.height + 4;
      let x = Math.round(((p.x + 1) / 2) * res.width - w / 2);
      let y = Math.round(((1 - p.y) / 2) * res.height - h - 4);
      // Greedy stacking: move up past any label this overlaps.
      for (let tries = 0; tries < 12; tries++) {
        const hit = placed.find((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y);
        if (!hit) break;
        y = hit.y - h - 1;
      }
      x = Math.max(0, Math.min(res.width - w, x));
      const rect = { x, y, w, h };
      placed.push(rect);
      d.label = rect;
      const colour = d.item ? itemColour(d.item) : GOLD_COLOUR;
      const dim = d.item && d.tier === 'dim' && this.filterEnabled;
      if (d.tier === 'loud') hud.rect(x - 1, y - 1, w + 2, h + 2, colour);
      hud.rect(x, y, w, h, 'ink');
      hud.text(x + 2, y + 2, text, { color: dim ? PALETTE.slate : colour, shadow: false });
    }
  }

  private labelText(d: GroundDrop): string {
    if (!d.item) return `${d.gold} gold`;
    const q = d.item.quantity && d.item.quantity > 1 ? `${d.item.quantity}x ` : '';
    return `${q}${d.item.name}`;
  }

  private onPointer(e: PointerEvent): void {
    if (e.button !== 0 || this.opts.blocked?.()) return;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const res = this.ctx.engine.renderer.resolution;
    const x = Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * res.width);
    const y = Math.floor(((e.clientY - r.top) / Math.max(1, r.height)) * res.height);
    this.clickAt(x, y);
  }

  // ---------------------------------------------------------------- meshes

  private geometry(key: string): BufferGeometry {
    let g = this.geometries.get(key);
    if (!g) {
      g = key === 'beam' ? new CylinderGeometry(0.05, 0.05, 5, 6, 1, true) : new BoxGeometry(...(key.split(',').map(Number) as [number, number, number]));
      this.geometries.set(key, g);
    }
    return g;
  }

  private beamMaterial(colour: number): MeshBasicNodeMaterial {
    let m = this.beamMaterials.get(colour);
    if (!m) {
      m = new MeshBasicNodeMaterial({ color: colour, transparent: true, opacity: 0.55, depthWrite: false });
      this.beamMaterials.set(colour, m);
    }
    return m;
  }

  private box(parent: Group, w: number, h: number, d: number, colour: number, x = 0, y = 0, z = 0): Mesh {
    const m = new Mesh(this.geometry(`${w},${h},${d}`), toonMaterial(colour));
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /** A chunky toon mesh per item class (weapon, armour, ring, gem, orb, gold pile). */
  private buildMesh(item: Item | null, gold: number): Group {
    const g = new Group();
    g.name = item ? `loot:${item.uid}` : 'loot:gold';
    if (!item) {
      const n = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, gold))));
      for (let i = 0; i < n; i++) this.box(g, 0.22, 0.05, 0.22, PALETTE.sand, (i % 2) * 0.12 - 0.06, i * 0.05, Math.floor(i / 2) * 0.1 - 0.05);
      return g;
    }
    const colour = itemColour(item);
    const base = baseOf(item);
    const look = base.look ?? base.slot;
    switch (look) {
      case 'sword':
      case 'dagger':
      case 'axe':
      case 'mace':
      case 'staff':
      case 'wand':
      case 'sceptre': {
        const len = look === 'dagger' ? 0.35 : look === 'staff' ? 0.9 : 0.6;
        this.box(g, len, 0.05, 0.08, look === 'staff' || look === 'wand' ? PALETTE.orange : PALETTE.mist, 0.05);
        this.box(g, 0.06, 0.06, 0.24, colour, -len / 2 + 0.12);
        if (look === 'axe' || look === 'mace' || look === 'sceptre') this.box(g, 0.14, 0.08, 0.2, colour, len / 2 - 0.05);
        break;
      }
      case 'bow':
        this.box(g, 0.08, 0.05, 0.7, PALETTE.orange);
        this.box(g, 0.2, 0.04, 0.04, colour, 0.1, 0, 0.33);
        this.box(g, 0.2, 0.04, 0.04, colour, 0.1, 0, -0.33);
        break;
      case 'shield':
      case 'focus':
      case 'quiver':
        this.box(g, 0.4, 0.06, 0.4, PALETTE.mist);
        this.box(g, 0.16, 0.08, 0.16, colour);
        break;
      case 'ring':
      case 'amulet':
        this.box(g, 0.2, 0.05, 0.05, PALETTE.mist, 0, 0, 0.08);
        this.box(g, 0.2, 0.05, 0.05, PALETTE.mist, 0, 0, -0.08);
        this.box(g, 0.05, 0.05, 0.2, PALETTE.mist, 0.08);
        this.box(g, 0.05, 0.05, 0.2, PALETTE.mist, -0.08);
        this.box(g, 0.1, 0.08, 0.1, colour, 0, 0, look === 'amulet' ? 0.14 : 0.1);
        break;
      case 'belt':
        this.box(g, 0.5, 0.05, 0.12, PALETTE.plum);
        this.box(g, 0.12, 0.07, 0.14, colour);
        break;
      case 'gem': {
        const m = this.box(g, 0.16, 0.16, 0.16, colour, 0, 0.08);
        m.rotation.set(Math.PI / 4, 0, Math.PI / 4);
        break;
      }
      case 'orb': {
        const c = CURRENCY.has(item.base) ? colour : PALETTE.mist;
        this.box(g, 0.16, 0.16, 0.16, c, 0, 0.02);
        this.box(g, 0.08, 0.08, 0.08, PALETTE.white, 0.04, 0.12);
        break;
      }
      default:
        // Armour pieces: a body block plus a trim in the rarity colour.
        this.box(g, 0.36, 0.16, 0.3, PALETTE.mist);
        this.box(g, 0.38, 0.06, 0.1, colour, 0, 0.16);
        break;
    }
    return g;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.abort.abort();
    for (const d of [...this.drops]) this.remove(d);
    this.root.removeFromParent();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.beamMaterials.values()) m.dispose();
    this.geometries.clear();
    this.beamMaterials.clear();
  }
}

function flatDist(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
