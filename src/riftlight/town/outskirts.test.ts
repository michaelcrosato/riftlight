import { readFileSync } from 'node:fs';
import { Color, ConeGeometry, CylinderGeometry, Group, Mesh, type Object3D, Raycaster, Vector3 } from 'three/webgpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODEL_LIBRARY } from '../../engine/model';
import { toonMaterial } from '../../engine/render/toon';
import { Rng } from '../core/rng';
import type { ShellServices } from '../game/ports';
import { loadPacksSync } from '../nodePacks';
import { buildShowcaseProps } from '../showcase/townProps';
import { SKILLS } from '../skills/actives';
import { iso, screenOf, TOWN_LAYOUT } from './layout';
import { overlapsBlocker } from './kit';
import { TownNav } from './nav';
import { bridgeDeck } from './outskirts';
import { Town } from './Town';

/** The town as the game builds it (packs loaded, the showcase's cabinet and hall added), with a stand-in for tree.glb. */
function buildTown(): Town {
  loadPacksSync();
  const tree = new Group();
  tree.add(new Mesh(new CylinderGeometry(0.15, 0.2, 1.2, 6), toonMaterial(0x5d275d)));
  const crown = new Mesh(new ConeGeometry(1.1, 2.4, 6), toonMaterial(0x257179));
  crown.position.y = 2.2;
  tree.add(crown);
  const lights = { acquire: () => ({ intensity: 0, position: new Vector3() }), release: () => {} };
  const engine = { sun: { color: new Color(), intensity: 0 }, ambient: { color: new Color(), intensity: 0 }, scene: {} };
  const town = new Town({ rng: new Rng(1), lights, ctx: { engine, particles: { burst() {} }, audio: { play() {} } } } as unknown as ShellServices);
  town.build(tree);
  town.extend(buildShowcaseProps({ lights: { request: () => ({ release() {}, update() {} }) }, particles: { burst() {} } } as never).extension);
  return town;
}

let built: Town | null = null;
const town = () => (built ??= buildTown());
// building the town (packs, merging, the walkable grid) takes a second or two, more on a busy machine
beforeAll(() => void town().nav(), 120_000);
const at = (sx: number, sy: number) => {
  const [x, z] = iso(sx, sy);
  return { x, z };
};
/** The hero's radius (HeroController's mover). */
const HERO = 0.35;
/** A grid looser than the town's (a smaller actor, quarter-metre cells): what it can't reach, the hero can't either. */
const loose = (t: Town) => new TownNav(t.obstacles, { radius: TOWN_LAYOUT.radius, agent: 0.28, cell: 0.25 });
/** Every reachable cell of `nav` (cell centres). */
function reachableCells(t: Town, nav: TownNav): { x: number; z: number }[] {
  const all: { x: number; z: number }[] = [];
  for (let j = 0; j < nav.size; j++)
    for (let i = 0; i < nav.size; i++) {
      const p = { x: nav.origin + (i + 0.5) * nav.cell, z: nav.origin + (j + 0.5) * nav.cell };
      if (nav.walkable(p.x, p.z)) all.push(p);
    }
  const ok = nav.reachable(t.spawn, all, 0.01);
  return all.filter((_, i) => ok[i]);
}

describe('town nav', () => {
  it('routes round a wall and finds nothing past a closed one', () => {
    // a wall across x = 0 from the circle's edge to z = 4, a 2 m gap, the wall again to the edge
    const nav = new TownNav(
      [
        { kind: 'box', x: 0, z: -3.5, hw: 0.2, hd: 7.5, rot: 0 },
        { kind: 'box', x: 0, z: 8.5, hw: 0.2, hd: 2.5, rot: 0 },
      ],
      { radius: 10 },
    );
    expect(nav.walkable(-3, 0)).toBe(true);
    expect(nav.walkable(0, 0)).toBe(false);
    const route = nav.route({ x: -3, z: 0 }, { x: 3, z: 0 });
    expect(route.length).toBeGreaterThan(10);
    // it goes through the gap (z between 4 and 6), never through the wall
    expect(route.some((p) => Math.abs(p.x) < 0.3 && p.z > 4.3 && p.z < 5.7)).toBe(true);
    for (const p of route) if (Math.abs(p.x) < 0.5) expect(p.z > 4.3 && p.z < 5.7, `${p.x}, ${p.z}`).toBe(true);
    const sealed = new TownNav([{ kind: 'box', x: 0, z: 0, hw: 0.2, hd: 11, rot: 0 }], { radius: 10 });
    expect(sealed.route({ x: -3, z: 0 }, { x: 3, z: 0 })).toEqual([]);
    expect(sealed.reachable({ x: -3, z: 0 }, [{ x: -5, z: 2 }, { x: 3, z: 0 }])).toEqual([true, false]);
  });
});

describe('Emberfall, expanded', { timeout: 60_000 }, () => {
  it('names only pack models that exist (the single-file build embeds these ids)', () => {
    loadPacksSync();
    const source = readFileSync(new URL('./outskirts.ts', import.meta.url), 'utf8');
    const ids = [...new Set(source.match(/kenney-[a-z-]+\/[a-z0-9-]+/g) ?? [])];
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) expect(MODEL_LIBRARY.has(id), id).toBe(true);
  });

  it('walks from the spawn to every interactable, every NPC path point, the portal spawn and every district', () => {
    const t = town();
    const nav = t.nav();
    const named: [string, { x: number; z: number }][] = [
      ...t.interactables.map((i) => [`interactable ${i.id}`, i.position] as [string, Vector3]),
      ...t.npcs.flatMap((n) => n.path.map((p, i) => [`${n.def.id} path ${i}`, p] as [string, Vector3])),
      ['portal spawn', t.portalSpawn],
      ...Object.entries(TOWN_LAYOUT.districts).map(([id, [sx, sy]]) => [`district ${id}`, at(sx, sy)] as [string, { x: number; z: number }]),
    ];
    const reach = nav.reachable(t.spawn, named.map(([, p]) => p));
    expect(named.filter((_, i) => !reach[i]).map(([n]) => n)).toEqual([]);
    // and it is a town worth walking: about four times the old plaza's 570 m² of open ground
    expect(nav.openCells() * nav.cell * nav.cell).toBeGreaterThan(1900);
  });

  it('every district spot is open ground, and the walk there is clear of pockets the hero could be shut in', () => {
    const t = town();
    const nav = t.nav();
    for (const [id, [sx, sy]] of Object.entries(TOWN_LAYOUT.districts)) {
      const { x, z } = at(sx, sy);
      expect(nav.walkable(x, z), id).toBe(true);
      const route = nav.route(t.spawn, { x, z }, 0.3);
      expect(route.length, id).toBeGreaterThan(0);
    }
  });

  it('the stream is not walkable but over the bridge, and the camp is across it', () => {
    const t = town();
    const nav = t.nav();
    const free = loose(t);
    const { sx: S, bridge: B } = TOWN_LAYOUT.stream;
    for (let sy = -24; sy <= 24; sy += 0.5) {
      if (Math.abs(sy - B) < 1.6) continue;
      const { x, z } = at(S - 0.1, sy);
      if (Math.hypot(x, z) > TOWN_LAYOUT.radius - 0.5) continue;
      expect(free.walkable(x, z), `water at sy ${sy}`).toBe(false);
    }
    const deck = at(S, B);
    expect(nav.walkable(deck.x, deck.z), 'the bridge').toBe(true);
    expect(bridgeDeck(deck.x, deck.z)).toBeGreaterThan(0.4);
    expect(bridgeDeck(...iso(S - 3, B))).toBe(0);
    // every way from the plaza to the camp crosses on the bridge
    const route = nav.route(t.spawn, at(...TOWN_LAYOUT.districts.camp));
    const crossing = route.filter((p) => {
      const sx = (p.x - p.z) * Math.SQRT1_2;
      return Math.abs(sx - S) < 0.8;
    });
    expect(crossing.length).toBeGreaterThan(0);
    for (const p of crossing) expect(Math.abs((-p.x - p.z) * Math.SQRT1_2 - B), 'crossing off the bridge').toBeLessThan(1.3);
  });

  it('nothing walks behind the Old Watch’s wall (it would hide the hero)', () => {
    const t = town();
    const { wall, from, to } = TOWN_LAYOUT.watch;
    const behind: { x: number; z: number }[] = [];
    for (let phi = from; phi <= to; phi += 2) for (const r of [wall + 1.2, wall + 2.2]) behind.push(at(Math.cos((phi * Math.PI) / 180) * r, Math.sin((phi * Math.PI) / 180) * r));
    const reach = loose(t).reachable(t.spawn, behind, 0.2);
    expect(reach.filter(Boolean).length).toBe(0);
  });

  it('nowhere to be shut in: every spot the hero fits in is one he can walk to', () => {
    // a grid finer than the town's, for the hero's own size: open cells the plaza can't reach are
    // pockets (one cell or two between blockers that nearly touch is the grid, not the town)
    const t = town();
    const fine = new TownNav(t.obstacles, { radius: TOWN_LAYOUT.radius, agent: HERO, cell: 0.25 });
    const open: { x: number; z: number }[] = [];
    for (let j = 0; j < fine.size; j++)
      for (let i = 0; i < fine.size; i++) {
        const p = { x: fine.origin + (i + 0.5) * fine.cell, z: fine.origin + (j + 0.5) * fine.cell };
        if (fine.walkable(p.x, p.z)) open.push(p);
      }
    const reach = fine.reachable(t.spawn, open, 0.01);
    const shut = open.filter((_, i) => !reach[i]);
    const big = shut.filter((p) => shut.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.6).length > 2);
    expect(big.slice(0, 5).map((p) => screenOf(p.x, p.z).map((v) => v.toFixed(1)).join(', '))).toEqual([]);
  });

  it('a Blink or a dash never leaves the hero where he can’t walk back from', () => {
    const t = town();
    const nav = t.nav();
    const R = TOWN_LAYOUT.radius;
    const blink = SKILLS.get('blink').delivery;
    const reach = blink.kind === 'dash' ? blink.distance : 0;
    expect(reach).toBeGreaterThan(4);
    // from all over the town, and from just inside each closed edge: the Old Watch's wall, the gate
    const from = reachableCells(t, nav).filter((_, i) => i % 5 === 0);
    const { wall, from: a0, to: a1 } = TOWN_LAYOUT.watch;
    const edge: { x: number; z: number }[] = [];
    for (let phi = a0; phi <= a1; phi += 3) edge.push(at(Math.cos((phi * Math.PI) / 180) * (wall - 1.6), Math.sin((phi * Math.PI) / 180) * (wall - 1.6)));
    for (let sx = -7; sx <= 7; sx += 1) edge.push(at(sx, TOWN_LAYOUT.gate[1] + 2.4));
    // (where one stands in a tower or a tree, the ground beside it, if any)
    for (const e of edge) {
      const near = nav.nearestReachable(t.spawn, e.x, e.z, 2);
      if (near) from.push(near);
    }
    const ends: { x: number; z: number }[] = [];
    const what: string[] = [];
    const through: string[] = [];
    const walls = t.obstacles.filter((b) => b.kind === 'box' && !b.low);
    const p = new Vector3();
    for (const s of from)
      for (let a = 0; a < 16; a++) {
        const dx = Math.cos((a * Math.PI) / 8);
        const dz = Math.sin((a * Math.PI) / 8);
        // Blink (combat/deliveries/dash.ts): up to the town's walls, 0.4 m short of them
        const w = t.wall(new Vector3(s.x, 0.5, s.z), new Vector3(s.x + dx * reach, 0.5, s.z + dz * reach));
        const k = w === null ? 1 : Math.max(0, w - 0.4 / reach);
        p.set(s.x + dx * reach * k, 0, s.z + dz * reach * k);
        // it never goes through a wall to get there (anything boxed but the water and the rails)
        for (let f = 0; f <= 1; f += 0.01) {
          const x = s.x + (p.x - s.x) * f;
          const z = s.z + (p.z - s.z) * f;
          if (walls.some((b) => overlapsBlocker(x, z, 0.002, b))) {
            through.push(`blink from ${s.x.toFixed(1)}, ${s.z.toFixed(1)} at ${a * 22.5}°`);
            break;
          }
        }
        for (let f = 0; f < 10; f++) t.collide(p, HERO);
        ends.push({ x: p.x, z: p.z });
        what.push(`blink from ${s.x.toFixed(1)}, ${s.z.toFixed(1)} at ${a * 22.5}° to ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
        // a dash or a dodge: 0.5 m a frame (faster than any), pushed out of everything each frame
        p.set(s.x, 0, s.z);
        for (let f = 0; f < 14; f++) {
          p.x += dx * 0.5;
          p.z += dz * 0.5;
          t.collide(p, HERO);
        }
        ends.push({ x: p.x, z: p.z });
        what.push(`dash from ${s.x.toFixed(1)}, ${s.z.toFixed(1)} at ${a * 22.5}° to ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
      }
    const bad = what.filter((_, i) => !nav.nearReachable(t.spawn, ends[i]!.x, ends[i]!.z) || Math.hypot(ends[i]!.x, ends[i]!.z) > R + 0.5);
    expect(bad.slice(0, 12)).toEqual([]);
    expect(through.slice(0, 12)).toEqual([]);
  });

  it('the camera sees the hero wherever he can walk, but for a few steps behind a tree or a hut', () => {
    const t = town();
    const nav = t.nav();
    const kit = t.root.children.find((c) => c.name === 'kit')!;
    const meshes: Object3D[] = [];
    kit.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o);
    });
    const p = (TOWN_LAYOUT.view.pitch * Math.PI) / 180;
    const y = (TOWN_LAYOUT.view.yaw * Math.PI) / 180;
    const toCamera = new Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
    const ray = new Raycaster();
    ray.far = 30;
    const cells = reachableCells(t, nav);
    // hidden: rays toward the camera from his waist and his head both blocked
    const key = (q: { x: number; z: number }) => `${Math.round((q.x - nav.origin) / nav.cell - 0.5)},${Math.round((q.z - nav.origin) / nav.cell - 0.5)}`;
    const hidden = new Set<string>();
    for (const q of cells)
      if (
        [0.9, 1.6].every((h) => {
          ray.set(new Vector3(q.x, h, q.z), toCamera);
          return ray.intersectObjects(meshes, false).length > 0;
        })
      )
        hidden.add(key(q));
    // patches of hidden ground (8-connected), in m²
    const area = nav.cell * nav.cell;
    const seen = new Set<string>();
    const patches: string[] = [];
    for (const k0 of hidden) {
      if (seen.has(k0)) continue;
      seen.add(k0);
      const queue = [k0];
      for (let q = 0; q < queue.length; q++) {
        const [i, j] = queue[q]!.split(',').map(Number) as [number, number];
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const n = `${i + di},${j + dj}`;
            if (hidden.has(n) && !seen.has(n)) {
              seen.add(n);
              queue.push(n);
            }
          }
      }
      const [i, j] = k0.split(',').map(Number) as [number, number];
      const [sx, sy] = screenOf(nav.origin + (i + 0.5) * nav.cell, nav.origin + (j + 0.5) * nav.cell);
      if (queue.length * area > 5) patches.push(`${(queue.length * area).toFixed(1)} m² near screen ${sx.toFixed(1)}, ${sy.toFixed(1)}`);
    }
    expect(patches).toEqual([]);
    // and all of it together is a small share of the town (the plaza alone had 6% before the outskirts)
    expect(hidden.size / cells.length).toBeLessThan(0.04);
  });

  it('the camera sees the hero at every district spot: nothing of the town stands between them', () => {
    const t = town();
    const kit = t.root.children.find((c) => c.name === 'kit')!;
    const meshes: Object3D[] = [];
    kit.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o);
    });
    // toward the iso camera (pitch 42°, yaw 45°), from the hero's chest and head
    const p = (42 * Math.PI) / 180;
    const toCamera = new Vector3(Math.sin(Math.PI / 4) * Math.cos(p), Math.sin(p), Math.cos(Math.PI / 4) * Math.cos(p));
    const ray = new Raycaster();
    const hidden: string[] = [];
    for (const [id, [sx, sy]] of Object.entries(TOWN_LAYOUT.districts)) {
      const { x, z } = at(sx, sy);
      for (const y of [0.1, 0.9, 1.6]) {
        ray.set(new Vector3(x, y, z), toCamera);
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit) hidden.push(`${id} at ${y} m behind ${hit.object.name} ${hit.distance.toFixed(1)} m off`);
      }
    }
    expect(hidden).toEqual([]);
  });
});
