/**
 * HUD overlays anchored to the world: floating damage numbers, speech bubbles, interaction
 * prompts, loot labels, dev hitboxes. Positions are projected through the live camera to
 * art pixels every frame.
 */
import { type Camera, Vector3 } from 'three/webgpu';
import type { PaletteColor } from '../../engine';
import { type UiCanvas, wrap } from './kit';
import type { HudLayout } from './layout';

const v = new Vector3();

/** World → art pixels (null when behind the camera). */
export function project(p: Vector3, camera: Camera, ui: UiCanvas, out = { x: 0, y: 0 }): { x: number; y: number } | null {
  v.copy(p).project(camera);
  if (v.z > 1) return null;
  out.x = Math.round(((v.x + 1) / 2) * ui.w);
  out.y = Math.round(((1 - v.y) / 2) * ui.h);
  return out;
}

export interface Floater {
  at: Vector3;
  text: string;
  color: PaletteColor;
  t: number;
  crit: boolean;
  dx: number;
  /** Merges quick hits on the same target (its actor id), with the running total. */
  key?: number;
  value?: number;
  /** Rows up from the anchor (numbers on one target stack instead of overlapping). */
  row: number;
}

/**
 * Damage numbers: pop, rise and step down through the palette, then blink out. Hits on one
 * target within a short window merge into one number that counts up (a whirlwind's ticks read
 * as one climbing total, not a pile); newer numbers on the same target stack a row higher, and
 * every number is placed around the HUD and the loot labels (`HudLayout`), so nothing is
 * drawn over a banner or a label. Crits are double size and always win their spot.
 */
export class Floaters {
  readonly list: Floater[] = [];
  /** Seconds a number keeps absorbing hits on the same target. */
  static readonly MERGE = 0.16;
  static readonly LIFE = 0.9;
  private readonly box = { x: 0, y: 0, w: 0, h: 0 };

  add(at: Vector3, text: string, color: PaletteColor, crit: boolean, dx: number, o: { key?: number; value?: number } = {}): void {
    if (o.key !== undefined && o.value !== undefined && !crit) {
      const same = this.list.find((f) => f.key === o.key && !f.crit && f.t < Floaters.MERGE && f.color === color);
      if (same) {
        same.value = (same.value ?? 0) + o.value;
        same.text = String(Math.round(same.value));
        same.t = Math.min(same.t, 0.04); // pop again
        return;
      }
    }
    // stack above the live numbers on the same target
    let row = 0;
    if (o.key !== undefined) for (const f of this.list) if (f.key === o.key && f.t < 0.45) row = Math.max(row, f.row + 1);
    if (this.list.length > 40) this.list.shift();
    this.list.push({ at: at.clone(), text, color, t: 0, crit, dx, key: o.key, value: o.value, row: row % 4 });
  }

  update(dt: number): void {
    for (const f of this.list) f.t += dt;
    while (this.list.length && this.list[0]!.t > Floaters.LIFE) this.list.shift();
  }

  draw(ui: UiCanvas, camera: Camera, layout?: HudLayout): void {
    // crits first (they get their spot), then newest first
    const order = [...this.list].sort((a, b) => Number(b.crit) - Number(a.crit) || a.t - b.t);
    for (const f of order) {
      const p = project(f.at, camera, ui);
      if (!p) continue;
      if (f.t > 0.75 && Math.floor(f.t * 30) % 2 === 1) continue; // blink out
      const pop = f.t < 0.06 ? 1 : 0;
      const rise = Math.round(Math.min(1, f.t * 6) * 8 + f.t * 14);
      const scale = (f.crit && f.t < 0.5) || pop ? 2 : 1;
      const color: PaletteColor = f.t > 0.62 ? 'slate' : f.t < 0.06 ? 'white' : f.color;
      const w = ui.measure(f.text, scale);
      const h = 7 * scale;
      const box = this.box;
      box.x = Math.round(p.x + f.dx * f.t * 16 - w / 2);
      box.y = p.y - 16 - rise - f.row * 9 - (scale - 1) * 4;
      box.w = w;
      box.h = h;
      const at = layout ? layout.place(box, { tries: 2, step: 8 }) : box;
      if (!at) continue;
      ui.text(at.x, at.y, f.text, { scale, color, shadow: 'ink' });
    }
  }

  clear(): void {
    this.list.length = 0;
  }
}

/** A speech bubble with a tail, above a point. */
export function bubble(ui: UiCanvas, camera: Camera, at: Vector3, text: string, age: number): void {
  const p = project(at, camera, ui);
  if (!p) return;
  const lines = wrap(text.toUpperCase(), 120);
  const w = Math.max(...lines.map((l) => ui.measure(l))) + 8;
  const h = lines.length * 9 + 5;
  // pop in
  const k = Math.min(1, age / 0.12);
  const x = Math.round(Math.max(2, Math.min(ui.w - w - 2, p.x - w / 2)));
  const y = Math.round(p.y - h - 6 + (1 - k) * 4);
  ui.rect(x + 1, y, w - 2, h, 'ink');
  ui.rect(x, y + 1, w, h - 2, 'ink');
  ui.rect(x + 1, y + 1, w - 2, h - 2, 'white');
  // tail
  const tx = Math.max(x + 4, Math.min(x + w - 6, p.x - 2));
  ui.rect(tx, y + h - 1, 5, 1, 'white');
  ui.rect(tx + 1, y + h, 3, 1, 'white');
  ui.rect(tx + 2, y + h + 1, 1, 1, 'white');
  ui.rect(tx - 1, y + h - 1, 1, 1, 'ink');
  ui.rect(tx + 5, y + h - 1, 1, 1, 'ink');
  ui.rect(tx, y + h, 1, 1, 'ink');
  ui.rect(tx + 4, y + h, 1, 1, 'ink');
  ui.rect(tx + 1, y + h + 1, 1, 1, 'ink');
  ui.rect(tx + 3, y + h + 1, 1, 1, 'ink');
  ui.rect(tx + 2, y + h + 2, 1, 1, 'ink');
  lines.forEach((l, i) => ui.text(x + 4, y + 3 + i * 9, l, { color: 'ink', shadow: false }));
}

/** "[F] TALK BRANN" over a point. */
export function promptAt(ui: UiCanvas, camera: Camera, at: Vector3, key: string, pad: string, label: string, sub?: string): void {
  const p = project(at, camera, ui);
  if (!p) return;
  const w = ui.prompt(-1000, -1000, key, pad, label); // measure
  const x = Math.round(p.x - w / 2);
  ui.rect(x - 3, p.y - 3, w + 6, sub ? 21 : 12, 'ink');
  ui.prompt(x, p.y, key, pad, label, 'white');
  if (sub) ui.text(p.x, p.y + 9, sub.toUpperCase(), { align: 'center', color: 'mist' });
}

/**
 * A loot label on the ground (rarity colour). The loot filter's tier frames `loud` drops
 * (uniques, valuable orbs) and greys `dim` ones. With a `HudLayout` it is placed around the
 * HUD, the banner and the labels already placed this frame (stepping up a row at a time), and
 * skipped when there is no room; the focused label should be placed first.
 */
export function lootLabel(
  ui: UiCanvas,
  camera: Camera,
  at: Vector3,
  text: string,
  color: PaletteColor,
  focus: boolean,
  tier: 'loud' | 'show' | 'dim' = 'show',
  layout?: HudLayout,
): { x: number; y: number; w: number; h: number } | null {
  const p = project(at, camera, ui);
  if (!p) return null;
  // a narrow screen (a phone) cuts long names
  let label = text;
  while (label.length > 6 && ui.measure(label) + 6 > ui.w - 4) label = label.slice(0, -2);
  if (label !== text) label = `${label.slice(0, -1)}.`;
  const w = ui.measure(label) + 6;
  const want = { x: Math.max(1, Math.min(ui.w - w - 1, Math.round(p.x - w / 2))), y: p.y - 14, w, h: 10 };
  const r = layout ? layout.place(want, { tries: focus ? 10 : 6, step: 11 }) : want;
  if (!r) return null;
  const { x, y } = r;
  ui.rect(x, y, w, 10, focus ? 'night' : 'ink');
  if (focus || tier === 'loud') ui.outline(x - 1, y - 1, w + 2, 12, focus ? 'white' : color);
  ui.text(x + 3, y + 2, label, { color: tier === 'dim' && !focus ? 'slate' : color, shadow: false });
  return { x, y, w, h: 10 };
}

/** Dev: a ring for an actor's radius. */
export function hitbox(ui: UiCanvas, camera: Camera, at: Vector3, radius: number, color: PaletteColor): void {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const p = project(v.set(at.x + Math.cos(a) * radius, at.y + 0.05, at.z + Math.sin(a) * radius), camera, ui);
    if (p) ui.rect(p.x, p.y, 1, 1, color);
  }
}
