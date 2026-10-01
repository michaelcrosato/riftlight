/**
 * Shell views that aren't plain menus: the character sheet (StatSheet + explain), the
 * codex (mechanics with their bypass and exploit), the death recap and the level-clear
 * loot window.
 */
import type { PaletteColor } from '../../engine';
import { describeMod, type StatSheet } from '../core/mods';
import { StatQuery } from '../combat/stats';
import { DAMAGE_TYPES, type DamageType } from '../core/types';
import type { MechanicInfo, Panel, WorldLoot } from '../game/ports';
import type { Penalty } from '../game/progress';
import type { Recap } from '../game/recap';
import { inside, type Rect, UI, type UiCanvas, type UiEvent, wrap } from './kit';

const TYPE_COLOR: Record<DamageType, PaletteColor> = { physical: 'mist', fire: 'orange', cold: 'sky', lightning: 'sand', chaos: 'plum' };

// ------------------------------------------------------------------ character sheet

/**
 * The rows: `scale` stats are multipliers combat reads as (1 + Σinc) × Πmore (damage and
 * speeds), the rest are values (flat fractions show as percentages).
 */
const SHEET: { stat: string; label: string; fmt: (v: number) => string; tags?: string[]; scale?: boolean }[] = [
  { stat: 'life', label: 'Life', fmt: (v) => v.toFixed(0) },
  { stat: 'mana', label: 'Mana', fmt: (v) => v.toFixed(0) },
  { stat: 'es', label: 'Energy shield', fmt: (v) => v.toFixed(0) },
  { stat: 'damage', label: 'Attack damage', fmt: (v) => `${v.toFixed(2)}x`, tags: ['attack', 'melee'], scale: true },
  { stat: 'attack.speed', label: 'Attack speed', fmt: (v) => `${v.toFixed(2)}x`, scale: true },
  { stat: 'cast.speed', label: 'Cast speed', fmt: (v) => `${v.toFixed(2)}x`, scale: true },
  { stat: 'move.speed', label: 'Move speed', fmt: (v) => `${v.toFixed(1)} M/S` },
  { stat: 'crit.chance', label: 'Crit chance', fmt: (v) => `${pct(v).toFixed(0)}%` },
  { stat: 'armour', label: 'Armour', fmt: (v) => v.toFixed(0) },
  { stat: 'res.fire', label: 'Fire res', fmt: (v) => `${Math.min(75, pct(v)).toFixed(0)}%` },
  { stat: 'res.cold', label: 'Cold res', fmt: (v) => `${Math.min(75, pct(v)).toFixed(0)}%` },
  { stat: 'res.lightning', label: 'Lightning res', fmt: (v) => `${Math.min(75, pct(v)).toFixed(0)}%` },
  { stat: 'life.regen', label: 'Life regen', fmt: (v) => `${v.toFixed(1)}/S` },
  { stat: 'mana.regen', label: 'Mana regen', fmt: (v) => `${v.toFixed(1)}/S` },
];

/** Chances and resistances are flat fractions (0.12 = 12%); an old save may hold whole percents. */
const pct = (v: number) => (Math.abs(v) <= 1.5 ? v * 100 : v);
const valueOf = (sheet: StatSheet, row: (typeof SHEET)[number]) => (row.scale ? new StatQuery(sheet).scale(row.stat, row.tags) : sheet.get(row.stat, row.tags));

export class CharacterSheet implements Panel {
  readonly id = 'character';
  readonly title = 'Character';
  private focus = 3;
  private rows: Rect[] = [];
  /** Room the shell has (`fit`): under 300 the explain column moves under the list. */
  private room = { w: 330, h: 244 };

  fit(w: number, h: number): void {
    this.room = { w, h };
  }

  get narrow(): boolean {
    return this.room.w < 300;
  }

  get size(): { w: number; h: number } {
    return this.narrow ? { w: Math.min(170, this.room.w), h: Math.min(this.room.h, 14 + SHEET.length * 11 + 64) } : { w: 330, h: 176 };
  }

  constructor(
    private readonly sheet: () => StatSheet,
    private readonly header: () => string,
  ) {}

  draw(ui: UiCanvas, r: Rect): void {
    const sheet = this.sheet();
    const narrow = this.narrow;
    const header = this.header();
    if (ui.measure(header) <= r.w - 4) ui.text(r.x + 2, r.y + 2, header, { color: 'sand' });
    else ui.mini(r.x + 2, r.y + 3, header, 'sand');
    this.rows = [];
    const listW = narrow ? r.w : 150;
    SHEET.forEach((row, i) => {
      const y = r.y + 14 + i * 11;
      const rect = { x: r.x, y: y - 1, w: listW, h: 10 };
      this.rows.push(rect);
      if (i === this.focus) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      const value = row.fmt(valueOf(sheet, row));
      // a narrow sheet shortens labels that would run into their value
      let label = row.label.toUpperCase();
      while (label.length > 4 && ui.measure(label) + ui.measure(value) + 8 > listW) label = label.slice(0, -1);
      ui.text(r.x + 3, y, label, { color: i === this.focus ? 'white' : 'mist' });
      ui.text(r.x + listW - 3, y, value, { align: 'right', color: 'white' });
    });
    // explain: where the focused stat comes from (a column on the right, or under the list)
    const row = SHEET[this.focus]!;
    const x = narrow ? r.x + 2 : r.x + 160;
    const top = narrow ? r.y + 16 + SHEET.length * 11 : r.y;
    if (narrow) ui.rect(r.x, top - 3, r.w, 1, 'slate');
    else ui.rect(x - 5, r.y, 1, r.h - 4, 'slate');
    if (!narrow) ui.text(x, top + 2, `${row.label.toUpperCase()} =`, { color: 'sand' });
    let y = narrow ? top : top + 14;
    const base = valueOf(sheet, row);
    const parts = sheet.explain(row.stat, row.tags);
    if (!parts.length) ui.text(x, y, 'BASE ONLY', { color: 'slate' });
    for (const p of parts.slice(0, 12)) {
      if (y > r.y + r.h - (narrow ? 22 : 20)) break;
      ui.mini(x, y, p.source.toUpperCase(), p.source === 'difficulty' ? 'orange' : 'slate');
      y += 6;
      for (const line of wrap(describeMod(p.mod).toUpperCase(), r.x + r.w - x)) {
        if (y > r.y + r.h - 18) break;
        ui.text(x, y, line, { color: 'sky' });
        y += 9;
      }
    }
    ui.mini(x, r.y + r.h - 8, `FINAL ${row.fmt(base)}`, 'white');
  }

  input(e: UiEvent): boolean {
    if (e.kind === 'nav' && (e.dir === 'up' || e.dir === 'down')) {
      this.focus = (this.focus + (e.dir === 'up' ? -1 : 1) + SHEET.length) % SHEET.length;
      return true;
    }
    if (e.kind === 'pointer') {
      const i = this.rows.findIndex((r) => inside(r, e.x, e.y));
      if (i >= 0) {
        this.focus = i;
        return true;
      }
    }
    return false;
  }
}

// ------------------------------------------------------------------ codex

export class Codex implements Panel {
  readonly id = 'codex';
  readonly title = 'Codex';
  private focus = 0;
  private rows: Rect[] = [];
  /** Room the shell has (`fit`): a phone gets a list of big rows, a tap opens the entry. */
  private room = { w: 360, h: 178 };
  /** Narrow only: the entry is open (else the list shows). */
  private reading = false;
  private backRect: Rect | null = null;

  constructor(
    private readonly mechanics: () => readonly MechanicInfo[],
    private readonly unlocked: () => readonly string[],
  ) {}

  fit(w: number, h: number): void {
    this.room = { w, h };
  }

  get narrow(): boolean {
    return this.room.w < 200;
  }

  get size(): { w: number; h: number } {
    if (!this.narrow) return { w: 360, h: 178 };
    return { w: this.room.w, h: Math.min(this.room.h, Math.max(150, this.mechanics().length * TAP_ROW + 4)) };
  }

  draw(ui: UiCanvas, r: Rect): void {
    const list = this.mechanics();
    const open = new Set(this.unlocked());
    this.rows = [];
    this.backRect = null;
    const narrow = this.narrow;
    if (narrow && this.reading) {
      // the entry, with a back row on top
      this.backRect = { x: r.x, y: r.y, w: r.w, h: TAP_ROW - 1 };
      ui.button(this.backRect, '< All entries', { focus: true });
      const m = list[this.focus];
      if (m) this.entry(ui, m, open.has(m.id), r.x + 3, r.y + TAP_ROW + 3, r.w - 6, r.y + r.h);
      return;
    }
    const rowH = narrow ? TAP_ROW : 12;
    list.forEach((m, i) => {
      const y = r.y + 2 + i * rowH;
      const rect = { x: r.x, y: y - 1, w: narrow ? r.w : 104, h: rowH - 1 };
      this.rows.push(rect);
      if (i === this.focus) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      else if (narrow) ui.rect(rect.x, rect.y + rect.h - 1, rect.w, 1, 'night');
      const known = open.has(m.id);
      ui.text(r.x + 3, y + 1 + (narrow ? 3 : 0), known ? m.name.toUpperCase() : '? ? ?', { color: known ? (i === this.focus ? 'white' : 'mist') : 'slate' });
      if (narrow) ui.text(r.x + r.w - 4, y + 4, '>', { color: 'slate', align: 'right' });
    });
    if (narrow) return;
    const m = list[this.focus];
    const x = r.x + 114;
    ui.rect(x - 5, r.y, 1, r.h - 2, 'slate');
    if (m) this.entry(ui, m, open.has(m.id), x, r.y + 2, r.x + r.w - x, r.y + r.h);
  }

  /** One mechanic's entry in a column from (x, y), `w` wide, cut at `bottom`. */
  private entry(ui: UiCanvas, m: MechanicInfo, known: boolean, x: number, y: number, w: number, bottom: number): void {
    const line = (text: string, color: PaletteColor) => {
      if (y + 8 > bottom) return;
      ui.text(x, y, text, { color });
      y += 9;
    };
    if (!known) {
      line('NOT YET SEEN', 'slate');
      y += 5;
      for (const l of wrap('ENTER A LEVEL WITH THIS MECHANIC TO UNLOCK ITS ENTRY.', w)) line(l, 'slate');
      return;
    }
    const name = m.name.toUpperCase();
    if (ui.measure(name, 2) <= w) {
      ui.text(x, y, name, { color: 'sand', scale: 2 });
      y += 18;
    } else line(name, 'sand');
    for (const l of wrap(m.description.toUpperCase(), w)) line(l, 'white');
    y += 4;
    if (y + 15 <= bottom) ui.mini(x, y, 'BYPASS (CASUAL)', 'lime');
    y += 7;
    for (const l of wrap(m.bypass.toUpperCase(), w)) line(l, 'mist');
    y += 4;
    if (y + 15 <= bottom) ui.mini(x, y, 'EXPLOIT (SPEEDRUN)', 'orange');
    y += 7;
    for (const l of wrap(m.exploit.toUpperCase(), w)) line(l, 'mist');
  }

  input(e: UiEvent): boolean {
    const n = this.mechanics().length;
    const step = (dir: 'up' | 'down') => {
      this.focus = (this.focus + (dir === 'up' ? -1 : 1) + n) % n;
      return true;
    };
    if (this.narrow && this.reading) {
      // the open entry: back, confirm or a tap on the back row return to the list
      const tapBack = e.kind === 'pointer' && e.type === 'down' && !!this.backRect && inside(this.backRect, e.x, e.y);
      if (e.kind === 'back' || e.kind === 'confirm' || tapBack) {
        this.reading = false;
        return true;
      }
      if (e.kind === 'nav' && (e.dir === 'up' || e.dir === 'down')) return step(e.dir);
      return e.kind === 'pointer';
    }
    if (e.kind === 'nav' && (e.dir === 'up' || e.dir === 'down')) return step(e.dir);
    if (e.kind === 'confirm' && this.narrow) {
      this.reading = true;
      return true;
    }
    if (e.kind === 'pointer') {
      const i = this.rows.findIndex((r) => inside(r, e.x, e.y));
      if (i >= 0) {
        this.focus = i;
        if (this.narrow && e.type === 'down') this.reading = true;
        return true;
      }
    }
    return false;
  }
}

/** Rows a thumb can hit on a phone (15 art px = 45 CSS px at 3×). */
const TAP_ROW = 15;

// ------------------------------------------------------------------ death recap

export class DeathRecap implements Panel {
  /** Agent API: 'continue'. */
  activate(id: string): boolean {
    if (id !== 'continue') return false;
    this.onContinue();
    return true;
  }

  readonly id = 'death';
  readonly title = 'You died';
  private button: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** Room the shell has (`fit`): a phone stacks the columns. */
  private room = { w: 300, h: 170 };

  constructor(
    private readonly recap: Recap,
    private readonly penalty: Penalty,
    private readonly where: string,
    private readonly onContinue: () => void,
  ) {}

  fit(w: number, h: number): void {
    this.room = { w, h };
  }

  get narrow(): boolean {
    return this.room.w < 240;
  }

  get size(): { w: number; h: number } {
    return this.narrow ? { w: this.room.w, h: Math.min(this.room.h, 236) } : { w: 300, h: 170 };
  }

  draw(ui: UiCanvas, r: Rect, time: number): void {
    if (this.narrow) return this.drawNarrow(ui, r);
    const rc = this.recap;
    ui.text(r.x + r.w / 2, r.y + 2, `SLAIN BY ${(rc.killer ?? 'THE RIFT').toUpperCase()}`, { align: 'center', color: 'red', scale: 1 });
    ui.text(r.x + r.w / 2, r.y + 12, this.where.toUpperCase(), { align: 'center', color: 'slate' });
    if (rc.killingBlow) ui.mini(r.x + r.w / 2, r.y + 22, `KILLING BLOW ${Math.round(rc.killingBlow.total)} ${rc.killingBlow.type.toUpperCase()}${rc.killingBlow.crit ? ' CRIT' : ''}`, 'orange', 'center');
    // damage taken by type
    let y = r.y + 32;
    ui.text(r.x + 4, y, 'DAMAGE TAKEN', { color: 'sand' });
    ui.text(r.x + 140, y, String(Math.round(rc.total)), { align: 'right', color: 'white' });
    y += 11;
    const max = Math.max(1, ...DAMAGE_TYPES.map((t) => rc.byType[t]));
    for (const t of DAMAGE_TYPES) {
      const v = rc.byType[t];
      ui.mini(r.x + 4, y + 1, t.toUpperCase(), v > 0 ? TYPE_COLOR[t] : 'slate');
      ui.bar(r.x + 46, y + 1, 70, 4, v / max, TYPE_COLOR[t], 'night');
      ui.mini(r.x + 140, y + 1, String(Math.round(v)), v > 0 ? 'white' : 'slate', 'right');
      y += 9;
    }
    // sources
    let sy = r.y + 32;
    ui.text(r.x + 156, sy, 'WORST ENEMIES', { color: 'sand' });
    sy += 11;
    for (const s of rc.sources) {
      ui.mini(r.x + 156, sy + 1, s.name.toUpperCase().slice(0, 18), 'mist');
      ui.mini(r.x + r.w - 4, sy + 1, `${Math.round(s.total)} / ${s.hits}`, 'white', 'right');
      sy += 9;
    }
    // tip and penalty
    y = Math.max(y, sy) + 6;
    ui.rect(r.x + 2, y - 3, r.w - 4, 1, 'slate');
    for (const l of wrap(`TIP: ${rc.tip.toUpperCase()}`, r.w - 8)) {
      ui.text(r.x + 4, y, l, { color: 'lime' });
      y += 9;
    }
    ui.mini(r.x + 4, r.y + r.h - 22, `LOST ${this.penalty.xp} XP AND ${this.penalty.gold} GOLD`, 'orange');
    this.button = { x: r.x + r.w / 2 - 60, y: r.y + r.h - 15, w: 120, h: 14 };
    ui.button(this.button, 'Return to town', { focus: time % 1 < 0.5 || true });
  }

  /** A phone in portrait: one column (killer, damage by type, worst enemies, tip), a full-width button. */
  private drawNarrow(ui: UiCanvas, r: Rect): void {
    const rc = this.recap;
    const x = r.x + 3;
    const w = r.w - 6;
    const bottom = r.y + r.h - 28; // the penalty line and the button
    let y = r.y + 2;
    for (const l of wrap(`SLAIN BY ${(rc.killer ?? 'THE RIFT').toUpperCase()}`, w).slice(0, 2)) {
      ui.text(r.x + r.w / 2, y, l, { align: 'center', color: 'red' });
      y += 9;
    }
    ui.mini(r.x + r.w / 2, y, this.where.toUpperCase(), 'slate', 'center');
    y += 7;
    if (rc.killingBlow) {
      ui.mini(r.x + r.w / 2, y, `BLOW ${Math.round(rc.killingBlow.total)} ${rc.killingBlow.type.toUpperCase()}${rc.killingBlow.crit ? ' CRIT' : ''}`, 'orange', 'center');
      y += 7;
    }
    y += 3;
    ui.text(x, y, 'DAMAGE', { color: 'sand' });
    ui.text(x + w, y, String(Math.round(rc.total)), { align: 'right', color: 'white' });
    y += 10;
    const max = Math.max(1, ...DAMAGE_TYPES.map((t) => rc.byType[t]));
    for (const t of DAMAGE_TYPES) {
      const v = rc.byType[t];
      ui.mini(x, y, t.slice(0, 5).toUpperCase(), v > 0 ? TYPE_COLOR[t] : 'slate');
      ui.bar(x + 22, y, w - 22 - 18, 4, v / max, TYPE_COLOR[t], 'night');
      ui.mini(x + w, y, String(Math.round(v)), v > 0 ? 'white' : 'slate', 'right');
      y += 7;
    }
    if (rc.sources.length) {
      y += 3;
      ui.text(x, y, 'WORST ENEMIES', { color: 'sand' });
      y += 10;
      for (const s of rc.sources.slice(0, 3)) {
        const v = `${Math.round(s.total)}`;
        ui.mini(x, y, s.name.toUpperCase().slice(0, Math.max(4, Math.floor((w - v.length * 4 - 4) / 4))), 'mist');
        ui.mini(x + w, y, v, 'white', 'right');
        y += 7;
      }
    }
    y += 4;
    ui.rect(r.x + 2, y - 3, r.w - 4, 1, 'slate');
    for (const l of wrap(`TIP: ${rc.tip.toUpperCase()}`, w)) {
      if (y + 8 > bottom) break;
      ui.text(x, y, l, { color: 'lime' });
      y += 9;
    }
    ui.mini(r.x + r.w / 2, r.y + r.h - 26, `LOST ${this.penalty.xp} XP · ${this.penalty.gold} GOLD`, 'orange', 'center');
    this.button = { x: r.x, y: r.y + r.h - 17, w: r.w, h: 16 };
    ui.button(this.button, 'Return to town', { focus: true });
  }

  input(e: UiEvent): boolean {
    if (e.kind === 'confirm' || (e.kind === 'pointer' && e.type === 'down' && inside(this.button, e.x, e.y))) {
      this.onContinue();
      return true;
    }
    return true;
  }
}

// ------------------------------------------------------------------ level clear: loot window

export class LootWindow implements Panel {
  readonly id = 'loot';
  readonly title = 'Level clear';
  private focus = 0;
  private rects: Rect[] = [];
  /** Room the shell has (`fit`): a phone wraps the summary, gets tall rows and stacked buttons. */
  private room = { w: 260, h: 150 };

  constructor(
    private readonly loot: () => readonly WorldLoot[],
    private readonly summary: () => string[],
    private readonly take: (l: WorldLoot) => boolean,
    private readonly leave: () => void,
  ) {}

  fit(w: number, h: number): void {
    this.room = { w, h };
  }

  get narrow(): boolean {
    return this.room.w < 200;
  }

  get size(): { w: number; h: number } {
    return this.narrow ? { w: this.room.w, h: Math.min(this.room.h, 200) } : { w: 260, h: 150 };
  }

  private actions(): { id: string; label: string; run: () => void }[] {
    return [
      { id: 'takeAll', label: 'Take all', run: () => [...this.loot()].forEach((l) => this.take(l)) },
      { id: 'leave', label: 'Return to town', run: this.leave },
    ];
  }

  /** Agent API: 'takeAll' or 'leave'. */
  activate(id: string): boolean {
    const a = this.actions().find((x) => x.id === id);
    a?.run();
    return !!a;
  }

  /** Rows shown: a phone has room for fewer, taller ones. */
  private get shown(): number {
    return this.narrow ? 4 : 6;
  }

  draw(ui: UiCanvas, r: Rect): void {
    const narrow = this.narrow;
    let y = r.y + 2;
    for (const s of this.summary()) {
      // a phone breaks the line between its " · " parts rather than inside one
      const parts = s.toUpperCase().split(' · ');
      const lines: string[] = [];
      for (const p of parts) {
        const joined = lines.length ? `${lines[lines.length - 1]} · ${p}` : p;
        if (lines.length && ui.measure(joined) <= r.w - 6) lines[lines.length - 1] = joined;
        else lines.push(p);
      }
      for (const l of narrow ? lines.flatMap((x) => wrap(x, r.w - 6)) : [s.toUpperCase()]) {
        ui.text(r.x + 3, y, l, { color: 'sand' });
        y += narrow ? 9 : 10;
      }
    }
    y += 2;
    const items = this.loot();
    ui.mini(r.x + 3, y, items.length ? 'STILL ON THE FLOOR' : 'NOTHING LEFT BEHIND', 'mist');
    y += 8;
    this.rects = [];
    const rowH = narrow ? 14 : 10;
    const rows = items.slice(0, this.shown);
    rows.forEach((l, i) => {
      const rect = { x: r.x, y, w: r.w, h: rowH };
      this.rects.push(rect);
      if (this.focus === i) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      let label = l.label;
      while (label.length > 4 && ui.measure(label) > r.w - 8) label = label.slice(0, -1);
      ui.text(r.x + 4, y + (narrow ? 3 : 1), label, { color: l.color });
      y += rowH;
    });
    if (items.length > this.shown) ui.mini(r.x + 4, y + 1, `+${items.length - this.shown} MORE`, 'slate');
    this.actions().forEach((a, i) => {
      const rect = narrow
        ? { x: r.x, y: r.y + r.h - (2 - i) * 17, w: r.w, h: 15 }
        : { x: r.x + 6 + i * (r.w / 2), y: r.y + r.h - 16, w: r.w / 2 - 12, h: 14 };
      this.rects.push(rect);
      ui.button(rect, a.label, { focus: this.focus === rows.length + i });
    });
  }

  input(e: UiEvent): boolean {
    const n = Math.min(this.shown, this.loot().length) + 2;
    if (e.kind === 'nav') {
      this.focus = (this.focus + (e.dir === 'up' || e.dir === 'left' ? -1 : 1) + n) % n;
      return true;
    }
    const activate = (i: number) => {
      const items = this.loot().slice(0, this.shown);
      if (i < items.length) this.take(items[i]!);
      else this.actions()[i - items.length]?.run();
      this.focus = Math.min(this.focus, Math.min(this.shown, this.loot().length) + 1);
    };
    if (e.kind === 'confirm') {
      activate(this.focus);
      return true;
    }
    if (e.kind === 'pointer') {
      const i = this.rects.findIndex((r) => inside(r, e.x, e.y));
      if (i < 0) return false;
      this.focus = i;
      if (e.type === 'down') activate(i);
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------ a line of dialogue over a view

/** Small header panel for NPC lines (shown above the vendor / tree / rift panels). */
export function dialogue(ui: UiCanvas, line: string, panel: Rect): void {
  const lines = wrap(line.toUpperCase(), Math.min(400, ui.w - 20));
  const w = Math.max(...lines.map((l) => ui.measure(l))) + 10;
  const x = Math.floor((ui.w - w) / 2);
  const y = Math.max(2, panel.y - 30 - lines.length * 9);
  ui.rect(x, y, w, lines.length * 9 + 6, 'ink');
  ui.outline(x, y, w, lines.length * 9 + 6, UI.edge);
  lines.forEach((l, i) => ui.text(x + 5, y + 4 + i * 9, l, { color: 'white' }));
}
