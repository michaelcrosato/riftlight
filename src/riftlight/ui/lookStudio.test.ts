import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultLook, getFilter, type Look, LOOK_PRESETS, lookPresetOf, normalizeLook, PIXEL_PRESETS } from '../../engine';
import { loadSettings } from '../game/settings';
import { formatParam, type LookHost, lookStudio, pixelOf, pixelOn, setPixel, toggleFilter } from './lookStudio';
import type { Menu } from './menu';

const ids = (look: Look, t: 'scene' | 'actors' | 'environment') => (t === 'scene' ? look.scene : look[t].filters).map((f) => f.id);

/** A host that keeps the look like the shell does (normalized) and records opened pages. */
function host(start: Look = defaultLook()) {
  let look = normalizeLook(start);
  const pages: Menu[] = [];
  const h: LookHost = {
    look: () => normalizeLook(look),
    setLook: (l) => (look = normalizeLook(l)),
    openStudioPage: (m) => pages.push(m),
    sound: () => {},
  };
  return {
    h,
    pages,
    get look() {
      return look;
    },
  };
}

const widget = (m: Menu, id: string) => {
  const w = m.items().find((x) => x.id === id);
  if (!w) throw new Error(`no widget ${id}: ${m.items().map((x) => x.id).join(',')}`);
  return w;
};

describe('look studio', () => {
  it('turning a filter on and off leaves the rest of the stack in its order', () => {
    for (const name of ['dream', 'vhs_rental', 'home_computer', 'spooky']) {
      const look = normalizeLook(LOOK_PRESETS[name]);
      const before = ids(look, 'scene');
      toggleFilter(look, 'scene', 'halftone', true);
      toggleFilter(look, 'scene', 'halftone', false);
      expect(ids(look, 'scene'), name).toEqual(before);
      expect(lookPresetOf(look), name).toBe(name);
    }
    const look = defaultLook();
    toggleFilter(look, 'actors', 'grain', true);
    toggleFilter(look, 'actors', 'nes', true); // palettes come before signal filters
    expect(ids(look, 'actors')).toEqual(['nes', 'grain']);
    expect(look.actors.filters[0]!.params).toMatchObject({ dither: 0.08, amount: 1 });
  });

  it('filters that move pixels stay on the whole scene', () => {
    const look = defaultLook();
    for (const id of ['crt', 'chromatic', 'vhs', 'ntsc']) {
      expect(getFilter(id)!.sceneOnly, id).toBe(true);
      toggleFilter(look, 'environment', id, true);
      toggleFilter(look, 'scene', id, true);
    }
    expect(ids(look, 'environment')).toEqual([]);
    expect(ids(look, 'scene')).toEqual(['crt', 'chromatic', 'vhs', 'ntsc']);
    // and a stored look can't sneak one onto a layer
    expect(normalizeLook({ actors: { filters: [{ id: 'crt' }, { id: 'nes' }] } }).actors.filters.map((f) => f.id)).toEqual(['nes']);
  });

  it('pixel art for the whole scene sets both layers; a layer sets only itself', () => {
    const look = defaultLook();
    setPixel(look, 'environment', null);
    expect(pixelOn(look, 'scene')).toBe(false);
    expect(pixelOn(look, 'actors')).toBe(true);
    expect(pixelOf(look, 'scene')).toEqual(look.actors.pixel);
    setPixel(look, 'scene', PIXEL_PRESETS.chunky!);
    expect(look.actors.pixel).toEqual(PIXEL_PRESETS.chunky);
    expect(look.environment.pixel).toEqual(PIXEL_PRESETS.chunky);
    look.actors.pixel!.size = 4; // copies, not one shared object
    expect(look.environment.pixel!.size).toBe(2);
  });

  it('the main page picks looks and targets; a page edits the chosen part', () => {
    const s = host();
    const main = lookStudio(s.h);
    const preset = widget(main, 'preset');
    if (preset.kind !== 'choice') throw new Error('preset is a choice');
    const names = Object.keys(LOOK_PRESETS);
    preset.set(names.indexOf('pixel_heroes'));
    expect(lookPresetOf(s.look)).toBe('pixel_heroes');
    const target = widget(main, 'target');
    if (target.kind !== 'choice') throw new Error('target is a choice');
    target.set(2); // environment
    const palette = widget(main, 'palette');
    if (palette.kind !== 'button') throw new Error('palette is a button');
    palette.onClick();
    const page = s.pages.at(-1)!;
    const gameboy = widget(page, 'gameboy');
    if (gameboy.kind !== 'toggle') throw new Error('gameboy is a toggle');
    gameboy.set(true);
    expect(ids(s.look, 'environment')).toEqual(['gameboy']);
    expect(lookPresetOf(s.look)).toBeNull();
    // the page (rebuilt from the look, as every draw does) grew a preset choice and sliders
    palette.onClick();
    const again = s.pages.at(-1)!;
    const dither = again.items().find((w) => w.id === 'gameboy.dither');
    expect(dither?.kind).toBe('slider');
    if (dither?.kind === 'slider') dither.set(0);
    expect(s.look.environment.filters[0]!.params!.dither).toBe(0);
    const choice = again.items().find((w) => w.id === 'gameboy.preset');
    // on a preset the options are just the presets (cycling never sticks on "custom")
    expect(choice?.kind === 'choice' && !choice.options.includes('custom')).toBe(true);
  });

  it('formats values to fit the slider column', () => {
    expect(formatParam({ key: 'a', label: 'A', min: 0, max: 1, step: 0.05, default: 1, unit: '%' }, 0.45)).toBe('45%');
    expect(formatParam({ key: 'a', label: 'A', min: 0, max: 2, step: 0.05, default: 1, unit: 'x' }, 1.25)).toBe('1.25x');
    expect(formatParam({ key: 'a', label: 'A', min: 1, max: 4, step: 1, default: 1, unit: 'px' }, 2)).toBe('2px');
    expect(formatParam({ key: 'a', label: 'A', min: 0, max: 0.2, step: 0.01, default: 0.06 }, 0.06)).toBe('0.06');
  });
});

describe('look settings', () => {
  const stored = (v: unknown) => {
    const data = new Map<string, string>([['riftlight:settings', JSON.stringify(v)]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, s: string) => data.set(k, s) });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('keeps named looks (old filter stacks too), drops unknown ones', () => {
    for (const name of ['handheld', 'famicom', 'pixel_heroes', '']) {
      stored({ look: name });
      expect(loadSettings().look, name).toBe(name);
    }
    for (const name of ['bogus', 'constructor', 'custom', 'none']) {
      stored({ look: name });
      expect(loadSettings().look, name).toBe('');
    }
    stored({ look: 'hd_clean' }); // renamed
    expect(loadSettings().look).toBe('no_filters');
  });

  it('a custom look comes back normalized', () => {
    stored({ look: 'custom', customLook: { actors: { pixel: { size: 9 }, filters: [{ id: 'gameboy' }, { id: 'crt' }] } } });
    const s = loadSettings();
    expect(s.look).toBe('custom');
    expect(s.customLook!.actors.pixel!.size).toBe(6);
    expect(s.customLook!.actors.filters.map((f) => f.id)).toEqual(['gameboy']);
  });
});
