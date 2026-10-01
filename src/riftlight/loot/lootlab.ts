/**
 * Loot Lab (`/?game=lootlab`): a small arena to see and test loot end to end. Training
 * dummies die on K (or `__LOOTLAB__.kill()`), drops burst out and land, gold and currency
 * are walked over, items are picked up with F or a click on the label, I opens the
 * inventory, T the stash, U a vendor, Alt toggles the loot filter.
 *
 * `window.__LOOTLAB__` exposes the world loot, the item windows, the store and the hero's
 * StatSheet for tools and the `riftlight-loot` e2e suite.
 */
import { BoxGeometry, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { compileClip, type Game, type GameContext, type MoveInput, PlatformerCharacter, readMoveInput, toonMaterial } from '../../engine';
import { restPoseOf } from '../../engine/animation';
import { HERO_MODEL } from '../../game/hero';
import { HERO_CLIPS } from '../../game/hero/animations';
import { HERO_RIG } from '../../game/hero/rig';
import { EventBus } from '../core/events';
import { StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import type { Rank } from '../core/scaling';
import type { ActorLike, GameEvents, HitResult, Item, Rarity } from '../core/types';
import { rollItem } from './generate';
import { InventoryView, ItemsStore, ItemsUi, StashView, VendorView } from '../ui/items';
import { addGold, pickUp } from './inventory';
import { vendorStock } from './vendor';
import { WorldLoot } from './world';

const NO_INPUT: MoveInput = { move: new Vector3(), jump: false, jumpHeld: false, crouch: false };

export class LootLab implements Game {
  readonly name = 'Loot Lab';
  readonly assets = [HERO_MODEL];
  hero!: PlatformerCharacter;
  heroModel!: Object3D;
  readonly events = new EventBus<GameEvents>();
  readonly sheet = new StatSheet({ life: 60, mana: 40, 'attack.speed.base': 1, 'crit.chance.base': 0.05 });
  depth = 10;
  readonly seed = 20261001;
  store!: ItemsStore;
  ui!: ItemsUi;
  inventory!: InventoryView;
  stash!: StashView;
  vendor!: VendorView;
  world!: WorldLoot;
  dummies: { mesh: Mesh; actor: ActorLike; respawn: number }[] = [];
  private moveInput: MoveInput | undefined;
  private gifts = 0;

  async setup(ctx: GameContext): Promise<void> {
    const { scene, physics, palette } = ctx;
    const floor = new Mesh(new BoxGeometry(24, 1, 24), toonMaterial(palette.night));
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    scene.add(floor);
    physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [12, 0.5, 12] });

    const rng = new Rng(this.seed);
    this.store = new ItemsStore({ heroLevel: 40, sheet: this.sheet, rng: rng.fork('craft') });
    this.ui = new ItemsUi(ctx, this.store);
    this.inventory = new InventoryView(this.ui);
    this.stash = new StashView(this.ui);
    this.vendor = new VendorView(this.ui);
    this.world = new WorldLoot(ctx, {
      events: this.events,
      rng: rng.fork('loot'),
      depth: () => this.depth,
      hero: () => (this.heroModel ? this.heroModel.position : null),
      heroStats: () => this.sheet,
      onPickup: (item) => {
        const r = pickUp(this.store.state, item);
        if (r.ok) this.store.set(r.value);
        return r.ok;
      },
      onGold: (amount) => this.store.set(addGold(this.store.state, amount)),
      blocked: () => this.ui.isOpen,
    });

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const pos = new Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5);
      const mesh = new Mesh(new BoxGeometry(0.7, 1.4, 0.7), toonMaterial(i === 0 ? palette.red : palette.plum));
      mesh.position.set(pos.x, 0.7, pos.z);
      mesh.castShadow = true;
      scene.add(mesh);
      this.dummies.push({ mesh, actor: dummyActor(i + 1, pos), respawn: 0 });
    }

    const model = await ctx.loadModel(HERO_MODEL, { castShadow: false });
    this.heroModel = model.scene;
    scene.add(this.heroModel);
    this.hero = new PlatformerCharacter(physics, { position: [0, 0, 0], lockDepth: ctx.camera.lockDepth });
    const rest = restPoseOf(this.heroModel, HERO_RIG);
    this.hero.attachModel(this.heroModel, HERO_CLIPS.map((d) => compileClip(d, HERO_RIG, rest)));

    (window as unknown as { __LOOTLAB__: LootLab }).__LOOTLAB__ = this;
  }

  /** Kill dummy `i` (default: the nearest live one) with `rank`, `count` times. */
  kill(rank: Rank = 'rare', count = 1, i?: number): void {
    for (let n = 0; n < count; n++) {
      const d = i !== undefined ? this.dummies[i] : this.nearestDummy();
      if (!d) return;
      this.events.emit('kill', { target: d.actor, killer: null, rank, depth: this.depth });
    }
  }

  /** Roll an item and drop it next to the hero (`onGround`) or straight into the inventory. */
  give(base: string, rarity: Rarity = 'magic', onGround = true): Item {
    const item = rollItem(new Rng(this.seed).fork(`give:${this.gifts++}`), { base, itemLevel: 40, rarity });
    if (onGround) this.events.emit('loot', { item, at: this.heroModel.position.clone() });
    else {
      const r = pickUp(this.store.state, item);
      if (r.ok) this.store.set(r.value);
    }
    return item;
  }

  private nearestDummy() {
    const p = this.heroModel?.position ?? new Vector3();
    return [...this.dummies].sort((a, b) => a.actor.position.distanceTo(p) - b.actor.position.distanceTo(p))[0];
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    // While item windows are open the hero stands still (clicks and keys belong to the UI).
    const input = this.ui.isOpen ? NO_INPUT : (this.moveInput = readMoveInput(ctx, this.hero, this.moveInput));
    this.hero.fixedUpdate(dt, input);
  }

  update(ctx: GameContext, dt: number): void {
    this.hero.updateVisual(this.heroModel, dt, ctx.physics.alpha);
    if (this.hero.feet.y < -10) this.hero.teleport([0, 0, 0]);
    const input = ctx.input;
    if (input.wasPressed('KeyI')) this.inventory.toggle();
    if (input.wasPressed('KeyT')) this.stash.toggle();
    if (input.wasPressed('KeyU')) {
      if (this.vendor.isOpen()) this.vendor.close();
      else this.vendor.open('smith', vendorStock(this.seed, this.depth, Math.floor(ctx.time), 'smith'));
    }
    if (!this.ui.isOpen && input.wasPressed('KeyK')) {
      const d = this.nearestDummy();
      if (d) {
        this.kill(d === this.dummies[0] ? 'boss' : 'rare', 1, this.dummies.indexOf(d));
        d.mesh.visible = false;
        d.respawn = 1;
      }
    }
    for (const d of this.dummies) {
      if (d.respawn > 0 && (d.respawn -= dt) <= 0) d.mesh.visible = true;
    }
    ctx.hud.clear();
    this.world.update(dt);
    this.ui.update(dt);
    ctx.hud.text(4, 4, `LOOT LAB  DEPTH ${this.depth}  GOLD ${this.store.state.gold}`, { color: 'sand' });
    ctx.hud.text(4, 14, `K KILL  F PICK UP  I INVENTORY  T STASH  U VENDOR  ALT FILTER ${this.world.filterEnabled ? 'ON' : 'OFF'}`, { color: 'mist' });
  }

  cameraTarget(): Vector3 {
    const p = this.heroModel ? this.heroModel.position : new Vector3();
    return p.clone().setY(p.y + 0.9);
  }

  status(): string {
    return `Loot Lab · ${this.world?.drops.length ?? 0} on the ground · ${this.store?.state.inventory.items.length ?? 0} carried`;
  }

  dispose(): void {
    this.world?.dispose();
    this.ui?.dispose();
    this.events.clear();
    delete (window as unknown as { __LOOTLAB__?: LootLab }).__LOOTLAB__;
  }
}

function dummyActor(id: number, position: Vector3): ActorLike {
  const none: HitResult = { total: 0, byType: {}, crit: false, killed: false, ailments: [] };
  return {
    id,
    faction: 'monster',
    stats: new StatSheet(),
    position,
    radius: 0.4,
    life: 1,
    mana: 0,
    alive: true,
    level: 1,
    takeHit: () => none,
    push: () => {},
  };
}
