import { Group, type Mesh, Vector3 } from 'three/webgpu';
import type { GameContext, Song } from '../../engine';
import { Actor } from '../actors/Actor';
import { more, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import type { Rank } from '../core/scaling';
import type { ActorLike, Genome, Hit, LevelSpec, Rarity } from '../core/types';
import type { BossView, KillInfo, LevelDeps, LevelHandle, LevelPort, MechanicInfo, MonsterHandle, ShellServices, Telegraph } from '../game/ports';
import { buildLevel, type Level, type LevelHooks, type MonsterSpawn } from '../levels/Level';
import { FLOOR, VOID, WALL } from '../levels/layout/grid';
import { MECHANIC_ORDER, MECHANICS } from '../levels/mechanics';
import { levelSpec } from '../levels/rift';
import { ARCHETYPES, BOSS_ATTACKS, type BossDef, type BrainWorld, buildMonster, designedBoss, generateBoss, generateGenome, genomeBudget, Pack, PLANS, type MonsterEvent } from '../monsters';
import type { Slot } from '../monsters/types';
import type { ResolvedSkill } from '../skills/types';
import { RealHero } from './hero';
import { Globes } from './globes';
import { Hazards, type HazardHost } from './hazards';
import { MECHANIC_TAGS, type MonsterHost, MonsterUnit, registerBoss } from './monsters';
import { themeSongs } from './music';
import type { GridStage } from './stage';
import { WIRE_TUNING } from './tuning';
import { CombatWorld, isProp, PropActor, type Worlds } from './world';

/** Adds alive at once per level (summoners, splitters and bosses can't flood it). */
const MAX_ADDS = 30;

/**
 * One level, live: R5's `Level` (layout, geometry, mechanics, encounters, chests, shrines,
 * the portal, the minimap) on the stage's combat world, with every monster a real
 * `MonsterUnit`. It is the shell's `LevelHandle`, the monsters' `MonsterHost`, the hazard
 * stager's host and a `GridStage` for movers.
 *
 * Loading spawns every pack up front (with their clips compiled, `eager`), so a fight never
 * builds a monster, compiles a clip or a shader: the level is complete while the loading
 * screen shows. Kills drop loot through the LootPort; chests and Collapse caches too.
 */
export class LevelStage implements LevelHandle, GridStage, MonsterHost, HazardHost {
  readonly kind = 'level' as const;
  readonly root = new Group();
  readonly origin = { x: 0, z: 0 };
  readonly level: Level;
  readonly world: CombatWorld;
  readonly hazards: Hazards;
  readonly globes: Globes;
  readonly services: ShellServices;
  readonly ctx: GameContext;
  readonly depth: number;
  readonly rng: Rng;
  readonly brainWorld: BrainWorld;
  readonly songs?: { level: Song; combat: Song; boss: Song };
  loading = true;
  private readonly list: MonsterUnit[] = [];
  private readonly byActor = new Map<ActorLike, MonsterUnit>();
  private readonly props = new Map<ActorLike, PropActor>();
  private bossUnit: MonsterUnit | null = null;
  private killed = 0;
  private total = 0;
  private preHero: ActorLike | null = null;
  private readonly lastSafe = new Vector3();
  private readonly packGenomes = new Map<number, Genome>();
  private readonly packMembers = new Map<number, number>();
  private readonly addGenomes = new Map<string, Genome>();
  private readonly offs: (() => void)[] = [];
  private readonly tags: readonly string[];
  private warm: Mesh[] = [];
  private warmFrames = 0;
  private addedFilters: string[] = [];
  private hero: RealHero | null;

  constructor(
    readonly spec: LevelSpec,
    private readonly deps: LevelDeps,
    private readonly worlds: Worlds,
  ) {
    this.services = deps.services;
    this.ctx = deps.services.ctx;
    this.depth = spec.depth;
    this.rng = new Rng(spec.seed).fork(`stage:${deps.services.rng.int(1, 1e9)}`);
    this.hero = deps.hero instanceof RealHero ? deps.hero : null;
    this.root.name = `level:${spec.depth}:${spec.name}`;
    this.tags = [...new Set(spec.mechanics.flatMap((m) => MECHANIC_TAGS[m] ?? []))].slice(0, 2);
    // the combat world first, so the level can hand it hits from the start
    this.world = new CombatWorld({ services: this.services, root: this.root, depth: spec.depth, wall: (from, to) => this.wall(from, to) });
    this.world.host = this;
    this.worlds.set(this, this.world);
    const actors = this.world.actors;
    this.brainWorld = {
      get time() {
        return actors.time;
      },
      rng: this.rng.fork('brains'),
      enemies: (of, r) => actors.query(of.position, r, [], (x) => x.alive && !isProp(x) && (of as Actor).hostileTo(x)),
      allies: (of, r) => this.list.filter((u) => u.actor !== of && u.actor.alive && u.actor.position.distanceTo(of.position) < r).map((u) => u.brain),
    };
    this.hazards = new Hazards(this);
    this.globes = new Globes(this.root, this.ctx, this.rng.fork('globes'));
    const ctx = this.ctx;
    this.level = buildLevel(
      spec,
      {
        scene: this.root,
        events: this.services.events,
        actors: () => this.levelActors(),
        lights: ctx.lights,
        particles: ctx.particles,
        audio: ctx.audio,
        world: { scene: ctx.scene, sun: ctx.engine.sun, ambient: ctx.engine.ambient },
        activation: 1e9, // everything spawns while loading (see load)
      },
      this.hooks(),
    );
    this.lastSafe.copy(this.level.start);
    this.songs = themeSongs(this.level.theme.song);
    this.listen();
  }

  // ------------------------------------------------------------- LevelHandle

  get layout() {
    return this.level.layout;
  }

  get start(): Vector3 {
    return this.level.start;
  }

  get exit(): Vector3 {
    return this.level.exitPortal.position;
  }

  get exitOpen(): boolean {
    return this.level.exitPortal.open;
  }

  /** Spawn every pack now (the loading screen), compile their clips, warm their shaders. */
  async load(): Promise<void> {
    this.preHero = { id: -1, faction: 'hero', stats: new StatSheet({ 'light.radius': 1 }), position: this.level.start.clone(), radius: 0.35, life: 1, mana: 0, alive: true, level: 1, takeHit: () => ({ total: 0, byType: {}, crit: false, killed: false, ailments: [] }), push: () => {} };
    this.level.update(0);
    this.preHero = null;
    this.makePacks();
    this.preloadAdds();
    this.loading = false;
    this.syncProps();
    // theme filters on top of the player's look
    const e = this.ctx.engine;
    const want = (this.level.theme.filters ?? []).filter((f) => !e.filters.includes(f) && e.availableFilters.includes(f));
    if (want.length) {
      this.addedFilters = want;
      e.setFilters([...e.filters, ...want]);
    }
    // the first frame draws every monster once (shaders built now, not when one walks into view)
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.frustumCulled) return;
      m.frustumCulled = false;
      this.warm.push(m);
    });
    this.warmFrames = 2;
  }

  progress(): { killed: number; total: number } {
    return { killed: this.killed, total: this.total };
  }

  boss(): BossView | null {
    const b = this.bossUnit;
    if (!b || !b.boss) return null;
    const a = b.actor;
    const hero = this.heroActor();
    if (a.alive && a.life >= a.maxLife && hero && a.position.distanceTo(hero.position) > 16) return null;
    return { name: b.name, life: a.life, maxLife: a.maxLife, phases: b.boss.phases.slice(1).map((p) => p.from), phase: b.phase, position: a.position };
  }

  explored(): Uint8Array {
    return this.level.minimap.explored;
  }

  telegraphs(): readonly Telegraph[] {
    const out: Telegraph[] = [];
    for (const u of this.list) {
      const t = u.actor.alive ? u.telegraph() : null;
      if (t) out.push(t);
    }
    out.push(...this.hazards.telegraphs());
    return out;
  }

  monsters(): readonly MonsterHandle[] {
    return this.list.filter((u) => u.actor.alive);
  }

  actors(): readonly ActorLike[] {
    return this.list.map((u) => u.actor);
  }

  spawn(seed: number, at: Vector3, rank: Rank = 'normal'): MonsterHandle {
    const genome = this.deps.monsters.genome(seed, this.depth, rank, this.spec.archetypes);
    const u = this.build(genome, at, { boss: null, add: false });
    u.brain.home.copy(at);
    return u;
  }

  collide(p: Vector3, radius: number): void {
    const L = this.layout;
    if (L.cell(Math.floor(p.x), Math.floor(p.z)) !== FLOOR) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.floor(p.x) + dx;
          const z = Math.floor(p.z) + dz;
          if (L.cell(x, z) !== FLOOR) continue;
          const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
          if (d < bd) {
            bd = d;
            best = [x, z];
          }
        }
      if (best) {
        p.x = Math.max(best[0] + radius, Math.min(best[0] + 1 - radius, p.x));
        p.z = Math.max(best[1] + radius, Math.min(best[1] + 1 - radius, p.z));
      }
    }
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (L.cell(x, z) === FLOOR) continue;
        const nx = Math.max(x, Math.min(x + 1, p.x));
        const nz = Math.max(z, Math.min(z + 1, p.z));
        const ox = p.x - nx;
        const oz = p.z - nz;
        const d = Math.hypot(ox, oz);
        if (d >= radius || d < 1e-6) continue;
        p.x = nx + (ox / d) * radius;
        p.z = nz + (oz / d) * radius;
      }
  }

  groundY(): number {
    return 0;
  }

  walkable(x: number, z: number, pushed: boolean): boolean {
    const c = this.layout.cell(Math.floor(x), Math.floor(z));
    return c === FLOOR || (pushed && c === VOID);
  }

  /** Health globes on the floor (the bot heads for them when hurt). */
  pickups(): readonly Vector3[] {
    return this.globes.positions();
  }

  /** Shrine and mechanic buffs on an actor (the hero's buff bar). */
  timedBuffs(actor: ActorLike): { source: string; remaining: number }[] {
    return this.level.timedBuffs(actor);
  }

  get nav() {
    return this.level.nav;
  }

  get stage(): GridStage {
    return this;
  }

  heroActor(): Actor | null {
    return this.world.heroActor;
  }

  focus(): Vector3 {
    return this.ctx.engine.camera.focus;
  }

  shake(strength: number, seconds?: number): void {
    this.services.shake(strength, seconds);
  }

  monsterEvent(unit: MonsterUnit, e: MonsterEvent): void {
    this.hazards.handle(unit, e);
  }

  /** Every monster of the level, dead ones until their corpse is gone (hazards: corpse novas). */
  units(): readonly MonsterUnit[] {
    return this.list;
  }

  // ------------------------------------------------------------- per step / frame

  fixedUpdate(dt: number): void {
    this.syncProps();
    this.world.fixedUpdate(dt);
    this.hazards.fixedUpdate(dt);
    this.globes.fixedUpdate(dt, this.heroActor());
    this.level.fixedUpdate(dt);
    const h = this.heroActor();
    // a fall puts the hero back here: solid floor only (a crumbling Collapse tile under the
    // hero would drop it again and again)
    if (h && h.alive) {
      const x = Math.floor(h.position.x);
      const z = Math.floor(h.position.z);
      if (this.layout.cell(x, z) === FLOOR && !this.level.plan.dynamicFloor[z * this.layout.width + x]) this.lastSafe.copy(h.position);
    }
  }

  update(dt: number): void {
    this.world.update(dt, this.ctx.physics.alpha);
    this.hazards.update(dt);
    this.globes.update(this.level.time);
    this.level.update(dt);
    // corpses that finished sinking left the combat world
    for (let i = this.list.length - 1; i >= 0; i--) {
      const u = this.list[i]!;
      if (!u.actor.gone) continue;
      u.dispose();
      this.byActor.delete(u.actor);
      this.list.splice(i, 1);
    }
    if (this.warmFrames > 0 && --this.warmFrames === 0) {
      for (const m of this.warm) m.frustumCulled = true;
      this.warm = [];
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.hazards.dispose();
    this.globes.dispose();
    for (const u of this.list) u.dispose();
    this.list.length = 0;
    this.world.dispose(); // monsters' bodies leave the root before the level frees its own meshes
    this.worlds.delete(this);
    this.level.dispose();
    if (this.addedFilters.length) {
      const e = this.ctx.engine;
      e.setFilters(e.filters.filter((f) => !this.addedFilters.includes(f)));
    }
    this.root.removeFromParent();
  }

  // ------------------------------------------------------------- internals

  private levelActors(): readonly ActorLike[] {
    if (this.preHero) return [this.preHero];
    return this.world.actors.actors.filter((a) => !isProp(a));
  }

  /**
   * Walls between two points, as the fraction of the way where the line goes into one. A line
   * must run 0.25 m inside a wall to count, so grazing a corner between two diagonal floor
   * cells doesn't stop a sword or a fireball (pits never block).
   */
  private wall(from: Vector3, to: Vector3): number | null {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return null;
    const L = this.layout;
    const n = Math.ceil(len / 0.08);
    let inside = 0;
    for (let k = 1; k < n; k++) {
      const f = k / n;
      if (L.cell(Math.floor(from.x + dx * f), Math.floor(from.z + dz * f)) === WALL) {
        if (++inside * (len / n) >= 0.25) return Math.max(0, f - (inside * (len / n)) / len);
      } else inside = 0;
    }
    return null;
  }

  /** Level props (braziers, pylons) join the combat world as `PropActor`s. */
  private syncProps(): void {
    const targets = this.level.targets();
    for (const t of targets) {
      if (this.props.has(t)) continue;
      const p = new PropActor(t);
      this.props.set(t, p);
      this.world.actors.add(p);
    }
    if (this.props.size > targets.length)
      for (const [t, p] of this.props) {
        if (targets.includes(t)) continue;
        this.props.delete(t);
        const i = this.world.actors.actors.indexOf(p);
        if (i >= 0) this.world.actors.actors.splice(i, 1);
      }
  }

  private hooks(): LevelHooks {
    return {
      spawnMonster: (s) => this.spawnFromPlan(s),
      applyHit: (target, hit) => this.applyHit(target, hit),
      replaySkill: (actor, skill, o) => this.replay(actor, skill, o),
      teleport: (actor, to) => {
        if (actor instanceof Actor) {
          actor.mover.teleport(to.x, 0, to.z);
          actor.position.copy(actor.mover.position);
          actor.impulse.set(0, 0, 0);
        } else actor.position.copy(to);
      },
      dropLoot: (at, o) => this.dropLoot(at, o),
      onExit: () => {},
      onFall: (a) => this.fall(a),
    };
  }

  private applyHit(target: ActorLike, hit: Hit) {
    // combat actors announce their own hits, deaths and kills
    const result = target.takeHit(hit);
    if (!(target instanceof Actor)) {
      this.services.events.emit('hit', { target, result, hit });
      if (result.killed) this.services.events.emit('kill', { target, killer: hit.source, rank: 'normal', depth: this.depth });
    }
    return result;
  }

  private fall(a: ActorLike): void {
    if (!(a instanceof Actor)) return;
    if (a.faction === 'hero') {
      // `collapse.fallImmune` (Collapse Runner, Featherfall Sash): climb back out unhurt
      if (!a.stats.has('collapse.fallImmune')) this.applyHit(a, { source: null, skill: 'fall', tags: ['fall', 'physical'], damage: { physical: a.maxLife * 0.15 }, crit: false });
      a.mover.teleport(this.lastSafe.x, 0, this.lastSafe.z);
      a.position.copy(a.mover.position);
      a.impulse.set(0, 0, 0);
      this.ctx.particles.burst('dust', a.position.clone().setY(0.2), { count: 10 });
    } else {
      a.die(this.heroActor());
      a.gone = true; // into the void: no corpse
    }
  }

  private listen(): void {
    const ev = this.services.events;
    this.offs.push(
      ev.on('hit', ({ target, result, hit }) => {
        const u = this.byActor.get(target);
        if (u) u.onHit(result, hit.source, hit.tags);
        const s = hit.source ? this.byActor.get(hit.source) : null;
        if (s && result.total > 0) s.onDealt(result);
      }),
      ev.on('death', ({ actor }) => this.byActor.get(actor)?.onDeath()),
      ev.on('kill', ({ target, rank }) => {
        const u = this.byActor.get(target);
        if (!u) return;
        this.killed++;
        if (u.add) return;
        this.globes.drop(rank, target.position);
        this.drop({ depth: this.depth, rank, level: target.level, at: target.position.clone() }, `kill:${target.id}`);
      }),
    );
  }

  /** Roll and spawn drops for a kill (or a chest) through the LootPort. */
  private drop(info: KillInfo, key: string): void {
    const s = this.heroActor()?.stats;
    const frac = (stat: string) => (s ? Math.max(-0.9, s.get(stat) - 1) : 0);
    const full: KillInfo = { ...info, itemRarity: frac('item.rarity'), itemQuantity: frac('item.quantity'), goldFind: frac('gold.find') };
    const rng = this.services.rng.fork(`drop:${key}`);
    const drops = this.deps.loot.rollDrops(full, rng);
    if (drops.length) this.deps.loot.spawn(drops, info.at, this, rng);
  }

  private dropLoot(at: Vector3, o: { rarity: Rarity; quantity: number; itemLevel: number; source: string }): void {
    const rank: Rank = o.rarity === 'rare' || o.rarity === 'unique' ? 'rare' : o.rarity === 'magic' ? 'magic' : 'normal';
    for (let i = 0; i < Math.max(1, o.quantity); i++) this.drop({ depth: this.depth, rank, level: o.itemLevel, at: at.clone(), source: o.source }, `${o.source}:${at.x.toFixed(1)}:${at.z.toFixed(1)}:${i}`);
  }

  /** Echoes: the hero's skill again, from where it was cast, at a share of its damage. */
  private replay(actor: ActorLike, skillId: string, o: { at: Vector3; facing: Vector3 | null; damageScale: number }): void {
    const hc = this.hero?.hc;
    if (!hc || actor !== hc.actor || !hc.actor.alive) return;
    const s = [hc.basic, ...hc.slots].find((x): x is ResolvedSkill => !!x && x.id === skillId);
    if (!s || s.placement || s.tags.includes('movement') || s.def.leap || s.def.teleport || s.channel || s.delivery.kind === 'summon' || s.delivery.kind === 'aura') return;
    const echo: ResolvedSkill = { ...s, id: `echo:${s.id}`, mods: [...s.mods, more('damage', o.damageScale - 1)] };
    const a = hc.actor;
    const foe = this.world.actors.nearest(o.at, 9, (x) => x.alive && a.hostileTo(x) && !isProp(x));
    const aim = foe ? foe.position.clone() : o.facing ? o.at.clone().add(o.facing) : o.at.clone().add(new Vector3(Math.sin(a.facing), 0, Math.cos(a.facing)));
    const saved = a.position.clone();
    a.position.set(o.at.x, a.position.y, o.at.z);
    this.world.combat.cast(a, echo, aim);
    a.position.copy(saved);
  }

  // ------------------------------------------------------------- monsters

  private spawnFromPlan(s: MonsterSpawn): ActorLike | null {
    if (s.rank === 'boss') {
      const def: BossDef = this.depth <= 12 ? designedBoss(this.depth) : generateBoss(this.rng.fork('boss'), this.depth, this.spec.mechanics);
      const u = this.build(registerBoss(def), s.position, { boss: def, add: false });
      this.bossUnit = u;
      return u.actor;
    }
    const u = this.build(this.packGenome(s), s.position, { boss: null, add: false });
    (u as { pack?: number }).pack = s.pack;
    return u.actor;
  }

  /** One body shape per pack (shared clips); elites keep it and roll their rank's mods. */
  private packGenome(s: MonsterSpawn): Genome {
    const floor = this.level.theme.palette.floor;
    let base = this.packGenomes.get(s.pack);
    if (!base) {
      base = generateGenome(this.rng.fork(`pack:${s.pack}`), { depth: this.depth, tags: this.tags, archetype: ARCHETYPES.has(s.archetype) ? s.archetype : undefined, rank: 'normal', floor, budget: genomeBudget(this.depth) + s.power * 0.5 });
      this.packGenomes.set(s.pack, base);
    }
    const i = (this.packMembers.get(s.pack) ?? 0) + 1;
    this.packMembers.set(s.pack, i);
    const r = this.rng.fork(`pack:${s.pack}:${i}`);
    if (s.rank === 'normal') return { ...base, seed: r.int(1, 0x7fffffff), scale: Math.round(base.scale * r.range(0.93, 1.07) * 1000) / 1000 };
    const parts: Partial<Record<Slot, string | null>> = {};
    for (const slot of Object.keys(PLANS.get(base.plan).slots) as Slot[]) parts[slot] = base.parts.find((p) => p.socket === slot)?.part ?? null;
    return generateGenome(r, { depth: this.depth, tags: this.tags, archetype: base.archetype, rank: s.rank, plan: base.plan, genes: base.genes, parts, floor });
  }

  private build(genome: Genome, at: Vector3, o: { boss: BossDef | null; add: boolean }): MonsterUnit {
    const handle = this.deps.monsters.build(genome, { services: this.services, stage: this, at: at.clone(), depth: this.depth, mods: { difficulty: this.services.difficultyMods('enemy') }, add: o.add } as Parameters<LevelDeps['monsters']['build']>[1]);
    if (!(handle instanceof MonsterUnit)) throw new Error('Riftlight: real levels need the real MonsterPort (src/riftlight/wire)');
    this.list.push(handle);
    this.byActor.set(handle.actor, handle);
    this.total++;
    return handle;
  }

  /** Followers flank, alerts spread: one `Pack` per encounter. */
  private makePacks(): void {
    const by = new Map<number, MonsterUnit[]>();
    for (const u of this.list) {
      const p = (u as { pack?: number }).pack;
      if (p === undefined || u.boss) continue;
      const list = by.get(p) ?? [];
      list.push(u);
      by.set(p, list);
    }
    for (const list of by.values()) if (list.length > 1) new Pack(list.map((u) => u.brain));
  }

  /** Genome for an add of `archetype`, in the caller's colours (materials already built). */
  private addGenome(archetype: string, from: Genome): Genome {
    let g = this.addGenomes.get(archetype);
    if (!g) {
      g = generateGenome(this.rng.fork(`add:${archetype}`), { depth: this.depth, tags: this.tags, archetype: ARCHETYPES.has(archetype) ? archetype : 'swarm', rank: 'normal', floor: this.level.theme.palette.floor, scale: WIRE_TUNING.monster.addScale });
      this.addGenomes.set(archetype, g);
    }
    return { ...g, palette: from.palette, seed: this.rng.int(1, 0x7fffffff) };
  }

  /** Build every add body a fight may call for now, so their clips exist before the fight. */
  private preloadAdds(): void {
    const kinds = new Set<string>();
    const hasSummoner = this.list.some((u) => u.built.skills.includes('summon') || u.genome.elite.includes('necromancer'));
    if (hasSummoner) kinds.add('swarm');
    for (const u of this.list) {
      if (!u.boss) continue;
      for (const p of u.boss.phases)
        for (const id of [...p.attacks, ...(p.onEnter ?? [])]) {
          const a = BOSS_ATTACKS.get(id);
          if (a.pattern === 'summon') kinds.add(typeof a.params.archetype === 'string' ? a.params.archetype : 'swarm');
        }
    }
    const palette = this.list[0]?.genome;
    for (const k of kinds) if (palette) buildMonster(this.addGenome(k, palette), { eager: true }); // clips are cached per body shape
  }

  spawnAdds(from: MonsterUnit, o: { count: number; archetype?: string; scale?: number; mode: 'summon' | 'split' | 'clone'; at: Vector3 }): void {
    const alive = this.list.filter((u) => u.add && u.actor.alive).length;
    const n = Math.min(o.count, MAX_ADDS - alive);
    const hero = this.heroActor();
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
      let at: Vector3 | null = null;
      for (const r of [1.6, 2.4, 1, 3.2]) {
        const p = new Vector3(o.at.x + Math.sin(a) * r, 0, o.at.z + Math.cos(a) * r);
        if (this.walkable(p.x, p.z, false)) {
          at = p;
          break;
        }
      }
      if (!at) continue;
      const g = from.genome;
      const genome: Genome =
        o.mode === 'summon'
          ? this.addGenome(o.archetype ?? 'swarm', g)
          : { ...g, seed: this.rng.int(1, 0x7fffffff), rank: 'normal', elite: [], scale: Math.round(g.scale * (o.mode === 'split' ? (o.scale ?? 0.65) : 0.9) * 1000) / 1000 };
      const u = this.build(genome, at, { boss: null, add: true });
      if (u.runtime.has('Spawn')) u.runtime.play('Spawn', { fade: 0 });
      if (hero) u.brain.alert(hero);
      this.ctx.particles.burst('smoke', at.clone().setY(0.4), { count: 6 });
    }
  }
}

/** The LevelPort over R5's levels: designed specs 1..12, rifts after, built as `LevelStage`s. */
export class RealLevels implements LevelPort {
  constructor(private readonly worlds: Worlds) {}

  spec(depth: number, runSeed: number): LevelSpec {
    return levelSpec(depth, runSeed);
  }

  mechanics(): readonly MechanicInfo[] {
    return MECHANIC_ORDER.map((id) => {
      const m = MECHANICS.get(id);
      return { id, name: m.name, description: m.description, bypass: m.bypass, exploit: m.exploit };
    });
  }

  async build(spec: LevelSpec, deps: LevelDeps): Promise<LevelHandle> {
    const stage = new LevelStage(spec, deps, this.worlds);
    await stage.load();
    return stage;
  }
}

