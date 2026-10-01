/**
 * HUD overlays anchored to the world: floating damage numbers, speech bubbles, interaction
 * prompts, loot labels, dev hitboxes. Positions are projected through the live camera to
 * art pixels every frame.
 */
import { type Camera, Vector3 } from 'three/webgpu';
import type { PaletteColor } from '../../engine';
import { type UiCanvas, wrap } from './kit';

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
}

/** Damage numbers: pop, rise and step down through the palette. */
export class Floaters {
  readonly list: Floater[] = [];

  add(at: Vector3, text: string, color: PaletteColor, crit: boolean, dx: number): void {
    if (this.list.length > 40) this.list.shift();
    this.list.push({ at: at.clone(), text, color, t: 0, crit, dx });
  }

  update(dt: number): void {
    for (const f of this.list) f.t += dt;
    while (this.list.length && this.list[0]!.t > 0.9) this.list.shift();
  }

  draw(ui: UiCanvas, camera: Camera): void {
    for (const f of this.list) {
      const p = project(f.at, camera, ui);
      if (!p) continue;
      const rise = Math.round(f.t * 26);
      const scale = f.crit && f.t < 0.5 ? 2 : 1;
      const color: PaletteColor = f.t > 0.65 ? 'slate' : f.t < 0.08 ? 'white' : f.color;
      ui.text(p.x + Math.round(f.dx * f.t * 20), p.y - 14 - rise, f.text, { align: 'center', scale, color });
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

/** A loot label on the ground (rarity colour, bracketed). */
export function lootLabel(ui: UiCanvas, camera: Camera, at: Vector3, text: string, color: PaletteColor, focus: boolean): { x: number; y: number; w: number; h: number } | null {
  const p = project(at, camera, ui);
  if (!p) return null;
  const w = ui.measure(text) + 6;
  const x = Math.round(p.x - w / 2);
  const y = p.y - 14;
  ui.rect(x, y, w, 10, focus ? 'night' : 'ink');
  if (focus) ui.outline(x - 1, y - 1, w + 2, 12, color);
  ui.text(x + 3, y + 2, text, { color, shadow: false });
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
