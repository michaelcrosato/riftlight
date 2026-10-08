import { Group, Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { FILTERS, FILTER_PRESETS, clampParam, defaultParams, filterParams, filterPresets, getFilter } from './filters';
import {
  DEFAULT_PIXEL,
  LOOK_PRESETS,
  PIXEL_PARAMS,
  PIXEL_PRESETS,
  defaultLook,
  filterPresetOf,
  lookFromFilters,
  lookLayerOf,
  lookPresetLabel,
  lookPresetName,
  lookPresetOf,
  looksEqual,
  normalizeLook,
  planLook,
  scenePixel,
  setLookLayer,
} from './look';

describe('looks', () => {
  it('the default look is pixel art everywhere and renders the scene once', () => {
    const plan = planLook(defaultLook());
    expect(plan.split).toBe(false);
    expect(plan.sources).toEqual([{ layer: 'all', pixel: DEFAULT_PIXEL, filters: [] }]);
    expect(plan.key).toBe('one:pixel|');
    expect(lookPresetOf(defaultLook())).toBe('none');
  });

  it('a plain filter stack is a whole-scene look with every parameter filled in', () => {
    const look = lookFromFilters(['crt', 'nope', 'crt', 'scanlines']);
    expect(look.scene.map((f) => f.id)).toEqual(['crt', 'scanlines']);
    expect(look.scene[0]!.params).toEqual(defaultParams(getFilter('crt')!));
    expect(planLook(look)).toMatchObject({
      split: false,
      key: 'one:pixel|crt,scanlines',
    });
  });

  it('different layers render as two passes; only the shape of the graph is in its key', () => {
    const heroes = LOOK_PRESETS.pixel_heroes!;
    const plan = planLook(heroes);
    expect(plan.split).toBe(true);
    expect(plan.sources.map((s) => [s.layer, !!s.pixel])).toEqual([
      ['actors', true],
      ['environment', false],
    ]);
    // a parameter or a pixel size changes uniforms, not the graph
    const tweaked = normalizeLook({
      ...heroes,
      actors: {
        pixel: { ...DEFAULT_PIXEL, size: 3 },
        filters: [{ id: 'nes', params: { dither: 0.3 } }],
      },
    });
    const withNes = normalizeLook({
      ...heroes,
      actors: { pixel: DEFAULT_PIXEL, filters: [{ id: 'nes' }] },
    });
    expect(planLook(tweaked).key).toBe(planLook(withNes).key);
    expect(planLook(withNes).key).not.toBe(plan.key);
    // only outlines differ: still two passes (edges are per pass)
    expect(
      planLook(
        normalizeLook({
          ...defaultLook(),
          environment: { pixel: { ...DEFAULT_PIXEL, outline: 0 }, filters: [] },
        }),
      ).split,
    ).toBe(true);
  });

  it('normalizes anything into a valid look', () => {
    expect(normalizeLook(null)).toEqual(defaultLook());
    expect(normalizeLook('junk')).toEqual(defaultLook());
    const look = normalizeLook({
      scene: ['grain', { id: 'bloom', params: { strength: 99, radius: -1, bogus: 3 } }, { id: 'bloom' }, 42],
      actors: {
        pixel: { size: 2.6, outline: 7 },
        filters: [{ id: 'cel', params: { bands: 4.4 } }],
      },
      environment: { pixel: null, filters: 'nope' },
    });
    expect(look.scene.map((f) => f.id)).toEqual(['grain', 'bloom']);
    expect(look.scene[1]!.params).toMatchObject({
      strength: 2,
      radius: 0,
      threshold: 0.72,
      amount: 1,
    });
    expect(look.scene[1]!.params).not.toHaveProperty('bogus');
    expect(look.actors.pixel).toEqual({
      size: 3,
      outline: 1,
      crease: DEFAULT_PIXEL.crease,
    });
    expect(look.actors.filters[0]!.params!.bands).toBe(4);
    expect(look.environment).toEqual({ pixel: null, filters: [] });
    // normalizing twice changes nothing
    expect(normalizeLook(JSON.parse(JSON.stringify(look)))).toEqual(look);
  });

  it('ships every plain filter stack as a look, plus looks that mix layers', () => {
    for (const name of Object.keys(FILTER_PRESETS)) expect(LOOK_PRESETS[name], name).toBeDefined();
    const mixed = Object.keys(LOOK_PRESETS).filter((n) => planLook(LOOK_PRESETS[n]!).split);
    expect(mixed.length).toBeGreaterThanOrEqual(6);
    for (const [name, look] of Object.entries(LOOK_PRESETS)) {
      expect(looksEqual(look, normalizeLook(look)), name).toBe(true);
      expect(lookPresetOf(look)).toBe(name);
    }
    // a clean world with pixel-art characters, and the other way round
    expect(LOOK_PRESETS.pixel_heroes!.environment.pixel).toBeNull();
    expect(LOOK_PRESETS.pixel_world!.actors.pixel).toBeNull();
    expect(scenePixel(LOOK_PRESETS.no_filters!)).toBeNull();
    expect(scenePixel(LOOK_PRESETS.pixel_heroes!)).toBeUndefined();
  });

  it('the first two looks are the default and no filters at all', () => {
    expect(Object.keys(LOOK_PRESETS).slice(0, 2)).toEqual(['none', 'no_filters']);
    // nothing: no pixel art (so no outlines), no filters on either layer or the scene
    expect(LOOK_PRESETS.no_filters).toEqual({ scene: [], actors: { pixel: null, filters: [] }, environment: { pixel: null, filters: [] } });
    expect(planLook(LOOK_PRESETS.no_filters!)).toMatchObject({ split: false, key: 'one:clean|' });
    expect(lookPresetLabel('none')).toBe('default');
    expect(lookPresetLabel('no_filters')).toBe('no filters');
    // the old name still works (stored settings, links)
    expect(lookPresetName('hd_clean')).toBe('no_filters');
    expect(lookPresetName('noir')).toBe('noir');
    expect(lookPresetName('constructor')).toBeNull();
  });

  it('the mixed looks put their filters where they say', () => {
    const ids = (l: { filters: { id: string }[] } | { id: string }[]) => (Array.isArray(l) ? l : l.filters).map((f) => f.id);
    const p = LOOK_PRESETS;
    expect(ids(p.sin_city!.environment)).toEqual(['grayscale', 'posterize']);
    expect(ids(p.sin_city!.actors)).toEqual(['cel']);
    expect(p.sin_city!.actors.pixel).toBeNull();
    expect(ids(p.heat_vision!.actors)).toEqual(['adjust', 'thermal']); // brightened first, so bodies read hot
    expect(ids(p.found_footage!.scene)).toEqual(['grain', 'vhs', 'chromatic', 'vignette']);
    expect(p.pico_world!.environment.pixel!.size).toBeGreaterThan(p.pico_world!.actors.pixel!.size);
    // presets by name carry that preset's values
    expect(p.found_footage!.scene[1]!.params).toMatchObject({ wobble: 2.4, bleed: 2.2, noise: 0.14 }); // vhs "worn out"
    expect(p.noir!.actors.pixel).toEqual(PIXEL_PRESETS.inked);
  });

  it('pixel presets and every filter parameter / preset are in range', () => {
    for (const p of PIXEL_PARAMS) {
      for (const preset of Object.values(PIXEL_PRESETS)) {
        const v = preset[p.key as keyof typeof preset];
        expect(v).toBeGreaterThanOrEqual(p.min);
        expect(v).toBeLessThanOrEqual(p.max);
      }
    }
    const bad: string[] = [];
    for (const def of FILTERS) {
      const params = filterParams(def);
      expect(params.at(-1)!.key, def.id).toBe('amount');
      for (const p of params) {
        expect(p.default, `${def.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${def.id}.${p.key}`).toBeLessThanOrEqual(p.max);
      }
      const presets = filterPresets(def);
      expect(Object.keys(presets).length, def.id).toBeGreaterThanOrEqual(3);
      for (const [name, values] of Object.entries(presets)) {
        for (const [key, v] of Object.entries(values)) {
          const p = params.find((q) => q.key === key);
          // on the slider's range and grid, so a preset is exactly reachable
          if (!p || clampParam(p, v) !== v) bad.push(`${def.id} preset ${name}: ${key}=${v}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('finds the preset a filter is on', () => {
    const def = getFilter('scanlines')!;
    const defaults = defaultParams(def);
    expect(
      filterPresetOf(filterPresets(def), defaults, {
        ...defaults,
        darkness: 0.55,
      }),
    ).toBe('heavy');
    expect(filterPresetOf(filterPresets(def), defaults, defaults)).toBe('classic');
    expect(
      filterPresetOf(filterPresets(def), defaults, {
        ...defaults,
        darkness: 0.5,
      }),
    ).toBeNull();
  });

  it('objects inherit their look layer from the nearest tagged ancestor', () => {
    const hero = new Group();
    const sword = new Mesh();
    const prop = new Mesh();
    hero.add(sword);
    expect(lookLayerOf(sword)).toBe('environment');
    setLookLayer(hero, 'actors');
    expect(lookLayerOf(sword)).toBe('actors');
    sword.add(prop);
    expect(lookLayerOf(prop)).toBe('actors');
    setLookLayer(prop, 'environment');
    expect(lookLayerOf(prop)).toBe('environment');
  });
});
