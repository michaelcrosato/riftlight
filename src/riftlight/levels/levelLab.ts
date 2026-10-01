import { Mesh, Vector3 } from 'three/webgpu';
import type { Game, GameContext, LightHandle } from '../../engine';
import { EventBus } from '../core/events';
import type { ActorLike, GameEvents, Hit } from '../core/types';
import { SCALING } from '../core/scaling';
import { type Level, buildLevel } from './Level';
import { LabActor } from './labActors';
import { OctaGeo } from './mechanics/common';
import type { LevelHooks, MonsterSpawn } from './mechanics/types';
import { levelSpec } from './rift';
import { glowMaterial } from './themes/props';

/**
 * Level Lab: `/?game=levellab&depth=N` (optionally `&seed=S` for rifts, `&god=1`).
 * Builds level N with placeholder capsule actors so levels, mechanics, encounters and the
 * dynamic lighting can be played and tested before the real hero and combat exist.
 *
 *   WASD     move (camera-relative)        J / Space   swing (hits monsters and braziers/pylons)
 *   K        firebolt (a moving light)      N           next level once the portal is used
 *
 * `window.__LEVEL_LAB__` exposes the level, the hero and helpers for tests and agents:
 * `autopilot` (walk the critical path), `god`, `killBoss()`, `teleport(x, z)`, `log`.
 */
interface Bolt {
  mesh: Mesh;
  light: LightHandle | null;
  dir: Vector3;
  life: number;
}

const HERO_SPEED = 6;
const MONSTER_SPEED = 3.1;

export class LevelLab implements Game {
  readonly name = 'Riftlight Level Lab';
  readonly events = new EventBus<GameEvents>();
  level!: Level;
  hero!: LabActor;
  readonly monsters: LabActor[] = [];
  /** Walk the critical path by itself (tests, demos). */
  autopilot = false;
  /** Mechanic events seen (name → count) and the last few for the HUD. */
  readonly log: Record<string, number> = {};
  private recent: string[] = [];
  exited = false;
  private pathIndex = 0;
  private readonly bolts: Bolt[] = [];
  private readonly loot: { mesh: Mesh; light: LightHandle | null; until: number }[] = [];
  private readonly glows = new Map<LabActor, LightHandle | null>();
  private readonly wish = new Vector3();
  private readonly target = new Vector3();
  private ctx!: GameContext;
  private hudTimer = 0;
  private swing = 0;
  private time = 0;

  constructor(
    readonly depth = Number(new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('depth') ?? 1) || 1,
    readonly runSeed = Number(new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('seed') ?? 1) || 1,
  ) {}

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const spec = levelSpec(this.depth, this.runSeed);
    this.events.onAny((type, payload) => {
      if (type !== 'mechanic') return;
      const p = payload as GameEvents['mechanic'];
      const k = `${p.id}:${p.event}`;
      this.log[k] = (this.log[k] ?? 0) + 1;
      this.recent = [k, ...this.recent.filter((r) => r !== k)].slice(0, 4);
    });
    const hooks: LevelHooks = {
      spawnMonster: (s) => this.spawn(s),
      replaySkill: (actor, _skill, o) => this.attack(actor as LabActor, o.at, o.damageScale, false),
      dropLoot: (at, o) => this.dropLoot(at, o.rarity),
      onExit: () => {
        this.exited = true;
      },
    };
    this.hero = new LabActor('hero', 'normal', new Vector3(), 0.4, 600);
    this.hero.god = new URLSearchParams(location.search).get('god') === '1';
    this.level = buildLevel(
      spec,
      {
        scene: ctx.scene,
        events: this.events,
        actors: () => [this.hero, ...this.monsters],
        physics: ctx.physics,
        lights: ctx.lights,
        particles: ctx.particles,
        audio: ctx.audio,
        world: { scene: ctx.scene, sun: ctx.engine.sun, ambient: ctx.engine.ambient },
      },
      hooks,
    );
    this.hero.position.copy(this.level.start);
    this.hero.mesh.position.copy(this.level.start);
    ctx.scene.add(this.hero.mesh);
    // The ARPG camera: iso, a little steeper than the platformer's (unless the URL picks one).
    const url = new URLSearchParams(location.search);
    if (!url.has('camera') && !url.has('cam')) ctx.engine.setCamera({ preset: 'iso', pitch: 42, yaw: 45, viewHeight: 15, zoom: Number(url.get('zoom')) || 1 });
    (window as unknown as { __LEVEL_LAB__: LevelLab }).__LEVEL_LAB__ = this;
  }

  // ------------------------------------------------------------------ hooks

  private spawn(s: MonsterSpawn): ActorLike {
    const life = 60 * SCALING.monsterLife(s.depth) * ({ normal: 1, magic: 2.2, rare: 4.5, boss: 30 } as const)[s.rank];
    const m = new LabActor('monster', s.rank, s.position, s.rank === 'boss' ? 0.8 : 0.4, life);
    m.level = s.level;
    this.monsters.push(m);
    this.ctx.scene.add(m.mesh);
    // Magic, rare and boss monsters glow (a light request that follows them).
    if (s.rank !== 'normal') {
      const color = s.rank === 'magic' ? 0x41a6f6 : s.rank === 'rare' ? 0xffcd75 : 0xff4060;
      this.glows.set(m, this.ctx.lights.request({ follow: m.mesh, offset: [0, 1.2, 0], color, intensity: s.rank === 'boss' ? 5 : 2.5, radius: 4, priority: 0.8, flicker: 'pulse', name: `glow:${s.rank}` }));
    }
    return m;
  }

  private dropLoot(at: Vector3, rarity: string): void {
    const color = rarity === 'rare' ? 0xffcd75 : rarity === 'magic' ? 0x41a6f6 : 0xf4f4f4;
    const mesh = new Mesh(OctaGeo, glowMaterial(color));
    mesh.position.set(at.x, 0.4, at.z);
    mesh.scale.setScalar(0.35);
    mesh.name = 'lab:loot';
    this.ctx.scene.add(mesh);
    // A loot beam: a tall, bright, important light for a while.
    const light = this.ctx.lights.request({ position: [at.x, 1.5, at.z], color, intensity: 4, radius: 5, priority: 2, flicker: 'pulse', name: 'loot' });
    this.loot.push({ mesh, light, until: this.time + 20 });
  }

  /** A swing (or an echo of one): hits every monster and world target in reach. */
  private attack(by: LabActor, at: Vector3, scale: number, emitSkill: boolean): void {
    if (emitSkill) this.events.emit('skill', { actor: by, skill: 'swing' });
    const reach = 2.2;
    const hit: Hit = { source: by, skill: 'swing', tags: ['attack', 'melee', 'physical'], damage: { physical: 45 * SCALING.monsterLife(this.depth) * 0.5 * scale }, crit: false, knockback: 4, from: at.clone() };
    for (const t of [...this.monsters, ...this.level.targets()]) {
      if (!t.alive || Math.hypot(t.position.x - at.x, t.position.z - at.z) > reach + t.radius) continue;
      const result = t.takeHit(hit);
      this.events.emit('hit', { target: t, result, hit });
      if (result.killed && t.faction === 'monster') this.onMonsterDeath(t as LabActor, by);
    }
    this.ctx.particles.burst('impact', [at.x, 0.8, at.z], { count: 8, scale: 0.6 });
    this.ctx.audio.play('punch');
  }

  private onMonsterDeath(m: LabActor, killer: ActorLike | null): void {
    this.events.emit('kill', { target: m, killer, rank: m.rank, depth: this.depth });
  }

  // ------------------------------------------------------------------ game loop

  fixedUpdate(ctx: GameContext, dt: number): void {
    const hero = this.hero;
    const level = this.level;
    // Hero input (or autopilot along the critical path).
    this.wish.set(0, 0, 0);
    if (this.autopilot) this.steerAlongPath();
    else {
      const a = ctx.input.moveAxis();
      if (a.x || a.y) {
        const { right, forward } = ctx.camera.groundBasis();
        this.wish.copy(right).multiplyScalar(a.x).addScaledVector(forward, a.y);
        if (this.wish.lengthSq() > 1) this.wish.normalize();
      }
      if (ctx.input.consumePress('KeyJ', 'Space') && this.swing <= 0) {
        this.swing = 0.35;
        this.attack(hero, hero.position.clone().addScaledVector(this.facing(), 0.9), 1, true);
      }
      if (ctx.input.consumePress('KeyK')) this.firebolt();
    }
    this.swing -= dt;
    hero.step(level.layout, this.wish, HERO_SPEED * (hero.stats.get('move.speed') || 1), dt);
    // Placeholder monster brains: wake on sight, chase along the flow field, bonk the hero.
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = m.position.distanceTo(hero.position);
      if (!m.awake && d < 11 && level.nav.lineOfSight(m.position, hero.position)) m.awake = true;
      this.target.set(0, 0, 0);
      if (m.awake && d > 1.1 + m.radius) level.nav.direction(m.position.x, m.position.z, this.target);
      m.step(level.layout, this.target, MONSTER_SPEED * (m.stats.get('move.speed') || 1), dt);
      m.attackTimer -= dt;
      if (m.awake && d < 1.3 + m.radius && m.attackTimer <= 0) {
        m.attackTimer = 1.2;
        const hit: Hit = { source: m, tags: ['attack', 'melee'], damage: { physical: 6 * SCALING.monsterDamage(this.depth) * (m.stats.get('damage') || 1) }, crit: false };
        const result = hero.takeHit(hit);
        this.events.emit('hit', { target: hero, result, hit });
      }
    }
    level.fixedUpdate(dt);
    this.stepBolts(dt);
  }

  update(ctx: GameContext, dt: number): void {
    this.time += dt;
    this.level.update(dt);
    this.hero.sync(dt);
    for (const m of this.monsters) {
      m.sync(dt);
      if (!m.alive) {
        this.glows.get(m)?.release();
        this.glows.delete(m);
      }
    }
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i]!;
      l.mesh.rotation.y += dt * 2;
      if (this.time < l.until) continue;
      l.light?.release();
      l.mesh.removeFromParent();
      this.loot.splice(i, 1);
    }
    if (this.exited && ctx.input.wasPressed('KeyN')) void ctx.engine.loadGame(new LevelLab(this.depth + 1, this.runSeed));
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      this.drawHud(ctx);
    }
  }

  cameraTarget(): Vector3 {
    return this.hero.mesh.position.clone().setY(0.9);
  }

  status(): string {
    const s = this.ctx.lights.stats();
    return `${this.level.spec.name} · ${this.monsters.filter((m) => m.alive).length} alive · lights ${s.lit}/${s.size} of ${s.requests}`;
  }

  dispose(): void {
    this.level?.dispose();
    for (const b of this.bolts) b.light?.release();
    for (const l of this.loot) l.light?.release();
    const w = window as unknown as { __LEVEL_LAB__?: LevelLab };
    if (w.__LEVEL_LAB__ === this) delete w.__LEVEL_LAB__;
  }

  // ------------------------------------------------------------------ tools / tests

  /** Kill the boss (spawning it first if needed): opens the exit portal. */
  killBoss(): void {
    const room = this.level.layout.critical.at(-1)!;
    for (const e of this.level.encounters) {
      if (e.pack.room !== room || e.spawned) continue;
      const saved = this.hero.position.clone();
      this.hero.position.set(e.pack.members[0]!.x, 0, e.pack.members[0]!.z);
      this.level.update(0);
      this.hero.position.copy(saved);
    }
    const boss = this.level.boss as LabActor | null;
    if (!boss) return;
    boss.life = 0;
    this.onMonsterDeath(boss, this.hero);
  }

  teleport(x: number, z: number): void {
    this.hero.position.set(x, 0, z);
  }

  /** Distance from the hero to the exit. */
  exitDistance(): number {
    const p = this.level.exitPortal.position;
    return Math.hypot(this.hero.position.x - p.x, this.hero.position.z - p.z);
  }

  private steerAlongPath(): void {
    const path = this.level.layout.path;
    const p = this.hero.position;
    // Advance to the furthest nearby path point, aim a few cells ahead.
    let best = this.pathIndex;
    for (let i = this.pathIndex; i < Math.min(path.length, this.pathIndex + 12); i++) {
      const c = path[i]!;
      if (Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z) < 1.2) best = i;
    }
    this.pathIndex = best;
    const aim = path[Math.min(path.length - 1, best + 2)]!;
    this.wish.set(aim.x + 0.5 - p.x, 0, aim.z + 0.5 - p.z);
    if (this.wish.lengthSq() < 0.04) this.wish.set(0, 0, 0);
    else this.wish.normalize();
  }

  private facing(): Vector3 {
    const near = this.monsters.filter((m) => m.alive).sort((a, b) => a.position.distanceTo(this.hero.position) - b.position.distanceTo(this.hero.position))[0];
    const t = this.level.targets().find((x) => x.alive && x.position.distanceTo(this.hero.position) < 2.5);
    const to = near && near.position.distanceTo(this.hero.position) < 3 ? near.position : t?.position;
    if (!to) return new Vector3(0, 0, 0);
    return to.clone().sub(this.hero.position).setY(0).normalize();
  }

  private firebolt(): void {
    const dir = this.facing();
    if (dir.lengthSq() < 0.5) {
      const { forward } = this.ctx.camera.groundBasis();
      dir.copy(forward);
    }
    const mesh = new Mesh(OctaGeo, glowMaterial(0xffb060));
    mesh.scale.setScalar(0.4);
    mesh.position.copy(this.hero.position).setY(1);
    mesh.name = 'lab:bolt';
    this.ctx.scene.add(mesh);
    this.events.emit('skill', { actor: this.hero, skill: 'firebolt' });
    const light = this.ctx.lights.request({ follow: mesh, color: 0xffa040, intensity: 6, radius: 6, priority: 3, flicker: 'spell', fadeIn: 0.05, name: 'bolt' });
    this.bolts.push({ mesh, light, dir, life: 1.4 });
  }

  private stepBolts(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.mesh.position.addScaledVector(b.dir, 14 * dt);
      b.mesh.rotation.y += dt * 10;
      b.life -= dt;
      const p = b.mesh.position;
      const hitWall = !this.level.isWalkable(p.x, p.z) && this.level.layout.cell(Math.floor(p.x), Math.floor(p.z)) === 2;
      const victim = [...this.monsters, ...this.level.targets()].find((m) => m.alive && Math.hypot(m.position.x - p.x, m.position.z - p.z) < 0.6 + m.radius);
      if (victim || hitWall || b.life <= 0) {
        if (victim) {
          const hit: Hit = { source: this.hero, skill: 'firebolt', tags: ['spell', 'projectile', 'fire'], damage: { fire: 60 * SCALING.monsterLife(this.depth) * 0.5 }, crit: false, knockback: 3, from: p.clone() };
          const result = victim.takeHit(hit);
          this.events.emit('hit', { target: victim, result, hit });
          if (result.killed && victim.faction === 'monster') this.onMonsterDeath(victim as LabActor, this.hero);
        }
        this.ctx.particles.burst('ember-blast', p, { count: 12, scale: 0.6 });
        b.light?.release();
        b.mesh.removeFromParent();
        this.bolts.splice(i, 1);
      }
    }
  }

  private drawHud(ctx: GameContext): void {
    const hud = ctx.hud;
    hud.clear();
    const lv = this.level;
    hud.text(4, 4, `${lv.spec.depth}. ${lv.spec.name}`.toUpperCase(), { color: 'sand' });
    hud.text(4, 13, `${lv.theme.name} · ${lv.layout.style}`.toUpperCase(), { color: 'mist' });
    hud.text(4, 22, lv.spec.mechanics.join(' + ').toUpperCase(), { color: 'cyan' });
    this.recent.forEach((r, i) => hud.text(4, 34 + i * 9, r.toUpperCase(), { color: 'white' }));
    const lifeFrac = this.hero.life / (this.hero.stats.get('life') || 1);
    hud.rect(4, 6, 80, 5, 'ink', 'bottom-left');
    hud.rect(4, 6, Math.round(80 * lifeFrac), 5, 'red', 'bottom-left');
    if (lv.cleared) hud.text(0, 30, this.exited ? 'PORTAL TAKEN - PRESS N' : 'BOSS DOWN - PORTAL OPEN', { anchor: 'top', color: 'lime' });
    this.drawMinimap(ctx);
  }

  /** Explored cells, 1 HUD pixel per 2 cells, in the top-right corner. */
  private drawMinimap(ctx: GameContext): void {
    const m = this.level.minimap;
    const scale = 2;
    const w = Math.ceil(m.width / scale);
    const h = Math.ceil(m.height / scale);
    const hx = Math.floor(this.hero.position.x / scale);
    const hz = Math.floor(this.hero.position.z / scale);
    const ex = this.level.exitPortal.position;
    const rows: string[] = [];
    for (let z = 0; z < h; z++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        if (x === hx && z === hz) row += 'h';
        else if (x === Math.floor(ex.x / scale) && z === Math.floor(ex.z / scale) && this.level.cleared) row += 'x';
        else {
          const i = z * scale * m.width + x * scale;
          row += !m.explored[i] ? '.' : m.cells[i] === 1 ? 'f' : m.cells[i] === 2 ? 'w' : '.';
        }
      }
      rows.push(row);
    }
    ctx.hud.sprite(4, 4, rows, { f: 'slate', w: 'mist', h: 'sand', x: 'cyan' }, { anchor: 'top-right', shadow: false });
  }
}
