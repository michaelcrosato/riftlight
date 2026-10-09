import { describe, expect, it } from 'vitest';
import { pauseMenu } from '../../world/ui/panels';
import { titleMenu } from './menus';

const host = (more: object = {}) => ({ store: { lastSlot: () => null }, sound: () => {}, ...more }) as never;

describe('links between Riftlight and Engine World', () => {
  it('the title offers Engine World when the host can open it, and opens it', () => {
    let opened = 0;
    const menu = titleMenu(host({ engineWorld: () => opened++ }));
    expect(menu.items().map((w) => w.id)).toContain('world');
    menu.activate('world');
    expect(opened).toBe(1);
    expect(titleMenu(host()).items().map((w) => w.id)).not.toContain('world'); // a host without it
  });

  it('Engine World\'s pause menu leaves for Riftlight', () => {
    let left = 0;
    const none = () => {};
    const menu = pauseMenu(false, { resume: none, guide: none, tweak: none, rooms: none, glossary: none, atrium: none, reset: none, riftlight: () => left++ });
    expect(menu.activate('riftlight')).toBe(true);
    expect(left).toBe(1);
  });
});
