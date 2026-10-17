// The Asset Gallery and the Asset Workshop headless (moved from the e2e suite `world`): their
// shelves, stepping, opening by id and search; the turntable's light; the workshop's picker by
// wheel, key, click and finger, where each kind of asset goes down, undo, clear, the cap, the
// pointer placing and taking away, FIND IT and DEF. That each is drawn (pixels that change when it
// hides) stays in the e2e suite. One engine for the file (the World shell is one per process).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import { PUBLIC_DIR } from '../../riftlight/headless';
import type { worldApi } from '../index';
import { headlessWorld, roomApi, WORLD_T } from '../testWorld';

let engine: Engine;
let w: typeof worldApi;
const room = () => roomApi(w);
const packIndex = (JSON.parse(readFileSync(join(PUBLIC_DIR, 'packs/index.json'), 'utf8')) as { packs: { id: string; models: number; textures: number }[] }).packs;

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
}, WORLD_T);
afterAll(() => engine?.dispose());

type Shelf = { id: string; title: string; count: number };
type Exhibit = { id: string; index: number; kind: string };

it(
  'asset gallery: shelves for the library, textures and every pack; next and prev step; any asset opens by id; search; surfaces lie, sprites stand',
  async () => {
    await w.goto('gallery', { instant: true });
    engine.step(20);
    const shelves = room().shelves() as Shelf[];
    const families = shelves.filter((s) => s.id.startsWith('library/'));
    expect(families.length).toBe(10);
    for (const s of families) expect(s.count, s.id).toBeGreaterThan(0);
    expect(shelves.some((s) => s.id === 'textures/surfaces')).toBe(true);
    // each pack in the index makes a shelf of its models and one of its textures, those it has
    expect(shelves.filter((s) => s.title.startsWith('PACK')).length).toBe(packIndex.reduce((n, p) => n + (p.models > 0 ? 1 : 0) + (p.textures > 0 ? 1 : 0), 0));
    const first = room().current() as Exhibit;
    room().next();
    engine.step(5);
    const next = room().current() as Exhibit;
    room().prev();
    expect([first.index, next.index]).toEqual([0, 1]);
    expect(next.id).not.toBe(first.id);
    expect((room().current() as Exhibit).id).toBe(first.id);
    expect(room().show('chair') && (room().current() as Exhibit).id).toBe('chair');
    expect(room().show('no-such-asset')).toBe(false);
    expect((room().find('wooden chair', 3) as string[])[0]).toBe('chair');
    const kinds: string[] = [];
    for (const id of ['textures/surfaces', 'textures/icons', 'textures/sprites']) {
      room().shelf(id);
      engine.step(5);
      kinds.push((room().current() as Exhibit).kind);
    }
    expect(kinds).toEqual(['surface', 'sprite', 'sprite']);
  },
  WORLD_T,
);

it(
  "asset gallery: an off-centre light (the lamp post's lantern) turns with the turntable",
  () => {
    room().spin(true);
    room().show('lamp-post');
    engine.step(10);
    const l0 = room().light() as { at: number[]; turn: number };
    engine.step(60);
    const l1 = room().light() as { at: number[]; turn: number };
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const r0 = Math.hypot(l0.at[0]!, l0.at[2]!);
    const moved = Math.atan2(l1.at[0]!, l1.at[2]!) - Math.atan2(l0.at[0]!, l0.at[2]!);
    const turned = l1.turn - l0.turn;
    expect(turned).toBeGreaterThan(0.3);
    expect(Math.abs(wrap(moved - turned))).toBeLessThan(0.02);
    expect(Math.abs(r0 - Math.hypot(l1.at[0]!, l1.at[2]!))).toBeLessThan(0.01);
    expect(r0).toBeGreaterThan(0.15);
    expect(engine.state().errors).toEqual([]);
  },
  WORLD_T,
);

describe_workshop();

/** The Asset Workshop, after the gallery in the same engine (as the e2e suite ran them). */
function describe_workshop(): void {
  type Placed = { id: string; kind: string; shelf: string; at: number[]; base: number; middle: number[]; size: number[]; light: unknown };
  const click = (x: number, y: number, buttons = 1) => {
    engine.input.setPointer(x, y);
    engine.step(1);
    engine.input.setButtons(buttons);
    engine.step(1);
    engine.input.setButtons(0);
    engine.step(1);
  };
  const ndc = (x: number, y: number, z: number) => new Vector3(x, y, z).project(engine.camera.camera);
  type Ui = { rows: { id: string; at: [number, number] }[] };

  it(
    'asset workshop: a whole shelf for each library model family, its textures and every pack in packs/index.json',
    async () => {
      await w.goto('workshop', { instant: true });
      engine.step(20);
      room().preview(false);
      const has = new Map((room().shelves() as Shelf[]).map((s) => [s.id, s.count]));
      const lib = room().library() as { models: Record<string, string[]>; textures: { surfaces: string[]; sprites: string[] } };
      const short = [
        ...Object.entries(lib.models).filter(([f, ids]) => has.get(`library/${f}`) !== ids.length).map(([f]) => `library/${f}`),
        ...(has.get('textures/surfaces') === lib.textures.surfaces.length ? [] : ['textures/surfaces']),
        ...((has.get('textures/icons') ?? 0) + (has.get('textures/sprites') ?? 0) === lib.textures.sprites.length ? [] : ['textures/icons + sprites']),
        ...packIndex.flatMap((pk) => [...(pk.models && has.get(pk.id) !== pk.models ? [pk.id] : []), ...(pk.textures && has.get(`${pk.id}/textures`) !== pk.textures ? [`${pk.id}/textures`] : [])]),
      ];
      expect(short).toEqual([]);
      expect(packIndex.length).toBeGreaterThan(0);
    },
    WORLD_T,
  );

  it('asset workshop: the wheel over the list moves the pick and not the camera; E picks the next row; a click on a row picks it', () => {
    const first = (room().selected() as Exhibit).index;
    const zoom0 = engine.camera.zoom;
    engine.input.setPointer(...(room().ui() as Ui).rows[0]!.at);
    for (let i = 0; i < 2; i++) {
      engine.input.addPointer(0, 0, 1);
      engine.step(1);
    }
    const wheel = (room().selected() as Exhibit).index;
    expect(wheel).toBe(first + 2);
    expect(engine.camera.zoom).toBe(zoom0);
    engine.input.setKey('KeyE', true);
    engine.step(1);
    engine.input.setKey('KeyE', false);
    engine.step(1);
    expect((room().selected() as Exhibit).index).toBe(wheel + 1);
    const rows = (room().ui() as Ui).rows;
    click(...rows.at(-1)!.at);
    expect((room().selected() as Exhibit).id).toBe(rows.at(-1)!.id);
  });

  it('asset workshop: a library model, a pack model, a tile and a sprite each go down where asked, on the floor; models stand on their lowest point; patches layer', () => {
    const pack = (room().shelves() as Shelf[]).find((s) => s.title.startsWith('PACK') && !s.id.endsWith('/textures'))!;
    const down = (spawn: () => Placed) => {
      room().clear();
      const p = spawn();
      engine.step(10);
      return p;
    };
    const kinds = {
      library: down(() => room().spawn('barrel', [-2, 2])),
      pack: down(() => (room().shelf(pack.id), room().spawn(undefined, [-2, 2]))),
      tile: down(() => room().spawn('floor-tiles', [-2, 2])),
      sprite: down(() => room().spawn('coin-spin', [-2, 2])),
    };
    expect([kinds.library.kind, kinds.pack.kind, kinds.tile.kind, kinds.sprite.kind]).toEqual(['model', 'model', 'surface', 'sprite']);
    expect(kinds.pack.shelf.startsWith('kenney')).toBe(true);
    for (const p of Object.values(kinds)) {
      expect(Math.hypot(p.at[0]! + 2, p.at[2]! - 2), p.id).toBeLessThan(1e-6);
      expect(p.at[1]! >= 0 && p.at[1]! < 0.02, `${p.id} at ${p.at}`).toBe(true);
    }
    // a model stands on the floor wherever its own bounds start (a wall torch from 1.13 m up, a
    // hanging lantern from 1.7 m), its footprint's middle where it was asked to go
    room().clear();
    for (const [i, id] of ['wall-torch', 'hanging-lantern', 'campfire', 'oak'].entries()) {
      const asked = [-5 + i * 2.5, 0];
      const p = room().spawn(id, asked) as Placed;
      expect(Math.abs(p.base - 0.01), id).toBeLessThan(1e-3);
      expect(Math.hypot(p.middle[0]! - asked[0]!, p.middle[1]! - asked[1]!), id).toBeLessThan(0.02);
    }
    // patches: one over another lies on top, and a model on them stands above both
    room().clear();
    const under = room().spawn('floor-tiles', [-2, 1]) as Placed;
    const over = room().spawn('grass', [-1, 2]) as Placed;
    const onTop = room().spawn('barrel', [-1.5, 1.5]) as Placed;
    expect(over.at[1]).toBeGreaterThan(under.at[1]!);
    expect(onTop.base).toBeGreaterThanOrEqual(over.at[1]! + 0.009);
  });

  it('asset workshop: undo takes the last away and clear the rest, with their scene objects and the lamp\'s light; the floor holds 80 things', () => {
    room().clear();
    engine.step(30);
    const count = () => ({ n: (room().spawned() as Placed[]).length, children: engine.scene.children.length, lights: engine.lights.stats().requests });
    const base = count();
    room().spawn('barrel', [-2, 2]);
    room().spawn('lamp-post', [-3, 1]);
    room().spawn('coin-spin', [-1, 1]);
    engine.step(5);
    expect(count()).toEqual({ n: 3, children: base.children + 3, lights: base.lights + 1 });
    expect(room().undo()).toBe('coin-spin');
    engine.step(2);
    expect(count()).toMatchObject({ n: 2, children: base.children + 2 });
    expect(room().clear()).toBe(2);
    engine.step(30);
    expect(count()).toEqual({ n: 0, children: base.children, lights: base.lights });
    let refused: unknown;
    for (let i = 0; i <= 80; i++) refused = room().spawn('barrel', [-6 + (i % 10), -5 + Math.floor(i / 10)]);
    expect((room().spawned() as Placed[]).length).toBe(80);
    expect(refused).toBeNull();
    room().clear();
    engine.step(2);
  });

  it('asset workshop: a click on the floor places the pick under the pointer, a right click takes it away; over the panel, the preview and Enter keep the floor spot', () => {
    const spot = ndc(-3, 0, 2);
    room().select('crate');
    click(spot.x, spot.y);
    const placed = (room().spawned() as Placed[]).at(-1)!;
    const n = (room().spawned() as Placed[]).length;
    expect(placed.id).toBe('crate');
    expect(Math.hypot(placed.at[0]! + 3, placed.at[2]! - 2)).toBeLessThan(0.05);
    click(spot.x, spot.y, 2);
    expect((room().spawned() as Placed[]).length).toBe(n - 1);
    // the mouse over the floor, then onto the list and its wheel: the preview and Enter stay where
    // the floor was last under the mouse, never on the floor hidden under the panel
    room().clear();
    const spot2 = ndc(-2, 0, 1);
    engine.input.setPointer(spot2.x, spot2.y);
    engine.step(1);
    engine.input.setPointer(...(room().ui() as Ui).rows[0]!.at);
    engine.input.addPointer(0, 0, 1);
    engine.step(1);
    const aimed = room().aim() as { by: string; at: number[] };
    engine.input.setKey('Enter', true);
    engine.step(1);
    engine.input.setKey('Enter', false);
    engine.step(1);
    const entered = (room().spawned() as Placed[]).at(-1)!;
    expect(aimed.by).toBe('pointer');
    expect(Math.hypot(aimed.at[0]! + 2, aimed.at[2]! - 1)).toBeLessThan(0.05);
    expect(Math.hypot(entered.at[0]! + 2, entered.at[2]! - 1)).toBeLessThan(0.05);
  });

  it('asset workshop: a right click takes away what it hits, a tree by its crown, a sprite by its picture; turning back 45 degrees is 315', () => {
    room().clear();
    const tree = room().spawn('oak', [-4, 0]) as Placed;
    const coin = room().spawn('coin-spin', [0, 2.5]) as Placed;
    const at = (thing: Placed, up: number) => ndc(thing.at[0]!, thing.at[1]! + thing.size[1]! * up, thing.at[2]!);
    const crown = at(tree, 0.75);
    click(crown.x, crown.y, 2);
    expect((room().spawned() as Placed[]).map((x) => x.id)).toEqual(['coin-spin']);
    const face = at(coin, 0.8);
    click(face.x, face.y, 2);
    expect(room().spawned()).toEqual([]);
    room().turn(-45);
    expect(w.knobs().find((x) => x.id === 'turn')!.value).toBe(7);
    room().turn(0);
  });

  it('asset workshop: a finger dragged up the list scrolls it and places nothing; a tap on the floor places the pick there; FIND IT and DEF', () => {
    room().shelf('library/furniture');
    const list = (room().ui() as Ui).rows;
    const rowH = list[0]!.at[1] - list[1]!.at[1];
    const from = (room().selected() as Exhibit).index;
    const n = (room().spawned() as Placed[]).length;
    engine.input.setPointer(...list[1]!.at);
    engine.input.setKey('Touch', true);
    engine.step(1);
    for (let i = 1; i <= 3; i++) {
      engine.input.setPointer(list[1]!.at[0], list[1]!.at[1] + rowH * i);
      engine.step(1);
    }
    engine.input.setKey('Touch', false);
    engine.step(1);
    expect((room().selected() as Exhibit).index).toBe(from + 3);
    expect((room().spawned() as Placed[]).length).toBe(n);
    const pick = (room().selected() as Exhibit).id;
    const spot = ndc(-3, 0, 2);
    engine.input.setPointer(spot.x, spot.y);
    engine.step(1);
    engine.input.setKey('Touch', true);
    engine.step(1);
    engine.input.setKey('Touch', false);
    engine.step(1);
    const placed = room().spawned() as Placed[];
    expect(placed.length).toBe(n + 1);
    expect(placed.at(-1)!.id).toBe(pick);
    expect(Math.hypot(placed.at(-1)!.at[0]! + 3, placed.at(-1)!.at[2]! - 2)).toBeLessThan(0.05);
    room().clear();
    // FIND IT: one search across the library and every pack picks its best hit
    w.pad('FIND IT');
    expect((room().selected() as Exhibit).id).toBe('chair');
    expect((room().find('chair', 1) as string[])[0]).toBe('chair');
    room().select('campfire');
    expect((room().def() as string[]).join(' / ')).toContain('USES stone-ring, flame');
    expect(engine.state().errors).toEqual([]);
  });
}
