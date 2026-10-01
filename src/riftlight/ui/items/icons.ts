/**
 * Pixel-art item icons, drawn procedurally from a few rects per item class so they fill
 * any cell box (a 1×3 sword, a 2×4 bow). `colour` tints the "magic" part (gem, edge,
 * trim) with the rarity colour; metal and leather come from the palette.
 */
import { PALETTE } from '../../../engine/palette';
import type { Painter } from './paint';

const METAL = PALETTE.mist;
const DARK = PALETTE.slate;
const WOOD = PALETTE.orange;
const LEATHER = PALETTE.plum;

/** Draw the icon for item class `look` inside the box (x, y, w, h). */
export function drawIcon(p: Painter, look: string, x: number, y: number, w: number, h: number, colour: number, short?: string): void {
  const cx = Math.floor(x + w / 2);
  const r = (fx: number, fy: number, fw: number, fh: number, c: number) => p.rect(Math.round(x + fx * w), Math.round(y + fy * h), Math.max(1, Math.round(fw * w)), Math.max(1, Math.round(fh * h)), c);
  switch (look) {
    case 'sword':
      p.rect(cx - 1, y + 2, 3, Math.round(h * 0.62), METAL);
      p.rect(cx, y + 2, 1, Math.round(h * 0.62), PALETTE.white);
      r(0.15, 0.66, 0.7, 0.06, colour);
      p.rect(cx - 1, Math.round(y + h * 0.72), 3, Math.round(h * 0.18), WOOD);
      p.rect(cx - 1, Math.round(y + h * 0.9), 3, 2, colour);
      break;
    case 'dagger':
      p.rect(cx - 1, y + 2, 3, Math.round(h * 0.5), METAL);
      r(0.2, 0.55, 0.6, 0.08, colour);
      p.rect(cx - 1, Math.round(y + h * 0.63), 3, Math.round(h * 0.28), LEATHER);
      break;
    case 'axe':
      r(0.45, 0.08, 0.1, 0.86, WOOD);
      r(0.12, 0.08, 0.36, 0.26, METAL);
      r(0.12, 0.08, 0.08, 0.26, colour);
      break;
    case 'mace':
      r(0.45, 0.25, 0.1, 0.7, WOOD);
      r(0.25, 0.06, 0.5, 0.22, METAL);
      r(0.2, 0.12, 0.6, 0.1, colour);
      break;
    case 'bow':
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const bend = Math.sin(t * Math.PI) * 0.35;
        r(0.2 + bend, 0.05 + t * 0.85, 0.12, 0.12, WOOD);
      }
      r(0.25, 0.08, 0.04, 0.84, PALETTE.white);
      r(0.5, 0.45, 0.2, 0.1, colour);
      break;
    case 'staff':
      r(0.45, 0.15, 0.1, 0.82, WOOD);
      r(0.33, 0.03, 0.34, 0.14, colour);
      r(0.4, 0.06, 0.1, 0.05, PALETTE.white);
      break;
    case 'wand':
      p.rect(cx - 1, Math.round(y + h * 0.25), 2, Math.round(h * 0.7), WOOD);
      p.rect(cx - 2, y + 2, 4, Math.round(h * 0.22), colour);
      break;
    case 'sceptre':
      p.rect(cx - 1, Math.round(y + h * 0.3), 3, Math.round(h * 0.65), METAL);
      p.rect(cx - 3, y + 2, 7, Math.round(h * 0.25), colour);
      p.rect(cx - 1, y + 3, 3, 3, PALETTE.white);
      break;
    case 'shield':
      r(0.12, 0.08, 0.76, 0.6, METAL);
      r(0.24, 0.68, 0.52, 0.14, METAL);
      r(0.38, 0.82, 0.24, 0.1, METAL);
      r(0.4, 0.2, 0.2, 0.4, colour);
      break;
    case 'quiver':
      r(0.25, 0.25, 0.5, 0.7, LEATHER);
      for (const fx of [0.3, 0.45, 0.6]) r(fx, 0.05, 0.08, 0.22, colour);
      break;
    case 'focus':
      r(0.25, 0.2, 0.5, 0.6, colour);
      r(0.15, 0.35, 0.7, 0.3, colour);
      r(0.4, 0.35, 0.15, 0.15, PALETTE.white);
      break;
    case 'helm':
      r(0.15, 0.25, 0.7, 0.5, METAL);
      r(0.25, 0.12, 0.5, 0.15, METAL);
      r(0.15, 0.5, 0.7, 0.1, DARK);
      r(0.45, 0.12, 0.1, 0.4, colour);
      break;
    case 'body':
      r(0.15, 0.1, 0.7, 0.55, METAL);
      r(0.25, 0.65, 0.5, 0.28, METAL);
      r(0.05, 0.1, 0.15, 0.3, DARK);
      r(0.8, 0.1, 0.15, 0.3, DARK);
      r(0.4, 0.15, 0.2, 0.5, colour);
      break;
    case 'gloves':
      r(0.1, 0.2, 0.35, 0.55, LEATHER);
      r(0.55, 0.2, 0.35, 0.55, LEATHER);
      r(0.1, 0.7, 0.35, 0.12, colour);
      r(0.55, 0.7, 0.35, 0.12, colour);
      break;
    case 'boots':
      r(0.12, 0.15, 0.22, 0.6, LEATHER);
      r(0.12, 0.65, 0.38, 0.18, LEATHER);
      r(0.56, 0.15, 0.22, 0.6, LEATHER);
      r(0.56, 0.65, 0.38, 0.18, LEATHER);
      r(0.12, 0.15, 0.22, 0.1, colour);
      r(0.56, 0.15, 0.22, 0.1, colour);
      break;
    case 'amulet':
      r(0.2, 0.1, 0.1, 0.4, METAL);
      r(0.7, 0.1, 0.1, 0.4, METAL);
      r(0.3, 0.45, 0.4, 0.4, colour);
      break;
    case 'ring':
      r(0.2, 0.25, 0.6, 0.6, METAL);
      r(0.35, 0.4, 0.3, 0.3, PALETTE.ink);
      r(0.35, 0.1, 0.3, 0.2, colour);
      break;
    case 'belt':
      r(0.05, 0.3, 0.9, 0.4, LEATHER);
      r(0.4, 0.2, 0.2, 0.6, colour);
      break;
    case 'gem':
      r(0.3, 0.15, 0.4, 0.7, colour);
      r(0.15, 0.3, 0.7, 0.4, colour);
      r(0.35, 0.25, 0.15, 0.15, PALETTE.white);
      break;
    case 'orb':
    default:
      r(0.25, 0.15, 0.5, 0.7, colour);
      r(0.15, 0.25, 0.7, 0.5, colour);
      r(0.3, 0.25, 0.15, 0.15, PALETTE.white);
      if (short && w >= 18) p.text(x + 1, y + h - 8, short.slice(0, Math.floor(w / 6)), PALETTE.ink);
      break;
  }
}
