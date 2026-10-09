/**
 * Stealth: guards patrol a warehouse with vision cones that stop at walls and crates. Stay
 * out of sight; a guard that sees you long enough raises the alarm and every guard chases you
 * along A* paths on the nav grid, then they lose you and walk back to their rounds.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { floor, fract, screenCoordinate, uniform } from 'three/tsl';
import { NavGrid, PALETTE, toonMaterial } from '../../engine';
import { mannequin, type Mannequin } from '../kit/mannequin';
import type { Label } from '../kit/RoomKit';
import type { Knob, RoomDef } from '../types';

/** The warehouse: # walls, = low walls (south and east: they never hide the hero), c crates. */
export const STEALTH_MAP = [
  '#########################=',
  '#........................=',
  '#..cc......####......cc..=',
  '#..cc......#..#......cc..=',
  '#..........#..#..........=',
  '#....####..........####..=',
  '#....#........cc......#..=',
  '#....#........cc......#..=',
  '#........................=',
  '#..cc..####......####....=',
  '#..cc.....#..cc..#.......=',
  '#.........#..cc..#...cc..=',
  '#....................cc..=',
  '#........................=',
  '#=========================',
];
const MAP = STEALTH_MAP;
const RAYS = 24;

/** Patrol routes as map cells [col, row]; guards walk straight from one to the next (stealth.test.ts checks no leg crosses a wall). */
export const STEALTH_ROUTES: readonly (readonly (readonly [number, number])[])[] = [
  [
    [2, 1],
    [23, 1],
  ],
  [
    [6, 8],
    [21, 8],
    [21, 10],
    [20, 10],
    [20, 12],
    [12, 12],
    [12, 8],
  ],
  [
    [24, 2],
    [24, 13],
  ],
  [[12, 4]], // on watch in the little room: looks out south, turning
];

type State = 'patrol' | 'suspicious' | 'chase' | 'return';

interface Guard {
  man: Mannequin;
  /** Patrol waypoints (world x, z); a stationary guard has one and looks about. */
  route: [number, number][];
  leg: number;
  pos: Vector3;
  yaw: number;
  /** Where it last saw the hero, and a path it is following. */
  seen: Vector3;
  path: [number, number, number][];
  repath: number;
  state: State;
  /** Detection, 0..1: half is suspicious, full raises the alarm. */
  meter: number;
  cone: Mesh;
  tint: { value: Color };
  label: Label;
  clip: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
/** A flat fan of rays on the floor (redrawn every frame to stop at walls), half see-through by an ordered dither. */
function coneMesh(): { mesh: Mesh; tint: { value: Color } } {
  const g = new BufferGeometry();
  const pos = new BufferAttribute(new Float32Array((RAYS + 1) * 3), 3);
  pos.setUsage(DynamicDrawUsage);
  g.setAttribute('position', pos);
  const idx: number[] = [];
  for (let i = 1; i < RAYS; i++) idx.push(0, i, i + 1); // counter-clockwise seen from above: facing up
  g.setIndex(idx);
  const tint = uniform(new Color(PALETTE.sand));
  const m = new MeshBasicNodeMaterial();
  m.colorNode = tint;
  const a = floor(screenCoordinate.xy) as any;
  m.maskNode = fract(a.x.add(a.y).mul(0.5)).lessThan(0.25); // every other art pixel: a checker
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false;
  return { mesh, tint: tint as unknown as { value: Color } };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const STEALTH: RoomDef = {
  id: 'stealth',
  title: 'Stealth',
  wing: 'genres',
  about:
    'A warehouse with guards on patrol, each with a cone of vision that stops at walls and crates. Sneak from cover to cover: if a guard sees you long enough it raises the alarm and they all come for you along the shortest paths, then lose you and go back to their rounds.',
  try: ['Reach the GOAL in the far corner unseen', 'Get spotted on purpose, then break line of sight', 'Crouch (C) to sneak: you are seen more slowly'],
  spawn: [-11.5, 0, 6], // the bottom-left corner; the goal is the top-right
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'A walled warehouse on a grid, crates to hide behind, four guards (three on patrol, one on watch) with vision cones, a detection mark over each guard and the alarm on the HUD.',
    how: [
      'The level is a nav grid made from the same ASCII map that builds the room: one cell per metre, walls and crates closed. Guards walk their patrol routes waypoint to waypoint.',
      'Seeing: the hero is seen when within a guard\'s view distance, inside the cone (the angle between the guard\'s facing and the hero), and in line of sight: a walk along the grid cells between them (a DDA, like a raycaster) finds no wall or crate.',
      'Detection fills while seen (faster up close, slower when you crouch) and drains when not. Half full: suspicious (the guard stops and turns toward you, a ?). Full: the alarm (a !).',
      'Chasing: each guard asks the grid for a path to the hero (A* with diagonal moves, no corner cutting, octile distance, then smoothed by line of sight) and follows it, asking again as you move; when nobody has seen you for a while they path back to their rounds.',
      'The cones are fans of rays cast on the grid, so they stop at walls and you can see where it is safe. They are half see-through by an ordered dither (every other pixel), with no blending.',
    ],
    uses: [
      'Stealth games: Metal Gear Solid\'s vision cones and alert phases, Mark of the Ninja, Hitman, Commandos, Desperados.',
      'Pathfinding for any enemies that chase or patrol: A* on grids and navmeshes is in almost every game.',
    ],
    ask: ['guards with vision cones', 'enemies that chase the player around walls', 'a stealth detection meter', 'A* pathfinding on a grid'],
    cost: 'Line of sight: a few dozen cell checks per guard per frame; a cone: 24 short ray walks. A path: A* over a few hundred cells, a few times a second per chasing guard.',
    code: [
      {
        title: 'Line of sight: walk the cells between two points',
        file: 'src/engine/ai/navgrid.ts',
        src: `lineOfSight(ax: number, az: number, bx: number, bz: number, radius = 0): boolean {`,
      },
      {
        title: 'A*: the octile distance to the goal as the heuristic',
        file: 'src/engine/ai/navgrid.ts',
        src: `return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); // octile distance`,
      },
    ],
    words: ['navigation grid', 'A*', 'line of sight', 'vision cone'],
  },
  async build(room) {
    const { kit, ctx } = room;
    kit.map(MAP, {
      floor: ['mist', 'slate'],
      wall: { height: 1.5, color: 'slate', side: 'night' },
      legend: { c: { block: { height: 1.1, color: 'orange', side: 'plum' } }, '=': { block: { height: 0.5, color: 'slate', side: 'night' } } },
    });
    const nav = NavGrid.fromRows(MAP, { blocked: '#=c' });
    const cell = (c: number, r: number): [number, number] => [nav.centerX(c), nav.centerZ(r)];
    const ROUTES = STEALTH_ROUTES.map((r) => r.map(([c, row]) => cell(c, row)));
    let view = 7;
    let fov = 70;
    let alarm = 0;
    let caught = 0;
    let alarms = 0;
    const guards: Guard[] = [];
    for (const route of ROUTES) {
      const [x, z] = route[0]!;
      const man = await mannequin(ctx, 'Walk', [x, 0, z]);
      // a guard's helmet instead of the hero's cap, so nobody mistakes them for you
      const cap = man.root.getObjectByName('Cap');
      if (cap) cap.visible = false;
      const helmet = new Mesh(new BoxGeometry(0.62, 0.22, 0.62), toonMaterial(PALETTE.navy));
      helmet.position.set(0, 0.56, 0);
      helmet.castShadow = true;
      man.root.getObjectByName('Head')?.add(helmet);
      const { mesh, tint } = coneMesh();
      ctx.scene.add(mesh);
      const label = kit.label([x, 2.4, z], '', { color: 'sand', always: true, scale: 2 });
      guards.push({ man, route, leg: route.length > 1 ? 1 : 0, pos: new Vector3(x, 0, z), yaw: 0, seen: new Vector3(), path: [], repath: 0, state: 'patrol', meter: 0, cone: mesh, tint, label, clip: 'Walk' });
    }
    kit.light({ position: [0, 4, 0], color: PALETTE.sky, intensity: 3, radius: 16, flicker: 'none' });
    let made = 0;
    const [gx, gz] = cell(24, 1);
    kit.pad([gx - 0.5, 0, gz + 0.5], {
      label: 'GOAL',
      color: 'lime',
      note: 'The far corner.',
      apply: () => {
        made++;
        room.toast(alarms === 0 && caught === 0 ? 'Made it, unseen. A ghost.' : `Made it, after ${alarms} alarm${alarms === 1 ? '' : 's'}. Try again unseen?`, 4);
        ctx.audio.play('fanfare');
        alarms = caught = 0;
      },
    });
    kit.light({ position: [10, 3, 5], color: PALETTE.orange, intensity: 3, radius: 8, flicker: 'torch' });

    const knobs: Knob[] = [
      { id: 'view', label: 'View distance', min: 2, max: 12, step: 0.5, get: () => view, set: (v) => (view = v), format: (v) => `${v} m`, initial: 7 },
      { id: 'fov', label: 'Field of view', min: 20, max: 140, step: 5, get: () => fov, set: (v) => (fov = v), format: (v) => `${v}°`, initial: 70 },
    ];
    const play = (g: Guard, clip: string) => {
      if (g.clip === clip) return;
      g.clip = clip;
      g.man.play(clip, { fade: 0.2 });
    };
    const turnToward = (g: Guard, x: number, z: number, rate: number, dt: number) => {
      const want = Math.atan2(x - g.pos.x, z - g.pos.z);
      let d = want - g.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    };
    /** Walk toward (x, z) at `speed`; true when there. */
    const walk = (g: Guard, x: number, z: number, speed: number, dt: number) => {
      const dx = x - g.pos.x;
      const dz = z - g.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) return true;
      turnToward(g, x, z, 6, dt);
      const step = Math.min(d, speed * dt);
      g.pos.x += (dx / d) * step;
      g.pos.z += (dz / d) * step;
      return false;
    };
    /** Follow `g.path` (world points); true at its end. */
    const follow = (g: Guard, speed: number, dt: number) => {
      while (g.path.length && walk(g, g.path[0]![0], g.path[0]![2], speed, dt)) g.path.shift();
      return g.path.length === 0;
    };
    const tmp = new Vector3();
    const away = new Vector3();
    let respawnIn = 0;
    /** Give up the chase: path back to the round, detection cleared. */
    const lose = (g: Guard) => {
      g.state = 'return';
      g.path = [];
      g.meter = 0;
    };
    const sees = (g: Guard, at: Vector3) => {
      const dx = at.x - g.pos.x;
      const dz = at.z - g.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > view) return 0;
      let a = Math.atan2(dx, dz) - g.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > ((fov / 2) * Math.PI) / 180 && d > 1) return 0;
      // a hero up on a crate or a wall stands in a closed cell: look at the near edge of it instead
      const k = at.y > 0.5 ? Math.max(0, (d - 0.75) / d) : 1;
      if (!nav.lineOfSight(g.pos.x, g.pos.z, g.pos.x + dx * k, g.pos.z + dz * k)) return 0;
      return 1.6 - d / view; // closer is seen faster
    };
    const drawCone = (g: Guard) => {
      const p = g.cone.geometry.getAttribute('position') as BufferAttribute;
      p.setXYZ(0, g.pos.x, 0.04, g.pos.z);
      const half = ((fov / 2) * Math.PI) / 180;
      for (let i = 0; i < RAYS; i++) {
        const a = g.yaw - half + (i / (RAYS - 1)) * half * 2;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        const len = nav.castWall(g.pos.x, g.pos.z, dx, dz, view);
        p.setXYZ(i + 1, g.pos.x + dx * len, 0.04, g.pos.z + dz * len);
      }
      p.needsUpdate = true;
      g.tint.value.setHex(g.state === 'chase' ? PALETTE.red : g.state === 'suspicious' ? PALETTE.orange : g.state === 'return' ? PALETTE.mist : PALETTE.sand);
    };
    let t = 0;
    return {
      knobs,
      fixedUpdate(dt) {
        t += dt;
        if (respawnIn > 0 && (respawnIn -= dt) <= 0) room.respawn();
        const h = room.hero?.hero;
        const hero = h ? h.feetInto(tmp) : null;
        const sneaking = h?.stance !== 'stand';
        let anySees = false;
        for (const g of guards) {
          const s = hero ? sees(g, hero) : 0;
          if (s > 0) {
            anySees = true;
            g.seen.copy(hero!);
            g.meter = Math.min(1, g.meter + dt * s * (sneaking ? 0.45 : 1) * 1.2);
          } else g.meter = Math.max(0, g.meter - dt * 0.25);
          if (g.meter >= 1 && alarm <= 0) {
            alarm = 5;
            alarms++;
            ctx.audio.play('hurt', { pitch: 7 });
            room.toast('ALARM! They are all coming for you.', 2);
          }
        }
        if (alarm > 0) {
          if (anySees) alarm = 5;
          else alarm -= dt;
          if (alarm <= 0) for (const g of guards) if (g.state === 'chase') lose(g);
        }
        for (const g of guards) {
          if (alarm > 0 && hero) {
            // chase: a fresh A* path to the hero a few times a second
            if (g.state !== 'chase') g.state = 'chase';
            g.repath -= dt;
            if (g.repath <= 0 || !g.path.length) {
              g.path = nav.path([g.pos.x, 0, g.pos.z], [hero.x, 0, hero.z])?.slice(1) ?? [];
              g.repath = 0.4;
            }
            follow(g, 3.6, dt);
            play(g, 'Run');
            if (Math.hypot(hero.x - g.pos.x, hero.z - g.pos.z) < 0.8 && respawnIn <= 0) {
              caught++;
              alarm = 0;
              for (const o of guards) lose(o);
              h!.hurt(away.set(g.pos.x - hero.x, 0, g.pos.z - hero.z), 1); // where the hit came from
              room.toast('Caught! Back to the start.', 2);
              respawnIn = 0.7; // let the hit show first
            }
            continue;
          }
          if (g.state === 'return') {
            if (!g.path.length) {
              const [x, z] = g.route[g.leg]!;
              g.path = nav.path([g.pos.x, 0, g.pos.z], [x, 0, z])?.slice(1) ?? [];
              if (!g.path.length) g.state = 'patrol';
            }
            if (follow(g, 1.6, dt)) g.state = 'patrol';
            play(g, 'Walk');
            continue;
          }
          if (g.meter >= 0.5) {
            // suspicious: stop and turn toward where it saw you
            g.state = 'suspicious';
            turnToward(g, g.seen.x, g.seen.z, 3, dt);
            play(g, 'Idle');
            continue;
          }
          g.state = 'patrol';
          if (g.route.length === 1) {
            // on watch: look left and right
            g.yaw = Math.sin(t * 0.6) * 1.1;
            walk(g, g.route[0]![0], g.route[0]![1], 1.6, dt);
            play(g, 'Idle');
          } else {
            const [x, z] = g.route[g.leg]!;
            if (walk(g, x, z, 1.6, dt)) g.leg = (g.leg + 1) % g.route.length;
            play(g, 'Walk');
          }
        }
      },
      update(dt) {
        for (const g of guards) {
          g.man.mixer.update(dt);
          g.man.root.position.copy(g.pos);
          g.man.root.rotation.y = g.yaw;
          drawCone(g);
          g.label.at.set(g.pos.x, 2.4, g.pos.z);
          g.label.text = g.state === 'chase' ? '!' : g.state === 'suspicious' ? '?' : '';
          g.label.color = g.state === 'chase' ? 'red' : 'sand';
        }
      },
      draw() {
        const worst = Math.max(...guards.map((g) => g.meter));
        ctx.hud.text(4, 18, alarm > 0 ? `ALARM ${alarm.toFixed(1)}` : worst > 0 ? `SEEN ${Math.round(worst * 100)}%` : 'HIDDEN', { anchor: 'bottom-left', color: alarm > 0 ? 'red' : worst > 0 ? 'orange' : 'lime' });
      },
      status: () => `alarm ${alarm > 0} caught ${caught} states ${guards.map((g) => g.state).join(',')}`,
      api: {
        states: () => guards.map((g) => g.state),
        meters: () => guards.map((g) => g.meter),
        guards: () => guards.map((g) => g.pos.toArray()),
        alarm: () => alarm,
        alarms: () => alarms,
        caught: () => caught,
        made: () => made,
        /** Whether every guard stands on a walkable cell (none walks through walls). */
        onFloor: () => guards.every((g) => nav.walkable(g.pos.x, g.pos.z)),
        /** Each guard's distance to the hero (m). */
        distances: () => {
          const at = room.hero?.position;
          return at ? guards.map((g) => Math.hypot(g.pos.x - at.x, g.pos.z - at.z)) : [];
        },
        /** Raise the alarm now (tests). */
        raise: () => {
          for (const g of guards) g.meter = 1;
          alarm = 5;
          alarms++;
        },
      },
    };
  },
};
