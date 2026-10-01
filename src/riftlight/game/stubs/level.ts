/**
 * STUB LevelPort (replaced by levels' buildLevel / riftSpec / designed specs at
 * integration): the 12 designed level specs as names, themes and mechanic ids, rift specs
 * after 12, and a flat test level: a chain of rooms with low walls, braziers, packs of
 * capsule monsters, a boss in the last room and an exit portal that opens when the level
 * is clear. Mechanics are not simulated; the codex text is real.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, TorusGeometry, Vector3 } from 'three/webgpu';
import { mergeStaticMeshes, PALETTE, type PaletteColor, toonMaterial } from '../../../engine';
import { Rng } from '../../core/rng';
import type { Rank } from '../../core/scaling';
import { SCALING } from '../../core/scaling';
import type { ActorLike, LayoutLike, LevelSpec } from '../../core/types';
import { faceted } from '../../town/kit';
import type { BossView, HeroPort, LevelDeps, LevelHandle, LevelPort, MechanicInfo, MonsterHandle, PooledLight, Telegraph } from '../ports';
import { generateLayout, type GridLayout } from './layout';
import { StubMonster } from './monsters';

/** The 12 designed levels (docs/GAME.md): name = mechanic. */
export const MECHANICS: readonly MechanicInfo[] = [
  { id: 'embers', name: 'Embers', description: 'Explosive braziers: hit one to blast everything near it.', bypass: 'Fight normally.', exploit: 'Pull packs onto braziers and chain the blasts.' },
  { id: 'gloom', name: 'Gloom', description: 'Darkness: the light radius matters, lanterns relight areas, monsters hit harder in the dark.', bypass: 'Stay near lit paths.', exploit: 'Light lanterns for big XP shrine buffs.' },
  { id: 'gale', name: 'Gale', description: 'Wind lanes push every actor.', bypass: 'Walk across between gusts.', exploit: 'Ride gusts for speed; blow packs into pits.' },
  { id: 'frostglass', name: 'Frostglass', description: 'Ice floors: momentum and sliding; frozen monsters shatter.', bypass: 'Stay on stone paths.', exploit: 'Slide-dash and chain shatters.' },
  { id: 'thornweave', name: 'Thornweave', description: 'Vine traps that hurt anyone.', bypass: 'Step around them.', exploit: 'Kite monsters through the thorns.' },
  { id: 'stormspire', name: 'Stormspire', description: 'Lightning pylons chain between conductors.', bypass: 'Ignore the pylons.', exploit: 'Charge pylons to zap whole corridors.' },
  { id: 'mire', name: 'Mire', description: 'Slowing mud and haste pads, with gusts over the mire.', bypass: 'Slog through.', exploit: 'Chain haste pads and gust-boost.' },
  { id: 'echoes', name: 'Echoes', description: 'An echo replays your attacks two seconds later.', bypass: 'Ignore it.', exploit: 'Double-dip burst windows.' },
  { id: 'riftgates', name: 'Riftgates', description: 'Paired portals between rooms (with Stormspire pylons).', bypass: 'Walk the long way.', exploit: 'Shortcuts; knock monsters through gates.' },
  { id: 'bloodmoon', name: 'Bloodmoon', description: 'Monsters explode on death (with Embers braziers).', bypass: 'Fight carefully.', exploit: 'Chain explosions across rooms.' },
  { id: 'gravewell', name: 'Gravewell', description: 'Gravity wells pull actors in (with Frostglass).', bypass: 'Avoid the wells.', exploit: 'Group packs for area skills.' },
  { id: 'collapse', name: 'Collapse', description: 'Floors crumble behind you (with Gloom).', bypass: 'Keep moving.', exploit: 'Fastest clears, collapse bonus loot.' },
];

const COMBOS: Record<string, string[]> = { mire: ['gale'], riftgates: ['stormspire'], bloodmoon: ['embers'], gravewell: ['frostglass'], collapse: ['gloom'] };

interface Theme {
  floor: PaletteColor;
  floor2: PaletteColor;
  wall: PaletteColor;
  top: PaletteColor;
  accent: PaletteColor;
  light: PaletteColor;
  sky: PaletteColor;
}
const THEMES: Record<string, Theme> = {
  ember: { floor: 'plum', floor2: 'night', wall: 'night', top: 'slate', accent: 'orange', light: 'orange', sky: 'ink' },
  gloom: { floor: 'night', floor2: 'ink', wall: 'ink', top: 'night', accent: 'sky', light: 'sand', sky: 'ink' },
  gale: { floor: 'teal', floor2: 'green', wall: 'slate', top: 'mist', accent: 'white', light: 'white', sky: 'navy' },
  frost: { floor: 'sky', floor2: 'mist', wall: 'blue', top: 'white', accent: 'cyan', light: 'cyan', sky: 'navy' },
  thorn: { floor: 'green', floor2: 'teal', wall: 'plum', top: 'red', accent: 'lime', light: 'lime', sky: 'ink' },
  storm: { floor: 'slate', floor2: 'night', wall: 'navy', top: 'blue', accent: 'cyan', light: 'cyan', sky: 'ink' },
};
const THEME_OF = ['ember', 'gloom', 'gale', 'frost', 'thorn', 'storm', 'thorn', 'gloom', 'storm', 'ember', 'frost', 'gloom'];

/** Cells → world: cell (x, z) has its centre at (x + 0.5, z + 0.5). */
export const cellToWorld = (x: number, z: number, out = new Vector3()) => out.set(x + 0.5, 0, z + 0.5);

class StubLevel implements LevelHandle {
  readonly kind = 'level' as const;
  readonly root = new Group();
  readonly start = new Vector3();
  readonly exit = new Vector3();
  readonly origin = { x: 0, z: 0 };
  private readonly mons: StubMonster[] = [];
  private total = 0;
  private killed = 0;
  private readonly seen: Uint8Array;
  private readonly lights: PooledLight[] = [];
  private portal!: Group;
  private portalRing!: Mesh;
  private portalLight: PooledLight | null = null;
  private time = 0;
  private boss_: StubMonster | null = null;
  private bossPhase = 0;
  private open = false;
  private readonly braziers: { light: PooledLight | null; at: Vector3; base: number }[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    readonly spec: LevelSpec,
    readonly layout: GridLayout,
    private readonly deps: LevelDeps,
  ) {
    this.root.name = `level:${spec.depth}`;
    const theme = THEMES[spec.theme] ?? THEMES.ember!;
    const engine = deps.services.ctx.engine;
    engine.ambient.color.setHex(PALETTE[theme.light === 'orange' ? 'plum' : 'navy']);
    engine.ambient.intensity = 1.5;
    engine.sun.color.setHex(PALETTE.mist);
    engine.sun.intensity = 2.4;
    this.seen = new Uint8Array(layout.width * layout.height);
    cellToWorld(layout.start.x, layout.start.z, this.start);
    cellToWorld(layout.exit.x, layout.exit.z, this.exit);
    this.exit.z -= 3;
    this.unsubscribe = deps.services.events.on('kill', ({ target }) => {
      const m = this.mons.find((x) => x.actor === target);
      if (!m) return;
      this.killed++;
      const rng = deps.services.rng.fork(`drop:${target.id}`);
      const drops = deps.loot.rollDrops({ depth: spec.depth, rank: m.rank, level: target.level, at: target.position }, rng);
      deps.loot.spawn(drops, target.position, this, rng);
    });
  }

  get exitOpen(): boolean {
    return this.open;
  }

  build(): void {
    const theme = THEMES[this.spec.theme] ?? THEMES.ember!;
    const L = this.layout;
    const statics: Mesh[] = [];
    const floorA = toonMaterial(PALETTE[theme.floor]);
    const floorB = toonMaterial(PALETTE[theme.floor2]);
    const wallSide = toonMaterial(PALETTE[theme.wall]);
    const wallTop = toonMaterial(PALETTE[theme.top]);
    const tile = new BoxGeometry(1, 0.2, 1);
    const wall = new BoxGeometry(1, 1.2, 1);
    const rng = new Rng(this.spec.seed).fork('decor');
    for (let z = 0; z < L.height; z++)
      for (let x = 0; x < L.width; x++) {
        const c = L.cell(x, z);
        if (c === 1) {
          const m = new Mesh(tile, (x + z) % 2 === 0 || rng.chance(0.1) ? floorA : floorB);
          m.position.set(x + 0.5, -0.1, z + 0.5);
          m.receiveShadow = true;
          m.castShadow = false;
          statics.push(m);
        } else if (c === 2) {
          // Walls in front of floor (toward the iso camera at +x +z) are low lips, so they
          // never hide the hero; walls behind floor stand tall.
          const front = L.cell(x - 1, z) === 1 || L.cell(x, z - 1) === 1 || L.cell(x - 1, z - 1) === 1;
          const tall = front ? 0.35 : rng.chance(0.2) ? 1.9 : 1.4;
          const m = new Mesh(wall, [wallSide, wallSide, wallTop, wallSide, wallSide, wallSide]);
          m.scale.y = tall / 1.2;
          m.position.set(x + 0.5, tall / 2, z + 0.5);
          m.castShadow = m.receiveShadow = true;
          statics.push(m);
        }
      }
    // pillars and rubble in rooms
    const pillar = faceted(new CylinderGeometry(0.32, 0.4, 2.2, 6));
    for (const r of L.rooms) {
      if (r.w < 8) continue;
      for (const [px, pz] of [[r.x + 1.5, r.z + 1.5], [r.x + r.w - 1.5, r.z + r.h - 1.5]]) {
        if (rng.chance(0.5)) continue;
        const m = new Mesh(pillar, wallTop);
        m.position.set(px!, 1.1, pz!);
        m.castShadow = m.receiveShadow = true;
        statics.push(m);
        this.pillars.push({ x: px!, z: pz! });
      }
    }
    // a void plane far below, so the level floats in darkness
    this.root.add(...mergeStaticMeshes(statics));
    tile.dispose();
    wall.dispose();
    pillar.dispose();

    // braziers along the path (borrowed lights)
    const brazierMat = toonMaterial(PALETTE.slate);
    const coal = toonMaterial(PALETTE[theme.accent]);
    const step = Math.max(8, Math.floor(L.path.length / 4));
    for (let i = step; i < L.path.length - 4; i += step) {
      const p = L.path[i]!;
      // put it beside the path, on floor
      const side = [[2, 0], [-2, 0], [0, 2], [0, -2]].find(([dx, dz]) => L.cell(p.x + dx!, p.z + dz!) === 1 && L.cell(p.x + dx! + Math.sign(dx!), p.z + dz! + Math.sign(dz!)) === 1);
      const at = cellToWorld(p.x + (side?.[0] ?? 1), p.z + (side?.[1] ?? 0));
      const bowl = new Mesh(faceted(new CylinderGeometry(0.34, 0.18, 0.4, 6)), brazierMat);
      bowl.position.copy(at).setY(0.75);
      const leg = new Mesh(faceted(new CylinderGeometry(0.06, 0.1, 0.6, 5)), brazierMat);
      leg.position.copy(at).setY(0.3);
      const fire = new Mesh(faceted(new CylinderGeometry(0.26, 0.26, 0.1, 6)), coal);
      fire.position.copy(at).setY(0.95);
      for (const m of [bowl, leg, fire]) m.castShadow = true;
      this.root.add(bowl, leg, fire);
      const light = this.deps.services.lights.acquire(PALETTE[theme.light], 14, 7, [at.x, 1.4, at.z]);
      if (light) this.lights.push(light);
      this.braziers.push({ light, at: at.clone().setY(1.05), base: 14 });
      this.pillars.push({ x: at.x, z: at.z, r: 0.35 });
    }

    // exit portal: a standing ring, dark until the level is clear
    this.portal = new Group();
    this.portal.position.copy(this.exit);
    const base = new Mesh(faceted(new CylinderGeometry(1.3, 1.5, 0.25, 8)), toonMaterial(PALETTE.slate));
    base.position.y = 0.12;
    this.portalRing = new Mesh(new TorusGeometry(1.05, 0.16, 6, 16), toonMaterial(PALETTE.night));
    this.portalRing.position.y = 1.45;
    for (const m of [base, this.portalRing]) m.castShadow = true;
    this.portal.add(base, this.portalRing);
    this.root.add(this.portal);
  }

  private readonly pillars: { x: number; z: number; r?: number }[] = [];

  spawnMonsters(): void {
    const L = this.layout;
    const { spec } = this;
    const rng = new Rng(spec.seed).fork('spawns');
    const density = SCALING.density(spec.depth);
    for (const r of L.rooms) {
      if (r.tags.includes('start')) continue;
      if (r.tags.includes('boss')) {
        const at = cellToWorld(r.x + Math.floor(r.w / 2), r.z + Math.floor(r.h / 2) + 1);
        this.boss_ = this.spawn(rng.int(1, 1e9), at, 'boss') as StubMonster;
        this.boss_.onPhase = (phase) => {
          this.bossPhase = phase;
          this.deps.services.ctx.audio.play('rl.roar');
          this.deps.services.shake(0.6, 0.4);
          if (phase === 2) for (let i = 0; i < 2; i++) this.spawn(rng.int(1, 1e9), at.clone().add(new Vector3(i ? 2 : -2, 0, 1)), 'normal');
        };
        continue;
      }
      const n = Math.max(2, Math.round(rng.int(2, 3) * density));
      for (let i = 0; i < n; i++) {
        const at = cellToWorld(r.x + 1 + rng.int(0, r.w - 3), r.z + 1 + rng.int(0, r.h - 3));
        const rank: Rank = rng.chance(0.12) ? 'rare' : rng.chance(0.2) ? 'magic' : 'normal';
        this.spawn(rng.int(1, 1e9), at, rank);
      }
    }
  }

  spawn(seed: number, at: Vector3, rank: Rank = 'normal'): MonsterHandle {
    const { services, monsters } = this.deps;
    const genome = monsters.genome(seed, this.spec.depth, rank, this.spec.archetypes);
    const m = monsters.build(genome, { services, stage: this, at, depth: this.spec.depth, mods: { difficulty: services.difficultyMods('enemy') } }) as StubMonster;
    this.root.add(m.object);
    this.mons.push(m);
    this.total++;
    return m;
  }

  collide(p: Vector3, radius: number): void {
    const L = this.layout;
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (L.cell(x, z) === 1) continue;
        // push out of the cell's square
        const nx = Math.max(x, Math.min(x + 1, p.x));
        const nz = Math.max(z, Math.min(z + 1, p.z));
        const ox = p.x - nx;
        const oz = p.z - nz;
        const d = Math.hypot(ox, oz);
        if (d >= radius) continue;
        if (d > 1e-6) {
          p.x = nx + (ox / d) * radius;
          p.z = nz + (oz / d) * radius;
        } else {
          p.x = Math.floor(p.x) + 0.5;
          p.z = Math.floor(p.z) + 0.5;
        }
      }
    for (const c of this.pillars) {
      const r = (c.r ?? 0.4) + radius;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < r && d > 1e-6) {
        p.x = c.x + (dx / d) * r;
        p.z = c.z + (dz / d) * r;
      }
    }
  }

  groundY(): number {
    return 0;
  }

  actors(): readonly ActorLike[] {
    return this.mons.map((m) => m.actor);
  }

  monsters(): readonly MonsterHandle[] {
    return this.mons.filter((m) => m.actor.alive);
  }

  progress(): { killed: number; total: number } {
    return { killed: this.killed, total: this.total };
  }

  boss(): BossView | null {
    const b = this.boss_;
    if (!b || b.removed) return null;
    // the bar shows once the fight is on: near the boss, or after it was hurt
    const hero = this.deps.hero.actor.position;
    if (b.actor.life >= b.actor.maxLife && b.actor.position.distanceTo(hero) > 15) return null;
    return { name: b.name, life: b.actor.life, maxLife: b.actor.maxLife, phases: b.phases, phase: this.bossPhase, position: b.actor.position };
  }

  explored(): Uint8Array {
    return this.seen;
  }

  telegraphs(): readonly Telegraph[] {
    const out: Telegraph[] = [];
    for (const m of this.mons) {
      const t = m.telegraph();
      if (t) out.push(t);
    }
    return out;
  }

  fixedUpdate(dt: number, hero: HeroPort): void {
    const ai = { hero: hero.actor, enabled: this.deps.services.dev().ai };
    for (const m of this.mons) m.fixedUpdate(dt, ai);
    // keep bodies apart (monsters and the hero)
    const all: ActorLike[] = [hero.actor, ...this.mons.filter((m) => m.actor.alive).map((m) => m.actor)];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-6) continue;
        const push = (min - d) / 2;
        const heroA = i === 0 ? 0.25 : 1; // the hero is pushed less (feels solid)
        a.position.x -= (dx / d) * push * heroA;
        a.position.z -= (dz / d) * push * heroA;
        b.position.x += (dx / d) * push * (2 - heroA);
        b.position.z += (dz / d) * push * (2 - heroA);
      }
    for (const m of this.mons) this.collide(m.actor.position, m.actor.radius);
  }

  update(dt: number, hero: HeroPort): void {
    this.time += dt;
    for (const m of this.mons) m.update(dt);
    for (let i = this.mons.length - 1; i >= 0; i--) {
      const m = this.mons[i]!;
      if (m.gone && !m.removed) {
        m.removed = true;
        this.deps.services.ctx.particles.burst('smoke', m.actor.position.clone().setY(0.5), { count: 6 });
        m.dispose();
        this.mons.splice(i, 1);
      }
    }
    // reveal around the hero (minimap)
    const p = hero.actor.position;
    const R = 9;
    const L = this.layout;
    for (let z = Math.max(0, Math.floor(p.z - R)); z <= Math.min(L.height - 1, p.z + R); z++)
      for (let x = Math.max(0, Math.floor(p.x - R)); x <= Math.min(L.width - 1, p.x + R); x++)
        if ((x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2 <= R * R) this.seen[z * L.width + x] = 1;
    // flicker braziers
    for (const [i, b] of this.braziers.entries()) {
      if (b.light) b.light.intensity = b.base * (0.85 + 0.15 * Math.sin(this.time * 11 + i * 2.1) * Math.sin(this.time * 7.3 + i));
      if (Math.floor(this.time * 8 + i) !== Math.floor((this.time - dt) * 8 + i)) this.deps.services.ctx.particles.burst('rl.ember', b.at, { count: 1 });
    }
    // portal opens when every monster is dead
    if (!this.open && this.killed >= this.total && this.total > 0) {
      this.open = true;
      this.portalRing.material = toonMaterial(PALETTE.cyan);
      this.portalLight = this.deps.services.lights.acquire(PALETTE.cyan, 22, 9, [this.exit.x, 1.6, this.exit.z]);
      this.deps.services.ctx.particles.burst('sparkle', this.exit.clone().setY(1.4), { count: 30, colors: ['white', 'cyan', 'sky'] });
    }
    this.portalRing.rotation.y = this.open ? this.time * 1.2 : 0;
    if (this.open) {
      if (this.portalLight) this.portalLight.intensity = 20 + 6 * Math.sin(this.time * 4);
      if (Math.floor(this.time * 10) !== Math.floor((this.time - dt) * 10)) this.deps.services.ctx.particles.burst('rl.portal', this.exit.clone().setY(1.45), { count: 2 });
    }
  }

  dispose(): void {
    this.unsubscribe();
    for (const m of this.mons) m.dispose();
    this.mons.length = 0;
    for (const l of this.lights) this.deps.services.lights.release(l);
    if (this.portalLight) this.deps.services.lights.release(this.portalLight);
    this.root.removeFromParent();
  }
}

export const stubLevels: LevelPort = {
  spec(depth: number, runSeed: number): LevelSpec {
    const rng = new Rng(runSeed).fork(`level:${depth}`);
    if (depth <= 12) {
      const m = MECHANICS[depth - 1]!;
      return {
        depth,
        name: m.name,
        mechanics: [m.id, ...(COMBOS[m.id] ?? [])],
        theme: THEME_OF[depth - 1]!,
        seed: rng.int(1, 2 ** 31),
        layout: { style: 'chain', rooms: 4 + Math.min(2, Math.floor(depth / 4)), size: 48 },
        archetypes: depth <= 2 ? ['brute', 'imp'] : ['brute', 'imp', 'imp'],
        boss: null,
      };
    }
    const picks = rng.shuffle([...MECHANICS]).slice(0, SCALING.riftMechanics(depth));
    return {
      depth,
      name: picks.map((p) => p.name).join(' '),
      mechanics: picks.map((p) => p.id),
      theme: rng.pick(Object.keys(THEMES)),
      seed: rng.int(1, 2 ** 31),
      layout: { style: 'chain', rooms: 6, size: 48 },
      archetypes: ['brute', 'imp'],
      boss: null,
    };
  },
  mechanics(): readonly MechanicInfo[] {
    return MECHANICS;
  },
  async build(spec: LevelSpec, deps: LevelDeps): Promise<LevelHandle> {
    const layout = generateLayout(new Rng(spec.seed).fork('layout'), spec.layout.rooms, spec.layout.size);
    const level = new StubLevel(spec, layout, deps);
    level.build();
    level.spawnMonsters();
    return level;
  },
};

export type { LayoutLike };
