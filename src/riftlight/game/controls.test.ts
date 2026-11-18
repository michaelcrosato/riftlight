// Control tags in lines (`{key:dodge}`, docs/game/lang.md): the engine names the key, pad button or
// touch button that does each of Riftlight's actions (`CONTROLS`) on the device in use, PlayStation's
// buttons by default and Xbox's when the player chooses them, and names that are words are lines.
import { afterEach, describe, expect, it } from 'vitest';
import { keyName, Lang } from '../../engine';
import { installLanguage, lang, riftlightLines, t } from '../lang';
import { CONTROLS, controlLabel, keyCap, padName } from './controls';

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
    expect(controlLabel('dodge', 'touch')).toBe('B');
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

  it('fills {key:action} in a line for the device in use', () => {
    let device: 'keyboard' | 'pad' | 'touch' = 'keyboard';
    lang().controlLabel = (a) => controlLabel(a, device);
    expect(t('banner.levelup.point')).toBe('+1 passive point · P');
    device = 'pad';
    expect(t('banner.levelup.point')).toBe('+1 passive point · Options');
    device = 'keyboard';
    expect(t('death.tip.physical')).toContain('(Space)');
  });

  it('a key name is a line: another language names its keys (en-XA brackets them)', () => {
    installLanguage(new Lang(riftlightLines(), {}, { code: 'en-XA' }));
    expect(keyName('Space', lang())).toMatch(/^\[Spáçé ·+\]$/);
    expect(keyName('KeyF', lang())).toBe('F');
    expect(padName('PadLB', 'xbox')).toMatch(/^\[LB/);
    expect(padName('PadA')).toMatch(/^\[Cróss/);
  });
});
