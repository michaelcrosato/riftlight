import { Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import { mergeStaticMeshes } from '../../../engine/render/merge';
import { toonMaterial } from '../../../engine/render/toon';
import { VOID } from '../layout/grid';
import { tint } from '../themes/props';
import { asMechanicLevel, box, cellIndexOf, cellSet, cellTiles, centroid, resistFactor, VelocityTracker } from './common';
import type { LevelMechanicDef, MechanicElement } from './types';

/**
 * Level 3 — Gale. Wind lanes push every actor during gusts (on a cycle, telegraphed by
 * streaks). Casuals walk across between gusts or around the lanes; speedrunners ride gusts
 * (tailwind: +move speed) and blow packs into pits (lanes next to pits aim at them).
 */
const PERIOD = 4.2;
const GUST = 1.8;

export const GALE: LevelMechanicDef = {
  id: 'gale',
  name: 'Gale',
  tags: ['wind', 'force'],
  color: 0xf4f4f4,
  description: 'Wind lanes push every actor during gusts.',
  bypass: 'Walk across between gusts, or around the lanes.',
  exploit: 'Ride gusts for a tailwind speed boost; lanes beside pits blow packs into them.',
  place(ctx) {
    const l = ctx.layout;
    const W = l.width;
    for (const room of ctx.rooms({ boss: false })) {
      if (!ctx.rng.chance(0.8)) continue;
      for (let attempt = 0; attempt < 8; attempt++) {
        const alongX = ctx.rng.chance(0.5);
        const span = alongX ? room.h : room.w;
        const lineOff = ctx.rng.int(0, Math.max(0, span - 2));
        // Longest run of free 2-wide cells along this line.
        let best: [number, number] = [0, 0];
        let runStart = -1;
        const len = alongX ? room.w : room.h;
        for (let k = 0; k <= len; k++) {
          const [x, z] = alongX ? [room.x + k, room.z + lineOff] : [room.x + lineOff, room.z + k];
          const ok = k < len && (alongX ? ctx.isFree(x, z) && ctx.isFree(x, z + 1) : ctx.isFree(x, z) && ctx.isFree(x + 1, z));
          if (ok && runStart < 0) runStart = k;
          if (!ok && runStart >= 0) {
            if (k - runStart > best[1] - best[0]) best = [runStart, k];
            runStart = -1;
          }
        }
        const runLen = Math.min(10, best[1] - best[0]);
        if (runLen < 5) continue;
        const k0 = best[0] + ctx.rng.int(0, best[1] - best[0] - runLen);
        const [x0, z0] = alongX ? [room.x + k0, room.z + lineOff] : [room.x + lineOff, room.z + k0];
        const cells = alongX ? ctx.rect(x0, z0, runLen, 2) : ctx.rect(x0, z0, 2, runLen);
        // Aim at a pit if one lies just past either end (blow packs into it).
        const endA = alongX ? l.cell(x0 - 1, z0) : l.cell(x0, z0 - 1);
        const endB = alongX ? l.cell(x0 + runLen, z0) : l.cell(x0, z0 + runLen);
        const sign = endB === VOID ? 1 : endA === VOID ? -1 : ctx.rng.chance(0.5) ? 1 : -1;
        const [cx, cz] = centroid(cells, W);
        const el = ctx.add({
          kind: 'lane',
          x: cx,
          z: cz,
          cells,
          block: 'hazard',
          data: { dx: alongX ? sign : 0, dz: alongX ? 0 : sign, length: runLen, phase: ctx.rng.range(0, PERIOD), pit: endA === VOID || endB === VOID },
        });
        if (el) break;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const lanes = level.elementsOf('gale');
    const byCell = cellSet(lanes);
    const vel = new VelocityTracker();
    const pushedAt = new WeakMap<ActorLike, number>();
    const reported = new WeakSet<ActorLike>();
    const tracked = new WeakSet<ActorLike>();
    const force = new Vector3();
    const dir = (e: MechanicElement) => force.set(e.data.dx as number, 0, e.data.dz as number);
    const gusting = (e: MechanicElement, t: number) => (t + (e.data.phase as number)) % PERIOD < GUST;
    const wasGusting = new Map<number, boolean>();
    let streak = 0;

    // Visuals: a paler lane with chevrons pointing downwind.
    const laneMat = toonMaterial(tint(level.theme.palette.floor, 0.12));
    const chevron = toonMaterial(tint(level.theme.palette.accent, 0.45));
    const sources = [];
    for (const e of lanes) {
      sources.push(...cellTiles(level.layout, e.cells, laneMat, 0.012));
      const dx = e.data.dx as number;
      const dz = e.data.dz as number;
      const n = e.data.length as number;
      const ry = Math.atan2(-dz, dx);
      for (let k = 1; k < n; k += 2) {
        const f = k - n / 2;
        const px = e.x + dx * f;
        const pz = e.z + dz * f;
        // A '>' made of two slanted bars.
        sources.push(box(chevron, px - 0.18 * dx + 0.22 * dz, 0.03, pz - 0.18 * dz + 0.22 * dx, 0.62, 0.05, 0.18, ry + 0.7));
        sources.push(box(chevron, px - 0.18 * dx - 0.22 * dz, 0.03, pz - 0.18 * dz - 0.22 * dx, 0.62, 0.05, 0.18, ry - 0.7));
      }
    }
    for (const m of mergeStaticMeshes(sources, { castShadow: false, receiveShadow: true })) {
      m.name = 'gale:lanes';
      level.root.add(m);
    }

    return {
      update(dt) {
        const t = level.time();
        const hero = level.hero();
        streak -= dt;
        for (const e of lanes) {
          const on = gusting(e, t);
          if (on && !wasGusting.get(e.id)) {
            level.emit('gale', 'gust', new Vector3(e.x, 0, e.z));
            if (hero && Math.hypot(hero.position.x - e.x, hero.position.z - e.z) < 14) level.sound('gust');
          }
          wasGusting.set(e.id, on);
          if (on && streak <= 0 && hero && Math.hypot(hero.position.x - e.x, hero.position.z - e.z) < 18) {
            const n = e.data.length as number;
            const dx = e.data.dx as number;
            const dz = e.data.dz as number;
            const f = level.rng.range(-n / 2, n / 2 - 1);
            level.burst('wind', [e.x + dx * f, 0.6, e.z + dz * f], { direction: [dx, 0.05, dz] });
          }
        }
        if (streak <= 0) streak = 0.12;
      },
      affect(actor, dt) {
        if (!tracked.has(actor)) {
          tracked.add(actor);
          actor.stats.set('mechanic:gale', [inc('move.speed', 0.45, undefined, 'tailwind')]);
        }
        const v = vel.velocity(actor, dt);
        const i = cellIndexOf(level.layout, actor.position);
        const lane = i >= 0 ? byCell.get(i) : undefined;
        const t = level.time();
        // Pushed into a pit by a gust: the speedrunner's favourite.
        const last = pushedAt.get(actor);
        if (last !== undefined && t - last < 0.8 && level.layout.cell(Math.floor(actor.position.x), Math.floor(actor.position.z)) === VOID && !reported.has(actor)) {
          reported.add(actor);
          level.emit('gale', 'blownIntoPit', actor.position);
        }
        if (!lane || !gusting(lane, t)) {
          actor.stats.setCondition('tailwind', false);
          actor.stats.setCondition('inWind', false);
          return;
        }
        const d = dir(lane);
        const hero = actor.faction === 'hero';
        actor.stats.setCondition('tailwind', hero && v.dot(d) > 1);
        // `inWind`: standing in a gust (Galecaller's extra projectile, the Galeborn prefix)
        actor.stats.setCondition('inWind', true);
        // `wind.resist` (the Anchor suffix, Featherfall Sash; Galecaller lowers it to ride gusts harder)
        const accel = hero ? 10 * resistFactor(actor, 'wind.resist') : 18;
        actor.push(d.clone().multiplyScalar(accel * dt));
        pushedAt.set(actor, t);
      },
      dispose() {
        for (const a of level.actors()) {
          a.stats.remove('mechanic:gale');
          a.stats.setCondition('tailwind', false);
          a.stats.setCondition('inWind', false);
        }
      },
    };
  },
};
