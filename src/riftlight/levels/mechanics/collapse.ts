import { BoxGeometry, Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import type { LightHandle } from '../../../engine/render/lights';
import { setLookLayer } from '../../../engine/render/lookLayer';
import { toonMaterial } from '../../../engine/render/toon';
import { FLOOR, VOID } from '../layout/grid';
import { glowMaterial, tint } from '../themes/props';
import { asMechanicLevel, box, cellIndexOf, centroid, growBlob, heroScale } from './common';
import type { LevelMechanicDef } from './types';

/**
 * Level 12 — Collapse. Cracked floors crumble behind you: a tile the hero steps on starts
 * to crack and drops into the void a moment later, and the crack spreads to its neighbours.
 * The main road is solid stone. Fallen tiles rise back after `REFORM` seconds, so nothing is
 * cut off for good. Loot caches sit on crumbling islands (grab them before the floor goes),
 * and a fast clear (under par) pays bonus loot at the end.
 *
 * Crumbling cells are `dynamicFloor`: the geometry builder leaves them to this mechanic
 * (instanced tiles), and `level.setCell(x, z, VOID)` updates nav, colliders and walkability.
 */
const CRACK = 0.9;
// `collapse.bonusLoot` (Collapse Runner, the Crumbling Halls suffix): more items from caches and
// the under-par bonus. Falls are Level / wire's job: `collapse.fallImmune` makes them harmless.
const SPREAD = 0.22;
/**
 * Seconds a fallen tile stays gone before it rises back. Without it a crumbled zone can cut
 * a side room (and whoever is in it, monsters or the hero) off for good: the level could
 * never be cleared.
 */
const REFORM = 9;
const tileGeo = new BoxGeometry(0.98, 0.4, 0.98).translate(0, -0.2, 0);
tileGeo.userData.shared = true;
const crackGeo = new BoxGeometry(1, 0.02, 0.07).translate(0, 0.005, 0);
crackGeo.userData.shared = true;

export const COLLAPSE: LevelMechanicDef = {
  id: 'collapse',
  name: 'Collapse',
  tags: ['earth', 'surface', 'speed'],
  excludes: ['riftgates'],
  color: 0xd06a30,
  description: 'Floors crumble behind you and drop into the void (they rise back a while later).',
  bypass: 'Keep moving on the solid main road.',
  exploit: 'Fastest clears earn collapse bonus loot; grab the caches on crumbling islands before they fall.',
  place(ctx) {
    const W = ctx.layout.width;
    for (const room of ctx.rooms({ boss: false })) {
      const n = ctx.rng.int(1, 2);
      for (let s = 0, tries = 0; s < n && tries < 8; tries++) {
        const free = ctx.free({ room: room.id, minClearance: 2 });
        if (!free.length) break;
        const c = ctx.rng.pick(free);
        const cells = growBlob(ctx, c.x, c.z, ctx.rng.int(8, 22));
        if (cells.length < 6) continue;
        const [x, z] = centroid(cells, W);
        // Some islands carry a loot cache at their heart.
        const cache = ctx.rng.chance(0.3) ? cells[0]! : -1;
        if (ctx.add({ kind: 'crumble', x, z, cells, block: 'hazard', data: { dynamicFloor: true, cache } })) s++;
      }
    }
  },
  install(raw) {
    const level = asMechanicLevel(raw);
    const W = level.layout.width;
    const zones = level.elementsOf('collapse');
    const cells: number[] = [];
    for (const z of zones) cells.push(...z.cells);
    const index = new Map<number, number>(cells.map((c, k) => [c, k]));
    const material = toonMaterial(tint(level.theme.palette.floor, -0.12));
    const tiles = new InstancedMesh(tileGeo, material, Math.max(1, cells.length));
    tiles.name = 'collapse:tiles';
    tiles.receiveShadow = true;
    tiles.castShadow = true;
    tiles.count = cells.length;
    const m = new Matrix4();
    cells.forEach((c, k) => {
      const x = c % W;
      const z = (c - x) / W;
      tiles.setMatrixAt(k, m.makeTranslation(x + 0.5, 0, z + 0.5));
    });
    tiles.instanceMatrix.needsUpdate = true;
    level.root.add(tiles);
    // Cracks: a darker sliver on every crumbling tile, moving with it (a second instanced mesh).
    const crackRng = level.rng.fork('cracks');
    const cracks = new InstancedMesh(crackGeo, toonMaterial(tint(level.theme.palette.floor, -0.45)), Math.max(1, cells.length));
    cracks.name = 'collapse:cracks';
    cracks.count = cells.length;
    const local = cells.map(() =>
      new Matrix4().compose(
        new Vector3(crackRng.range(-0.2, 0.2), 0, crackRng.range(-0.2, 0.2)),
        new Quaternion().setFromEuler(new Euler(0, crackRng.range(0, Math.PI), 0)),
        new Vector3(crackRng.range(0.4, 0.8), 1, 1),
      ),
    );
    const cm = new Matrix4();
    const place = (k: number, tile: Matrix4) => {
      tiles.setMatrixAt(k, tile);
      cracks.setMatrixAt(k, cm.multiplyMatrices(tile, local[k]!));
    };
    cells.forEach((c, k) => {
      const x = c % W;
      place(k, m.makeTranslation(x + 0.5, 0, (c - x) / W + 0.5));
    });
    cracks.instanceMatrix.needsUpdate = true;
    level.root.add(cracks);

    // State per tile: crack timer (≥0 cracking), fall velocity/height once falling.
    const crackAt = new Float32Array(cells.length).fill(-1);
    const fallY = new Float32Array(cells.length).fill(0);
    const goneFor = new Float32Array(cells.length).fill(0);
    const state = new Uint8Array(cells.length); // 0 intact, 1 cracking, 2 falling, 3 gone
    const startCrack = (k: number, delay: number) => {
      if (state[k] !== 0) return;
      state[k] = 1;
      crackAt[k] = CRACK + delay;
    };

    // Loot caches on islands.
    const cacheMat = glowMaterial(0xffcd75);
    const caches = zones
      .filter((z) => (z.data.cache as number) >= 0)
      .map((z) => {
        const c = z.data.cache as number;
        const x = (c % W) + 0.5;
        const zz = Math.floor(c / W) + 0.5;
        const chest = box(toonMaterial(0x8a5a3a), x, 0.3, zz, 0.7, 0.5, 0.5);
        const lid = box(cacheMat, x, 0.6, zz, 0.74, 0.12, 0.54);
        chest.name = lid.name = 'collapse:cache';
        setLookLayer(chest, 'actors');
        setLookLayer(lid, 'actors');
        level.root.add(chest, lid);
        return { cell: c, at: new Vector3(x, 0, zz), parts: [chest, lid], taken: false, light: level.light({ position: [x, 1, zz], color: 0xffcd75, intensity: 3, radius: 4, flicker: 'pulse', priority: 2, name: 'cache' }) as LightHandle | null };
      });

    let lastCell = -1;
    let rumble = 0;
    const offClear = level.events.on('levelClear', ({ time }) => {
      const par = 30 + level.layout.path.length * 0.75;
      const hero = level.hero();
      if (time > par || !hero) return;
      level.hooks.dropLoot?.(hero.position.clone(), { rarity: 'rare', quantity: Math.round(3 * heroScale(hero, 'collapse.bonusLoot')), itemLevel: level.depth, source: 'collapse:bonus' });
      level.emit('collapse', 'bonusLoot', hero.position);
      level.burst('loot', [hero.position.x, 1, hero.position.z]);
    });
    const tmp = new Vector3();
    return {
      update(dt) {
        const hero = level.hero();
        if (hero) {
          const c = cellIndexOf(level.layout, hero.position);
          if (c !== lastCell) {
            // The tile the hero just left (and the one it stands on) start to go.
            for (const cell of [lastCell, c]) {
              const k = index.get(cell);
              if (k === undefined) continue;
              startCrack(k, 0);
              // Spread to neighbours in a ring, a little later each.
              const x = cell % W;
              const z = (cell - x) / W;
              for (let dz = -1; dz <= 1; dz++)
                for (let dx = -1; dx <= 1; dx++) {
                  const n = index.get((z + dz) * W + x + dx);
                  if (n !== undefined) startCrack(n, SPREAD * (Math.abs(dx) + Math.abs(dz)));
                }
            }
            lastCell = c;
          }
          for (const cache of caches) {
            if (cache.taken || Math.hypot(hero.position.x - cache.at.x, hero.position.z - cache.at.z) > 0.9) continue;
            cache.taken = true;
            for (const p of cache.parts) p.visible = false;
            cache.light?.release();
            level.hooks.dropLoot?.(cache.at.clone(), { rarity: 'magic', quantity: Math.round(2 * heroScale(hero, 'collapse.bonusLoot')), itemLevel: level.depth, source: 'collapse:cache' });
            level.burst('loot', [cache.at.x, 0.8, cache.at.z]);
            level.sound('chest');
            level.emit('collapse', 'cache', cache.at);
          }
        }
        rumble -= dt;
        let dirty = false;
        for (let k = 0; k < cells.length; k++) {
          const s = state[k]!;
          if (s === 0) continue;
          const c = cells[k]!;
          const x = c % W;
          const z = (c - x) / W;
          if (s >= 2) {
            goneFor[k]! += dt;
            if (goneFor[k]! >= REFORM && s === 3) {
              // the tile rises back: walkable again (a stranded room is reachable once more)
              state[k] = 0;
              goneFor[k] = 0;
              fallY[k] = 0;
              place(k, m.makeTranslation(x + 0.5, 0, z + 0.5));
              level.setCell(x, z, FLOOR);
              dirty = true;
              continue;
            }
            if (s === 3) continue;
          }
          if (s === 1) {
            crackAt[k]! -= dt;
            // Shake while cracking.
            const shake = crackAt[k]! < CRACK ? 0.04 : 0;
            place(k, m.makeTranslation(x + 0.5 + (level.rng.next() - 0.5) * shake, (level.rng.next() - 0.5) * shake, z + 0.5));
            dirty = true;
            if (crackAt[k]! <= 0) {
              state[k] = 2;
              level.setCell(x, z, VOID);
              for (const cache of caches) if (cache.cell === c && !cache.taken) for (const p of cache.parts) p.visible = false;
              if (rumble <= 0) {
                rumble = 0.15;
                level.burst('crumble', tmp.set(x + 0.5, 0, z + 0.5));
                if (hero && hero.position.distanceTo(tmp) < 12) level.sound('crumble', { volume: 0.6 });
                level.emit('collapse', 'crumble', tmp.clone());
              }
            }
          } else {
            fallY[k] = fallY[k]! - dt * (2 + fallY[k]! * -3);
            const gone = fallY[k]! < -9;
            place(k, gone ? m.makeScale(0, 0, 0) : m.makeTranslation(x + 0.5, fallY[k]!, z + 0.5));
            if (gone) state[k] = 3;
            dirty = true;
          }
        }
        if (dirty) tiles.instanceMatrix.needsUpdate = cracks.instanceMatrix.needsUpdate = true;
      },
      dispose() {
        offClear();
        for (const c of caches) c.light?.release();
      },
    };
  },
};
