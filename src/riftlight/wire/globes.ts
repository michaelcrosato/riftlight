import { Mesh, type Object3D, SphereGeometry, Vector3 } from 'three/webgpu';
import type { GameContext } from '../../engine';
import type { Actor } from '../actors/Actor';
import type { Rank } from '../core/scaling';
import type { Rng } from '../core/rng';
import { glowMaterial } from '../levels/themes/props';
import { WIRE_TUNING } from './tuning';

const G = WIRE_TUNING.globes;

let geo: SphereGeometry | null = null;
function sphere(): SphereGeometry {
  if (!geo) {
    geo = new SphereGeometry(0.22, 8, 6);
    geo.userData.shared = true;
  }
  return geo;
}

interface Globe {
  readonly mesh: Mesh;
  readonly at: Vector3;
  age: number;
}

/**
 * Health globes: kills sometimes drop a red orb that heals the hero who walks through it
 * (Diablo's answer to "a fast game with no potions"). Elites drop them more often, bosses a
 * shower. They bob, blink before they fade, and need no light (an unlit glow material).
 */
export class Globes {
  private readonly list: Globe[] = [];

  constructor(
    private readonly root: Object3D,
    private readonly ctx: GameContext,
    private readonly rng: Rng,
  ) {
    // a speck drawn from the first frame, so the first real globe never builds a shader mid-fight
    const warm = new Mesh(sphere(), glowMaterial(0xb13e53));
    warm.scale.setScalar(1e-4);
    warm.frustumCulled = false;
    warm.name = 'globe-warm';
    root.add(warm);
  }

  get count(): number {
    return this.list.length;
  }

  /** A monster of `rank` died at `at`: maybe some globes. */
  drop(rank: Rank, at: Vector3): void {
    const n = rank === 'boss' ? G.boss : this.rng.chance(G.chance[rank] ?? 0) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = n > 1 ? this.rng.range(0.6, 1.8) : 0;
      const p = new Vector3(at.x + Math.sin(a) * r, 0.45, at.z + Math.cos(a) * r);
      const mesh = new Mesh(sphere(), glowMaterial(0xb13e53));
      mesh.name = 'globe';
      mesh.castShadow = false;
      mesh.position.copy(p);
      this.root.add(mesh);
      this.list.push({ mesh, at: p, age: 0 });
    }
  }

  /** Fixed step: the hero picks up what it touches. */
  fixedUpdate(dt: number, hero: Actor | null): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i]!;
      g.age += dt;
      const taken = hero && hero.alive && Math.hypot(hero.position.x - g.at.x, hero.position.z - g.at.z) < G.reach;
      if (taken) {
        hero.heal(hero.maxLife * G.heal);
        hero.mana = Math.min(hero.maxMana, hero.mana + hero.maxMana * G.mana);
        this.ctx.particles.burst('sparkle', g.at, { count: 10, colors: ['red', 'orange', 'white'] });
        this.ctx.audio.play('rl.gold', { pitch: -5, volume: 0.6 });
      }
      if (taken || g.age > G.life) {
        g.mesh.removeFromParent();
        this.list.splice(i, 1);
      }
    }
  }

  /** Frame: bob, and blink in the last seconds. */
  update(time: number): void {
    for (const g of this.list) {
      g.mesh.position.y = g.at.y + Math.sin(time * 4 + g.at.x) * 0.08;
      g.mesh.visible = g.age < G.life - 3 || Math.floor(g.age * 8) % 2 === 0;
    }
  }

  /** Where the globes are (the bot walks to them when hurt). */
  positions(): readonly Vector3[] {
    return this.list.map((g) => g.at);
  }

  dispose(): void {
    for (const g of this.list) g.mesh.removeFromParent();
    this.list.length = 0;
  }
}
