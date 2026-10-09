/**
 * `window.__WORLD__`: what tests and agents drive Engine World through.
 *
 *   __WORLD__.rooms()                 every room: id, title, wing, about
 *   await __WORLD__.goto('lights')    the transition and the load (resolves when the room shows)
 *   __WORLD__.state()                 room, hero, pads, panel, transition, visited
 *   __WORLD__.pad('NIGHT')            step on a pad (by label) without walking there
 *   __WORLD__.knobs() / knob(id, v)   the room's and the engine's live settings
 *   __WORLD__.open('guide' | 'tweak' | 'rooms' | 'pause' | 'glossary'), close()
 *   __WORLD__.guide(id?)              a room's station guide as text (what an agent reads)
 *   __WORLD__.room                    the current room's own hooks (`logic.api`)
 */
import { guideBlocks } from './ui/panels';
import { roomById, rooms, shell } from './shell';
import type { Knob } from './types';

function allKnobs(): Knob[] {
  return [...(shell.room?.logic.knobs ?? []), ...(shell.engine ? shell.engineKnobs() : [])];
}

export const worldApi = {
  rooms: () => rooms().map((r) => ({ id: r.id, title: r.title, wing: r.wing, about: r.about })),
  goto: (id: string, o?: { instant?: boolean }) => shell.goto(id, o),
  leave: () => shell.leave(),
  reset: () => shell.reset(),
  get room() {
    return shell.room?.logic.api ?? null;
  },
  state() {
    const r = shell.room;
    const h = r?.visitor?.hero;
    const p = r?.visitor?.position;
    return {
      room: r?.def.id ?? null,
      title: r?.def.title ?? null,
      busy: shell.busy,
      visited: [...shell.visited],
      panel: shell.layer.top?.panel.id ?? null,
      transition: shell.transition,
      hero: h && p ? { at: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], state: h.state, anim: h.anim } : null,
      pads: r?.kit.pads.map((pad) => ({ label: pad.def.label, active: pad.active, group: pad.def.group ?? null })) ?? [],
      labels: r?.kit.labels.length ?? 0,
      status: r?.logic.status?.() ?? '',
    };
  },
  /** Step on the first pad with this label. */
  pad(label: string): boolean {
    const r = shell.room;
    const pad = r?.kit.pads.find((p) => p.def.label.toUpperCase() === label.toUpperCase());
    if (!r || !pad) return false;
    (r as unknown as { padStepped(p: typeof pad): void }).padStepped(pad);
    return true;
  },
  knobs: () =>
    allKnobs().map((k) => (k.kind === 'choice' ? { id: k.id, label: k.label, options: k.options, value: k.get() } : k.kind === 'toggle' ? { id: k.id, label: k.label, value: k.get() } : { id: k.id, label: k.label, min: k.min, max: k.max, value: k.get() })),
  knob(id: string, value: number | boolean): boolean {
    const k = allKnobs().find((x) => x.id === id);
    if (!k) return false;
    if (k.kind === 'toggle') k.set(Boolean(value));
    else k.set(Number(value));
    return true;
  },
  open(panel: 'guide' | 'tweak' | 'rooms' | 'pause' | 'glossary'): string | null {
    if (panel === 'guide') shell.openGuide();
    else if (panel === 'tweak') shell.openTweak();
    else if (panel === 'rooms') shell.openRooms();
    else if (panel === 'pause') shell.openPause();
    else shell.openGlossary();
    return shell.layer.top?.panel.id ?? null;
  },
  close: () => shell.layer.closeAll(),
  /** A station guide as plain text lines (headings in caps). */
  guide(id?: string): string[] {
    const def = id ? roomById(id) : shell.room?.def;
    if (!def) return [];
    const isCurrent = shell.room?.def === def;
    const blocks = guideBlocks(def, isCurrent ? shell.room!.kit.pads : [], isCurrent ? (shell.room!.logic.knobs ?? []) : []);
    return blocks.map((b) => (b.kind === 'h' ? `## ${b.text}` : b.kind === 'code' ? `[${b.title}] ${b.file}\n${b.src}` : b.kind === 'gap' ? '' : b.kind === 'li' ? `${b.bullet ?? '-'} ${b.text}` : b.text));
  },
};

export type WorldApi = typeof worldApi;
