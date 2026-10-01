import { Group, Vector3 } from 'three/webgpu';
import { inc } from '../../core/mods';
import { toonMaterial } from '../../../engine/render/toon';
import type { LightHandle } from '../../../engine/render/lights';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, box, heroHas, heroScale, OctaGeo, mesh, perRoom, slotOrFree } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 8 — Echoes. An echo of the hero replays every skill 2 s later from where it was cast
 * (half damage). Resonance crystals stand in the rooms: near one, echoes hit at full damage
 * and the hero gets a damage buff, so burst windows can be double-dipped.
 *
 * Needs combat: `hooks.replaySkill(actor, skill, { at, damageScale, tags: ['echo'] })`.
 * Without it the echo still shows (ghost + sound) and emits its events.
 *
 * Loot that bends it (The Second Voice, Twinfang, the Resonant prefix):
 *   echo.damage         inc/more: echoes hit harder
 *   echo.delay          inc: the echo comes sooner (−25%) or later
 *   echo.repeatsSkills  flag: every cast echoes twice (a second ghost one delay later)
 */
const DELAY = 2;
/** The shortest an echo's delay can get (s). */
const MIN_DELAY = 0.5;
const RESONANCE_RADIUS = 3.5;

export const ECHOES: LevelMechanicDef = {
  id: 'echoes',
  name: 'Echoes',
  tags: ['arcane', 'replay'],
  color: 0xc890ff,
  description: 'An echo replays your attacks 2 s later from where you cast them.',
  bypass: 'Ignore it: echoes only add damage.',
  exploit: 'Fight next to resonance crystals: echoes hit at full damage and you deal more, double-dipping burst windows.',
  place(ctx) {
    const W = ctx.layout.width;
    perRoom(
      ctx.rooms({ boss: true }),
      () => 1,
      (room) => {
        const c = slotOrFree(ctx, room, 2);
        return !!c && !!ctx.add({ kind: 'resonator', x: c.x + 0.5, z: c.z + 0.5, cells: [c.z * W + c.x], block: 'solid' });
      },
    );
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const accent = 0xc890ff;
    const crystal = glowMaterial(accent);
    const base = toonMaterial(tint(level.theme.palette.wall, 0.25));
    const resonators: { at: Vector3; light: LightHandle | null }[] = [];
    for (const e of level.elementsOf('echoes')) {
      const parts = [box(base, e.x, 0.15, e.z, 0.9, 0.3, 0.9), mesh(OctaGeo, crystal, e.x, 1.1, e.z, 1)];
      parts[1]!.scale.set(0.5, 1.2, 0.5);
      for (const p of parts) {
        p.name = 'echoes:resonator';
        level.root.add(p);
      }
      resonators.push({ at: new Vector3(e.x, 1, e.z), light: level.light({ position: [e.x, 1.4, e.z], color: accent, intensity: 3, radius: 5, flicker: 'spell', name: 'resonator' }) });
    }
    // Ghosts: a translucent-looking silhouette (glow boxes) where the echo will cast.
    const ghostMat = glowMaterial(tint(accent, 0.3));
    const makeGhost = (at: Vector3) => {
      const g = new Group();
      g.add(box(ghostMat, 0, 0.45, 0, 0.36, 0.9, 0.26), box(ghostMat, 0, 1.1, 0, 0.5, 0.5, 0.3), box(ghostMat, 0, 1.5, 0, 0.28, 0.28, 0.28));
      for (const c of g.children) c.castShadow = false;
      g.position.set(at.x, 0, at.z);
      g.name = 'echoes:ghost';
      level.root.add(g);
      return g;
    };
    interface Pending {
      skill: string;
      at: Vector3;
      due: number;
      ghost: Group;
      resonant: boolean;
    }
    const pending: Pending[] = [];
    const resonantAt = (p: Vector3) => resonators.some((r) => Math.hypot(r.at.x - p.x, r.at.z - p.z) < RESONANCE_RADIUS);
    const off = level.events.on('skill', ({ actor, skill }) => {
      // the hero's own casts (its totems and traps cast too, but they don't echo)
      if (actor !== level.hero() || skill.startsWith('echo:')) return;
      const at = actor.position.clone();
      const resonant = resonantAt(at);
      const delay = Math.max(MIN_DELAY, DELAY * heroScale(actor, 'echo.delay'));
      pending.push({ skill, at, due: level.time() + delay, ghost: makeGhost(at), resonant });
      if (heroHas(actor, 'echo.repeatsSkills')) pending.push({ skill, at, due: level.time() + delay * 2, ghost: makeGhost(at), resonant });
      level.emit('echoes', 'record', at);
      if (resonant) level.buff(actor, 'mechanic:echoes:resonance', [inc('damage', 0.15)], 4);
    });

    return {
      update() {
        const t = level.time();
        const hero = level.hero();
        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i]!;
          // The ghost flickers faster as the replay approaches.
          p.ghost.visible = Math.floor((p.due - t) * (p.due - t < 0.6 ? 20 : 6)) % 2 === 0;
          if (t < p.due) continue;
          pending.splice(i, 1);
          p.ghost.removeFromParent();
          level.burst('echo', [p.at.x, 1, p.at.z]);
          level.sound('echo');
          level.emit('echoes', 'replay', p.at);
          if (hero) level.hooks.replaySkill?.(hero, p.skill, { at: p.at, facing: null, damageScale: (p.resonant ? 1 : 0.5) * heroScale(hero, 'echo.damage'), tags: ['echo'] });
        }
      },
      dispose() {
        off();
        for (const p of pending) p.ghost.removeFromParent();
        for (const r of resonators) r.light?.release();
      },
    };
  },
};
