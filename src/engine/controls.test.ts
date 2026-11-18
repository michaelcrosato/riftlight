// Prompts for every device (docs/engine/game-api.md *Prompts*): a game's controls as data, their
// names (lines a game can translate) and glyphs (PlayStation by default, Xbox as an option, keys
// and the mouse), and the engine filling `{key:action}` in every line for the device in use.
import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { CONTROL_LINES, type ControlTable, Controls, controlName, GLYPH_SIZE, type Glyph, keyCap, keyGlyph, keyName, padGlyph, padName, touchName } from './controls';
import { Engine, type Game } from './Engine';
import { Hud } from './hud/Hud';
import { Input } from './input';
import { Lang } from './lang/lang';
import type { PlayerSettings } from './settings';

const TABLE: ControlTable = {
  jump: { key: 'Space', pad: 'PadA', touch: 'A' },
  attack: { key: 'MouseLeft', pad: 'PadX', touch: 'TouchTap' },
  pause: { key: 'Escape', pad: 'PadStart', touch: '≡' },
  look: { key: 'MouseOrQE', pad: 'PadStick' },
  shield: { key: 'KeyF', pad: 'PadLB' },
};
/** A game's own language that translates some names (a `Lang` is a LineSource). */
const french = { has: (id: string) => id === 'pad.ps.cross' || id === 'key.space' || id === 'key.mouse_or_q_e', t: (id: string) => ({ 'pad.ps.cross': 'Croix', 'key.space': 'Espace', 'key.mouse_or_q_e': 'Souris ou Q / E' })[id] ?? id };

const sprite = (g: Glyph | null) => (g?.kind === 'sprite' ? g : null);

describe('control names', () => {
  it('keys by their words, letters and digits by themselves, a game’s own codes by their lines', () => {
    expect([keyName('Space'), keyName('KeyF'), keyName('Digit2'), keyName('Escape'), keyName('MouseLeft'), keyName('Wheel'), keyName('ShiftLeft')]).toEqual(['Space', 'F', '2', 'Esc', 'LMB', 'Wheel', 'Shift']);
    expect(keyCap('Space')).toBe('Spc'); // the short form on a small cap
    expect(keyName('MouseOrQE')).toBe('MouseOrQE'); // no line anywhere: the code
    expect(keyName('MouseOrQE', french)).toBe('Souris ou Q / E'); // the game's line key.mouse_or_q_e
    expect(keyName('Space', french)).toBe('Espace');
  });

  it('pad buttons in the player’s style: PlayStation by default, Xbox when chosen', () => {
    const ps = ['PadA', 'PadB', 'PadX', 'PadY', 'PadLB', 'PadRB', 'PadLT', 'PadRT', 'PadBack', 'PadStart', 'PadL3', 'PadR3', 'PadTouchpad'].map((c) => padName(c));
    expect(ps).toEqual(['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'Touchpad']);
    const xbox = ['PadA', 'PadB', 'PadX', 'PadY', 'PadLB', 'PadRB', 'PadLT', 'PadRT', 'PadBack', 'PadStart', 'PadL3', 'PadR3'].map((c) => padName(c, 'xbox'));
    expect(xbox).toEqual(['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS']);
    expect([padName('PadStick'), padName('ArrowUp', 'xbox'), padName('PadA', 'playstation', french)]).toEqual(['Stick', 'D-pad', 'Croix']);
  });

  it('touch buttons by their label, gestures by their lines; an action names the control on the device', () => {
    expect([touchName('A'), touchName('≡'), touchName('TouchTap'), touchName('TouchStick')]).toEqual(['A', '≡', 'Tap', 'Stick']);
    const jump = TABLE.jump!;
    expect([controlName(jump, 'keyboard'), controlName(jump, 'pad'), controlName(jump, 'pad', 'xbox'), controlName(jump, 'touch')]).toEqual(['Space', 'Cross', 'A', 'A']);
    expect(controlName(TABLE.shield!, 'touch')).toBe('F'); // no touch button: the key
    // every name the engine shows is a line with English words (ids a game can translate)
    for (const [id, text] of Object.entries(CONTROL_LINES)) expect(text, id).toMatch(/\S/);
  });
});

describe('glyphs', () => {
  it('PlayStation’s face buttons are their symbols in their colours: Cross blue, Circle red, Square pink, Triangle green', () => {
    const faces = (['PadA', 'PadB', 'PadX', 'PadY'] as const).map((c) => sprite(padGlyph(c))!);
    expect(faces.map((g) => g.colors.s)).toEqual(['blue', 'red', 'plum', 'teal']);
    // the symbols: ✕ is diagonal, ○ a ring, □ a box, △ a point over a base
    expect(faces[0]!.rows[1]).toBe('osfffso');
    expect(faces[1]!.rows.slice(1, 6)).toEqual(['ofsssfo', 'osfffso', 'osfffso', 'osfffso', 'ofsssfo']);
    expect(faces[2]!.rows[3]).toBe('ofsfsfo');
    expect(faces[3]!.rows.slice(2, 5)).toEqual(['offsffo', 'ofsfsfo', 'ossssso']);
  });

  it('Xbox’s are its lettered buttons; shoulders, triggers and menus are caps with their names; keys are caps; the mouse is drawn', () => {
    const a = sprite(padGlyph('PadA', 'xbox'))!;
    expect([a.colors.f, a.colors.l]).toEqual(['green', 'white']);
    expect(sprite(padGlyph('PadY', 'xbox'))!.colors.f).toBe('sand');
    expect(padGlyph('PadLB')).toEqual({ kind: 'cap', text: 'L1', round: true });
    expect(padGlyph('PadStart', 'xbox')).toEqual({ kind: 'cap', text: 'Menu', round: true });
    expect(keyGlyph('Space')).toEqual({ kind: 'cap', text: 'Spc', round: false });
    expect(sprite(keyGlyph('MouseRight'))!.rows[1]).toBe('owwosso'); // the right button lit
    expect(sprite(padGlyph('PadStick'))).not.toBeNull();
    expect(sprite(padGlyph('ArrowLeft'))!.rows[3]).toBe('osffffo'); // the d-pad's left arm lit
  });

  it('every sprite is 7×7 and every pixel has a colour (or is clear)', () => {
    const all = [
      ...['PadA', 'PadB', 'PadX', 'PadY', 'PadStick', 'PadLStick', 'PadRStick', 'DPad', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].flatMap((c) => [padGlyph(c), padGlyph(c, 'xbox')]),
      ...['MouseLeft', 'MouseRight', 'MouseMiddle', 'Wheel'].map((c) => keyGlyph(c)),
    ];
    for (const g of all) {
      const s = sprite(g)!;
      expect(s.rows.length).toBe(GLYPH_SIZE);
      for (const row of s.rows) {
        expect(row.length).toBe(GLYPH_SIZE);
        for (const ch of row) if (ch !== '.') expect(s.colors[ch], `${JSON.stringify(s.rows)} ${ch}`).toBeDefined();
      }
    }
  });
});

describe('engine.controls', () => {
  /** Controls over an input and settings the test sets. */
  const make = () => {
    const input = new Input(null);
    const values: PlayerSettings = {};
    const c = new Controls(input, { values });
    c.table = TABLE;
    return { input, values, c };
  };

  it('names and draws an action for the device used last, in the player’s style', () => {
    const { input, values, c } = make();
    expect(c.label('jump')).toBe('Space');
    expect(sprite(c.glyph('attack'))!.rows[1]).toBe('ossowwo'); // the left mouse button
    input.noteDevice('pad');
    expect([c.label('jump'), c.label('pause'), sprite(c.glyph('jump'))!.colors.s]).toEqual(['Cross', 'Options', 'blue']);
    values.padGlyphs = 'xbox';
    expect([c.label('jump'), c.label('pause'), sprite(c.glyph('jump'))!.colors.f]).toEqual(['A', 'Menu', 'green']);
    input.noteDevice('touch');
    expect([c.label('jump'), c.label('attack'), c.glyph('jump')]).toEqual(['A', 'Tap', { kind: 'cap', text: 'A', round: true }]);
    expect(c.label('nothing')).toBe('nothing'); // not in the table: its id, as before
    expect(c.label('PadB')).toBe('B'); // a code alone: on its own device, in the style
    expect(c.glyph('KeyQ')).toEqual({ kind: 'cap', text: 'Q', round: false });
  });

  it("fills {key:action} in every Lang's lines for the running game, in that language, until the engine goes", async () => {
    class Jumper implements Game {
      readonly name = 'Jumper';
      readonly controls = TABLE;
      setup(): void {}
      cameraTarget() {
        return new Vector3();
      }
    }
    const lines = { version: 1 as const, language: 'en', lines: { 'help.jump': '{key:jump} to jump', 'pad.ps.cross': 'Cross' }, names: [], brief: '' };
    const fr = new Lang(lines, { fr: { by: 'test', lines: { 'help.jump': '{key:jump} pour sauter', 'pad.ps.cross': 'Croix' } } }, { code: 'fr' });
    const en = new Lang(lines);
    expect(en.t('help.jump')).toBe('jump to jump'); // no game running: the action's id
    const engine = await Engine.headless(new Jumper());
    expect(en.t('help.jump')).toBe('Space to jump');
    engine.input.noteDevice('pad');
    expect([en.t('help.jump'), fr.t('help.jump')]).toEqual(['Cross to jump', 'Croix pour sauter']);
    engine.settings.set({ padGlyphs: 'xbox' });
    expect(en.t('help.jump')).toBe('A to jump');
    engine.dispose();
    expect(en.t('help.jump')).toBe('jump to jump');
  });
});

describe('hud.glyph and hud.prompt', () => {
  /** What the HUD holds (test access to its retained items). */
  const items = (hud: Hud) => (hud as unknown as { items: { kind: string; text?: string; rows?: string[]; colors?: Record<string, string>; x: number }[] }).items;

  it('draw the control on the device in use and return its width; a prompt puts its label after it', () => {
    const input = new Input(null);
    const values: PlayerSettings = {};
    const hud = new Hud(null);
    hud.controls = new Controls(input, { values });
    hud.controls.table = TABLE;
    expect(hud.glyph(10, 10, 'jump')).toBe(hud.measure('Spc').width + 4); // a key cap
    expect(items(hud).some((i) => i.kind === 'text' && i.text === 'Spc')).toBe(true);
    hud.clear();
    input.noteDevice('pad');
    expect(hud.glyph(10, 10, 'jump')).toBe(GLYPH_SIZE);
    expect(items(hud)[0]).toMatchObject({ kind: 'sprite', colors: { s: 'blue' } });
    hud.clear();
    const w = hud.prompt(100, 10, 'jump', 'JUMP', { align: 'center' });
    expect(w).toBe(GLYPH_SIZE + 3 + hud.measure('JUMP').width);
    const [g, label] = items(hud);
    expect([g!.x, label!.x, label!.text]).toEqual([100 - Math.floor(w / 2), 100 - Math.floor(w / 2) + GLYPH_SIZE + 3, 'JUMP']);
    hud.clear();
    expect(hud.glyph(0, 0, 'unknown')).toBe(0);
    expect(new Hud(null).glyph(0, 0, 'jump')).toBe(0); // no engine: nothing to draw
  });
});
