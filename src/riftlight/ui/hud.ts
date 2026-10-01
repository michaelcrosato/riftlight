/**
 * The in-game HUD, drawn on the pixel Hud every frame from a plain model the shell fills:
 * life and mana orbs (wobbling liquid), the energy-shield ring, the XP bar with a level-up
 * flash, the skill bar (4 skills + attack + dodge) with cooldown sweeps and costs, buffs,
 * the boss bar with phase ticks, the minimap, gold, the loot feed, the level card, the kill
 * streak counter and the difficulty corner.
 */
import type { HudColor, PaletteColor } from '../../engine';
import type { BossView, BuffView, SkillSlotView, Vitals } from '../game/ports';
import { UI, type UiCanvas } from './kit';

export interface FeedLine {
  text: string;
  color: PaletteColor;
  t: number;
}

export interface MinimapModel {
  width: number;
  height: number;
  cell(x: number, z: number): number;
  explored: Uint8Array;
  hero: { x: number; z: number };
  exit: { x: number; z: number; open: boolean } | null;
  boss: { x: number; z: number } | null;
  /** World → cell offset (cells are 1 m). */
  origin: { x: number; z: number };
}

export interface HudModel {
  time: number;
  vitals: Vitals;
  /** Seconds since the last level-up (big = none recently). */
  levelUpAge: number;
  level: number;
  xp: number;
  skills: readonly SkillSlotView[];
  buffs: readonly BuffView[];
  boss: BossView | null;
  minimap: MinimapModel | null;
  gold: number;
  /** Gold counter roll-up target vs shown. */
  goldShown: number;
  feed: readonly FeedLine[];
  card: { title: string; subtitle: string; age: number } | null;
  streak: { count: number; age: number } | null;
  /** HUD-corner difficulty labels (only non-1.0 sliders). */
  difficulty: readonly string[];
  /** Hurt flash 0..1 (red screen edge). */
  hurt: number;
  levelLabel: string;
  timer: string | null;
  pad: boolean;
  progress: { killed: number; total: number } | null;
}

const ORB_R = 22;

/** One liquid orb: per-column fill with a travelling wave on the surface. */
function orb(ui: UiCanvas, cx: number, cy: number, frac: number, fill: PaletteColor, light: PaletteColor, dark: PaletteColor, t: number, wobble: number): void {
  const r = ORB_R;
  // frame
  for (let dy = -r - 2; dy <= r + 2; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, (r + 2) * (r + 2) - dy * dy)));
    ui.rect(cx - w, cy + dy, w * 2 + 1, 1, 'ink');
  }
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, (r + 1) * (r + 1) - dy * dy)));
    ui.rect(cx - w, cy + dy, w * 2 + 1, 1, 'slate');
  }
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    ui.rect(cx - w, cy + dy, w * 2 + 1, 1, 'ink');
  }
  // liquid, column by column
  const level = cy + r - Math.round(2 * r * Math.min(1, Math.max(0, frac)));
  for (let dx = -r; dx <= r; dx++) {
    const h = Math.floor(Math.sqrt(Math.max(0, r * r - dx * dx)));
    const wave = Math.round(Math.sin(dx * 0.32 + t * 3.1) * (1 + wobble * 2) + Math.sin(dx * 0.13 - t * 1.7) * (0.6 + wobble));
    const top = Math.max(cy - h, frac >= 0.999 ? cy - h : level + wave);
    const bottom = cy + h;
    if (top > bottom) continue;
    ui.rect(cx + dx, top, 1, bottom - top + 1, fill);
    if (top > cy - h) ui.rect(cx + dx, top, 1, 1, light);
    if (dx > r * 0.62) ui.rect(cx + dx, Math.max(top + 1, cy + 4), 1, Math.max(0, bottom - Math.max(top + 1, cy + 4)), dark);
  }
  // glass highlight
  ui.rect(cx - 12, cy - 15, 4, 2, 'white');
  ui.rect(cx - 15, cy - 12, 2, 4, 'white');
  ui.rect(cx - 10, cy - 13, 2, 1, 'mist');
}

/** Energy shield: a cyan ring segment around the life orb, clockwise from the top. */
function shieldRing(ui: UiCanvas, cx: number, cy: number, frac: number): void {
  if (frac <= 0) return;
  const R = ORB_R + 4;
  const steps = 72;
  for (let i = 0; i < steps * frac; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    ui.rect(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 2, 2, i % 6 === 0 ? 'white' : 'cyan');
  }
}

const SLOT = 20;

function skillSlot(ui: UiCanvas, x: number, y: number, s: SkillSlotView, key: string, pad: string, t: number): void {
  ui.rect(x - 1, y - 1, SLOT + 2, SLOT + 2, 'ink');
  ui.rect(x, y, SLOT, SLOT, s.id ? 'slate' : 'night');
  ui.rect(x + 1, y + 1, SLOT - 2, SLOT - 2, 'navy');
  if (s.icon && s.colors) ui.sprite(x + 2, y + 4, s.icon, s.colors as Record<string, HudColor>, 2);
  else if (s.id) ui.text(x + SLOT / 2, y + 7, s.name.slice(0, 2).toUpperCase(), { align: 'center' });
  // cooldown sweep: a dark shutter that drops away
  if (s.remaining > 0 && s.cooldown > 0) {
    const h = Math.ceil((SLOT - 2) * Math.min(1, s.remaining / s.cooldown));
    for (let row = 0; row < h; row++) ui.rect(x + 1, y + 1 + row, SLOT - 2, 1, (row & 1) === 0 ? 'ink' : 'night');
    ui.mini(x + SLOT / 2, y + 8, s.remaining >= 1 ? String(Math.ceil(s.remaining)) : (Math.ceil(s.remaining * 10) / 10).toFixed(1).slice(1), 'white', 'center', 'ink');
  } else if (!s.usable) {
    for (let row = 0; row < SLOT - 2; row += 2) ui.rect(x + 1, y + 1 + row, SLOT - 2, 1, 'navy');
  } else if (s.remaining <= 0 && s.cooldown > 0 && t % 1 < 0.04) ui.outline(x, y, SLOT, SLOT, 'white');
  if (s.cost > 0) ui.mini(x + SLOT - 1, y + 1, String(s.cost), s.usable ? 'sky' : 'red', 'right', 'ink');
  ui.glyph(x + 1, y + SLOT - 4, key, pad);
}

export function drawHud(ui: UiCanvas, m: HudModel): void {
  const W = ui.w;
  const H = ui.h;
  const t = m.time;
  ui.pad = m.pad;

  // hurt flash: red corners
  if (m.hurt > 0.05) {
    const k = Math.ceil(m.hurt * 6);
    for (let i = 0; i < k; i++) {
      const c: PaletteColor = i < k / 2 ? 'red' : 'plum';
      ui.rect(0, i, W, 1, c);
      ui.rect(0, H - 1 - i, W, 1, c);
      ui.rect(i, 0, 1, H, c);
      ui.rect(W - 1 - i, 0, 1, H, c);
    }
  }

  // orbs
  const v = m.vitals;
  const lifeFrac = v.maxLife > 0 ? v.life / v.maxLife : 0;
  const low = lifeFrac < 0.3;
  const lx = 30;
  const ly = H - 30;
  orb(ui, lx, ly, lifeFrac, low && t % 0.6 < 0.3 ? 'orange' : 'red', 'orange', 'plum', t, low ? 1 : 0);
  shieldRing(ui, lx, ly, v.maxEs > 0 ? v.es / v.maxEs : 0);
  ui.mini(lx, ly + ORB_R + 3 - 33, `${Math.ceil(v.life)}`, 'white', 'center', 'ink');
  const mx = W - 30;
  orb(ui, mx, ly, v.maxMana > 0 ? v.mana / v.maxMana : 0, 'blue', 'sky', 'navy', t + 1.7, 0);
  ui.mini(mx, ly + ORB_R + 3 - 33, `${Math.floor(v.mana)}`, 'white', 'center', 'ink');

  // skill bar: attack, dodge, then the four skills
  const order: [string, string][] = [['LMB', 'A'], ['SPC', 'B'], ['1', 'X'], ['2', 'Y'], ['3', 'LB'], ['4', 'RB']];
  const slots = [m.skills.find((s) => s.slot === 'attack'), m.skills.find((s) => s.slot === 'dodge'), ...[0, 1, 2, 3].map((i) => m.skills.find((s) => s.slot === i))];
  const barW = slots.length * (SLOT + 3) + 6;
  const bx = Math.floor((W - barW) / 2) + 3;
  const by = H - SLOT - 7;
  ui.rect(bx - 5, by - 4, barW + 4, SLOT + 10, 'ink');
  ui.rect(bx - 4, by - 3, barW + 2, SLOT + 8, 'night');
  slots.forEach((s, i) => {
    const x = bx + i * (SLOT + 3) + (i >= 2 ? 6 : 0);
    if (s) skillSlot(ui, x, by, s, order[i]![0], order[i]![1], t);
    else {
      ui.rect(x, by, SLOT, SLOT, 'ink');
      ui.rect(x + 1, by + 1, SLOT - 2, SLOT - 2, 'night');
    }
  });
  // XP bar above the skill bar, flashing on a level-up
  const xw = barW + 2;
  const xx = bx - 4;
  const xy = by - 8;
  const flash = m.levelUpAge < 1.2 && Math.floor(m.levelUpAge * 10) % 2 === 0;
  ui.bar(xx, xy, xw, 3, m.xp, flash ? 'white' : UI.xp, 'night');
  for (let i = 1; i < 10; i++) ui.rect(xx + Math.round((xw * i) / 10), xy, 1, 3, 'ink');
  ui.text(xx - 3, xy - 2, `${m.level}`, { align: 'right', color: flash ? 'white' : 'sand' });

  // buffs above the life orb
  m.buffs.forEach((b, i) => {
    const x = 6 + i * 13;
    const y = H - 70;
    ui.rect(x, y, 11, 11, 'ink');
    ui.rect(x + 1, y + 1, 9, 9, b.debuff ? 'plum' : 'night');
    ui.rect(x + 3, y + 3, 5, 5, b.color);
    ui.rect(x + 1, y + 10, Math.round(9 * Math.max(0, b.remaining / b.duration)), 1, 'white');
    if (b.stacks && b.stacks > 1) ui.mini(x + 11, y - 2, String(b.stacks), 'white', 'right', 'ink');
  });

  // gold, top-right under the minimap
  const gy = m.minimap ? 74 : 6;
  ui.sprite(W - 66, gy, ['.ooo.', 'oyyyo', 'oywyo', 'oyyyo', '.ooo.'], { o: 'orange', y: 'sand', w: 'white' });
  ui.text(W - 58, gy - 1, String(Math.round(m.goldShown)), { color: 'sand' });

  // minimap
  if (m.minimap) drawMinimap(ui, m.minimap, W - 88, 4, 84, 64, t);

  // top-left: where you are, the clock, progress, difficulty
  ui.text(6, 6, m.levelLabel, { color: 'sand' });
  let ty = 16;
  if (m.timer) {
    ui.mini(6, ty, m.timer, 'mist');
    ty += 7;
  }
  if (m.progress && m.progress.total > 0) {
    ui.mini(6, ty, `${m.progress.killed}/${m.progress.total} SLAIN`, m.progress.killed >= m.progress.total ? 'lime' : 'mist');
    ty += 7;
  }
  if (m.difficulty.length) {
    ty += 2;
    ui.mini(6, ty, 'TUNED', 'orange');
    ty += 7;
    for (const d of m.difficulty) {
      ui.mini(6, ty, d, 'orange');
      ty += 6;
    }
  }

  // boss bar
  if (m.boss) {
    const bw = 200;
    const x = Math.floor((W - bw) / 2);
    const y = 18;
    ui.text(W / 2, y - 11, m.boss.name.toUpperCase(), { align: 'center', color: 'orange' });
    ui.bar(x, y, bw, 5, m.boss.life / m.boss.maxLife, 'red', 'plum');
    for (const p of m.boss.phases) ui.rect(x + Math.round(bw * p), y - 2, 1, 9, 'white');
    for (let i = 0; i <= m.boss.phase; i++) ui.rect(x + bw + 4 + i * 5, y, 3, 5, 'orange');
  }

  // loot feed (right, above the mana orb)
  m.feed.forEach((f, i) => {
    if (f.t > 4) return;
    const y = H - 66 - i * 9;
    const blink = f.t < 0.15;
    ui.text(W - 6, y, f.text, { align: 'right', color: blink ? 'white' : f.t > 3.4 ? 'slate' : f.color });
  });

  // kill streak
  if (m.streak && m.streak.count >= 3 && m.streak.age < 3) {
    const s = m.streak.age < 0.12 ? 3 : 2;
    const x = 8;
    const y = Math.floor(H / 2) - 20;
    ui.text(x, y, `${m.streak.count}`, { scale: s, color: m.streak.count >= 10 ? 'orange' : 'sand' });
    ui.text(x, y + 8 * s, m.streak.count >= 10 ? 'RAMPAGE' : m.streak.count >= 6 ? 'SLAUGHTER' : 'STREAK', { color: m.streak.age > 2.5 ? 'slate' : 'white' });
  }

  // level name card
  if (m.card && m.card.age < 4) {
    const a = m.card.age;
    const y = 30;
    const w = Math.min(ui.measure(m.card.title, 2) + 30, W - 20);
    const open = Math.min(1, a / 0.25) * Math.min(1, (4 - a) / 0.4);
    const ww = Math.round(w * open);
    ui.rect(W / 2 - ww / 2, y - 6, ww, 34, 'ink');
    ui.rect(W / 2 - ww / 2, y - 6, ww, 1, 'sand');
    ui.rect(W / 2 - ww / 2, y + 27, ww, 1, 'sand');
    if (open > 0.9) {
      ui.text(W / 2, y, m.card.title, { align: 'center', scale: 2, color: 'sand', shadow: 'plum' });
      ui.text(W / 2, y + 17, m.card.subtitle.toUpperCase(), { align: 'center', color: 'mist' });
    }
  }

  // level-up toast + tree hint
  if (m.levelUpAge < 4) {
    const y = 96;
    ui.text(W / 2, y, `LEVEL ${m.level}!`, { align: 'center', scale: 2, color: m.levelUpAge % 0.3 < 0.15 && m.levelUpAge < 1 ? 'white' : 'lime', shadow: 'green' });
    ui.prompt(W / 2, y + 18, 'P', 'START', 'FOR THE PASSIVE TREE', 'mist', 'center');
  }
}

function drawMinimap(ui: UiCanvas, mm: MinimapModel, x: number, y: number, w: number, h: number, t: number): void {
  ui.rect(x - 2, y - 2, w + 4, h + 4, 'ink');
  ui.rect(x - 1, y - 1, w + 2, h + 2, 'slate');
  ui.rect(x, y, w, h, 'ink');
  const S = 2; // art pixels per cell
  const cols = Math.floor(w / S);
  const rows = Math.floor(h / S);
  const hx = mm.hero.x - mm.origin.x;
  const hz = mm.hero.z - mm.origin.z;
  const x0 = Math.floor(hx - cols / 2);
  const z0 = Math.floor(hz - rows / 2);
  // run-length rows: one rect per run of the same colour
  for (let r = 0; r < rows; r++) {
    const cz = z0 + r;
    let run: HudColor | null = null;
    let start = 0;
    const flush = (end: number) => {
      if (run) ui.rect(x + start * S, y + r * S, (end - start) * S, S, run);
    };
    for (let c = 0; c <= cols; c++) {
      const cx = x0 + c;
      let color: HudColor | null = null;
      if (c < cols && cx >= 0 && cz >= 0 && cx < mm.width && cz < mm.height && mm.explored[cz * mm.width + cx]) {
        const v = mm.cell(cx, cz);
        color = v === 1 ? 'night' : v === 2 ? 'mist' : null;
      }
      if (color !== run) {
        flush(c);
        run = color;
        start = c;
      }
    }
  }
  const dot = (wx: number, wz: number, color: HudColor, size = 3, always = false) => {
    const px = x + Math.round((wx - mm.origin.x - x0) * S);
    const pz = y + Math.round((wz - mm.origin.z - z0) * S);
    const inside = px >= x && pz >= y && px < x + w - 1 && pz < y + h - 1;
    if (!inside && !always) return;
    const cx = Math.max(x, Math.min(x + w - size, px - (size >> 1)));
    const cz = Math.max(y, Math.min(y + h - size, pz - (size >> 1)));
    ui.rect(cx, cz, size, size, color);
  };
  if (mm.exit) {
    const ex = Math.floor(mm.exit.x - mm.origin.x);
    const ez = Math.floor(mm.exit.z - mm.origin.z);
    const seen = ex >= 0 && ez >= 0 && ex < mm.width && ez < mm.height && mm.explored[ez * mm.width + ex];
    if (seen || mm.exit.open) dot(mm.exit.x, mm.exit.z, mm.exit.open ? (t % 0.8 < 0.4 ? 'cyan' : 'white') : 'sky', 4, mm.exit.open);
  }
  if (mm.boss) dot(mm.boss.x, mm.boss.z, t % 0.6 < 0.3 ? 'red' : 'orange', 4, true);
  dot(mm.hero.x, mm.hero.z, 'white', 3, true);
}
