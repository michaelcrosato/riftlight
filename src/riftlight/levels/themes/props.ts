import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  OctahedronGeometry,
} from 'three/webgpu';
import { Registry, type Entry } from '../../core/registry';
import type { Rng } from '../../core/rng';
import type { FlickerPreset } from '../../../engine/render/lights';
import { toonMaterial } from '../../../engine/render/toon';
import type { LevelTheme } from './themes';

/**
 * Props: chunky primitives with toon materials (good silhouettes from the iso camera at
 * 480×270: nothing thinner than ~0.15 m). A prop builder returns static parts (merged with
 * the level by material) and, for emissive props, a light request (the light pool decides
 * whether it gets a real light). Add a prop by adding a `PropDef`; themes list prop ids.
 */
export interface PropContext {
  readonly theme: LevelTheme;
  readonly rng: Rng;
}

export interface PropGlow {
  /** Offset from the prop's base. */
  readonly offset: readonly [number, number, number];
  readonly color: number;
  readonly intensity: number;
  readonly radius: number;
  readonly flicker: FlickerPreset;
}

export interface PropBuild {
  /** Static meshes in prop-local space (the base at the origin, 1 cell ≈ 1 m). */
  readonly parts: Object3D[];
  readonly glow?: PropGlow;
}

export interface PropDef extends Entry {
  /** Occupies its cell (actors can't walk through; the layout marks it solid). */
  readonly blocks: boolean;
  /** Prefers cells next to walls (banners, crates). */
  readonly nearWall?: boolean;
  build(ctx: PropContext): PropBuild;
}

// ------------------------------------------------------------------ materials + helpers

const glowCache = new Map<number, MeshBasicNodeMaterial>();

/** Unlit, full-bright material for flames, crystal cores and runes (shared, cached). */
export function glowMaterial(color: number): MeshBasicNodeMaterial {
  let m = glowCache.get(color);
  if (!m) {
    m = new MeshBasicNodeMaterial({ color });
    m.name = `glow-${color.toString(16).padStart(6, '0')}`;
    m.userData.shared = true;
    glowCache.set(color, m);
  }
  return m;
}

const geoCache = new Map<string, BufferGeometry>();
function geo(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    g.userData.shared = true;
    geoCache.set(key, g);
  }
  return g;
}

/** Shared geometries (props are merged into level meshes, so these are only sources). */
const G = {
  box: () => geo('box', () => new BoxGeometry(1, 1, 1)),
  cyl6: () => geo('cyl6', () => new CylinderGeometry(0.5, 0.5, 1, 6)),
  cyl8: () => geo('cyl8', () => new CylinderGeometry(0.5, 0.5, 1, 8)),
  taper: () => geo('taper', () => new CylinderGeometry(0.32, 0.5, 1, 6)),
  cone5: () => geo('cone5', () => new ConeGeometry(0.5, 1, 5)),
  cone6: () => geo('cone6', () => new ConeGeometry(0.5, 1, 6)),
  octa: () => geo('octa', () => new OctahedronGeometry(0.5, 0)),
  dodeca: () => geo('dodeca', () => new DodecahedronGeometry(0.5, 0)),
};

function part(g: BufferGeometry, m: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0): Mesh {
  const mesh = new Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Lighten (k > 0) or darken (k < 0) a colour. */
export function tint(hex: number, k: number): number {
  const c = new Color(hex);
  return k >= 0 ? c.lerp(new Color(0xffffff), k).getHex() : c.lerp(new Color(0x000000), -k).getHex();
}

const WOOD = 0x8a5a3a;
const BONE = 0xe6dcc0;

// ------------------------------------------------------------------ the props

export const PROPS = new Registry<PropDef>('prop', [
  {
    id: 'pillar',
    tags: ['stone', 'tall'],
    blocks: true,
    build: ({ theme }) => {
      const stone = toonMaterial(tint(theme.palette.wall, 0.18));
      const trim = toonMaterial(theme.trim);
      return {
        parts: [
          part(G.box(), trim, 0, 0.12, 0, 0.86, 0.24, 0.86),
          part(G.cyl6(), stone, 0, 1.2, 0, 0.6, 2.0, 0.6),
          part(G.box(), trim, 0, 2.3, 0, 0.86, 0.22, 0.86),
        ],
      };
    },
  },
  {
    id: 'brazier',
    tags: ['fire', 'light'],
    blocks: true,
    build: ({ theme }) => {
      const metal = toonMaterial(tint(theme.palette.wall, 0.1));
      const rim = toonMaterial(theme.trim);
      const flame = glowMaterial(theme.palette.accent);
      const core = glowMaterial(tint(theme.palette.light, 0.4));
      return {
        parts: [
          part(G.taper(), metal, 0, 0.35, 0, 0.36, 0.7, 0.36),
          part(G.cyl8(), rim, 0, 0.8, 0, 0.8, 0.22, 0.8),
          part(G.cone5(), flame, 0, 1.18, 0, 0.56, 0.62, 0.56),
          part(G.cone5(), core, 0.04, 1.08, 0.02, 0.3, 0.4, 0.3, 0.6),
        ],
        glow: { offset: [0, 1.5, 0], color: theme.palette.light, intensity: theme.torch.intensity, radius: theme.torch.radius, flicker: 'brazier' },
      };
    },
  },
  {
    // A wall sconce: built against local -z (the wall), placed on the floor cell in front.
    id: 'torch',
    tags: ['fire', 'light', 'wall'],
    weight: 0,
    blocks: false,
    nearWall: true,
    build: ({ theme }) => {
      const iron = toonMaterial(tint(theme.palette.wall, -0.2));
      const wood = toonMaterial(WOOD);
      const flame = glowMaterial(theme.palette.accent);
      const core = glowMaterial(tint(theme.palette.light, 0.45));
      return {
        parts: [
          part(G.box(), iron, 0, 1.45, -0.46, 0.22, 0.3, 0.08),
          part(G.box(), iron, 0, 1.5, -0.36, 0.1, 0.1, 0.2),
          part(G.cyl6(), wood, 0, 1.62, -0.28, 0.12, 0.42, 0.12, 0, -0.35),
          part(G.cone5(), flame, 0, 1.92, -0.22, 0.3, 0.42, 0.3),
          part(G.cone5(), core, 0, 1.86, -0.22, 0.16, 0.24, 0.16, 0.5),
        ],
        glow: { offset: [0, 2.0, -0.1], color: theme.palette.light, intensity: theme.torch.intensity * 0.85, radius: theme.torch.radius, flicker: theme.torch.flicker === 'brazier' ? 'torch' : theme.torch.flicker },
      };
    },
  },
  {
    id: 'lantern',
    tags: ['light'],
    blocks: false,
    build: ({ theme }) => {
      const post = toonMaterial(tint(theme.palette.wall, 0.15));
      const lamp = glowMaterial(tint(theme.palette.light, 0.2));
      return {
        parts: [part(G.box(), post, 0, 0.7, 0, 0.16, 1.4, 0.16), part(G.box(), post, 0, 1.42, 0, 0.42, 0.08, 0.42), part(G.box(), lamp, 0, 1.25, 0, 0.3, 0.3, 0.3)],
        glow: { offset: [0, 1.3, 0], color: theme.palette.light, intensity: theme.torch.intensity * 0.7, radius: theme.torch.radius * 0.8, flicker: 'candle' },
      };
    },
  },
  {
    id: 'crystal',
    tags: ['glow', 'light', 'magic'],
    blocks: true,
    build: ({ theme, rng }) => {
      const glow = glowMaterial(theme.palette.accent);
      const facet = toonMaterial(tint(theme.palette.accent, -0.35));
      const parts = [part(G.octa(), glow, 0, 0.75, 0, 0.55, 1.5, 0.55, rng.range(0, 3))];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng.range(-0.4, 0.4);
        parts.push(part(G.octa(), facet, Math.cos(a) * 0.32, 0.35, Math.sin(a) * 0.32, 0.32, rng.range(0.6, 0.9), 0.32, a, Math.cos(a) * 0.35, Math.sin(a) * 0.35));
      }
      return { parts, glow: { offset: [0, 1, 0], color: theme.palette.accent, intensity: 2.5, radius: 4.5, flicker: 'pulse' } };
    },
  },
  {
    id: 'bones',
    tags: ['small', 'undead'],
    blocks: false,
    build: ({ rng }) => {
      const bone = toonMaterial(BONE);
      const parts = [part(G.box(), bone, 0, 0.12, 0, 0.26, 0.24, 0.24, rng.range(0, 3))];
      for (let i = 0; i < 3; i++) parts.push(part(G.box(), bone, rng.range(-0.3, 0.3), 0.04, rng.range(-0.3, 0.3), 0.5, 0.08, 0.1, rng.range(0, 3)));
      return { parts };
    },
  },
  {
    id: 'crate',
    tags: ['wood'],
    blocks: true,
    nearWall: true,
    build: ({ rng }) => {
      const wood = toonMaterial(WOOD);
      const band = toonMaterial(tint(WOOD, -0.35));
      const r = rng.range(-0.3, 0.3);
      const parts = [part(G.box(), wood, 0, 0.36, 0, 0.72, 0.72, 0.72, r), part(G.box(), band, 0, 0.36, 0, 0.76, 0.14, 0.76, r)];
      if (rng.chance(0.4)) parts.push(part(G.box(), wood, 0.05, 0.95, -0.04, 0.48, 0.46, 0.48, r + 0.5));
      return { parts };
    },
  },
  {
    id: 'banner',
    tags: ['cloth'],
    blocks: false,
    nearWall: true,
    build: ({ theme }) => {
      const pole = toonMaterial(tint(theme.palette.wall, 0.1));
      const cloth = toonMaterial(theme.palette.accent);
      const hem = toonMaterial(theme.trim);
      return {
        parts: [
          part(G.box(), pole, 0, 1.2, 0, 0.14, 2.4, 0.14),
          part(G.box(), pole, 0, 2.3, 0.0, 0.9, 0.1, 0.12),
          part(G.box(), cloth, 0, 1.75, 0, 0.7, 1.0, 0.06),
          part(G.box(), hem, 0, 1.2, 0, 0.7, 0.12, 0.08),
        ],
      };
    },
  },
  {
    id: 'statue',
    tags: ['stone', 'tall'],
    blocks: true,
    build: ({ theme, rng }) => {
      const stone = toonMaterial(tint(theme.palette.wall, 0.35));
      const plinth = toonMaterial(theme.trim);
      const r = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
      return {
        parts: [
          part(G.box(), plinth, 0, 0.2, 0, 0.9, 0.4, 0.9),
          part(G.box(), stone, 0, 0.75, 0, 0.36, 0.7, 0.3, r), // legs
          part(G.box(), stone, 0, 1.35, 0, 0.56, 0.6, 0.34, r), // torso
          part(G.box(), stone, 0, 1.82, 0, 0.3, 0.3, 0.3, r), // head
          part(G.box(), stone, Math.cos(r) * 0.36, 1.45, -Math.sin(r) * 0.36, 0.16, 0.6, 0.16, r, 0, 0.3), // arm
          part(G.box(), stone, -Math.cos(r) * 0.36, 1.45, Math.sin(r) * 0.36, 0.16, 0.6, 0.16, r, 0, -0.3),
        ],
      };
    },
  },
  {
    id: 'tree',
    tags: ['nature', 'tall'],
    blocks: true,
    build: ({ theme, rng }) => {
      const bark = toonMaterial(tint(theme.palette.wall, 0.12));
      const leaf = toonMaterial(tint(theme.palette.accent, -0.3));
      const leafLit = toonMaterial(tint(theme.palette.accent, -0.12));
      const h = rng.range(0.9, 1.2);
      return {
        parts: [
          part(G.taper(), bark, 0, 0.6 * h, 0, 0.32, 1.2 * h, 0.32),
          part(G.cone6(), leaf, 0, 1.55 * h, 0, 1.5, 1.3, 1.5, rng.range(0, 1)),
          part(G.cone6(), leafLit, 0, 2.25 * h, 0, 1.05, 1.1, 1.05, rng.range(0, 1)),
          part(G.cone6(), leaf, 0, 2.85 * h, 0, 0.6, 0.8, 0.6),
        ],
      };
    },
  },
  {
    id: 'rubble',
    tags: ['stone', 'small'],
    blocks: false,
    build: ({ theme, rng }) => {
      const stone = toonMaterial(tint(theme.palette.wall, 0.22));
      const parts: Object3D[] = [];
      for (let i = 0; i < 3; i++) {
        const s = rng.range(0.22, 0.42);
        parts.push(part(G.box(), stone, rng.range(-0.3, 0.3), s / 2, rng.range(-0.3, 0.3), s * 1.3, s, s, rng.range(0, 3), rng.range(-0.2, 0.2)));
      }
      return { parts };
    },
  },
  {
    id: 'rock',
    tags: ['stone', 'nature'],
    blocks: true,
    build: ({ theme, rng }) => {
      const stone = toonMaterial(tint(theme.palette.wall, 0.25));
      const s = rng.range(0.8, 1.05);
      return {
        parts: [
          part(G.dodeca(), stone, 0, 0.42 * s, 0, 1.0 * s, 0.85 * s, 0.95 * s, rng.range(0, 3)),
          part(G.dodeca(), stone, 0.3, 0.2, 0.25, 0.45, 0.4, 0.45, rng.range(0, 3)),
        ],
      };
    },
  },
  {
    id: 'mushroom',
    tags: ['nature', 'glow', 'light'],
    blocks: false,
    build: ({ theme, rng }) => {
      const stalk = toonMaterial(BONE);
      const cap = glowMaterial(theme.palette.accent);
      const parts: Object3D[] = [];
      for (let i = 0; i < 3; i++) {
        const x = rng.range(-0.3, 0.3);
        const z = rng.range(-0.3, 0.3);
        const h = rng.range(0.25, 0.55);
        parts.push(part(G.cyl6(), stalk, x, h / 2, z, 0.1, h, 0.1), part(G.cone6(), cap, x, h + 0.06, z, 0.36, 0.18, 0.36));
      }
      return { parts, glow: { offset: [0, 0.6, 0], color: theme.palette.accent, intensity: 1.6, radius: 3.5, flicker: 'pulse' } };
    },
  },
]);

/** Build a prop at a world position (base on the floor), facing `rot` radians. */
export function buildProp(id: string, ctx: PropContext, x: number, z: number, rot = 0): PropBuild & { root: Group } {
  const def = PROPS.get(id);
  const b = def.build(ctx);
  const root = new Group();
  root.position.set(x, 0, z);
  root.rotation.y = rot;
  for (const p of b.parts) root.add(p);
  root.updateMatrixWorld(true);
  return { ...b, root };
}
