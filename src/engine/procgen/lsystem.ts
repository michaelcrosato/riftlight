/**
 * L-systems (Lindenmayer): plants grown by rewriting a string. Start from an axiom; each
 * generation, every symbol with a rule is replaced by its right-hand side at once (several
 * right-hand sides with probabilities make every plant a little different). Then a turtle
 * reads the string as drawing commands in 3D: F draws a segment forward, + − turn, & ^ pitch,
 * \ / roll, [ ] remember and return to a branch point, L a leaf.
 *
 *   const s = expand(PLANTS.fern, 5);
 *   const { branches, leaves } = turtle(s, { angle: 25, length: 0.2 });
 *   // branches: { from, to, radius, depth }, leaves: { at, dir, depth }
 */
import { Quaternion, Vector3 } from 'three/webgpu';
import { seeded } from '../physics/fracture';

type V3 = [number, number, number];

/** One right-hand side, chosen with probability `p` among a symbol's rules. */
export interface LRule {
  to: string;
  p?: number;
}

export interface LSystemDef {
  axiom: string;
  /** symbol → what replaces it (one string, or several to choose from by probability) */
  rules: Readonly<Record<string, string | readonly LRule[]>>;
}

export interface TurtleOptions {
  /** Turn per + − & ^ \ / (degrees, default 25). */
  angle?: number;
  /** Length of an F at the trunk (default 1). */
  length?: number;
  /** Length kept per branching level (each `[`, default 0.8). */
  lengthScale?: number;
  /** Trunk radius (default 0.08). */
  radius?: number;
  /** Radius kept per branching level, and per `!` (default 0.65). */
  radiusScale?: number;
  /** Degrees of random wobble on every turn (default 0), seeded. */
  jitter?: number;
  seed?: number;
  /** Bend toward this direction a little each segment (gravity, light): [x, y, z] and how much per segment (radians). */
  tropism?: { dir: V3; amount: number };
}

export interface Branch {
  from: V3;
  to: V3;
  radius: number;
  /** Branching level (0 = trunk). */
  depth: number;
}

export interface Leaf {
  at: V3;
  /** The way the twig it grows on points. */
  dir: V3;
  depth: number;
}

/** Grow `iterations` generations. Stops early (keeping the last whole generation) past `maxLength` symbols. */
export function expand(sys: LSystemDef, iterations: number, seed = 1, maxLength = 250_000): string {
  const rand = seeded(seed);
  let s = sys.axiom;
  for (let i = 0; i < iterations; i++) {
    let out = '';
    for (const ch of s) {
      const r = sys.rules[ch];
      if (r === undefined) out += ch;
      else if (typeof r === 'string') out += r;
      else {
        const total = r.reduce((sum, x) => sum + (x.p ?? 1), 0);
        let pick = rand() * total;
        let chosen = r[r.length - 1]!.to;
        for (const x of r) {
          pick -= x.p ?? 1;
          if (pick <= 0) {
            chosen = x.to;
            break;
          }
        }
        out += chosen;
      }
      if (out.length > maxLength) return s;
    }
    s = out;
  }
  return s;
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * Read an L-system string as a 3D turtle starting at the origin heading up (+y). Turns are about
 * the turtle's own axes (its heading is its +y): + turns the heading toward its −x and − toward
 * +x (about its z), & pitches it toward its +z and ^ toward −z (about its x), \ and / roll about
 * the heading, | turns round. `[` pushes position, orientation, length and radius (both shrink a
 * level), `]` pops. `!` thins the radius. `L` puts a leaf. Other symbols are ignored.
 */
export function turtle(s: string, o: TurtleOptions = {}): { branches: Branch[]; leaves: Leaf[] } {
  const angle = ((o.angle ?? 25) * Math.PI) / 180;
  const lengthScale = o.lengthScale ?? 0.8;
  const radiusScale = o.radiusScale ?? 0.65;
  const jitter = ((o.jitter ?? 0) * Math.PI) / 180;
  const rand = seeded(o.seed ?? 1);
  const branches: Branch[] = [];
  const leaves: Leaf[] = [];
  const pos = new Vector3();
  const q = new Quaternion();
  let length = o.length ?? 1;
  let radius = o.radius ?? 0.08;
  let depth = 0;
  const stack: { pos: Vector3; q: Quaternion; length: number; radius: number; depth: number }[] = [];
  const turn = new Quaternion();
  const heading = new Vector3();
  const trop = o.tropism ? new Vector3(...o.tropism.dir).normalize() : null;
  const bend = new Vector3();
  const rotate = (axis: Vector3, a: number) => {
    const w = jitter ? a + (rand() * 2 - 1) * jitter : a;
    q.multiply(turn.setFromAxisAngle(axis, w)); // about the turtle's own axis
  };
  for (const ch of s) {
    switch (ch) {
      case 'F':
      case 'G': {
        heading.copy(Y_AXIS).applyQuaternion(q);
        if (trop) {
          // turn a little toward the tropism direction (about heading × direction)
          bend.crossVectors(heading, trop);
          const l = bend.length();
          if (l > 1e-6) {
            q.premultiply(turn.setFromAxisAngle(bend.divideScalar(l), o.tropism!.amount * l));
            heading.copy(Y_AXIS).applyQuaternion(q);
          }
        }
        const from: V3 = [pos.x, pos.y, pos.z];
        pos.addScaledVector(heading, length);
        branches.push({ from, to: [pos.x, pos.y, pos.z], radius, depth });
        break;
      }
      case 'f':
        pos.addScaledVector(heading.copy(Y_AXIS).applyQuaternion(q), length);
        break;
      case '+':
        rotate(Z_AXIS, angle);
        break;
      case '-':
        rotate(Z_AXIS, -angle);
        break;
      case '&':
        rotate(X_AXIS, angle);
        break;
      case '^':
        rotate(X_AXIS, -angle);
        break;
      case '\\':
        rotate(Y_AXIS, angle);
        break;
      case '/':
        rotate(Y_AXIS, -angle);
        break;
      case '|':
        rotate(Z_AXIS, Math.PI);
        break;
      case '!':
        radius *= radiusScale;
        break;
      case '[':
        stack.push({ pos: pos.clone(), q: q.clone(), length, radius, depth });
        length *= lengthScale;
        radius *= radiusScale;
        depth++;
        break;
      case ']': {
        const top = stack.pop();
        if (!top) break;
        pos.copy(top.pos);
        q.copy(top.q);
        ({ length, radius, depth } = top);
        break;
      }
      case 'L':
        heading.copy(Y_AXIS).applyQuaternion(q);
        leaves.push({ at: [pos.x, pos.y, pos.z], dir: [heading.x, heading.y, heading.z], depth });
        break;
    }
  }
  return { branches, leaves };
}

/** Classic plants (after The Algorithmic Beauty of Plants), with turtle settings that suit them. */
export const PLANTS = {
  /** A bush branching three ways at every node (ABOP fig. 1.25), leaves on every twig. */
  bush: {
    system: { axiom: 'A', rules: { A: '[&FL!A]/////[&FL!A]///////[&FL!A]', F: 'S/////F', S: 'FL' } },
    iterations: 5,
    turtle: { angle: 22.5, length: 0.3, lengthScale: 0.95, radius: 0.07, radiusScale: 0.75 },
  },
  /** A fern-like frond (ABOP fig. 1.24f) turned into 3D with a roll at each fork. */
  fern: {
    system: { axiom: 'X', rules: { X: 'F+[[X]-XL]-F[-FXL]+X/', F: 'FF' } },
    iterations: 5,
    turtle: { angle: 25, length: 0.07, lengthScale: 0.95, radius: 0.03, radiusScale: 0.85 },
  },
  /** A weed with sides that differ each time (stochastic, after ABOP fig. 1.27, rolled into 3D). */
  weed: {
    system: {
      axiom: 'F',
      rules: {
        F: [
          { to: 'F[+FL]///F[-FL]F', p: 0.33 },
          { to: 'F[\\+FL]//F', p: 0.33 },
          { to: 'F[/-FL]\\\\F', p: 0.34 },
        ],
      },
    },
    iterations: 5,
    turtle: { angle: 28, length: 0.035, lengthScale: 0.95, radius: 0.025, radiusScale: 0.8 },
  },
  /** A tall tree: a trunk that forks in three, branches bending down under their weight. */
  tree: {
    system: { axiom: 'FFA', rules: { A: 'F[&&B]////[&&B]////[&&B]', B: 'F[+&BL]\\\\[-^BL]FL' } },
    iterations: 6,
    turtle: { angle: 24, length: 0.55, lengthScale: 0.82, radius: 0.16, radiusScale: 0.62, tropism: { dir: [0, -1, 0], amount: 0.08 } },
  },
} satisfies Record<string, { system: LSystemDef; iterations: number; turtle: TurtleOptions }>;
