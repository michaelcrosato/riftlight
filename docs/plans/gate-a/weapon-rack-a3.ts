import type { Kit, V3 } from '../../../src/riftlight/town/kit';

/**
 * A free-standing wooden weapon rack: a trough on two sled feet and a low back frame whose
 * top rail the weapons lean against. It holds a sword (hilt up, left), a tall spear (centre)
 * and a double-bitted battle axe (right), their heads well clear of the rail so they read
 * from the isometric camera. Origin at the centre of the base, floor y = 0, front +Z, metres.
 */
export function build(kit: Kit): void {
  const W = 1.5; // rack width (upright centres)
  const zFrame = -0.14; // plane of the uprights and top rail
  const yRail = 0.85;

  // --- frame (dark wood, red rails) ---
  for (const sx of [-1, 1]) kit.box([0.16, 0.1, 0.6], 'plum', [sx * (W / 2), 0.05, -0.03]); // sled feet
  kit.box([W, 0.08, 0.36], 'plum', [0, 0.14, 0.0]); // trough floor
  kit.box([W + 0.06, 0.14, 0.06], 'red', [0, 0.22, 0.19], { top: 'orange' }); // trough front lip
  for (const sx of [-1, 1]) kit.box([0.14, 0.86, 0.14], 'plum', [sx * (W / 2), 0.1 + 0.43, zFrame]); // uprights
  kit.box([W + 0.24, 0.12, 0.16], 'red', [0, yRail, zFrame], { top: 'orange' }); // top rail
  kit.box([W, 0.08, 0.08], 'red', [0, 0.45, zFrame]); // back stretcher

  // --- weapons: each stands in the trough and leans back onto the top rail ---
  const lean = 7; // degrees, top towards -Z
  const s = Math.sin((lean * Math.PI) / 180);
  const c = Math.cos((lean * Math.PI) / 180);
  const yBase = 0.18;
  const zBase = 0.04;
  /** A point `h` metres up a weapon's leaning axis at x (dx: sideways offset). */
  const at = (x: number, h: number, dx = 0): V3 => [x + dx, yBase + h * c, zBase - h * s];
  const tilt = (yaw = 0): { rot: V3 } => ({ rot: [-lean, yaw, 0] });

  // sword, hilt up: point in the trough, the cross-hilt above the rail
  {
    const x = -0.4;
    kit.cone(0.1, 0.14, 4, 'white', at(x, 0.07), { rot: [180 - lean, 45, 0] }); // point
    kit.box([0.15, 0.8, 0.04], 'white', at(x, 0.54), tilt()); // blade
    kit.box([0.04, 0.62, 0.05], 'mist', at(x, 0.58), tilt()); // fuller
    kit.box([0.44, 0.09, 0.1], 'sand', at(x, 0.98), tilt()); // crossguard
    kit.box([0.08, 0.26, 0.08], 'blue', at(x, 1.15), tilt()); // grip
    kit.box([0.13, 0.11, 0.13], 'sand', at(x, 1.32), tilt(45)); // pommel
  }

  // spear, the tallest: long shaft and a big leaf head
  {
    const x = 0;
    kit.cyl(0.035, 0.035, 1.9, 6, 'orange', at(x, 0.95), tilt()); // shaft
    kit.box([0.09, 0.1, 0.09], 'sand', at(x, 1.92), tilt(45)); // socket collar
    kit.cone(0.12, 0.5, 4, 'white', at(x, 2.22), tilt(45)); // head
  }

  // double-bitted axe, head up well above the rail
  {
    const x = 0.46;
    const hHead = 1.3;
    kit.cyl(0.04, 0.04, 1.46, 6, 'orange', at(x, 0.73), tilt()); // haft
    kit.box([0.12, 0.24, 0.12], 'slate', at(x, hHead), tilt()); // eye
    for (const sx of [-1, 1]) {
      kit.box([0.14, 0.26, 0.06], 'white', at(x, hHead, sx * 0.12), tilt()); // cheek
      kit.box([0.08, 0.54, 0.05], 'white', at(x, hHead, sx * 0.22), tilt()); // flared bit
    }
    kit.box([0.06, 0.08, 0.06], 'sand', at(x, hHead + 0.16), tilt()); // cap
  }

  kit.blockBox(0, -0.03, W + 0.24, 0.6);
}
