// Control tags in lines (`{key:dodge}`, docs/game/lang.md): the shell names the key, pad button or
// touch button that does each action on the device in use, and key names that are words are lines.
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import { installLanguage, lang, riftlightLines, t } from '../lang';
import { CONTROLS, controlLabel, keyCap, keyName, padName } from './controls';

afterEach(() => {
  installLanguage(new Lang(riftlightLines()));
});

describe('control labels', () => {
  it('a letter or digit key shows itself; words are lines; pad face buttons their letter', () => {
    expect(keyName('KeyF')).toBe('F');
    expect(keyName('Digit3')).toBe('3');
    expect(keyName('Space')).toBe('Space');
    expect(keyCap('Space')).toBe('Spc');
    expect(keyName('Escape')).toBe('Esc');
    expect(keyName('MouseLeft')).toBe('LMB');
    expect(padName('PadA')).toBe('A');
    expect(padName('PadRT')).toBe('RT');
    expect(padName('PadStart')).toBe('Start');
  });

  it('names each action on the keyboard, the pad and a touch screen', () => {
    expect(controlLabel('dodge', 'keyboard')).toBe('Space');
    expect(controlLabel('dodge', 'pad')).toBe('B');
    expect(controlLabel('dodge', 'touch')).toBe('B');
    expect(controlLabel('interact', 'keyboard')).toBe('F');
    expect(controlLabel('interact', 'pad')).toBe('RT');
    expect(controlLabel('interact', 'touch')).toBe('Action');
    expect(controlLabel('tree', 'keyboard')).toBe('P');
    expect(controlLabel('tree', 'pad')).toBe('Start'); // through the pause menu
    expect(controlLabel('tree', 'touch')).toBe('≡');
    // every action a line may name has a control on every device
    for (const action of Object.keys(CONTROLS)) for (const d of ['keyboard', 'pad', 'touch'] as const) expect(controlLabel(action, d), `${action} ${d}`).not.toBe(action);
  });

  it('fills {key:action} in a line for the device in use', () => {
    let device: 'keyboard' | 'pad' | 'touch' = 'keyboard';
    lang().controlLabel = (a) => controlLabel(a, device);
    expect(t('banner.levelup.point')).toBe('+1 passive point · P');
    device = 'pad';
    expect(t('banner.levelup.point')).toBe('+1 passive point · Start');
    device = 'keyboard';
    expect(t('death.tip.physical')).toContain('(Space)');
  });

  it('a key name is a line: another language names its keys (en-XA brackets them)', () => {
    installLanguage(new Lang(riftlightLines(), {}, { code: 'en-XA' }));
    expect(keyName('Space')).toMatch(/^\[Spáçé ·+\]$/);
    expect(keyName('KeyF')).toBe('F');
    expect(padName('PadLB')).toMatch(/^\[LB/);
  });
});
