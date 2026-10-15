import { describe, expect, it } from 'vitest';
import { pauseMenu } from '../../world/ui/panels';
import { RESOLUTIONS, type PlayerSettings } from '../../engine';
import { engineMenu, settingsMenu } from './menus';
import { titleMenu } from './menus';

const host = (more: object = {}) => ({ saves: { last: null, slots: [], volatile: false, lastError: '' }, sound: () => {}, ...more }) as never;

describe('links between Riftlight and Engine World', () => {
  it('the title offers Engine World when the host can open it, and opens it', () => {
    let opened = 0;
    const menu = titleMenu(host({ engineWorld: () => opened++ }));
    expect(menu.items().map((w) => w.id)).toContain('world');
    menu.activate('world');
    expect(opened).toBe(1);
    expect(titleMenu(host()).items().map((w) => w.id)).not.toContain('world'); // a host without it
  });

  it('the title opens the Asset Gallery room of Engine World', () => {
    const rooms: (string | undefined)[] = [];
    const menu = titleMenu(host({ engineWorld: (room?: string) => rooms.push(room) }));
    menu.activate('gallery');
    menu.activate('world');
    expect(rooms).toEqual(['gallery', undefined]);
    expect(titleMenu(host()).items().map((w) => w.id)).not.toContain('gallery');
  });

  it('Engine World\'s pause menu leaves for Riftlight', () => {
    let left = 0;
    const none = () => {};
    const menu = pauseMenu(false, { resume: none, guide: none, tweak: none, rooms: none, glossary: none, atrium: none, reset: none, riftlight: () => left++ });
    expect(menu.activate('riftlight')).toBe(true);
    expect(left).toBe(1);
  });
});

describe("the settings' engine page", () => {
  // a stand-in engine: its settings record what the menu asks for, and what the rows show follows them
  const engineHost = () => {
    const chosen: PlayerSettings = {};
    const audio = { muted: false, setMuted: (m: boolean) => (audio.muted = m), volume: { master: 1, music: 1, sfx: 1 }, setVolume: () => {} };
    const engine = {
      settings: { values: chosen, set: (p: PlayerSettings) => Object.assign(chosen, p) },
      renderer: { get mode() { return chosen.pixelArt === false ? 'raw' : 'pixel'; }, get baseResolution() { return chosen.pixelSize === 'chunky' ? RESOLUTIONS.compare : RESOLUTIONS.default; } },
      get maxFps() { return chosen.fps ?? 60; },
      get debugShown() { return chosen.debugInfo ?? false; },
    };
    return { chosen, audio, h: host({ engine, audio, settings: { look: '', quality: 'auto', zoom: 1, screenShake: 0.7, damageNumbers: true, lootFilter: 0, glyphs: 'auto' } }) };
  };
  type Row = { id: string; kind: string; get?: () => unknown; set?: (v: never) => void };
  const row = (menu: { items(): readonly unknown[] }, id: string) => menu.items().find((w) => (w as Row).id === id) as Row;

  it('the settings open it', () => {
    let opened = '';
    const { h } = engineHost();
    const menu = settingsMenu({ ...(h as object), openMenu: (m: { id?: string; options?: { id?: string } }) => (opened = m.options?.id ?? m.id ?? 'menu'), applySettings: () => {} } as never);
    expect(menu.activate('engine')).toBe(true);
    expect(opened).toBe('engine');
  });

  it('holds what the hotkeys did, and each row changes the engine', () => {
    const { chosen, audio, h } = engineHost();
    const menu = engineMenu(h);
    expect(menu.items().map((w) => (w as Row).id)).toEqual(['pixelArt', 'pixelSize', 'fps', 'sound', 'debugInfo']);
    expect(row(menu, 'pixelArt').get!()).toBe(true);
    row(menu, 'pixelArt').set!(false as never);
    expect(chosen.pixelArt).toBe(false);
    expect(row(menu, 'pixelArt').get!()).toBe(false);
    expect(row(menu, 'pixelSize').get!()).toBe(0);
    row(menu, 'pixelSize').set!(1 as never);
    expect(chosen.pixelSize).toBe('chunky');
    expect(row(menu, 'pixelSize').get!()).toBe(1);
    row(menu, 'fps').set!(1 as never);
    expect(chosen.fps).toBe(30);
    expect(row(menu, 'fps').get!()).toBe(1);
    row(menu, 'sound').set!(false as never);
    expect(audio.muted).toBe(true);
    row(menu, 'debugInfo').set!(true as never);
    expect(chosen.debugInfo).toBe(true);
  });
});
