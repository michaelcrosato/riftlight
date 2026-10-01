/**
 * STUB MonsterPort (replaced by monsters' generateGenome + buildMonster at integration).
 * Capsule monsters with eyes and horns, coloured from their genome palette: they idle and
 * bob, chase when the hero comes near, wind up a telegraphed swing (a ring on the ground
 * that fills), flash white when hit, and squash away when they die. A boss has phases.
 */
import { CapsuleGeometry, CircleGeometry, Group, Mesh, MeshBasicNodeMaterial, RingGeometry, Vector3 } from 'three/webgpu';
import { ContactShadow, PALETTE, type PaletteColor, toonMaterial } from '../../../engine';
import { Rng } from '../../core/rng';
import { RANK, type Rank, SCALING } from '../../core/scaling';
import type { ActorLike, Genome, Palette } from '../../core/types';
import type { MonsterBuildOptions, MonsterHandle, MonsterPort, StageWorld, Telegraph } from '../ports';
import { StubActor, strike } from './actor';

const PALETTES: readonly Palette[] = [
  { primary: PALETTE.red, secondary: PALETTE.plum, accent: PALETTE.orange, glow: PALETTE.sand, dark: PALETTE.ink },
  { primary: PALETTE.green, secondary: PALETTE.teal, accent: PALETTE.lime, glow: PALETTE.lime, dark: PALETTE.ink },
  { primary: PALETTE.blue, secondary: PALETTE.navy, accent: PALETTE.sky, glow: PALETTE.cyan, dark: PALETTE.ink },
  { primary: PALETTE.plum, secondary: PALETTE.night, accent: PALETTE.red, glow: PALETTE.orange, dark: PALETTE.ink },
  { primary: PALETTE.orange, secondary: PALETTE.red, accent: PALETTE.sand, glow: PALETTE.sand, dark: PALETTE.ink },
];

const NAMES: Record<string, readonly string[]> = {
  brute: ['Gloomhide', 'Bonecrush', 'Rift Brute', 'Mossback'],
  imp: ['Ember Imp', 'Cinderling', 'Ash Sprite', 'Hexling'],
  boss: ['Warden of Embers', 'The Hollow King', 'Rift Colossus', 'Mother of Ash'],
};

const material = (hex: number) => toonMaterial(hex);
const basic = new Map<string, MeshBasicNodeMaterial>();
function flatColor(c: PaletteColor): MeshBasicNodeMaterial {
  let m = basic.get(c);
  if (!m) {
    m = new MeshBasicNodeMaterial({ color: PALETTE[c], transparent: true, opacity: 0.55, depthWrite: false });
    m.userData.shared = true;
    basic.set(c, m);
  }
  return m;
}

export class StubMonster implements MonsterHandle {
  readonly actor: StubActor;
  readonly object = new Group();
  readonly name: string;
  readonly rank: Rank;
  private readonly body = new Group();
  private readonly mats: Mesh[] = [];
  private readonly shadow: ContactShadow;
  private readonly ring: Mesh;
  private readonly fill: Mesh;
  private readonly reach: number;
  private windup = -1;
  private attackCd = 0;
  private bob = 0;
  private aggro = false;
  private dying = -1;
  private readonly home = new Vector3();
  private phase = 0;
  private readonly tmp = new Vector3();
  private readonly target = new Vector3();
  private readonly heavy: boolean;
  /** Boss phase thresholds (life fractions). */
  readonly phases: readonly number[];
  onPhase?: (phase: number) => void;
  removed = false;

  constructor(
    readonly genome: Genome,
    private readonly o: MonsterBuildOptions,
  ) {
    const rng = new Rng(genome.seed);
    const arch = genome.archetype;
    this.rank = genome.rank;
    const r = RANK[genome.rank];
    const depth = o.depth;
    const imp = arch === 'imp';
    this.heavy = arch === 'boss';
    this.name = rng.pick(NAMES[arch] ?? NAMES.brute!);
    // stub tuning: bosses take a third of the core RANK multiplier (a 30x boss would take a minute)
    const life = (imp ? 22 : 40) * SCALING.monsterLife(depth) * (genome.rank === 'boss' ? r.life * 0.33 : r.life);
    const damage = (imp ? 6 : 9) * SCALING.monsterDamage(depth) * r.damage;
    this.actor = new StubActor('monster', this.name, 0.42 * genome.scale, { life, damage, 'move.speed': imp ? 3.6 : 2.7, 'attack.speed': 1, armour: imp ? 0 : 20, 'res.fire': imp ? 40 : 0 }, SCALING.monsterLevel(depth));
    for (const [source, mods] of Object.entries(o.mods)) if (mods.length) this.actor.stats.set(source, mods);
    this.actor.life = this.actor.maxLife;
    this.actor.rank = genome.rank;
    this.actor.depth = depth;
    this.actor.position.copy(o.at);
    this.home.copy(o.at);
    this.reach = (this.heavy ? 2.6 : imp ? 1.3 : 1.6) * Math.max(1, genome.scale * 0.8);
    this.phases = this.heavy ? [0.66, 0.33] : [];

    // body: a capsule with a belly, eyes, horns or ears, little feet
    const pal = genome.palette;
    const s = genome.scale;
    const h = imp ? 0.55 : 0.7;
    const add = (m: Mesh) => {
      m.castShadow = true;
      this.mats.push(m);
      this.body.add(m);
      return m;
    };
    add(new Mesh(new CapsuleGeometry(imp ? 0.32 : 0.42, h, 4, 8), material(pal.primary))).position.y = h / 2 + (imp ? 0.32 : 0.42);
    const belly = add(new Mesh(new CapsuleGeometry(imp ? 0.22 : 0.3, h * 0.5, 3, 8), material(pal.secondary)));
    belly.position.set(0, h / 2 + 0.3, imp ? 0.14 : 0.2);
    const eyeY = h + (imp ? 0.42 : 0.55);
    for (const x of [-1, 1]) {
      const eye = add(new Mesh(new CapsuleGeometry(0.07, 0.04, 2, 6), material(PALETTE.white)));
      eye.position.set(x * 0.13, eyeY, imp ? 0.28 : 0.37);
      const pupil = add(new Mesh(new CapsuleGeometry(0.035, 0.02, 2, 4), material(pal.dark)));
      pupil.position.set(x * 0.13, eyeY, imp ? 0.33 : 0.43);
      const horn = add(new Mesh(new CapsuleGeometry(0.05, imp ? 0.16 : 0.26, 2, 4), material(pal.accent)));
      horn.position.set(x * (imp ? 0.2 : 0.26), eyeY + (imp ? 0.22 : 0.3), 0);
      horn.rotation.z = -x * (imp ? 0.6 : 0.35);
      const foot = add(new Mesh(new CapsuleGeometry(0.1, 0.08, 2, 6), material(pal.dark)));
      foot.position.set(x * 0.2, 0.08, 0.1);
      foot.rotation.x = Math.PI / 2;
    }
    if (this.heavy || genome.rank === 'rare') {
      const crown = add(new Mesh(new CapsuleGeometry(0.12, 0.3, 2, 6), material(pal.glow)));
      crown.position.set(0, eyeY + 0.42, -0.05);
    }
    this.body.scale.setScalar(s);
    this.object.add(this.body);
    this.shadow = new ContactShadow(0.5 * s);
    this.object.add(this.shadow);
    // telegraph: outline ring + filling disc on the ground
    this.ring = new Mesh(new RingGeometry(0.92, 1, 24).rotateX(-Math.PI / 2), flatColor('red'));
    this.fill = new Mesh(new CircleGeometry(1, 24).rotateX(-Math.PI / 2), flatColor('orange'));
    this.ring.visible = this.fill.visible = false;
    this.ring.renderOrder = this.fill.renderOrder = 2;
    o.stage.root.add(this.ring, this.fill);
    this.object.name = `monster:${this.name}`;
  }

  get stage(): StageWorld {
    return this.o.stage;
  }

  telegraph(): Telegraph | null {
    if (this.windup < 0) return null;
    return { at: this.target.clone(), radius: this.reach, remaining: this.windupTime() - this.windup, kind: 'circle', source: this.actor };
  }

  private windupTime(): number {
    const s = Math.max(0.3, this.actor.stats.get('attack.speed'));
    return (this.heavy ? 0.95 : this.genome.archetype === 'imp' ? 0.5 : 0.7) / s;
  }

  fixedUpdate(dt: number, ai: { hero: ActorLike; enabled: boolean }): void {
    const a = this.actor;
    if (this.dying >= 0) {
      this.dying += dt;
      return;
    }
    if (!a.alive) {
      this.dying = 0;
      this.windup = -1;
      this.ring.visible = this.fill.visible = false;
      return;
    }
    // boss phases
    if (this.phases.length) {
      const frac = a.life / a.maxLife;
      const phase = this.phases.filter((p) => frac <= p).length;
      if (phase !== this.phase) {
        this.phase = phase;
        a.stats.set('phase', phase ? [{ stat: 'attack.speed', kind: 'more', value: 0.25 * phase }, { stat: 'move.speed', kind: 'more', value: 0.2 * phase }] : []);
        this.onPhase?.(phase);
      }
    }
    this.attackCd = Math.max(0, this.attackCd - dt);
    const hero = ai.hero;
    const to = this.tmp.copy(hero.position).sub(a.position).setY(0);
    const dist = to.length();
    if (!this.aggro && ai.enabled && hero.alive && dist < (this.heavy ? 12 : 8.5)) this.aggro = true;
    const speed = a.stats.get('move.speed');
    let vx = 0;
    let vz = 0;
    if (this.windup >= 0) {
      this.windup += dt;
      if (this.windup >= this.windupTime()) {
        this.windup = -1;
        this.attackCd = this.heavy ? 1.1 : 0.9;
        if (hero.alive && hero.position.distanceTo(this.target) <= this.reach + hero.radius * 0.5 && hero instanceof StubActor) {
          const dmg = a.stats.get('damage') * this.o.services.rng.range(0.85, 1.15);
          const fire = this.genome.archetype !== 'brute';
          strike(this.o.services.events, hero, { source: a, tags: ['attack', 'melee'], damage: fire ? { fire: dmg * 0.7, physical: dmg * 0.3 } : { physical: dmg }, crit: false, knockback: this.heavy ? 8 : 3, from: a.position });
        }
        this.o.services.ctx.particles.burst(this.heavy ? 'impact' : 'dust', this.target, { count: this.heavy ? 22 : 8 });
        if (this.heavy) this.o.services.shake(0.5, 0.25);
        this.o.services.ctx.audio.play('rl.slam', { pitch: this.heavy ? -6 : 0, volume: this.heavy ? 1 : 0.6 });
      }
    } else if (this.aggro && ai.enabled && hero.alive) {
      if (dist <= this.reach * 0.8 + hero.radius && this.attackCd <= 0) {
        this.windup = 0;
        this.target.copy(a.position).addScaledVector(to.normalize(), Math.min(dist, this.reach * 0.6));
        if (this.heavy) this.target.copy(a.position).addScaledVector(to, Math.min(dist, 1.2));
      } else if (dist > this.reach * 0.7) {
        vx = (to.x / dist) * speed;
        vz = (to.z / dist) * speed;
      }
    } else if (!ai.enabled || !hero.alive) {
      const back = this.tmp.copy(this.home).sub(a.position).setY(0);
      if (back.length() > 0.5) {
        back.normalize().multiplyScalar(speed * 0.5);
        vx = back.x;
        vz = back.z;
      }
    }
    a.velocity.multiplyScalar(Math.exp(-7 * dt));
    a.position.x += (vx + a.velocity.x) * dt;
    a.position.z += (vz + a.velocity.z) * dt;
    this.o.stage.collide(a.position, a.radius);
    if (vx || vz) this.object.rotation.y = turn(this.object.rotation.y, Math.atan2(vx, vz), 10 * dt);
    else if (this.windup >= 0) this.object.rotation.y = turn(this.object.rotation.y, Math.atan2(this.target.x - a.position.x, this.target.z - a.position.z), 12 * dt);
    this.bob += dt * (vx || vz ? speed * 2.6 : 2);
  }

  update(dt: number): void {
    const a = this.actor;
    this.object.position.copy(a.position);
    const s = this.genome.scale;
    if (this.dying >= 0) {
      const k = Math.min(1, this.dying / 0.45);
      this.body.scale.set(s * (1 + 0.5 * k), s * (1 - 0.95 * k), s * (1 + 0.5 * k));
      this.shadow.visible = k < 1;
      this.body.visible = k < 1;
      return;
    }
    // squash & stretch: hops while moving, coils during the windup, flashes white on hits
    const wind = this.windup >= 0 ? Math.min(1, this.windup / this.windupTime()) : 0;
    const hop = Math.abs(Math.sin(this.bob));
    this.body.position.y = hop * 0.12 * (wind ? 0 : 1);
    const sq = wind ? 1 - 0.18 * wind : 1 + 0.06 * Math.sin(this.bob * 2);
    this.body.scale.set(s * (2 - sq), s * sq, s * (2 - sq));
    const flash = a.flash > 0;
    a.flash = Math.max(0, a.flash - dt);
    for (const m of this.mats) m.visible = true;
    this.body.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.userData.base ??= mesh.material;
        mesh.material = flash ? toonMaterial(PALETTE.white) : (mesh.userData.base as Mesh['material']);
      }
    });
    this.shadow.place(a.position.x, a.position.y, a.position.z, this.body.position.y);
    // telegraph
    this.ring.visible = this.fill.visible = wind > 0;
    if (wind > 0) {
      const r = this.reach;
      this.ring.position.copy(this.target).setY(0.03);
      this.ring.scale.setScalar(r);
      this.fill.position.copy(this.target).setY(0.025);
      this.fill.scale.setScalar(r * wind);
    }
  }

  /** Finished dying (the level removes it). */
  get gone(): boolean {
    return this.dying > 0.5;
  }

  dispose(): void {
    this.ring.removeFromParent();
    this.fill.removeFromParent();
    this.ring.geometry.dispose();
    this.fill.geometry.dispose();
    this.object.removeFromParent();
    this.object.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}

function turn(from: number, to: number, max: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-max, Math.min(max, d));
}

export const stubMonsters: MonsterPort = {
  genome(seed: number, _depth: number, rank: Rank, archetypes?: readonly string[]): Genome {
    const rng = new Rng(seed);
    const archetype = rank === 'boss' ? 'boss' : rng.pick(archetypes?.length ? archetypes : ['brute', 'imp', 'brute']);
    const scale = (rank === 'boss' ? 2.1 : rank === 'rare' ? 1.3 : rank === 'magic' ? 1.12 : 1) * rng.range(0.92, 1.08) * (archetype === 'imp' ? 0.85 : 1);
    return { seed, plan: 'blob', parts: [], genes: { girth: rng.next() }, palette: rng.pick(PALETTES), scale, archetype, elite: [], rank };
  },
  build(genome: Genome, options: MonsterBuildOptions): MonsterHandle {
    return new StubMonster(genome, options);
  },
};

