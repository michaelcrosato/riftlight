/**
 * Shell views that aren't plain menus: the character sheet (StatSheet + explain), the
 * codex (mechanics with their bypass and exploit), the death recap and the level-clear
 * loot window.
 */
import type { PaletteColor } from '../../engine';
import { describeMod, type StatSheet } from '../core/mods';
import { DAMAGE_TYPES, type DamageType } from '../core/types';
import type { MechanicInfo, Panel, WorldLoot } from '../game/ports';
import type { Penalty } from '../game/progress';
import type { Recap } from '../game/recap';
import { inside, type Rect, UI, type UiCanvas, type UiEvent, wrap } from './kit';

const TYPE_COLOR: Record<DamageType, PaletteColor> = { physical: 'mist', fire: 'orange', cold: 'sky', lightning: 'sand', chaos: 'plum' };

// ------------------------------------------------------------------ character sheet

const SHEET: { stat: string; label: string; fmt: (v: number) => string; tags?: string[] }[] = [
  { stat: 'life', label: 'Life', fmt: (v) => v.toFixed(0) },
  { stat: 'mana', label: 'Mana', fmt: (v) => v.toFixed(0) },
  { stat: 'es', label: 'Energy shield', fmt: (v) => v.toFixed(0) },
  { stat: 'damage', label: 'Attack damage', fmt: (v) => v.toFixed(1), tags: ['attack', 'melee'] },
  { stat: 'attack.speed', label: 'Attack speed', fmt: (v) => `${v.toFixed(2)}x` },
  { stat: 'cast.speed', label: 'Cast speed', fmt: (v) => `${v.toFixed(2)}x` },
  { stat: 'move.speed', label: 'Move speed', fmt: (v) => `${v.toFixed(1)} M/S` },
  { stat: 'crit.chance', label: 'Crit chance', fmt: (v) => `${v.toFixed(0)}%` },
  { stat: 'armour', label: 'Armour', fmt: (v) => v.toFixed(0) },
  { stat: 'res.fire', label: 'Fire res', fmt: (v) => `${Math.min(75, v).toFixed(0)}%` },
  { stat: 'res.cold', label: 'Cold res', fmt: (v) => `${Math.min(75, v).toFixed(0)}%` },
  { stat: 'res.lightning', label: 'Lightning res', fmt: (v) => `${Math.min(75, v).toFixed(0)}%` },
  { stat: 'life.regen', label: 'Life regen', fmt: (v) => `${v.toFixed(1)}/S` },
  { stat: 'mana.regen', label: 'Mana regen', fmt: (v) => `${v.toFixed(1)}/S` },
];

export class CharacterSheet implements Panel {
  readonly id = 'character';
  readonly title = 'Character';
  readonly size = { w: 330, h: 176 };
  private focus = 3;
  private rows: Rect[] = [];

  constructor(
    private readonly sheet: () => StatSheet,
    private readonly header: () => string,
  ) {}

  draw(ui: UiCanvas, r: Rect): void {
    const sheet = this.sheet();
    ui.text(r.x + 2, r.y + 2, this.header(), { color: 'sand' });
    this.rows = [];
    SHEET.forEach((row, i) => {
      const y = r.y + 14 + i * 11;
      const rect = { x: r.x, y: y - 1, w: 150, h: 10 };
      this.rows.push(rect);
      if (i === this.focus) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      ui.text(r.x + 3, y, row.label.toUpperCase(), { color: i === this.focus ? 'white' : 'mist' });
      ui.text(r.x + 147, y, row.fmt(sheet.get(row.stat, row.tags)), { align: 'right', color: 'white' });
    });
    // explain: where the focused stat comes from
    const row = SHEET[this.focus]!;
    const x = r.x + 160;
    ui.rect(x - 5, r.y, 1, r.h - 4, 'slate');
    ui.text(x, r.y + 2, `${row.label.toUpperCase()} =`, { color: 'sand' });
    let y = r.y + 14;
    const base = sheet.get(row.stat, row.tags);
    const parts = sheet.explain(row.stat, row.tags);
    if (!parts.length) ui.text(x, y, 'BASE ONLY', { color: 'slate' });
    for (const p of parts.slice(0, 12)) {
      ui.mini(x, y, p.source.toUpperCase(), p.source === 'difficulty' ? 'orange' : 'slate');
      y += 6;
      for (const line of wrap(describeMod(p.mod).toUpperCase(), r.x + r.w - x)) {
        ui.text(x, y, line, { color: 'sky' });
        y += 9;
      }
      if (y > r.y + r.h - 20) break;
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
  readonly size = { w: 360, h: 178 };
  private focus = 0;
  private rows: Rect[] = [];

  constructor(
    private readonly mechanics: () => readonly MechanicInfo[],
    private readonly unlocked: () => readonly string[],
  ) {}

  draw(ui: UiCanvas, r: Rect): void {
    const list = this.mechanics();
    const open = new Set(this.unlocked());
    this.rows = [];
    list.forEach((m, i) => {
      const y = r.y + 2 + i * 12;
      const rect = { x: r.x, y: y - 1, w: 104, h: 11 };
      this.rows.push(rect);
      if (i === this.focus) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      const known = open.has(m.id);
      ui.text(r.x + 3, y + 1, known ? m.name.toUpperCase() : '? ? ?', { color: known ? (i === this.focus ? 'white' : 'mist') : 'slate' });
    });
    const m = list[this.focus];
    const x = r.x + 114;
    const w = r.x + r.w - x;
    ui.rect(x - 5, r.y, 1, r.h - 2, 'slate');
    if (!m) return;
    if (!open.has(m.id)) {
      ui.text(x, r.y + 4, 'NOT YET SEEN', { color: 'slate' });
      for (const [i, l] of wrap('ENTER A LEVEL WITH THIS MECHANIC TO UNLOCK ITS ENTRY.', w).entries()) ui.text(x, r.y + 18 + i * 9, l, { color: 'slate' });
      return;
    }
    let y = r.y + 2;
    ui.text(x, y, m.name.toUpperCase(), { color: 'sand', scale: 2 });
    y += 18;
    for (const l of wrap(m.description.toUpperCase(), w)) {
      ui.text(x, y, l, { color: 'white' });
      y += 9;
    }
    y += 4;
    ui.mini(x, y, 'BYPASS (CASUAL)', 'lime');
    y += 7;
    for (const l of wrap(m.bypass.toUpperCase(), w)) {
      ui.text(x, y, l, { color: 'mist' });
      y += 9;
    }
    y += 4;
    ui.mini(x, y, 'EXPLOIT (SPEEDRUN)', 'orange');
    y += 7;
    for (const l of wrap(m.exploit.toUpperCase(), w)) {
      ui.text(x, y, l, { color: 'mist' });
      y += 9;
    }
  }

  input(e: UiEvent): boolean {
    const n = this.mechanics().length;
    if (e.kind === 'nav' && (e.dir === 'up' || e.dir === 'down')) {
      this.focus = (this.focus + (e.dir === 'up' ? -1 : 1) + n) % n;
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

// ------------------------------------------------------------------ death recap

export class DeathRecap implements Panel {
  readonly id = 'death';
  readonly title = 'You died';
  readonly size = { w: 300, h: 170 };
  private button: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    private readonly recap: Recap,
    private readonly penalty: Penalty,
    private readonly where: string,
    private readonly onContinue: () => void,
  ) {}

  draw(ui: UiCanvas, r: Rect, time: number): void {
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
  readonly size = { w: 260, h: 150 };
  private focus = 0;
  private rects: Rect[] = [];

  constructor(
    private readonly loot: () => readonly WorldLoot[],
    private readonly summary: () => string[],
    private readonly take: (l: WorldLoot) => boolean,
    private readonly leave: () => void,
  ) {}

  private actions(): { label: string; run: () => void }[] {
    return [
      { label: 'Take all', run: () => [...this.loot()].forEach((l) => this.take(l)) },
      { label: 'Return to town', run: this.leave },
    ];
  }

  draw(ui: UiCanvas, r: Rect): void {
    let y = r.y + 2;
    for (const s of this.summary()) {
      ui.text(r.x + 3, y, s.toUpperCase(), { color: 'sand' });
      y += 10;
    }
    y += 2;
    const items = this.loot();
    ui.mini(r.x + 3, y, items.length ? 'STILL ON THE FLOOR' : 'NOTHING LEFT BEHIND', 'mist');
    y += 8;
    this.rects = [];
    const rows = items.slice(0, 6);
    rows.forEach((l, i) => {
      const rect = { x: r.x, y, w: r.w, h: 10 };
      this.rects.push(rect);
      if (this.focus === i) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      ui.text(r.x + 4, y + 1, l.label, { color: l.color });
      y += 10;
    });
    if (items.length > 6) ui.mini(r.x + 4, y + 1, `+${items.length - 6} MORE`, 'slate');
    this.actions().forEach((a, i) => {
      const rect = { x: r.x + 6 + i * (r.w / 2), y: r.y + r.h - 16, w: r.w / 2 - 12, h: 14 };
      this.rects.push(rect);
      ui.button(rect, a.label, { focus: this.focus === rows.length + i });
    });
  }

  input(e: UiEvent): boolean {
    const n = Math.min(6, this.loot().length) + 2;
    if (e.kind === 'nav') {
      this.focus = (this.focus + (e.dir === 'up' || e.dir === 'left' ? -1 : 1) + n) % n;
      return true;
    }
    const activate = (i: number) => {
      const items = this.loot().slice(0, 6);
      if (i < items.length) this.take(items[i]!);
      else this.actions()[i - items.length]?.run();
      this.focus = Math.min(this.focus, Math.min(6, this.loot().length) + 1);
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
