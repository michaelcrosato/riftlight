/**
 * Things built from rigid bodies and joints, ready to drop into a level: hanging chains (a
 * wrecking ball is a chain with a heavy end), walkable rope bridges, hinged doors and gates,
 * springy platforms, seesaws. Each makes its Rapier bodies and joints and binds a toon mesh to
 * every body (drawn interpolated, like `physics.bind`). The engine frees them with the level;
 * `remove()` takes one out sooner (a rebuild).
 *
 *   chain(ctx, [0, 6, 0], { links: 8, end: { ball: 0.6, density: 8 } });        // a wrecking ball
 *   ropeBridge(ctx, [-6, 2, 0], [6, 2, 0], { planks: 9, width: 1.6, sag: 0.5 });
 *   hingeDoor(ctx, [3, 0, 0], { width: 1.2, height: 2.2, swing: 100 });
 *   springPad(ctx, [0, 0, 4], { size: [2, 0.3, 2], stiffness: 60 });
 *   seesaw(ctx, [0, 0, -4], { length: 5 });
 *
 * Joint types underneath (Rapier's, `physics.world.createImpulseJoint`): spherical (a ball
 * joint: free rotation about a point), revolute (a hinge about an axis, with limits and a
 * motor), prismatic (a slider along an axis, with a spring motor), fixed, rope, spring.
 */
import { BoxGeometry, CapsuleGeometry, Mesh, type Object3D, SphereGeometry } from 'three/webgpu';
import type { GameContext } from '../Engine';
import { PALETTE, type PaletteColor } from '../palette';
import { setLookLayer } from '../render/lookLayer';
import { toonMaterial } from '../render/toon';
import { RAPIER } from './Physics';

type Vec3 = readonly [number, number, number];
type Ctx = Pick<GameContext, 'physics' | 'scene'>;

const v = (x: number, y: number, z: number) => ({ x, y, z });

/** What every builder returns: its bodies, and a way to take it all out of the level again. */
export interface Built {
  /** Every body it made (fixed anchors included). */
  readonly bodies: RAPIER.RigidBody[];
  /** Remove its bodies, joints and meshes (a rebuild, a cut rope's leftovers). */
  remove(): void;
}

/** Collects a builder's bodies and meshes so `remove()` can free them. */
class Parts implements Built {
  readonly bodies: RAPIER.RigidBody[] = [];
  readonly meshes: Object3D[] = [];
  constructor(private readonly ctx: Ctx) {}
  body(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    const b = this.ctx.physics.world.createRigidBody(desc);
    this.bodies.push(b);
    return b;
  }
  /** Draw `mesh` bound to `body` (interpolated), or static when `body` is null. */
  show(body: RAPIER.RigidBody | null, mesh: Object3D, actors = true): void {
    mesh.castShadow = mesh.receiveShadow = true;
    if (actors) setLookLayer(mesh, 'actors');
    this.ctx.scene.add(mesh);
    if (body) this.ctx.physics.bind(body, mesh);
    this.meshes.push(mesh);
  }
  remove(): void {
    // removing a body removes its joints too
    for (const b of this.bodies) this.ctx.physics.remove(b);
    for (const m of this.meshes) m.removeFromParent();
    this.bodies.length = 0;
    this.meshes.length = 0;
  }
}

export interface ChainOptions {
  /** Links (capsules). Default 8. */
  links?: number;
  /** Length of one link (m). Default 0.35. */
  linkLength?: number;
  /** Link thickness (radius, m). Default 0.06. */
  radius?: number;
  color?: PaletteColor;
  /** Something heavy at the end: a ball of this radius (a wrecking ball) or a box. */
  end?: { ball?: number; box?: Vec3; density?: number; color?: PaletteColor };
  /** Hang toward this direction from the anchor (default straight down). */
  direction?: Vec3;
  /** Attach to this body instead of the world (`at` is then in its local space). */
  body?: RAPIER.RigidBody;
}

/**
 * A chain of capsule links on ball joints, hanging from `at`: its links, and the end weight.
 * An iterative solver stretches a chain whose end is far heavier than its links (like
 * elastic), so the links weigh at least 1/15 of the end and get 4 extra solver passes: a
 * wrecking ball's chain stretches by a few cm. (Multibody joints would be exact, but impulses
 * — blasts, punches, shoves — don't reach their links.)
 */
export function chain(ctx: Ctx, at: Vec3, o: ChainOptions = {}): Built & { links: RAPIER.RigidBody[]; end: RAPIER.RigidBody | null } {
  const world = ctx.physics.world;
  const parts = new Parts(ctx);
  const n = o.links ?? 8;
  const len = o.linkLength ?? 0.35;
  const r = o.radius ?? 0.06;
  const [dx, dy, dz] = o.direction ?? [0, -1, 0];
  const dl = Math.hypot(dx, dy, dz) || 1;
  const d = [dx / dl, dy / dl, dz / dl] as const;
  let anchor = o.body ?? parts.body(RAPIER.RigidBodyDesc.fixed().setTranslation(at[0], at[1], at[2]));
  let anchorAt = o.body ? v(at[0], at[1], at[2]) : v(0, 0, 0);
  const origin = o.body ? (() => {
    const t = o.body!.translation();
    return [t.x + at[0], t.y + at[1], t.z + at[2]] as const;
  })() : at;
  const mat = toonMaterial(PALETTE[o.color ?? 'slate']);
  const geo = new CapsuleGeometry(r, len - 2 * r, 2, 6);
  const endDensity = o.end?.density ?? 4;
  const endMass = o.end ? (o.end.ball ? (4 / 3) * Math.PI * o.end.ball ** 3 : (o.end.box ?? [0.5, 0.5, 0.5]).reduce((a, b) => a * b, 1)) * endDensity : 0;
  const linkVolume = Math.PI * r * r * (len - 2 * r) + (4 / 3) * Math.PI * r ** 3;
  const linkDensity = Math.max(2, endMass / 15 / linkVolume);
  const links: RAPIER.RigidBody[] = [];
  // links stand along Y in their own space; turn them to the hanging direction
  const q = rotationFromY(d);
  for (let i = 0; i < n; i++) {
    const c = (i + 0.5) * len;
    const body = parts.body(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin[0] + d[0] * c, origin[1] + d[1] * c, origin[2] + d[2] * c)
        .setRotation(q)
        .setLinearDamping(0.2)
        .setAngularDamping(0.6)
        .setAdditionalSolverIterations(4),
    );
    world.createCollider(RAPIER.ColliderDesc.capsule(len / 2 - r, r).setDensity(linkDensity).setCollisionGroups(CHAIN_GROUPS), body);
    world.createImpulseJoint(RAPIER.JointData.spherical(anchorAt, v(0, len / 2, 0)), anchor, body, true);
    parts.show(body, new Mesh(geo, mat));
    links.push(body);
    anchor = body;
    anchorAt = v(0, -len / 2, 0);
  }
  let end: RAPIER.RigidBody | null = null;
  if (o.end) {
    const size = o.end.ball ?? Math.max(...(o.end.box ?? [0.5, 0.5, 0.5])) / 2;
    const c = n * len + size;
    end = parts.body(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin[0] + d[0] * c, origin[1] + d[1] * c, origin[2] + d[2] * c)
        .setRotation(q)
        .setAngularDamping(0.4)
        .setAdditionalSolverIterations(4),
    );
    const shape = o.end.ball ? RAPIER.ColliderDesc.ball(o.end.ball) : RAPIER.ColliderDesc.cuboid(...((o.end.box ?? [0.5, 0.5, 0.5]).map((s) => s / 2) as [number, number, number]));
    world.createCollider(shape.setDensity(endDensity), end);
    world.createImpulseJoint(RAPIER.JointData.spherical(anchorAt, v(0, size, 0)), anchor, end, true);
    const m = o.end.ball ? new Mesh(new SphereGeometry(o.end.ball, 12, 9), toonMaterial(PALETTE[o.end.color ?? 'night'])) : new Mesh(new BoxGeometry(...(o.end.box ?? [0.5, 0.5, 0.5])), toonMaterial(PALETTE[o.end.color ?? 'night']));
    parts.show(end, m);
  }
  return { bodies: parts.bodies, links, end, remove: () => parts.remove() };
}

/** Links don't collide with each other (they would fight their own joints). */
const CHAIN_GROUPS = (0x0002 << 16) | 0xfffd;

export interface BridgeOptions {
  planks?: number;
  /** Width across (m). Default 1.6. */
  width?: number;
  /** How far the middle hangs below the ends (m). Default 0.4. */
  sag?: number;
  thickness?: number;
  color?: PaletteColor;
  rope?: PaletteColor;
  /** Gap between planks (m). Default 0.06. */
  gap?: number;
}

/**
 * A rope bridge from `from` to `to` (the middles of its two ends, at walking height):
 * planks on ball joints at both edges of every seam (so each seam bends like a hinge but the
 * bridge can also twist), hanging in a sag. The character can walk it: it presses the planks
 * down and rides them.
 */
export function ropeBridge(ctx: Ctx, from: Vec3, to: Vec3, o: BridgeOptions = {}): Built & { planks: RAPIER.RigidBody[]; cut(end: 'from' | 'to'): void } {
  const world = ctx.physics.world;
  const parts = new Parts(ctx);
  const n = o.planks ?? 9;
  const w = o.width ?? 1.6;
  const t = o.thickness ?? 0.12;
  const gap = o.gap ?? 0.06;
  const sag = o.sag ?? 0.4;
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const span = Math.hypot(dx, dz);
  const ux = dx / span;
  const uz = dz / span;
  const plank = span / n - gap;
  const yaw = Math.atan2(-uz, ux); // planks' local X along the bridge
  const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const fixedA = parts.body(RAPIER.RigidBodyDesc.fixed().setTranslation(from[0], from[1], from[2]).setRotation(rot));
  const fixedB = parts.body(RAPIER.RigidBodyDesc.fixed().setTranslation(to[0], to[1], to[2]).setRotation(rot));
  const mat = toonMaterial(PALETTE[o.color ?? 'orange']);
  const geo = new BoxGeometry(plank, t, w);
  const planks: RAPIER.RigidBody[] = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const y = from[1] + (to[1] - from[1]) * u - sag * 4 * u * (1 - u) - t / 2;
    const body = parts.body(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(from[0] + dx * u, y, from[2] + dz * u)
        .setRotation(rot)
        .setLinearDamping(0.6)
        .setAngularDamping(1.5),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(plank / 2, t / 2, w / 2).setDensity(1.2).setFriction(1), body);
    parts.show(body, new Mesh(geo, mat), false);
    planks.push(body);
  }
  // two joints per seam, at the planks' edges: each seam bends like a hinge
  const join = (a: RAPIER.RigidBody, aAt: number, b: RAPIER.RigidBody, bAt: number, ay = 0, by = 0) =>
    [-1, 1].map((s) => world.createImpulseJoint(RAPIER.JointData.spherical(v(aAt, ay, (s * w) / 2), v(bAt, by, (s * w) / 2)), a, b, true));
  const ends = {
    from: join(fixedA, 0, planks[0]!, -plank / 2, -t / 2, 0),
    to: [] as RAPIER.ImpulseJoint[],
  };
  for (let i = 0; i + 1 < n; i++) join(planks[i]!, plank / 2 + gap / 2, planks[i + 1]!, -plank / 2 - gap / 2);
  ends.to = join(planks[n - 1]!, plank / 2, fixedB, 0, 0, -t / 2);
  // posts at both ends
  const post = toonMaterial(PALETTE[o.rope ?? 'plum']);
  for (const p of [from, to])
    for (const s of [-1, 1]) {
      const m = new Mesh(new BoxGeometry(0.16, 1.2, 0.16), post);
      m.position.set(p[0] - uz * (s * (w / 2 + 0.12)), p[1] + 0.45, p[2] + ux * (s * (w / 2 + 0.12)));
      parts.show(null, m, false);
    }
  return {
    bodies: parts.bodies,
    planks,
    /** Cut the ropes at one end: the bridge swings down and hangs from the other. */
    cut(end) {
      for (const j of ends[end]) if (j.isValid()) world.removeImpulseJoint(j, true); // not by handle: a slot can be reused
      ends[end] = [];
    },
    remove: () => parts.remove(),
  };
}

export interface DoorOptions {
  width?: number;
  height?: number;
  thickness?: number;
  /** Swing limit either way (degrees). Default 110. */
  swing?: number;
  /** Turn the door frame about Y (radians). */
  yaw?: number;
  color?: PaletteColor;
  /** A spring that swings it shut again (stiffness per unit inertia, 0: none). Default 4. */
  closing?: number;
}

/** A door on a vertical hinge at `at` (the hinge's foot); push it open by walking into it. */
export function hingeDoor(ctx: Ctx, at: Vec3, o: DoorOptions = {}): Built & { door: RAPIER.RigidBody; hinge: RAPIER.RevoluteImpulseJoint } {
  const world = ctx.physics.world;
  const parts = new Parts(ctx);
  const w = o.width ?? 1.2;
  const h = o.height ?? 2.2;
  const t = o.thickness ?? 0.12;
  const yaw = o.yaw ?? 0;
  const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const frame = parts.body(RAPIER.RigidBodyDesc.fixed().setTranslation(at[0], at[1], at[2]).setRotation(rot));
  const door = parts.body(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at[0] + Math.cos(yaw) * (w / 2), at[1] + h / 2, at[2] - Math.sin(yaw) * (w / 2))
      .setRotation(rot)
      .setAngularDamping(0.6),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, t / 2).setDensity(0.6), door);
  const hinge = world.createImpulseJoint(RAPIER.JointData.revolute(v(0, h / 2, 0), v(-w / 2, 0, 0), v(0, 1, 0)), frame, door, true) as RAPIER.RevoluteImpulseJoint;
  const lim = ((o.swing ?? 110) * Math.PI) / 180;
  hinge.setLimits(-lim, lim);
  // the door's moment of inertia about its hinge (a slab turning about one edge): m·w²/3
  if ((o.closing ?? 4) > 0) spring(hinge, 0, o.closing ?? 4, 1.2, (door.mass() * w * w) / 3);
  parts.show(door, new Mesh(new BoxGeometry(w, h, t), toonMaterial(PALETTE[o.color ?? 'orange'])));
  return { bodies: parts.bodies, door, hinge, remove: () => parts.remove() };
}

export interface SpringPadOptions {
  size?: Vec3;
  /** Spring stiffness (1/s²: mass-independent). Higher: firmer. Default 40. */
  stiffness?: number;
  damping?: number;
  /** How far it can sink (m). Default 0.6. */
  travel?: number;
  color?: PaletteColor;
}

/**
 * A platform on a vertical slider with a spring motor: it rests at `at` (the spring holds its
 * own weight), sinks under a load (the character presses with its `weight`) and bounces back.
 */
export function springPad(ctx: Ctx, at: Vec3, o: SpringPadOptions = {}): Built & { pad: RAPIER.RigidBody; slider: RAPIER.PrismaticImpulseJoint } {
  const world = ctx.physics.world;
  const parts = new Parts(ctx);
  const [sx, sy, sz] = o.size ?? [2, 0.3, 2];
  const k = o.stiffness ?? 40;
  const base = parts.body(RAPIER.RigidBodyDesc.fixed().setTranslation(at[0], at[1], at[2]));
  const pad = parts.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(at[0], at[1], at[2]).lockRotations().setLinearDamping(0.5));
  world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setDensity(1).setFriction(1), pad);
  const slider = world.createImpulseJoint(RAPIER.JointData.prismatic(v(0, 0, 0), v(0, 0, 0), v(0, 1, 0)), base, pad, true) as RAPIER.PrismaticImpulseJoint;
  slider.setLimits(-(o.travel ?? 0.6), 0.15);
  // a spring per unit mass; aimed above the rest point by what gravity pulls, so the pad rests
  // at `at` with nothing on it
  spring(slider, -world.gravity.y / k, k, o.damping ?? 4, pad.mass());
  parts.show(pad, new Mesh(new BoxGeometry(sx, sy, sz), toonMaterial(PALETTE[o.color ?? 'lime'])), false);
  return { bodies: parts.bodies, pad, slider, remove: () => parts.remove() };
}

export interface SeesawOptions {
  /** Plank length (m). Default 5. */
  length?: number;
  width?: number;
  /** Height of the pivot above `at` (m). Default 0.7. */
  height?: number;
  /** Turn about Y (radians): 0 runs the plank along X. */
  yaw?: number;
  /** Tilt limit either way (degrees). Default 16. */
  tilt?: number;
  color?: PaletteColor;
}

/** A plank on a hinge across its middle, on a wedge: weight on one end tips it. */
export function seesaw(ctx: Ctx, at: Vec3, o: SeesawOptions = {}): Built & { plank: RAPIER.RigidBody; hinge: RAPIER.RevoluteImpulseJoint } {
  const world = ctx.physics.world;
  const parts = new Parts(ctx);
  const len = o.length ?? 5;
  const w = o.width ?? 1.4;
  const h = o.height ?? 0.7;
  const yaw = o.yaw ?? 0;
  const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const pivot = parts.body(RAPIER.RigidBodyDesc.fixed().setTranslation(at[0], at[1] + h, at[2]).setRotation(rot));
  const plank = parts.body(RAPIER.RigidBodyDesc.dynamic().setTranslation(at[0], at[1] + h + 0.12, at[2]).setRotation(rot).setAngularDamping(0.8));
  world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2, 0.1, w / 2).setDensity(1).setFriction(1), plank);
  const hinge = world.createImpulseJoint(RAPIER.JointData.revolute(v(0, 0, 0), v(0, -0.12, 0), v(0, 0, 1)), pivot, plank, true) as RAPIER.RevoluteImpulseJoint;
  const lim = ((o.tilt ?? 16) * Math.PI) / 180;
  hinge.setLimits(-lim, lim);
  parts.show(plank, new Mesh(new BoxGeometry(len, 0.2, w), toonMaterial(PALETTE[o.color ?? 'orange'])), false);
  // the wedge it sits on (drawn and solid)
  const wedge = new Mesh(new BoxGeometry(h * 0.9, h * 0.9, w * 0.8), toonMaterial(PALETTE.night));
  wedge.position.set(at[0], at[1] + h * 0.36, at[2]);
  wedge.rotation.set(0, yaw, Math.PI / 4, 'YXZ');
  parts.show(null, wedge, false);
  const base = parts.body(RAPIER.RigidBodyDesc.fixed().setTranslation(at[0], at[1] + h * 0.3, at[2]).setRotation(rot));
  world.createCollider(RAPIER.ColliderDesc.cuboid(h * 0.3, h * 0.3, w * 0.4), base);
  return { bodies: parts.bodies, plank, hinge, remove: () => parts.remove() };
}

/**
 * Drive a joint like a spring toward `target` (an angle or a position): `stiffness` and
 * `damping` per unit of `mass` (or moment of inertia), so the same numbers feel the same on a
 * light and a heavy body. Force-based on purpose: Rapier's acceleration-based motors hold
 * against outside pushes (a pad would not sink under anyone standing on it).
 */
function spring(j: RAPIER.RevoluteImpulseJoint | RAPIER.PrismaticImpulseJoint, target: number, stiffness: number, damping: number, mass: number): void {
  j.configureMotorModel(RAPIER.MotorModel.ForceBased);
  j.configureMotorPosition(target, stiffness * mass, damping * mass);
}

/** Rotation (quaternion) that turns +Y to the unit direction `d`. */
function rotationFromY(d: Vec3): { x: number; y: number; z: number; w: number } {
  // half-way vector between +Y and -d... the links hang from the anchor: local +Y points back up
  const tx = -d[0];
  const ty = -d[1];
  const tz = -d[2];
  const dot = ty; // (0,1,0) · t
  if (dot > 0.9999) return { x: 0, y: 0, z: 0, w: 1 };
  if (dot < -0.9999) return { x: 1, y: 0, z: 0, w: 0 };
  // axis = (0,1,0) × t = (tz, 0, -tx)
  const ax = tz;
  const az = -tx;
  const w = 1 + dot;
  const l = Math.hypot(ax, 0, az, w);
  return { x: ax / l, y: 0, z: az / l, w: w / l };
}
