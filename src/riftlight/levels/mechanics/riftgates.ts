import { type Mesh, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import type { LightHandle } from '../../../engine/render/lights';
import { toonMaterial } from '../../../engine/render/toon';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, box, heroScale, monsterScaleDamage } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 9 — Riftgates. Paired portals link rooms far apart on the main road: step in, come
 * out at the partner gate (any actor: knock monsters through!). Casuals walk the long way;
 * speedrunners take every shortcut (each jump also grants a short rift-haste).
 */
const COOLDOWN = 1.5;
/**
 * `gate.damage` (Gatewarden's Key, the Gatekeeper suffix): passing a gate tears at monsters
 * (chaos damage, × the bonus) and empowers the hero (increased damage by the bonus) for a moment;
 * the hero is `recentlyGated` meanwhile either way.
 */
const GATED = 4;
const TEAR = 25;

export const RIFTGATES: LevelMechanicDef = {
  id: 'riftgates',
  name: 'Riftgates',
  tags: ['arcane', 'teleport'],
  excludes: ['collapse'],
  color: 0xff4fc8,
  description: 'Paired portals between rooms far apart on the main road.',
  bypass: 'Walk the long way.',
  exploit: 'Take the shortcuts (rift-haste on every jump) and knock monsters through gates.',
  place(ctx) {
    const l = ctx.layout;
    const crit = l.critical.slice(0, -1); // not the boss room
    const pairs = Math.min(3, 1 + (ctx.depth > 10 ? 1 : 0) + (crit.length > 7 ? 1 : 0));
    const gateIn = (room: number) => {
      const free = ctx.free({ room, minClearance: 2 }).filter((c) => [0, 1, 2, 3].every((k) => ctx.isFree(c.x + [1, -1, 0, 0][k]!, c.z + [0, 0, 1, -1][k]!)));
      return free.length ? ctx.rng.pick(free) : null;
    };
    for (let p = 0, tries = 0; p < pairs && tries < 20; tries++) {
      if (crit.length < 3) break;
      const i = ctx.rng.int(0, Math.max(0, crit.length - 3));
      const j = Math.min(crit.length - 1, i + ctx.rng.int(2, 4));
      const a = gateIn(crit[i]!);
      const b = gateIn(crit[j]!);
      if (!a || !b) continue;
      const dataA: Record<string, number | string | boolean> = { pair: p, partner: -1 };
      const dataB: Record<string, number | string | boolean> = { pair: p, partner: -1 };
      const ga = ctx.add({ kind: 'gate', x: a.x + 0.5, z: a.z + 0.5, cells: ctx.disc(a.x + 0.5, a.z + 0.5, 1), block: 'zone', data: dataA });
      if (!ga) continue;
      const gb = ctx.add({ kind: 'gate', x: b.x + 0.5, z: b.z + 0.5, cells: ctx.disc(b.x + 0.5, b.z + 0.5, 1), block: 'zone', data: dataB });
      if (!gb) continue;
      dataA.partner = gb.id;
      dataB.partner = ga.id;
      p++;
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const accent = 0xff4fc8;
    const stone = toonMaterial(tint(level.theme.palette.wall, 0.2));
    const rune = toonMaterial(tint(level.theme.trim, -0.45));
    const veil = glowMaterial(accent);
    const veil2 = glowMaterial(tint(accent, 0.5));
    interface Gate {
      id: number;
      at: Vector3;
      out: Vector3;
      partner: number;
      core: Mesh;
      light: LightHandle | null;
    }
    const gates = new Map<number, Gate>();
    for (const e of level.elementsOf('riftgates')) {
      if (e.data.partner === -1) continue; // a half pair (refused partner): inert
      // Arch: two posts and a lintel around a glowing veil, facing the room's centre.
      const room = level.layout.rooms[e.room];
      const cx = room ? room.x + room.w / 2 : e.x;
      const cz = room ? room.z + room.h / 2 : e.z;
      const out = new Vector3(cx - e.x, 0, cz - e.z);
      if (out.lengthSq() < 0.01) out.set(1, 0, 0);
      out.normalize();
      const ry = Math.atan2(out.x, out.z);
      const side = new Vector3(Math.cos(ry), 0, -Math.sin(ry));
      const parts = [
        box(rune, e.x, 0.04, e.z, 1.9, 0.08, 1.9, ry),
        box(stone, e.x + side.x * 0.85, 1.1, e.z + side.z * 0.85, 0.32, 2.2, 0.32, ry),
        box(stone, e.x - side.x * 0.85, 1.1, e.z - side.z * 0.85, 0.32, 2.2, 0.32, ry),
        box(stone, e.x, 2.3, e.z, 2.1, 0.3, 0.36, ry),
      ];
      const core = box(veil, e.x, 1.1, e.z, 1.35, 2.0, 0.08, ry);
      const inner = box(veil2, e.x, 1.1, e.z, 0.8, 1.5, 0.1, ry);
      core.castShadow = inner.castShadow = false;
      for (const p of [...parts, core, inner]) {
        p.name = 'riftgates:gate';
        level.root.add(p);
      }
      gates.set(e.id, {
        id: e.id,
        at: new Vector3(e.x, 0, e.z),
        out,
        partner: e.data.partner as number,
        core,
        light: level.light({ position: [e.x, 1.3, e.z], color: accent, intensity: 4, radius: 6, flicker: 'spell', name: 'gate' }),
      });
    }
    const cooldown = new WeakMap<ActorLike, number>();
    let gatedUntil = -1;
    const to = new Vector3();
    return {
      update() {
        const t = level.time();
        for (const g of gates.values()) g.core.scale.x = 1.35 * (0.9 + 0.1 * Math.sin(t * 5 + g.id));
        if (gatedUntil >= 0 && t >= gatedUntil) {
          gatedUntil = -1;
          level.hero()?.stats.setCondition('recentlyGated', false);
        }
      },
      affect(actor) {
        const t = level.time();
        if ((cooldown.get(actor) ?? -1) > t) return;
        for (const g of gates.values()) {
          if (Math.hypot(actor.position.x - g.at.x, actor.position.z - g.at.z) > 0.75) continue;
          const dest = gates.get(g.partner);
          if (!dest) return;
          to.copy(dest.at).addScaledVector(dest.out, 1.6).setY(actor.position.y);
          level.burst('rift', [actor.position.x, 1, actor.position.z]);
          if (level.hooks.teleport) level.hooks.teleport(actor, to);
          else actor.position.copy(to);
          cooldown.set(actor, t + COOLDOWN);
          level.burst('rift', [to.x, 1, to.z]);
          level.sound('warp');
          level.emit('riftgates', 'teleport', to.clone());
          const bonus = heroScale(level.hero(), 'gate.damage') - 1;
          if (actor.faction === 'hero') {
            level.buff(actor, 'mechanic:riftgates:haste', [inc('move.speed', 0.3)], 3);
            if (bonus > 0) level.buff(actor, 'mechanic:riftgates:empower', [inc('damage', bonus)], GATED);
            actor.stats.setCondition('recentlyGated', true);
            gatedUntil = t + GATED;
          } else if (actor.faction === 'monster' && bonus > 0) {
            level.damage(actor, { chaos: monsterScaleDamage(level.depth, TEAR) * bonus }, 'riftgates', { from: to });
            level.emit('riftgates', 'tear', to.clone());
          }
          return;
        }
      },
      dispose() {
        level.hero()?.stats.setCondition('recentlyGated', false);
        for (const g of gates.values()) g.light?.release();
      },
    };
  },
};
