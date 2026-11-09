/**
 * Another player's hero in this copy (docs/game/session.md): the copies send each other their own
 * hero, one `HeroStep` per fixed step (what its player did, and where it stood), and each copy plays
 * the others' steps into a hero of its own, a little behind time (`RemoteTrack`), nudged toward
 * where its player really is. The same hero, clips and skills as the player's, so a ghost runs,
 * swings and dodges exactly as its player did.
 */
import { DoubleSide, type Material, Mesh, MeshBasicNodeMaterial, type Object3D, RingGeometry, Vector3 } from 'three/webgpu';
import { lerpAngle, RemoteTrack } from '../../engine';
import type { HeroIntent, HeroPort } from '../game/ports';

/** One fixed step of a hero between copies: [t, move x, move z, aim x, aim z, bits, skill, held, x, y, z, facing]. */
export type HeroStep = readonly [number, number, number, number, number, number, number, number, number, number, number, number];

export const STEP = { attack: 1, dodge: 2, dead: 4 } as const;

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** This copy's hero this step, as it travels: `t` the sender's game time. */
export function heroStep(t: number, intent: HeroIntent, hero: HeroPort, dead: boolean): HeroStep {
  const p = hero.actor.position;
  const bits = (intent.attack ? STEP.attack : 0) | (intent.dodge ? STEP.dodge : 0) | (dead ? STEP.dead : 0);
  const facing = (hero.actor as { facing?: number }).facing ?? 0;
  return [r3(t), r2(intent.move.x), r2(intent.move.z), r2(intent.aim.x), r2(intent.aim.z), bits, intent.skill, intent.held ?? 0, r2(p.x), r2(p.y), r2(p.z), r2(facing)];
}

/** Is this a hero step (what another copy sent)? */
export function isHeroStep(v: unknown): v is HeroStep {
  return Array.isArray(v) && v.length === 12 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
}

const lerpPose = (a: Pose, b: Pose, k: number): Pose => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, facing: lerpAngle(a.facing, b.facing, k) });

/** Farther than this from where its player is, a remote hero is put there at once. */
const SNAP = 2.5;
/** The share of the gap a remote hero closes each fixed step. */
const PULL = 0.15;
/** Seconds without a step before a remote hero is hidden (its player stopped sending). */
const SILENT = 3;

/** A player's hero as another copy shows it. */
export class RemoteHero {
  /** The hero (null until made: steps that come first wait). */
  hero: HeroPort | null = null;
  /** Its player's hero is down (hidden until it rises). */
  dead = false;
  /** This copy's game time of the last step heard. */
  lastHeard = -Infinity;
  private readonly track = new RemoteTrack<Pose>({ delay: 0.15 });
  private queue: HeroStep[] = [];
  private readonly intent: { move: { x: number; z: number }; aim: Vector3; attack: boolean; skill: number; dodge: boolean; held: number } = { move: { x: 0, z: 0 }, aim: new Vector3(), attack: false, skill: -1, dodge: false, held: 0 };
  private ring: Mesh | null = null;
  private readonly at = new Vector3();

  constructor(
    readonly id: number,
    readonly name: string,
    readonly color: string,
  ) {}

  /** The hero to drive, with a ring in its player's colour at its feet; `see`: drawn see-through (a ghost). */
  attach(hero: HeroPort, o: { see?: boolean } = {}): void {
    this.hero = hero;
    if (o.see !== false) ghostly(hero.object);
    const ring = new Mesh(new RingGeometry(0.42, 0.56, 28), new MeshBasicNodeMaterial({ color: this.color, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 2;
    hero.object.add(ring);
    this.ring = ring;
    const p = this.track.latest;
    if (p) hero.snap?.(this.at.set(p.x, p.y, p.z), p.facing);
  }

  /** A step from its player, arriving at this copy's game time `now`. */
  receive(step: HeroStep, now: number): void {
    const [t, , , , , , , , x, y, z, facing] = step;
    this.track.push(t, now, { x, y, z, facing });
    this.queue.push(step);
    if (this.queue.length > 240) this.queue.splice(0, this.queue.length - 240); // far behind: the track snaps it
    this.lastHeard = now;
  }

  /** Is it shown: heard from lately, and its player's hero up. */
  shown(now: number): boolean {
    return !!this.hero && now - this.lastHeard < SILENT && !this.dead;
  }

  /** One fixed step at this copy's game time `now`: its player's steps up to the moment drawn, then follow where it really is. */
  fixedUpdate(dt: number, now: number): void {
    const hero = this.hero;
    if (!hero) return;
    const due = this.track.senderTime(now);
    let latest: HeroStep | null = null;
    let skill = -1;
    let dodge = false;
    while (due !== null && this.queue.length && this.queue[0]![0] <= due) {
      const s = this.queue.shift()!;
      latest = s;
      if (skill < 0 && s[6] >= 0) skill = s[6]; // a press between two of our steps is never lost
      dodge ||= (s[5] & STEP.dodge) !== 0;
    }
    const i = this.intent;
    if (latest) {
      i.move.x = latest[1];
      i.move.z = latest[2];
      i.aim.set(latest[3], hero.actor.position.y, latest[4]);
      i.attack = (latest[5] & STEP.attack) !== 0;
      i.held = latest[7];
      const wasDead = this.dead;
      this.dead = (latest[5] & STEP.dead) !== 0;
      if (wasDead && !this.dead) {
        // its player rose again: so does this hero (one this copy saw fall, too), where it rose
        hero.restore();
        hero.snap?.(this.at.set(latest[8], latest[9], latest[10]), latest[11]);
      }
    }
    i.skill = skill;
    i.dodge = dodge;
    hero.fixedUpdate(dt, i satisfies HeroIntent);
    // follow where its player really is: a pull each step, a jump when far
    const want = this.track.sample(now, lerpPose);
    if (!want) return;
    const p = hero.actor.position;
    const dx = want.x - p.x;
    const dz = want.z - p.z;
    if (Math.hypot(dx, dz) > SNAP) hero.snap?.(this.at.set(want.x, want.y, want.z), want.facing);
    else hero.nudge?.(dx * PULL, dz * PULL);
  }

  /** Each frame: its pose and body, shown or hidden. */
  update(dt: number, now: number): void {
    const hero = this.hero;
    if (!hero) return;
    hero.update(dt);
    const shown = this.shown(now);
    hero.object.visible = shown;
    if (this.ring) {
      const p = hero.actor.position;
      this.ring.position.set(p.x, p.y + 0.04, p.z);
    }
  }

  dispose(): void {
    this.ring?.geometry.dispose();
    (this.ring?.material as MeshBasicNodeMaterial | undefined)?.dispose();
    this.ring = null;
    this.hero?.dispose();
    this.hero = null;
  }
}

/** Draw a body see-through (its own materials: the shared ones stay as they are). */
export function ghostly(root: Object3D, opacity = 0.5): void {
  const make = (m: Material): Material => {
    const c = m.clone();
    c.transparent = true;
    c.opacity = opacity;
    c.depthWrite = false;
    c.userData = { ...c.userData, shared: false }; // its own: freed with the level
    return c;
  };
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(make) : make(mesh.material);
    mesh.castShadow = false;
  });
}
