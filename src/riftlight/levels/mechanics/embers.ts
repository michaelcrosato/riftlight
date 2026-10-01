import { type Mesh, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import { buildProp } from '../themes/props';
import { asMechanicLevel, heroHas, heroScale, mechanicDamage, monsterScaleDamage, perRoom, PropTarget, slotOrFree } from './common';
import type { LevelMechanicDef } from './types';
import type { LightHandle } from '../../../engine/render/lights';

/**
 * Level 1 — Embers. Explosive braziers: hit one and it blasts everything near it, lighting
 * any brazier in reach a moment later. Casuals fight normally; speedrunners pull packs onto
 * braziers and chain the blasts (each link hits harder and stacks an XP/fire buff).
 */
const BLAST_RADIUS = 3.2;
const CHAIN_RADIUS = 4.6;
const RELIGHT = 18;
/** Seconds the hero burns harmlessly after a blast with `brazier.selfIgnite` (the `ignited` condition). */
const SELF_IGNITE = 6;

/**
 * Loot that bends Embers (read off the hero when a brazier blows):
 *   brazier.area       inc: blast and chain radius (× √)
 *   brazier.damage     inc: blast damage to monsters
 *   explosion.damage   inc: every explosion, braziers included
 *   brazier.selfIgnite flag: blasts don't hurt you; they set you alight (`ignited` for 6 s:
 *                      Emberheart's 10% more damage while ignited)
 */

export const EMBERS: LevelMechanicDef = {
  id: 'embers',
  name: 'Embers',
  tags: ['fire', 'explosive', 'destructible'],
  color: 0xef7d57,
  description: 'Explosive braziers: hit one to blast everything near it; blasts ignite nearby braziers.',
  bypass: 'Fight normally; braziers only explode when hit.',
  exploit: 'Pull packs onto braziers and chain the blasts: each link hits harder and stacks an XP and fire-damage buff.',
  place(ctx) {
    const per = ctx.depth > 6 ? 3 : 2;
    perRoom(
      ctx.rooms({ boss: true }),
      (r) => (ctx.layout.room(r.id).tags.includes('boss') ? 4 : per),
      (room) => {
        const c = slotOrFree(ctx, room, 2);
        if (!c) return false;
        return !!ctx.add({ kind: 'brazier', x: c.x + 0.5, z: c.z + 0.5, cells: [c.z * ctx.layout.width + c.x], block: 'solid' });
      },
    );
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const depth = level.depth;
    interface Brazier {
      at: Vector3;
      target: PropTarget;
      flames: Mesh[];
      light: LightHandle | null;
      lit: boolean;
      fuse: number;
      chain: number;
      relight: number;
      puff: number;
    }
    const braziers: Brazier[] = [];
    for (const e of level.elementsOf('embers')) {
      const p = buildProp('brazier', { theme: level.theme, rng: level.rng.fork(`brazier:${e.id}`) }, e.x, e.z);
      p.root.name = 'embers:brazier';
      level.root.add(p.root);
      const at = new Vector3(e.x, 1.2, e.z);
      const flames = p.root.children.filter((m) => (m as Mesh).material && ((m as Mesh).material as { name: string }).name.startsWith('glow')) as Mesh[];
      const g = p.glow!;
      const light = level.light({ position: [e.x + g.offset[0], g.offset[1], e.z + g.offset[2]], color: g.color, intensity: g.intensity, radius: g.radius, flicker: 'brazier', name: 'brazier' });
      const b: Brazier = { at, target: null!, flames, light, lit: true, fuse: -1, chain: 0, relight: 0, puff: level.rng.range(0, 1) };
      b.target = new PropTarget('brazier', new Vector3(e.x, 0, e.z), 0.45, (hit) => {
        if (!b.lit || b.fuse >= 0) return false;
        b.fuse = 0.12;
        b.chain = 0;
        void hit;
        return true;
      });
      level.addTarget(b.target);
      braziers.push(b);
    }

    let ignitedFor = 0;
    const explode = (b: Brazier) => {
      b.lit = false;
      b.relight = RELIGHT;
      for (const f of b.flames) f.visible = false;
      b.light?.update({ intensity: 0 });
      const hero = level.hero();
      const area = Math.sqrt(heroScale(hero, 'brazier.area'));
      const mult = (1 + 0.25 * b.chain) * heroScale(hero, 'brazier.damage') * heroScale(hero, 'explosion.damage');
      const selfIgnite = heroHas(hero, 'brazier.selfIgnite');
      for (const a of level.actors()) {
        if (!a.alive) continue;
        const d = Math.hypot(a.position.x - b.at.x, a.position.z - b.at.z);
        if (d > BLAST_RADIUS * area + a.radius) continue;
        if (a === hero && selfIgnite) {
          ignitedFor = SELF_IGNITE;
          a.stats.setCondition('ignited', true);
          level.burst('ember-blast', [a.position.x, 1, a.position.z], { count: 8 });
          level.emit('embers', 'selfIgnite', a.position);
          continue;
        }
        const amount = a.faction === 'hero' ? mechanicDamage(depth, 18) : monsterScaleDamage(depth, 34) * mult;
        level.damage(a, { fire: amount }, 'embers', { knockback: 9, from: b.at, ailments: { ignite: 0.5 } });
      }
      level.light({ position: b.at, color: 0xffb060, intensity: 16, radius: 9 * area, lifetime: 0.45, fadeIn: 0.02, fadeOut: 0.3, priority: 3, name: 'blast' });
      level.burst('ember-blast', b.at, { scale: area });
      level.sound('ember-boom', { pitch: -b.chain });
      level.emit('embers', b.chain ? 'chain' : 'explode', b.at);
      if (b.chain > 0 && hero) level.buff(hero, 'mechanic:embers:chain', [inc('xp.gain', 0.1 * b.chain), inc('damage', 0.05 * b.chain, ['fire'])], 8);
      // Light the fuse of every brazier in reach.
      for (const o of braziers) {
        if (o === b || !o.lit || o.fuse >= 0) continue;
        if (o.at.distanceTo(b.at) <= CHAIN_RADIUS * area) {
          o.fuse = 0.28;
          o.chain = b.chain + 1;
        }
      }
    };

    return {
      update(dt) {
        const hero = level.hero();
        if (ignitedFor > 0) {
          ignitedFor -= dt;
          if (ignitedFor <= 0) hero?.stats.setCondition('ignited', false);
          else if (hero && Math.floor((ignitedFor + dt) * 6) !== Math.floor(ignitedFor * 6)) level.burst('ember', [hero.position.x, 1.2, hero.position.z]);
        }
        for (const b of braziers) {
          if (b.fuse >= 0) {
            b.fuse -= dt;
            if (b.fuse < 0) explode(b);
          } else if (!b.lit) {
            b.relight -= dt;
            if (b.relight <= 0) {
              b.lit = true;
              for (const f of b.flames) f.visible = true;
              b.light?.update({ intensity: level.theme.torch.intensity });
              level.emit('embers', 'relight', b.at);
            }
          } else if (hero && hero.position.distanceToSquared(b.at) < 196) {
            b.puff -= dt;
            if (b.puff <= 0) {
              b.puff = 0.5 + level.rng.next() * 0.6;
              level.burst('ember', [b.at.x, 1.35, b.at.z]);
            }
          }
        }
      },
      dispose() {
        level.hero()?.stats.setCondition('ignited', false);
        for (const b of braziers) {
          level.removeTarget(b.target);
          b.light?.release();
        }
      },
    };
  },
};
