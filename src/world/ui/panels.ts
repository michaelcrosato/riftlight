/**
 * The world's panels, built from room data: the station guide (H), the tweak panel (T),
 * the room list (G), the pause menu (Esc) and the field guide. Everything is a Riftlight UI
 * kit panel (mouse, touch, keys and gamepad alike).
 */
import { Menu, type Widget } from '../../riftlight/ui/menu';
import { GLOSSARY, SECTIONS, term } from '../glossary';
import type { Knob, RoomDef } from '../types';
import { wing, WINGS } from '../wings';
import type { Pad } from '../kit/RoomKit';
import { type Block, Reader } from './reader';

/** A knob as a menu widget. */
export function knobWidget(k: Knob): Widget {
  if (k.kind === 'choice') return { kind: 'choice', id: k.id, label: k.label, options: k.options, get: k.get, set: k.set, hint: k.hint };
  if (k.kind === 'toggle') return { kind: 'toggle', id: k.id, label: k.label, get: k.get, set: k.set, hint: k.hint };
  const span = k.max - k.min || 1;
  const snap = (v: number) => Math.min(k.max, Math.max(k.min, Math.round((v - k.min) / k.step) * k.step + k.min));
  const toU = (v: number) => (v - k.min) / span;
  return {
    kind: 'slider',
    id: k.id,
    label: k.label,
    get: () => toU(k.get()),
    set: (u) => k.set(snap(k.min + u * span)),
    step: (u, dir) => toU(snap(k.min + u * span + dir * k.step)),
    format: () => (k.format ? k.format(k.get()) : formatNumber(k.get())),
    changed: () => k.initial !== undefined && Math.abs(k.get() - k.initial) > k.step / 2,
    hint: k.hint,
  };
}

export function formatNumber(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** The station guide's pages for a room. */
export function guideBlocks(def: RoomDef, pads: readonly Pad[], knobs: readonly Knob[]): Block[] {
  const g = def.guide;
  const blocks: Block[] = [{ kind: 'p', text: `${wing(def.wing).title} wing`, color: wing(def.wing).color }];
  blocks.push({ kind: 'h', text: "What you're seeing" }, { kind: 'p', text: g.what });
  blocks.push({ kind: 'h', text: 'How it works' });
  g.how.forEach((step, i) => blocks.push({ kind: 'li', text: step, bullet: `${i + 1}.` }));
  const named = new Map<string, Pad>();
  for (const p of pads) if (!named.has(p.def.label)) named.set(p.def.label, p);
  if (named.size) {
    blocks.push({ kind: 'h', text: 'The pads' });
    for (const p of named.values()) blocks.push({ kind: 'li', text: `${p.def.label}: ${p.def.note}` });
  }
  if (knobs.length) {
    blocks.push({ kind: 'h', text: 'Tweak it live' });
    blocks.push({ kind: 'p', text: `Press T for sliders: ${knobs.map((k) => k.label).join(', ')}. Pads and leaving the room set them back.` });
  }
  blocks.push({ kind: 'h', text: 'Try this' });
  for (const t of def.try) blocks.push({ kind: 'li', text: t });
  blocks.push({ kind: 'h', text: 'Where games use it' });
  for (const u of g.uses) blocks.push({ kind: 'li', text: u });
  blocks.push({ kind: 'h', text: 'Ask for it like...' });
  for (const a of g.ask) blocks.push({ kind: 'li', text: `"${a}"`, color: 'cyan' });
  blocks.push({ kind: 'h', text: 'What it costs' }, { kind: 'p', text: g.cost });
  if (g.code?.length) {
    blocks.push({ kind: 'h', text: "The engine's code" });
    for (const c of g.code) blocks.push({ kind: 'code', title: c.title, file: c.file, src: c.src }, { kind: 'gap', h: 4 });
  }
  if (g.words?.length) {
    blocks.push({ kind: 'h', text: 'Words' });
    for (const w of g.words) {
      const t = term(w);
      blocks.push({ kind: 'li', text: t ? `${t.term}: ${t.text}` : w });
    }
  }
  return blocks;
}

export function guidePanel(def: RoomDef, pads: readonly Pad[], knobs: readonly Knob[]): Reader {
  return new Reader('guide', `${def.title}: how it works`, guideBlocks(def, pads, knobs), { width: 250, height: 236 });
}

/** The field guide: every word, by section. */
export function fieldGuide(): Reader {
  const blocks: Block[] = [{ kind: 'p', text: 'Every word the station guides use. Tab jumps between sections.' }];
  for (const [id, title] of Object.entries(SECTIONS)) {
    const terms = GLOSSARY.filter((t) => t.section === id);
    if (!terms.length) continue;
    blocks.push({ kind: 'h', text: title });
    for (const t of terms) blocks.push({ kind: 'li', text: `${t.term}: ${t.text}` });
  }
  return new Reader('glossary', 'Field guide', blocks, { width: 250, height: 236 });
}

/** The tweak panel: the room's knobs, then the engine's. */
export function tweakMenu(title: string, room: readonly Knob[], engine: readonly Knob[], onBack: () => void): Menu {
  const widgets = (): Widget[] => [
    ...(room.length ? [{ kind: 'label' as const, id: 'l-room', label: 'This room' }, ...room.map(knobWidget)] : []),
    { kind: 'label', id: 'l-engine', label: 'Engine' },
    ...engine.map(knobWidget),
  ];
  return new Menu(widgets, { id: 'tweak', title, width: 236, labelWidth: 110, onBack, footer: () => 'arrows change · esc closes' });
}

/** The room list (G): every room by wing; visited ones are ticked. */
export function roomsMenu(rooms: readonly RoomDef[], current: string, visited: ReadonlySet<string>, go: (id: string) => void, onBack: () => void): Menu {
  const widgets: Widget[] = [];
  for (const w of WINGS) {
    const list = rooms.filter((r) => r.wing === w.id);
    if (!list.length) continue;
    widgets.push({ kind: 'label', id: `wing-${w.id}`, label: w.title, color: w.color });
    for (const r of list) {
      const mark = r.id === current ? '> ' : visited.has(r.id) ? '* ' : '';
      widgets.push({ kind: 'button', id: `room-${r.id}`, label: `${mark}${r.title}`, onClick: () => go(r.id), hint: r.about.split('. ')[0]!.slice(0, 60) });
    }
  }
  return new Menu(widgets, { id: 'rooms', title: 'Go to a room', width: 220, onBack });
}

export interface PauseActions {
  resume(): void;
  guide(): void;
  tweak(): void;
  rooms(): void;
  glossary(): void;
  atrium(): void;
  reset(): void;
  /** Leave for Riftlight, the game this engine was built for. */
  riftlight(): void;
}

export function pauseMenu(inAtrium: boolean, a: PauseActions): Menu {
  const widgets: Widget[] = [
    { kind: 'button', id: 'resume', label: 'Resume', onClick: a.resume },
    { kind: 'button', id: 'guide', label: 'How it works (H)', onClick: a.guide },
    { kind: 'button', id: 'tweak', label: 'Tweak (T)', onClick: a.tweak },
    { kind: 'button', id: 'rooms', label: 'Go to a room (G)', onClick: a.rooms },
    { kind: 'button', id: 'glossary', label: 'Field guide', onClick: a.glossary },
    ...(inAtrium ? [] : [{ kind: 'button' as const, id: 'atrium', label: 'Back to the Atrium', onClick: a.atrium }]),
    { kind: 'button', id: 'reset', label: 'Reset room', onClick: a.reset },
    { kind: 'button', id: 'riftlight', label: 'Play Riftlight', onClick: a.riftlight, hint: 'the game built on this engine' },
  ];
  return new Menu(widgets, { id: 'pause', title: 'Engine World', width: 170, onBack: a.resume });
}
