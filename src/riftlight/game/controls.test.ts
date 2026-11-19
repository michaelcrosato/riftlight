// Control tags in lines (`{key:dodge}`, docs/game/lang.md): the engine names the key, pad button or
// touch button that does each of Riftlight's actions (`CONTROLS`) on the device in use, PlayStation's
// buttons by default and Xbox's when the player chooses them, and names that are words are lines.
import { afterEach, describe, expect, it } from 'vitest';
import { type ControlTable, keyCap as engineKeyCap, keyName, Lang, type LineSource, padName as enginePadName, PAD_GLYPHS, touchName, VOICE_KEYS } from '../../engine';
import { LAB_CONTROLS, LAB_KEYS } from '../levels/levelLab';
import { installLanguage, lang, riftlightLines, t } from '../lang';
import { ARCADE_AGAIN, ARCADE_KEYS } from '../showcase/arcade/ArcadeStage';
import { SHOWCASE_CONTROLS } from '../showcase/hints';
import { CONTROLS, controlLabel, KEYS, keyCap, MENU_BINDINGS, MOUSE, padName, SHELL_MENU_BINDINGS, SHOUT_SKILL } from './controls';
import { RIFTLIGHT_TOUCH_BUTTONS, TOUCH_CODES } from './touch';
import { SHOWCASE } from '../lang/showcase';

afterEach(() => {
  installLanguage(new Lang(riftlightLines()));
});

describe('control labels', () => {
  it('a letter or digit key shows itself; words are lines; pad buttons by PlayStation’s names, or Xbox’s', () => {
    expect(keyName('KeyF', lang())).toBe('F');
    expect(keyName('Digit3', lang())).toBe('3');
    expect(keyName('Space', lang())).toBe('Space');
    expect(keyCap('Space')).toBe('Spc');
    expect(keyName('Escape', lang())).toBe('Esc');
    expect(keyName('MouseLeft', lang())).toBe('LMB');
    expect(keyName('MouseOrQE', lang())).toBe('Mouse or Q / E'); // the game's own code, by its line
    expect([padName('PadA'), padName('PadRT'), padName('PadStart'), padName('PadBack')]).toEqual(['Cross', 'R2', 'Options', 'Create']);
    expect([padName('PadA', 'xbox'), padName('PadRT', 'xbox'), padName('PadStart', 'xbox'), padName('PadBack', 'xbox')]).toEqual(['A', 'RT', 'Menu', 'View']);
  });

  it('names each action on the keyboard, the pad and a touch screen', () => {
    expect(controlLabel('dodge', 'keyboard')).toBe('Space');
    expect(controlLabel('dodge', 'pad')).toBe('Circle');
    expect(controlLabel('dodge', 'pad', 'xbox')).toBe('B');
    expect(controlLabel('dodge', 'touch'), 'the dodge button draws an icon, no letter').toBe('Dodge button');
    expect(controlLabel('interact', 'keyboard')).toBe('F');
    expect(controlLabel('interact', 'pad')).toBe('R2');
    expect(controlLabel('interact', 'touch')).toBe('Action');
    expect(controlLabel('tree', 'keyboard')).toBe('P');
    expect(controlLabel('tree', 'pad')).toBe('Options'); // through the pause menu
    expect(controlLabel('tree', 'touch')).toBe('≡');
    expect([controlLabel('move', 'pad'), controlLabel('turn', 'pad')]).toEqual(['Left stick', 'Right stick']);
    // every action a line may name has a control on every device
    for (const action of Object.keys(CONTROLS)) for (const d of ['keyboard', 'pad', 'touch'] as const) expect(controlLabel(action, d), `${action} ${d}`).not.toBe(action);
  });

  it('a menu control names what the menus bind to it (`MENU_BINDINGS`): a reader’s headings L1 / R1, Shift+Tab / Tab, never Tab for the one before', () => {
    const { heading_prev: prev, heading_next: next } = CONTROLS;
    expect(MENU_BINDINGS.tabPrev).toContain(prev.pad);
    expect([MENU_BINDINGS.tabNext]).toEqual([expect.arrayContaining([next.pad, next.key])]);
    // the keyboard's heading before is Shift held with Tab (the hosts' own: the World's and the
    // Riftlight shell's), not a key the menus hear as the next one
    expect(MENU_BINDINGS.tabNext).not.toContain(prev.key);
    expect(prev.key).toBe('ShiftTab');
    expect([controlLabel('heading_prev', 'keyboard'), controlLabel('heading_next', 'keyboard'), controlLabel('heading_prev', 'pad'), controlLabel('heading_next', 'pad', 'xbox')]).toEqual(['Shift+Tab', 'Tab', 'L1', 'RB']);
    // the character screens' tabs and pages too
    expect(SHELL_MENU_BINDINGS.tabPrev).toContain(CONTROLS.tab_prev.pad);
    expect(SHELL_MENU_BINDINGS.tabNext).toContain(CONTROLS.tab_next.pad);
    expect(KEYS.pagePrev).toEqual(expect.arrayContaining([CONTROLS.page_prev.key, CONTROLS.page_prev.pad, CONTROLS.page_swipe_prev.pad]));
    expect(KEYS.pageNext).toEqual(expect.arrayContaining([CONTROLS.page_next.key, CONTROLS.page_next.pad, CONTROLS.page_swipe_next.pad]));
    expect(MENU_BINDINGS.back).toEqual(expect.arrayContaining([CONTROLS.back.key, CONTROLS.back.pad]));
    expect(MENU_BINDINGS.confirm).toEqual(expect.arrayContaining([CONTROLS.confirm.key, CONTROLS.confirm.pad]));
  });

  it('fills {key:action} in a line for the device in use', () => {
    let device: 'keyboard' | 'pad' | 'touch' = 'keyboard';
    lang().controlLabel = (a) => controlLabel(a, device);
    expect(t('banner.levelup.point')).toBe('+1 passive point · P');
    device = 'pad';
    expect(t('banner.levelup.point')).toBe('+1 passive point · Options');
    device = 'keyboard';
    expect(t('death.tip.physical')).toContain('(Space)');
    device = 'touch';
    expect(t('death.tip.physical'), 'a phone: the button as it shows, no letter it doesn’t draw').toContain('(Dodge button)');
  });

  it('on a phone, every control a line names is one the phone shows: a gesture or an icon button by a line, or a button that draws its label (≡)', () => {
    // the buttons the shell's cluster draws with an icon in play (the attack, the dodge, the skills:
    // `TouchPad.sync`), whose letters never show there; the showcase's lines are its own (its B shows)
    const icons = new Set(RIFTLIGHT_TOUCH_BUTTONS.filter((b) => [TOUCH_CODES.attack, TOUCH_CODES.dodge, ...TOUCH_CODES.skills].includes(b.code as never)).map((b) => b.label));
    expect([...icons].sort()).toEqual(['1', '2', '3', '4', 'A', 'B']);
    const { lines } = riftlightLines();
    const showcase = new Set(Object.keys(SHOWCASE().lines));
    const offenders: string[] = [];
    for (const [id, line] of Object.entries(lines)) {
      if (showcase.has(id)) continue;
      for (const text of typeof line === 'string' ? [line] : Object.values(line)) {
        for (const [, action] of String(text).matchAll(/\{key:(\w+)\}/g)) {
          const touch = (CONTROLS as ControlTable)[action!]?.touch;
          if (touch && icons.has(touch)) offenders.push(`${id}: {key:${action}} names ${touch}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a key name is a line: another language names its keys (en-XA brackets them)', () => {
    installLanguage(new Lang(riftlightLines(), {}, { code: 'en-XA' }));
    expect(keyName('Space', lang())).toMatch(/^\[Spáçé ·+\]$/);
    expect(keyName('KeyF', lang())).toBe('F');
    expect(padName('PadLB', 'xbox')).toMatch(/^\[LB/);
    expect(padName('PadA')).toMatch(/^\[Cróss/);
  });

  it('every key, pad button and gesture Riftlight binds is named by a Riftlight line, or shows its own letter', () => {
    // A source that marks its lines: a name without the mark is the engine's English (or the code), never translated.
    const ids = new Set(Object.keys(riftlightLines().lines));
    const marked: LineSource = { has: (id) => ids.has(id), t: (id) => `«${id}»` };
    const named = (name: string) => /^«.+»$/.test(name) || /^[A-Z0-9]$/.test(name); // a line, or a letter / digit key (F, 1; Xbox's A)
    const offenders = new Set<string>();
    const check = (where: string, name: string) => void (named(name) || offenders.add(`${where}: ${name}`));
    const key = (where: string, code: string) => {
      check(`${where} ${code}`, keyName(code, marked));
      check(`${where} ${code} (cap)`, engineKeyCap(code, marked));
    };
    const pad = (where: string, code: string) => {
      for (const style of PAD_GLYPHS) check(`${where} ${code} (${style})`, enginePadName(code, style, marked));
    };
    // what prompts name: each action's key, pad button and touch gesture (a touch button's own label, `A`, `≡`, is drawn as it is)
    const tables: Record<string, ControlTable> = { CONTROLS, SHOWCASE_CONTROLS, LAB_CONTROLS };
    for (const [table, controls] of Object.entries(tables)) {
      for (const [action, c] of Object.entries(controls)) {
        key(`${table}.${action}`, c.key);
        if (c.pad) pad(`${table}.${action}`, c.pad);
        if (c.touch?.startsWith('Touch')) check(`${table}.${action} ${c.touch}`, touchName(c.touch, marked));
      }
    }
    // every code the key maps read: a pad button by its name, an arrow key as the d-pad too (the pad's d-pad presses them)
    const maps = { KEYS, MENU_BINDINGS, SHELL_MENU_BINDINGS, MOUSE, ARCADE_KEYS, ARCADE_AGAIN, LAB_KEYS };
    const codes = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(codes) : v && typeof v === 'object' ? Object.values(v).flatMap(codes) : []);
    for (const [map, value] of Object.entries(maps)) {
      for (const code of new Set(codes(value))) {
        if (code === 'Touch') continue; // the finger itself: a prompt names a touch button or a gesture, never it
        if (code.startsWith('Pad')) pad(map, code);
        else key(map, code);
        if (code.startsWith('Arrow')) pad(map, code);
      }
    }
    expect([...offenders]).toEqual([]);
  });
});

describe('fully playable on any controller', () => {
  it('every DualSense-only input (a touchpad swipe or press, a shout) has a standard pad button that does the same', () => {
    /** Only a DualSense through 52in1 sends it: its touchpad's gestures and press, a shout into its microphone. */
    const dualSenseOnly = (c: string) => c.startsWith('PadTouchpad') || c === VOICE_KEYS.shout;
    /** Every standard-mapping pad has it. */
    const standard = (c: string) => c.startsWith('Pad') && !dualSenseOnly(c);
    const bindings = Object.entries(KEYS).map(([name, codes]) => [name, (codes as readonly unknown[]).flat() as string[]] as const);
    const used = bindings.filter(([, codes]) => codes.some(dualSenseOnly)).map(([name]) => name);
    expect(used, 'the DualSense-only inputs it binds').toEqual(expect.arrayContaining(['map', 'pagePrev', 'pageNext', 'shout']));
    const alone = bindings.filter(([name, codes]) => name !== 'shout' && codes.some(dualSenseOnly) && !codes.some(standard)).map(([name]) => name);
    expect(alone, 'a DualSense-only input with no standard pad button beside it').toEqual([]);
    // a shout uses War Cry from the skill bar, as its slot's button does: every slot has a pad button
    expect(SHOUT_SKILL).toBe('war-cry');
    expect(KEYS.skill.map((slot) => slot.some(standard)), 'every bar slot on a standard pad').toEqual([true, true, true, true]);
  });
});
