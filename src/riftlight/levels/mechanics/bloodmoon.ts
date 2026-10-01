import { type Mesh, RingGeometry, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import type { LightHandle } from '../../../engine/render/lights';
import { toonMaterial } from '../../../engine/render/toon';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, box, mechanicDamage, mesh, monsterScaleDamage, perRoom, slotOrFree } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 10 — Bloodmoon. Under the red moon, monsters explode shortly after they die (a red
 * ring telegraphs it), hurting everything around, which can chain across a room. Blood
 * altars grant a pact: while it lasts, blasts spare the hero and heal it. Chains stack an
 * XP buff. Combined with Embers braziers in designed level 10.
 *
 * Listens to `kill` events: combat must emit `kill` for every monster death.
 */
const RADIUS = 2.8;
const FUSE = 0.55;
const PACT = 20;
/**
 * Blasts landing on the hero together hurt less each: the k-th within this many seconds
 * deals 1/k (a pack of ten dying at once is ~3 blasts' worth, not ten).
 */
const STACK_WINDOW = 0.5;
const ringGeo = new RingGeometry(0.82, 1, 20).rotateX(-Math.PI / 2);
ringGeo.userData.shared = true;

export const BLOODMOON: LevelMechanicDef = {
  id: 'bloodmoon',
  name: 'Bloodmoon',
  tags: ['blood', 'explosive', 'on-kill'],
  excludes: ['gloom'],
  color: 0xff4060,
  description: 'Monsters explode on death, hurting everything nearby.',
  bypass: 'Fight carefully: step out of the red rings.',
  exploit: 'Chain explosions across a room; make a blood pact at an altar to be spared and healed.',
  place(ctx) {
    const W = ctx.layout.width;
    const rooms = ctx.rng.shuffle(ctx.rooms({ boss: false })).slice(0, ctx.rng.int(2, 3));
    perRoom(
      rooms,
      () => 1,
      (room) => {
        const c = slotOrFree(ctx, room, 2);
        return !!c && !!ctx.add({ kind: 'altar', x: c.x + 0.5, z: c.z + 0.5, cells: [c.z * W + c.x], block: 'solid' });
      },
    );
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const depth = level.depth;
    level.env.tint = 0xff3048;
    level.env.tintAmount = 0.35;
    level.env.ambient *= 0.85;
    const stone = toonMaterial(tint(level.theme.palette.wall, 0.15));
    const blood = glowMaterial(0xd02040);
    const ringMat = glowMaterial(0xff3050);
    const altars: { at: Vector3; used: boolean; pool: Mesh; light: LightHandle | null }[] = [];
    for (const e of level.elementsOf('bloodmoon')) {
      const parts = [box(stone, e.x, 0.3, e.z, 1, 0.6, 0.7), box(stone, e.x, 0.7, e.z, 0.8, 0.2, 0.55)];
      const pool = box(blood, e.x, 0.82, e.z, 0.6, 0.04, 0.38);
      for (const p of [...parts, pool]) {
        p.name = 'bloodmoon:altar';
        level.root.add(p);
      }
      altars.push({ at: new Vector3(e.x, 0.8, e.z), used: false, pool, light: level.light({ position: [e.x, 1.2, e.z], color: 0xff3048, intensity: 3, radius: 5, flicker: 'pulse', name: 'altar' }) });
    }

    interface Blast {
      at: Vector3;
      due: number;
      ring: Mesh;
      chain: number;
    }
    const blasts: Blast[] = [];
    let lastBlast = { at: new Vector3(), time: -10, chain: 0 };
    let pactUntil = -1;
    let heroBlasts: number[] = [];
    const off = level.events.on('kill', ({ target, rank }) => {
      if (target.faction !== 'monster' || rank === 'boss') return;
      const t = level.time();
      const near = t - lastBlast.time < 0.35 && target.position.distanceTo(lastBlast.at) < RADIUS + 1.5;
      const ring = mesh(ringGeo, ringMat, target.position.x, 0.04, target.position.z, RADIUS);
      ring.castShadow = false;
      ring.name = 'bloodmoon:ring';
      level.root.add(ring);
      blasts.push({ at: target.position.clone(), due: t + FUSE, ring, chain: near ? lastBlast.chain + 1 : 0 });
    });
    const explode = (b: Blast) => {
      b.ring.removeFromParent();
      const t = level.time();
      lastBlast = { at: b.at, time: t, chain: b.chain };
      const pact = t < pactUntil;
      for (const a of level.actors()) {
        if (!a.alive) continue;
        if (Math.hypot(a.position.x - b.at.x, a.position.z - b.at.z) > RADIUS + a.radius) continue;
        if (a.faction === 'hero') {
          if (pact) {
            heal(a, 0.04);
            continue;
          }
          heroBlasts = heroBlasts.filter((at) => t - at < STACK_WINDOW);
          heroBlasts.push(t);
          level.damage(a, { physical: mechanicDamage(depth, 16) / heroBlasts.length }, 'bloodmoon', { knockback: 6, from: b.at });
        } else level.damage(a, { physical: monsterScaleDamage(depth, 30) * (1 + 0.2 * b.chain) }, 'bloodmoon', { knockback: 6, from: b.at, ailments: { bleed: 0.5 } });
      }
      level.burst('blood', [b.at.x, 0.6, b.at.z]);
      level.sound('blood-boom', { pitch: -b.chain });
      level.light({ position: [b.at.x, 1, b.at.z], color: 0xff3040, intensity: 12, radius: 7, lifetime: 0.35, fadeIn: 0.02, fadeOut: 0.25, priority: 2, name: 'bloodblast' });
      level.emit('bloodmoon', b.chain ? 'chain' : 'explode', b.at);
      const hero = level.hero();
      if (b.chain >= 1 && hero) level.buff(hero, 'mechanic:bloodmoon:chain', [inc('xp.gain', 0.15 * b.chain)], 10);
    };
    const heal = (a: ActorLike, frac: number) => {
      const max = a.stats.get('life');
      if (max > 0) a.life = Math.min(max, a.life + max * frac);
    };
    return {
      update() {
        const t = level.time();
        const hero = level.hero();
        for (let i = blasts.length - 1; i >= 0; i--) {
          const b = blasts[i]!;
          b.ring.visible = Math.floor((b.due - t) * 16) % 2 === 0;
          if (t >= b.due) {
            blasts.splice(i, 1);
            explode(b);
          }
        }
        if (hero)
          for (const al of altars) {
            if (al.used || Math.hypot(hero.position.x - al.at.x, hero.position.z - al.at.z) > 1.6) continue;
            al.used = true;
            al.pool.visible = false;
            al.light?.update({ intensity: 0.8 });
            pactUntil = t + PACT;
            level.buff(hero, 'mechanic:bloodmoon:pact', [inc('damage', 0.2), inc('life.onKill', 0.02)], PACT);
            level.burst('blood', al.at, { count: 16 });
            level.sound('shrine');
            level.emit('bloodmoon', 'pact', al.at);
          }
      },
      dispose() {
        off();
        for (const b of blasts) b.ring.removeFromParent();
        for (const a of altars) a.light?.release();
      },
    };
  },
};
