import { Box3, type BufferGeometry, Group, Mesh, OctahedronGeometry, type Object3D, RingGeometry, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor } from '../../engine/palette';
import type { ChargeType } from '../core/types';
import { CHARGE_TYPES, CHARGES, type Charges } from './charges';
import type { Curses } from './curses';
import { glow } from './visuals';

/**
 * What charges and curses look like on an actor, so a build reads on screen:
 *
 * - **charges**: glowing pips orbiting the body at chest height, one per charge, in the
 *   charge's colour (endurance red, frenzy lime, power sky), bobbing out of phase;
 * - **curses**: a slowly turning rune circle on the ground under the cursed actor in the
 *   curse's colour (a dark disc behind it for contrast), a rune shard spinning over its head,
 *   and a pulsing tint on the body (`BodyFx.tint`).
 *
 * Unlit palette materials (`glow`, shared by colour) and shared geometry only: nothing compiles
 * mid-fight, and no lights (the meshes are emissive; dynamic lights come from `ctx.lights`).
 * The group lives next to the body (in its parent), not inside it, so body scale, ragdolls
 * and facing never bend the orbit.
 */
export interface StatusHost {
  readonly body: Object3D;
  readonly radius: number;
  readonly charges: Charges;
  readonly curses: Curses;
  readonly alive: boolean;
  readonly fx: { tint(color: number | null, k?: number): void };
}

export const STATUS_FX = {
  /** Orbit radius (m) beyond the actor's radius, height of the pip ring (m), pip size (m). */
  orbit: 0.6,
  height: 1.2,
  pip: 0.3,
  /** Radians per second around the body. */
  spin: 2.6,
  /** Rune circle radius as a multiple of the actor's radius. */
  rune: 2.6,
  /** Body tint strength (emissive) of a cursed actor, and its pulse. */
  tint: 0.42,
  pulse: 0.16,
} as const;

const geos = new Map<string, BufferGeometry>();
function geo<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) {
    g = make();
    g.userData.shared = true;
    geos.set(key, g);
  }
  return g;
}

function mesh(g: BufferGeometry, color: PaletteColor): Mesh {
  const m = new Mesh(g, glow(color));
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.noFlash = true;
  return m;
}

export class StatusFx {
  readonly root = new Group();
  private readonly pips: Mesh[] = [];
  private readonly pipType: (ChargeType | null)[] = [];
  private rune: Mesh | null = null;
  private runeInner: Mesh | null = null;
  private shade: Mesh | null = null;
  private shard: Mesh | null = null;
  private runeColor: PaletteColor | null = null;
  private t = 0;
  private headY = -1;

  constructor(private readonly host: StatusHost) {
    this.root.name = 'status-fx';
    this.root.visible = false;
  }

  /** Charges held, in pip order (for tests and inspectors). */
  get pipCount(): number {
    return this.pips.filter((p) => p.visible).length;
  }

  get cursed(): boolean {
    return !!this.rune?.visible;
  }

  update(dt: number): void {
    const h = this.host;
    this.t += dt;
    const charges = h.alive ? h.charges.total : 0;
    const curses = h.alive ? h.curses.list : [];
    if (!charges && !curses.length) {
      if (this.root.visible) {
        this.root.visible = false;
        h.fx.tint(null);
      }
      return;
    }
    const parent = h.body.parent;
    if (!parent) return;
    if (this.root.parent !== parent) parent.add(this.root);
    this.root.visible = true;
    this.root.position.copy(h.body.position);
    this.updatePips(charges);
    this.updateCurse(curses.length ? curses[curses.length - 1]!.color : null, curses.length);
  }

  private updatePips(n: number): void {
    const h = this.host;
    let i = 0;
    for (const type of CHARGE_TYPES) {
      for (let k = 0; k < h.charges.count[type]; k++, i++) {
        let p = this.pips[i];
        if (!p) {
          p = mesh(
            geo('pip', () => new OctahedronGeometry(0.5, 0)),
            CHARGES[type].color,
          );
          p.name = 'charge-pip';
          this.pips.push(p);
          this.pipType.push(null);
          this.root.add(p);
        }
        if (this.pipType[i] !== type) {
          p.material = glow(CHARGES[type].color);
          this.pipType[i] = type;
        }
        p.visible = true;
        const a = this.t * STATUS_FX.spin + (i / Math.max(1, n)) * Math.PI * 2;
        const r = h.radius + STATUS_FX.orbit;
        // three kinds ride three heights, so a full set reads as rings of colour
        const lane = CHARGE_TYPES.indexOf(type) - 1;
        p.position.set(Math.sin(a) * r, STATUS_FX.height + lane * 0.22 + Math.sin(this.t * 3 + i * 1.7) * 0.06, Math.cos(a) * r);
        const s = STATUS_FX.pip * (1 + 0.12 * Math.sin(this.t * 8 + i));
        p.scale.set(s, s * 1.5, s);
        p.rotation.y = this.t * 4 + i;
      }
    }
    for (; i < this.pips.length; i++) this.pips[i]!.visible = false;
  }

  private updateCurse(color: PaletteColor | null, n: number): void {
    const h = this.host;
    if (!color) {
      if (this.rune) this.rune.visible = this.runeInner!.visible = this.shade!.visible = this.shard!.visible = false;
      h.fx.tint(null);
      return;
    }
    if (!this.rune) {
      this.shade = mesh(geo('curse-shade', () => new RingGeometry(0.15, 1.05, 24, 1).rotateX(-Math.PI / 2)), 'ink');
      this.shade.renderOrder = 1;
      this.rune = mesh(geo('curse-rune', () => new RingGeometry(0.74, 1, 6, 1).rotateX(-Math.PI / 2)), color);
      this.runeInner = mesh(geo('curse-rune-inner', () => new RingGeometry(0.4, 0.56, 3, 1).rotateX(-Math.PI / 2)), color);
      this.rune.renderOrder = this.runeInner.renderOrder = 2;
      this.shard = mesh(geo('curse-shard', () => new OctahedronGeometry(0.5, 0)), color);
      for (const m of [this.shade, this.rune, this.runeInner, this.shard]) {
        m.name = 'curse-rune';
        this.root.add(m);
      }
    }
    if (this.runeColor !== color) {
      this.rune.material = this.runeInner!.material = this.shard!.material = glow(color);
      this.runeColor = color;
    }
    if (this.headY < 0) this.headY = headHeight(h.body);
    const R = h.radius * STATUS_FX.rune;
    this.rune.visible = this.runeInner!.visible = this.shade!.visible = this.shard!.visible = true;
    this.shade!.position.y = 0.025;
    this.shade!.scale.setScalar(R);
    this.rune.position.y = this.runeInner!.position.y = 0.04;
    this.rune.scale.setScalar(R * (1 + 0.04 * Math.sin(this.t * 5)));
    this.rune.rotation.y = this.t * 0.9;
    this.runeInner!.scale.setScalar(R);
    this.runeInner!.rotation.y = -this.t * 1.6;
    // one shard per curse would crowd small monsters: one, bigger with more curses
    this.shard!.position.set(0, this.headY + 0.35 + Math.sin(this.t * 2.5) * 0.08, 0);
    const s = 0.26 + 0.05 * Math.min(3, n - 1);
    this.shard!.scale.set(s, s * 1.6, s);
    this.shard!.rotation.y = this.t * 3;
    h.fx.tint(PALETTE[color], STATUS_FX.tint + STATUS_FX.pulse * Math.sin(this.t * 6));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.host.fx.tint(null);
  }
}

const box = new Box3();
const size = new Vector3();
/** Height of a body's top above its feet (local), measured once. */
function headHeight(body: Object3D): number {
  const y = body.position.y;
  box.setFromObject(body, false);
  if (box.isEmpty()) return 1.6;
  box.getSize(size);
  return Math.max(0.6, Math.min(4, box.max.y - y));
}
