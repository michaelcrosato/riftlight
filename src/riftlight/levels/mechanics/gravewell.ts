import { Group, type Mesh, RingGeometry, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import type { LightHandle } from '../../../engine/render/lights';
import { mergeStaticMeshes } from '../../../engine/render/merge';
import { toonMaterial } from '../../../engine/render/toon';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, cellTiles, mesh, OctaGeo } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 11 — Gravewell. Gravity wells pull every actor toward their core, strongest in a
 * pulse every few seconds (the hero resists better than monsters). Casuals avoid the wells
 * (they never reach the main road); power-levellers let wells group packs for area skills,
 * and every kill inside a well grants a stacking gravity shard (more area).
 */
const RADIUS = 3;
const PERIOD = 5;
const PULSE = 2.2;
const ringGeo = new RingGeometry(0.9, 1, 24).rotateX(-Math.PI / 2);
ringGeo.userData.shared = true;

export const GRAVEWELL: LevelMechanicDef = {
  id: 'gravewell',
  name: 'Gravewell',
  tags: ['force', 'cosmic', 'grouping'],
  color: 0x9a7aff,
  description: 'Gravity wells pull actors toward their core in pulses.',
  bypass: 'Avoid the wells: they never reach the main road.',
  exploit: 'Let wells group packs for area skills; kills inside a well stack gravity shards (more area).',
  place(ctx) {
    // As big as the room allows: radius 3, else 2.5, else 2 (the pull reaches no further).
    for (const room of ctx.rooms({ boss: true })) {
      if (!ctx.rng.chance(0.7)) continue;
      let placed = false;
      for (const radius of [RADIUS, 2.5, 2]) {
        const free = ctx.rng.shuffle(ctx.free({ room: room.id, minClearance: Math.ceil(radius) }));
        for (const c of free.slice(0, 16)) {
          const cells = ctx.disc(c.x + 0.5, c.z + 0.5, radius);
          if (!cells.every((i) => ctx.isFree(i % ctx.layout.width, Math.floor(i / ctx.layout.width)))) continue;
          if (ctx.add({ kind: 'well', x: c.x + 0.5, z: c.z + 0.5, cells, block: 'hazard', data: { phase: ctx.rng.range(0, PERIOD), radius } })) {
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const accent = 0x9a7aff;
    const dark = toonMaterial(tint(level.theme.palette.floor, -0.5));
    const ringMat = glowMaterial(accent);
    const coreMat = glowMaterial(tint(accent, 0.5));
    interface Well {
      at: Vector3;
      radius: number;
      phase: number;
      rings: Group;
      core: Mesh;
      light: LightHandle | null;
      pulsing: boolean;
    }
    const wells: Well[] = [];
    const floor = level.elementsOf('gravewell').flatMap((e) => cellTiles(level.layout, e.cells, dark, 0.012));
    for (const m of mergeStaticMeshes(floor, { castShadow: false })) {
      m.name = 'gravewell:floor';
      level.root.add(m);
    }
    for (const e of level.elementsOf('gravewell')) {
      const rings = new Group();
      rings.name = 'gravewell:rings';
      for (let k = 0; k < 3; k++) {
        const r = mesh(ringGeo, ringMat, 0, 0.03 + k * 0.01, 0, 1);
        r.castShadow = false;
        rings.add(r);
      }
      rings.position.set(e.x, 0, e.z);
      const core = mesh(OctaGeo, coreMat, e.x, 1.2, e.z, 0.6);
      core.castShadow = false;
      core.name = 'gravewell:core';
      level.root.add(rings, core);
      wells.push({
        at: new Vector3(e.x, 0, e.z),
        radius: (e.data.radius as number) ?? RADIUS,
        phase: e.data.phase as number,
        rings,
        core,
        pulsing: false,
        light: level.light({ position: [e.x, 1.2, e.z], color: accent, intensity: 3, radius: 6, flicker: 'pulse', name: 'well' }),
      });
    }
    const pulse = (w: Well, t: number) => (t + w.phase) % PERIOD < PULSE;
    // Kills inside a well: gravity shards.
    let shards = 0;
    const inWell = (a: ActorLike) => wells.some((w) => Math.hypot(a.position.x - w.at.x, a.position.z - w.at.z) < w.radius);
    const off = level.events.on('kill', ({ target }) => {
      if (target.faction !== 'monster' || !inWell(target)) return;
      shards = Math.min(5, shards + 1);
      const hero = level.hero();
      if (hero) level.buff(hero, 'mechanic:gravewell:shards', [inc('area', 0.08 * shards), inc('xp.gain', 0.05 * shards)], 15);
      level.emit('gravewell', 'shard', target.position);
    });
    const pull = new Vector3();
    return {
      update() {
        const t = level.time();
        const hero = level.hero();
        for (const w of wells) {
          const on = pulse(w, t);
          // Rings contract toward the core while pulling.
          const local = ((t + w.phase) % PERIOD) / (on ? PULSE : PERIOD);
          w.rings.children.forEach((r, k) => {
            const s = w.radius * (1 - ((local + k / 3) % 1) * (on ? 0.85 : 0.2));
            r.scale.setScalar(Math.max(0.3, s));
          });
          w.core.position.y = 1.2 + Math.sin(t * 2) * 0.15;
          w.core.rotation.y = t * (on ? 4 : 1);
          if (on && !w.pulsing) {
            w.light?.update({ intensity: 6 });
            if (hero && hero.position.distanceTo(w.at) < 14) level.sound('well-pulse');
            level.burst('grav', [w.at.x, 0.5, w.at.z]);
            level.emit('gravewell', 'pulse', w.at);
          } else if (!on && w.pulsing) w.light?.update({ intensity: 3 });
          w.pulsing = on;
        }
      },
      affect(actor, dt) {
        const t = level.time();
        for (const w of wells) {
          const dx = w.at.x - actor.position.x;
          const dz = w.at.z - actor.position.z;
          const d = Math.hypot(dx, dz);
          if (d > w.radius + 0.4 || d < 0.3) continue;
          const strength = (pulse(w, t) ? 14 : 4) * (1 - d / (w.radius + 0.4)) * (actor.faction === 'hero' ? 0.45 : 1);
          actor.push(pull.set(dx / d, 0, dz / d).multiplyScalar(strength * dt));
        }
      },
      dispose() {
        off();
        for (const w of wells) w.light?.release();
      },
    };
  },
};
