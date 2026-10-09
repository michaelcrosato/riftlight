/**
 * Ragdolls: a jointed model (a hierarchy of Object3D joints, like the hero's) handed to
 * physics. Each part is a capsule on one joint; parts hang from their parent by a hinge about
 * the joint's own X axis with limits (knees, elbows) or by a ball joint whose swing is held
 * inside a cone (shoulders, hips, the spine, the neck). Parts never collide with ragdoll parts
 * (their own or another ragdoll's), only with the world. `sync()` writes the bodies back into
 * the joints every frame, and `release()` hands the pose back to animation with a blend (into a
 * get-up clip, say).
 *
 *   const doll = new Ragdoll(physics, model, HERO_RAGDOLL);
 *   doll.enable({ velocity: [0, 2, -4] });      // from the pose the model has now
 *   doll.push([x, y, z], [0, 0, -6]);           // knock the nearest part (a velocity change, m/s)
 *   // per frame, after the physics step: doll.sync()
 *   const blend = doll.release();               // bodies gone, the root moved under the pelvis
 *   // per frame while blending: mixer.update(dt); blend.apply(weight 0 → 1)
 *
 * Joint rest rotations are taken as identity (the engine's generated rigs are built that way):
 * a cone's centre is the part's own direction, a hinge's angle is the joint's local X angle.
 */
import { type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { type Physics, RAPIER } from './Physics';

type Vec3 = readonly [number, number, number];

export interface RagdollPart {
  /** The joint (Object3D name) this part moves. */
  bone: string;
  /** The part it hangs from (that part's bone); none for the root (the pelvis). */
  parent?: string;
  /** The capsule, in the joint's own space: from `from` (default the joint) to `to`. */
  from?: Vec3;
  to: Vec3;
  radius: number;
  /** How it hangs: a hinge about local X (degrees, min and max) or a ball joint with a swing cone (degrees). Default a 60° cone. */
  hinge?: readonly [number, number];
  cone?: number;
  /** Relative density (default 1). */
  density?: number;
}

export interface RagdollOptions {
  /** World density of the parts (the world's mass units per m³). Default 3. */
  density?: number;
  /** Linear and angular damping (air drag, joint friction). Defaults 0.1 and 1.5. */
  damping?: number;
  angularDamping?: number;
  /** Friction of the parts on the ground. Default 0.5. */
  friction?: number;
}

interface Built {
  part: RagdollPart;
  bone: Object3D;
  body: RAPIER.RigidBody;
  parent: Built | null;
  /** This part and every part hanging below it (a cone correction turns them all together). */
  subtree: Built[];
  /** Unit direction of the capsule in the part's space (the cone axis at rest). */
  axis: Vector3;
  cone: number;
  /** The last two physics poses, for drawing between steps. */
  prevPos: Vector3;
  prevRot: Quaternion;
  currPos: Vector3;
  currRot: Quaternion;
}

/**
 * Ragdoll parts are in their own collision group (bit 4: chains use 2, debris 3): they hit the
 * world and everything else, but no ragdoll's parts, their own or another's.
 */
const GROUPS = ((0x0008 << 16) | (0xffff & ~0x0008)) >>> 0;

export class Ragdoll {
  readonly parts: readonly RagdollPart[];
  readonly o: Required<RagdollOptions>;
  private built: Built[] = [];
  private unsubscribe: (() => void) | null = null;
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly t = new Vector3();

  constructor(
    private readonly physics: Physics,
    readonly root: Object3D,
    parts: readonly RagdollPart[],
    o: RagdollOptions = {},
  ) {
    this.parts = parts;
    this.o = { density: 3, damping: 0.1, angularDamping: 1.5, friction: 0.5, ...o };
    parts.forEach((p, i) => {
      if (!root.getObjectByName(p.bone)) throw new Error(`Ragdoll: no joint '${p.bone}'`);
      if (p.parent && !parts.slice(0, i).some((q) => q.bone === p.parent)) throw new Error(`Ragdoll: '${p.bone}' hangs from '${p.parent}', which is not listed before it`);
    });
  }

  /** Whether the bodies exist (a `physics.clear()`, a level unload, removes them: then it is off). */
  get active(): boolean {
    if (this.built.length && !this.physics.world.bodies.contains(this.built[0]!.body.handle)) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.built = [];
    }
    return this.built.length > 0;
  }

  /** The bodies (root part first), while active. */
  get bodies(): RAPIER.RigidBody[] {
    return this.built.map((b) => b.body);
  }

  /** Make the bodies from the model's current pose, moving at `velocity` (and spinning at `spin`, rad/s). */
  enable(o: { velocity?: Vec3; spin?: Vec3 } = {}): void {
    if (this.active) return;
    const world = this.physics.world;
    this.root.updateWorldMatrix(true, true);
    const byBone = new Map<string, Built>();
    for (const part of this.parts) {
      const bone = this.root.getObjectByName(part.bone)!;
      const pos = bone.getWorldPosition(new Vector3());
      const rot = bone.getWorldQuaternion(new Quaternion());
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setLinearDamping(this.o.damping)
          .setAngularDamping(this.o.angularDamping)
          .setCcdEnabled(true),
      );
      if (o.velocity) body.setLinvel({ x: o.velocity[0], y: o.velocity[1], z: o.velocity[2] }, true);
      if (o.spin) body.setAngvel({ x: o.spin[0], y: o.spin[1], z: o.spin[2] }, true);
      // the capsule from `from` to `to` (Rapier's capsules run along Y)
      const a = new Vector3(...(part.from ?? [0, 0, 0]));
      const b = new Vector3(...part.to);
      const d = b.clone().sub(a);
      const len = d.length();
      const axis = len > 1e-6 ? d.clone().divideScalar(len) : new Vector3(0, 1, 0);
      const up = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
      const mid = a.add(b).multiplyScalar(0.5);
      const half = Math.max(0.01, len / 2 - part.radius * 0.5);
      world.createCollider(
        RAPIER.ColliderDesc.capsule(half, part.radius)
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation({ x: up.x, y: up.y, z: up.z, w: up.w })
          .setDensity(this.o.density * (part.density ?? 1))
          .setFriction(this.o.friction)
          .setCollisionGroups(GROUPS),
        body,
      );
      const parent = part.parent ? byBone.get(part.parent)! : null;
      if (parent) {
        // the joint sits at this part's joint: where that is in the parent body's frame (no scale)
        const anchor = pos.clone().sub(parent.currPos).applyQuaternion(parent.currRot.clone().invert());
        const data = part.hinge ? RAPIER.JointData.revolute(anchor, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) : RAPIER.JointData.spherical(anchor, { x: 0, y: 0, z: 0 });
        const joint = world.createImpulseJoint(data, parent.body, body, true);
        joint.setContactsEnabled(false);
        if (part.hinge) (joint as RAPIER.RevoluteImpulseJoint).setLimits((part.hinge[0] * Math.PI) / 180, (part.hinge[1] * Math.PI) / 180);
      }
      const built: Built = {
        part,
        bone,
        body,
        parent,
        subtree: [],
        axis,
        cone: ((part.cone ?? 60) * Math.PI) / 180,
        prevPos: pos.clone(),
        prevRot: rot.clone(),
        currPos: pos.clone(),
        currRot: rot.clone(),
      };
      this.built.push(built);
      byBone.set(part.bone, built);
      for (let a: Built | null = built; a; a = a.parent) a.subtree.push(built);
    }
    this.unsubscribe = this.physics.onStep(() => this.afterStep());
  }

  /**
   * Knock the part nearest `at`: it gains `velocity` (m/s, applied there as an impulse of its
   * own mass, so the same push works whatever the ragdoll's density), and its joints pass
   * some of it on.
   */
  push(at: Vec3 | Vector3, velocity: Vec3): void {
    const p = Array.isArray(at) ? this.v.set(at[0]!, at[1]!, at[2]!) : this.v.copy(at as Vector3);
    let best: Built | null = null;
    let bestD = Infinity;
    for (const b of this.built) {
      const t = b.body.translation();
      const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (!best) return;
    const m = best.body.mass();
    best.body.applyImpulseAtPoint({ x: velocity[0] * m, y: velocity[1] * m, z: velocity[2] * m }, { x: p.x, y: p.y, z: p.z }, true);
  }

  /** Total mass of the parts (world units), while active. */
  mass(): number {
    let m = 0;
    for (const b of this.built) m += b.body.mass();
    return m;
  }

  /** Fastest part (m/s): settled when this stays low. */
  speed(): number {
    let s = 0;
    for (const b of this.built) {
      const v = b.body.linvel();
      s = Math.max(s, Math.hypot(v.x, v.y, v.z));
    }
    return s;
  }

  /**
   * Where the root part (the pelvis) is and how it lies: face up (on its back: its forward,
   * +Z, points up) or down, and the heading (yaw) a character lying like that has: on its back
   * its head is behind it (−Z), on its front ahead (+Z). That is the heading to get up with.
   */
  rootPose(out = new Vector3()): { at: Vector3; faceUp: boolean; heading: number } {
    const b = this.built[0];
    if (!b) return { at: out.set(0, 0, 0), faceUp: true, heading: 0 };
    const t = b.body.translation();
    const r = b.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    const faceUp = this.v2.set(0, 0, 1).applyQuaternion(this.q).y > 0;
    const head = this.v2.set(0, 1, 0).applyQuaternion(this.q);
    const heading = faceUp ? Math.atan2(-head.x, -head.z) : Math.atan2(head.x, head.z);
    return { at: out.set(t.x, t.y, t.z), faceUp, heading };
  }

  /** Write the bodies into the joints (between the last two physics steps). Call every frame after the physics update. */
  sync(): void {
    const alpha = this.physics.alpha;
    for (const b of this.built) {
      const pos = this.v.lerpVectors(b.prevPos, b.currPos, alpha);
      const rot = this.q.slerpQuaternions(b.prevRot, b.currRot, alpha);
      const parent = b.bone.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parent.getWorldQuaternion(this.q2);
        b.bone.quaternion.copy(this.q2.invert().multiply(rot));
        if (!b.parent) b.bone.position.copy(parent.worldToLocal(pos.clone()));
      } else {
        b.bone.quaternion.copy(rot);
        if (!b.parent) b.bone.position.copy(pos);
      }
      b.bone.updateMatrixWorld(true);
    }
  }

  /**
   * Remove the bodies and hand the pose back. The model root moves under the root part (feet
   * at `ground`: a height, or a function of x, z called once the bodies are gone; turned to
   * `heading`, default `rootPose().heading`) without moving the joints in the world; the returned
   * blend eases every part's joint from that pose to whatever animation writes next:
   * call `apply(w)` after the mixer each frame, w going 0 → 1.
   */
  release(o: { ground?: number | ((x: number, z: number) => number); heading?: number; offset?: Vec3 } = {}): { apply(w: number): void } {
    if (!this.active) return { apply: () => {} };
    this.sync();
    const pose = this.rootPose();
    const top = this.built[0]!.bone;
    const worldPos = top.getWorldPosition(new Vector3());
    const worldRot = top.getWorldQuaternion(new Quaternion());
    this.disable();
    // `offset`: where the next animation puts the root part under the model root (its first
    // frame), so the blend doesn't slide the body across the floor
    const heading = o.heading ?? pose.heading;
    const off = new Vector3(...(o.offset ?? [0, 0, 0])).applyAxisAngle(new Vector3(0, 1, 0), heading);
    const x = pose.at.x - off.x;
    const z = pose.at.z - off.z;
    // a ground function runs now the bodies are gone (a ray would otherwise hit the ragdoll itself)
    const y = typeof o.ground === 'function' ? o.ground(x, z) : (o.ground ?? this.root.position.y);
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, heading, 0);
    this.root.updateMatrixWorld(true);
    // the root part keeps its place in the world under the moved root; every joint below it
    // keeps its local rotation. Those are the values to blend from.
    const parent = top.parent!;
    parent.updateWorldMatrix(true, false);
    top.quaternion.copy(parent.getWorldQuaternion(new Quaternion()).invert().multiply(worldRot));
    top.position.copy(parent.worldToLocal(worldPos));
    top.updateMatrixWorld(true);
    const joints: Object3D[] = [];
    top.traverse((j) => joints.push(j));
    const from = joints.map((j) => j.quaternion.clone());
    // what the blend last wrote, and the animation's value it blends toward: a mixer writes a
    // joint only when its value changes, so a joint it leaves alone keeps the old target
    const out = from.map((q) => q.clone());
    const target = from.map((q) => q.clone());
    const fromP = top.position.clone();
    const outP = fromP.clone();
    const targetP = fromP.clone();
    return {
      apply(w: number) {
        const k = Math.min(1, Math.max(0, w));
        joints.forEach((j, i) => {
          if (!j.quaternion.equals(out[i]!)) target[i]!.copy(j.quaternion);
          j.quaternion.copy(out[i]!.slerpQuaternions(from[i]!, target[i]!, k));
        });
        if (!top.position.equals(outP)) targetP.copy(top.position);
        top.position.copy(outP.lerpVectors(fromP, targetP, k));
      },
    };
  }

  /** Remove the bodies (the joints keep the last pose). */
  disable(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const world = this.physics.world;
    for (const b of [...this.built].reverse()) if (world.bodies.contains(b.body.handle)) this.physics.remove(b.body);
    this.built = [];
  }

  /** Hold each ball joint's swing inside its cone, then keep the last two poses. */
  private afterStep(): void {
    for (const b of this.built) if (b.parent && !b.part.hinge) this.holdCone(b);
    for (const b of this.built) {
      b.prevPos.copy(b.currPos);
      b.prevRot.copy(b.currRot);
      const t = b.body.translation();
      const r = b.body.rotation();
      b.currPos.set(t.x, t.y, t.z);
      b.currRot.set(r.x, r.y, r.z, r.w);
    }
  }

  /**
   * A cone limit for a ball joint (Rapier's ball joints have none): when the part's axis has
   * swung more than `cone` from where its parent holds it at rest, turn it back onto the cone's
   * edge about its joint (a projection, as position-based physics does), carrying every part
   * below it along (their joints move with it, so they stay together), and take away the
   * relative spin that would carry it further out.
   */
  private holdCone(b: Built): void {
    const parent = b.parent!;
    const cr = b.body.rotation();
    const pr = parent.body.rotation();
    const w = this.v.copy(b.axis).applyQuaternion(this.q.set(cr.x, cr.y, cr.z, cr.w)); // the part's axis now
    const n = this.v2.copy(b.axis).applyQuaternion(this.q2.set(pr.x, pr.y, pr.z, pr.w)); // where its parent holds it at rest
    const angle = Math.acos(Math.min(1, Math.max(-1, w.dot(n))));
    const excess = angle - b.cone;
    if (excess <= 0) return;
    const k = w.cross(n); // turning w toward n
    const l = k.length();
    if (l < 1e-6) return;
    k.divideScalar(l);
    const turn = this.q2.setFromAxisAngle(k, excess);
    const pivot = b.body.translation(); // the joint: the part's own origin
    const px = pivot.x;
    const py = pivot.y;
    const pz = pivot.z;
    const t = this.t;
    for (const s of b.subtree) {
      const body = s.body;
      const p = body.translation();
      t.set(p.x - px, p.y - py, p.z - pz).applyQuaternion(turn);
      body.setTranslation({ x: px + t.x, y: py + t.y, z: pz + t.z }, true);
      const r = body.rotation();
      this.q.set(r.x, r.y, r.z, r.w).premultiply(turn);
      body.setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }, true);
      const lv = body.linvel();
      t.set(lv.x, lv.y, lv.z).applyQuaternion(turn);
      body.setLinvel({ x: t.x, y: t.y, z: t.z }, true);
      const av = body.angvel();
      t.set(av.x, av.y, av.z).applyQuaternion(turn);
      body.setAngvel({ x: t.x, y: t.y, z: t.z }, true);
    }
    // no relative spin outward
    const cv = b.body.angvel();
    const pv = parent.body.angvel();
    const rel = (cv.x - pv.x) * k.x + (cv.y - pv.y) * k.y + (cv.z - pv.z) * k.z;
    if (rel >= 0) return;
    b.body.setAngvel({ x: cv.x - k.x * rel, y: cv.y - k.y * rel, z: cv.z - k.z * rel }, true);
  }
}
