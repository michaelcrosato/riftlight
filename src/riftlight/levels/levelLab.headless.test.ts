// The Level Lab headless (was e2e `riftlight-levels`' state checks): for designed levels 1, 6 and
// 12 and a rift (depth 20, seed 7), as `?game=levellab&depth=N&god=1&quality=medium` runs them,
// the level builds (layout, critical path, mechanics) with its theme's floor surface, the light
// pool (quality medium: 8) shares its lights between many moving requests, the autopilot walks
// start → exit with encounters on the way and lights following, and killing the boss opens the
// portal the hero then takes; its prompts name the lab's own buttons (`LAB_KEYS`). The pictures,
// the shader cache and the pool's CPU time stay in e2e. One engine at a time: each depth's is
// disposed before the next boots.
import type { Mesh, Object3D } from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import { headlessGame, hudTexts } from '../headless';
import { LAB_KEYS, LevelLab } from './levelLab';

const T = 30_000;
const LEVELS = [{ depth: 1 }, { depth: 6 }, { depth: 12 }, { depth: 20, seed: 7 }];

let engine: Engine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

describe.each(LEVELS)('Level Lab depth $depth', ({ depth, seed }) => {
  it(
    'builds, shares the light pool, walks start → exit with encounters, and the boss opens the portal',
    async () => {
      const lab = new LevelLab({ depth, ...(seed ? { seed } : {}), god: true });
      engine = await headlessGame(lab, { quality: 'medium' });
      const e = engine;
      const l = lab.level;
      const label = `L${depth} ${l.spec.name}`;
      expect(e.state().game, label).toBe('Riftlight Level Lab');
      // level built: rooms, a critical path, every mechanic its spec asks for
      expect(l.layout.path.length, `${label}: path`).toBeGreaterThan(10);
      expect(l.layout.rooms.length, `${label}: rooms`).toBeGreaterThanOrEqual(5);
      expect(l.mechanics.length, `${label}: mechanics`).toBe(l.spec.mechanics.length);
      e.step(10);

      // the floor is the theme's floor surface: an up-facing mesh mapped with it, with UVs
      const want = l.theme.surfaces?.floor?.texture ?? null;
      const meshes: Mesh[] = [];
      l.root.traverse((o: Object3D) => void ((o as Mesh).isMesh && meshes.push(o as Mesh)));
      const floor = meshes.find((m) => want && (m.material as { map?: { name: string } }).map?.name === `tex:${want}` && m.geometry.getAttribute('normal')?.getY(0) === 1);
      expect(want, `${label}: the theme has a floor surface`).toBeTruthy();
      expect(floor, `${label}: a floor mesh mapped with ${want}`).toBeTruthy();
      const uvs = floor!.geometry.getAttribute('uv')?.count ?? 0;
      expect(uvs, `${label}: floor UVs`).toBeGreaterThan(0);
      expect(uvs, `${label}: a UV per floor vertex`).toBe(floor!.geometry.getAttribute('position').count);

      // the light pool: a constant 8 PointLights shared by many moving, recolouring requests
      const pool = e.lights;
      expect(pool.lights.length, `${label}: pool size`).toBe(8);
      expect(pool.group.children.length, `${label}: pool lights in the scene`).toBe(8);
      const hero = lab.hero.position;
      const reqs = Array.from({ length: 24 }, (_, i) =>
        pool.request({ position: [hero.x + Math.cos(i) * 4, 1.5, hero.z + Math.sin(i) * 4], color: 0xff0000 + i * 0x0a0a, intensity: 4 + (i % 5), radius: 5, flicker: i % 2 ? 'torch' : 'spell' }),
      );
      const assigned0 = pool.stats().assignments;
      for (let k = 0; k < 6; k++) {
        for (const [i, r] of reqs.entries()) {
          r.position.set(hero.x + Math.cos(i + k) * (3 + k), 1.5, hero.z + Math.sin(i + k) * (3 + k));
          r.color.setHSL(((i + k * 3) % 24) / 24, 0.8, 0.6);
          r.intensity = 3 + ((i + k) % 7);
        }
        for (let f = 0; f < 8; f++) pool.update(1 / 60, hero, 20);
      }
      const st = pool.stats();
      expect(st.requests, `${label}: more requests than lights`).toBeGreaterThan(8);
      expect(st.lit, `${label}: ${st.requests} requests share the 8 lights`).toBe(8);
      expect(st.assignments - assigned0, `${label}: moving requests re-assign lights`).toBeGreaterThan(0);
      for (const r of reqs) r.release();
      e.step(30);
      expect(pool.lights.length, `${label}: still 8 lights after`).toBe(8);

      // the autopilot walks the critical path start → exit; lights follow, encounters spawn
      lab.autopilot = true;
      const start = lab.hero.position.clone();
      const a0 = pool.stats().assignments;
      let frames = 0;
      while (lab.exitDistance() > 1.6 && frames < 6000) {
        e.step(60);
        frames += 60;
      }
      lab.autopilot = false;
      expect(lab.exitDistance(), `${label}: hero walked start → exit (${frames / 60} s game time, ${start.distanceTo(lab.hero.position).toFixed(0)} m)`).toBeLessThanOrEqual(1.6);
      expect(pool.stats().assignments - a0, `${label}: lights followed the walk`).toBeGreaterThan(0);
      expect(lab.monsters.length, `${label}: encounters spawned on the way`).toBeGreaterThan(0);
      expect(lab.log['level:packSpawn'] ?? 0, `${label}: packSpawn events`).toBeGreaterThan(0);

      // boss down: levelClear, the portal opens, and the hero takes it
      let cleared = 0;
      lab.events.on('levelClear', () => cleared++);
      lab.killBoss();
      e.step(5);
      expect(cleared, `${label}: levelClear emitted once`).toBe(1);
      expect(l.exitPortal.open && l.cleared, `${label}: exit portal open, level cleared`).toBe(true);
      const p = l.exitPortal.position;
      lab.teleport(p.x, p.z);
      e.step(5);
      expect(lab.exited, `${label}: the hero takes the open portal (onExit)`).toBe(true);
      // the next depth is N, or Options on a pad: named in the player's button style (Menu on an Xbox pad)
      const banner = () => hudTexts(e, 20).map((t) => t.text).find((t) => t.startsWith('PORTAL TAKEN'));
      expect(banner()).toBe('PORTAL TAKEN - PRESS N');
      e.input.noteDevice('pad');
      expect(banner()).toBe('PORTAL TAKEN - PRESS OPTIONS');
      e.settings.set({ padGlyphs: 'xbox' });
      expect(banner()).toBe('PORTAL TAKEN - PRESS MENU');
      e.settings.set({ padGlyphs: undefined });
      e.input.noteDevice('keyboard');
      expect(e.errors, label).toEqual([]);
    },
    T,
  );
});

describe('the Level Lab’s controls', () => {
  it(
    'its prompts name what plays there (LAB_KEYS, not the shell’s: J and pad Square swing, K and Triangle cast), and the button named does it',
    async () => {
      const lab = new LevelLab({ depth: 1, god: true });
      engine = await headlessGame(lab);
      const e = engine;
      e.step(2);
      const actions = ['attack', 'firebolt', 'next'];
      expect(actions.map((a) => e.controls.label(a)), 'on the keyboard').toEqual(['J', 'K', 'N']);
      e.input.noteDevice('pad');
      e.step(1);
      expect(actions.map((a) => e.controls.label(a)).slice(0, 2), 'on a pad').toEqual(['Square', 'Triangle']);
      // every key and pad button the table names is one the lab reads for that action
      for (const [action, c] of Object.entries(lab.controls)) {
        if (action === 'move') continue;
        expect(LAB_KEYS[action as keyof typeof LAB_KEYS], action).toEqual(expect.arrayContaining([c.key, ...(c.pad ? [c.pad] : [])]));
      }
      const cast: string[] = [];
      lab.events.on('skill', (s) => void cast.push(String(s.skill)));
      const tap = (code: string) => {
        e.input.setKey(code, true);
        e.step(1);
        e.input.setKey(code, false);
        e.step(30);
      };
      tap(lab.controls.attack!.pad!);
      tap(lab.controls.firebolt!.pad!);
      tap(lab.controls.attack!.key);
      tap(lab.controls.firebolt!.key);
      expect(cast, 'each named button does its action').toEqual(['swing', 'firebolt', 'swing', 'firebolt']);
      expect(e.errors).toEqual([]);
    },
    T,
  );
});
