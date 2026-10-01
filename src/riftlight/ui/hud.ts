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
import { type BannerKind, type Box, type HudLayout, overlaps } from './layout';

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
  /** The centre banner (level card, LEVEL CLEAR, level-up: `BannerQueue.current`). */
  card: { title: string; subtitle: string; age: number; kind?: BannerKind; duration?: number } | null;
  streak: { count: number; age: number } | null;
  /** HUD-corner difficulty labels (only non-1.0 sliders). */
  difficulty: readonly string[];
  /** Hurt flash 0..1 (red screen edge). */
  hurt: number;
  levelLabel: string;
  timer: string | null;
  pad: boolean;
  progress: { killed: number; total: number } | null;
  /** Touch controls on screen, in art pixels: the HUD drops its skill bar and lays out around them. */
  controls?: readonly Box[];
}

const ORB_R = 22;

/**
 * Where the fixed HUD goes on a screen of `W` × `H` art pixels. A narrow screen (a phone in
 * portrait is 124 wide) gets the compact set: small orbs above the corners of a tight bar, a
 * small minimap, a shorter boss bar.
 *
 * With touch controls on screen (`controls`: their rects in art pixels, `TouchPad.zones`) the
 * buttons are the skill bar, so the HUD draws none: each orb takes the lowest free spot in its
 * corner's third of the screen around the controls (beside the joystick and the button cluster
 * on a wide screen, above them on a phone in portrait), the XP bar runs between the orbs when
 * they share a row (else it sits over the life orb), and the top-left text starts right of
 * any control there (the ≡ button).
 */
export function hudGeometry(W: number, H: number, controls: readonly Box[] = []) {
  const compact = W < 300;
  const touch = controls.length > 0;
  const slot = compact ? 16 : 20;
  const gap = compact ? 2 : 3;
  const split = compact ? 2 : 6;
  const barW = 6 * (slot + gap) + split;
  const bx = Math.floor((W - barW) / 2) + 3;
  const by = H - slot - (compact ? 5 : 7);
  const orbR = compact ? 12 : ORB_R;
  const orbY = compact ? by - 12 - orbR : H - 30;
  const orbX = compact ? orbR + 4 : 30;
  const map = compact ? { w: 44, h: 34 } : { w: 84, h: 64 };
  const bossW = Math.min(200, W - 30);
  let life = { x: orbX, y: orbY };
  let mana = { x: W - orbX, y: orbY };
  /** The XP bar, and where the level number goes. */
  let xp = { x: bx - 4, y: by - 8, w: barW + 2 };
  let levelAt: { x: number; y: number; mini: boolean; align: 'right' | 'center' } = compact
    ? { x: xp.x + xp.w / 2, y: xp.y - 7, mini: true, align: 'center' }
    : { x: xp.x - 3, y: xp.y - 2, mini: false, align: 'right' };
  let textX = compact ? 4 : 6;
  /** The top of the bottom HUD: prompts and the loot feed go above it. */
  let top = compact ? orbY - orbR : H - 52;
  /** The buff row (above the life orb). */
  let buffs = { x: 6, y: compact ? orbY - orbR - 16 : H - 70 };
  if (touch) {
    const size = orbR * 2 + 5; // the orb and its frame
    const l = lowestSpot(W, H, controls, 'left', size);
    const m = lowestSpot(W, H, controls, 'right', size);
    life = { x: l.x + orbR + 2, y: l.y + orbR + 2 };
    mana = { x: m.x + orbR + 2, y: m.y + orbR + 2 };
    const between = m.x - (l.x + size) - 8;
    if (Math.abs(l.y - m.y) <= 4 && between >= 40) {
      // one row (a wide screen): the XP bar between the orbs, near their bottom
      xp = { x: l.x + size + 4, y: Math.max(l.y, m.y) + size - 6, w: between };
      levelAt = { x: xp.x + xp.w / 2, y: xp.y - 7, mini: true, align: 'center' };
    } else {
      // a phone in portrait: a short bar with the level over the life orb
      xp = { x: l.x, y: l.y - 5, w: size };
      levelAt = { x: l.x + size / 2, y: l.y - 12, mini: true, align: 'center' };
    }
    top = Math.min(life.y - orbR, mana.y - orbR, levelAt.y);
    buffs = { x: Math.max(2, l.x), y: Math.min(l.y, levelAt.y) - 14 };
    // the top-left text starts right of a control in that corner (the ≡ button)
    for (const c of controls) if (c.y < 24 && c.x < W / 3) textX = Math.max(textX, c.x + c.w + 3);
  }
  return { compact, touch, slot, gap, split, barW, bx, by, orbR, orbY, orbX, life, mana, xp, levelAt, textX, top, buffs, map, bossW };
}

/**
 * The lowest spot for a `size`-square box in one corner third of the screen that touches no
 * control, nearest the corner on ties (a spot has to be 6 px lower to beat one nearer the
 * corner). Returns the box's top-left.
 */
function lowestSpot(W: number, H: number, controls: readonly Box[], side: 'left' | 'right', size: number): { x: number; y: number } {
  const m = 3;
  const span = Math.max(0, Math.floor(W / 3) - size - m);
  let best: { x: number; y: number } | null = null;
  for (let k = 0; k <= span; k += 2) {
    const x = side === 'left' ? m + k : W - m - size - k;
    let y = H - m - size;
    for (let guard = 0; guard < 24 && y >= 0; guard++) {
      const hit = controls.find((c) => overlaps({ x, y, w: size, h: size }, c, 2));
      if (!hit) break;
      y = hit.y - 3 - size;
    }
    if (y < 0) continue;
    if (!best || y > best.y + 6) best = { x, y };
  }
  return best ?? { x: side === 'left' ? m : W - m - size, y: Math.floor(H / 2) };
}

/**
 * The zones the fixed HUD covers for this model: world overlays (loot labels, damage numbers)
 * are placed around them (`HudLayout`). Matches what `drawHud` draws; touch controls count too.
 */
export function hudZones(W: number, H: number, m: HudModel): Box[] {
  const g = hudGeometry(W, H, m.controls);
  const z: Box[] = [];
  if (g.touch) {
    z.push(...(m.controls ?? []));
    z.push({ x: g.xp.x - 2, y: g.levelAt.y - 1, w: g.xp.w + 4, h: g.xp.y + 4 - g.levelAt.y + 1 });
  } else z.push({ x: g.bx - 6, y: g.by - 14, w: g.barW + 6, h: H - g.by + 14 }); // bar + XP
  for (const o of [g.life, g.mana]) z.push({ x: o.x - g.orbR - 3, y: o.y - g.orbR - 3, w: g.orbR * 2 + 7, h: g.orbR * 2 + 7 });
  if (m.minimap) z.push({ x: W - g.map.w - 6, y: 2, w: g.map.w + 6, h: g.map.h + 18 });
  z.push({ x: g.textX - 2, y: 4, w: Math.min(W / 2, 90), h: 12 + (m.timer ? 7 : 0) + (m.progress ? 7 : 0) });
  if (m.boss) z.push({ x: Math.floor((W - g.bossW) / 2) - 2, y: 5, w: g.bossW + 20, h: 20 });
  const b = bannerRect(W, m);
  if (b) z.push(b);
  return z;
}

/** The banner's rect (null when none shows). */
function bannerRect(W: number, m: HudModel): Box | null {
  const c = m.card;
  if (!c || c.age < 0 || c.age >= (c.duration ?? 4)) return null;
  const big = (c.kind ?? 'card') !== 'levelup' && W >= 300;
  // a phone: under the minimap and the level label
  const y = W < 300 ? (m.boss ? 60 : 50) : m.boss ? 34 : big ? 24 : 26;
  const h = big ? 34 : 22;
  const w = Math.min(W - 8, big ? 280 : 200);
  return { x: Math.floor((W - w) / 2), y, w, h };
}

/** One liquid orb: per-column fill with a travelling wave on the surface. */
function orb(ui: UiCanvas, cx: number, cy: number, frac: number, fill: PaletteColor, light: PaletteColor, dark: PaletteColor, t: number, wobble: number, r = ORB_R): void {
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
  const k = r / ORB_R;
  ui.rect(cx - Math.round(12 * k), cy - Math.round(15 * k), Math.max(2, Math.round(4 * k)), 2, 'white');
  ui.rect(cx - Math.round(15 * k), cy - Math.round(12 * k), 2, Math.max(2, Math.round(4 * k)), 'white');
  if (r >= 16) ui.rect(cx - 10, cy - 13, 2, 1, 'mist');
}

/**
 * Mana reserved by auras: the top of the mana orb is sealed off (a dark hatch with a bright rim
 * at its edge), so the liquid can only fill what is left.
 */
function reservedCap(ui: UiCanvas, cx: number, cy: number, frac: number, r = ORB_R): void {
  if (frac <= 0.001) return;
  const edge = cy - r + Math.round(2 * r * Math.min(1, frac));
  for (let dy = -r; cy + dy < edge; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (w <= 0) continue;
    ui.rect(cx - w, cy + dy, w * 2 + 1, 1, 'ink');
    // diagonal hatch
    for (let x = -w; x <= w; x++) if ((x + dy) % 4 === 0) ui.rect(cx + x, cy + dy, 1, 1, 'navy');
  }
  const ey = edge - cy;
  const ew = Math.floor(Math.sqrt(Math.max(0, r * r - ey * ey)));
  if (ew > 0) ui.rect(cx - ew, edge, ew * 2 + 1, 1, 'sky');
}

/** Energy shield: a cyan ring segment around the life orb, clockwise from the top. */
function shieldRing(ui: UiCanvas, cx: number, cy: number, frac: number, r = ORB_R): void {
  if (frac <= 0) return;
  const R = r + 4;
  const steps = 72;
  for (let i = 0; i < steps * frac; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
    ui.rect(Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 2, 2, i % 6 === 0 ? 'white' : 'cyan');
  }
}

function skillSlot(ui: UiCanvas, x: number, y: number, s: SkillSlotView, key: string, pad: string, t: number, SLOT = 20): void {
  ui.rect(x - 1, y - 1, SLOT + 2, SLOT + 2, 'ink');
  ui.rect(x, y, SLOT, SLOT, s.id ? 'slate' : 'night');
  ui.rect(x + 1, y + 1, SLOT - 2, SLOT - 2, 'navy');
  if (s.icon && s.colors) {
    const iw = Math.max(...s.icon.map((r) => r.length));
    const sc = iw * 2 <= SLOT - 4 ? 2 : 1;
    ui.sprite(x + Math.floor((SLOT - iw * sc) / 2), y + Math.floor((SLOT - s.icon.length * sc) / 2), s.icon, s.colors as Record<string, HudColor>, sc);
  }
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
  if (key) ui.glyph(x + 1, y + SLOT - 4, key, pad);
}

export function drawHud(ui: UiCanvas, m: HudModel, layout?: HudLayout): void {
  const W = ui.w;
  const H = ui.h;
  const t = m.time;
  ui.pad = m.pad;
  const g = hudGeometry(W, H, m.controls);
  const SLOT = g.slot;

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
  const lx = g.life.x;
  const ly = g.life.y;
  const r = g.orbR;
  orb(ui, lx, ly, lifeFrac, low && t % 0.6 < 0.3 ? 'orange' : 'red', 'orange', 'plum', t, low ? 1 : 0, r);
  shieldRing(ui, lx, ly, v.maxEs > 0 ? v.es / v.maxEs : 0, r);
  ui.mini(lx, ly + r + 3 - (g.compact ? 18 : 33), `${Math.ceil(v.life)}`, 'white', 'center', 'ink');
  const mx = g.mana.x;
  const my = g.mana.y;
  orb(ui, mx, my, v.maxMana > 0 ? v.mana / v.maxMana : 0, 'blue', 'sky', 'navy', t + 1.7, 0, r);
  reservedCap(ui, mx, my, v.maxMana > 0 ? (v.reserved ?? 0) / v.maxMana : 0, r);
  ui.mini(mx, my + r + 3 - (g.compact ? 18 : 33), `${Math.floor(v.mana)}`, 'white', 'center', 'ink');

  // skill bar: attack, dodge, then the four skills (on a touch screen the buttons are the bar)
  if (!g.touch) {
    const order: [string, string][] = [['LMB', 'A'], ['SPC', 'B'], ['1', 'X'], ['2', 'Y'], ['3', 'LB'], ['4', 'RB']];
    const slots = [m.skills.find((s) => s.slot === 'attack'), m.skills.find((s) => s.slot === 'dodge'), ...[0, 1, 2, 3].map((i) => m.skills.find((s) => s.slot === i))];
    const barW = g.barW;
    const bx = g.bx;
    const by = g.by;
    ui.rect(bx - 5, by - 4, barW + 4, SLOT + 10, 'ink');
    ui.rect(bx - 4, by - 3, barW + 2, SLOT + 8, 'night');
    slots.forEach((s, i) => {
      const x = bx + i * (SLOT + g.gap) + (i >= 2 ? g.split : 0);
      if (s) skillSlot(ui, x, by, s, g.compact ? '' : order[i]![0], g.compact ? '' : order[i]![1], t, SLOT);
      else {
        ui.rect(x, by, SLOT, SLOT, 'ink');
        ui.rect(x + 1, by + 1, SLOT - 2, SLOT - 2, 'night');
      }
    });
  }
  // XP bar (above the skill bar; between or over the orbs on a touch screen), flashing on a level-up
  const { x: xx, y: xy, w: xw } = g.xp;
  const flash = m.levelUpAge < 1.2 && Math.floor(m.levelUpAge * 10) % 2 === 0;
  ui.bar(xx, xy, xw, 3, m.xp, flash ? 'white' : UI.xp, 'night');
  for (let i = 1; i < 10; i++) ui.rect(xx + Math.round((xw * i) / 10), xy, 1, 3, 'ink');
  const lv = g.levelAt;
  if (lv.mini) ui.mini(lv.x, lv.y, `LV ${m.level}`, flash ? 'white' : 'sand', lv.align, 'ink');
  else ui.text(lv.x, lv.y, `${m.level}`, { align: lv.align, color: flash ? 'white' : 'sand' });

  // buffs above the life orb
  m.buffs.forEach((b, i) => {
    const x = g.buffs.x + i * 13;
    const y = g.buffs.y;
    ui.rect(x, y, 11, 11, 'ink');
    ui.rect(x + 1, y + 1, 9, 9, b.debuff ? 'plum' : 'night');
    ui.rect(x + 3, y + 3, 5, 5, b.color);
    ui.rect(x + 1, y + 10, Math.round(9 * Math.max(0, b.remaining / b.duration)), 1, 'white');
    if (b.stacks && b.stacks > 1) ui.mini(x + 11, y - 2, String(b.stacks), 'white', 'right', 'ink');
  });

  // minimap, gold under it (top-right); the counter glows while it rolls up
  const mw = g.map.w;
  if (m.minimap) drawMinimap(ui, m.minimap, W - mw - 4, 4, mw, g.map.h, t);
  const gy = m.minimap ? g.map.h + 10 : 6;
  const gold = String(Math.round(m.goldShown));
  const gw = ui.measure(gold) + 8;
  ui.sprite(W - 6 - gw, gy, ['.ooo.', 'oyyyo', 'oywyo', 'oyyyo', '.ooo.'], { o: 'orange', y: 'sand', w: 'white' });
  ui.text(W - 6, gy - 1, gold, { color: m.goldShown < m.gold - 0.5 ? 'white' : 'sand', align: 'right' });

  // top-left: where you are, the clock, progress, difficulty
  // (right of the touch menu button, and cut short of the minimap)
  const tx = g.textX;
  const room = W - tx - (m.minimap ? g.map.w + 10 : 6);
  let label = m.levelLabel;
  if (g.compact) {
    while (label.length > 3 && label.length * 4 - 1 > room) label = label.slice(0, -1);
    ui.mini(tx, 5, label, 'sand', 'left', 'ink');
  } else ui.text(tx, 6, label, { color: 'sand' });
  let ty = g.compact ? 12 : 16;
  if (m.timer) {
    ui.mini(tx, ty, m.timer, 'mist');
    ty += 7;
  }
  if (m.progress && m.progress.total > 0) {
    ui.mini(tx, ty, `${m.progress.killed}/${m.progress.total}${g.compact ? '' : ' SLAIN'}`, m.progress.killed >= m.progress.total ? 'lime' : 'mist');
    ty += 7;
  }
  if (m.difficulty.length) {
    ty += 2;
    ui.mini(tx, ty, 'TUNED', 'orange');
    ty += 7;
    for (const d of m.difficulty) {
      ui.mini(tx, ty, d, 'orange');
      ty += 6;
    }
  }

  // boss bar
  if (m.boss) {
    const bw = g.bossW;
    const x = Math.floor((W - bw) / 2);
    const y = 18;
    const name = m.boss.name.toUpperCase();
    if (ui.measure(name) <= W - 8) ui.text(W / 2, y - 11, name, { align: 'center', color: 'orange' });
    else ui.mini(W / 2, y - 8, name.split(',')[0]!, 'orange', 'center', 'ink');
    ui.bar(x, y, bw, 5, m.boss.life / m.boss.maxLife, 'red', 'plum');
    for (const p of m.boss.phases) ui.rect(x + Math.round(bw * p), y - 2, 1, 9, 'white');
    for (let i = 0; i <= m.boss.phase; i++) ui.rect(x + bw + 4 + i * 5, y, 3, 5, 'orange');
  }

  // loot feed (right, above the mana orb): newest first, at most 4 (2 on a phone), each line
  // placed around whatever else is there (the prompt, labels) and cut to fit
  const feedBottom = g.touch ? my - r - 10 : g.compact ? ly - r - 10 : H - 66;
  let shown = 0;
  for (const f of m.feed) {
    if (f.t > 4 || shown >= (g.compact ? 2 : 4)) continue;
    const blink = f.t < 0.15;
    const color = blink ? 'white' : f.t > 3.4 ? 'slate' : f.color;
    const maxW = g.compact ? W - 8 : Math.min(W / 2, 240);
    let text = f.text;
    const mini = g.compact || ui.measure(text) > maxW;
    const width = (s: string) => (mini ? s.length * 4 - 1 : ui.measure(s));
    while (text.length > 4 && width(text) > maxW) text = text.slice(0, -2);
    if (text !== f.text) text = `${text.slice(0, -1)}.`;
    const w = width(text);
    const h = mini ? 6 : 8;
    const want = { x: W - 6 - w, y: feedBottom - shown * (h + 2), w, h };
    const at = layout ? layout.place(want, { tries: 3, step: h + 2 }) : want;
    if (!at) continue;
    shown++;
    if (mini) ui.mini(W - 6, at.y, text, color, 'right', 'ink');
    else ui.text(W - 6, at.y, text, { align: 'right', color });
  }

  // kill streak
  if (m.streak && m.streak.count >= 3 && m.streak.age < 3 && !g.compact) {
    const s = m.streak.age < 0.12 ? 3 : 2;
    const x = 8;
    const y = Math.floor(H / 2) - 20;
    ui.text(x, y, `${m.streak.count}`, { scale: s, color: m.streak.count >= 10 ? 'orange' : 'sand' });
    ui.text(x, y + 8 * s, m.streak.count >= 10 ? 'RAMPAGE' : m.streak.count >= 6 ? 'SLAUGHTER' : 'STREAK', { color: m.streak.age > 2.5 ? 'slate' : 'white' });
  }

  drawBanner(ui, m);
}

/**
 * The centre banner: the level card and LEVEL CLEAR are a framed plate that opens sideways;
 * a level-up is a smaller plate with its hint on one line, so it never covers the fight.
 */
function drawBanner(ui: UiCanvas, m: HudModel): void {
  const c = m.card;
  const rect = bannerRect(ui.w, m);
  if (!c || !rect) return;
  const W = ui.w;
  const a = c.age;
  const dur = c.duration ?? 4;
  const kind = c.kind ?? 'card';
  const open = Math.min(1, a / 0.2) * Math.min(1, (dur - a) / 0.3);
  const ww = Math.max(2, Math.round(rect.w * open));
  const x = Math.round(W / 2 - ww / 2);
  const accent: PaletteColor = kind === 'levelup' ? 'lime' : kind === 'clear' ? 'cyan' : 'sand';
  ui.rect(x, rect.y, ww, rect.h, 'ink');
  ui.rect(x, rect.y, ww, 1, accent);
  ui.rect(x, rect.y + rect.h - 1, ww, 1, accent);
  if (open < 0.9) return;
  const big = rect.h > 30;
  const scale = big && ui.measure(c.title, 2) <= rect.w - 8 ? 2 : 1;
  const flash = kind === 'levelup' && a < 0.6 && a % 0.2 < 0.1;
  const titleColor: PaletteColor = flash ? 'white' : kind === 'levelup' ? 'lime' : kind === 'clear' ? 'cyan' : 'sand';
  const ty = rect.y + (big ? 6 : 4) + (scale === 1 && big ? 3 : 0);
  ui.text(W / 2, ty, c.title, { align: 'center', scale, color: titleColor, shadow: kind === 'levelup' ? 'green' : 'plum' });
  const sub = c.subtitle.toUpperCase();
  const sy = rect.y + rect.h - (big ? 11 : 9);
  if (ui.measure(sub) <= rect.w - 6) ui.text(W / 2, sy, sub, { align: 'center', color: 'mist' });
  else ui.mini(W / 2, sy + 1, sub, 'mist', 'center');
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
