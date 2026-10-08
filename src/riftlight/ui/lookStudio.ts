/**
 * The Look Studio: every engine filter, per part of the picture, with presets and sliders.
 *
 *   Look       a whole look (LOOK_PRESETS: retro stacks, a clean world with pixel heroes, …)
 *   Apply to   whole scene · characters (+ objects) · environment
 *   Pixel art  on / off (clean, full resolution), preset, pixel size, outline, creases
 *   Cel shading, Palettes, Colour grade, Consoles, Screen, Signal, Stylize
 *              a page per filter type: each filter on / off for the chosen part, its preset
 *              and a slider per parameter (strength included)
 *
 * Pages dock beside the picture without dimming it, so every change shows at once. Every
 * change goes through `LookHost.setLook` (the shell applies and remembers it). Pure widget
 * data over `Look` (engine/render/look.ts): the engine does the rendering.
 */
import {
  DEFAULT_PIXEL,
  FILTERS,
  LOOK_PRESETS,
  LOOK_TARGET_LABELS,
  PIXEL_PARAMS,
  PIXEL_PRESETS,
  clampParam,
  defaultLook,
  defaultParams,
  filterOrder,
  filterParams,
  filterPresetOf,
  filterPresets,
  getFilter,
  lookFilters,
  lookPresetOf,
  paramsOf,
  type FilterGroup,
  type FilterParam,
  type Look,
  type LookTarget,
  type PixelLook,
} from '../../engine';
import { Menu, type Widget } from './menu';

export interface LookHost {
  /** The look on screen (a copy). */
  look(): Look;
  /** Apply a look and remember it (settings). */
  setLook(look: Look): void;
  /** Open a studio page beside the picture (no dimming, the pages under it hidden). */
  openStudioPage(menu: Menu): void;
  sound(s: 'click' | 'move'): void;
}

export const LOOK_STUDIO_TARGETS: readonly LookTarget[] = ['scene', 'actors', 'environment'];
const TARGET_SHORT: Readonly<Record<LookTarget, string>> = {
  scene: 'whole scene',
  actors: 'characters',
  environment: 'environment',
};

/** Filter names that fit a menu row (the full name is the row's hint). */
const SHORT: Readonly<Record<string, string>> = {
  cel: 'Cel shading',
  '8bit': '8-bit NES',
  '16bit': '16-bit',
  ps1: 'PlayStation',
  sweetie16: 'Sweetie 16',
  pico8: 'PICO-8',
  nes: 'NES',
  c64: 'C64',
  zx: 'ZX Spectrum',
  ega: 'EGA',
  cga: 'CGA',
  gameboy: 'Game Boy',
  gbpocket: 'GB Pocket',
  virtualboy: 'Virtual Boy',
  onebit: '1-bit Mac',
  dither: 'Dither',
  posterize: 'Posterize',
  grayscale: 'Grayscale',
  sepia: 'Sepia',
  invert: 'Invert',
  bleach: 'Bleach',
  sunset: 'Sunset',
  moonlight: 'Moonlight',
  thermal: 'Thermal',
  nightvision: 'Night vision',
  scanlines: 'Scanlines',
  lcd: 'LCD grid',
  crt: 'CRT',
  vignette: 'Vignette',
  chromatic: 'Chromatic',
  grain: 'Film grain',
  vhs: 'VHS tape',
  ntsc: 'NTSC bleed',
  bloom: 'Bloom',
  halftone: 'Halftone',
  sketch: 'Ink sketch',
};

export const filterName = (id: string): string => SHORT[id] ?? getFilter(id)?.label ?? id;

/** The studio's pages of filters, one per filter type. */
export const LOOK_SECTIONS: readonly {
  id: string;
  label: string;
  groups: readonly FilterGroup[];
  hint: string;
}[] = [
  {
    id: 'shading',
    label: 'Cel shading',
    groups: ['shading'],
    hint: 'flat light bands and ink lines',
  },
  {
    id: 'palette',
    label: 'Palettes',
    groups: ['palette'],
    hint: 'retro palettes, dither, posterize',
  },
  {
    id: 'color',
    label: 'Colour grade',
    groups: ['color'],
    hint: 'grayscale, sepia, moonlight...',
  },
  {
    id: 'era',
    label: 'Consoles',
    groups: ['era'],
    hint: '8-bit, 16-bit, PlayStation',
  },
  {
    id: 'display',
    label: 'Screen',
    groups: ['display'],
    hint: 'scanlines, LCD, CRT, vignette',
  },
  {
    id: 'signal',
    label: 'Signal',
    groups: ['signal'],
    hint: 'chromatic, grain, VHS, NTSC',
  },
  {
    id: 'stylize',
    label: 'Stylize',
    groups: ['stylize'],
    hint: 'bloom, halftone, ink sketch',
  },
];

const nice = (name: string) => name.replace(/_/g, ' ');

/** Value text for a parameter (fits the slider's 34-pixel value column). */
export function formatParam(p: FilterParam, v: number): string {
  const num = (x: number) => String(Number(x.toFixed(2)));
  if (p.unit === '%') return `${Math.round(v * 100)}%`;
  if (p.unit === 'x') return `${num(v)}x`;
  if (p.unit === 'px') return `${num(v)}px`;
  return num(v);
}

function paramSlider(id: string, label: string, p: FilterParam, get: () => number, set: (v: number) => void, hint?: string): Widget {
  const span = p.max - p.min;
  return {
    kind: 'slider',
    id,
    label,
    get: () => (get() - p.min) / span,
    set: (u) => set(clampParam(p, p.min + u * span)),
    step: (u, dir) => (clampParam(p, p.min + u * span + dir * p.step) - p.min) / span,
    format: () => formatParam(p, get()),
    changed: () => Math.abs(get() - p.default) > 1e-9,
    hint,
  };
}

/** A preset picker that lists `custom` only while the values match no preset (so cycling never sticks on it). */
function presetChoice(id: string, label: string, names: readonly string[], current: string | null, apply: (name: string) => void, hint?: string): Widget {
  const options = current ? names.map(nice) : [...names.map(nice), 'custom'];
  return {
    kind: 'choice',
    id,
    label,
    options,
    get: () => (current ? names.indexOf(current) : names.length),
    set: (i) => {
      if (i < names.length) apply(names[i]!);
    },
    hint,
  };
}

const edit = (h: LookHost, fn: (look: Look) => void) => {
  const look = h.look();
  fn(look);
  h.setLook(look);
};

/** Pixel settings of a target: the layer's, or for the whole scene the characters' (else the environment's). */
export function pixelOf(look: Look, t: LookTarget): PixelLook | null {
  return t === 'scene' ? (look.actors.pixel ?? look.environment.pixel) : look[t].pixel;
}

/** Pixel art is on for a target: the layer has it, or for the whole scene both layers do. */
export function pixelOn(look: Look, t: LookTarget): boolean {
  return t === 'scene' ? !!look.actors.pixel && !!look.environment.pixel : !!look[t].pixel;
}

export function setPixel(look: Look, t: LookTarget, p: PixelLook | null): void {
  if (t === 'scene') {
    look.actors.pixel = p && { ...p };
    look.environment.pixel = p && { ...p };
  } else look[t].pixel = p && { ...p };
}

/** Turn a filter on (with its defaults, at its canonical place) or off for a target. */
export function toggleFilter(look: Look, t: LookTarget, id: string, on: boolean): void {
  const list = lookFilters(look, t);
  const i = list.findIndex((f) => f.id === id);
  const def = getFilter(id);
  if (on && i < 0 && def) {
    if (t !== 'scene' && def.sceneOnly) return; // moves pixels: whole scene only
    // at its canonical place, the rest of the stack untouched (a preset's order stays)
    const at = list.findIndex((f) => filterOrder(f.id) > filterOrder(id));
    list.splice(at < 0 ? list.length : at, 0, { id, params: defaultParams(def) });
  }
  if (!on && i >= 0) list.splice(i, 1);
}

/** Short text of what is on for a target ("pixel 2x · cel · NES"). */
export function lookSummary(look: Look, t: LookTarget): string {
  const parts: string[] = [];
  if (t === 'scene') {
    const a = look.actors.pixel;
    const e = look.environment.pixel;
    if (a && e) parts.push(a.size === e.size ? `pixel ${a.size}x` : 'pixel');
    else if (a || e) parts.push(a ? 'pixel characters' : 'pixel world');
    else parts.push('clean');
  } else {
    const p = look[t].pixel;
    parts.push(p ? `pixel ${p.size}x` : 'clean');
  }
  for (const f of lookFilters(look, t)) parts.push(filterName(f.id).toLowerCase());
  return parts.join(' · ');
}

function pixelText(look: Look, t: LookTarget): string {
  if (t === 'scene') {
    const a = look.actors.pixel;
    const e = look.environment.pixel;
    if (!a && !e) return 'off';
    if (!a || !e) return 'mixed';
    return a.size === e.size ? `${a.size}x` : 'mixed';
  }
  const p = look[t].pixel;
  return p ? `${p.size}x` : 'off';
}

function sectionText(look: Look, t: LookTarget, groups: readonly FilterGroup[]): string {
  const on = lookFilters(look, t).filter((f) => groups.includes(getFilter(f.id)?.group ?? 'era'));
  if (!on.length) return 'off';
  const first = filterName(on[0]!.id);
  return on.length > 1 ? `${first} +${on.length - 1}` : first;
}

// narrow enough that the hero (centre of the screen) stays in view beside the panel
const MAIN = { id: 'look', title: 'Look studio', width: 172, labelWidth: 58 };
const PAGE = { width: 176, labelWidth: 84 };

/** Shared by every page of one studio: the part of the picture being edited. */
interface StudioState {
  target: LookTarget;
}

export function lookStudio(h: LookHost): Menu {
  const st: StudioState = { target: 'scene' };
  const names = Object.keys(LOOK_PRESETS);
  const onSound = (s: 'click' | 'move') => h.sound(s);
  return new Menu(
    () => {
      const look = h.look();
      const t = st.target;
      const w: Widget[] = [
        presetChoice('preset', 'Look', names, lookPresetOf(look), (n) => h.setLook(LOOK_PRESETS[n]!), 'a whole look to start from, then tweak it'),
        {
          kind: 'choice',
          id: 'target',
          label: 'Apply to',
          options: LOOK_STUDIO_TARGETS.map((x) => TARGET_SHORT[x]),
          get: () => LOOK_STUDIO_TARGETS.indexOf(st.target),
          set: (i) => (st.target = LOOK_STUDIO_TARGETS[i]!),
          hint: 'whole scene, characters + objects, or environment',
        },
        {
          kind: 'label',
          id: 'summary',
          label: lookSummary(look, t).slice(0, 30),
          color: 'sand',
        },
        {
          kind: 'button',
          id: 'pixel',
          label: `Pixel art: ${pixelText(look, t)}`,
          onClick: () => h.openStudioPage(pixelPage(h, st)),
          hint: 'pixel size and outlines, or clean',
        },
      ];
      for (const sec of LOOK_SECTIONS) {
        w.push({
          kind: 'button',
          id: sec.id,
          label: `${sec.label}: ${sectionText(look, t, sec.groups)}`,
          onClick: () => h.openStudioPage(sectionPage(h, st, sec)),
          hint: sec.hint,
        });
      }
      w.push(
        { kind: 'gap', id: 'g', h: 4 },
        {
          kind: 'button',
          id: 'clear',
          label: `Clear ${TARGET_SHORT[t]} filters`,
          onClick: () => edit(h, (l) => lookFilters(l, t).splice(0)),
          hint: 'turns off every filter of this part (pixel art stays)',
        },
        {
          kind: 'button',
          id: 'reset',
          label: 'Reset to default',
          onClick: () => h.setLook(defaultLook()),
          accent: 'plum',
          hint: 'pixel art everywhere, no filters',
        },
      );
      return w;
    },
    { ...MAIN, footer: () => `editing: ${TARGET_SHORT[st.target]}`, onSound },
  );
}

function pageHeader(t: LookTarget): Widget {
  return {
    kind: 'label',
    id: 'for',
    label: LOOK_TARGET_LABELS[t],
    color: 'sand',
  };
}

function pixelPage(h: LookHost, st: StudioState): Menu {
  return new Menu(
    () => {
      const t = st.target;
      const look = h.look();
      const w: Widget[] = [pageHeader(t)];
      const mixed = t === 'scene' && pixelText(look, t) === 'mixed';
      w.push({
        kind: 'toggle',
        id: 'on',
        label: 'Pixel art',
        get: () => pixelOn(h.look(), t),
        set: (v) => edit(h, (l) => setPixel(l, t, v ? (pixelOf(l, t) ?? DEFAULT_PIXEL) : null)),
        hint: 'off = clean, full resolution',
      });
      if (mixed)
        w.push({
          kind: 'label',
          id: 'mixed',
          label: 'layers differ: edits set both',
          color: 'orange',
        });
      const p = pixelOf(look, t);
      if (p && (pixelOn(look, t) || mixed)) {
        const presetNames = Object.keys(PIXEL_PRESETS);
        const current = presetNames.find((n) => {
          const q = PIXEL_PRESETS[n]!;
          return q.size === p.size && q.outline === p.outline && q.crease === p.crease;
        });
        w.push(
          presetChoice(
            'preset',
            'Preset',
            presetNames,
            mixed ? null : (current ?? null),
            (n) => edit(h, (l) => setPixel(l, t, PIXEL_PRESETS[n]!)),
            'crisp, chunky, blocky, mosaic...',
          ),
        );
        for (const q of PIXEL_PARAMS) {
          w.push(
            paramSlider(
              q.key,
              q.label,
              q,
              () => (pixelOf(h.look(), t) as unknown as Record<string, number> | null)?.[q.key] ?? q.default,
              (v) =>
                edit(h, (l) =>
                  setPixel(l, t, {
                    ...(pixelOf(l, t) ?? DEFAULT_PIXEL),
                    [q.key]: v,
                  }),
                ),
            ),
          );
        }
      }
      return w;
    },
    {
      id: 'look.pixel',
      title: 'Pixel art',
      ...PAGE,
      footer: () => `editing: ${TARGET_SHORT[st.target]}`,
      onSound: (s) => h.sound(s),
    },
  );
}

function sectionPage(h: LookHost, st: StudioState, sec: (typeof LOOK_SECTIONS)[number]): Menu {
  const defs = FILTERS.filter((f) => sec.groups.includes(f.group));
  return new Menu(
    () => {
      const t = st.target;
      const look = h.look();
      const w: Widget[] = [pageHeader(t)];
      for (const def of defs) {
        if (t !== 'scene' && def.sceneOnly) {
          // a warp on one layer would no longer line up with the other
          w.push({ kind: 'label', id: def.id, label: `${filterName(def.id)}: whole scene only`, color: 'slate' });
          continue;
        }
        const on = lookFilters(look, t).find((f) => f.id === def.id);
        w.push({
          kind: 'toggle',
          id: def.id,
          label: filterName(def.id),
          get: () => lookFilters(h.look(), t).some((f) => f.id === def.id),
          set: (v) => edit(h, (l) => toggleFilter(l, t, def.id, v)),
          hint: def.label,
        });
        if (!on) continue;
        const values = paramsOf(on);
        const presets = filterPresets(def);
        const defaults = defaultParams(def);
        const current = filterPresetOf(presets, defaults, values);
        w.push(
          presetChoice(`${def.id}.preset`, '  Preset', Object.keys(presets), current, (n) =>
            edit(h, (l) => {
              const f = lookFilters(l, t).find((x) => x.id === def.id);
              if (f)
                f.params = {
                  ...defaults,
                  amount: paramsOf(f).amount ?? 1,
                  ...presets[n],
                };
            }),
          ),
        );
        for (const p of filterParams(def)) {
          w.push(
            paramSlider(
              `${def.id}.${p.key}`,
              `  ${p.label}`,
              p,
              () => {
                const f = lookFilters(h.look(), t).find((x) => x.id === def.id);
                return f ? (paramsOf(f)[p.key] ?? p.default) : p.default;
              },
              (v) =>
                edit(h, (l) => {
                  const f = lookFilters(l, t).find((x) => x.id === def.id);
                  if (f) f.params = { ...paramsOf(f), [p.key]: v };
                }),
              `${def.label}: ${p.label.toLowerCase()}`,
            ),
          );
        }
      }
      return w;
    },
    {
      id: `look.${sec.id}`,
      title: sec.label,
      ...PAGE,
      footer: () => `editing: ${TARGET_SHORT[st.target]}`,
      onSound: (s) => h.sound(s),
    },
  );
}
