import { Group, type Mesh, OctahedronGeometry, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import type { LightHandle } from '../../../engine/render/lights';
import { toonMaterial } from '../../../engine/render/toon';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, box, heroFlat, mechanicDamage, mesh, monsterScaleDamage, PropTarget } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 6 — Stormspire. Lightning pylons stand in linked pairs; every few seconds the pair
 * charges (crackle, brighter tips) and an arc jumps between them, shocking anything on the
 * line. Casuals ignore pylons (arcs never cross the main road). Hitting a pylon overcharges
 * it: for a while its arcs fire fast, hurt only monsters and leap to monsters nearby.
 */
const PERIOD = 3.5;
const CHARGE = 0.7;
const ARC = 0.45;
const OVERCHARGE = 8;
/** `pylon.chain` (Stormspire Conductor, the Conductor suffix): each monster an arc hits jumps it to this many more within reach (m), at this share of the damage. */
const CHAIN_REACH = 5;
const CHAIN_SHARE = 0.7;
/** The hero counts as `nearPylon` (the Pylonbound prefix) within this many metres of a pylon. */
const NEAR_PYLON = 4;
const tipGeo = new OctahedronGeometry(0.5, 0);
tipGeo.userData.shared = true;

export const STORMSPIRE: LevelMechanicDef = {
  id: 'stormspire',
  name: 'Stormspire',
  tags: ['lightning', 'hazard', 'destructible'],
  color: 0xffe066,
  description: 'Lightning pylons chain arcs between conductors on a cycle.',
  bypass: 'Ignore the pylons: their arcs never cross the main road.',
  exploit: 'Hit a pylon to overcharge it: fast arcs that only hurt monsters and leap down the corridor.',
  place(ctx) {
    const W = ctx.layout.width;
    for (const room of ctx.rooms({ boss: true })) {
      if (!ctx.rng.chance(0.75)) continue;
      for (let tries = 0; tries < 14; tries++) {
        const free = ctx.free({ room: room.id, minClearance: 1 });
        if (free.length < 4) break;
        const a = ctx.rng.pick(free);
        const len = ctx.rng.int(3, 6);
        const [dx, dz] = ctx.rng.pick([
          [1, 0],
          [0, 1],
          [1, 1],
          [1, -1],
        ] as const);
        const bx = a.x + dx * len;
        const bz = a.z + dz * len;
        if (!ctx.isFree(bx, bz)) continue;
        // The arc's cells (between the pylons) must be free too.
        const arc: number[] = [];
        let ok = true;
        for (let k = 1; k < len && ok; k++) {
          const x = a.x + dx * k;
          const z = a.z + dz * k;
          if (!ctx.isFree(x, z)) ok = false;
          else arc.push(z * W + x);
        }
        if (!ok) continue;
        const pa = ctx.add({ kind: 'pylon', x: a.x + 0.5, z: a.z + 0.5, cells: [a.z * W + a.x], block: 'solid' });
        if (!pa) continue;
        const pb = ctx.add({ kind: 'pylon', x: bx + 0.5, z: bz + 0.5, cells: [bz * W + bx], block: 'solid' });
        if (!pb) continue; // pa stays as a lone conductor
        ctx.add({ kind: 'arc', x: (a.x + bx) / 2 + 0.5, z: (a.z + bz) / 2 + 0.5, cells: arc, block: 'hazard', data: { a: pa.id, b: pb.id, phase: ctx.rng.range(0, PERIOD) } });
        break;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const depth = level.depth;
    const els = level.elementsOf('stormspire');
    const stone = toonMaterial(tint(level.theme.palette.wall, 0.2));
    const metal = toonMaterial(level.theme.trim);
    const tipOn = glowMaterial(0xfff0a0);
    const tipOff = toonMaterial(0x8a8030);
    const boltMat = glowMaterial(0xfff7c8);

    interface Pylon {
      id: number;
      at: Vector3;
      tip: Mesh;
      light: LightHandle | null;
      target: PropTarget;
      over: number;
    }
    const pylons = new Map<number, Pylon>();
    for (const e of els) {
      if (e.kind !== 'pylon') continue;
      const parts = [box(stone, e.x, 0.3, e.z, 0.8, 0.6, 0.8), box(stone, e.x, 1.2, e.z, 0.44, 1.4, 0.44, Math.PI / 4), box(metal, e.x, 1.95, e.z, 0.6, 0.12, 0.6)];
      for (const p of parts) {
        p.name = 'stormspire:pylon';
        level.root.add(p);
      }
      const tip = mesh(tipGeo, tipOff, e.x, 2.35, e.z, 0.5);
      level.root.add(tip);
      const at = new Vector3(e.x, 2.3, e.z);
      const p: Pylon = { id: e.id, at, tip, light: null, target: null!, over: 0 };
      p.light = level.light({ position: at, color: 0xffe9a0, intensity: 2.5, radius: 5, flicker: 'strobe', name: 'pylon' });
      p.target = new PropTarget('pylon', new Vector3(e.x, 0, e.z), 0.45, () => {
        p.over = OVERCHARGE;
        level.emit('stormspire', 'overcharge', at);
        level.sound('zap', { pitch: 5 });
        return true;
      });
      level.addTarget(p.target);
      pylons.set(e.id, p);
    }
    const arcs = els
      .filter((e) => e.kind === 'arc')
      .map((e) => ({ e, a: pylons.get(e.data.a as number)!, b: pylons.get(e.data.b as number)!, phase: e.data.phase as number, bolt: new Group(), firing: false, timer: 0 }))
      .filter((x) => x.a && x.b);
    for (const arc of arcs) {
      arc.bolt.name = 'stormspire:bolt';
      arc.bolt.visible = false;
      level.root.add(arc.bolt);
    }

    /** Rebuild a jagged bolt of glowing boxes between two points. */
    const drawBolt = (g: Group, from: Vector3, to: Vector3) => {
      g.clear();
      const n = 6;
      let prev = from.clone();
      for (let k = 1; k <= n; k++) {
        const p = from.clone().lerp(to, k / n);
        if (k < n) p.add(new Vector3(level.rng.range(-0.35, 0.35), level.rng.range(-0.3, 0.3), level.rng.range(-0.35, 0.35)));
        const mid = prev.clone().add(p).multiplyScalar(0.5);
        const seg = box(boltMat, mid.x, mid.y, mid.z, 0.12, 0.12, prev.distanceTo(p) + 0.08);
        seg.castShadow = false;
        seg.lookAt(p);
        g.add(seg);
        prev = p;
      }
    };
    const segDist = (p: Vector3, a: Vector3, b: Vector3) => {
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1)));
      return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
    };
    /** Short-lived leap bolts (removed by game time, not wall time). */
    const leaps: { g: Group; until: number }[] = [];
    let conducted = 0;
    /** `pylon.chain`: from a struck monster, the arc leaps on to the nearest unstruck monsters. */
    const chain = (from: ActorLike, struck: Set<ActorLike>, amount: number, monstersOnly: boolean) => {
      let left = Math.round(heroFlat(level.hero(), 'pylon.chain'));
      let at = from;
      while (left-- > 0) {
        let next: ActorLike | null = null;
        let best = CHAIN_REACH;
        for (const a of level.actors()) {
          if (!a.alive || a.faction !== 'monster' || struck.has(a)) continue;
          const d = a.position.distanceTo(at.position);
          if (d < best) {
            best = d;
            next = a;
          }
        }
        if (!next) return;
        struck.add(next);
        const g = new Group();
        drawBolt(g, at.position.clone().setY(1), next.position.clone().setY(1));
        g.name = 'stormspire:chain';
        level.root.add(g);
        leaps.push({ g, until: level.time() + 0.15 });
        const r = level.damage(next, { lightning: amount * CHAIN_SHARE }, 'stormspire', { ailments: { shock: 0.5 } });
        level.emit('stormspire', 'chain', next.position);
        if (monstersOnly && r?.killed) conducted++;
        at = next;
      }
    };
    const zap = (from: Vector3, to: Vector3, monstersOnly: boolean, mult: number) => {
      const struck = new Set<ActorLike>();
      for (const actor of level.actors()) {
        if (!actor.alive || (monstersOnly && actor.faction !== 'monster')) continue;
        if (segDist(actor.position, from, to) > 0.7 + actor.radius) continue;
        const amount = actor.faction === 'hero' ? mechanicDamage(depth, 14) : monsterScaleDamage(depth, 18) * mult;
        struck.add(actor);
        const r = level.damage(actor, { lightning: amount }, 'stormspire', { ailments: { shock: 0.5 } });
        if (actor.faction === 'monster') chain(actor, struck, amount, monstersOnly);
        // Overcharged kills feed the conductor buff (the power-leveller's reward).
        const hero = level.hero();
        if (monstersOnly && r?.killed && hero) {
          conducted++;
          level.buff(hero, 'mechanic:stormspire:conductor', [inc('xp.gain', Math.min(0.6, 0.1 * conducted)), inc('damage', 0.1, ['lightning'])], 10);
          level.emit('stormspire', 'conduct', actor.position);
        }
      }
    };

    return {
      update(dt) {
        const t = level.time();
        const hero = level.hero();
        if (hero) {
          let near = false;
          for (const p of pylons.values()) if (Math.hypot(hero.position.x - p.at.x, hero.position.z - p.at.z) < NEAR_PYLON) near = true;
          hero.stats.setCondition('nearPylon', near);
        }
        for (let i = leaps.length - 1; i >= 0; i--)
          if (leaps[i]!.until <= t) {
            leaps[i]!.g.removeFromParent();
            leaps.splice(i, 1);
          }
        for (const p of pylons.values()) {
          if (p.over > 0) {
            p.over -= dt;
            // Overcharged: leap to a monster nearby every half second.
            if (Math.floor((p.over + dt) * 2) !== Math.floor(p.over * 2)) {
              const near = level.actors().find((a) => a.alive && a.faction === 'monster' && a.position.distanceTo(p.at) < 6);
              if (near) {
                const to = near.position.clone().setY(1);
                const g = new Group();
                drawBolt(g, p.at, to);
                g.name = 'stormspire:leap';
                level.root.add(g);
                leaps.push({ g, until: t + 0.12 });
                zap(p.at, to, true, 1.5);
                level.emit('stormspire', 'zap', to);
              }
            }
          }
        }
        for (const arc of arcs) {
          const over = arc.a.over > 0 || arc.b.over > 0;
          const period = over ? 0.6 : PERIOD;
          const local = (t + arc.phase) % period;
          const charging = !over && local > period - CHARGE;
          const firing = local < ARC * (over ? 0.6 : 1);
          arc.a.tip.material = charging || firing || over ? tipOn : tipOff;
          arc.b.tip.material = arc.a.tip.material;
          if (charging && level.rng.chance(0.25)) {
            level.burst('spark', arc.a.at, { count: 3 });
            level.burst('spark', arc.b.at, { count: 3 });
          }
          if (firing && !arc.firing) {
            drawBolt(arc.bolt, arc.a.at, arc.b.at);
            zap(arc.a.at, arc.b.at, over, over ? 1.5 : 1);
            const mid = arc.a.at.clone().lerp(arc.b.at, 0.5);
            level.light({ position: mid, color: 0xfff2b0, intensity: 9, radius: 7, lifetime: ARC, fadeIn: 0.02, fadeOut: 0.15, priority: 2, name: 'arc' });
            if (hero && hero.position.distanceTo(mid) < 14) level.sound('zap', { volume: 0.7 });
            level.emit('stormspire', 'arc', mid);
          }
          arc.firing = firing;
          arc.bolt.visible = firing;
        }
      },
      dispose() {
        level.hero()?.stats.setCondition('nearPylon', false);
        for (const p of pylons.values()) {
          level.removeTarget(p.target);
          p.light?.release();
        }
      },
    };
  },
};
