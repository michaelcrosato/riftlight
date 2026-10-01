import { ConeGeometry } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import { mergeStaticMeshes } from '../../../engine/render/merge';
import { toonMaterial } from '../../../engine/render/toon';
import { tint } from '../themes/props';
import { asMechanicLevel, cellIndexOf, cellSet, cellTiles, centroid, growBlob, mechanicDamage, mesh, monsterScaleDamage } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 5 — Thornweave. Vine traps hurt and slow anyone inside them, monsters included.
 * Casuals step around them; power-levellers kite packs through the thorns, and every kill
 * the thorns make feeds a stacking XP harvest buff.
 */
const TICK = 0.5;
const spikeGeo = new ConeGeometry(0.5, 1, 4);
spikeGeo.userData.shared = true;

export const THORNWEAVE: LevelMechanicDef = {
  id: 'thornweave',
  name: 'Thornweave',
  tags: ['nature', 'hazard', 'physical'],
  color: 0x38b764,
  description: 'Vine traps that hurt and slow anyone inside, monsters included.',
  bypass: 'Step around the thorn patches.',
  exploit: 'Kite packs through the thorns: kills the thorns make grant a stacking XP harvest.',
  place(ctx) {
    const W = ctx.layout.width;
    for (const room of ctx.rooms({ boss: true })) {
      const n = ctx.rng.int(1, 3);
      for (let s = 0, tries = 0; s < n && tries < 10; tries++) {
        const free = ctx.free({ room: room.id, minClearance: 1 });
        if (!free.length) break;
        const c = ctx.rng.pick(free);
        const cells = growBlob(ctx, c.x, c.z, ctx.rng.int(4, 12));
        if (cells.length < 3) continue;
        const [x, z] = centroid(cells, W);
        if (ctx.add({ kind: 'thorns', x, z, cells, block: 'hazard' })) s++;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const patches = level.elementsOf('thornweave');
    const thorns = cellSet(patches);
    const depth = level.depth;
    const vine = toonMaterial(tint(level.theme.palette.wall, 0.1));
    const leaf = toonMaterial(tint(0x38b764, -0.25));
    const tip = toonMaterial(0xb13e53);
    const sources = [];
    for (const e of patches) {
      sources.push(...cellTiles(level.layout, e.cells, vine, 0.012, 0.06));
      const rng = level.rng.fork(`thorns:${e.id}`);
      for (const i of e.cells) {
        const cx = i % level.layout.width;
        const cz = Math.floor(i / level.layout.width);
        for (let k = 0; k < 3; k++) {
          const h = rng.range(0.35, 0.75);
          const m = mesh(spikeGeo, rng.chance(0.25) ? tip : leaf, cx + rng.range(0.15, 0.85), h / 2, cz + rng.range(0.15, 0.85));
          m.scale.set(0.22, h, 0.22);
          m.rotation.set(rng.range(-0.5, 0.5), rng.range(0, 3), rng.range(-0.5, 0.5));
          sources.push(m);
        }
      }
    }
    for (const m of mergeStaticMeshes(sources, { receiveShadow: true })) {
      m.name = 'thornweave:thorns';
      level.root.add(m);
    }

    const tracked = new WeakSet<ActorLike>();
    const timers = new WeakMap<ActorLike, number>();
    const inThornsNow = new WeakSet<ActorLike>();
    let harvest = 0;
    const offKill = level.events.on('kill', ({ target }) => {
      if (target.faction !== 'monster' || !inThornsNow.has(target)) return;
      harvest++;
      const hero = level.hero();
      if (hero) level.buff(hero, 'mechanic:thornweave:harvest', [inc('xp.gain', Math.min(1, 0.08 * harvest))], 12);
      level.emit('thornweave', 'harvest', target.position);
    });
    return {
      affect(actor, dt) {
        if (!tracked.has(actor)) {
          tracked.add(actor);
          actor.stats.set('mechanic:thornweave', [inc('move.speed', -0.35, undefined, 'inThorns')]);
        }
        const i = cellIndexOf(level.layout, actor.position);
        const inside = i >= 0 && thorns.has(i);
        actor.stats.setCondition('inThorns', inside);
        if (!inside) {
          inThornsNow.delete(actor);
          timers.delete(actor);
          return;
        }
        inThornsNow.add(actor);
        const t = (timers.get(actor) ?? 0) - dt;
        if (t > 0) {
          timers.set(actor, t);
          return;
        }
        timers.set(actor, TICK);
        const amount = actor.faction === 'hero' ? mechanicDamage(depth, 5) : monsterScaleDamage(depth, 6);
        level.damage(actor, { physical: amount }, 'thornweave', { ailments: { bleed: 0.3 } });
        level.burst('thorn', [actor.position.x, 0.5, actor.position.z]);
        if (actor.faction === 'hero') level.sound('thorn');
        level.emit('thornweave', 'thornHit', actor.position);
      },
      dispose() {
        offKill();
        for (const a of level.actors()) {
          a.stats.remove('mechanic:thornweave');
          a.stats.setCondition('inThorns', false);
        }
      },
    };
  },
};
