/**
 * The building kit every room uses: boxes and maps (merged into one draw per material and
 * one collider per box), dynamic crates, pads you step on, floating labels, doors to other
 * rooms, lights. Rooms are built around the origin; the engine frees everything they add
 * when the room unloads (each room is its own `Game`).
 */
import { BoxGeometry, CylinderGeometry, Euler, Group, type Material, Mesh, MeshBasicNodeMaterial, type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { color as tslColor, float, floor, mix, sin, time, uv, vec3 } from 'three/tsl';
import {
  type GameContext,
  type LightHandle,
  type LightRequestOptions,
  mergeStaticMeshes,
  PALETTE,
  type PaletteColor,
  RAPIER,
  setLookLayer,
  toonMaterial,
  type Trigger,
} from '../../engine';
import type { PadDef, RoomRuntime, Vec3 } from '../types';
import { Grid } from './map';

export interface BoxOptions {
  /** Side colour (the top gets `color`). */
  side?: PaletteColor;
  /** Physics tags: climbable, pushable, slippery, noLedge, ... */
  tags?: string[];
  /** Rotation about Y / Z in degrees (Z tilts ramps). */
  rotY?: number;
  rotZ?: number;
  rotX?: number;
  /** No collider (decoration). */
  ghost?: boolean;
  /** Not merged (it moves or changes later); the mesh is returned. */
  own?: boolean;
  castShadow?: boolean;
  friction?: number;
}

export interface LabelOptions {
  color?: PaletteColor;
  /** The 3×5 mini font. */
  small?: boolean;
  /** Shown only while the hero is this close (m). Default 9. */
  range?: number;
  /** Always shown (signs over doors). */
  always?: boolean;
  scale?: number;
}

export interface Label {
  at: Vector3;
  text: string;
  color: PaletteColor;
  range: number;
  always: boolean;
  scale: number;
  visible: boolean;
  /** Drawn in the 3×5 mini font unless it is the nearest pad's (dense pad grids stay readable). */
  small: boolean;
}

export interface Pad {
  readonly def: PadDef;
  readonly at: Vector3;
  readonly size: [number, number];
  readonly mesh: Mesh;
  active: boolean;
  readonly trigger: Trigger;
  readonly label: Label;
}

export interface MapLegendCell {
  /** Height of the floor's top (default 0). null: no floor here. */
  floor?: number | null;
  /** Floor colour (default: the room's checker). */
  floorColor?: PaletteColor;
  /** A block from the floor up by `height`. */
  block?: { height: number; color: PaletteColor; side?: PaletteColor; tags?: string[] };
  /** A pad on this run of cells. */
  pad?: PadDef;
}

export interface MapOptions {
  /** Metres per cell. Default 1. */
  cell?: number;
  /** Two floor colours, in 2 × 2 m tiles. */
  floor?: [PaletteColor, PaletteColor];
  /** Wall height and colours for '#'. */
  wall?: { height?: number; color?: PaletteColor; side?: PaletteColor };
  /** Room-specific characters (override the defaults). */
  legend?: Record<string, MapLegendCell>;
}

export interface BuiltMap {
  readonly grid: Grid;
  /** World x, z (and the floor height) of every cell holding `ch`. */
  find(ch: string): Vec3[];
}

/** What the shell gives the kit (pads light up, toasts, sounds). */
export interface KitHost {
  runtime(): RoomRuntime;
  padStepped(pad: Pad): void;
}

const DEFAULT_LEGEND: Record<string, MapLegendCell> = {
  '.': {},
  ' ': { floor: null },
};

export class RoomKit {
  /** Static meshes merged when the room is built. */
  private readonly statics: Object3D[] = [];
  readonly labels: Label[] = [];
  readonly pads: Pad[] = [];
  /** Named points (map markers, stations). */
  readonly markers = new Map<string, Vec3[]>();
  private finished = false;

  constructor(
    readonly ctx: GameContext,
    private readonly host: KitHost,
  ) {}

  // ------------------------------------------------------------------ geometry

  /** A box: `at` is its centre, `size` its full extent. Static and merged unless `own`. */
  box(at: Vec3, size: Vec3, color: PaletteColor, o: BoxOptions = {}): Mesh {
    const top = toonMaterial(PALETTE[color]);
    const side = toonMaterial(PALETTE[o.side ?? color]);
    const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), [side, side, top, side, side, side]);
    mesh.position.set(...at);
    const deg = Math.PI / 180;
    mesh.rotation.set((o.rotX ?? 0) * deg, (o.rotY ?? 0) * deg, (o.rotZ ?? 0) * deg);
    mesh.castShadow = o.castShadow ?? true;
    mesh.receiveShadow = true;
    if (!o.ghost) this.collider(at, size, mesh.quaternion, o);
    if (o.own) this.ctx.scene.add(mesh);
    else this.statics.push(mesh);
    return mesh;
  }

  /** A collider with nothing drawn (invisible walls, ceilings). */
  solid(at: Vec3, size: Vec3, o: BoxOptions = {}): RAPIER.Collider {
    const d = Math.PI / 180;
    const q = new Quaternion().setFromEuler(new Euler((o.rotX ?? 0) * d, (o.rotY ?? 0) * d, (o.rotZ ?? 0) * d));
    return this.collider(at, size, q, o);
  }

  /** A static cylinder (posts, pillars, plinths). */
  cylinder(at: Vec3, radius: number, height: number, color: PaletteColor, o: { ghost?: boolean; own?: boolean; segments?: number } = {}): Mesh {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, height, o.segments ?? 10), toonMaterial(PALETTE[color]));
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    if (!o.ghost) this.ctx.physics.addStaticCylinder(at, height / 2, radius);
    if (o.own) this.ctx.scene.add(mesh);
    else this.statics.push(mesh);
    return mesh;
  }

  /** Any static object to merge with the room (decoration you built yourself). */
  decorate(...objects: Object3D[]): void {
    this.statics.push(...objects);
  }

  /** A dynamic crate (bound to its body); `tags` e.g. pushable / grabbable. */
  crate(at: Vec3, o: { size?: number; color?: PaletteColor; side?: PaletteColor; tags?: string[]; density?: number; lockRotation?: boolean; damping?: number } = {}): {
    mesh: Mesh;
    body: RAPIER.RigidBody;
  } {
    const s = o.size ?? 1;
    const top = toonMaterial(PALETTE[o.side ?? 'sand']);
    const side = toonMaterial(PALETTE[o.color ?? 'orange']);
    const mesh = new Mesh(new BoxGeometry(s, s, s), [side, side, top, side, side, side]);
    mesh.castShadow = mesh.receiveShadow = true;
    setLookLayer(mesh, 'actors');
    this.ctx.scene.add(mesh);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...at)
      .setLinearDamping(o.damping ?? 0.4)
      .setAngularDamping(0.6);
    if (o.lockRotation) desc.enabledRotations(false, false, false);
    const body = this.ctx.physics.world.createRigidBody(desc);
    const col = this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(s / 2 - 0.01, s / 2 - 0.01, s / 2 - 0.01).setFriction(0.6).setDensity(o.density ?? 2), body);
    if (o.tags?.length) this.ctx.physics.tag(col, ...o.tags);
    this.ctx.physics.bind(body, mesh);
    return { mesh, body };
  }

  /**
   * Build an ASCII map (see map.ts): floors (in 2 m checker tiles), '#' walls, the legend's
   * blocks and pads. Returns the grid and a `find` for markers.
   */
  map(rows: readonly string[], o: MapOptions = {}): BuiltMap {
    const grid = new Grid(rows, o.cell ?? 1);
    const legend: Record<string, MapLegendCell> = {
      ...DEFAULT_LEGEND,
      '#': { block: { height: o.wall?.height ?? 3, color: o.wall?.color ?? 'slate', side: o.wall?.side ?? 'night' } },
      ...o.legend,
    };
    const cellOf = (ch: string): MapLegendCell => legend[ch] ?? {}; // unknown characters are floor (markers)
    const floorY = (ch: string) => {
      const c = cellOf(ch);
      return c.floor === undefined ? 0 : c.floor;
    };
    const [fa, fb] = o.floor ?? ['mist', 'white'];
    const cs = grid.cell;
    // floors: visuals per tile colour, colliders per height (fewer boxes)
    const tile = (col: number, row: number) => ((Math.floor(col * cs / 2) + Math.floor(row * cs / 2)) % 2 === 0 ? fa : fb);
    for (const r of grid.merge((ch, col, row) => {
      const y = floorY(ch);
      if (y === null) return null;
      return `${y}|${cellOf(ch).floorColor ?? tile(col, row)}`;
    })) {
      const [y, color] = r.key.split('|') as [string, PaletteColor];
      const b = grid.rect(r);
      const top = Number(y);
      this.box([b.x, top - 0.25, b.z], [b.w, 0.5, b.d], color, { ghost: true, side: 'night' });
    }
    for (const r of grid.merge((ch) => {
      const y = floorY(ch);
      return y === null ? null : String(y);
    })) {
      const b = grid.rect(r);
      const top = Number(r.key);
      this.collider([b.x, top - 0.25, b.z], [b.w, 0.5, b.d], null, {});
    }
    // blocks
    for (const r of grid.merge((ch) => {
      const c = cellOf(ch);
      if (!c.block) return null;
      return `${ch}`;
    })) {
      const c = cellOf(r.key);
      const blk = c.block!;
      const b = grid.rect(r);
      const y0 = floorY(r.key) ?? 0;
      this.box([b.x, y0 + blk.height / 2, b.z], [b.w, blk.height, b.d], blk.color, { side: blk.side, tags: blk.tags });
    }
    // pads: one per connected run of a pad character
    for (const [ch, c] of Object.entries(legend)) {
      if (!c.pad) continue;
      for (const r of grid.islands(ch)) {
        const b = grid.rect(r);
        this.pad([b.x, floorY(ch) ?? 0, b.z], c.pad, [b.w - 0.15, b.d - 0.15]);
      }
    }
    const built: BuiltMap = {
      grid,
      find: (ch) => grid.find(ch).map(([x, z]) => [x, floorY(ch) ?? 0, z] as Vec3),
    };
    return built;
  }

  /**
   * A plain walled room, `w` × `d` metres around the origin: tall walls north and west (behind
   * the scene from the default camera), low ones south and east (they never hide the hero).
   * `extra` legend characters can be drawn in with `rows` (a full map instead of the plain floor).
   */
  room(w: number, d: number, o: MapOptions & { rows?: readonly string[] } = {}): BuiltMap {
    const rows =
      o.rows ??
      Array.from({ length: d }, (_, r) =>
        Array.from({ length: w }, (_, c) => (r === 0 || c === 0 ? '#' : r === d - 1 || c === w - 1 ? '=' : '.')).join(''),
      );
    return this.map(rows, {
      ...o,
      legend: { '=': { block: { height: 0.6, color: o.wall?.color ?? 'slate', side: o.wall?.side ?? 'night' } }, ...o.legend },
    });
  }

  // ------------------------------------------------------------------ interaction

  /**
   * A pad on the floor (`at`: centre of its top). Stepping on it runs `def.apply` and shows
   * its note; pads in one `group` light up one at a time.
   */
  pad(at: Vec3, def: PadDef, size: [number, number] = [1.6, 1.6]): Pad {
    const color = def.color ?? 'blue';
    const mat = toonMaterial(PALETTE[color]).clone(); // its own: it lights up
    mat.userData.shared = false; // freed with the room
    const mesh = new Mesh(new BoxGeometry(size[0], 0.08, size[1]), mat);
    mesh.position.set(at[0], at[1] + 0.04, at[2]);
    mesh.receiveShadow = true;
    this.ctx.scene.add(mesh);
    const pad: Pad = {
      def,
      at: new Vector3(...at),
      size,
      mesh,
      active: false,
      trigger: this.ctx.physics.trigger({ box: [size[0] / 2, 0.4, size[1] / 2] }, [at[0], at[1] + 0.4, at[2]], {
        tag: 'character',
        onEnter: () => this.host.padStepped(pad),
      }),
      label: this.label([at[0], at[1] + 0.35, at[2]], def.label, { color: 'white', range: 9, small: true }),
    };
    this.pads.push(pad);
    if (def.initial) this.lightPad(pad, true);
    return pad;
  }

  /**
   * Pads in rows: `origin` is the centre of the first pad, rows run along +X and stack along
   * +Z, `pitch` metres apart (pads are pitch − 0.4 wide).
   */
  padGrid(defs: readonly PadDef[], o: { origin: Vec3; cols: number; pitch?: number }): Pad[] {
    const pitch = o.pitch ?? 2;
    return defs.map((d, i) =>
      this.pad([o.origin[0] + (i % o.cols) * pitch, o.origin[1], o.origin[2] + Math.floor(i / o.cols) * pitch], d, [pitch - 0.4, pitch - 0.4]),
    );
  }

  /** Light a pad up (or down). The shell does this when one is stepped on. */
  lightPad(pad: Pad, on: boolean): void {
    pad.active = on;
    const m = pad.mesh.material as Material & { emissive?: { setHex(h: number): void } };
    m.emissive?.setHex(on ? PALETTE[pad.def.color ?? 'blue'] : 0x000000);
    pad.mesh.position.y = pad.at.y + (on ? 0.02 : 0.04);
  }

  /** Floating text over a point (5×7 pixel font, drawn by the shell). */
  label(at: Vec3, text: string, o: LabelOptions = {}): Label {
    const l: Label = {
      at: new Vector3(...at),
      text: text.toUpperCase(),
      color: o.color ?? 'sand',
      range: o.range ?? 9,
      always: o.always ?? false,
      scale: o.scale ?? 1,
      visible: true,
      small: o.small ?? false,
    };
    this.labels.push(l);
    return l;
  }

  /** A named point (stations, spawns). */
  mark(name: string, at: Vec3): void {
    const list = this.markers.get(name) ?? [];
    list.push(at);
    this.markers.set(name, list);
  }

  /**
   * A toon material that glows in its own colour (lamps, orbs, lanterns): a room-owned copy,
   * so the shared cached material of that colour is left alone.
   */
  glow(color: PaletteColor, strength = 1): Material {
    const m = toonMaterial(PALETTE[color]).clone() as Material & { emissive: { setHex(h: number): void }; emissiveIntensity: number };
    m.userData.shared = false;
    m.emissive.setHex(PALETTE[color]);
    m.emissiveIntensity = strength;
    return m;
  }

  /** A light from the engine's pool (released when the room unloads). */
  light(o: LightRequestOptions): LightHandle {
    return this.ctx.lights.request(o);
  }

  /**
   * A doorway with a shimmering portal: walking into it runs `onEnter`. `facing` is the
   * direction you walk through it (radians about Y, 0 = +Z). Returns its group.
   */
  door(at: Vec3, facing: number, color: PaletteColor, onEnter: () => void, o: { title?: string; width?: number } = {}): Group {
    const w = o.width ?? 2.2;
    const h = 2.8;
    const g = new Group();
    g.position.set(...at);
    g.rotation.y = facing;
    const post = new BoxGeometry(0.35, h, 0.5);
    const mat = toonMaterial(PALETTE[color]);
    const dark = toonMaterial(PALETTE.night);
    const left = new Mesh(post, mat);
    left.position.set(-w / 2 - 0.17, h / 2, 0);
    const right = new Mesh(post, mat);
    right.position.set(w / 2 + 0.17, h / 2, 0);
    const lintel = new Mesh(new BoxGeometry(w + 0.9, 0.4, 0.6), dark);
    lintel.position.set(0, h + 0.2, 0);
    for (const m of [left, right, lintel]) m.castShadow = m.receiveShadow = true;
    const portal = new Mesh(new BoxGeometry(w, h, 0.05), portalMaterial(color));
    portal.position.set(0, h / 2, 0);
    g.add(left, right, lintel, portal);
    this.ctx.scene.add(g);
    // the posts block, the opening doesn't
    const world = (x: number, z: number): Vec3 => {
      const c = Math.cos(facing);
      const s = Math.sin(facing);
      return [at[0] + x * c + z * s, at[1], at[2] - x * s + z * c];
    };
    for (const x of [-w / 2 - 0.17, w / 2 + 0.17]) {
      const p = world(x, 0);
      this.ctx.physics.addStaticBox({ position: [p[0], at[1] + h / 2, p[2]], halfExtents: [0.17, h / 2, 0.25], rotationY: facing });
    }
    this.ctx.physics.trigger({ box: [w / 2 - 0.1, 1, 0.3] }, [at[0], at[1] + 1, at[2]], { tag: 'character', rotationY: facing, onEnter });
    if (o.title) this.label([at[0], at[1] + h + 0.9, at[2]], o.title, { color: 'white', range: 7 });
    return g;
  }

  // ------------------------------------------------------------------ internals

  /** Merge the static meshes into the scene (the shell calls this after `build`). */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.statics.length) this.ctx.scene.add(...mergeStaticMeshes(this.statics));
    this.statics.length = 0;
  }

  private collider(at: Vec3, size: Vec3, q: { x: number; y: number; z: number; w: number } | null, o: BoxOptions): RAPIER.Collider {
    const body = this.ctx.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(...at)
        .setRotation(q ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: 0, y: 0, z: 0, w: 1 }),
    );
    const col = this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setFriction(o.friction ?? 0.9), body);
    if (o.tags?.length) this.ctx.physics.tag(col, ...o.tags);
    return col;
  }
}

const portals = new Map<PaletteColor, MeshBasicNodeMaterial>();

/** A shimmering doorway: bands of the colour that rise, stepped into 3 shades (no blending). */
export function portalMaterial(color: PaletteColor): MeshBasicNodeMaterial {
  let m = portals.get(color);
  if (m) return m;
  m = new MeshBasicNodeMaterial();
  const base = tslColor(PALETTE[color]);
  const p = uv();
  const wave = sin(p.y.mul(18).sub(time.mul(3)).add(sin(p.x.mul(9).add(time)).mul(1.5)));
  const band = floor(wave.mul(0.5).add(0.5).mul(3)).div(2); // 0, 0.5, 1
  const edge = float(1).sub(p.x.sub(0.5).abs().mul(2)).mul(1.4).min(1);
  m.colorNode = mix(base.mul(0.35), mix(base, vec3(1, 1, 1), 0.35), band.mul(edge));
  m.name = `portal-${color}`;
  m.userData.shared = true;
  portals.set(color, m);
  return m;
}
