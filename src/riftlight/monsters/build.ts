import { type AnimationClip, type BufferGeometry, Euler, Group, Matrix4, Mesh, Object3D, Quaternion, RingGeometry, Vector3 } from 'three/webgpu';
import { compileClip, sampleClip, type ClipDef, type JointLimit, type LegRig, type RigSpec, type Vec3 } from '../../engine/animation';
import type { RestPose } from '../../engine/animation';
import { more, type Mod } from '../core/mods';
import { Rng } from '../core/rng';
import { RANK } from '../core/scaling';
import type { Genome } from '../core/types';
import { clipBuilders, plantedFeet } from './anim';
import { poseAt, type BakeContext } from './anim/bake';
import { hullPoints, Kinematics, type PoseMap } from './anim/ik';
import { ARCHETYPES } from './brains/archetypes';
import { ELITE_MODS } from './brains/elite';
import { boltFor, MONSTER_SKILLS } from './brains/skills';
import { genomeCost, genomeTags, headAnchors, shapeKey } from './genome';
import { auraMaterial, cachedGeometry, limbGeometry, SMALL_SPHERE, taperCyl, unitBlob, unitBox, unitCone, unitCyl, unitDisc, unitSphere, unitSphereLo } from './geometry';
import { BOSS_DRESS, lookOf } from './looks';
import { paletteColour } from './palette';
import { mergePieces, skinGlowMaterial, skinMaterial, skinOf, type Merged, type Piece } from './skin';
import { PARTS } from './parts';
import { PLANS } from './plans';
import type { BuiltMonster, ClipMeta, MeshOpts, MonsterClipDef, MonsterPartContext, MonsterPartDef, PaletteSlot, ShapeDef, Skeleton, Slot, SocketDef } from './types';

/**
 * Genome → monster: the plan's grammar builds the skeleton (named joint Object3Ds), body
 * shapes and parts hang toon meshes on it (shared geometry, cached materials), a RigSpec
 * describes it for the animation tools, and the clips are generated and compiled. Clip
 * sets are cached by shape (plan + genes + parts + anims), so a pack of the same genome
 * builds its clips once. Deterministic: the same genome always gives the same monster.
 */
export interface BuildOptions {
  /** Generate and compile every clip now instead of on first use (default false). */
  eager?: boolean;
  /** Extra MONSTER_SKILLS ids whose clips it needs (boss scripts). */
  extraSkills?: readonly string[];
}

/**
 * The clips of one body shape, generated and compiled lazily and shared by every monster
 * of that shape (AnimationClips bind by joint name, so any copy can play them).
 */
class ClipSet {
  readonly names: string[];
  private readonly makers: Map<string, () => MonsterClipDef>;
  private readonly defs = new Map<string, MonsterClipDef>();
  private readonly clips = new Map<string, AnimationClip>();
  private readonly metas = new Map<string, ClipMeta>();

  constructor(
    readonly ctx: BakeContext,
    anims: readonly string[],
    weapon: boolean,
    readonly rig: RigSpec,
    readonly rest: RestPose,
  ) {
    this.makers = clipBuilders(ctx, anims, { weapon });
    this.names = [...this.makers.keys()];
  }

  def(name: string): MonsterClipDef | null {
    let d = this.defs.get(name);
    if (!d) {
      const make = this.makers.get(name);
      if (!make) return null;
      this.defs.set(name, (d = make()));
    }
    return d;
  }

  clip(name: string): AnimationClip | null {
    let c = this.clips.get(name);
    if (!c) {
      const d = this.def(name);
      if (!d) return null;
      this.clips.set(name, (c = tagClip(compileClip(d, this.rig, this.rest), d)));
    }
    return c;
  }

  meta(name: string): ClipMeta | null {
    let m = this.metas.get(name);
    if (!m) {
      const d = this.def(name);
      if (!d) return null;
      this.metas.set(name, (m = metaOf(d)));
    }
    return m;
  }
}

const clipCache = new Map<string, ClipSet>();
const CACHE_MAX = 128;

/** Forget every cached clip set (tests, benchmarks). */
export function clearMonsterCache(): void {
  clipCache.clear();
}

/** A one-frame "stand" template: the stance with feet planted. */
const STAND: ClipDef = { name: 'Stand', frames: 1, keys: [[0, {}]] };

export function buildMonster(genome: Genome, options: BuildOptions = {}): BuiltMonster {
  const t0 = performance.now(); // real time: build timing
  const plan = PLANS.get(genome.plan);
  const bySlot = new Map<Slot, MonsterPartDef>();
  for (const p of genome.parts) if (PARTS.has(p.part) && !bySlot.has(p.socket as Slot)) bySlot.set(p.socket as Slot, PARTS.get(p.part));
  const sk = plan.build({ genes: genome.genes, has: (s) => bySlot.has(s), head: headAnchors(genome) });

  // ---- joints
  const object = new Group();
  object.name = `Monster:${genome.plan}`;
  const joints = new Map<string, Object3D>();
  for (const j of sk.joints) {
    const o = new Object3D();
    o.name = j.name;
    o.position.set(...j.pos);
    if (j.yaw) o.quaternion.setFromAxisAngle(Y, j.yaw * RAD);
    (j.parent ? joints.get(j.parent)! : object).add(o);
    joints.set(j.name, o);
  }

  // ---- body shapes and parts → pieces per joint → one skin mesh (+ one glow mesh) per joint
  const soleNames = new Set([...sk.legs.map((l) => l.sole), 'SoleBlob']);
  const meshKey = `${shapeKey(genome, [])}|${JSON.stringify(genome.palette)}|${genome.rank}`;
  const colour = (slot: PaletteSlot) => paletteColour(genome.palette, slot);
  let merged = mergedCache.get(meshKey);
  if (!merged) {
    const pieces = new Map<string, Piece[]>();
    const soleOf = new Map<string, string>();
    const push = (joint: string, piece: Piece) => {
      let list = pieces.get(joint);
      if (!list) pieces.set(joint, (list = []));
      list.push(piece);
    };
    for (const s of sk.shapes) {
      push(s.joint, shapePiece(s, colour(s.color)));
      if (soleNames.has(s.name)) soleOf.set(s.joint, s.name);
    }
    const rng = new Rng(genome.seed);
    for (const socket of sk.sockets) {
      // the genome's part, or the plan's cosmetic default for an empty slot (bare hands, toes)
      const fallback = plan.defaults?.[socket.slot];
      const part = bySlot.get(socket.slot) ?? (fallback && PARTS.has(fallback) ? PARTS.get(fallback) : undefined);
      if (!part) continue;
      part.build(partContext(socket, part, joints, genome, rng.fork(socket.id), push));
    }
    // a boss's mantle, by its leading theme (looks.ts BOSS_DRESS)
    // (elements first: a crystal spider wears glass, not the insect trophies)
    const tags = genomeTags(genome).sort((a, b) => Number(GENERIC_THEMES.has(a)) - Number(GENERIC_THEMES.has(b)));
    const dress = genome.rank === 'boss' ? tags.map((t) => BOSS_DRESS[t]).find((id) => id && PARTS.has(id)) : undefined;
    if (dress) for (const socket of sk.sockets) if (socket.slot === 'mantle') PARTS.get(dress).build(partContext(socket, PARTS.get(dress), joints, genome, rng.fork('mantle'), push));
    // the archetype's marks (looks.ts) on slots the genome left empty
    for (const mark of lookOf(genome.archetype).marks ?? []) {
      if (bySlot.has(mark.slot) || !PARTS.has(mark.part)) continue;
      const part = PARTS.get(mark.part);
      for (const socket of sk.sockets) if (socket.slot === mark.slot) part.build(partContext(socket, part, joints, genome, rng.fork(`mark:${socket.id}`), push));
    }
    const skin = skinOf(genome, genomeTags(genome));
    merged = new Map();
    for (const [joint, list] of pieces) merged.set(joint, { ...mergePieces(list, skin), sole: soleOf.get(joint) ?? null });
    if (mergedCache.size >= MESH_CACHE_MAX) mergedCache.delete(mergedCache.keys().next().value!);
    mergedCache.set(meshKey, merged);
    for (const m of merged.values())
      for (const g of [m.skin, m.glow])
        g?.addEventListener('dispose', () => {
          if (mergedCache.get(meshKey) === merged) mergedCache.delete(meshKey);
        });
  }
  for (const [joint, m] of merged) {
    const o = joints.get(joint)!;
    if (m.skin) {
      const mesh = new Mesh(m.skin, skinMaterial());
      mesh.name = m.sole ?? `${joint}:skin`;
      o.add(mesh);
    }
    if (m.glow) {
      const mesh = new Mesh(m.glow, skinGlowMaterial());
      mesh.name = `${joint}:glow`;
      o.add(mesh);
    }
  }

  // ---- rig and clips (lazy, shared per shape)
  const rig = rigOf(sk);
  const rest = restOf(sk);
  const skills = [...new Set([...resolveSkills(genome, sk, bySlot), ...(options.extraSkills ?? []).filter((s) => MONSTER_SKILLS.has(s))])];
  const anims = [...new Set(skills.flatMap((id) => (MONSTER_SKILLS.has(id) ? [MONSTER_SKILLS.get(id).anim, MONSTER_SKILLS.get(id).loopAnim ?? ''] : [])).filter(Boolean))];
  const weapon = bySlot.get('weapon');
  const key = shapeKey(genome, anims);
  let set = clipCache.get(key);
  if (!set) {
    set = new ClipSet(bakeContext(sk, joints), anims, !!weapon && weapon.id !== 'weapon.staff' && weapon.id !== 'weapon.orb', rig, rest);
    if (clipCache.size >= CACHE_MAX) clipCache.delete(clipCache.keys().next().value!);
    clipCache.set(key, set);
  }
  const clips = set;
  if (options.eager) for (const n of clips.names) clips.clip(n);

  // ---- elite / boss dressing
  if (genome.rank !== 'normal' || genome.elite.length) addAura(object, sk, genome);

  // Static pose: standing with planted feet, so an un-animated model already looks right.
  applyResolved(object, rig, rest, poseAt(clips.ctx, STAND, 0, plantedFeet(sk)));
  object.scale.setScalar(genome.scale);

  const stats = statsOf(genome, bySlot);
  const ms = performance.now() - t0; // real time: build timing
  return {
    genome,
    object,
    rig,
    rest,
    skeleton: sk,
    clipNames: clips.names,
    clip: (name) => clips.clip(name),
    clipDef: (name) => clips.def(name),
    clipInfo: (name) => clips.meta(name),
    get defs() {
      return clips.names.map((n) => clips.def(n)!);
    },
    get clips() {
      return clips.names.map((n) => clips.clip(n)!);
    },
    get meta() {
      return Object.fromEntries(clips.names.map((n) => [n, clips.meta(n)!]));
    },
    stats,
    skills,
    radius: sk.radius * genome.scale,
    height: sk.height * genome.scale,
    cost: genomeCost(genome),
    ms,
  };
}

/** World move speeds (m/s) of the walk and run clips at this monster's scale. */
export function moveSpeeds(m: BuiltMonster): { walk: number; run: number } {
  return { walk: (m.clipInfo('Walk')?.speed ?? 1) * m.genome.scale, run: (m.clipInfo('Run')?.speed ?? 2) * m.genome.scale };
}

// ---------------------------------------------------------------- meshes

const Y = new Vector3(0, 1, 0);
const RAD = Math.PI / 180;
const _e = new Euler();
const _q = new Quaternion();

const SHAPE_GEOMETRY: Record<ShapeDef['kind'], [string, () => BufferGeometry]> = {
  box: ['u:box', unitBox],
  sphere: ['u:sphere', unitSphere],
  cyl: ['u:cyl', unitCyl],
  cone: ['u:cone', unitCone],
  blob: ['u:blob', unitBlob],
  disc: ['u:disc', unitDisc],
  taper: ['u:taper', unitCyl],
  limb: ['u:limb', unitCyl],
};

/** Merged meshes per body shape and palette: pack mates share them (disposed with their level). */
type MergedJoint = Merged & { sole: string | null };
const mergedCache = new Map<string, Map<string, MergedJoint>>();
const MESH_CACHE_MAX = 64;

/** Themes that say what a body is rather than its element (bosses dress by element first). */
const GENERIC_THEMES: ReadonlySet<string> = new Set(['beast', 'insect', 'construct', 'undead']);

/** Body shapes that take the body pattern (the main colours, not soles or dark trims). */
const PATTERNED: ReadonlySet<PaletteSlot> = new Set<PaletteSlot>(['primary', 'secondary']);

function limbKey(ratio: number, bulge: number): [string, () => BufferGeometry] {
  const r = Math.round(ratio * 20) / 20;
  const b = Math.round(bulge * 20) / 20;
  return [`u:limb:${r}:${b}`, limbGeometry(r, b)];
}

function shapePiece(s: ShapeDef, hex: number): Piece {
  const small = s.kind === 'sphere' && Math.max(...s.size) < SMALL_SPHERE;
  const [key, make] = s.kind === 'taper' ? [`u:taper:${(s.taper ?? 1).toFixed(2)}`, taperCyl(Math.round((s.taper ?? 1) * 100) / 100)] : s.kind === 'limb' ? limbKey(s.taper ?? 1, s.bulge ?? 0) : small ? (['u:sphere.lo', unitSphereLo] as const) : SHAPE_GEOMETRY[s.kind];
  const q = s.rot ? new Quaternion().setFromEuler(_e.set(s.rot[0] * RAD, s.rot[1] * RAD, s.rot[2] * RAD, 'XYZ')) : new Quaternion();
  const matrix = new Matrix4().compose(new Vector3(...s.at), q, new Vector3(...s.size));
  return { geometry: cachedGeometry(key, make), matrix, hex, slot: s.color, glow: false, patterned: PATTERNED.has(s.color) && s.color === 'primary' && !s.plain };
}

function partContext(socket: SocketDef, part: MonsterPartDef, joints: Map<string, Object3D>, genome: Genome, rng: Rng, push: (joint: string, piece: Piece) => void): MonsterPartContext {
  const mirror = !!socket.mirror;
  const sq = new Quaternion().setFromEuler(new Euler(...((socket.rot ?? [0, 0, 0]).map((v) => v * RAD) as Vec3), 'XYZ'));
  const chain = (socket.data?.chain as readonly string[] | undefined) ?? [];
  let n = 0;
  return {
    parent: joints.get(socket.joint)!,
    palette: genome.palette,
    scale: socket.size,
    size: socket.size,
    rng,
    mirror,
    socket,
    chain,
    joint: (name) => joints.get(name) ?? joints.get(socket.joint)!,
    add(key: string, make, color: PaletteSlot, o: MeshOpts = {}): Mesh {
      const geo = cachedGeometry(`${key}`, make, mirror);
      const hex = paletteColour(genome.palette, color);
      const mesh = new Mesh(geo);
      mesh.name = o.name ?? `${part.id}:${socket.id}:${n++}`;
      const at = o.at ?? [0, 0, 0];
      const rot = o.rot ?? [0, 0, 0];
      const lp = new Vector3(mirror ? -at[0] : at[0], at[1], at[2]);
      const lq = _q.setFromEuler(_e.set(rot[0] * RAD, (mirror ? -rot[1] : rot[1]) * RAD, (mirror ? -rot[2] : rot[2]) * RAD, 'XYZ'));
      if (o.joint) {
        mesh.position.copy(lp);
        mesh.quaternion.copy(lq);
      } else {
        mesh.position.copy(lp.applyQuaternion(sq)).add(new Vector3(...socket.at));
        mesh.quaternion.copy(sq).multiply(lq);
      }
      const s = o.scale ?? 1;
      if (typeof s === 'number') mesh.scale.setScalar(s);
      else mesh.scale.set(...s);
      mesh.updateMatrix();
      const joint = o.joint && joints.has(o.joint) ? o.joint : socket.joint;
      push(joint, { geometry: geo, matrix: mesh.matrix.clone(), hex, slot: color, glow: !!o.glow, patterned: !!o.pattern && !o.glow });
      return mesh;
    },
  };
}

function addAura(object: Group, sk: Skeleton, genome: Genome): void {
  const elite = genome.elite.find((e) => ELITE_MODS.has(e));
  const hex = elite ? (ELITE_MODS.get(elite).glow ?? genome.palette.glow) : genome.palette.glow;
  const r = Math.max(0.35, sk.radius * (genome.rank === 'boss' ? 1.15 : 1));
  const ring = new Mesh(
    cachedGeometry('u:aura', () => new RingGeometry(0.7, 1, 40, 1).rotateX(-Math.PI / 2)),
    auraMaterial(hex),
  );
  ring.name = 'EliteAura';
  ring.renderOrder = -1;
  ring.userData.noFlash = true;
  ring.position.y = 0.012;
  ring.scale.setScalar(r);
  object.add(ring);
}

// ---------------------------------------------------------------- rig, clips, stats

function rigOf(sk: Skeleton): RigSpec {
  const names = sk.joints.map((j) => j.name);
  const set = new Set(names);
  const mirror: Record<string, string> = {};
  for (const n of names) {
    const m = /^(.*)([RL])$/.exec(n);
    if (!m) continue;
    const other = `${m[1]}${m[2] === 'R' ? 'L' : 'R'}`;
    if (set.has(other)) mirror[n] = other;
  }
  const soles = [...sk.legs.map((l) => l.sole), ...sk.shapes.filter((s) => s.name === 'SoleBlob').map((s) => s.name)];
  const trace = [...soles.slice(0, 4), ...(sk.roles.head ? [sk.roles.head] : [sk.roles.root]), ...sk.arms.map((a) => a.hand), ...(sk.roles.tail.length ? [sk.roles.tail[sk.roles.tail.length - 1]!] : [])];
  // Plausible ranges (degrees) the metrics warn about: knees bend one way, jaws open, heads turn.
  const limits: Record<string, JointLimit> = {};
  for (const l of sk.legs) limits[l.lower] = { x: l.bend > 0 ? [-5, 165] : [-165, 5] };
  for (const a of sk.arms) limits[a.forearm] = { x: [-165, 10] };
  if (sk.roles.head) limits[sk.roles.head] = { x: [-80, 80], y: [-100, 100], z: [-50, 50] };
  if (sk.roles.jaw) limits[sk.roles.jaw] = { x: [-5, 45] };
  const rig: RigSpec = { fps: 30, root: sk.roles.root, joints: names, mirror, soles, trace, limits };
  // Two upright legs on the root: also describe them for the engine's own IK tools.
  const two = sk.legs.length === 2 && sk.legs.every((l) => l.parent === sk.roles.root && !l.splay);
  if (two) {
    const leg = (side: 'R' | 'L') => sk.legs.find((l) => l.side === side)!;
    const R = leg('R');
    const L = leg('L');
    const sole = sk.shapes.find((s) => s.name === R.sole)!;
    const legs: LegRig = {
      R: { upper: R.upper, lower: R.lower, foot: R.foot, hip: R.hipPos },
      L: { upper: L.upper, lower: L.lower, foot: L.foot, hip: L.hipPos },
      rootHeight: sk.joints[0]!.pos[1],
      upper: R.upperLen,
      lower: R.lowerLen,
      ankle: R.ankle,
      heel: sole.size[2] * 0.25,
      ball: sole.size[2] * 0.75,
    };
    return { ...rig, legs };
  }
  return rig;
}

/** Floor-clamp shapes: a hull of every joint's meshes (joint space), soles apart. */
function bakeContext(sk: Skeleton, joints: Map<string, Object3D>): BakeContext {
  const bounds = new Map<string, Float32Array>();
  const soles = new Map<string, Float32Array>();
  const soleNames = new Set([...sk.legs.map((l) => l.sole), 'SoleBlob']);
  const v = new Vector3();
  for (const [name, joint] of joints) {
    const body: number[] = [];
    const sole: number[] = [];
    for (const child of joint.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh) continue;
      mesh.updateMatrix();
      const hull = mesh.geometry.userData.hull as Float32Array | undefined;
      const pos = hull ? null : mesh.geometry.getAttribute('position');
      const out = soleNames.has(mesh.name) ? sole : body;
      const n = hull ? hull.length / 3 : pos!.count;
      for (let i = 0; i < n; i++) {
        if (hull) v.set(hull[i * 3]!, hull[i * 3 + 1]!, hull[i * 3 + 2]!);
        else v.fromBufferAttribute(pos!, i);
        v.applyMatrix4(mesh.matrix);
        out.push(v.x, v.y, v.z);
      }
    }
    if (body.length) bounds.set(name, body.length > 600 ? hullPoints(body) : new Float32Array(body));
    if (sole.length) soles.set(name, sole.length > 600 ? hullPoints(sole) : new Float32Array(sole));
  }
  return { skeleton: sk, kin: new Kinematics(sk), bounds, soles };
}

function tagClip(clip: AnimationClip, d: MonsterClipDef): AnimationClip {
  clip.userData.kind = d.kind;
  if (d.hit !== undefined) {
    clip.userData.hitFrame = d.hit;
    clip.userData.hit = d.hit / 30;
  }
  if (d.windup) clip.userData.windup = [d.windup[0] / 30, d.windup[1] / 30];
  return clip;
}

function metaOf(d: MonsterClipDef): ClipMeta {
  return {
    name: d.name,
    kind: d.kind,
    frames: d.frames,
    loop: !!d.loop,
    speed: d.speed ?? null,
    hitFrame: d.hit ?? null,
    hitTime: d.hit !== undefined ? d.hit / 30 : null,
    windup: d.windup ?? null,
  };
}

/** Rest transforms straight from the skeleton (what restPoseOf would read off the fresh model). */
function restOf(sk: Skeleton): RestPose {
  const rest: RestPose = { position: {}, quaternion: {}, scale: {} };
  for (const j of sk.joints) {
    rest.position[j.name] = [...j.pos];
    rest.quaternion[j.name] = j.yaw ? new Quaternion().setFromAxisAngle(Y, j.yaw * RAD) : new Quaternion();
    rest.scale[j.name] = [1, 1, 1];
  }
  return rest;
}

/** Pose joints directly (no mixer) to a clip frame. */
export function applyPose(object: Object3D, rig: RigSpec, rest: RestPose, def: ClipDef, frame = 0): void {
  applyResolved(object, rig, rest, sampleClip(def, frame, rig));
}

function applyResolved(object: Object3D, rig: RigSpec, rest: RestPose, pose: PoseMap): void {
  const byName = new Map<string, Object3D>();
  object.traverse((o) => byName.set(o.name, o));
  for (const j of rig.joints) {
    const o = byName.get(j);
    const p = pose[j];
    if (!o || !p) continue;
    const rp = rest.position[j]!;
    o.position.set(rp[0] + p.p[0], rp[1] + p.p[1], rp[2] + p.p[2]);
    o.quaternion.setFromEuler(_e.set(p.r[0] * RAD, p.r[1] * RAD, p.r[2] * RAD, 'XYZ')).premultiply(rest.quaternion[j]!);
    const rs = rest.scale[j]!;
    o.scale.set(rs[0] * p.s[0], rs[1] * p.s[1], rs[2] * p.s[2]);
  }
}

/** Skill ids for a genome: archetype roles resolved for this body and theme. */
export function resolveSkills(genome: Genome, sk: Skeleton, bySlot: Map<Slot, MonsterPartDef>): string[] {
  const arch = ARCHETYPES.has(genome.archetype) ? ARCHETYPES.get(genome.archetype) : ARCHETYPES.get('skirmisher');
  const weapon = bySlot.get('weapon');
  const melee = weapon && weapon.id !== 'weapon.staff' && weapon.id !== 'weapon.orb' ? 'swing' : sk.arms.length ? 'claw' : 'bite';
  const out: string[] = [];
  for (const role of arch.skills) {
    if (role === 'melee') out.push(melee);
    else if (role === 'bolt') out.push(boltFor([...genomeTags(genome), ...(weapon ? weapon.tags : [])]));
    else out.push(role);
  }
  const tail = bySlot.get('tail');
  if (tail?.anims?.includes('TailWhip') && arch.skills.includes('melee')) out.push('tailwhip');
  return [...new Set(out)].filter((id) => MONSTER_SKILLS.has(id));
}

function statsOf(genome: Genome, bySlot: Map<Slot, MonsterPartDef>): Mod[] {
  const out: Mod[] = [...PLANS.get(genome.plan).mods];
  for (const p of bySlot.values()) out.push(...(p.mods ?? []));
  if (ARCHETYPES.has(genome.archetype)) out.push(...ARCHETYPES.get(genome.archetype).mods);
  for (const e of genome.elite) if (ELITE_MODS.has(e)) out.push(...ELITE_MODS.get(e).mods);
  const rank = RANK[genome.rank];
  if (rank.life !== 1) out.push(more('life', rank.life - 1, undefined));
  if (rank.damage !== 1) out.push(more('damage', rank.damage - 1, undefined));
  return out;
}
