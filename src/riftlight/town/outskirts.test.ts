import { readFileSync } from 'node:fs';
import { Color, ConeGeometry, CylinderGeometry, Group, Mesh, type Object3D, Raycaster, Vector3 } from 'three/webgpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODEL_LIBRARY } from '../../engine/model';
import { toonMaterial } from '../../engine/render/toon';
import { Rng } from '../core/rng';
import type { ShellServices } from '../game/ports';
import { loadPacksSync } from '../nodePacks';
import { buildShowcaseProps } from '../showcase/townProps';
import { iso, TOWN_LAYOUT } from './layout';
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
    const { sx: S, bridge: B } = TOWN_LAYOUT.stream;
    for (let sy = -24; sy <= 24; sy += 0.5) {
      if (Math.abs(sy - B) < 1.6) continue;
      const { x, z } = at(S - 0.1, sy);
      if (Math.hypot(x, z) > TOWN_LAYOUT.radius - 0.5) continue;
      expect(nav.walkable(x, z), `water at sy ${sy}`).toBe(false);
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
    const reach = t.nav().reachable(t.spawn, behind, 0.2);
    expect(reach.filter(Boolean).length).toBe(0);
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
      for (const y of [0.9, 1.6]) {
        ray.set(new Vector3(x, y, z), toCamera);
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit) hidden.push(`${id} at ${y} m behind ${hit.object.name} ${hit.distance.toFixed(1)} m off`);
      }
    }
    expect(hidden).toEqual([]);
  });
});
