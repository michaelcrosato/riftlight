import { type AmbientLight, Color, type DirectionalLight, Fog, Group, type Mesh, type Object3D, type Scene, Vector3 } from 'three/webgpu';
import type { AudioManager } from '../../engine/audio/AudioManager';
import type { Particles } from '../../engine/particles/Particles';
import { type Physics, RAPIER } from '../../engine/physics/Physics';
import type { LightHandle, LightPool, LightRequestOptions } from '../../engine/render/lights';
import { toonMaterial } from '../../engine/render/toon';
import type { Mod } from '../core/mods';
import { Rng } from '../core/rng';
import { type Rank, SCALING } from '../core/scaling';
import type { ActorLike, DamageType, GameEventBus, Hit, HitResult, LevelSpec, MechanicRuntime } from '../core/types';
import { LEVEL_PARTICLES, LEVEL_SOUNDS } from './fx';
import { buildGeometry, type LevelGeometry } from './layout/geometry';
import { FLOOR, type Layout, VOID } from './layout/grid';
import { MECHANICS } from './mechanics';
import { box, OctaGeo, mesh } from './mechanics/common';
import type { LevelEnv, LevelHooks, LevelMechanicDef, MechanicElement, MechanicLevel, MonsterSpawn } from './mechanics/types';
import { LevelNav } from './nav';
import { type Feature, type Pack, type LevelPlan, planLevel, SHRINES } from './plan';
import { glowMaterial, tint } from './themes/props';
import type { LevelTheme } from './themes/themes';

/**
 * The level runtime: `buildLevel(spec, ctx, hooks)` plans the level (layout, mechanics,
 * props, packs), builds its geometry, colliders, lights and mechanic runtimes, and returns a
 * `Level` the game drives with `fixedUpdate(dt)` (forces, falls) and `update(dt)` (mechanics,
 * encounters, chests, shrines, the exit portal, the minimap).
 *
 * Everything besides `scene`, `events` and `actors` is optional in the context, so a level
 * also builds headless (tests, tools) and in labs with placeholder actors.
 */
export interface LevelContext {
  /** Where the level's objects go (usually the engine scene). */
  readonly scene: Object3D;
  readonly events: GameEventBus;
  /** Every live actor (hero + monsters) the game simulates. */
  actors(): readonly ActorLike[];
  readonly physics?: Physics;
  readonly lights?: LightPool;
  readonly particles?: Particles;
  readonly audio?: AudioManager;
  /** Engine lighting the theme drives (background, fog, sun, ambient). */
  readonly world?: { readonly scene: Scene; readonly sun: DirectionalLight; readonly ambient: AmbientLight };
  /** Packs spawn when the hero comes this close (metres). Default 16. */
  readonly activation?: number;
}

export interface Encounter {
  readonly pack: Pack;
  spawned: boolean;
  readonly actors: ActorLike[];
}

export interface ExitPortal {
  readonly position: Vector3;
  open: boolean;
}

export interface MinimapData {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
  readonly explored: Uint8Array;
}

export interface Level {
  readonly spec: LevelSpec;
  readonly plan: LevelPlan;
  readonly theme: LevelTheme;
  readonly layout: Layout;
  readonly root: Group;
  readonly nav: LevelNav;
  readonly geometry: LevelGeometry;
  readonly mechanics: readonly { readonly def: LevelMechanicDef; readonly runtime: MechanicRuntime }[];
  readonly encounters: readonly Encounter[];
  readonly features: readonly Feature[];
  /** Hero start and the exit (world, on the floor). */
  readonly start: Vector3;
  readonly exitPortal: ExitPortal;
  readonly env: LevelEnv;
  /** The boss actor once spawned. */
  readonly boss: ActorLike | null;
  /** Boss dead: the portal is open and `levelClear` was emitted. */
  readonly cleared: boolean;
  /** Seconds since the level started. */
  readonly time: number;
  readonly minimap: MinimapData;
  /** Hittable world objects (braziers, pylons) for combat's hit queries. */
  targets(): readonly ActorLike[];
  /** Spawned monsters still alive. */
  monsters(): ActorLike[];
  isWalkable(x: number, z: number): boolean;
  raycastWalls(from: { x: number; z: number }, dir: { x: number; z: number }, max: number): number | null;
  fixedUpdate(dt: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** Build a playable level. See the file comment. */
export function buildLevel(spec: LevelSpec, ctx: LevelContext, hooks: LevelHooks): Level {
  return new LevelRuntime(planLevel(spec), ctx, hooks);
}

/** Build from an existing plan (tools that already planned it). */
export function buildLevelFromPlan(plan: LevelPlan, ctx: LevelContext, hooks: LevelHooks): Level {
  return new LevelRuntime(plan, ctx, hooks);
}

const tmpColor = new Color();

class LevelRuntime implements Level {
  readonly spec: LevelSpec;
  readonly theme: LevelTheme;
  readonly layout: Layout;
  readonly root = new Group();
  readonly nav: LevelNav;
  readonly geometry: LevelGeometry;
  readonly mechanics: { def: LevelMechanicDef; runtime: MechanicRuntime }[] = [];
  readonly encounters: Encounter[];
  readonly features: Feature[];
  readonly start: Vector3;
  readonly exitPortal: ExitPortal;
  readonly env: LevelEnv = { ambient: 1, sun: 1, tint: null, tintAmount: 0 };
  readonly minimap: MinimapData;
  boss: ActorLike | null = null;
  cleared = false;
  time = 0;
  private readonly rng: Rng;
  private readonly lightHandles: LightHandle[] = [];
  private readonly propTargets = new Set<ActorLike>();
  private readonly ranks = new Map<ActorLike, Rank>();
  private readonly buffs = new Map<string, { actor: ActorLike; source: string; until: number }>();
  private readonly offs: (() => void)[] = [];
  private readonly dynamicColliders = new Map<number, RAPIER.Collider>();
  private body: RAPIER.RigidBody | null = null;
  private readonly openedFeatures = new Set<Feature>();
  private readonly featureMeshes = new Map<Feature, { parts: Mesh[]; light: LightHandle | null }>();
  private portal!: { veil: Mesh[]; light: LightHandle | null };
  private exited = false;
  private lastSafe = new Vector3();
  private revealTimer = 0;
  private readonly mctx: MechanicLevel;

  constructor(
    readonly plan: LevelPlan,
    private readonly ctx: LevelContext,
    readonly hooks: LevelHooks,
  ) {
    this.spec = plan.spec;
    this.theme = plan.theme;
    this.layout = plan.layout;
    this.rng = new Rng(plan.spec.seed).fork('runtime');
    this.root.name = `level:${plan.spec.name}`;
    this.nav = new LevelNav(this.layout);
    this.features = [...plan.features];
    this.encounters = plan.packs.map((pack) => ({ pack, spawned: false, actors: [] }));
    const W = this.layout.width;
    this.minimap = { width: W, height: this.layout.height, cells: this.layout.cells, explored: new Uint8Array(W * this.layout.height) };
    this.start = new Vector3(this.layout.start.x + 0.5, 0, this.layout.start.z + 0.5);
    this.lastSafe.copy(this.start);
    this.exitPortal = { position: new Vector3(this.layout.exit.x + 0.5, 0, this.layout.exit.z + 0.5), open: false };

    // Effects as data.
    for (const [name, preset] of Object.entries(LEVEL_PARTICLES)) ctx.particles?.register(name, preset);
    for (const [name, def] of Object.entries(LEVEL_SOUNDS)) ctx.audio?.register(name, def);

    // Geometry + lights of emissive props.
    this.geometry = buildGeometry(plan);
    this.root.add(this.geometry.root);
    for (const g of this.geometry.glows) {
      const h = this.light({ position: g.position, color: g.color, intensity: g.intensity, radius: g.radius, flicker: g.flicker, name: g.kind });
      if (h) this.lightHandles.push(h);
    }
    this.buildColliders();
    this.buildFeatures();
    this.buildPortal();
    ctx.scene.add(this.root);

    // Mechanics.
    this.mctx = this.mechanicContext();
    for (const id of plan.spec.mechanics) {
      const def = MECHANICS.get(id);
      this.mechanics.push({ def, runtime: def.install(this.mctx) });
    }
    this.applyTheme();

    // Kills: boss → portal; rank bookkeeping.
    this.offs.push(
      ctx.events.on('kill', ({ target }) => {
        if (target === this.boss && !this.cleared) this.clear();
      }),
    );
  }

  // ------------------------------------------------------------------ public API

  targets(): readonly ActorLike[] {
    return [...this.propTargets];
  }

  monsters(): ActorLike[] {
    const out: ActorLike[] = [];
    for (const e of this.encounters) for (const a of e.actors) if (a.alive) out.push(a);
    return out;
  }

  isWalkable(x: number, z: number): boolean {
    return this.nav.isWalkable(x, z);
  }

  raycastWalls(from: { x: number; z: number }, dir: { x: number; z: number }, max: number): number | null {
    return this.nav.raycastWalls(from, dir, max);
  }

  fixedUpdate(dt: number): void {
    const actors = this.ctx.actors();
    for (const m of this.mechanics) if (m.runtime.affect) for (const a of actors) if (a.alive) m.runtime.affect(a, dt);
    // Falling into pits and voids.
    for (const a of actors) {
      if (!a.alive) continue;
      const c = this.layout.cell(Math.floor(a.position.x), Math.floor(a.position.z));
      if (c === FLOOR) {
        if (a.faction === 'hero') this.lastSafe.copy(a.position);
        continue;
      }
      if (c !== VOID) continue;
      if (this.hooks.onFall) this.hooks.onFall(a);
      else if (a.faction === 'hero') {
        // Default: lose some life and climb back where you last stood.
        const max = a.stats.get('life') || a.life;
        this.damage(a, { physical: max * 0.15 }, 'fall');
        a.position.copy(this.lastSafe);
      } else this.damage(a, { physical: 1e9 }, 'fall');
      this.emit('level', 'fall', a.position.clone());
    }
  }

  update(dt: number): void {
    this.time += dt;
    const hero = this.hero();
    if (hero) {
      this.nav.setTarget(hero.position);
      this.nav.update();
      this.activateEncounters(hero);
      this.touchFeatures(hero);
      this.touchPortal(hero);
      this.revealTimer -= dt;
      if (this.revealTimer <= 0) {
        this.revealTimer = 0.25;
        this.reveal(hero.position, 9);
      }
    }
    for (const m of this.mechanics) m.runtime.update?.(dt);
    // Expire timed buffs.
    for (const [k, b] of this.buffs) {
      if (b.until > this.time) continue;
      b.actor.stats.remove(b.source);
      this.buffs.delete(k);
    }
    this.animate();
    this.applyEnv();
  }

  dispose(): void {
    for (const m of this.mechanics) m.runtime.dispose?.();
    for (const off of this.offs) off();
    for (const h of this.lightHandles) h.release();
    for (const f of this.featureMeshes.values()) f.light?.release();
    this.portal?.light?.release();
    for (const b of this.buffs.values()) b.actor.stats.remove(b.source);
    this.buffs.clear();
    const physics = this.ctx.physics;
    if (physics && this.body) physics.world.removeRigidBody(this.body);
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------------ mechanics context

  hero(): ActorLike | null {
    for (const a of this.ctx.actors()) if (a.faction === 'hero' && a.alive) return a;
    return null;
  }

  private light(o: LightRequestOptions): LightHandle | null {
    return this.ctx.lights?.request(o) ?? null;
  }

  private emit(mechanic: string, event: string, at?: Vector3): void {
    this.ctx.events.emit('mechanic', { id: mechanic, event, at });
  }

  /** Apply mechanic damage through combat when available (see LevelHooks.applyHit). */
  damage(target: ActorLike, amounts: Partial<Record<DamageType, number>>, mechanic: string, extra: { knockback?: number; from?: Vector3; ailments?: Partial<Record<string, number>> } = {}): HitResult | null {
    if (!target.alive) return null;
    const hit: Hit = {
      source: null,
      skill: `mechanic:${mechanic}`,
      tags: ['mechanic', mechanic],
      damage: amounts,
      crit: false,
      ailments: extra.ailments as Hit['ailments'],
      knockback: extra.knockback,
      from: extra.from,
    };
    if (this.hooks.applyHit) return this.hooks.applyHit(target, hit);
    const result = target.takeHit(hit);
    this.ctx.events.emit('hit', { target, result, hit });
    if (result.killed) this.ctx.events.emit('kill', { target, killer: null, rank: this.ranks.get(target) ?? 'normal', depth: this.spec.depth });
    return result;
  }

  private mechanicContext(): MechanicLevel {
    const byMechanic = new Map<string, MechanicElement[]>();
    for (const e of this.plan.elements) {
      const list = byMechanic.get(e.mechanic) ?? [];
      list.push(e);
      byMechanic.set(e.mechanic, list);
    }
    return {
      rng: this.rng.fork('mechanics'),
      depth: this.spec.depth,
      layout: this.layout,
      scene: this.root,
      root: this.root,
      events: this.ctx.events,
      theme: this.theme,
      hooks: this.hooks,
      env: this.env,
      elements: this.plan.elements,
      actors: () => this.ctx.actors(),
      elementsOf: (id) => byMechanic.get(id) ?? [],
      time: () => this.time,
      hero: () => this.hero(),
      light: (o) => this.light(o),
      burst: (preset, at, o) => {
        this.ctx.particles?.burst(preset, at, o as Parameters<Particles['burst']>[2]);
      },
      sound: (name, o) => {
        this.ctx.audio?.play(name, o);
      },
      emit: (m, e, at) => this.emit(m, e, at),
      addTarget: (t) => this.propTargets.add(t),
      removeTarget: (t) => this.propTargets.delete(t),
      setCell: (x, z, v) => this.setCell(x, z, v),
      isWalkable: (x, z) => this.isWalkable(x, z),
      damage: (t, a, m, e) => this.damage(t, a, m, e),
      buff: (actor, source, mods, seconds) => this.buff(actor, source, mods, seconds),
    };
  }

  private buff(actor: ActorLike, source: string, mods: readonly Mod[], seconds: number): void {
    actor.stats.set(source, mods);
    this.buffs.set(`${actor.id}:${source}`, { actor, source, until: this.time + seconds });
  }

  /** Runtime grid change (Collapse): nav follows via layout.version; colliders too. */
  private setCell(x: number, z: number, v: number): void {
    this.layout.set(x, z, v);
    const i = z * this.layout.width + x;
    const c = this.dynamicColliders.get(i);
    if (c && v !== FLOOR && this.ctx.physics) {
      this.ctx.physics.world.removeCollider(c, true);
      this.dynamicColliders.delete(i);
    }
  }

  // ------------------------------------------------------------------ building

  private buildColliders(): void {
    const physics = this.ctx.physics;
    if (!physics) return;
    // One fixed body, a compound of greedy-merged boxes (+ one box per crumbling cell).
    const rapier = RAPIER;
    const world = physics.world;
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
    this.body = body;
    const { walls, floors, dynamic } = this.geometry.colliders;
    for (const b of [...walls, ...floors]) world.createCollider(rapier.ColliderDesc.cuboid(...b.half).setTranslation(...b.center), body);
    for (const b of dynamic) this.dynamicColliders.set(b.cell, world.createCollider(rapier.ColliderDesc.cuboid(...b.half).setTranslation(...b.center), body));
  }

  private buildFeatures(): void {
    const wood = toonMaterial(0x8a5a3a);
    const iron = toonMaterial(tint(this.theme.palette.wall, -0.1));
    const gold = toonMaterial(0xffcd75);
    const stone = toonMaterial(tint(this.theme.palette.wall, 0.25));
    for (const f of this.features) {
      let parts: Mesh[];
      let light: LightHandle | null;
      if (f.kind === 'chest') {
        const r = f.rarity === 'rare' ? 0xffcd75 : 0x41a6f6;
        parts = [box(wood, f.x, 0.3, f.z, 0.9, 0.6, 0.6), box(iron, f.x, 0.3, f.z, 0.94, 0.12, 0.64), box(wood, f.x, 0.68, f.z, 0.9, 0.18, 0.6), box(gold, f.x, 0.45, f.z + 0.31, 0.16, 0.18, 0.06)];
        light = this.light({ position: [f.x, 1.2, f.z], color: r, intensity: 2.2, radius: 3.5, flicker: 'pulse', priority: 1.5, name: 'chest' });
      } else {
        const def = SHRINES.get(f.shrine!);
        const orb = mesh(OctaGeo, glowMaterial(def.color), f.x, 1.55, f.z, 0.55);
        orb.castShadow = false;
        parts = [box(stone, f.x, 0.15, f.z, 1.3, 0.3, 1.3), box(stone, f.x, 0.6, f.z, 0.5, 0.9, 0.5), box(toonMaterial(this.theme.trim), f.x, 1.1, f.z, 0.8, 0.14, 0.8), orb];
        light = this.light({ position: [f.x, 1.6, f.z], color: def.color, intensity: 4, radius: 6, flicker: 'pulse', priority: 1.5, name: 'shrine' });
      }
      for (const p of parts) {
        p.name = `feature:${f.kind}`;
        this.root.add(p);
      }
      this.featureMeshes.set(f, { parts, light });
    }
  }

  private buildPortal(): void {
    const p = this.exitPortal.position;
    const stone = toonMaterial(tint(this.theme.palette.wall, 0.3));
    const ring = toonMaterial(this.theme.trim);
    const parts = [box(ring, p.x, 0.05, p.z, 2.4, 0.1, 2.4, Math.PI / 4), box(stone, p.x - 1, 1.2, p.z + 1, 0.4, 2.4, 0.4), box(stone, p.x + 1, 1.2, p.z - 1, 0.4, 2.4, 0.4), box(stone, p.x, 2.5, p.z, 3.2, 0.36, 0.5, Math.PI / 4)];
    for (const m of parts) {
      m.name = 'level:portal';
      this.root.add(m);
    }
    const veil = [box(glowMaterial(0x73eff7), p.x, 1.2, p.z, 2.3, 2.2, 0.08, Math.PI / 4), box(glowMaterial(0xf4f4f4), p.x, 1.2, p.z, 1.3, 1.6, 0.1, Math.PI / 4)];
    for (const v of veil) {
      v.visible = false;
      v.castShadow = false;
      v.name = 'level:portal-veil';
      this.root.add(v);
    }
    this.portal = { veil, light: null };
    // A rune ring where the hero starts.
    const s = this.start;
    const rune = box(toonMaterial(tint(this.theme.trim, -0.1)), s.x, 0.03, s.z, 1.8, 0.06, 1.8, Math.PI / 4);
    rune.name = 'level:entrance';
    this.root.add(rune);
  }

  // ------------------------------------------------------------------ per frame

  private activateEncounters(hero: ActorLike): void {
    const reach = this.ctx.activation ?? 16;
    const heroRoom = this.layout.roomAt(Math.floor(hero.position.x), Math.floor(hero.position.z));
    for (const e of this.encounters) {
      if (e.spawned) continue;
      const m0 = e.pack.members[0]!;
      const near = Math.hypot(hero.position.x - m0.x, hero.position.z - m0.z) < reach;
      if (!near && heroRoom?.id !== e.pack.room) continue;
      e.spawned = true;
      const level = SCALING.monsterLevel(this.spec.depth);
      for (const m of e.pack.members) {
        const spawn: MonsterSpawn = {
          archetype: e.pack.archetype,
          rank: m.rank,
          position: new Vector3(m.x, 0, m.z),
          level,
          depth: this.spec.depth,
          pack: e.pack.id,
          room: e.pack.room,
          genome: m.rank === 'boss' ? this.spec.boss : null,
          eliteBudget: m.rank === 'normal' ? 0 : SCALING.eliteBudget(this.spec.depth) * (m.rank === 'boss' ? 2 : m.rank === 'rare' ? 1 : 0.5),
        };
        const actor = this.hooks.spawnMonster(spawn);
        if (!actor) continue;
        e.actors.push(actor);
        this.ranks.set(actor, m.rank);
        if (m.rank === 'boss') this.boss = actor;
      }
      this.emit('level', e.pack.rank === 'boss' ? 'bossSpawn' : 'packSpawn', new Vector3(m0.x, 0, m0.z));
    }
  }

  private touchFeatures(hero: ActorLike): void {
    for (const f of this.features) {
      if (this.openedFeatures.has(f) || Math.hypot(hero.position.x - f.x, hero.position.z - f.z) > 1.4) continue;
      this.openedFeatures.add(f);
      const vis = this.featureMeshes.get(f);
      const at = new Vector3(f.x, 0.8, f.z);
      if (f.kind === 'chest') {
        if (vis) vis.parts[2]!.rotation.x = -1.1; // lid pops open
        this.hooks.dropLoot?.(at, { rarity: f.rarity ?? 'magic', quantity: f.rarity === 'rare' ? 3 : 2, itemLevel: SCALING.monsterLevel(this.spec.depth), source: 'chest' });
        this.ctx.particles?.burst('loot', at);
        this.ctx.audio?.play('chest');
        this.emit('chest', 'open', at);
      } else {
        const def = SHRINES.get(f.shrine!);
        this.buff(hero, `shrine:${def.id}`, def.mods, def.duration);
        if (vis) vis.parts[3]!.visible = false;
        vis?.light?.update({ intensity: 1 });
        this.ctx.particles?.burst('haste', at, { count: 18 });
        this.ctx.audio?.play('shrine');
        this.emit('shrine', def.id, at);
      }
    }
  }

  private touchPortal(hero: ActorLike): void {
    if (!this.exitPortal.open || this.exited) return;
    if (Math.hypot(hero.position.x - this.exitPortal.position.x, hero.position.z - this.exitPortal.position.z) > 1.1) return;
    this.exited = true;
    this.emit('level', 'exit', this.exitPortal.position.clone());
    this.hooks.onExit?.();
  }

  /** The boss died: open the exit portal, emit `levelClear`. */
  private clear(): void {
    this.cleared = true;
    this.exitPortal.open = true;
    for (const v of this.portal.veil) v.visible = true;
    const p = this.exitPortal.position;
    this.portal.light = this.light({ position: [p.x, 1.4, p.z], color: 0x73eff7, intensity: 8, radius: 8, flicker: 'spell', priority: 5, fadeIn: 0.8, name: 'portal' });
    this.ctx.particles?.burst('portal', [p.x, 0.5, p.z], { count: 30 });
    this.ctx.audio?.play('portal-open');
    this.emit('level', 'portalOpen', p.clone());
    this.ctx.events.emit('levelClear', { depth: this.spec.depth, time: this.time });
  }

  private animate(): void {
    if (this.exitPortal.open) {
      const s = 1 + 0.06 * Math.sin(this.time * 6);
      this.portal.veil[1]!.scale.set(1.3 * s, 1.6 * s, 0.1);
      if (this.rng.next() < 0.15) {
        const p = this.exitPortal.position;
        this.ctx.particles?.burst('portal', [p.x, 0.2, p.z], { count: 3 });
      }
    }
  }

  /** Mark cells within `r` of a position as explored (minimap). */
  private reveal(p: Vector3, r: number): void {
    const W = this.layout.width;
    const x0 = Math.floor(p.x);
    const z0 = Math.floor(p.z);
    const ex = this.minimap.explored;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const x = x0 + dx;
        const z = z0 + dz;
        if (this.layout.inBounds(x, z)) ex[z * W + x] = 1;
      }
  }

  // ------------------------------------------------------------------ theme lighting

  private applyTheme(): void {
    const w = this.ctx.world;
    if (!w) return;
    const t = this.theme;
    w.scene.background = new Color(t.palette.sky);
    // The ortho camera sits 40 m from its focus: fog starts a little past the focus, so
    // pits, voids and the far edge of the screen sink into the theme's fog.
    w.scene.fog = new Fog(t.palette.fog, 40 + t.fog.near, 40 + t.fog.far);
    this.applyEnv();
  }

  private applyEnv(): void {
    const w = this.ctx.world;
    if (!w) return;
    const t = this.theme;
    const e = this.env;
    w.sun.color.setHex(t.sun);
    w.ambient.color.setHex(t.ambient);
    if (e.tint !== null && e.tintAmount > 0) {
      tmpColor.setHex(e.tint);
      w.sun.color.lerp(tmpColor, e.tintAmount);
      w.ambient.color.lerp(tmpColor, e.tintAmount);
      const fog = w.scene.fog as Fog | null;
      fog?.color.setHex(t.palette.fog).lerp(tmpColor, e.tintAmount * 0.5);
    }
    w.sun.intensity = t.sunIntensity * e.sun;
    w.ambient.intensity = t.ambientIntensity * e.ambient;
  }
}

export type { LevelHooks, MonsterSpawn, MechanicLevel, LevelEnv } from './mechanics/types';
