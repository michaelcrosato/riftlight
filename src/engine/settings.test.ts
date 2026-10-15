// The player's settings (engine.settings): plain data checked on the way in, saved per game,
// applied over the game's own choices, given back to them when cleared, and never overriding
// a review flag in the URL at start.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESOLUTIONS, type Resolution } from './framing';
import type { QualityOption } from './quality';
import { LOOK_PRESETS, type Look } from './render/look';
import type { RenderMode } from './render/PixelRenderer';
import { chunkyResolution, loadSettings, normalizeSettings, Settings, type SettingsHost, storeSettings, urlSettings } from './settings';

/** A stand-in engine that records what the settings did to it. */
function fakeHost(start: Partial<{ look: Look; mode: RenderMode; resolution: Resolution; quality: QualityOption; fps: number; debug: boolean }> = {}) {
  const calls: string[] = [];
  const h = {
    look: start.look ?? LOOK_PRESETS.none!,
    mode: start.mode ?? ('pixel' as RenderMode),
    resolution: start.resolution ?? RESOLUTIONS.default,
    quality: start.quality ?? ('auto' as QualityOption),
    debug: start.debug ?? false,
    fps: start.fps ?? 60,
    lookVersion: 0,
  };
  const host: SettingsHost & { calls: string[]; state: typeof h } = {
    calls,
    state: h,
    get look() {
      return h.look;
    },
    setLook: (look) => {
      h.look = look;
      h.lookVersion++;
      calls.push(`look ${Object.keys(LOOK_PRESETS).find((n) => LOOK_PRESETS[n] === look) ?? 'custom'}`);
    },
    renderer: {
      get mode() {
        return h.mode;
      },
      get baseResolution() {
        return h.resolution;
      },
      get lookVersion() {
        return h.lookVersion;
      },
      setMode: (m) => {
        h.mode = m;
        calls.push(`mode ${m}`);
      },
      setResolution: (r) => {
        h.resolution = r;
        calls.push(`res ${r.width}x${r.height}`);
      },
    },
    get maxFps() {
      return h.fps;
    },
    set maxFps(f: number) {
      h.fps = f;
      calls.push(`fps ${f}`);
    },
    get qualityOption() {
      return start.quality ?? 'auto';
    },
    useQuality: (q) => {
      h.quality = q;
      calls.push(`quality ${q}`);
    },
    get debugShown() {
      return h.debug;
    },
    showDebug: (on) => {
      h.debug = on;
      calls.push(`debug ${on}`);
    },
  };
  return host;
}

class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(k: string): string | null {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.items.set(k, v);
  }
  removeItem(k: string): void {
    this.items.delete(k);
  }
}

const g = globalThis as { localStorage?: unknown };
let saved: unknown;
beforeEach(() => {
  saved = g.localStorage;
  g.localStorage = new MemoryStorage();
});
afterEach(() => {
  g.localStorage = saved;
});

describe('player settings', () => {
  it('keep only valid fields', () => {
    expect(normalizeSettings({ look: 'noir', pixelArt: false, pixelSize: 'chunky', quality: 'high', fps: 30, debugInfo: true })).toEqual({ look: 'noir', pixelArt: false, pixelSize: 'chunky', quality: 'high', fps: 30, debugInfo: true });
    expect(normalizeSettings({ look: 'no such look', pixelArt: 'yes', pixelSize: 'huge', quality: 'ultra', fps: 144, debugInfo: 1, extra: 1 })).toEqual({});
    expect(normalizeSettings(null)).toEqual({});
    expect(normalizeSettings('noir')).toEqual({});
  });

  it('save per key, and read back only what is valid', () => {
    storeSettings('a', { look: 'noir', fps: 30 });
    storeSettings('b', { pixelArt: false });
    expect(loadSettings('a')).toEqual({ look: 'noir', fps: 30 });
    expect(loadSettings('b')).toEqual({ pixelArt: false });
    expect(loadSettings('c')).toEqual({});
    (g.localStorage as MemoryStorage).setItem('pixel-engine:settings:d', '{not json');
    expect(loadSettings('d')).toEqual({});
    storeSettings('a', {}); // nothing chosen: nothing kept
    expect((g.localStorage as MemoryStorage).getItem('pixel-engine:settings:a')).toBeNull();
  });

  it("name the fields the URL's review flags set, when the game took them", () => {
    const url = { look: LOOK_PRESETS.noir, mode: 'raw', resolution: RESOLUTIONS.compare, quality: 'low', maxFps: 30, debugUI: false };
    expect([...urlSettings(url)].sort()).toEqual(['debugInfo', 'fps', 'look', 'pixelArt', 'pixelSize', 'quality']);
    expect([...urlSettings({ filters: ['crt'] }, { filters: ['crt'] })]).toEqual(['look']); // a copy of the list counts
    expect([...urlSettings({})]).toEqual([]); // ?game=world, or a flag optionsFromUrl ignores (?debug=true)
    expect([...urlSettings({ mode: 'raw', maxFps: 30 }, { maxFps: 30 })]).toEqual(['fps']); // the game kept its own mode
  });

  it('make chunky pixels from the game resolution', () => {
    expect(chunkyResolution(RESOLUTIONS.default)).toBe(RESOLUTIONS.compare);
    expect(chunkyResolution({ width: 480, height: 270 })).toBe(RESOLUTIONS.compare);
    expect(chunkyResolution({ width: 600, height: 300 })).toEqual({ width: 400, height: 200 });
  });
});

describe('engine.settings', () => {
  it('apply the saved settings at start, except what the URL set, which stays saved', () => {
    storeSettings('game', { look: 'noir', pixelArt: false, fps: 30 });
    const host = fakeHost();
    const s = new Settings(host, 'game');
    s.start(new Set(['pixelArt']));
    expect(host.calls).toEqual(['look noir', 'fps 30']);
    expect(s.values).toEqual({ look: 'noir', fps: 30 });
    s.set({ fps: 60 }); // another change keeps the one the URL held aside
    expect(loadSettings('game')).toEqual({ look: 'noir', pixelArt: false, fps: 60 });
    s.set({ pixelArt: true }); // a new choice of that field replaces it
    expect(loadSettings('game')).toEqual({ look: 'noir', pixelArt: true, fps: 60 });
  });

  it('reset forgets the choices the URL held aside too', () => {
    storeSettings('game', { pixelArt: false, fps: 30 });
    const s = new Settings(fakeHost(), 'game');
    s.start(new Set(['pixelArt']));
    s.reset();
    expect(loadSettings('game')).toEqual({});
  });

  it('apply and save a change, and give a cleared field back to the game', () => {
    const host = fakeHost({ mode: 'pixel', fps: 60, debug: false });
    const s = new Settings(host, 'game');
    s.start();
    const seen: unknown[] = [];
    s.onChange((v) => seen.push(v));
    s.set({ pixelArt: false, pixelSize: 'chunky', debugInfo: true, quality: 'high' });
    expect(host.calls).toEqual(['mode raw', 'res 320x180', 'debug true', 'quality high']);
    expect(loadSettings('game')).toEqual({ pixelArt: false, pixelSize: 'chunky', debugInfo: true, quality: 'high' });
    host.calls.length = 0;
    s.set({ pixelArt: undefined, pixelSize: undefined, quality: undefined });
    expect(host.calls).toEqual(['mode pixel', 'res 480x270', 'quality auto']); // the game's own
    expect(s.values).toEqual({ debugInfo: true });
    expect(seen).toHaveLength(2);
  });

  it('ignore an invalid value, and reset to the game', () => {
    const host = fakeHost();
    const s = new Settings(host, 'game');
    s.start();
    s.set({ look: 'noir' });
    s.set({ fps: 144, look: 'nope' } as never);
    expect(s.values).toEqual({ look: 'noir' });
    host.calls.length = 0;
    s.reset();
    expect(host.calls).toEqual(['look none']);
    expect(s.values).toEqual({});
    expect(loadSettings('game')).toEqual({});
  });

  it("put a chosen look back over each new level's own", () => {
    const host = fakeHost();
    const s = new Settings(host, null);
    s.start();
    s.set({ look: 'noir' });
    host.setLook(LOOK_PRESETS.handheld!); // the next level's setup sets its look
    host.calls.length = 0;
    s.levelStarted();
    expect(host.calls).toEqual(['look noir']);
    s.set({ look: undefined }); // back to the game: that level's look, not the first one's
    expect(host.state.look).toBe(LOOK_PRESETS.handheld);
  });

  it("take a level's look as the game's even when it is the one the player chose", () => {
    const host = fakeHost();
    const s = new Settings(host, null);
    s.start();
    s.set({ look: 'handheld' });
    host.setLook(LOOK_PRESETS.handheld!); // the next level's setup sets that very look
    s.levelStarted();
    s.set({ look: undefined });
    expect(host.state.look).toBe(LOOK_PRESETS.handheld);
  });

  it("keep the game's look when a new level sets none (the chosen one carried over)", () => {
    const host = fakeHost();
    const s = new Settings(host, null);
    s.start();
    s.set({ look: 'noir' });
    host.calls.length = 0;
    s.levelStarted(); // the look carries over between levels: still the player's
    expect(host.calls).toEqual([]);
    s.set({ look: undefined }); // back to the game's own, not the player's
    expect(host.state.look).toBe(LOOK_PRESETS.none);
    s.reset();
    expect(host.state.look).toBe(LOOK_PRESETS.none);
  });

  it('save nothing while persist is off, and replace changes only what differs', () => {
    const host = fakeHost();
    const s = new Settings(host, 'game');
    s.start();
    s.set({ fps: 30 });
    const before = s.values;
    s.persist = false; // a replay
    s.set({ look: 'noir', fps: 60 });
    expect(loadSettings('game')).toEqual({ fps: 30 });
    host.calls.length = 0;
    s.replace(before);
    expect(host.calls).toEqual(['look none', 'fps 30']);
    expect(s.values).toEqual({ fps: 30 });
    host.calls.length = 0;
    s.replace(before); // the same again: nothing to do
    expect(host.calls).toEqual([]);
  });

  it('keep what a game set before the start, and save nowhere with no key', () => {
    const host = fakeHost();
    const s = new Settings(host, null);
    s.set({ pixelSize: 'chunky' }); // before start: kept, not applied yet
    expect(host.calls).toEqual([]);
    s.start();
    expect(host.calls).toEqual(['res 320x180']);
    expect((g.localStorage as MemoryStorage).getItem('pixel-engine:settings:null')).toBeNull();
  });

  it("add a game's set() before the start to the saved settings, never over them", () => {
    storeSettings('game', { look: 'noir', fps: 30, debugInfo: true });
    const host = fakeHost();
    const s = new Settings(host, 'game');
    s.set({ pixelSize: 'chunky' });
    expect(loadSettings('game')).toEqual({ look: 'noir', fps: 30, debugInfo: true, pixelSize: 'chunky' });
    s.start();
    expect(host.calls).toEqual(['look noir', 'fps 30', 'debug true', 'res 320x180']);
  });

  it('open and close through the hooks the engine wires, which may keep them shut', () => {
    const s = new Settings(fakeHost(), null);
    const log: string[] = [];
    s.onOpen = () => void log.push('open');
    s.onClose = () => void log.push('close');
    s.toggle();
    s.open(); // already open
    expect(s.isOpen).toBe(true);
    s.toggle();
    s.close(); // already closed
    expect(log).toEqual(['open', 'close']);
    s.onOpen = () => false; // a replay plays
    s.open();
    expect(s.isOpen).toBe(false);
    const early = new Settings(fakeHost(), null);
    early.open(); // a game's setup, before the engine wired the panel: nothing to show
    expect(early.isOpen).toBe(false);
  });
});
