import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  OctahedronGeometry,
  RingGeometry,
} from 'three/webgpu';
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { toonMaterial } from '../../engine/render/toon';
import type { SkillLook } from '../skills/types';

/**
 * Pixel-friendly effect meshes: chunky low-poly shapes in flat unlit palette colours (they
 * read as glowing next to the toon-shaded world) or toon materials for solid things. Every
 * geometry and material here is cached and marked `userData.shared`, so effects are cheap
 * to spawn and level unloads never free what the next level reuses.
 */
const geometries = new Map<string, BufferGeometry>();
const glows = new Map<number, MeshBasicNodeMaterial>();

function shared<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geometries.get(key) as T | undefined;
  if (!g) {
    g = make();
    g.userData.shared = true;
    geometries.set(key, g);
  }
  return g;
}

/** Flat, unlit palette colour (never disposed by level unloads). */
export function glow(color: PaletteColor | number): MeshBasicNodeMaterial {
  const hex = typeof color === 'number' ? color : PALETTE[color];
  let m = glows.get(hex);
  if (!m) {
    m = new MeshBasicNodeMaterial({ color: new Color(hex) });
    m.userData.shared = true;
    m.name = `glow-${hex.toString(16)}`;
    glows.set(hex, m);
  }
  return m;
}

function mesh(geometry: BufferGeometry, material: Material, cast = false): Mesh {
  const m = new Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = false;
  m.userData.noFlash = true;
  return m;
}

/** A projectile mesh pointing along +Z. */
export function projectileMesh(look: SkillLook): Object3D {
  const c = look.color;
  const g = new Group();
  const hi = look.glow?.[0] ?? 'white';
  switch (look.shape ?? 'orb') {
    case 'arrow': {
      const shaft = mesh(shared('arrow-shaft', () => new BoxGeometry(0.06, 0.06, 0.7)), toonMaterial(PALETTE.sand));
      const tip = mesh(shared('arrow-tip', () => new ConeGeometry(0.08, 0.2, 4).rotateX(Math.PI / 2).translate(0, 0, 0.42)), glow(c));
      const fletch = mesh(shared('arrow-fletch', () => new BoxGeometry(0.16, 0.02, 0.14).translate(0, 0, -0.3)), glow(hi));
      g.add(shaft, tip, fletch);
      break;
    }
    case 'shard': {
      const s = mesh(shared('shard', () => new OctahedronGeometry(0.22, 0).scale(0.7, 0.7, 2.2)), glow(c));
      const core = mesh(shared('shard-core', () => new OctahedronGeometry(0.12, 0).scale(0.7, 0.7, 2)), glow(hi));
      g.add(s, core);
      break;
    }
    case 'bolt': {
      const b = mesh(shared('bolt', () => new BoxGeometry(0.1, 0.1, 0.9)), glow(hi));
      const halo = mesh(shared('bolt-halo', () => new BoxGeometry(0.22, 0.22, 0.6)), glow(c));
      g.add(b, halo);
      break;
    }
    case 'skull': {
      const s = mesh(shared('skull', () => new BoxGeometry(0.36, 0.32, 0.36)), glow(c));
      const eyes = mesh(shared('skull-eyes', () => new BoxGeometry(0.3, 0.08, 0.05).translate(0, 0.04, 0.18)), glow(hi));
      g.add(s, eyes);
      break;
    }
    case 'rock': {
      const r = mesh(shared('rock', () => new DodecahedronGeometry(0.7, 0)), toonMaterial(PALETTE.plum), true);
      const lava = mesh(shared('rock-lava', () => new DodecahedronGeometry(0.55, 0).scale(1.05, 1.05, 1.05)), glow(c));
      g.add(r, lava);
      break;
    }
    default: {
      const o = mesh(shared('orb', () => new IcosahedronGeometry(0.28, 0)), glow(c));
      const core = mesh(shared('orb-core', () => new IcosahedronGeometry(0.17, 0)), glow(hi));
      core.scale.setScalar(1.25);
      g.add(o, core);
    }
  }
  return g;
}

/** A flat ring on the ground (inner/outer radius as fractions of 1), scaled by the caller. */
export function ringDecal(color: PaletteColor | number, inner = 0.86, segments = 28): Mesh {
  const m = mesh(shared(`ring-${inner}-${segments}`, () => new RingGeometry(inner, 1, segments, 1).rotateX(-Math.PI / 2)), glow(color));
  m.renderOrder = 2;
  return m;
}

/** A flat filled disc on the ground (radius 1). */
export function discDecal(color: PaletteColor | number, segments = 28): Mesh {
  const m = mesh(shared(`disc-${segments}`, () => new CircleGeometry(1, segments).rotateX(-Math.PI / 2)), glow(color));
  m.renderOrder = 2;
  return m;
}

/** A flat arc ribbon (a sword swoosh) centred on +Z, `arc` degrees wide, radii in metres. */
export function arcDecal(color: PaletteColor | number, arcDeg: number, inner: number, outer: number): Mesh {
  const a = (Math.min(359, arcDeg) * Math.PI) / 180;
  const key = `arc-${Math.round(arcDeg)}-${inner.toFixed(2)}-${outer.toFixed(2)}`;
  return mesh(shared(key, () => new RingGeometry(inner, outer, Math.max(6, Math.round(arcDeg / 12)), 1, -Math.PI / 2 - a / 2, a).rotateX(-Math.PI / 2)), glow(color));
}

/** A box (beams, walls, columns), 1 m cube scaled by the caller. */
export function boxMesh(color: PaletteColor | number, toon = false): Mesh {
  return mesh(shared('box', () => new BoxGeometry(1, 1, 1)), toon ? toonMaterial(typeof color === 'number' ? color : PALETTE[color]) : glow(color), toon);
}

/** A unit box whose base sits at y = 0 and that extends along +Z (beams from the hand). */
export function beamMesh(color: PaletteColor | number): Mesh {
  return mesh(shared('beam', () => new BoxGeometry(1, 1, 1).translate(0, 0, 0.5)), glow(color));
}

/** A small trap / mine model. */
export function trapMesh(look: SkillLook, mine: boolean): Object3D {
  const g = new Group();
  const base = mesh(shared(mine ? 'mine' : 'trap', () => (mine ? new OctahedronGeometry(0.25, 0).scale(1, 0.5, 1) : new BoxGeometry(0.45, 0.14, 0.45))), toonMaterial(PALETTE.slate), true);
  base.position.y = 0.08;
  const light = mesh(shared('trap-light', () => new BoxGeometry(0.12, 0.08, 0.12)), glow(look.color));
  light.position.y = 0.18;
  g.add(base, light);
  return g;
}
