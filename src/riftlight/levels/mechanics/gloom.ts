import { type Mesh, Vector3 } from 'three/webgpu';
import { inc, more } from '../../core/mods';
import type { ActorLike } from '../../core/types';
import { toonMaterial } from '../../../engine/render/toon';
import type { LightHandle } from '../../../engine/render/lights';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, box, heroScale, perRoom, slotOrFree } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 2 — Gloom. Darkness: the level's ambient light drops, the hero carries a small light,
 * and anything standing in the dark is harder to fight (monsters in the dark deal more
 * damage; the hero takes more). Lanterns relight their surroundings when the hero walks up to
 * one. Will-o'-wisps light the main road. Lighting every lantern grants a big XP shrine buff.
 */
const LANTERN_RADIUS = 7;
/** Seconds the all-lit shrine buff lasts, before the hero's `lantern.duration` (inc). */
const SHRINE = 90;
const WISP_RADIUS = 3.6;
const HERO_RADIUS = 4.5;

export const GLOOM: LevelMechanicDef = {
  id: 'gloom',
  name: 'Gloom',
  tags: ['dark', 'light'],
  excludes: ['bloodmoon'],
  color: 0x73eff7,
  description: 'Darkness: the light radius matters, lanterns relight areas, monsters hit harder in the dark.',
  bypass: 'Stay near the lit main road: wisps light the way to the exit.',
  exploit: 'Light every lantern: each one adds XP gain, and all of them together grant a big shrine buff.',
  place(ctx) {
    const W = ctx.layout.width;
    // Lanterns in rooms (side rooms too: detours pay).
    perRoom(
      ctx.rooms({ boss: true }),
      () => (ctx.rng.chance(0.7) ? 1 : 2),
      (room) => {
        const c = slotOrFree(ctx, room, 2);
        return !!c && !!ctx.add({ kind: 'lantern', x: c.x + 0.5, z: c.z + 0.5, cells: [c.z * W + c.x], block: 'solid' });
      },
    );
    // Wisps beside the critical path every ~9 cells (zones: decorative, walkable).
    const path = ctx.layout.path;
    for (let i = 6; i < path.length - 4; i += 9) {
      const p = path[i]!;
      const opts: [number, number][] = [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
        [2, 2],
        [-2, -2],
      ];
      for (const [dx, dz] of ctx.rng.shuffle(opts)) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (ctx.isFree(x, z) && ctx.add({ kind: 'wisp', x: x + 0.5, z: z + 0.5, cells: [z * W + x], block: 'zone' })) break;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    level.env.ambient *= 0.32;
    level.env.sun *= 0.2;
    const theme = level.theme;
    const lightColor = theme.palette.light;

    interface Lantern {
      at: Vector3;
      lit: boolean;
      lamp: Mesh;
      light: LightHandle | null;
    }
    const lanterns: Lantern[] = [];
    const wisps: { at: Vector3; orb: Mesh; light: LightHandle | null; phase: number }[] = [];
    const post = toonMaterial(tint(theme.palette.wall, 0.15));
    const unlit = toonMaterial(tint(theme.palette.wall, -0.2));
    const lit = glowMaterial(tint(lightColor, 0.2));
    for (const e of level.elementsOf('gloom')) {
      if (e.kind === 'lantern') {
        const parts = [box(post, e.x, 0.75, e.z, 0.18, 1.5, 0.18), box(post, e.x, 1.55, e.z, 0.5, 0.1, 0.5), box(post, e.x, 0.06, e.z, 0.6, 0.12, 0.6)];
        const lamp = box(unlit, e.x, 1.32, e.z, 0.34, 0.34, 0.34);
        for (const p of [...parts, lamp]) {
          p.name = 'gloom:lantern';
          level.root.add(p);
        }
        lanterns.push({ at: new Vector3(e.x, 1.3, e.z), lit: false, lamp, light: null });
      } else {
        const orb = box(glowMaterial(theme.palette.accent), e.x, 1.1, e.z, 0.22, 0.22, 0.22);
        orb.castShadow = false;
        orb.name = 'gloom:wisp';
        level.root.add(orb);
        const light = level.light({ position: [e.x, 1.2, e.z], color: theme.palette.accent, intensity: 2.6, radius: 5, flicker: 'candle', name: 'wisp' });
        wisps.push({ at: new Vector3(e.x, 1.1, e.z), orb, light, phase: level.rng.range(0, 6) });
      }
    }

    // The hero's own light (high priority: it always gets one of the pool's lights).
    let heroLight: LightHandle | null = null;
    let litCount = 0;
    let check = 0;
    const marked = new WeakSet<ActorLike>();
    const darkMods = {
      monster: [more('damage', 0.35, undefined, 'inDark')],
      hero: [inc('damage.taken', 0.2, undefined, 'inDark')],
    };
    const inLight = (a: ActorLike): boolean => {
      const p = a.position;
      for (const l of lanterns) if (l.lit && (p.x - l.at.x) ** 2 + (p.z - l.at.z) ** 2 < LANTERN_RADIUS ** 2) return true;
      for (const w of wisps) if ((p.x - w.at.x) ** 2 + (p.z - w.at.z) ** 2 < WISP_RADIUS ** 2) return true;
      const hero = level.hero();
      if (hero && a !== hero && (p.x - hero.position.x) ** 2 + (p.z - hero.position.z) ** 2 < (HERO_RADIUS * 0.7) ** 2) return true;
      return false;
    };

    return {
      update(dt) {
        const hero = level.hero();
        const t = level.time();
        if (hero && !heroLight) heroLight = level.light({ follow: null, position: hero.position, color: lightColor, intensity: 5, radius: HERO_RADIUS, priority: 8, flicker: 'candle', name: 'hero-light' });
        if (hero && heroLight) {
          const r = HERO_RADIUS * (hero.stats.get('light.radius') || 1); // a multiplier stat (base 1)
          heroLight.update({ radius: r });
          heroLight.position.set(hero.position.x, hero.position.y + 1.6, hero.position.z);
        }
        for (const w of wisps) w.orb.position.y = 1.1 + Math.sin(t * 2 + w.phase) * 0.12;
        // Lanterns light up when the hero walks up to them.
        if (hero)
          for (const l of lanterns) {
            if (l.lit || (hero.position.x - l.at.x) ** 2 + (hero.position.z - l.at.z) ** 2 > 1.8 ** 2) continue;
            l.lit = true;
            l.lamp.material = lit;
            l.light = level.light({ position: l.at, color: lightColor, intensity: theme.torch.intensity + 1, radius: LANTERN_RADIUS, flicker: 'candle', fadeIn: 0.6, name: 'lantern' });
            litCount++;
            level.burst('wisp', l.at, { count: 10 });
            level.sound('lantern');
            level.emit('gloom', 'lanternLit', l.at);
            // `lantern.duration` (Lantern of the Lost, the Lamplighter suffix) stretches what lanterns give
            const last = heroScale(hero, 'lantern.duration');
            level.buff(hero, 'mechanic:gloom:lanterns', [inc('xp.gain', 0.05 * litCount)], 600 * last);
            if (litCount === lanterns.length) {
              level.buff(hero, 'mechanic:gloom:shrine', [inc('xp.gain', 0.5), more('damage', 0.15), inc('light.radius', 0.5)], SHRINE * last);
              level.emit('gloom', 'allLit', hero.position);
              level.sound('shrine');
            }
          }
        // Dark checks are cheap but needn't run every frame.
        check -= dt;
        if (check > 0) return;
        check = 0.2;
        for (const a of level.actors()) {
          if (!marked.has(a)) {
            marked.add(a);
            a.stats.set('mechanic:gloom', a.faction === 'hero' ? darkMods.hero : darkMods.monster);
          }
          a.stats.setCondition('inDark', !inLight(a));
        }
      },
      dispose() {
        heroLight?.release();
        for (const l of lanterns) l.light?.release();
        for (const w of wisps) w.light?.release();
        for (const a of level.actors()) {
          a.stats.remove('mechanic:gloom');
          a.stats.setCondition('inDark', false);
        }
      },
    };
  },
};
