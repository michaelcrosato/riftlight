import type { Kit, V3 } from '../../../src/riftlight/town/kit';
import type { PaletteColor } from '../../../src/engine/palette';

/**
 * A wooden weapon rack holding three weapons: a sword (point down, hilt up), a spear and
 * a double-bit axe standing in a floor trough and leaning back on one low crossbar.
 * Front +Z. The weapons are oversized and stand well clear of the bar so they read at 480×270.
 */
export function build(kit: Kit): void {
  const W = 1.9; // distance between the two posts
  const barY = 0.78; // crossbar height
  const LEAN = 7; // degrees the weapons lean back onto the crossbar

  // --- frame (dark wood, red-brown rails) ---
  for (const sx of [-1, 1]) {
    const x = (sx * W) / 2;
    kit.box([0.16, 0.12, 0.66], 'plum', [x, 0.06, -0.04]); // foot
    kit.box([0.13, barY + 0.16, 0.13], 'plum', [x, (barY + 0.16) / 2, -0.16]); // post
    kit.box([0.19, 0.07, 0.19], 'red', [x, barY + 0.19, -0.16]); // cap
  }
  kit.box([W + 0.12, 0.12, 0.1], 'red', [0, barY, -0.16]); // crossbar behind the weapons
  // floor trough the weapon ends stand in
  kit.box([W, 0.12, 0.36], 'plum', [0, 0.14, -0.02], { top: 'ink' });
  kit.box([W + 0.04, 0.09, 0.06], 'red', [0, 0.24, 0.16]); // front lip

  // A weapon part on a leaning axis: `h` metres up the weapon, `dx` sideways from its axis.
  const z0 = 0.06;
  const s = Math.sin((LEAN * Math.PI) / 180);
  const c = Math.cos((LEAN * Math.PI) / 180);
  const at = (x: number, h: number): V3 => [x, 0.2 + h * c, z0 - h * s];
  const part = (x: number, size: V3, color: PaletteColor, h: number, dx = 0) =>
    kit.box(size, color, at(x + dx, h), { rot: [-LEAN, 0, 0] });

  // 1. sword (left): point down in the trough, blade, gold cross-guard and hilt above the bar
  {
    const x = -0.58;
    part(x, [0.2, 0.92, 0.05], 'white', 0.5); // blade
    part(x, [0.06, 0.86, 0.06], 'mist', 0.53); // fuller
    part(x, [0.48, 0.1, 0.12], 'sand', 1.0); // cross-guard
    part(x, [0.09, 0.26, 0.09], 'red', 1.17); // grip
    part(x, [0.15, 0.13, 0.15], 'sand', 1.36); // pommel
  }

  // 2. spear (middle): the tallest, a long shaft and a broad diamond head
  {
    const x = 0;
    part(x, [0.075, 1.65, 0.075], 'sand', 0.825); // shaft
    part(x, [0.12, 0.1, 0.12], 'slate', 1.66); // socket
    part(x, [0.11, 0.07, 0.11], 'red', 1.56); // binding
    kit.cone(0.17, 0.15, 4, 'mist', at(x, 1.785), { rot: [180 - LEAN, 45, 0] }); // head, lower half
    kit.cone(0.17, 0.48, 4, 'white', at(x, 2.1), { rot: [-LEAN, 45, 0] }); // head, point
  }

  // 3. double-bit axe (right): haft up, two broad bits
  {
    const x = 0.64;
    part(x, [0.085, 1.32, 0.085], 'orange', 0.66); // haft
    part(x, [0.15, 0.32, 0.15], 'slate', 1.17); // eye
    for (const sx of [-1, 1]) {
      part(x, [0.16, 0.24, 0.07], 'mist', 1.17, sx * 0.14); // cheek
      part(x, [0.12, 0.44, 0.07], 'mist', 1.17, sx * 0.27); // flare
      part(x, [0.08, 0.6, 0.075], 'white', 1.17, sx * 0.36); // edge
    }
    part(x, [0.1, 0.1, 0.1], 'night', 1.37); // knob
  }

  kit.blockBox(0, -0.04, W + 0.2, 0.66);
}
