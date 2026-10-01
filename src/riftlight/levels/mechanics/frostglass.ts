import { OctahedronGeometry, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import { mergeStaticMeshes } from '../../../engine/render/merge';
import { toonMaterial } from '../../../engine/render/toon';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, cellIndexOf, cellSet, cellTiles, centroid, growBlob, heroFlat, mesh, monsterScaleDamage, VelocityTracker } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 4 — Frostglass. Ice sheets: on ice, actors keep their momentum (they slide and carry
 * speed) and monsters are brittle; a monster that dies on ice (or frozen) shatters into a
 * cold nova that can shatter its neighbours. The main road stays stone; slide-dashing and
 * shatter chains are the exploit.
 *
 * `shatter.chance` (Frostglass Edge: 100%) lets the hero's kills shatter anywhere in the level,
 * off the ice too: every kill can start a chain.
 */
const SHATTER_RADIUS = 3;
const shardGeo = new OctahedronGeometry(0.5, 0);
shardGeo.userData.shared = true;

export const FROSTGLASS: LevelMechanicDef = {
  id: 'frostglass',
  name: 'Frostglass',
  tags: ['ice', 'surface', 'cold'],
  excludes: ['mire'],
  color: 0x41a6f6,
  description: 'Ice floors: actors slide and keep momentum; monsters that die on ice shatter and chain.',
  bypass: 'Stay on the stone paths: the main road is never iced.',
  exploit: 'Slide-dash across sheets for speed; kill packs on ice for chained shatters.',
  place(ctx) {
    const W = ctx.layout.width;
    for (const room of ctx.rooms({ boss: true })) {
      const sheets = ctx.rng.int(1, 2);
      for (let s = 0, tries = 0; s < sheets && tries < 8; tries++) {
        const free = ctx.free({ room: room.id, minClearance: 2 });
        if (!free.length) break;
        const c = ctx.rng.pick(free);
        const cells = growBlob(ctx, c.x, c.z, ctx.rng.int(10, 26));
        if (cells.length < 6) continue;
        const [x, z] = centroid(cells, W);
        if (ctx.add({ kind: 'ice', x, z, cells, block: 'hazard' })) s++;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const sheets = level.elementsOf('frostglass');
    const ice = cellSet(sheets);
    const vel = new VelocityTracker();
    const tracked = new WeakSet<ActorLike>();
    const depth = level.depth;
    const iceMat = toonMaterial(tint(level.theme.palette.accent, 0.35));
    const rim = toonMaterial(tint(level.theme.palette.accent, -0.1));
    const shard = glowMaterial(tint(level.theme.palette.accent, 0.5));
    const sources = [];
    for (const e of sheets) {
      sources.push(...cellTiles(level.layout, e.cells, iceMat, 0.015));
      // Frost spikes around the sheet's edge cells.
      const rng = level.rng.fork(`ice:${e.id}`);
      for (const i of e.cells) {
        if (!rng.chance(0.18)) continue;
        const x = (i % level.layout.width) + rng.range(0.2, 0.8);
        const z = Math.floor(i / level.layout.width) + rng.range(0.2, 0.8);
        const m = mesh(shardGeo, rng.chance(0.5) ? rim : shard, x, 0.22, z, 1);
        m.scale.set(0.22, rng.range(0.4, 0.8), 0.22);
        m.rotation.set(rng.range(-0.3, 0.3), rng.range(0, 3), rng.range(-0.3, 0.3));
        sources.push(m);
      }
    }
    for (const m of mergeStaticMeshes(sources, { receiveShadow: true })) {
      m.name = 'frostglass:ice';
      level.root.add(m);
    }
    const lights = sheets.map((e) => level.light({ position: [e.x, 0.8, e.z], color: level.theme.palette.accent, intensity: 1.6, radius: 4, flicker: 'pulse', name: 'ice' }));

    // Shatter: monsters that die on ice (or frozen) burst; the burst can shatter neighbours.
    let chain = 0;
    let chainUntil = 0;
    const onIce = (a: ActorLike) => {
      const i = cellIndexOf(level.layout, a.position);
      return i >= 0 && ice.has(i);
    };
    const shatter = (at: Vector3) => {
      const t = level.time();
      chain = t < chainUntil ? chain + 1 : 0;
      chainUntil = t + 0.6;
      for (const a of level.actors()) {
        if (!a.alive || a.faction !== 'monster') continue;
        if (Math.hypot(a.position.x - at.x, a.position.z - at.z) > SHATTER_RADIUS) continue;
        level.damage(a, { cold: monsterScaleDamage(depth, 22) * (1 + 0.2 * chain) }, 'frostglass', { ailments: { chill: 1, freeze: onIce(a) ? 0.5 : 0.1 } });
      }
      level.burst('frost', [at.x, 0.6, at.z]);
      level.sound('shatter', { pitch: chain });
      level.light({ position: [at.x, 1, at.z], color: 0xc8f8ff, intensity: 8, radius: 6, lifetime: 0.3, fadeIn: 0.02, fadeOut: 0.25, priority: 2, name: 'shatter' });
      level.emit('frostglass', chain ? 'shatterChain' : 'shatter', at);
      const hero = level.hero();
      if (chain > 0 && hero) level.buff(hero, 'mechanic:frostglass:chain', [inc('xp.gain', 0.12 * chain), inc('damage', 0.06 * chain, ['cold'])], 8);
    };
    // each corpse shatters once (on ice, frozen, or by the hero's `shatter.chance`)
    const shattered = new WeakSet<ActorLike>();
    const shatterOnce = (target: ActorLike) => {
      if (shattered.has(target)) return;
      shattered.add(target);
      shatter(target.position.clone());
    };
    const affixRng = level.rng.fork('shatter.chance');
    const offKill = level.events.on('kill', ({ target, killer }) => {
      if (target.faction !== 'monster') return;
      if (onIce(target)) return shatterOnce(target);
      const hero = level.hero();
      // the killer may be the hero, or one of its minions / totems / traps
      const mine = !!hero && !!killer && (killer === hero || (killer as { owner?: unknown }).owner === hero);
      const chance = mine ? heroFlat(hero, 'shatter.chance') : 0;
      if (chance > 0 && affixRng.chance(Math.min(1, chance))) shatterOnce(target);
    });
    const offHit = level.events.on('hit', ({ target, result }) => {
      if (target.faction === 'monster' && result.killed && result.ailments.includes('freeze') && !onIce(target)) shatterOnce(target);
    });

    const slide = new Vector3();
    return {
      affect(actor, dt) {
        if (!tracked.has(actor)) {
          tracked.add(actor);
          actor.stats.set('mechanic:frostglass', [inc('move.speed', 0.25, undefined, 'onIce'), inc('damage.taken', 0.2, ['cold'], 'onIce')]);
        }
        const v = vel.velocity(actor, dt);
        const on = onIce(actor);
        actor.stats.setCondition('onIce', on);
        // Momentum: keep pushing along the current velocity (hard to stop, easy to carry speed).
        if (on && v.lengthSq() > 0.25) actor.push(slide.copy(v).multiplyScalar(2.2 * dt));
      },
      dispose() {
        offKill();
        offHit();
        for (const l of lights) l?.release();
        for (const a of level.actors()) {
          a.stats.remove('mechanic:frostglass');
          a.stats.setCondition('onIce', false);
        }
      },
    };
  },
};
