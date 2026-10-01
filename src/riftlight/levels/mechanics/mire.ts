import { type Mesh, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import { mergeStaticMeshes } from '../../../engine/render/merge';
import { toonMaterial } from '../../../engine/render/toon';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, box, cellIndexOf, cellSet, cellTiles, centroid, growBlob, heroHas, heroScale } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 7 — Mire. Slowing mud pools, and haste pads that grant a burst of speed; chaining
 * pads (touching the next one while hasted) extends and strengthens the burst. Mud slows
 * monsters too. Combined with Gale in the designed level 7: gusts over the mire.
 */
const RECHARGE = 6;
const HASTE = 3;
// Mirestride and the Quickmire suffix: `mire.immune` (mud never slows the hero) and
// `haste.duration` (inc: haste pads last longer, so chains are easier to keep up).

export const MIRE: LevelMechanicDef = {
  id: 'mire',
  name: 'Mire',
  tags: ['surface', 'slow', 'speed'],
  excludes: ['frostglass'],
  color: 0x8a7a40,
  description: 'Slowing mud pools and haste pads.',
  bypass: 'Slog through or walk around the mud; the main road stays dry.',
  exploit: 'Chain haste pads for stacking speed; fight packs bogged down in mud.',
  place(ctx) {
    const W = ctx.layout.width;
    for (const room of ctx.rooms({ boss: true })) {
      const n = ctx.rng.int(1, 2);
      for (let s = 0, tries = 0; s < n && tries < 8; tries++) {
        const free = ctx.free({ room: room.id, minClearance: 2 });
        if (!free.length) break;
        const c = ctx.rng.pick(free);
        const cells = growBlob(ctx, c.x, c.z, ctx.rng.int(8, 20));
        if (cells.length < 5) continue;
        const [x, z] = centroid(cells, W);
        if (ctx.add({ kind: 'mud', x, z, cells, block: 'hazard' })) s++;
      }
    }
    // Haste pads two cells beside the main road, every ~8 cells: a chain for speedrunners.
    const path = ctx.layout.path;
    for (let i = 5; i < path.length - 3; i += 8) {
      const p = path[i]!;
      for (const [dx, dz] of ctx.rng.shuffle([
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ] as [number, number][])) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (ctx.isFree(x, z) && ctx.add({ kind: 'haste', x: x + 0.5, z: z + 0.5, cells: [z * W + x], block: 'zone' })) break;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const els = level.elementsOf('mire');
    const mud = cellSet(els.filter((e) => e.kind === 'mud'));
    const mudMat = toonMaterial(tint(level.theme.palette.floor, -0.35));
    const slick = toonMaterial(tint(level.theme.palette.accent, -0.45));
    const sources: Mesh[] = [];
    for (const e of els) {
      if (e.kind !== 'mud') continue;
      sources.push(...cellTiles(level.layout, e.cells, mudMat, 0.012));
      const rng = level.rng.fork(`mud:${e.id}`);
      for (const i of e.cells) if (rng.chance(0.2)) sources.push(...cellTiles(level.layout, [i], slick, 0.02, 0.55));
    }
    for (const m of mergeStaticMeshes(sources, { castShadow: false, receiveShadow: true })) {
      m.name = 'mire:mud';
      level.root.add(m);
    }
    const padOff = toonMaterial(tint(level.theme.palette.wall, 0.1));
    const padOn = glowMaterial(0xa7f070);
    const pads = els
      .filter((e) => e.kind === 'haste')
      .map((e) => {
        const base = box(padOff, e.x, 0.05, e.z, 0.9, 0.1, 0.9);
        const rune = box(padOn, e.x, 0.11, e.z, 0.5, 0.04, 0.5, Math.PI / 4);
        rune.castShadow = false;
        base.name = rune.name = 'mire:haste';
        level.root.add(base, rune);
        const light = level.light({ position: [e.x, 0.6, e.z], color: 0xa7f070, intensity: 1.8, radius: 3.5, flicker: 'pulse', name: 'haste' });
        return { at: new Vector3(e.x, 0, e.z), rune, light, recharge: 0 };
      });

    const tracked = new WeakSet<ActorLike>();
    let chain = 0;
    let hasteUntil = 0;
    let bubble = 0;
    return {
      update(dt) {
        const t = level.time();
        const hero = level.hero();
        for (const p of pads) {
          if (p.recharge > 0) {
            p.recharge -= dt;
            if (p.recharge <= 0) {
              p.rune.visible = true;
              p.light?.update({ intensity: 1.8 });
            }
            continue;
          }
          if (!hero || Math.hypot(hero.position.x - p.at.x, hero.position.z - p.at.z) > 0.9) continue;
          chain = t < hasteUntil ? chain + 1 : 0;
          const last = (HASTE + chain) * heroScale(hero, 'haste.duration');
          hasteUntil = t + last;
          p.recharge = RECHARGE;
          p.rune.visible = false;
          p.light?.update({ intensity: 0 });
          level.buff(hero, 'mechanic:mire:haste', [inc('move.speed', 0.5 + 0.1 * Math.min(chain, 5)), inc('attack.speed', 0.15)], last);
          level.burst('haste', [p.at.x, 0.3, p.at.z]);
          level.sound('haste', { pitch: Math.min(chain, 7) });
          level.emit('mire', chain ? 'hasteChain' : 'haste', p.at);
        }
        bubble -= dt;
        if (bubble <= 0 && hero && mud.size) {
          bubble = 0.3;
          const cells = [...mud.keys()];
          const i = cells[level.rng.int(0, cells.length - 1)]!;
          const x = (i % level.layout.width) + 0.5;
          const z = Math.floor(i / level.layout.width) + 0.5;
          if (Math.hypot(hero.position.x - x, hero.position.z - z) < 14) level.burst('mud', [x, 0.05, z]);
        }
      },
      affect(actor) {
        if (!tracked.has(actor)) {
          tracked.add(actor);
          actor.stats.set('mechanic:mire', [inc('move.speed', -0.45, undefined, 'inMud')]);
        }
        const i = cellIndexOf(level.layout, actor.position);
        actor.stats.setCondition('inMud', i >= 0 && mud.has(i) && !(actor.faction === 'hero' && heroHas(actor, 'mire.immune')));
      },
      dispose() {
        for (const p of pads) p.light?.release();
        for (const a of level.actors()) {
          a.stats.remove('mechanic:mire');
          a.stats.setCondition('inMud', false);
        }
      },
    };
  },
};
