/**
 * The in-game HUD, drawn on the pixel Hud every frame from a plain model the shell fills:
 * life and mana orbs (wobbling liquid), the energy-shield ring, the XP bar with a level-up
 * flash, the skill bar (4 skills + attack + dodge) with cooldown sweeps and costs, buffs,
 * the boss bar with phase ticks, the minimap, gold, the loot feed, the level card, the kill
 * streak counter and the difficulty corner.
 */
import { clusters, type HudColor, type InputDevice, type PadGlyphs, type PaletteColor, textWidthPx, wrapText } from '../../engine';
import type { ControlAction } from '../game/controls';
import type { BossView, BuffView, SkillSlotView, Vitals } from '../game/ports';
import { lang, t } from '../lang';
import { clip, miniCovers, miniWidth, UI, type UiCanvas } from './kit';
import { BANNER_OPENS, type BannerKind, type Box, type HudLayout, overlaps } from './layout';

export interface FeedLine {
  text: string;
  color: PaletteColor;
  t: number;
  /** Gold picked up (the line counts it): pickups close together add up into one line. */
  gold?: number;
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
  /** The centre banner (level card, LEVEL CLEAR, level-up: `BannerQueue.current`), and the heroes on screen as it opened (`Banner.heroes`), which it keeps off. */
  card: { title: string; subtitle: string; age: number; kind?: BannerKind; duration?: number; heroes?: readonly Box[] } | null;
  streak: { count: number; age: number } | null;
  /** HUD-corner difficulty labels (only non-1.0 sliders). */
  difficulty: readonly string[];
  /** Hurt flash 0..1 (red screen edge). */
  hurt: number;
  levelLabel: string;
  timer: string | null;
  /** The device prompts are for (the input used last) and the pad's buttons they show. */
  device: InputDevice;
  padStyle: PadGlyphs;
  progress: { killed: number; total: number } | null;
  /** Touch controls on screen, in art pixels: the HUD drops its skill bar and lays out around them. */
  controls?: readonly Box[];
  /**
   * A 52in1 moment's seconds left (`round.moment_left`), red in its last seconds: centred at the
   * top, under a boss's bar, moved down clear of the label, the minimap and the controls
   * (`timeLeftRect`); the centre banner goes under it. Absent outside a moment.
   */
  timeLeft?: { text: string; urgent: boolean } | null;
  /** Couch co-op: a compact strip per guest (players 2 to 4) under the top-left block (`game/coop.ts`). */
  guests?: readonly GuestStrip[];
  /**
   * The heroes on screen as the guests' strips were placed (art pixels, feet to seat tag: the shell
   * takes them again when the stage, the guests or the screen's size change), which the strips keep
   * off (`guestsRect`): where they stood then, so the strips stay put as they move. Absent: not known.
   */
  heroes?: readonly Box[];
}

/** A couch guest on the HUD: its seat, colour (0xrrggbb, 52in1's seat colours), life (0..1), its four skills' readiness (0..1, -1 empty) and the seconds until it rises (null: up). */
export interface GuestStrip {
  readonly seat: number;
  readonly color: number;
  readonly life: number;
  readonly skills: readonly number[];
  readonly rise: number | null;
}

/** A guest's strip, in art pixels: its width (narrower beside a phone's minimap, down to `min`), its height, the gap between strips. */
const STRIP = { w: 66, min: 46, h: 13, gap: 2 } as const;

const ORB_R = 22;

/** A number on its own on the HUD, in the language's digits (no grouping: it sits in a tight spot). */
const num = (n: number): string => lang().formatNumber(n, { useGrouping: false });

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
 * any control in the top-left corner (the ≡ button, at the top or, in 52in1, lower down).
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
    // a landscape phone's button cluster is wider than a third of the screen: the orbs may look
    // as far as the middle for a spot on the bottom row; never under the minimap and the gold
    const reach = W > H ? W / 2 : W / 3;
    const around = [...controls, { x: W - map.w - 10, y: 0, w: map.w + 10, h: map.h + 20 }];
    const l = lowestSpot(W, H, around, 'left', size, reach);
    const m = lowestSpot(W, H, around, 'right', size, reach);
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
    // the top-left text starts right of a control in that corner (the ≡ button: in 52in1 lower
    // down, out of the hub's wake band, still beside the top-left block and the guests' strips)
    for (const c of controls) if (c.y < H / 3 && c.x < W / 3) textX = Math.max(textX, c.x + c.w + 3);
  }
  return { compact, touch, slot, gap, split, barW, bx, by, orbR, orbY, orbX, life, mana, xp, levelAt, textX, top, buffs, map, bossW };
}

/**
 * The lowest spot for a `size`-square box within `reach` of one side of the screen (a third, or
 * half on a landscape phone) that touches no control, nearest the corner on ties (a spot has to
 * be 6 px lower to beat one nearer the corner). Returns the box's top-left.
 */
function lowestSpot(W: number, H: number, controls: readonly Box[], side: 'left' | 'right', size: number, reach = W / 3): { x: number; y: number } {
  const m = 3;
  const span = Math.max(0, Math.floor(reach) - size - m);
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
  return hudBoxes(W, H, m).map(({ x, y, w, h }) => ({ x, y, w, h }));
}

/** A zone of the fixed HUD and what it is (`hudBoxes`). */
export type HudBox = Box & { readonly id: 'control' | 'bar' | 'xp' | 'life' | 'mana' | 'minimap' | 'gold' | 'where' | 'boss' | 'time' | 'banner' | 'guests' };

/**
 * Every zone the fixed HUD covers for this model, named (`hudZones` without the names; the phone
 * checks read them): the touch controls or the skill bar, the XP bar and level, the orbs, the
 * minimap, the gold, the top-left block, a boss's name and bar, a moment's seconds left, the
 * centre banner and the couch guests' strips.
 */
export function hudBoxes(W: number, H: number, m: HudModel): HudBox[] {
  const g = hudGeometry(W, H, m.controls);
  const z = fixedBoxes(W, H, m, g);
  const b = bannerRect(W, H, m, g);
  if (b) z.push({ id: 'banner', x: b.x, y: b.y, w: b.w, h: b.h });
  const guests = guestsRect(W, H, m, g);
  if (guests) z.push({ id: 'guests', x: guests.x, y: guests.y, w: guests.w, h: guests.h });
  return z;
}

/** The zones that stay put (`hudBoxes` but the centre banner and the guests' strips, which are placed around them). */
function fixedBoxes(W: number, H: number, m: HudModel, g: ReturnType<typeof hudGeometry>): HudBox[] {
  const z: HudBox[] = [];
  if (g.touch) {
    for (const c of m.controls ?? []) z.push({ id: 'control', ...c });
    z.push({ id: 'xp', x: g.xp.x - 2, y: g.levelAt.y - 1, w: g.xp.w + 4, h: g.xp.y + 4 - g.levelAt.y + 1 });
  } else z.push({ id: 'bar', x: g.bx - 6, y: g.by - 14, w: g.barW + 6, h: H - g.by + 14 }); // bar + XP
  z.push({ id: 'life', ...orbZone(g.life, g.orbR) }, { id: 'mana', ...orbZone(g.mana, g.orbR) });
  // the corner map and its frame (`minimapZone` reserves the row of gold under it as well)
  if (m.minimap) z.push({ id: 'minimap', x: W - g.map.w - 6, y: 2, w: g.map.w + 4, h: g.map.h + 4 });
  z.push({ id: 'gold', ...goldZone(W, m, g) });
  z.push({ id: 'where', ...whereZone(W, m, g) });
  const boss = bossZone(W, m, g);
  if (boss) z.push({ id: 'boss', ...boss });
  const left = timeLeftRect(W, m, g);
  if (left) z.push({ id: 'time', ...left });
  return z;
}

/** An orb and its frame. */
const orbZone = (o: { x: number; y: number }, r: number): Box => ({ x: o.x - r - 3, y: o.y - r - 3, w: r * 2 + 7, h: r * 2 + 7 });

/** The couch guests' strips as placed (`guestsRect`): their box, how many strips a row and each strip's width. */
interface GuestsPlace extends Box {
  readonly cols: number;
  readonly strip: number;
}

/**
 * Where the couch guests' strips go, or null without guests: under the top-left block (every row
 * it draws: `whereZone`), one under another. Beside a minimap they would run into (a phone held
 * upright) they narrow to the gap, or, too narrow for that, go under the minimap and gold; under a
 * boss's name and bar where that runs across the screen (`bossPlace`), so the bar stays put as
 * guests come and go. Where a column of them would run into the rest of the HUD (a landscape
 * phone's 195 rows, the stick and the life orb under them) they sit side by side, two or three a
 * row. Where none of that is clear (a short landscape phone with a long top-left block: the
 * tuning's rows) they go beside the top-left block, under a boss's bar at the top, else under the
 * minimap and gold on the right; and with no clear spot at all, the one covering the least of the
 * fixed HUD, never an orb. Of the clear spots, they take the first out of the rows the heroes stood
 * in as they were placed (`m.heroes`: a short landscape phone's two or three side by side under the
 * tuning's rows run across the middle of the screen, over the heroes, for the whole level), else
 * the one over the least of the heroes (`offHeroes`).
 */
function guestsRect(W: number, H: number, m: HudModel, g: ReturnType<typeof hudGeometry>): GuestsPlace | null {
  const n = m.guests?.length ?? 0;
  if (!n) return null;
  const where = whereZone(W, m, g);
  const map = minimapZone(W, m, g);
  const boss = bossZone(W, m, g);
  const top = bossPlace(W, m, g)?.top ?? false;
  const around = fixedBoxes(W, H, m, g);
  const spots: GuestsPlace[] = [];
  const place = (x: number, y: number, cols: number, w: number): GuestsPlace => {
    const rows = Math.ceil(n / cols);
    return { x, y, w: cols * w + (cols - 1) * STRIP.gap, h: rows * (STRIP.h + STRIP.gap) - STRIP.gap, cols, strip: w };
  };
  for (let cols = 1; cols <= n; cols++) {
    const fit = (room: number) => Math.min(STRIP.w, Math.floor((room - (cols - 1) * STRIP.gap) / cols));
    // under the top-left block
    let y = where.y + where.h + 3;
    if (boss && !top) y = Math.max(y, boss.y + boss.h + 2);
    let w = fit(W - 4 - g.textX);
    if (map && y < map.y + map.h && g.textX + cols * w + (cols - 1) * STRIP.gap > map.x - 2) {
      const room = fit(map.x - 2 - g.textX);
      if (room >= STRIP.min) w = room;
      else y = map.y + map.h + 2;
    }
    if (w >= STRIP.min) spots.push(place(g.textX, y, cols, w));
  }
  // beside the top-left block (under a boss's bar at the top), up to the minimap
  const beside = { x: where.x + where.w + 3, y: boss && top ? boss.y + boss.h + 2 : where.y };
  // under the minimap and gold on the right (and under a boss's bar across the screen)
  const under = Math.max(map ? map.y + map.h : 0, goldZone(W, m, g).y + 8, boss && !top ? boss.y + boss.h : 0) + 2;
  for (let cols = 1; cols <= n; cols++) {
    const fit = (room: number) => Math.min(STRIP.w, Math.floor((room - (cols - 1) * STRIP.gap) / cols));
    const w = fit((map ? map.x - 2 : W - 4) - beside.x);
    if (w >= STRIP.min) spots.push(place(beside.x, beside.y, cols, w));
  }
  for (let cols = 1; cols <= n; cols++) {
    const w = Math.min(STRIP.w, Math.floor((Math.floor(W / 2) - (cols - 1) * STRIP.gap) / cols));
    if (w < STRIP.min) continue;
    const p = place(0, under, cols, w);
    spots.push({ ...p, x: W - 4 - p.w });
  }
  const onScreen = (p: Box) => p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H;
  const clear = spots.filter((p) => onScreen(p) && !around.some((z) => overlaps(p, z, 0)));
  if (clear.length) return offHeroes(clear, W, m.heroes ?? []);
  // no clear spot: the one covering the least of the fixed HUD (never an orb, while one doesn't)
  const orb = (p: Box) => around.some((z) => (z.id === 'life' || z.id === 'mana') && overlaps(p, z, 0));
  const covered = (p: Box) => around.reduce((sum, z) => sum + overlapArea(p, z), 0);
  const fair = spots.filter((p) => onScreen(p) && !orb(p));
  const pool = fair.length ? fair : spots.filter(onScreen).length ? spots.filter(onScreen) : spots;
  return pool.reduce((best, p) => (covered(p) < covered(best) ? p : best), pool[0]!);
}

/**
 * Of the guests' spots clear of the fixed HUD (in `guestsRect`'s order), where they go with the
 * heroes on screen: the first out of the heroes' rows (`heroRows`: the fight goes on there); with
 * none, the one over the least of the heroes, and of those beside the top-left block (or anywhere
 * else) rather than in a row of strips across the screen's middle, where the camera keeps them.
 */
function offHeroes(spots: readonly GuestsPlace[], W: number, heroes: readonly Box[]): GuestsPlace {
  const rows = heroRows(W, heroes);
  if (!rows) return spots[0]!;
  const out = spots.find((p) => !overlaps(p, rows, 0));
  if (out) return out;
  const over = (p: Box) => heroes.reduce((sum, z) => sum + overlapArea(p, z), 0);
  const across = (p: GuestsPlace) => p.cols > 1 && p.x < W / 2 && p.x + p.w > W / 2;
  return spots.reduce((best, p) => {
    const d = over(p) - over(best);
    return d < 0 || (d === 0 && across(best) && !across(p)) ? p : best;
  });
}

/** The rows the heroes stand in, across the screen (`HudModel.heroes`, `card.heroes`), or null without them. */
function heroRows(W: number, heroes: readonly Box[]): Box | null {
  if (!heroes.length) return null;
  const top = Math.min(...heroes.map((z) => z.y));
  return { x: 0, y: top, w: W, h: Math.max(...heroes.map((z) => z.y + z.h)) - top };
}

/** How many art pixels of `b` the box `a` covers. */
const overlapArea = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Each couch guest's strip: its seat tag in its colour, its life, its skills (bright when ready), and the seconds until it rises. */
function drawGuests(ui: UiCanvas, m: HudModel, at: GuestsPlace): void {
  const lw = at.strip - 21; // the life bar, and the four skills' pips under it
  const pip = Math.floor((lw + 1) / 4) - 1;
  (m.guests ?? []).forEach((s, k) => {
    const x = at.x + (k % at.cols) * (at.strip + STRIP.gap);
    const y = at.y + Math.floor(k / at.cols) * (STRIP.h + STRIP.gap);
    ui.rect(x, y, at.strip, STRIP.h, 'ink');
    ui.rect(x + 1, y + 1, at.strip - 2, STRIP.h - 2, 'night');
    ui.rect(x + 1, y + 1, 15, STRIP.h - 2, s.color);
    ui.mini(x + 9, y + 4, t('hud.coop.seat', { seat: s.seat }), 'ink', 'center');
    ui.rect(x + 18, y + 2, lw, 4, 'plum');
    ui.rect(x + 18, y + 2, Math.round(lw * Math.max(0, Math.min(1, s.life))), 4, 'red');
    s.skills.forEach((r, i) => {
      if (r < 0) return;
      const px = x + 18 + i * (pip + 1);
      ui.rect(px, y + 8, pip, 2, 'slate');
      ui.rect(px, y + 8, Math.round(pip * Math.max(0, Math.min(1, r))), 2, r >= 1 ? 'sky' : 'mist');
    });
    if (s.rise !== null) ui.mini(x + at.strip - 3, y + 7, num(Math.max(1, Math.ceil(s.rise))), 'white', 'right', 'ink');
  });
}

/** The minimap and the gold under it (top-right), or null without a minimap. */
function minimapZone(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): Box | null {
  return m.minimap ? { x: W - g.map.w - 6, y: 2, w: g.map.w + 6, h: g.map.h + 18 } : null;
}

/** The gold counter's words: the number, rolling up to what the hero has. */
const goldText = (m: HudModel): string => lang().formatNumber(Math.round(m.goldShown));

/** The gold counter and its coin (`drawHud`): right-aligned under the minimap, or in the top-right corner without one. */
function goldZone(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): Box {
  const gy = m.minimap ? g.map.h + 10 : 6;
  const gw = textWidthPx(goldText(m)) + 8;
  return { x: W - 6 - gw, y: gy - 1, w: gw + 1, h: 8 };
}

/** One row of the top-left block: where you are, the clock, the kills, the tuning. */
interface LeftRow {
  readonly text: string;
  readonly y: number;
  readonly color: HudColor;
}

/**
 * The top-left block's rows as `drawHud` draws them: where you are (wrapped, `whereRows`), then
 * the clock, the kills and the tuning, in the normal font read from the couch (a phone's compact
 * HUD: the mini font).
 */
function leftRows(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): LeftRow[] {
  const rows = whereRows(W, m, g);
  const out: LeftRow[] = g.compact ? [{ text: rows[0]!, y: 5, color: 'sand' }] : rows.map((text, i) => ({ text, y: 6 + i * WHERE_ROW, color: 'sand' }));
  let ty = (g.compact ? 12 : 17) + (rows.length - 1) * WHERE_ROW;
  const step = g.compact ? 7 : 9;
  if (m.timer) {
    out.push({ text: m.timer, y: ty, color: 'mist' });
    ty += step;
  }
  if (m.progress && m.progress.total > 0) {
    const { killed, total } = m.progress;
    out.push({ text: g.compact ? `${lang().formatNumber(killed)}/${lang().formatNumber(total)}` : t('hud.slain', { killed, total }), y: ty, color: killed >= total ? 'lime' : 'mist' });
    ty += step;
  }
  if (m.difficulty.length) {
    ty += 2;
    out.push({ text: t('hud.tuned'), y: ty, color: 'orange' });
    ty += step;
    for (const d of m.difficulty) {
      out.push({ text: d, y: ty, color: 'orange' });
      ty += g.compact ? 6 : 9;
    }
  }
  return out;
}

/**
 * The top-left block (where you are, the clock, the kills, the tuning): every row as drawn, as
 * wide as its widest row (a longer language's) and at least a little room for the overlays.
 */
function whereZone(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): Box {
  const rows = leftRows(W, m, g);
  const width = (s: string) => (g.compact ? miniWidth(s) : textWidthPx(s));
  const widest = Math.max(...rows.map((r) => width(r.text)));
  const last = rows[rows.length - 1]!;
  // at least a little room for the overlays, but never into the minimap or a boss's name and bar
  const room = whereRight(W, m, g) - g.textX + 2;
  return { x: g.textX - 2, y: 4, w: Math.max(Math.min(W / 2, 90, room), widest + 4), h: last.y + (g.compact ? 6 : 8) - 3 };
}

/** A boss's name and bar as placed (`bossPlace`): the bar's left, top and width, and its name. */
interface BossPlace {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  /** Centred at the top beside the minimap (else across the screen under it). */
  readonly top: boolean;
  readonly name: { readonly text: string; readonly mini: boolean };
}

/** The bar never gets shorter than this at the top; with less room it goes under the minimap. */
const BOSS_MIN_W = 100;

/** Room for the phase pips right of a boss's bar (one per phase reached, 5 apart). */
const pipsRoom = (boss: BossView): number => 4 + 5 * (boss.phases.length + 1);

/**
 * The boss bar at the top: its width, centred between the minimap and its mirror on the left (so
 * the bar and its phase pips never run under the minimap), and the room its name has; null when
 * the bar would be shorter than `BOSS_MIN_W` there (a phone in portrait, a narrow window).
 */
function bossTop(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): { w: number; room: number } | null {
  if (!m.boss) return null;
  const side = m.minimap ? g.map.w + 10 : 6;
  const w = Math.min(g.bossW, W - 2 * (side + pipsRoom(m.boss)));
  return w >= BOSS_MIN_W ? { w, room: W - 2 * side } : null;
}

/**
 * Where a boss's name and bar go, or null without a boss: centred at the top where it has room
 * (`bossTop`), else across the screen under the minimap, the gold and the top-left block.
 */
function bossPlace(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): BossPlace | null {
  if (!m.boss) return null;
  const top = bossTop(W, m, g);
  if (top) return { x: Math.floor((W - top.w) / 2), y: 18, w: top.w, top: true, name: bossName(top.room, m.boss.name) };
  const name = bossName(W, m.boss.name);
  const map = minimapZone(W, m, g);
  const where = whereZone(W, m, g);
  const gold = goldZone(W, m, g);
  const above = Math.max(map ? map.y + map.h : 0, where.y + where.h, gold.y + gold.h) + 1;
  return { x: 6, y: above + (name.mini ? 8 : 11), w: W - 12 - pipsRoom(m.boss), top: false, name };
}

/** A boss's name and bar (top centre, or under the minimap: `bossPlace`), or null without a boss. */
function bossZone(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): Box | null {
  const b = bossPlace(W, m, g);
  if (!b) return null;
  const nameH = b.name.mini ? 9 : 12;
  return b.top ? { x: b.x - 2, y: 5, w: b.w + 20, h: 20 } : { x: 2, y: b.y - nameH, w: W - 4, h: nameH + 7 };
}

/** A moment's seconds left as drawn: cut to the screen only if a language's words could not fit it. */
function timeLeftText(W: number, text: string): string {
  return clip(text, W - 6, (s) => textWidthPx(s));
}

/**
 * Where a moment's seconds left go (its shadow included), or null: centred at the top, then down
 * under whatever it would touch (the top-left label, the minimap and gold, a boss's name and bar,
 * a touch control), so on a phone it sits under the minimap and on a wide screen under a boss's bar.
 */
function timeLeftRect(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): Box | null {
  if (!m.timeLeft) return null;
  const w = textWidthPx(timeLeftText(W, m.timeLeft.text));
  const box = { x: Math.max(1, Math.floor(W / 2 - w / 2)), y: 6, w: w + 1, h: 8 };
  const around = [whereZone(W, m, g), minimapZone(W, m, g), bossZone(W, m, g), ...(m.controls ?? [])].filter((z): z is Box => z !== null);
  for (let i = 0; i < around.length; i++) {
    const hit = around.find((z) => overlaps(box, z));
    if (!hit) break;
    box.y = hit.y + hit.h + 1;
  }
  return box;
}

/** Rows of the top-left label (where you are), 9 pixels apart: room for accents above capitals. */
const WHERE_ROW = 9;

/** The boss bar's name in `room` (the screen, or between the minimap and its mirror): the normal font when it fits, else its mini font form. */
function bossName(room: number, name: string): { text: string; mini: boolean } {
  if (textWidthPx(name) <= room - 8) return { text: name, mini: false };
  return { text: clip(name.split(/[,،，、]/)[0]!, room - 8, miniWidth), mini: true };
}

/** Where the top-left label's room ends: before the minimap, and before a boss's name and bar at the top. */
function whereRight(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): number {
  let right = W - (m.minimap ? g.map.w + 10 : 6);
  const top = bossTop(W, m, g);
  if (m.boss && top) {
    const name = bossName(top.room, m.boss.name);
    const nameW = name.mini ? miniWidth(name.text) : textWidthPx(name.text);
    right = Math.min(right, Math.floor(Math.min((W - top.w) / 2, (W - nameW) / 2)) - 4);
  }
  return right;
}

/**
 * The top-left label (where you are) in rows that fit its room: up to the minimap, and clear of a
 * boss's name and bar at the top (a long level name in a longer language wraps under itself, at
 * most three rows, never under the boss's name). A phone has one row in the mini font, cut to fit.
 */
function whereRows(W: number, m: HudModel, g: ReturnType<typeof hudGeometry>): string[] {
  const room = Math.max(24, whereRight(W, m, g) - g.textX);
  if (g.compact) return [clip(m.levelLabel, room, miniWidth)];
  const rows = wrapText(m.levelLabel, room);
  return rows.length <= 3 ? rows : [rows[0]!, rows[1]!, clip(rows.slice(2).join(' '), room, (s) => textWidthPx(s))];
}

/** A banner's line under its title, in rows that fit its plate: in the normal font or, when that takes more rows, the mini font. */
interface BannerSub {
  readonly rows: readonly string[];
  readonly mini: boolean;
}

/** Most rows a banner's line under its title takes (the last one cut to fit). */
const BANNER_SUB_ROWS = 4;

/**
 * The line under a banner's title in `room` art pixels: one row in the normal font, else one in the
 * mini font, else two in the normal font, else wrapped in the mini font (when it can draw the
 * words) or the normal font, at most `BANNER_SUB_ROWS` (a moment's goal on the narrowest phone
 * takes up to four in a language with accents, which the mini font can't draw).
 */
function bannerSub(sub: string, room: number): BannerSub {
  const normal = (s: string) => textWidthPx(s);
  if (!sub) return { rows: [], mini: false };
  if (normal(sub) <= room) return { rows: [sub], mini: false };
  const mini = miniCovers(sub);
  if (mini && miniWidth(sub) <= room) return { rows: [sub], mini: true };
  const big = wrapText(sub, room, normal);
  const small = mini ? wrapText(sub, room, miniWidth) : big;
  const pick = big.length <= 2 || !mini ? { rows: big, measure: normal, mini: false } : { rows: small, measure: miniWidth, mini: true };
  const rows = pick.rows.length <= BANNER_SUB_ROWS ? pick.rows : [...pick.rows.slice(0, BANNER_SUB_ROWS - 1), clip(pick.rows.slice(BANNER_SUB_ROWS - 1).join(' '), room, pick.measure)];
  return { rows: rows.map((r) => clip(r, room, pick.measure)), mini: pick.mini };
}

/** Rows of a banner's line under its title, apart: the mini font's, and the normal font's (room for accents). */
const SUB_ROW = { mini: 7, normal: 9 } as const;

/** The banner as placed (`bannerRect`): its plate, whether it is the big one, its line under the title, and the column its words are centred on. */
type BannerPlace = Box & { readonly big: boolean; readonly sub: BannerSub; readonly cx: number };

/**
 * The banner's rect (null when none shows), whether it is the big plate, and its line under the
 * title: its plate grows a row for each row more that line takes, keeps clear of the minimap, and
 * goes under a moment's seconds left. A phone held upright has it under the minimap and the level
 * label. Where that plate would cover the couch guests' strips, a touch control, the skill bar,
 * an orb, the XP bar, the minimap, a boss's bar or a moment's seconds left (`BANNER_NEVER`: on a
 * landscape phone's 195 rows and fewer the action cluster reaches up the right side), it moves
 * aside within its row (narrower if it must, never narrower than its title; its words centred on
 * it, `cx`), or into the row above what it hit, under the top-left block or under the strips:
 * of those clear of all of them, the one covering least of the rest of the HUD (the top-left
 * block, the gold). With none clear, under the strips as before. The heroes as they stood when it
 * opened (`card.heroes`) weigh more than the HUD it may cover: a hero most (`HERO_COVER`), the rows
 * they stand in across the screen next (`BAND_COVER`: the fight goes on there), so where its place
 * would be over them it moves aside of them in its row, the row under the strips first (on a short
 * landscape phone with three guests and the tuning's rows, over the top-left block's last rows
 * rather than over the heroes for its four seconds).
 */
function bannerRect(W: number, H: number, m: HudModel, g: ReturnType<typeof hudGeometry>): BannerPlace | null {
  const c = m.card;
  if (!c || c.age < 0 || c.age >= (c.duration ?? 4)) return null;
  const big = (c.kind ?? 'card') !== 'levelup' && W >= 300;
  // a phone held upright: under the minimap and the level label; under a boss's bar
  const boss = bossPlace(W, m, g);
  const upright = W < 300 && H > W;
  let y = boss && !boss.top ? boss.y + 9 : upright ? (boss ? 60 : 50) : boss ? 34 : big ? 24 : 26;
  // beside the minimap on a wide screen (one held upright has it under the minimap)
  const wide = Math.min(W - 8, big ? 280 : 200, !upright && m.minimap ? W - 2 * (g.map.w + 10) : Infinity);
  const plate = (x: number, top: number, w: number, cx = x + w / 2): BannerPlace => {
    const sub = bannerSub(c.subtitle, w - 6);
    const h = (big ? 34 : 22) + Math.max(0, sub.rows.length - 1) * (sub.mini ? SUB_ROW.mini : SUB_ROW.normal);
    return { x, y: top, w, h, big, sub, cx };
  };
  const x = Math.floor((W - wide) / 2);
  const left = timeLeftRect(W, m, g);
  if (left && overlaps(plate(x, y, wide), left)) y = left.y + left.h + 1;
  const nominal = plate(x, y, wide, W / 2);
  // what it must never cover, and what it had better not
  const guests = guestsRect(W, H, m, g);
  const fixed = fixedBoxes(W, H, m, g);
  const hard: Box[] = [...fixed.filter((z) => BANNER_NEVER.has(z.id)), ...(guests ? [guests] : [])];
  const soft = fixed.filter((z) => !BANNER_NEVER.has(z.id));
  const clear = (p: Box) => p.y >= 0 && p.y + p.h <= H && p.x >= 0 && p.x + p.w <= W && !hard.some((z) => overlaps(p, z));
  // the heroes as it opened, and the rows they stand in across the screen
  const heroes = c.heroes ?? [];
  const band = heroRows(W, heroes);
  const onPlay = (p: Box) => heroes.reduce((sum, z) => sum + HERO_COVER * overlapArea(p, z), 0) + (band ? BAND_COVER * overlapArea(p, band) : 0);
  // aside within the row from `top`: the widest free span around the middle, the plate as close to the middle as it goes
  const least = textWidthPx(c.title) + 4;
  const aside = (top: number): BannerPlace | null => {
    let a = 4;
    let b = W - 4;
    for (const z of hard) {
      if (z.y >= top + nominal.h || z.y + z.h <= top) continue;
      if (z.x + z.w / 2 < W / 2) a = Math.max(a, z.x + z.w + 2);
      else b = Math.min(b, z.x - 2);
    }
    const w = Math.min(wide, b - a);
    if (w < least) return null;
    const p = plate(Math.min(Math.max(Math.round(W / 2 - w / 2), a), b - w), top, w);
    return clear(p) ? p : null;
  };
  /** Aside of the heroes too, in the row from `top`: in each span free of them and of what it must never cover, as close to the middle as it goes. */
  const besideHeroes = (top: number): BannerPlace[] => {
    const cuts = [...hard, ...heroes].filter((z) => z.y < top + nominal.h && z.y + z.h > top).map((z) => [z.x - 2, z.x + z.w + 2] as const);
    cuts.sort((a, b) => a[0] - b[0]);
    const out: BannerPlace[] = [];
    let from = 4;
    for (const [a, b] of [...cuts, [W - 4, W - 4] as const]) {
      const w = Math.min(wide, a - from);
      if (w >= least) {
        const p = plate(Math.min(Math.max(Math.round(W / 2 - w / 2), from), a - w), top, w);
        if (clear(p)) out.push(p);
      }
      from = Math.max(from, b);
    }
    return out;
  };
  const under = whereZone(W, m, g);
  const rows = [y, ...hard.filter((z) => overlaps(nominal, z) && z.y > y).map((z) => z.y - nominal.h - 1), under.y + under.h + 2, ...(guests ? [guests.y + guests.h + 2] : [])];
  const covered = (p: Box) => soft.reduce((sum, z) => sum + overlapArea(p, z), 0);
  const cheapest = (places: readonly BannerPlace[], cost: (p: Box) => number) => places.reduce<BannerPlace | null>((b, p) => (!b || cost(p) < cost(b) ? p : b), null);
  const asides = rows.map(aside).filter((p) => p !== null);
  // its place where it is clear, else aside; nowhere clear: under the strips, as it always went
  const chosen = clear(nominal) ? nominal : (cheapest(asides, covered) ?? (guests && overlaps(nominal, guests) ? plate(x, guests.y + guests.h + 2, wide, W / 2) : nominal));
  if (!band || !onPlay(chosen)) return chosen;
  // over the heroes or their rows: aside of them in each row as well, the row under the strips
  // first, then the screen's top, under anything it must not cover above them (≡, a boss's bar)
  // and the row just above them; the least of the heroes and the HUD covered (`HERO_COVER`,
  // `BAND_COVER`); under them only where every place up there is over one (a phone held upright
  // with a boss's bar and the strips across it)
  const places: BannerPlace[] = [];
  const above = hard.filter((z) => z.y + z.h < band.y).map((z) => z.y + z.h + 2);
  for (const top of [...(guests ? [guests.y + guests.h + 2] : []), ...rows, 4, ...above, band.y - nominal.h - 2]) places.push(...besideHeroes(top));
  places.push(chosen, ...asides);
  const overHero = (p: Box) => heroes.some((z) => overlaps(p, z, 0));
  if (places.every(overHero)) places.push(...besideHeroes(band.y + band.h + 2));
  return cheapest(places, (p) => covered(p) + onPlay(p))!;
}

/** What an art pixel of a hero (`card.heroes`) weighs where the banner would cover it, against one of the HUD it may cover (the top-left block, the gold). */
const HERO_COVER = 16;
/** What an art pixel of the rows the heroes stand in, across the screen, weighs (`bannerRect`). */
const BAND_COVER = 4;

/** What the centre banner never covers (`bannerRect`): the touch controls, the skill bar, the orbs, the XP bar, the minimap, a boss's bar, a moment's seconds left. */
const BANNER_NEVER: ReadonlySet<HudBox['id']> = new Set(['control', 'bar', 'life', 'mana', 'xp', 'minimap', 'boss', 'time']);

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

function skillSlot(ui: UiCanvas, x: number, y: number, s: SkillSlotView, action: ControlAction | null, t: number, SLOT = 20): void {
  ui.rect(x - 1, y - 1, SLOT + 2, SLOT + 2, 'ink');
  ui.rect(x, y, SLOT, SLOT, s.id ? 'slate' : 'night');
  ui.rect(x + 1, y + 1, SLOT - 2, SLOT - 2, 'navy');
  if (s.icon && s.colors) {
    const iw = Math.max(...s.icon.map((r) => r.length));
    const sc = iw * 2 <= SLOT - 4 ? 2 : 1;
    ui.sprite(x + Math.floor((SLOT - iw * sc) / 2), y + Math.floor((SLOT - s.icon.length * sc) / 2), s.icon, s.colors as Record<string, HudColor>, sc);
  }
  else if (s.id) ui.text(x + SLOT / 2, y + 7, clusters(s.name).slice(0, 2).join(''), { align: 'center' }); // no icon: its first letters
  // cooldown sweep: a dark shutter that drops away
  if (s.remaining > 0 && s.cooldown > 0) {
    const h = Math.ceil((SLOT - 2) * Math.min(1, s.remaining / s.cooldown));
    for (let row = 0; row < h; row++) ui.rect(x + 1, y + 1 + row, SLOT - 2, 1, (row & 1) === 0 ? 'ink' : 'night');
    ui.mini(x + SLOT / 2, y + 8, s.remaining >= 1 ? String(Math.ceil(s.remaining)) : (Math.ceil(s.remaining * 10) / 10).toFixed(1).slice(1), 'white', 'center', 'ink'); // digits: the mini font's
  } else if (!s.usable) {
    for (let row = 0; row < SLOT - 2; row += 2) ui.rect(x + 1, y + 1 + row, SLOT - 2, 1, 'navy');
  } else if (s.remaining <= 0 && s.cooldown > 0 && t % 1 < 0.04) ui.outline(x, y, SLOT, SLOT, 'white');
  if (s.cost > 0) ui.mini(x + SLOT - 1, y + 1, num(s.cost), s.usable ? 'sky' : 'red', 'right', 'ink');
  if (action) ui.glyph(x + 1, y + SLOT - 4, action);
}

/** What `drawHud` drew that a finger may swipe away: the loot feed's lines (art pixels). */
export interface HudDrawn {
  readonly feed: Box[];
}

export function drawHud(ui: UiCanvas, m: HudModel, layout?: HudLayout): HudDrawn {
  const feedRects: Box[] = [];
  const W = ui.w;
  const H = ui.h;
  const time = m.time;
  ui.device = m.device;
  ui.padStyle = m.padStyle;
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
  orb(ui, lx, ly, lifeFrac, low && time % 0.6 < 0.3 ? 'orange' : 'red', 'orange', 'plum', time, low ? 1 : 0, r);
  shieldRing(ui, lx, ly, v.maxEs > 0 ? v.es / v.maxEs : 0, r);
  ui.mini(lx, ly + r + 3 - (g.compact ? 18 : 33), num(Math.ceil(v.life)), 'white', 'center', 'ink');
  const mx = g.mana.x;
  const my = g.mana.y;
  orb(ui, mx, my, v.maxMana > 0 ? v.mana / v.maxMana : 0, 'blue', 'sky', 'navy', time + 1.7, 0, r);
  reservedCap(ui, mx, my, v.maxMana > 0 ? (v.reserved ?? 0) / v.maxMana : 0, r);
  ui.mini(mx, my + r + 3 - (g.compact ? 18 : 33), num(Math.floor(v.mana)), 'white', 'center', 'ink');

  // skill bar: attack, dodge, then the four skills (on a touch screen the buttons are the bar)
  if (!g.touch) {
    const order: ControlAction[] = ['attack', 'dodge', 'skill1', 'skill2', 'skill3', 'skill4'];
    const slots = [m.skills.find((s) => s.slot === 'attack'), m.skills.find((s) => s.slot === 'dodge'), ...[0, 1, 2, 3].map((i) => m.skills.find((s) => s.slot === i))];
    const barW = g.barW;
    const bx = g.bx;
    const by = g.by;
    ui.rect(bx - 5, by - 4, barW + 4, SLOT + 10, 'ink');
    ui.rect(bx - 4, by - 3, barW + 2, SLOT + 8, 'night');
    slots.forEach((s, i) => {
      const x = bx + i * (SLOT + g.gap) + (i >= 2 ? g.split : 0);
      if (s) skillSlot(ui, x, by, s, g.compact ? null : order[i]!, time, SLOT);
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
  if (lv.mini) ui.mini(lv.x, lv.y, t('hud.level', { level: m.level }), flash ? 'white' : 'sand', lv.align, 'ink');
  else ui.text(lv.x, lv.y, lang().formatNumber(m.level), { align: lv.align, color: flash ? 'white' : 'sand' });

  // buffs above the life orb
  m.buffs.forEach((b, i) => {
    const x = g.buffs.x + i * 13;
    const y = g.buffs.y;
    ui.rect(x, y, 11, 11, 'ink');
    ui.rect(x + 1, y + 1, 9, 9, b.debuff ? 'plum' : 'night');
    ui.rect(x + 3, y + 3, 5, 5, b.color);
    ui.rect(x + 1, y + 10, Math.round(9 * Math.max(0, b.remaining / b.duration)), 1, 'white');
    if (b.stacks && b.stacks > 1) ui.mini(x + 11, y - 2, num(b.stacks), 'white', 'right', 'ink');
  });

  // minimap, gold under it (top-right); the counter glows while it rolls up
  const mw = g.map.w;
  if (m.minimap) drawMinimap(ui, m.minimap, W - mw - 4, 4, mw, g.map.h, time);
  const gy = m.minimap ? g.map.h + 10 : 6;
  const gold = goldText(m);
  const gw = ui.measure(gold) + 8;
  ui.sprite(W - 6 - gw, gy, ['.ooo.', 'oyyyo', 'oywyo', 'oyyyo', '.ooo.'], { o: 'orange', y: 'sand', w: 'white' });
  ui.text(W - 6, gy - 1, gold, { color: m.goldShown < m.gold - 0.5 ? 'white' : 'sand', align: 'right' });

  // top-left: where you are, the clock, progress, difficulty (`leftRows`: right of the touch menu
  // button, clear of the minimap and a boss's name and bar; a long name wraps under itself), in
  // the normal font read from the couch (a phone's compact HUD: the mini font)
  leftRows(W, m, g).forEach((row, i) => (g.compact ? ui.mini(g.textX, row.y, row.text, row.color, 'left', i === 0 ? 'ink' : undefined) : ui.text(g.textX, row.y, row.text, { color: row.color })));

  // couch guests' strips under the top-left block
  const guests = guestsRect(W, H, m, g);
  if (guests) drawGuests(ui, m, guests);

  // a moment's seconds left (top centre, placed clear of the rest)
  const left = timeLeftRect(W, m, g);
  if (left && m.timeLeft) ui.text(left.x, left.y, timeLeftText(W, m.timeLeft.text), { color: m.timeLeft.urgent ? 'red' : 'white', shadow: 'ink' });

  // boss bar: centred at the top beside the minimap, or across the screen under it (`bossPlace`)
  const boss = bossPlace(W, m, g);
  if (m.boss && boss) {
    const { x, y, w: bw, name } = boss;
    // a long name in the mini font, its epithet ("…, the Ember Tyrant") dropped, and cut to its room
    const cx = boss.top ? W / 2 : x + bw / 2;
    if (!name.mini) ui.text(cx, y - 11, name.text, { align: 'center', color: 'orange' });
    else ui.mini(cx, y - 8, name.text, 'orange', 'center', 'ink');
    ui.bar(x, y, bw, 5, m.boss.life / m.boss.maxLife, 'red', 'plum');
    for (const p of m.boss.phases) ui.rect(x + Math.round(bw * p), y - 2, 1, 9, 'white');
    for (let i = 0; i <= m.boss.phase; i++) ui.rect(x + bw + 4 + i * 5, y, 3, 5, 'orange');
  }

  // loot feed (right, above the mana orb): newest first, at most 4 (2 on a phone), each line
  // placed around whatever else is there (the prompt, labels) and cut to fit
  const feedBottom = g.touch ? my - r - 10 : g.compact ? ly - r - 10 : H - 66;
  // on a touch screen it ends over the mana orb's right edge (a landscape phone's button cluster is right of it)
  const feedRight = g.touch ? Math.min(W - 6, mx + r) : W - 6;
  let shown = 0;
  for (const f of m.feed) {
    if (f.t > 4 || shown >= (g.compact ? 2 : 4)) continue;
    const blink = f.t < 0.15;
    const color = blink ? 'white' : f.t > 3.4 ? 'slate' : f.color;
    const maxW = g.compact ? W - 8 : Math.min(W / 2, 240);
    const mini = g.compact || ui.measure(f.text) > maxW;
    const width = (s: string) => (mini ? miniWidth(s) : ui.measure(s));
    const text = clip(f.text, maxW, width);
    const w = width(text);
    const h = mini ? 6 : 8;
    const want = { x: feedRight - w, y: feedBottom - shown * (h + 2), w, h };
    const at = layout ? layout.place(want, { tries: 3, step: h + 2 }) : want;
    if (!at) continue;
    shown++;
    feedRects.push({ x: feedRight - w - 1, y: at.y - 1, w: w + 2, h: h + 2 });
    if (mini) ui.mini(feedRight, at.y, text, color, 'right', 'ink');
    else ui.text(feedRight, at.y, text, { align: 'right', color });
  }

  // kill streak (left, half way down; right of couch guests' strips it would run into)
  if (m.streak && m.streak.count >= 3 && m.streak.age < 3 && !g.compact) {
    const s = m.streak.age < 0.12 ? 3 : 2;
    const count = lang().formatNumber(m.streak.count);
    const word = t(m.streak.count >= 10 ? 'hud.streak.rampage' : m.streak.count >= 6 ? 'hud.streak.slaughter' : 'hud.streak.streak');
    const y = Math.floor(H / 2) - 20;
    const box = { x: 8, y, w: Math.max(textWidthPx(count, 3), textWidthPx(word)) + 1, h: 8 * 3 + 9 };
    const guests = guestsRect(W, H, m, g);
    const x = guests && overlaps(box, guests, 1) ? guests.x + guests.w + 4 : 8;
    ui.text(x, y, count, { scale: s, color: m.streak.count >= 10 ? 'orange' : 'sand' });
    ui.text(x, y + 8 * s, word, { color: m.streak.age > 2.5 ? 'slate' : 'white' });
  }

  drawBanner(ui, m, g);
  return { feed: feedRects };
}

/** How far a banner's plate is open (0 shut, 1 open): it opens over `BANNER_OPENS` s and closes over its last 0.3 s. */
export function bannerOpen(c: { readonly age: number; readonly duration?: number }): number {
  const dur = c.duration ?? 4;
  return Math.min(1, c.age / BANNER_OPENS) * Math.min(1, (dur - c.age) / 0.3);
}

/** A banner's words show once its plate is this far open. */
export const BANNER_WORDS = 0.9;

/**
 * The centre banner: the level card and LEVEL CLEAR are a framed plate that opens sideways;
 * a level-up is a smaller plate with its hint on one line, so it never covers the fight.
 */
function drawBanner(ui: UiCanvas, m: HudModel, g: ReturnType<typeof hudGeometry>): void {
  const c = m.card;
  const rect = bannerRect(ui.w, ui.h, m, g);
  if (!c || !rect) return;
  const a = c.age;
  const kind = c.kind ?? 'card';
  const open = bannerOpen(c);
  const ww = Math.max(2, Math.round(rect.w * open));
  const cx = rect.cx; // the middle of the screen, or of the plate where it moved aside (`bannerRect`)
  const x = Math.round(cx - ww / 2);
  const accent: PaletteColor = kind === 'levelup' ? 'lime' : kind === 'clear' ? 'cyan' : 'sand';
  ui.rect(x, rect.y, ww, rect.h, 'ink');
  ui.rect(x, rect.y, ww, 1, accent);
  ui.rect(x, rect.y + rect.h - 1, ww, 1, accent);
  if (open < BANNER_WORDS) return;
  const big = rect.big;
  const scale = big && ui.measure(c.title, 2) <= rect.w - 8 ? 2 : 1;
  const flash = kind === 'levelup' && a < 0.6 && a % 0.2 < 0.1;
  const titleColor: PaletteColor = flash ? 'white' : kind === 'levelup' ? 'lime' : kind === 'clear' ? 'cyan' : 'sand';
  const ty = rect.y + (big ? 6 : 4) + (scale === 1 && big ? 3 : 0);
  ui.text(cx, ty, c.title, { align: 'center', scale, color: titleColor, shadow: kind === 'levelup' ? 'green' : 'plum' });
  // the line under the title, its last row where a one-row line goes
  const { rows, mini } = rect.sub;
  const gap = mini ? SUB_ROW.mini : SUB_ROW.normal;
  const sy = rect.y + rect.h - (big ? 11 : 9) - (rows.length - 1) * gap;
  rows.forEach((row, i) => (mini ? ui.mini(cx, sy + 1 + i * gap, row, 'mist', 'center') : ui.text(cx, sy + i * gap, row, { align: 'center', color: 'mist' })));
}

function drawMinimap(ui: UiCanvas, mm: MinimapModel, x: number, y: number, w: number, h: number, time: number): void {
  ui.rect(x - 2, y - 2, w + 4, h + 4, 'ink');
  ui.rect(x - 1, y - 1, w + 2, h + 2, 'slate');
  ui.rect(x, y, w, h, 'ink');
  const S = 2; // art pixels per cell
  const cols = Math.floor(w / S);
  const rows = Math.floor(h / S);
  const x0 = Math.floor(mm.hero.x - mm.origin.x - cols / 2);
  const z0 = Math.floor(mm.hero.z - mm.origin.z - rows / 2);
  mapCells(ui, mm, { x, y, cols, rows, x0, z0, S }, time, 'night');
}

/** A window onto the level's cells: `cols` × `rows` cells from cell (`x0`, `z0`), `S` art pixels each, drawn at (`x`, `y`). */
export interface MapView {
  readonly x: number;
  readonly y: number;
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly z0: number;
  readonly S: number;
}

/** The explored floor (in `floor`) and walls in view, then the exit, the boss and the hero (those two pinned to the edge when outside). */
function mapCells(ui: UiCanvas, mm: MinimapModel, v: MapView, time: number, floor: HudColor, seeThrough = false): void {
  const { x, y, cols, rows, x0, z0, S } = v;
  const w = cols * S;
  const h = rows * S;
  // run-length rows: one rect per run of the same colour (a see-through floor: two pixel rows of
  // every three, the world in the third: `PLATE_GAP`)
  for (let r = 0; r < rows; r++) {
    const cz = z0 + r;
    let run: HudColor | null = null;
    let start = 0;
    const flush = (end: number) => {
      if (!run) return;
      const top = y + r * S;
      if (!seeThrough || run !== floor) ui.rect(x + start * S, top, (end - start) * S, S, run);
      else for (let k = 0; k < S; k++) if (plateRow(top + k)) ui.rect(x + start * S, top + k, (end - start) * S, 1, run);
    };
    for (let c = 0; c <= cols; c++) {
      const cx = x0 + c;
      let color: HudColor | null = null;
      if (c < cols && cx >= 0 && cz >= 0 && cx < mm.width && cz < mm.height && mm.explored[cz * mm.width + cx]) {
        const value = mm.cell(cx, cz);
        color = value === 1 ? floor : value === 2 ? 'mist' : null;
      }
      if (color !== run) {
        flush(c);
        run = color;
        start = c;
      }
    }
  }
  const mark = Math.max(3, S + 1); // the hero's dot; the exit and the boss a pixel bigger
  const dot = (wx: number, wz: number, color: HudColor, size: number, always = false) => {
    const px = x + Math.round((wx - mm.origin.x - x0) * S);
    const pz = y + Math.round((wz - mm.origin.z - z0) * S);
    const inside = px >= x && pz >= y && px < x + w - 1 && pz < y + h - 1;
    if (!inside && !always) return;
    const cx = Math.max(x, Math.min(x + w - size, px - (size >> 1)));
    const cz = Math.max(y, Math.min(y + h - size, pz - (size >> 1)));
    if (seeThrough) ui.rect(cx - 1, cz - 1, size + 2, size + 2, 'ink'); // a rim: it reads over the fight behind
    ui.rect(cx, cz, size, size, color);
  };
  if (mm.exit) {
    const ex = Math.floor(mm.exit.x - mm.origin.x);
    const ez = Math.floor(mm.exit.z - mm.origin.z);
    const seen = ex >= 0 && ez >= 0 && ex < mm.width && ez < mm.height && mm.explored[ez * mm.width + ex];
    if (seen || mm.exit.open) dot(mm.exit.x, mm.exit.z, mm.exit.open ? (time % 0.8 < 0.4 ? 'cyan' : 'white') : 'sky', mark + 1, mm.exit.open);
  }
  if (mm.boss) dot(mm.boss.x, mm.boss.z, time % 0.6 < 0.3 ? 'red' : 'orange', mark + 1, true);
  dot(mm.hero.x, mm.hero.z, 'white', mark, true);
}

/**
 * The big map's see-through plate: ink on two pixel rows of every three, the fight behind in the
 * third (every other row read poorly at ten feet over a bright level: lava, a lit hall).
 */
export const PLATE_GAP = 3;
/** A pixel row of the big map's plate (and its floor) that is drawn: all but every `PLATE_GAP`th. */
const plateRow = (y: number): boolean => y % PLATE_GAP !== PLATE_GAP - 1;

/** Where the level's map goes in `room` (art pixels, `drawMap`): the window onto its cells and the box they fill. */
export function mapView(room: Box, mm: Pick<MinimapModel, 'width' | 'height' | 'hero' | 'origin' | 'explored' | 'exit'>): MapView & { readonly w: number; readonly h: number } {
  // what the player knows: the explored cells, the hero and an open exit, two cells around them
  const hx = Math.floor(mm.hero.x - mm.origin.x);
  const hz = Math.floor(mm.hero.z - mm.origin.z);
  let x0 = hx;
  let z0 = hz;
  let x1 = hx;
  let z1 = hz;
  for (let z = 0; z < mm.height; z++) {
    const row = z * mm.width;
    for (let x = 0; x < mm.width; x++) {
      if (!mm.explored[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  }
  if (mm.exit?.open) {
    const ex = Math.floor(mm.exit.x - mm.origin.x);
    const ez = Math.floor(mm.exit.z - mm.origin.z);
    x0 = Math.min(x0, ex);
    x1 = Math.max(x1, ex);
    z0 = Math.min(z0, ez);
    z1 = Math.max(z1, ez);
  }
  x0 = Math.max(0, x0 - 2);
  z0 = Math.max(0, z0 - 2);
  x1 = Math.min(mm.width - 1, x1 + 2);
  z1 = Math.min(mm.height - 1, z1 + 2);
  const bw = x1 - x0 + 1;
  const bh = z1 - z0 + 1;
  const inner = { w: Math.max(8, room.w - 6), h: Math.max(8, room.h - 14) }; // the frame, its title and the close control on its edges
  const S = Math.max(1, Math.min(5, Math.floor(Math.min(inner.w / bw, inner.h / bh))));
  const cols = Math.min(bw, Math.floor(inner.w / S));
  const rows = Math.min(bh, Math.floor(inner.h / S));
  // all of it when it fits; else the part of it around the hero
  const cx = cols < bw ? Math.max(x0, Math.min(x1 + 1 - cols, hx - Math.floor(cols / 2))) : x0;
  const cz = rows < bh ? Math.max(z0, Math.min(z1 + 1 - rows, hz - Math.floor(rows / 2))) : z0;
  const w = cols * S;
  const h = rows * S;
  return { x: room.x + Math.floor((room.w - w) / 2), y: room.y + Math.floor((room.h - h) / 2), cols, rows, x0: cx, z0: cz, S, w, h };
}

/**
 * The level's map over the play (Tab / M, R3 or the touchpad's press): what the player has explored,
 * as big as `room` takes it (around the hero when it can't take all of it), on a dimmed plate the
 * fight shows through (the world runs on: one pixel row in three, `PLATE_GAP`), its title and the control that closes it on its frame.
 * Drawn under the HUD, so the orbs, the skill bar and a boss's bar stay in view.
 */
export function drawMap(ui: UiCanvas, mm: MinimapModel, room: Box, time: number): void {
  const v = mapView(room, mm);
  const f = { x: v.x - 3, y: v.y - 3, w: v.w + 6, h: v.h + 6 };
  for (let y = f.y; y < f.y + f.h; y++) if (plateRow(y)) ui.rect(f.x, y, f.w, 1, 'ink');
  ui.outline(f.x, f.y, f.w, f.h, 'slate');
  mapCells(ui, mm, v, time, 'blue', true);
  const title = t('hud.map.title');
  const tw = ui.measure(title);
  ui.rect(f.x + 4, f.y - 4, tw + 6, 9, 'ink');
  ui.text(f.x + 7, f.y - 3, title, { color: 'sand' });
  const close = t('hud.map.close');
  const pw = ui.glyphWidth('map') + 3 + ui.measure(close);
  ui.rect(f.x + f.w - pw - 10, f.y + f.h - 5, pw + 6, 10, 'ink');
  ui.prompt(f.x + f.w - 7, f.y + f.h - 4, 'map', close, 'mist', 'right');
}
