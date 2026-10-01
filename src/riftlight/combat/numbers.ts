import { type Camera, Vector3 } from 'three/webgpu';
import type { HudColor } from '../../engine/hud/Hud';
import type { PaletteColor } from '../../engine/palette';
import { DAMAGE_TYPES, type DamageType, type HitResult } from '../core/types';

/** Colour of damage numbers by damage type. */
export const DAMAGE_COLORS: Readonly<Record<DamageType, PaletteColor>> = {
  physical: 'white',
  fire: 'orange',
  cold: 'cyan',
  lightning: 'sand',
  chaos: 'lime',
};

interface Floater {
  text: string;
  color: HudColor;
  scale: number;
  /** World anchor (the target's head when it spawned). */
  at: Vector3;
  age: number;
  life: number;
  /** Sideways drift in art pixels per second (alternates so numbers don't stack). */
  drift: number;
}

/** The minimal HUD surface used (the engine's `ctx.hud`). */
export interface NumberHud {
  readonly width: number;
  readonly height: number;
  text(x: number, y: number, text: string, options?: { color?: HudColor; scale?: number; shadow?: HudColor | false }): void;
  measure(text: string, scale?: number): { width: number; height: number };
}

/**
 * Floating damage numbers drawn in pixel text with the HUD: they pop up from the target,
 * rise and drift, then blink out. Crits are double size, colour follows the biggest damage
 * type, the hero's own damage taken is red. Evades and blocks say so.
 *
 *   numbers.spawn(target, result, { hero: target === heroActor });   // usually from the `hit` event
 *   numbers.update(dt);
 *   numbers.draw(ctx.hud, ctx.camera.camera);                        // after the game's hud.clear()
 */
export class DamageNumbers {
  readonly floaters: Floater[] = [];
  /** Hard cap: oldest numbers go first. */
  max = 48;
  private flip = 1;
  private readonly v = new Vector3();

  spawn(at: Vector3, result: HitResult, o: { hero?: boolean; dot?: boolean; height?: number } = {}): void {
    let text: string;
    let color: HudColor;
    if (result.evaded) {
      text = o.hero ? 'DODGE' : 'MISS';
      color = 'mist';
    } else if (result.blocked) {
      text = 'BLOCK';
      color = 'mist';
    } else {
      if (result.total < 0.5) return;
      text = String(Math.round(result.total));
      color = o.hero ? 'red' : o.dot ? 'mist' : DAMAGE_COLORS[dominant(result)];
      if (result.crit) text += '!';
    }
    this.flip = -this.flip;
    this.floaters.push({
      text,
      color,
      scale: result.crit ? 2 : 1,
      at: at.clone().setY(at.y + (o.height ?? 1.8)),
      age: 0,
      life: result.crit ? 0.9 : 0.7,
      drift: this.flip * (6 + (this.floaters.length % 3) * 4),
    });
    if (this.floaters.length > this.max) this.floaters.shift();
  }

  update(dt: number): void {
    for (const f of this.floaters) f.age += dt;
    for (let i = this.floaters.length - 1; i >= 0; i--) if (this.floaters[i]!.age >= this.floaters[i]!.life) this.floaters.splice(i, 1);
  }

  /** Draw every number at its projected screen position, in art pixels. */
  draw(hud: NumberHud, camera: Camera): void {
    for (const f of this.floaters) {
      const p = this.v.copy(f.at).project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const t = f.age / f.life;
      // pop: a quick hop up, then a slow rise; blink in the last 25%
      if (t > 0.75 && Math.floor(f.age * 30) % 2 === 1) continue;
      const rise = 10 * Math.min(1, t * 5) + 10 * t;
      const x = ((p.x + 1) / 2) * hud.width + f.drift * t;
      const y = ((1 - p.y) / 2) * hud.height - rise;
      const size = hud.measure(f.text, f.scale);
      hud.text(Math.round(x - size.width / 2), Math.round(y - size.height), f.text, { color: f.color, scale: f.scale, shadow: 'ink' });
    }
  }

  clear(): void {
    this.floaters.length = 0;
  }
}

function dominant(r: HitResult): DamageType {
  let best: DamageType = 'physical';
  let v = -1;
  for (const t of DAMAGE_TYPES) {
    const d = r.byType[t] ?? 0;
    if (d > v) {
      v = d;
      best = t;
    }
  }
  return best;
}
