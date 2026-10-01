/**
 * Mott, the town cat: a little jointed box rig animated procedurally (trot cycle on four
 * legs, a swaying three-segment tail, head turns, sitting down with the tail curled). It
 * wanders between waypoints, sits a while, and darts off when the hero runs at it.
 */
import { BoxGeometry, Group, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { toonMaterial } from '../../engine/render/toon';
import type { Rng } from '../core/rng';
import { type Blocker, collideBlockers } from './kit';
import type { Bubble } from './npcs';

function part(size: [number, number, number], c: PaletteColor, at: [number, number, number]): Mesh {
  const m = new Mesh(new BoxGeometry(...size), toonMaterial(PALETTE[c]));
  m.position.set(...at);
  m.castShadow = true;
  return m;
}

export class Cat {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly legs: Object3D[] = [];
  private readonly tail: Object3D[] = [];
  readonly position = new Vector3();
  private yaw = 0;
  private wp = 0;
  private state: 'walk' | 'sit' | 'flee' = 'sit';
  private timer = 2;
  private phase = 0;
  private sit = 1;
  private speed = 0;
  bubble: Bubble | null = null;
  private meowCd = 5;
  private readonly tmp = new Vector3();

  constructor(
    private readonly rng: Rng,
    at: Vector3,
    private readonly path: Vector3[],
  ) {
    this.position.copy(at);
    const fur: PaletteColor = 'orange';
    this.body.add(part([0.26, 0.2, 0.5], fur, [0, 0, 0]));
    this.body.add(part([0.2, 0.06, 0.36], 'sand', [0, -0.09, 0.02]));
    this.body.position.y = 0.3;
    this.head.add(part([0.24, 0.2, 0.2], fur, [0, 0, 0]));
    this.head.add(part([0.07, 0.08, 0.04], fur, [-0.08, 0.13, -0.02]));
    this.head.add(part([0.07, 0.08, 0.04], fur, [0.08, 0.13, -0.02]));
    this.head.add(part([0.16, 0.04, 0.02], 'ink', [0, 0.03, 0.105]));
    this.head.add(part([0.06, 0.04, 0.03], 'sand', [0, -0.04, 0.11]));
    this.head.position.set(0, 0.14, 0.3);
    this.body.add(this.head);
    for (const [x, z] of [[-0.09, 0.18], [0.09, 0.18], [-0.09, -0.18], [0.09, -0.18]] as const) {
      const leg = new Group();
      leg.position.set(x, -0.08, z);
      leg.add(part([0.07, 0.22, 0.07], fur, [0, -0.11, 0]));
      leg.add(part([0.08, 0.04, 0.1], 'sand', [0, -0.21, 0.02]));
      this.body.add(leg);
      this.legs.push(leg);
    }
    let parent: Object3D = this.body;
    for (let i = 0; i < 3; i++) {
      const seg = new Group();
      seg.position.set(0, i === 0 ? 0.06 : 0.12, i === 0 ? -0.26 : 0);
      seg.add(part([0.06, 0.13, 0.06], i === 2 ? 'sand' : fur, [0, 0.06, 0]));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }
    this.root.add(this.body);
    this.root.name = 'cat';
  }

  update(dt: number, hero: Vector3 | null, blockers: readonly Blocker[]): void {
    this.timer -= dt;
    this.meowCd -= dt;
    const heroD = hero ? this.tmp.copy(hero).sub(this.position).setY(0).length() : Infinity;
    if (hero && heroD < 1.6 && this.state !== 'flee') {
      this.state = 'flee';
      this.timer = 1.4;
      if (this.meowCd <= 0) {
        this.bubble = { text: 'MRROW!', at: this.position.clone().setY(0.9), t: 0, life: 1.4 };
        this.meowCd = 8;
      }
    } else if (hero && heroD < 3 && this.state === 'sit' && this.meowCd <= 0) {
      this.bubble = { text: 'MEOW', at: this.position.clone().setY(0.9), t: 0, life: 1.6 };
      this.meowCd = 12;
    }
    let want = 0;
    if (this.state === 'flee') {
      const away = this.tmp.copy(this.position).sub(hero ?? this.position).setY(0);
      if (away.lengthSq() > 1e-4) this.yaw = turn(this.yaw, Math.atan2(away.x, away.z), 10 * dt);
      want = 3.2;
      if (this.timer <= 0) {
        this.state = 'sit';
        this.timer = this.rng.range(2, 5);
      }
    } else if (this.state === 'walk') {
      const to = this.tmp.copy(this.path[this.wp]!).sub(this.position).setY(0);
      if (to.length() < 0.3 || this.timer <= 0) {
        this.wp = (this.wp + 1) % this.path.length;
        this.state = 'sit';
        this.timer = this.rng.range(3, 7);
      } else {
        this.yaw = turn(this.yaw, Math.atan2(to.x, to.z), 5 * dt);
        want = 0.9;
      }
    } else if (this.timer <= 0) {
      this.state = 'walk';
      this.timer = 12;
    }
    this.speed += (want - this.speed) * (1 - Math.exp(-6 * dt));
    this.position.x += Math.sin(this.yaw) * this.speed * dt;
    this.position.z += Math.cos(this.yaw) * this.speed * dt;
    collideBlockers(this.position, 0.25, blockers);
    // pose: trot, sit, tail sway, head looks at the hero when sitting
    this.phase += dt * (2 + this.speed * 7);
    const moving = Math.min(1, this.speed / 0.6);
    const sitting = this.state === 'sit' ? 1 : 0;
    this.sit += (sitting - this.sit) * (1 - Math.exp(-5 * dt));
    this.legs.forEach((leg, i) => {
      const diag = i === 0 || i === 3 ? 0 : Math.PI;
      leg.rotation.x = Math.sin(this.phase + diag) * 0.6 * moving + (i >= 2 ? -1.1 * this.sit : 0.15 * this.sit);
    });
    this.body.rotation.x = -0.45 * this.sit;
    this.body.position.y = 0.3 - 0.06 * this.sit + Math.abs(Math.sin(this.phase)) * 0.025 * moving;
    this.tail.forEach((seg, i) => {
      seg.rotation.x = -0.5 + 0.25 * i - 0.6 * this.sit + 0.2 * moving;
      seg.rotation.z = Math.sin(this.phase * 0.5 + i * 0.7) * (0.25 + 0.2 * this.sit);
    });
    if (hero && this.sit > 0.5 && heroD < 6) {
      const a = Math.atan2(hero.x - this.position.x, hero.z - this.position.z) - this.yaw;
      this.head.rotation.y += (Math.max(-1, Math.min(1, wrap(a))) - this.head.rotation.y) * (1 - Math.exp(-4 * dt));
    } else this.head.rotation.y *= Math.exp(-3 * dt);
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    if (this.bubble) {
      this.bubble.t += dt;
      this.bubble.at.copy(this.position).setY(0.9);
      if (this.bubble.t > this.bubble.life) this.bubble = null;
    }
  }

  dispose(): void {
    this.root.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turn(from: number, to: number, max: number): number {
  const d = wrap(to - from);
  return from + Math.max(-max, Math.min(max, d));
}
