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
 * Pages dock beside the picture without dimming it, so every change shows at once; H (or
 * "Hide panel") hides the panel altogether while the arrows still tweak the focused control,
 * named in a strip at the top. Every change goes through `LookHost.setLook` (the shell
 * applies and remembers it). Pure widget data over `Look` (engine/render/look.ts): the
 * engine does the rendering.
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
  lookPresetLabel,
  lookPresetOf,
  paramsOf,
  type FilterDef,
  type FilterGroup,
  type FilterParam,
  type Look,
  type LookTarget,
  type PixelLook,
} from '../../engine';
import { lang, lineKey, t } from '../lang';
import { Menu, type Widget } from './menu';

export interface LookHost {
  /** The look on screen (a copy). */
  look(): Look;
  /** Apply a look and remember it (settings). */
  setLook(look: Look): void;
  /** Open a studio page beside the picture (no dimming, the pages under it hidden). */
  openStudioPage(menu: Menu): void;
  /** Hide the studio (or show it again): the whole picture, while keys still tweak the focused control. */
  peek?(): void;
  sound(s: 'click' | 'move'): void;
}

export const LOOK_STUDIO_TARGETS: readonly LookTarget[] = ['scene', 'actors', 'environment'];

/**
 * The studio's words are lines (lang/shell.ts), most made from the engine's registries (filters,
 * their parameters and presets, the looks): an id's line, or the registry's English for one
 * added since the line list was made.
 */
const lineOr = (id: string, english: string): string => (lang().has(id) ? t(id) : english);

/** A part of the picture, short ("whole scene", "characters"). */
const targetShort = (target: LookTarget): string => t(lineKey('look.target', target, 'short'));

/** A filter's name that fits a menu row (`look.filter.<id>`; the full name is its row's hint). */
export const filterName = (id: string): string => lineOr(lineKey('look.filter', id), getFilter(id)?.label ?? id);

/** A filter's full name (`look.filter.<id>.full`, else its short one). */
const filterFull = (id: string): string => lineOr(lineKey('look.filter', id, 'full'), filterName(id));

/** A filter parameter's name (strength is every filter's: `look.param.amount`); `def` null: a pixel-art parameter. */
function paramName(def: FilterDef | null, p: FilterParam): string {
  if (p.key === 'amount') return t('look.param.amount');
  return lineOr(def ? lineKey('look.filter', def.id, 'param', p.key) : lineKey('look.pixel.param', p.key), p.label);
}

/** The studio's pages of filters, one per filter type (their names and hints: `look.section.<id>`, `.hint`). */
export const LOOK_SECTIONS: readonly {
  id: string;
  groups: readonly FilterGroup[];
}[] = [
  { id: 'shading', groups: ['shading'] },
  { id: 'palette', groups: ['palette'] },
  { id: 'color', groups: ['color'] },
  { id: 'era', groups: ['era'] },
  { id: 'display', groups: ['display'] },
  { id: 'signal', groups: ['signal'] },
  { id: 'stylize', groups: ['stylize'] },
];

const sectionName = (id: string): string => t(lineKey('look.section', id));
const sectionHint = (id: string): string => t(lineKey('look.section', id, 'hint'));

const nice = (name: string) => name.replace(/_/g, ' ');

/** A whole look's name (`look.whole.<name>`; `none` is the default). */
export const lookName = (name: string): string => lineOr(lineKey('look.whole', name), lookPresetLabel(name));
/** A pixel-art preset's name (`look.pixel.presets.<name>`). */
const pixelPresetName = (name: string): string => lineOr(lineKey('look.pixel.presets', name), nice(name));
/** A filter preset's name: the filter's own (`look.filter.<id>.preset.<name>`), else a strength (`look.strength.<name>`). */
const filterPresetName = (def: FilterDef, name: string): string => (def.presets ? lineOr(lineKey('look.filter', def.id, 'preset', name), nice(name)) : lineOr(lineKey('look.strength', name), nice(name)));

/** Value text for a parameter (fits the slider's 34-pixel value column), in the language's digits. */
export function formatParam(p: FilterParam, v: number): string {
  const num = (x: number) => lang().formatNumber(Number(x.toFixed(2)), { maximumFractionDigits: 2 });
  if (p.unit === '%') return lang().formatNumber(Math.round(v * 100) / 100, { style: 'percent' });
  if (p.unit === 'x') return t('look.unit.times', { value: num(v) });
  if (p.unit === 'px') return t('look.unit.px', { value: num(v) });
  return num(v);
}

function paramSlider(id: string, label: string, p: FilterParam, get: () => number, set: (v: number) => void, hint?: string, name?: string, indent?: boolean): Widget {
  const span = p.max - p.min;
  return {
    kind: 'slider',
    id,
    label,
    name,
    indent,
    get: () => (get() - p.min) / span,
    set: (u) => set(clampParam(p, p.min + u * span)),
    step: (u, dir) => (clampParam(p, p.min + u * span + dir * p.step) - p.min) / span,
    format: () => formatParam(p, get()),
    changed: () => Math.abs(get() - p.default) > 1e-9,
    hint,
  };
}

/** A preset picker that lists `custom` only while the values match no preset (so cycling never sticks on it). */
function presetChoice(
  id: string,
  label: string,
  names: readonly string[],
  current: string | null,
  apply: (name: string) => void,
  hint: string | undefined,
  name: string | undefined,
  labelOf: (name: string) => string,
  indent?: boolean,
): Widget {
  const options = current ? names.map(labelOf) : [...names.map(labelOf), t('look.custom')];
  return {
    kind: 'choice',
    id,
    label,
    name,
    indent,
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
export function lookSummary(look: Look, target: LookTarget): string {
  const parts: string[] = [];
  if (target === 'scene') {
    const a = look.actors.pixel;
    const e = look.environment.pixel;
    if (a && e) parts.push(a.size === e.size ? t('look.summary.pixel_size', { size: a.size }) : t('look.summary.pixel'));
    else if (a || e) parts.push(t(a ? 'look.summary.pixel_characters' : 'look.summary.pixel_world'));
    else parts.push(t('look.summary.clean'));
  } else {
    const p = look[target].pixel;
    parts.push(p ? t('look.summary.pixel_size', { size: p.size }) : t('look.summary.clean'));
  }
  for (const f of lookFilters(look, target)) parts.push(filterName(f.id));
  return parts.join(' · ');
}

function pixelText(look: Look, target: LookTarget): string {
  if (target === 'scene') {
    const a = look.actors.pixel;
    const e = look.environment.pixel;
    if (!a && !e) return t('look.state.off');
    if (!a || !e) return t('look.state.mixed');
    return a.size === e.size ? t('look.state.size', { size: a.size }) : t('look.state.mixed');
  }
  const p = look[target].pixel;
  return p ? t('look.state.size', { size: p.size }) : t('look.state.off');
}

/** Pixel art on one layer and off the other (the whole scene's row then edits both). */
function pixelMixed(look: Look, target: LookTarget): boolean {
  return target === 'scene' && (!look.actors.pixel !== !look.environment.pixel || (!!look.actors.pixel && look.actors.pixel.size !== look.environment.pixel?.size));
}

function sectionText(look: Look, target: LookTarget, groups: readonly FilterGroup[]): string {
  const on = lookFilters(look, target).filter((f) => groups.includes(getFilter(f.id)?.group ?? 'era'));
  if (!on.length) return t('look.state.off');
  const first = filterName(on[0]!.id);
  return on.length > 1 ? t('look.state.more', { filter: first, count: on.length - 1 }) : first;
}

// narrow enough that the hero (centre of the screen) stays in view beside the panel
const MAIN = { id: 'look', width: 172, labelWidth: 58 };
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
      const target = st.target;
      const w: Widget[] = [
        presetChoice('preset', t('look.row.look'), names, lookPresetOf(look), (n) => h.setLook(LOOK_PRESETS[n]!), t('look.row.look.hint'), t('look.row.look'), lookName),
        {
          kind: 'choice',
          id: 'target',
          label: t('look.row.target'),
          options: LOOK_STUDIO_TARGETS.map(targetShort),
          get: () => LOOK_STUDIO_TARGETS.indexOf(st.target),
          set: (i) => (st.target = LOOK_STUDIO_TARGETS[i]!),
          hint: t('look.row.target.hint'),
        },
        {
          kind: 'label',
          id: 'summary',
          label: lookSummary(look, target),
          color: 'sand',
        },
        {
          kind: 'button',
          id: 'pixel',
          label: t('look.row.pixel', { state: pixelText(look, target) }),
          onClick: () => h.openStudioPage(pixelPage(h, st)),
          hint: t('look.row.pixel.hint'),
        },
      ];
      for (const sec of LOOK_SECTIONS) {
        w.push({
          kind: 'button',
          id: sec.id,
          label: t('look.row.section', { section: sectionName(sec.id), state: sectionText(look, target, sec.groups) }),
          onClick: () => h.openStudioPage(sectionPage(h, st, sec)),
          hint: sectionHint(sec.id),
        });
      }
      w.push(
        ...peekButton(h),
        { kind: 'gap', id: 'g', h: 4 },
        {
          kind: 'button',
          id: 'clear',
          label: t(lineKey('look.clear', target)),
          onClick: () => edit(h, (l) => lookFilters(l, target).splice(0)),
          hint: t('look.clear.hint'),
        },
        {
          kind: 'button',
          id: 'reset',
          label: t('look.reset'),
          onClick: () => h.setLook(defaultLook()),
          accent: 'plum',
          hint: t('look.reset.hint'),
        },
      );
      return w;
    },
    { ...MAIN, title: t('look.title'), footer: () => t(lineKey('look.editing', st.target)), onSound },
  );
}

function pageHeader(target: LookTarget): Widget {
  return {
    kind: 'label',
    id: 'for',
    label: lineOr(lineKey('look.target', target), LOOK_TARGET_LABELS[target]),
    color: 'sand',
  };
}

/** "Hide panel (H)": the whole picture; arrows still tweak the focused control, H or a tap shows it again. */
function peekButton(h: LookHost): Widget[] {
  if (!h.peek) return [];
  return [{ kind: 'button', id: 'peek', label: t('look.peek'), onClick: () => h.peek!(), hint: t('look.peek.hint') }];
}

function pixelPage(h: LookHost, st: StudioState): Menu {
  return new Menu(
    () => {
      const target = st.target;
      const look = h.look();
      const w: Widget[] = [pageHeader(target), ...peekButton(h)];
      const mixed = pixelMixed(look, target);
      w.push({
        kind: 'toggle',
        id: 'on',
        label: t('look.pixel.on'),
        get: () => pixelOn(h.look(), target),
        set: (v) => edit(h, (l) => setPixel(l, target, v ? (pixelOf(l, target) ?? DEFAULT_PIXEL) : null)),
        hint: t('look.pixel.on.hint'),
      });
      if (mixed)
        w.push({
          kind: 'label',
          id: 'mixed',
          label: t('look.pixel.mixed'),
          color: 'orange',
        });
      const p = pixelOf(look, target);
      if (p && (pixelOn(look, target) || mixed)) {
        const presetNames = Object.keys(PIXEL_PRESETS);
        const current = presetNames.find((n) => {
          const q = PIXEL_PRESETS[n]!;
          return q.size === p.size && q.outline === p.outline && q.crease === p.crease;
        });
        w.push(
          presetChoice(
            'preset',
            t('look.pixel.preset'),
            presetNames,
            mixed ? null : (current ?? null),
            (n) => edit(h, (l) => setPixel(l, target, PIXEL_PRESETS[n]!)),
            t('look.pixel.preset.hint'),
            t('look.pixel.preset.name'),
            pixelPresetName,
          ),
        );
        for (const q of PIXEL_PARAMS) {
          w.push(
            paramSlider(
              q.key,
              paramName(null, q),
              q,
              () => (pixelOf(h.look(), target) as unknown as Record<string, number> | null)?.[q.key] ?? q.default,
              (v) =>
                edit(h, (l) =>
                  setPixel(l, target, {
                    ...(pixelOf(l, target) ?? DEFAULT_PIXEL),
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
      title: t('look.pixel.title'),
      ...PAGE,
      footer: () => t(lineKey('look.editing', st.target)),
      onSound: (s) => h.sound(s),
    },
  );
}

function sectionPage(h: LookHost, st: StudioState, sec: (typeof LOOK_SECTIONS)[number]): Menu {
  const defs = FILTERS.filter((f) => sec.groups.includes(f.group));
  return new Menu(
    () => {
      const target = st.target;
      const look = h.look();
      const w: Widget[] = [pageHeader(target), ...peekButton(h)];
      for (const def of defs) {
        if (target !== 'scene' && def.sceneOnly) {
          // a warp on one layer would no longer line up with the other
          w.push({ kind: 'label', id: def.id, label: t('look.filter_scene_only', { filter: filterName(def.id) }), color: 'slate' });
          continue;
        }
        const on = lookFilters(look, target).find((f) => f.id === def.id);
        w.push({
          kind: 'toggle',
          id: def.id,
          label: filterName(def.id),
          get: () => lookFilters(h.look(), target).some((f) => f.id === def.id),
          set: (v) => edit(h, (l) => toggleFilter(l, target, def.id, v)),
          hint: filterFull(def.id),
        });
        if (!on) continue;
        const values = paramsOf(on);
        const presets = filterPresets(def);
        const defaults = defaultParams(def);
        const current = filterPresetOf(presets, defaults, values);
        w.push(
          presetChoice(
            `${def.id}.preset`,
            t('look.filter_preset'),
            Object.keys(presets),
            current,
            (n) =>
              edit(h, (l) => {
                const f = lookFilters(l, target).find((x) => x.id === def.id);
                if (f)
                  f.params = {
                    ...defaults,
                    amount: paramsOf(f).amount ?? 1,
                    ...presets[n],
                  };
              }),
            t('look.filter_preset.hint', { filter: filterFull(def.id) }),
            t('look.filter_preset.name', { filter: filterName(def.id) }),
            (n) => filterPresetName(def, n),
            true,
          ),
        );
        for (const p of filterParams(def)) {
          w.push(
            paramSlider(
              `${def.id}.${p.key}`,
              paramName(def, p),
              p,
              () => {
                const f = lookFilters(h.look(), target).find((x) => x.id === def.id);
                return f ? (paramsOf(f)[p.key] ?? p.default) : p.default;
              },
              (v) =>
                edit(h, (l) => {
                  const f = lookFilters(l, target).find((x) => x.id === def.id);
                  if (f) f.params = { ...paramsOf(f), [p.key]: v };
                }),
              t('look.param.hint', { filter: filterFull(def.id), param: paramName(def, p) }),
              t('look.param.name', { filter: filterName(def.id), param: paramName(def, p) }),
              true,
            ),
          );
        }
      }
      return w;
    },
    {
      id: `look.${sec.id}`,
      title: sectionName(sec.id),
      ...PAGE,
      footer: () => t(lineKey('look.editing', st.target)),
      onSound: (s) => h.sound(s),
    },
  );
}
