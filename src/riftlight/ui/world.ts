/**
 * HUD overlays anchored to the world: floating damage numbers, speech bubbles, interaction
 * prompts, loot labels, dev hitboxes. Positions are projected through the live camera to
 * art pixels every frame.
 */
import { type Camera, Vector3 } from 'three/webgpu';
import type { PaletteColor } from '../../engine';
import type { ControlAction } from '../game/controls';
import { clip, type UiCanvas, wrap } from './kit';
import type { Box, HudLayout } from './layout';

const v = new Vector3();

/** World → art pixels (null when behind the camera). */
export function project(p: Vector3, camera: Camera, ui: UiCanvas, out = { x: 0, y: 0 }): { x: number; y: number } | null {
  v.copy(p).project(camera);
  if (v.z > 1) return null;
  out.x = Math.round(((v.x + 1) / 2) * ui.w);
  out.y = Math.round(((1 - v.y) / 2) * ui.h);
  return out;
}

const head = new Vector3();

/**
 * A thing standing in the world (a townsperson, the stash, the portal) as a box on screen, art
 * pixels: from its feet at `at` to `height` m above, `width` m across (at least 8 × 10 pixels, a
 * mouse's target); null behind the camera.
 */
export function worldBox(at: Vector3, height: number, width: number, camera: Camera, ui: UiCanvas): { x: number; y: number; w: number; h: number } | null {
  const feet = project(at, camera, ui, { x: 0, y: 0 });
  const top = project(head.copy(at).setY(at.y + height), camera, ui, { x: 0, y: 0 });
  if (!feet || !top) return null;
  const h = Math.max(10, feet.y - top.y);
  const w = Math.max(8, Math.round((h * width) / height));
  return { x: Math.round(feet.x - w / 2), y: feet.y - h, w, h };
}

/**
 * The thing the mouse is over: what a click does there ("Talk to Brann") after the control that
 * clicks (the mouse's left button), on a plate over its head, placed around the HUD: above the
 * thing, else under it (near the top of the screen), else the first free row from the top down
 * (under the place name); never over the HUD's text. Returns where it went.
 */
export function thingLabel(ui: UiCanvas, box: { x: number; y: number; w: number; h: number }, text: string, action: ControlAction, layout?: HudLayout): Box {
  const label = clip(text, ui.w - 16 - ui.glyphWidth(action), (s) => ui.measure(s));
  const w = ui.glyphWidth(action) + 3 + ui.measure(label) + 8;
  const x = Math.max(1, Math.min(ui.w - w - 1, Math.round(box.x + box.w / 2 - w / 2)));
  const above = { x, y: box.y - 14, w, h: 12 };
  const r = !layout
    ? above
    : (layout.place(above, { tries: 8, step: 12 }) ??
      layout.place({ x, y: Math.max(1, box.y + box.h + 3), w, h: 12 }, { dir: 1, tries: 8, step: 12 }) ??
      layout.place({ x, y: 1, w, h: 12 }, { dir: 1, tries: Math.floor(ui.h / 12), step: 12 }) ??
      above);
  ui.rect(r.x, r.y, r.w, r.h, 'night');
  ui.outline(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 'white');
  ui.prompt(r.x + 4, r.y + 3, action, label, 'white');
  return r;
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

  /** The numbers on screen as data (save-states). */
  save(): (Omit<Floater, 'at'> & { at: readonly number[] })[] {
    return this.list.map((f) => ({ ...f, at: f.at.toArray() }));
  }

  load(list: readonly (Omit<Floater, 'at'> & { at: readonly number[] })[]): void {
    this.list.length = 0;
    for (const f of list) this.list.push({ ...f, at: new Vector3().fromArray(f.at) });
  }
}

/**
 * A speech bubble with a tail, above a point. With the HUD's `layout` it is placed through it
 * (nudged up off what is there, else skipped this frame); returns where it went, or null.
 */
export function bubble(ui: UiCanvas, camera: Camera, at: Vector3, text: string, age: number, layout?: HudLayout): Box | null {
  const p = project(at, camera, ui);
  if (!p) return null;
  const lines = wrap(text, 120);
  const w = Math.max(...lines.map((l) => ui.measure(l))) + 8;
  const h = lines.length * 9 + 5;
  // pop in
  const k = Math.min(1, age / 0.12);
  const x = Math.round(Math.max(2, Math.min(ui.w - w - 2, p.x - w / 2)));
  let y = Math.round(p.y - h - 6 + (1 - k) * 4);
  // through the HUD's layout (`HudLayout`), its tail with it: nudged up a little off what is there
  // (the HUD, the prompt, a bubble placed before it), else not drawn this frame
  if (layout) {
    const spot = layout.place({ x, y, w, h: h + 3 }, { dir: -1, step: 4, tries: 3 });
    if (!spot) return null;
    y = spot.y;
  }
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
  return { x, y, w, h: h + 3 };
}

/** "[F] Talk to Brann" over a point: the glyph of the control that does `action`, then the label. */
export function promptAt(ui: UiCanvas, camera: Camera, at: Vector3, action: ControlAction, label: string, sub?: string): void {
  const p = project(at, camera, ui);
  if (!p) return;
  const w = ui.prompt(-1000, -1000, action, label); // measure
  const x = Math.round(p.x - w / 2);
  ui.rect(x - 3, p.y - 3, w + 6, sub ? 21 : 12, 'ink');
  ui.prompt(x, p.y, action, label, 'white');
  if (sub) ui.text(p.x, p.y + 9, sub, { align: 'center', color: 'mist' });
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
  const label = clip(text, ui.w - 10, (s) => ui.measure(s));
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

/**
 * The way-out arrow, art pixels: a head `head` long and `half` either side at its base, on a stem
 * `stem` long (an arrow, so it reads as pointing whichever way it turns).
 */
const ARROW = { head: 9, half: 5, stem: 6, stemHalf: 1 } as const;
const ARROW_LENGTH = ARROW.head + ARROW.stem;

/** Screen margin a spot's mark keeps (art pixels): nearer the edge, the arrow shows instead. */
const BEACON_MARGIN = 18;

/** The points of an arrow with its tip at (tx, ty) pointing along (dx, dy): rows across it, tip first. */
function arrowPoints(tx: number, ty: number, dx: number, dy: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let s = 0; s <= ARROW_LENGTH; s++) {
    const half = s <= ARROW.head ? (s * ARROW.half) / ARROW.head : ARROW.stemHalf;
    for (let t = -half; t <= half + 1e-6; t += 1) out.push({ x: Math.round(tx - dx * s - dy * t), y: Math.round(ty - dy * s + dx * t) });
  }
  return out;
}

/** The box an arrow with its tip at (tx, ty) covers while it bobs (up to 4 px back along it), its ink edge included. */
function arrowBox(tx: number, ty: number, dx: number, dy: number): Box {
  const across = (s: number, half: number) => [-1, 1].flatMap((side) => [0, 4].map((back) => ({ x: tx - dx * (s + back) - dy * side * half, y: ty - dy * (s + back) + dx * side * half })));
  const ends = [...across(0, 0), ...across(ARROW.head, ARROW.half), ...across(ARROW_LENGTH, ARROW.stemHalf)];
  const x0 = Math.floor(Math.min(...ends.map((e) => e.x))) - 1;
  const y0 = Math.floor(Math.min(...ends.map((e) => e.y))) - 1;
  return { x: x0, y: y0, w: Math.ceil(Math.max(...ends.map((e) => e.x))) + 3 - x0, h: Math.ceil(Math.max(...ends.map((e) => e.y))) + 3 - y0 };
}

/**
 * A spot to get to (a moment's escape). On screen, a ring on the ground (breathing) with a chevron
 * bobbing over it; off screen (or with its chevron under the HUD), an arrowhead pointing the way:
 * at the screen's edge toward the spot (or beside the HUD over it), stepped in toward the centre
 * until it is clear of the HUD's zones (`layout`). The chevron or the arrow takes its place in the
 * layout, so labels and damage numbers keep off it: place it before them. Drawn in art pixels with
 * an ink edge, big enough to read from across a room.
 */
export function beacon(ui: UiCanvas, camera: Camera, at: Vector3, radius: number, color: PaletteColor, time: number, layout?: HudLayout): void {
  const p = project(at, camera, ui, { x: 0, y: 0 });
  if (!p) return;
  const m = BEACON_MARGIN;
  if (p.x >= m && p.x <= ui.w - m && p.y >= m && p.y <= ui.h - m) {
    for (const r of [radius, radius * (0.6 + 0.15 * Math.sin(time * 4))]) {
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const q = project(v.set(at.x + Math.cos(a) * r, at.y + 0.05, at.z + Math.sin(a) * r), camera, ui);
        if (q) ui.rect(q.x, q.y, 2, 1, color);
      }
    }
    // the chevron (its bob and ink edge in its box), when the HUD leaves it room
    const chevron = { x: p.x - 6, y: p.y - 25, w: 13, h: 11 };
    if (chevron.y >= 1 && (!layout || layout.free(chevron))) {
      layout?.reserve(chevron);
      const y = p.y - 22 + Math.round(Math.sin(time * 5) * 2);
      for (let i = 0; i < 5; i++) ui.rect(p.x - 6 + i, y + i - 1, 13 - i * 2, 2, 'ink');
      ui.rect(p.x - 1, y + 5, 3, 1, 'ink');
      for (let i = 0; i < 5; i++) ui.rect(p.x - 5 + i, y + i, 11 - i * 2, 1, color);
      return;
    }
  }
  const cx = ui.w / 2;
  const cy = ui.h / 2;
  const d = Math.hypot(p.x - cx, p.y - cy) || 1;
  const dx = (p.x - cx) / d;
  const dy = (p.y - cy) / d;
  // the tip at the screen's edge toward the spot (at the spot itself when that is nearer), then in
  // toward the centre, 2 px a step, until the arrow is clear of the HUD
  const edge = Math.min((cx - m) / Math.max(1e-6, Math.abs(dx)), (cy - m) / Math.max(1e-6, Math.abs(dy)));
  const from = Math.min(d, edge);
  let k = from;
  if (layout) {
    let clear: number | null = null;
    for (let kk = from; kk >= ARROW_LENGTH + 8 && clear === null; kk -= 2) if (layout.free(arrowBox(cx + dx * kk, cy + dy * kk, dx, dy))) clear = kk;
    if (clear !== null) {
      k = clear;
      layout.reserve(arrowBox(cx + dx * k, cy + dy * k, dx, dy));
    }
  }
  const bob = (Math.sin(time * 6) - 1) * 2; // in toward the centre and back
  const points = arrowPoints(cx + dx * (k + bob), cy + dy * (k + bob), dx, dy);
  for (const q of points) ui.rect(q.x - 1, q.y - 1, 4, 4, 'ink');
  for (const q of points) ui.rect(q.x, q.y, 2, 2, color);
}
