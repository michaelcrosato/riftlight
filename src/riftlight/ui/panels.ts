/**
 * Shell views that aren't plain menus: the character sheet (StatSheet + explain), the
 * codex (mechanics with their bypass and exploit), the death recap and the level-clear
 * loot window. Their words are lines (lang/panels.ts); what other parts of the game hand them
 * (a mechanic, a mod, a monster's name, a loot label) comes in the player's language already.
 */
import { type PaletteColor, textWidthPx, wrapText } from '../../engine';
import { describeMod, type StatSheet } from '../core/mods';
import { StatQuery } from '../combat/stats';
import { DAMAGE_COLORS, DAMAGE_TYPES } from '../core/types';
import type { MechanicInfo, Panel, WorldLoot } from '../game/ports';
import type { Penalty } from '../game/progress';
import { type Recap, recapTip } from '../game/recap';
import { lang, lineKey, t } from '../lang';
import { talkText } from '../town/npcs';
import { clip, inside, miniCovers, miniWidth, type Rect, UI, type UiCanvas, type UiEvent, wrap } from './kit';
import type { LegendItem } from './legend';

/** A number in the player's language (12,500 · 12.500), `digits` after the point. */
const num = (v: number, digits = 0): string => lang().formatNumber(v, { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** A mini-font row's height: `step`, or a full text row when the mini font can't draw it (accents, other writing systems). */
const miniStep = (text: string, step: number): number => (miniCovers(text) ? step : 9);
/** A fraction as a percentage in the player's language (0.12 → 12%, 12 %, %12). */
const percent = (v: number): string => lang().formatNumber(v, { style: 'percent', maximumFractionDigits: 0 });

// ------------------------------------------------------------------ character sheet

/**
 * The rows: `scale` stats are multipliers combat reads as (1 + Σinc) × Πmore (damage and
 * speeds), the rest are values (flat fractions show as percentages). Each row's label is the
 * line `panel.character.stat.<stat>` (`statLabel`).
 */
const SHEET: { stat: string; fmt: (v: number) => string; tags?: string[]; scale?: boolean }[] = [
  { stat: 'life', fmt: (v) => num(v) },
  { stat: 'mana', fmt: (v) => num(v) },
  { stat: 'es', fmt: (v) => num(v) },
  { stat: 'damage', fmt: (v) => t('panel.character.value.times', { value: num(v, 2) }), tags: ['attack', 'melee'], scale: true },
  { stat: 'attack.speed', fmt: (v) => t('panel.character.value.times', { value: num(v, 2) }), scale: true },
  { stat: 'cast.speed', fmt: (v) => t('panel.character.value.times', { value: num(v, 2) }), scale: true },
  { stat: 'move.speed', fmt: (v) => t('panel.character.value.speed', { value: num(v, 1) }) },
  { stat: 'crit.chance', fmt: (v) => percent(pct(v) / 100) },
  { stat: 'armour', fmt: (v) => num(v) },
  { stat: 'res.fire', fmt: (v) => percent(Math.min(75, pct(v)) / 100) },
  { stat: 'res.cold', fmt: (v) => percent(Math.min(75, pct(v)) / 100) },
  { stat: 'res.lightning', fmt: (v) => percent(Math.min(75, pct(v)) / 100) },
  { stat: 'life.regen', fmt: (v) => t('panel.character.value.per_second', { value: num(v, 1) }) },
  { stat: 'mana.regen', fmt: (v) => t('panel.character.value.per_second', { value: num(v, 1) }) },
];

/** The stats the character sheet lists (lang/panels.ts files a label line for each). */
export const SHEET_STATS: readonly string[] = SHEET.map((r) => r.stat);

/** A row's label in the player's language. */
const statLabel = (stat: string): string => t(lineKey('panel.character.stat', stat));

/** Equipment slots with a line of their own (`panel.character.source.item.<slot>`). */
const SLOTS = new Set(['weapon', 'offhand', 'helm', 'body', 'gloves', 'boots', 'amulet', 'ring1', 'ring2', 'belt']);
/** Kinds of stat source with a line (`panel.character.source.<kind>`): the part of a source key before its `:`. */
const SOURCE_KINDS = new Set(['base', 'level', 'tree', 'starter', 'difficulty', 'buff', 'shrine', 'curse', 'charges', 'keystone', 'mechanic']);

/**
 * Where a stat comes from, for the explain column: a StatSheet source key (`tree`,
 * `item:weapon`, `mechanic:mire:haste`...) as a line in the player's language.
 */
export function sourceLabel(source: string): string {
  const [kind, rest] = source.split(':') as [string, string | undefined];
  if (kind === 'item') return SLOTS.has(rest ?? '') ? t(lineKey('panel.character.source.item', rest!)) : t('panel.character.source.item');
  return SOURCE_KINDS.has(kind) ? t(lineKey('panel.character.source', kind)) : t('panel.character.source.other');
}

/** Chances and resistances are flat fractions (0.12 = 12%); an old save may hold whole percents. */
const pct = (v: number) => (Math.abs(v) <= 1.5 ? v * 100 : v);
const valueOf = (sheet: StatSheet, row: (typeof SHEET)[number]) => (row.scale ? new StatQuery(sheet).scale(row.stat, row.tags) : sheet.get(row.stat, row.tags));

/** The sheet's pages: its rows by what they are for (a short list reads from the couch). */
export const SHEET_PAGES: readonly { readonly id: 'offence' | 'defence' | 'resistances'; readonly stats: readonly string[] }[] = [
  { id: 'offence', stats: ['damage', 'attack.speed', 'cast.speed', 'crit.chance', 'move.speed'] },
  { id: 'defence', stats: ['life', 'mana', 'es', 'armour', 'life.regen', 'mana.regen'] },
  { id: 'resistances', stats: ['res.fire', 'res.cold', 'res.lightning'] },
];

/** A row of the list: the normal font's height and air between rows. */
const ROW = 13;

export class CharacterSheet implements Panel {
  readonly id = 'character';
  get title(): string {
    return t('panel.character.title');
  }
  /** The page shown (`SHEET_PAGES`) and the row focused on it. */
  page = 0;
  private focus = 0;
  private rows: Rect[] = [];
  private tabs: Rect[] = [];
  /** A narrow sheet whose page names don't fit as tabs turns its pages instead: ‹ before, › after. */
  private pager: { prev: Rect; next: Rect } | null = null;
  /** Room the shell has (`fit`): under 300 the explain column moves under the list. */
  private room = { w: 330, h: 244 };
  /** A finger's target height (`fit`'s `tap`): tabs and rows at least that tall (the rows as tall as fit). */
  private tap = 0;

  fit(w: number, h: number, tap = 0): void {
    this.room = { w, h };
    this.tap = tap;
  }

  get narrow(): boolean {
    return this.room.w < 300;
  }

  /** The tabs' height, the list's first text row (from the top), and a row's height: a thumb's on a touch screen, as tall as the room lets the longest page be. */
  private get metrics(): { tabH: number; listTop: number; rowH: number } {
    const tabH = Math.max(11, this.tap);
    const listTop = 17 + tabH;
    const most = Math.max(...SHEET_PAGES.map((p) => p.stats.length));
    const fits = Math.floor((this.room.h - listTop - (this.narrow ? 72 : 4)) / most);
    return { tabH, listTop, rowH: Math.max(ROW, Math.min(Math.max(ROW, this.tap), fits)) };
  }

  get size(): { w: number; h: number } {
    const { listTop, rowH } = this.metrics;
    const list = 6 * rowH;
    return this.narrow ? { w: Math.min(170, this.room.w), h: Math.min(this.room.h, listTop + list + 72) } : { w: this.listWidth + 190, h: Math.max(160, listTop + list + 4) };
  }

  /** The rows of the page shown. */
  private get list(): (typeof SHEET)[number][] {
    return SHEET_PAGES[this.page]!.stats.map((s) => SHEET.find((r) => r.stat === s)!);
  }

  /** The list column (wide layout): room for the widest label beside the widest value, 150 to 200 (a longer language). */
  private get listWidth(): number {
    const sheet = this.sheet();
    const labels = Math.max(...SHEET.map((row) => textWidthPx(statLabel(row.stat))));
    const values = Math.max(...SHEET.map((row) => textWidthPx(row.fmt(valueOf(sheet, row)))));
    return Math.max(150, Math.min(200, labels + values + 14));
  }

  constructor(
    private readonly sheet: () => StatSheet,
    private readonly header: () => string,
  ) {}

  /** L2 R2 (← →, Tab) turn the pages, back closes. */
  legend(): LegendItem[] {
    return [{ actions: ['tab_prev', 'tab_next'], label: t('legend.pages') }, { actions: ['back'], label: t('legend.back') }];
  }

  /**
   * The pages as tabs (a click or tap turns to one), or on a narrow sheet whose names don't fit
   * their thirds a pager: ‹ the page's name in full, a dot for each page, › (a tap on either side
   * turns), so no name is ever cut.
   */
  private drawTabs(ui: UiCanvas, r: Rect, tabH: number): void {
    this.tabs = [];
    this.pager = null;
    const names = SHEET_PAGES.map((p) => t(`panel.character.page.${p.id}`));
    const tabW = Math.floor(r.w / SHEET_PAGES.length);
    const y = r.y + 12;
    const ty = y + Math.floor((tabH - 7) / 2);
    if (this.narrow && names.some((n) => ui.measure(n) > tabW - 6)) {
      const third = Math.floor(r.w / 3);
      this.pager = { prev: { x: r.x, y, w: third, h: tabH }, next: { x: r.x + r.w - third, y, w: third, h: tabH } };
      ui.rect(r.x, y, r.w, tabH, 'navy');
      ui.rect(r.x, y + tabH - 1, r.w, 1, 'sand');
      ui.text(r.x + 3, ty, '<', { color: ui.hover(this.pager.prev) ? 'white' : 'sand' });
      ui.text(r.x + r.w - 3, ty, '>', { align: 'right', color: ui.hover(this.pager.next) ? 'white' : 'sand' });
      const name = names[this.page]!;
      // a tab a thumb tall has room under the name for where it is among the pages: a dot each, the page shown bright
      const dots = tabH >= 15;
      const ny = ty - (dots ? 2 : 1);
      // the name in full: the normal font, else the mini font, else cut between the arrows
      if (ui.measure(name) <= r.w - 20) ui.text(r.x + r.w / 2, ny, name, { align: 'center', color: 'sand' });
      else if (miniCovers(name) && miniWidth(name) <= r.w - 20) ui.mini(r.x + r.w / 2, ny + 1, name, 'sand', 'center');
      else ui.text(r.x + r.w / 2, ny, clip(name, r.w - 20, (x) => ui.measure(x)), { align: 'center', color: 'sand' });
      if (dots) SHEET_PAGES.forEach((_, i) => ui.rect(r.x + Math.round(r.w / 2) - 5 + i * 4, y + tabH - 4, 2, 2, i === this.page ? 'sand' : 'slate'));
      return;
    }
    let tx = r.x;
    SHEET_PAGES.forEach((_, i) => {
      const rect = this.narrow ? { x: r.x + i * tabW, y, w: tabW - 1, h: tabH } : { x: tx, y, w: ui.measure(names[i]!) + 8, h: tabH };
      this.tabs.push(rect);
      const on = i === this.page;
      ui.rect(rect.x, rect.y, rect.w, rect.h, on ? 'navy' : 'ink');
      if (on) ui.rect(rect.x, rect.y + rect.h - 1, rect.w, 1, 'sand');
      ui.text(rect.x + 4, ty, clip(names[i]!, rect.w - 6, (s) => ui.measure(s)), { color: on ? 'sand' : ui.hover(rect) ? 'white' : 'slate' });
      tx += rect.w + 3;
    });
  }

  draw(ui: UiCanvas, r: Rect): void {
    const sheet = this.sheet();
    const narrow = this.narrow;
    const header = this.header();
    const { tabH, listTop, rowH } = this.metrics;
    ui.text(r.x + 2, r.y + 2, clip(header, r.w - 4, (s) => ui.measure(s)), { color: 'sand' });
    this.drawTabs(ui, r, tabH);
    this.rows = [];
    const listW = narrow ? r.w : this.listWidth;
    const list = this.list;
    this.focus = Math.min(this.focus, list.length - 1);
    list.forEach((row, i) => {
      const rect = { x: r.x, y: r.y + listTop - 2 + i * rowH, w: listW, h: rowH - 1 };
      const y = rect.y + Math.floor((rowH - 9) / 2);
      this.rows.push(rect);
      if (i === this.focus) {
        ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
        ui.rect(rect.x, rect.y, 2, rect.h, 'sand');
      }
      const value = row.fmt(valueOf(sheet, row));
      // a narrow sheet (or a long language) shortens labels that would run into their value
      const label = clip(statLabel(row.stat), listW - ui.measure(value) - 10, (s) => ui.measure(s));
      ui.text(r.x + 5, y, label, { color: i === this.focus ? 'white' : 'mist' });
      ui.text(r.x + listW - 3, y, value, { align: 'right', color: 'white' });
    });
    // explain: where the focused stat comes from (a column on the right, or under the list)
    const row = list[this.focus]!;
    const x = narrow ? r.x + 2 : r.x + listW + 10;
    const top = narrow ? r.y + listTop + 2 + list.length * rowH : r.y + listTop - 2; // under the pages' tabs
    if (narrow) ui.rect(r.x, top - 3, r.w, 1, 'slate');
    else ui.rect(x - 5, top, 1, r.y + r.h - top - 2, 'slate');
    const colW = r.x + r.w - x;
    let y = narrow ? top : top + 2;
    const bottom = r.y + r.h - 11; // the final value's row
    if (!narrow) {
      for (const l of wrap(t('panel.character.explain', { stat: statLabel(row.stat) }), colW)) {
        ui.text(x, y, l, { color: 'sand' });
        y += 9;
      }
      y += 3;
    }
    const base = valueOf(sheet, row);
    const parts = sheet.explain(row.stat, row.tags);
    if (!parts.length) ui.text(x, y, t('panel.character.base_only'), { color: 'slate' });
    // each source in the normal font, its bonus under it: as many as there is room for
    for (const p of parts) {
      const lines = wrap(describeMod(p.mod), colW);
      if (y + 9 * (1 + Math.min(1, lines.length)) > bottom) break;
      ui.text(x, y, clip(sourceLabel(p.source), colW, (s) => ui.measure(s)), { color: p.source === 'difficulty' ? 'orange' : 'slate' });
      y += 9;
      for (const line of lines) {
        if (y + 9 > bottom) break;
        ui.text(x, y, line, { color: 'sky' });
        y += 9;
      }
      y += 2;
    }
    ui.text(x, bottom + 1, clip(t('panel.character.final', { value: row.fmt(base) }), colW, (s) => ui.measure(s)), { color: 'white' });
  }

  /** Turn to page `i` (the first row focused). */
  private turn(i: number): true {
    this.page = (i + SHEET_PAGES.length) % SHEET_PAGES.length;
    this.focus = 0;
    return true;
  }

  input(e: UiEvent): boolean {
    const n = this.list.length;
    if (e.kind === 'nav' && (e.dir === 'up' || e.dir === 'down')) {
      this.focus = (this.focus + (e.dir === 'up' ? -1 : 1) + n) % n;
      return true;
    }
    if (e.kind === 'nav') return this.turn(this.page + (e.dir === 'left' ? -1 : 1));
    if (e.kind === 'tab') return this.turn(this.page + e.dir);
    if (e.kind === 'pointer') {
      const tab = this.tabs.findIndex((r) => inside(r, e.x, e.y));
      if (tab >= 0 && e.type === 'down') return this.turn(tab);
      // the pager: a tap on its left half turns back, on its right half on
      const pager = this.pager;
      const strip = pager && { x: pager.prev.x, y: pager.prev.y, w: pager.next.x + pager.next.w - pager.prev.x, h: pager.prev.h };
      if (pager && strip && e.type === 'down' && inside(strip, e.x, e.y)) return this.turn(this.page + (e.x < strip.x + strip.w / 2 ? -1 : 1));
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
  get title(): string {
    return t('panel.codex.title');
  }
  private focus = 0;
  private rows: Rect[] = [];
  /** Room the shell has (`fit`): a phone gets a list of big rows, a tap opens the entry. */
  private room = { w: 360, h: 178 };
  /** A finger's target height (`fit`'s `tap`): the list's rows as close to it as the room lets them be. */
  private tap = 0;
  /** Narrow only: the entry is open (else the list shows). */
  private reading = false;
  private backRect: Rect | null = null;

  constructor(
    private readonly mechanics: () => readonly MechanicInfo[],
    private readonly unlocked: () => readonly string[],
  ) {}

  fit(w: number, h: number, tap = 0): void {
    this.room = { w, h };
    this.tap = tap;
  }

  get narrow(): boolean {
    return this.room.w < 200;
  }

  get size(): { w: number; h: number } {
    if (!this.narrow) return { w: 360, h: 178 };
    return { w: this.room.w, h: Math.min(this.room.h, Math.max(150, this.mechanics().length * this.rowH + 4)) };
  }

  /** A list row: a phone's tall one (a thumb's), the wide list's as tall as a thumb's where every entry still fits. */
  private get rowH(): number {
    if (this.narrow) return Math.max(TAP_ROW, this.tap);
    const n = Math.max(1, this.mechanics().length);
    return Math.max(12, Math.min(this.tap, Math.floor((Math.min(this.room.h, 178) - 4) / n)));
  }

  draw(ui: UiCanvas, r: Rect): void {
    const list = this.mechanics();
    const open = new Set(this.unlocked());
    this.rows = [];
    this.backRect = null;
    const narrow = this.narrow;
    if (narrow && this.reading) {
      // the entry, with a back row on top
      this.backRect = { x: r.x, y: r.y, w: r.w, h: this.rowH - 1 };
      ui.button(this.backRect, t('panel.codex.all_entries'), { focus: true });
      const m = list[this.focus];
      if (m) this.entry(ui, m, open.has(m.id), r.x + 3, r.y + this.rowH + 3, r.w - 6, r.y + r.h);
      return;
    }
    const rowH = this.rowH;
    list.forEach((m, i) => {
      const y = r.y + 2 + i * rowH + Math.floor((rowH - (narrow ? TAP_ROW : 12)) / 2);
      const rect = { x: r.x, y: r.y + 1 + i * rowH, w: narrow ? r.w : 104, h: rowH - 1 };
      this.rows.push(rect);
      if (i === this.focus) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      else if (narrow) ui.rect(rect.x, rect.y + rect.h - 1, rect.w, 1, 'night');
      const known = open.has(m.id);
      // a list row is as wide as it is: a long name is cut (the entry shows it whole)
      const name = known ? clip(m.name, rect.w - (narrow ? 14 : 5), (s) => ui.measure(s)) : '? ? ?';
      ui.text(r.x + 3, y + 1 + (narrow ? 3 : 0), name, { color: known ? (i === this.focus ? 'white' : 'mist') : 'slate' });
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
      line(t('panel.codex.not_seen'), 'slate');
      y += 5;
      for (const l of wrap(t('panel.codex.unlock_hint'), w)) line(l, 'slate');
      return;
    }
    if (ui.measure(m.name, 2) <= w) {
      ui.text(x, y, m.name, { color: 'sand', scale: 2 });
      y += 18;
    } else for (const l of wrap(m.name, w)) line(l, 'sand');
    for (const l of wrap(m.description, w)) line(l, 'white');
    // the headings in the normal font (a phone: the mini font, where it can draw them)
    const heading = (text: string, color: PaletteColor) => {
      if (y + 15 > bottom) return;
      if (this.narrow) {
        ui.mini(x, y, text, color);
        y += miniStep(text, 7);
      } else {
        ui.text(x, y, text, { color });
        y += 10;
      }
    };
    y += 4;
    heading(t('panel.codex.bypass'), 'lime');
    for (const l of wrap(m.bypass, w)) line(l, 'mist');
    y += 4;
    heading(t('panel.codex.exploit'), 'orange');
    for (const l of wrap(m.exploit, w)) line(l, 'mist');
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

/** A damage type's name, as the death recap labels its bar and the killing blow. */
const damageType = (type: string): string => t(lineKey('panel.death.type', type));

/** Rows a thumb can hit on a phone (15 art px = 45 CSS px at 3×). */
const TAP_ROW = 15;

// ------------------------------------------------------------------ death recap

export class DeathRecap implements Panel {
  /** Agent API: 'continue', or 'details' (the tables, or back to the summary). */
  activate(id: string): boolean {
    if (id === 'details') {
      this.details = !this.details;
      return true;
    }
    if (id !== 'continue') return false;
    this.onContinue();
    return true;
  }

  readonly id = 'death';
  get title(): string {
    return t('panel.death.title');
  }
  /** The tables show (damage by type, the worst enemies) instead of the summary: △ / Tab, or the Details button. */
  details = false;
  private buttons: { id: 'details' | 'continue'; rect: Rect }[] = [];
  /** The button focused (wide layout): Return to town unless moved. */
  private focus: 'details' | 'continue' = 'continue';
  /** Room the shell has (`fit`): a phone stacks the columns. */
  private room = { w: 300, h: 170 };
  /** A finger's target height (`fit`'s `tap`): the buttons that tall. */
  private tap = 0;

  constructor(
    private readonly recap: Recap,
    private readonly penalty: Penalty,
    private readonly where: string,
    private readonly onContinue: () => void,
  ) {}

  fit(w: number, h: number, tap = 0): void {
    this.room = { w, h };
    this.tap = tap;
  }

  get narrow(): boolean {
    return this.room.w < 240;
  }

  /** The buttons' height (wide layout): a thumb's on a touch screen. */
  private get buttonH(): number {
    return Math.max(14, this.tap);
  }

  get size(): { w: number; h: number } {
    return this.narrow ? { w: this.room.w, h: Math.min(this.room.h, 236) } : { w: 300, h: 170 + this.buttonH - 14 };
  }

  /** △ (Tab) shows the tables or the summary again; the button says what Cross does. */
  legend(): LegendItem[] {
    return this.narrow ? [] : [{ actions: ['details'], label: t(this.details ? 'legend.summary' : 'legend.details') }];
  }

  /** Who killed the hero (a monster's name in the player's language), as the recap's heading. */
  private slainBy(): string {
    const killer = this.recap.killer;
    return killer ? t('panel.death.slain_by', { killer }) : t('panel.death.slain_by_rift');
  }

  /** The killing blow ("Killing blow: 152 fire"), or null when nothing hit. */
  private blow(): string | null {
    const b = this.recap.killingBlow;
    if (!b) return null;
    return t(b.crit ? 'panel.death.blow_crit' : 'panel.death.blow', { damage: Math.round(b.total), type: damageType(b.type) });
  }

  draw(ui: UiCanvas, r: Rect): void {
    if (this.narrow) return this.drawNarrow(ui, r);
    const measure = (s: string) => ui.measure(s);
    // who, where and the blow: the slayer as big as it fits
    const slain = this.slainBy();
    const big = measure(slain) * 2 <= r.w - 8;
    ui.text(r.x + r.w / 2, r.y + 2, big ? slain : clip(slain, r.w - 8, measure), { align: 'center', color: 'red', scale: big ? 2 : 1 });
    let y = r.y + (big ? 19 : 12);
    ui.text(r.x + r.w / 2, y, clip(this.where, r.w - 8, measure), { align: 'center', color: 'slate' });
    y += 10;
    for (const l of wrap(this.blow() ?? '', r.w - 8).filter(Boolean).slice(0, 2)) {
      ui.text(r.x + r.w / 2, y, l, { align: 'center', color: 'orange' });
      y += 9;
    }
    y += 3;
    ui.rect(r.x + 2, y - 2, r.w - 4, 1, 'slate');
    y += 2;
    const bh = this.buttonH;
    const bottom = r.y + r.h - bh - 15; // the penalty line and the buttons
    if (this.details) this.drawTables(ui, r, y, bottom);
    else this.drawSummary(ui, r, y, bottom);
    ui.text(r.x + r.w / 2, r.y + r.h - bh - 13, clip(this.lost(), r.w - 8, measure), { align: 'center', color: 'orange' });
    // Details (or Summary) and Return to town: a pad's Cross presses the focused one, △ toggles the tables
    const bw = Math.floor((r.w - 18) / 2);
    this.buttons = [
      { id: 'details', rect: { x: r.x + 6, y: r.y + r.h - bh - 2, w: bw, h: bh } },
      { id: 'continue', rect: { x: r.x + r.w - 6 - bw, y: r.y + r.h - bh - 2, w: bw, h: bh } },
    ];
    ui.button(this.buttons[0]!.rect, t(this.details ? 'legend.summary' : 'legend.details'), { focus: this.focus === 'details', glyph: 'confirm' });
    ui.button(this.buttons[1]!.rect, t('panel.button.return_to_town'), { focus: this.focus === 'continue', glyph: 'confirm' });
  }

  /** What matters first: the damage taken, its biggest type as one bar, and the tip. */
  private drawSummary(ui: UiCanvas, r: Rect, y: number, bottom: number): void {
    const rc = this.recap;
    const x = r.x + 6;
    const w = r.w - 12;
    const total = num(Math.round(rc.total));
    ui.text(x + w, y, total, { align: 'right', color: 'white' });
    for (const l of wrap(t('panel.death.damage_taken'), w - ui.measure(total) - 8)) {
      ui.text(x, y, l, { color: 'sand' });
      y += 9;
    }
    y += 2;
    const worst = [...DAMAGE_TYPES].sort((a, b) => rc.byType[b] - rc.byType[a])[0]!;
    const v = rc.byType[worst];
    if (v > 0) {
      const label = damageType(worst);
      const share = percent(v / Math.max(1, rc.total));
      const lw = Math.min(Math.floor(w / 3), ui.measure(label) + 6);
      ui.text(x, y, clip(label, lw - 4, (s) => ui.measure(s)), { color: DAMAGE_COLORS[worst] });
      ui.bar(x + lw, y + 1, w - lw - ui.measure(share) - 8, 5, v / Math.max(1, rc.total), DAMAGE_COLORS[worst], 'night');
      ui.text(x + w, y, share, { align: 'right', color: 'white' });
      y += 13;
    }
    for (const l of wrap(t('panel.death.tip', { tip: recapTip(rc.tip) }), w)) {
      if (y + 8 > bottom) break;
      ui.text(x, y, l, { color: 'lime' });
      y += 9;
    }
  }

  /** The tables: damage taken by type on the left, the worst enemies on the right, in the normal font. */
  private drawTables(ui: UiCanvas, r: Rect, y0: number, bottom: number): void {
    const rc = this.recap;
    const measure = (s: string) => ui.measure(s);
    // the left column takes the room its heading and labels need in a longer language (the right one gives it)
    const heading = t('panel.death.damage_taken');
    const total = num(Math.round(rc.total));
    const labels = Math.max(...DAMAGE_TYPES.map((d) => measure(damageType(d))));
    const valueW = Math.max(...DAMAGE_TYPES.map((d) => measure(num(Math.round(rc.byType[d])))));
    const split = Math.max(140, Math.min(Math.floor(r.w * 0.62), Math.max(measure(heading) + measure(total) + 8, labels + 4 + valueW + 34)));
    let y = y0;
    ui.text(r.x + split, y, total, { align: 'right', color: 'white' });
    for (const l of wrap(heading, split - measure(total) - 8)) {
      ui.text(r.x + 4, y, l, { color: 'sand' });
      y += 9;
    }
    y += 1;
    const max = Math.max(1, ...DAMAGE_TYPES.map((d) => rc.byType[d]));
    const labelW = Math.min(split - valueW - 30, labels + 4);
    for (const d of DAMAGE_TYPES) {
      if (y + 8 > bottom) break;
      const v = rc.byType[d];
      const value = num(Math.round(v));
      ui.text(r.x + 4, y, clip(damageType(d), labelW - 4, measure), { color: v > 0 ? DAMAGE_COLORS[d] : 'slate' });
      ui.bar(r.x + 4 + labelW, y + 2, Math.max(8, split - 10 - labelW - valueW), 4, v / max, DAMAGE_COLORS[d], 'night');
      ui.text(r.x + split, y, value, { align: 'right', color: v > 0 ? 'white' : 'slate' });
      y += 9;
    }
    const sx = r.x + split + 14;
    let sy = y0;
    for (const l of wrap(t('panel.death.worst_enemies'), r.x + r.w - 4 - sx)) {
      ui.text(sx, sy, l, { color: 'sand' });
      sy += 9;
    }
    sy += 1;
    for (const s of rc.sources) {
      if (sy + 17 > bottom) break;
      const hits = `${num(Math.round(s.total))} / ${num(s.hits)}`;
      ui.text(sx, sy, clip(s.name, r.x + r.w - 4 - sx, measure), { color: 'mist' });
      ui.text(r.x + r.w - 4, sy + 9, hits, { align: 'right', color: 'white' });
      sy += 19;
    }
  }

  /** What the death cost ("Lost 120 XP and 45 gold"). */
  private lost(): string {
    return t('panel.death.lost', { xp: this.penalty.xp, gold: this.penalty.gold });
  }

  /** A phone in portrait: one column (killer, damage by type, worst enemies, tip), a full-width button. */
  private drawNarrow(ui: UiCanvas, r: Rect): void {
    const rc = this.recap;
    const x = r.x + 3;
    const w = r.w - 6;
    const bottom = r.y + r.h - 28; // the penalty line and the button
    const measure = (s: string) => ui.measure(s);
    let y = r.y + 2;
    for (const l of wrap(this.slainBy(), w).slice(0, 2)) {
      ui.text(r.x + r.w / 2, y, l, { align: 'center', color: 'red' });
      y += 9;
    }
    ui.mini(r.x + r.w / 2, y, clip(this.where, w, miniWidth), 'slate', 'center');
    y += miniStep(this.where, 7);
    const blow = this.blow();
    if (blow) {
      for (const l of wrapText(blow, w, miniWidth).slice(0, 2)) {
        ui.mini(r.x + r.w / 2, y, l, 'orange', 'center');
        y += miniStep(l, 7);
      }
    }
    y += 3;
    const total = num(Math.round(rc.total));
    ui.text(x + w, y, total, { align: 'right', color: 'white' });
    for (const l of wrap(t('panel.death.damage_taken'), w - measure(total) - 4)) {
      ui.text(x, y, l, { color: 'sand' });
      y += 9;
    }
    y += 1;
    const max = Math.max(1, ...DAMAGE_TYPES.map((d) => rc.byType[d]));
    // the labels' column as wide as its widest label, up to half the row (then labels are cut)
    const labelW = Math.min(Math.floor(w / 2), Math.max(...DAMAGE_TYPES.map((d) => miniWidth(damageType(d)))) + 3);
    const rowH = Math.max(...DAMAGE_TYPES.map((d) => miniStep(damageType(d), 7)));
    for (const d of DAMAGE_TYPES) {
      const v = rc.byType[d];
      ui.mini(x, y, clip(damageType(d), labelW - 3, miniWidth), v > 0 ? DAMAGE_COLORS[d] : 'slate');
      ui.bar(x + labelW, y, w - labelW - 18, 4, v / max, DAMAGE_COLORS[d], 'night');
      ui.mini(x + w, y, num(Math.round(v)), v > 0 ? 'white' : 'slate', 'right');
      y += rowH;
    }
    if (rc.sources.length) {
      y += 3;
      for (const l of wrap(t('panel.death.worst_enemies'), w)) {
        ui.text(x, y, l, { color: 'sand' });
        y += 9;
      }
      y += 1;
      for (const s of rc.sources.slice(0, 3)) {
        const v = num(Math.round(s.total));
        ui.mini(x, y, clip(s.name, w - miniWidth(v) - 4, miniWidth), 'mist');
        ui.mini(x + w, y, v, 'white', 'right');
        y += miniStep(s.name, 7);
      }
    }
    y += 4;
    ui.rect(r.x + 2, y - 3, r.w - 4, 1, 'slate');
    for (const l of wrap(t('panel.death.tip', { tip: recapTip(rc.tip) }), w)) {
      if (y + 8 > bottom) break;
      ui.text(x, y, l, { color: 'lime' });
      y += 9;
    }
    ui.mini(r.x + r.w / 2, r.y + r.h - 26, clip(this.lost(), w, miniWidth), 'orange', 'center');
    this.buttons = [{ id: 'continue', rect: { x: r.x, y: r.y + r.h - 17, w: r.w, h: 16 } }];
    ui.button(this.buttons[0]!.rect, t('panel.button.return_to_town'), { focus: true, glyph: 'confirm' });
  }

  input(e: UiEvent): boolean {
    const press = (id: 'details' | 'continue') => {
      if (id === 'details') this.details = !this.details;
      else this.onContinue();
    };
    if (e.kind === 'confirm') press(this.narrow ? 'continue' : this.focus);
    else if ((e.kind === 'key' && (e.code === 'PadY' || e.code === 'KeyV')) || e.kind === 'tab') {
      if (!this.narrow) this.details = !this.details;
    } else if (e.kind === 'nav' && (e.dir === 'left' || e.dir === 'right') && !this.narrow) this.focus = e.dir === 'left' ? 'details' : 'continue';
    else if (e.kind === 'pointer') {
      const b = this.buttons.find((x) => inside(x.rect, e.x, e.y));
      if (b && !this.narrow) this.focus = b.id;
      if (b && e.type === 'down') press(b.id);
    }
    return true;
  }
}

// ------------------------------------------------------------------ level clear: loot window

export class LootWindow implements Panel {
  readonly id = 'loot';
  get title(): string {
    return t('panel.loot.title');
  }
  private focus = 0;
  private rects: Rect[] = [];
  /** Room the shell has (`fit`): a phone wraps the summary, gets tall rows and stacked buttons. */
  private room = { w: 260, h: 150 };
  /** A finger's target height (`fit`'s `tap`): rows and buttons that tall, fewer rows. */
  private tap = 0;

  constructor(
    private readonly loot: () => readonly WorldLoot[],
    private readonly summary: () => string[],
    private readonly take: (l: WorldLoot) => boolean,
    private readonly leave: () => void,
  ) {}

  fit(w: number, h: number, tap = 0): void {
    this.room = { w, h };
    this.tap = tap;
  }

  get narrow(): boolean {
    return this.room.w < 200;
  }

  get size(): { w: number; h: number } {
    return this.narrow ? { w: this.room.w, h: Math.min(this.room.h, 200) } : { w: 260, h: 150 + Math.max(0, this.tap - 14) };
  }

  /** A row's height and a button's (wide layout): a thumb's on a touch screen. */
  private get rowH(): number {
    return this.narrow ? Math.max(14, this.tap) : Math.max(10, this.tap);
  }

  private get buttonH(): number {
    return this.narrow ? Math.max(15, this.tap) : Math.max(14, this.tap);
  }

  private actions(): { id: string; label: string; run: () => void }[] {
    return [
      { id: 'takeAll', label: t('panel.loot.take_all'), run: () => [...this.loot()].forEach((l) => this.take(l)) },
      { id: 'leave', label: t('panel.button.return_to_town'), run: this.leave },
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
    return this.narrow ? 4 : this.tap > 10 ? 3 : 6;
  }

  draw(ui: UiCanvas, r: Rect): void {
    const narrow = this.narrow;
    let y = r.y + 2;
    for (const s of this.summary()) {
      // a phone breaks the line between its " · " parts rather than inside one
      const parts = s.split(' · ');
      const lines: string[] = [];
      for (const p of parts) {
        const joined = lines.length ? `${lines[lines.length - 1]} · ${p}` : p;
        if (lines.length && ui.measure(joined) <= r.w - 6) lines[lines.length - 1] = joined;
        else lines.push(p);
      }
      for (const l of narrow ? lines.flatMap((x) => wrap(x, r.w - 6)) : wrap(s, r.w - 6)) {
        ui.text(r.x + 3, y, l, { color: 'sand' });
        y += narrow ? 9 : 10;
      }
    }
    y += 2;
    const items = this.loot();
    // counts and hints in the normal font (a phone: the mini font, where it can draw them)
    const note = t(items.length ? 'panel.loot.still_on_floor' : 'panel.loot.nothing_left');
    if (narrow) ui.mini(r.x + 3, y, note, 'mist');
    else ui.text(r.x + 3, y, clip(note, r.w - 6, (s) => ui.measure(s)), { color: 'mist' });
    y += narrow ? 8 : 10;
    this.rects = [];
    const rowH = this.rowH;
    const rows = items.slice(0, this.shown);
    rows.forEach((l, i) => {
      const rect = { x: r.x, y, w: r.w, h: rowH };
      this.rects.push(rect);
      if (this.focus === i) ui.rect(rect.x, rect.y, rect.w, rect.h, 'night');
      ui.text(r.x + 4, y + Math.floor((rowH - 8) / 2), clip(l.label, r.w - 8, (s) => ui.measure(s)), { color: l.color });
      y += rowH;
    });
    const more = t('panel.loot.more', { count: items.length - this.shown });
    if (items.length > this.shown) {
      if (narrow) ui.mini(r.x + 4, y + 1, more, 'slate');
      else ui.text(r.x + 4, y + 1, more, { color: 'slate' });
    }
    const bh = this.buttonH;
    this.actions().forEach((a, i) => {
      const rect = narrow
        ? { x: r.x, y: r.y + r.h - (2 - i) * (bh + 2), w: r.w, h: bh }
        : { x: r.x + 6 + i * (r.w / 2), y: r.y + r.h - bh - 2, w: r.w / 2 - 12, h: bh };
      this.rects.push(rect);
      ui.button(rect, a.label, { focus: this.focus === rows.length + i, glyph: 'confirm' });
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

/**
 * Small header panel for NPC lines (shown above the vendor / tree / rift panels): `line` is what
 * `Npc.talk` returned (a line id: the speaker and their words, `talkText`) or text to show as it is.
 */
export function dialogue(ui: UiCanvas, line: string, panel: Rect): void {
  const lines = wrap(talkText(line), Math.min(400, ui.w - 20));
  const w = Math.max(...lines.map((l) => ui.measure(l))) + 10;
  const x = Math.floor((ui.w - w) / 2);
  const y = Math.max(2, panel.y - 30 - lines.length * 9);
  ui.rect(x, y, w, lines.length * 9 + 6, 'ink');
  ui.outline(x, y, w, lines.length * 9 + 6, UI.edge);
  lines.forEach((l, i) => ui.text(x + 5, y + 4 + i * 9, l, { color: 'white' }));
}
