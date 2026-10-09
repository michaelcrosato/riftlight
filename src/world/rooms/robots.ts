/**
 * Robot Yard: little robots that think with behaviour trees. Each one runs from the hero,
 * recharges when its battery runs low, carries crystals to the bin and wanders when there is
 * nothing to do; the HUD draws one robot's tree live, lighting the branch it is on.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicNodeMaterial, OctahedronGeometry, SphereGeometry, Vector3 } from 'three/webgpu';
import { BehaviorTree, bt, type BtStatus, NavGrid, PALETTE, setLookLayer, type SoundDef, toonMaterial } from '../../engine';
import type { Label } from '../kit/RoomKit';
import type { Knob, RoomDef } from '../types';

/** The yard: # walls, = low walls (south and east, so the camera sees in), x crates. */
export const YARD_MAP = [
  '#######################=',
  '#.........#............=',
  '#.........#............=',
  '#...xx....#......xx....=',
  '#...xx...........xx....=',
  '#......................=',
  '#..........####........=',
  '#......................=',
  '#...xx..........xx..#..=',
  '#...xx..........xx..#..=',
  '#...................#..=',
  '#......................=',
  '#=======================',
];

interface Crystal {
  mesh: Mesh;
  x: number;
  z: number;
  /** The robot that has called dibs on it. */
  claimedBy: Bot | null;
}

interface Bot {
  name: string;
  group: Group;
  eye: MeshBasicNodeMaterial;
  load: Mesh;
  label: Label;
  pos: Vector3;
  yaw: number;
  battery: number;
  needsCharge: boolean;
  carrying: boolean;
  target: Crystal | null;
  /** Where its path leads, and the path (world points). */
  dest: [number, number] | null;
  path: [number, number, number][];
  heroDist: number;
  /** Fleeing: calm again only well past the scare distance (no flicker at its edge). */
  scared: boolean;
  /** This tick's branch, root first (activePath, once per tick). */
  branch: string[];
  /** Seconds left before it picks a new way to flee. */
  fleeTurn: number;
  delivered: number;
  tree: BehaviorTree<Bot>;
}

const BEEP: SoundDef = { wave: 'square', duty: 0.25, freq: 1320, arp: [0, 7], arpRate: 0.05, attack: 0.002, sustain: 0.05, decay: 0.05, volume: 0.12 };
const STATUS_COLOR: Record<BtStatus, 'sand' | 'lime' | 'red'> = { running: 'sand', success: 'lime', failure: 'red' };
const STATUS_MARK: Record<BtStatus, string> = { running: '>', success: '+', failure: 'x' };

export const ROBOTS: RoomDef = {
  id: 'robots',
  title: 'Robot Yard',
  wing: 'direction',
  about:
    'Four little robots, each thinking with a behaviour tree: run from the hero, recharge when the battery is low, carry crystals to the bin, and wander when there is nothing to do. The tree of the robot you watch is drawn live, its current branch lit.',
  try: ['Walk at a robot: it drops what it was doing and runs', 'DRAIN BATTERIES and watch them queue at the charger', 'MORE CRYSTALS, then watch who claims which', 'WATCH NEXT to read another robot\'s mind'],
  spawn: [0, 0, 4],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'A walled yard with crates, a charger (green, west), a bin (orange, east), crystals scattered about, and four robots. The HUD shows one robot\'s whole tree: > running, + succeeded, x failed, dim where this tick never went.',
    how: [
      'A behaviour tree is ticked every step. Each node answers success, failure or running (still at it, ask me again next tick). Leaves do the work: conditions test something, actions move the robot a step.',
      'A selector tries its children in order of priority and stops at the first that does not fail. The root here is one: flee, else recharge, else deliver, else collect, else wander.',
      'A sequence runs its children in order and stops at the first that does not succeed: "carrying?" then "go to the bin" then "drop it". Both are reactive: every tick starts again at the top, so when the hero comes close, flee wins at once.',
      'The branch that was running is halted: its actions are told to stop (going to a crystal lets go of its claim, so another robot can take it). Halting is what makes interruptions clean.',
      'Decorators change one child\'s answer: the beep is under a cooldown (it fails for 3 s after it beeped) under a succeeder (so the flee goes on either way). Wander is a sequence with memory: once a spot is picked it is not picked again until the stroll and the look about are done.',
      '"Hero close?" has a margin: scared within the scare distance, calm again only 1.5 m past it. Without it a robot at the edge flips between fleeing and working every tick, and never gets anywhere.',
      'Walking is A* on a navigation grid made from the same map as the walls, with the cells near the hero closed while it searches, so a robot goes round you instead of back past you; battery drains with every metre.',
    ],
    uses: [
      'Halo 2 made behaviour trees famous for game AI (Damian Isla, 2005); Unreal Engine has them built in, and most console games since use them or something close.',
      'Robots too: ROS 2\'s navigation stack runs on BehaviorTree.CPP, the same reactive selectors and sequences.',
    ],
    ask: ['a behaviour tree for enemy AI', 'NPCs that run away, then go back to work', 'a selector and sequence AI with interruptions', 'drawing an AI\'s decision for debugging'],
    cost: 'A tick visits a dozen small nodes per robot: nothing. A* runs only when a robot picks a new destination (a few hundred cells).',
    code: [
      {
        title: 'A reactive selector: the first child that does not fail decides, and the one that was running is halted',
        file: 'src/engine/ai/behavior.ts',
        src: `const s = this.children[i]!.run(b, dt, tree);
if (s === 'failure') continue;
this.switchTo(s === 'running' ? i : -1, b);`,
      },
      {
        title: 'The robots\' tree, top to bottom in priority order',
        file: 'src/world/rooms/robots.ts',
        src: `bt.sequence('flee', bt.condition('hero close?', (b) => (b.scared = scare > 0 && b.heroDist < (b.scared ? scare + 1.5 : scare))), beep, bt.action('run away', runAway, stop)),
bt.sequence('recharge', bt.condition('battery low?', (b) => (b.needsCharge ||= b.battery < 0.25)), bt.action('go to charger', goCharger, stop), bt.action('charge', charge)),`,
      },
    ],
    words: ['behaviour tree', 'selector', 'blackboard', 'navigation grid', 'A*'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.map(YARD_MAP, {
      floor: ['mist', 'slate'],
      wall: { height: 1.5, color: 'slate', side: 'night' },
      legend: { x: { block: { height: 1, color: 'orange', side: 'plum' } }, '=': { block: { height: 0.5, color: 'slate', side: 'night' } } },
    });
    const nav = NavGrid.fromRows(YARD_MAP, { blocked: '#=x' });
    const open: [number, number][] = [];
    for (let r = 0; r < YARD_MAP.length; r++) for (let c = 0; c < YARD_MAP[r]!.length; c++) if (nav.isOpen(c, r)) open.push([nav.centerX(c), nav.centerZ(r)]);
    const at = (c: number, r: number): [number, number] => [nav.centerX(c), nav.centerZ(r)];
    const charger = at(1, 1);
    const bin = at(21, 1);
    kit.box([charger[0] + 0.5, 0.05, charger[1] + 0.5], [2.4, 0.1, 2.4], 'lime', { side: 'green', ghost: true });
    kit.box([charger[0] - 0.55, 0.6, charger[1] - 0.55], [0.3, 1.2, 0.3], 'green', { side: 'teal' });
    kit.label([charger[0], 1.6, charger[1]], 'CHARGER', { color: 'lime', range: 12 });
    kit.box([bin[0], 0.35, bin[1] - 0.3], [1.2, 0.7, 0.6], 'orange', { side: 'red' });
    kit.label([bin[0], 1.4, bin[1]], 'BIN', { color: 'orange', range: 12 });
    kit.light({ position: [0, 4, 0], color: PALETTE.sky, intensity: 3, radius: 16, flicker: 'none' });

    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    // crystals
    const crystals: Crystal[] = [];
    const crystalGeo = new OctahedronGeometry(0.22, 0);
    const crystalMat = kit.glow('cyan');
    const scatter = (n: number) => {
      for (let i = 0; i < n && crystals.length < 24; i++) {
        const [x, z] = open[Math.floor(rand() * open.length)]!;
        if (Math.hypot(x - charger[0], z - charger[1]) < 2 || Math.hypot(x - bin[0], z - bin[1]) < 2) continue;
        if (crystals.some((c) => Math.hypot(c.x - x, c.z - z) < 0.5)) continue;
        const mesh = new Mesh(crystalGeo, crystalMat);
        mesh.position.set(x, 0.4, z);
        setLookLayer(mesh, 'actors');
        ctx.scene.add(mesh);
        crystals.push({ mesh, x, z, claimedBy: null });
      }
    };
    scatter(8);

    let scare = 3;
    let speed = 2.2;
    const COLORS = ['sky', 'lime', 'sand', 'red'] as const;
    const bodyGeo = new CylinderGeometry(0.32, 0.36, 0.5, 10);
    const headGeo = new BoxGeometry(0.5, 0.34, 0.42);
    const eyeGeo = new BoxGeometry(0.3, 0.08, 0.04);
    const stalkGeo = new CylinderGeometry(0.02, 0.02, 0.3, 4);
    const tipGeo = new SphereGeometry(0.06, 6, 4);

    // ---- the actions: each moves its robot one step and answers ----
    const stop = (b: Bot) => {
      b.dest = null;
      b.path = [];
    };
    /**
     * An A* path that keeps out of the hero's way: the cells within the scare distance (and a
     * metre) closed while it searches, all but the robot's own and the goal's. If the hero
     * blocks every way, the plain path (it will be scared on the way, and come back).
     */
    const route = (b: Bot, x: number, z: number) => {
      const h = room.hero?.position;
      const closed: [number, number][] = [];
      if (h && scare > 0) {
        const reach = scare + 1;
        const span = Math.ceil(reach);
        const hc = nav.col(h.x);
        const hr = nav.row(h.z);
        for (let r = hr - span; r <= hr + span; r++)
          for (let c = hc - span; c <= hc + span; c++) {
            if (!nav.isOpen(c, r) || Math.hypot(nav.centerX(c) - h.x, nav.centerZ(r) - h.z) >= reach) continue;
            if ((c === nav.col(b.pos.x) && r === nav.row(b.pos.z)) || (c === nav.col(x) && r === nav.row(z))) continue;
            nav.setOpen(c, r, false);
            closed.push([c, r]);
          }
      }
      let p = nav.path([b.pos.x, 0, b.pos.z], [x, 0, z]);
      for (const [c, r] of closed) nav.setOpen(c, r, true);
      if (!p && closed.length) p = nav.path([b.pos.x, 0, b.pos.z], [x, 0, z]);
      return p?.slice(1) ?? [];
    };
    /** Walk toward (x, z) along an A* path; success within `near` of it, failure if there is no way. */
    const goTo = (b: Bot, x: number, z: number, dt: number, near = 0): BtStatus => {
      if (near > 0 && Math.hypot(b.pos.x - x, b.pos.z - z) <= near) {
        stop(b);
        return 'success';
      }
      if (!b.dest || Math.hypot(b.dest[0] - x, b.dest[1] - z) > 0.1) {
        b.dest = [x, z];
        b.path = route(b, x, z);
        if (!b.path.length && Math.hypot(b.pos.x - x, b.pos.z - z) > 0.3) {
          b.dest = null; // no way there: ask again next time, never "arrived"
          return 'failure';
        }
      }
      let budget = speed * (b.battery > 0.1 ? 1 : 0.5) * dt;
      while (b.path.length && budget > 0) {
        const [px, , pz] = b.path[0]!;
        const dx = px - b.pos.x;
        const dz = pz - b.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) b.yaw = Math.atan2(dx, dz);
        const step = Math.min(d, budget);
        if (d > 1e-4) b.pos.set(b.pos.x + (dx / d) * step, 0, b.pos.z + (dz / d) * step);
        budget -= step;
        b.battery = Math.max(0, b.battery - step * 0.012);
        if (step >= d) b.path.shift();
      }
      if (b.path.length) return 'running';
      b.dest = null;
      return 'success';
    };
    const runAway = (b: Bot, dt: number): BtStatus => {
      const h = room.hero?.position;
      if (!h) return 'failure';
      b.fleeTurn -= dt;
      if (!b.dest || b.fleeTurn <= 0) {
        // the open cell farthest from the hero among a few near the robot
        let best: [number, number] | null = null;
        let score = -Infinity;
        for (const [x, z] of open) {
          const fromBot = Math.hypot(x - b.pos.x, z - b.pos.z);
          if (fromBot > 5 || fromBot < 1.5) continue;
          const s = Math.hypot(x - h.x, z - h.z) - fromBot * 0.3;
          if (s > score) {
            score = s;
            best = [x, z];
          }
        }
        b.fleeTurn = 0.6;
        if (!best) return 'running';
        b.dest = null;
        void goTo(b, best[0], best[1], 0);
      }
      if (b.dest) void goTo(b, b.dest[0], b.dest[1], dt * 1.5);
      return 'running';
    };
    /** A beep at most every 3 s (one per tree: a node keeps its own state). */
    const beeper = () =>
      bt.succeeder(
        bt.cooldown(
          bt.action<Bot>('beep', (b) => {
            ctx.audio.play(BEEP, { volume: 0.5, pitch: bots.indexOf(b) * 2 });
            return 'success';
          }),
          3,
          'beep (every 3 s)',
        ),
        'beep, maybe',
      );
    // anywhere on the charging pad will do: four robots cannot all stand on one point
    const goCharger = (b: Bot, dt: number) => goTo(b, charger[0] + 0.5, charger[1] + 0.5, dt, 1.1);
    const charge = (b: Bot, dt: number): BtStatus => {
      b.battery = Math.min(1, b.battery + dt * 0.3);
      if (b.battery < 1) return 'running';
      b.needsCharge = false;
      return 'success';
    };
    const claim = (b: Bot): BtStatus => {
      if (b.target && crystals.includes(b.target) && b.target.claimedBy === b) return 'success';
      let best: Crystal | null = null;
      for (const c of crystals) if (!c.claimedBy && (!best || Math.hypot(c.x - b.pos.x, c.z - b.pos.z) < Math.hypot(best.x - b.pos.x, best.z - b.pos.z))) best = c;
      if (!best) return 'failure';
      best.claimedBy = b;
      b.target = best;
      return 'success';
    };
    const release = (b: Bot) => {
      if (b.target?.claimedBy === b) b.target.claimedBy = null;
      b.target = null;
      stop(b);
    };
    const pickUp = (b: Bot): BtStatus => {
      const c = b.target;
      if (!c) return 'failure';
      crystals.splice(crystals.indexOf(c), 1);
      c.mesh.removeFromParent();
      b.target = null;
      b.carrying = true;
      ctx.audio.play('coin', { volume: 0.25 });
      return 'success';
    };
    let delivered = 0;
    const drop = (b: Bot): BtStatus => {
      b.carrying = false;
      b.delivered++;
      delivered++;
      ctx.audio.play('coin', { volume: 0.3, pitch: -5 });
      return 'success';
    };
    const spot = new Map<Bot, [number, number]>();

    const makeTree = (bot: Bot) => {
      const beep = beeper();
      return new BehaviorTree<Bot>(
        bt.selector(
          'robot',
          bt.sequence('flee', bt.condition('hero close?', (b) => (b.scared = scare > 0 && b.heroDist < (b.scared ? scare + 1.5 : scare))), beep, bt.action('run away', runAway, stop)),
          bt.sequence('recharge', bt.condition('battery low?', (b) => (b.needsCharge ||= b.battery < 0.25)), bt.action('go to charger', goCharger, stop), bt.action('charge', charge)),
          bt.sequence('deliver', bt.condition('carrying?', (b) => b.carrying), bt.action('go to bin', (b, dt) => goTo(b, bin[0], bin[1] + 0.4, dt), stop), bt.action('drop it', drop)),
          bt.sequence('collect', bt.action('claim a crystal', claim), bt.action('go to it', (b, dt) => (b.target ? goTo(b, b.target.x, b.target.z, dt) : 'failure'), release), bt.action('pick it up', pickUp)),
          bt.steps(
            'wander',
            bt.action('pick a spot', (b) => (spot.set(b, open[Math.floor(rand() * open.length)]!), 'success')),
            bt.action('stroll', (b, dt) => goTo(b, spot.get(b)![0], spot.get(b)![1], dt * 0.6), stop),
            bt.wait('look about', 1.5),
          ),
        ),
        bot,
      );
    };

    const bots: Bot[] = [];
    const starts = [at(6, 5), at(14, 7), at(8, 10), at(18, 5)];
    starts.forEach(([x, z], i) => {
      const group = new Group();
      const body = new Mesh(bodyGeo, toonMaterial(PALETTE[COLORS[i]!]));
      body.position.y = 0.3;
      const head = new Mesh(headGeo, toonMaterial(PALETTE.mist));
      head.position.y = 0.75;
      const eye = new MeshBasicNodeMaterial({ color: PALETTE.lime });
      const eyeMesh = new Mesh(eyeGeo, eye);
      eyeMesh.position.set(0, 0.78, 0.22);
      const stalk = new Mesh(stalkGeo, toonMaterial(PALETTE.slate));
      stalk.position.y = 1.05;
      const tip = new Mesh(tipGeo, toonMaterial(PALETTE[COLORS[i]!]));
      tip.position.y = 1.22;
      const load = new Mesh(crystalGeo, crystalMat);
      load.position.set(0, 1.0, -0.35);
      load.visible = false;
      group.add(body, head, eyeMesh, stalk, tip, load);
      for (const m of [body, head, stalk, tip]) m.castShadow = true;
      group.position.set(x, 0, z);
      setLookLayer(group, 'actors');
      ctx.scene.add(group);
      const label = kit.label([x, 1.7, z], '', { color: COLORS[i], always: true });
      const bot = { name: `ROBOT ${i + 1}`, group, eye, load, label, pos: new Vector3(x, 0, z), yaw: 0, battery: 0.55 + i * 0.15, needsCharge: false, carrying: false, target: null, dest: null, path: [], heroDist: Infinity, scared: false, branch: [], fleeTurn: 0, delivered: 0 } as unknown as Bot;
      bot.tree = makeTree(bot);
      bots.push(bot);
    });

    let watched = 0;
    kit.pad([-6, 0, 4], { label: 'WATCH NEXT', color: 'sky', note: "The HUD draws this robot's tree: every node, and what it answered this tick.", apply: () => (watched = (watched + 1) % bots.length) });
    kit.pad([-2, 0, 4], { label: 'MORE CRYSTALS', color: 'cyan', note: 'Six more crystals: each robot claims the nearest one nobody has claimed (the claim lives on the blackboard).', apply: () => scatter(6) });
    kit.pad([2, 0, 4], {
      label: 'DRAIN BATTERIES',
      color: 'red',
      note: 'Every battery to 15%: "battery low?" now passes, so recharge beats deliver and collect, and whatever they were doing is halted.',
      apply: () => {
        for (const b of bots) b.battery = 0.15;
      },
    });
    const knobs: Knob[] = [
      { id: 'scare', label: 'Scare distance', min: 0, max: 6, step: 0.5, get: () => scare, set: (v) => (scare = v), format: (v) => `${v} m`, initial: 3, hint: 'How close the hero may come before "hero close?" passes. 0: they ignore you.' },
      { id: 'speed', label: 'Robot speed', min: 0.5, max: 4, step: 0.25, get: () => speed, set: (v) => (speed = v), format: (v) => `${v} m/s`, initial: 2.2 },
    ];

    let t = 0;
    const leaf = (b: Bot) => b.branch.at(-1) ?? '';
    return {
      knobs,
      fixedUpdate(dt) {
        const h = room.hero?.position;
        for (const b of bots) {
          b.heroDist = h ? Math.hypot(h.x - b.pos.x, h.z - b.pos.z) : Infinity;
          b.battery = Math.max(0, b.battery - dt * 0.004);
          b.tree.tick(dt);
          b.branch = b.tree.activePath();
        }
        // keep apart a little (they are not physics bodies)
        for (const a of bots)
          for (const o of bots) {
            if (a === o) continue;
            const dx = a.pos.x - o.pos.x;
            const dz = a.pos.z - o.pos.z;
            const d = Math.hypot(dx, dz);
            if (d > 1e-3 && d < 0.7) {
              const nx = a.pos.x + (dx / d) * (0.7 - d) * 0.25;
              const nz = a.pos.z + (dz / d) * (0.7 - d) * 0.25;
              // only where it can still walk straight on to the next point of its path (no corner cut)
              const next = a.path[0];
              if (nav.walkable(nx, nz) && (!next || nav.lineOfSight(nx, nz, next[0], next[2]))) a.pos.set(nx, 0, nz);
            }
          }
      },
      update(dt) {
        t += dt;
        for (const c of crystals) {
          c.mesh.rotation.y = t * 1.5;
          c.mesh.position.y = 0.4 + Math.sin(t * 2 + c.x) * 0.06;
        }
        for (const b of bots) {
          b.group.position.set(b.pos.x, Math.abs(Math.sin(t * 9)) * (b.dest ? 0.04 : 0), b.pos.z);
          let d = b.yaw - b.group.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          b.group.rotation.y += d * Math.min(1, dt * 10);
          b.load.visible = b.carrying;
          const mood = b.branch.includes('flee') ? PALETTE.red : b.branch.includes('recharge') ? PALETTE.orange : PALETTE.lime;
          b.eye.color.setHex(b.battery <= 0.05 ? PALETTE.slate : mood);
          b.label.at.set(b.pos.x, 1.7, b.pos.z);
          b.label.text = bots.indexOf(b) === watched ? `${leaf(b).toUpperCase()} ${Math.round(b.battery * 100)}%` : `${Math.round(b.battery * 100)}%`;
        }
      },
      draw() {
        const b = bots[watched]!;
        const hud = ctx.hud;
        const rows = b.tree.trace().map((row) => ({ x: 4 + row.depth * 8, text: `${row.status ? STATUS_MARK[row.status] : ' '} ${row.name.toUpperCase()}`, color: row.status ? STATUS_COLOR[row.status] : ('slate' as const) }));
        const title = `${b.name} · BATTERY ${Math.round(b.battery * 100)}%`;
        const width = Math.max(hud.measure(title).width, ...rows.map((r) => r.x - 4 + hud.measure(r.text).width));
        hud.rect(1, 1, width + 6, 16 + rows.length * 9, 'ink');
        hud.text(4, 4, title, { color: 'white' });
        rows.forEach((r, i) => hud.text(r.x, 15 + i * 9, r.text, { color: r.color }));
        hud.text(4, 18, `DELIVERED ${delivered} · ${crystals.length} CRYSTALS LEFT`, { anchor: 'bottom-left', color: 'cyan' });
      },
      status: () => `delivered ${delivered} doing ${bots.map(leaf).join(', ')}`,
      api: {
        /** Each robot's branch this tick, root first. */
        paths: () => bots.map((b) => [...b.branch]),
        batteries: () => bots.map((b) => b.battery),
        delivered: () => delivered,
        crystals: () => crystals.length,
        /** Claimed crystals each have one robot heading for them, and no robot claims two. */
        claimsConsistent: () => bots.every((b) => !b.target || b.target.claimedBy === b) && crystals.every((c) => !c.claimedBy || c.claimedBy.target === c),
        positions: () => bots.map((b) => [b.pos.x, b.pos.z]),
        onFloor: () => bots.every((b) => nav.walkable(b.pos.x, b.pos.z)),
        trace: (i = watched) => bots[i]!.tree.trace(),
        watch: (i: number) => (watched = i),
        drain: () => bots.forEach((b) => (b.battery = 0.15)),
        scatter: (n = 6) => scatter(n),
        charger: () => charger,
      },
    };
  },
};
