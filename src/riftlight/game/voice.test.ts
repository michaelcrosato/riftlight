// Riftlight's voice, headless, through a fake 52in1 and the engine's microphone seam
// (`input.microphone`, a `VoiceInput` whose loudness the test sets: docs/engine/hub.md *Shouts*):
// Settings → Controller has a Voice row, off with 52in1's line until 52in1 allows the
// microphone, then on with its hint; with War Cry on the bar the game listens, and a shout uses War
// Cry as its button does, once a shout; recorded, the shout replays the same without the microphone
// heard; without War Cry on the bar the game doesn't listen and a shout's press does nothing. One
// engine, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HubSettingsSource, type Recording, VOICE_KEYS, type VoiceInput } from '../../engine';
import type { Item } from '../core/types';
import { type HeadlessRiftlight, headlessRiftlight, makeRiftlight } from '../headless';
import { t } from '../lang';
import type { Menu } from '../ui/menu';
import { KEYS, SHOUT_SKILL } from './controls';
import type { Riftlight } from './Riftlight';

const T = 60_000;
let h: HeadlessRiftlight;

/** A 52in1 whose microphone settings the test changes (the player in its Settings), and a microphone as loud as `level`. */
const hub = Object.assign(new EventTarget(), { mic: false, micLater: false, muted: false });
const change = (patch: Partial<typeof hub>) => {
  Object.assign(hub, patch);
  hub.dispatchEvent(new Event('change'));
};
const heard = { level: 0, reads: 0 };

type Inside = { intent: { skill: number }; readIntent(...a: unknown[]): unknown };
const inside = (game: Riftlight = h.game) => game as unknown as Inside;
/** The skill each fixed step's intent asks for (-1: none), from now on. */
const watch = (g: Riftlight) => {
  const skills: number[] = [];
  const own = inside(g).readIntent.bind(g);
  inside(g).readIntent = (...a: unknown[]) => {
    const out = own(...a);
    skills.push(inside(g).intent.skill);
    return out;
  };
  return skills;
};
/** A shout: quiet, loud for a third of a second, quiet again. */
const shout = () => {
  heard.level = 0;
  h.engine.step(20);
  heard.level = 0.5;
  h.engine.step(20);
  heard.level = 0;
  h.engine.step(60); // War Cry's cast (0.6 s) done
};
const barSlot = (g: Riftlight = h.game) => g.hero.skills().findIndex((s) => typeof s.slot === 'number' && s.id === SHOUT_SKILL);
const warCry = (g: Riftlight = h.game) => g.hero.skills().find((s) => s.id === SHOUT_SKILL);
/** The real hero's actor (the port's `ActorLike` holds less): its buffs and mana. */
const hero = (g: Riftlight = h.game) => g.hero.actor as unknown as { hasBuff(key: string): boolean; mana: number; maxMana: number };
/** War Cry's buff is on the hero: it was cast. */
const cried = (g: Riftlight = h.game) => hero(g).hasBuff(SHOUT_SKILL);

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 717, options: { hubSettings: hub as HubSettingsSource } });
  const { engine } = h;
  // headless the engine opens no microphone: the test is it, heard as the engine's would be (on
  // while the voice feature is on and the microphone not muted)
  expect(engine.input.microphone).toBeNull();
  engine.input.microphone = {
    get on() {
      return engine.voiceOn && !engine.hubSettings.micMuted;
    },
    level: () => (heard.reads++, heard.level),
  } satisfies VoiceInput;
  engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('a shout uses War Cry', () => {
  it('Settings → Controller has a Voice row: off with 52in1’s line until 52in1 allows the microphone, then on with its hint, and it turns off', () => {
    const { rl, engine, game } = h;
    const menu = () => game.layer.top?.panel as Menu;
    const row = () => menu().items().find((w) => w.id === 'voice') as { get(): boolean; hint?: string; disabled?: boolean } | undefined;
    rl.ui.click('settings');
    rl.ui.click('controller');
    engine.step(1);
    expect(rl.ui.widgets().map((w) => w.id)).toEqual(['padGlyphs', 'vibration', 'voice', 'voiceSensitivity']);
    expect(rl.ui.widgets().filter((w) => !w.rect).map((w) => w.id), 'every row in view').toEqual([]);
    expect([row()!.get(), row()!.disabled, row()!.hint]).toEqual([false, true, t('menu.settings.voice.allow')]);
    rl.ui.click('voice');
    expect([row()!.get(), engine.settings.values.voice], 'it doesn’t change').toEqual([false, undefined]);
    change({ micLater: true });
    engine.step(1);
    expect([row()!.get(), row()!.hint], 'allowed since the game opened').toEqual([false, t('menu.settings.voice.later')]);
    change({ mic: true, micLater: false });
    engine.step(1);
    expect([row()!.get(), row()!.disabled, row()!.hint], 'allowed: on, as 52in1 allows it').toEqual([true, false, t('menu.settings.voice.hint', { skill: 'War Cry' })]);
    rl.ui.click('voice');
    expect([row()!.get(), engine.voiceOn]).toEqual([false, false]);
    rl.ui.click('voice');
    expect([row()!.get(), engine.voiceOn]).toEqual([true, true]);
    rl.ui.close();
    rl.ui.close();
    engine.step(1);
    expect(engine.errors).toEqual([]);
  });

  it('Shout sensitivity, under Voice, sets how easily a shout counts; while the Controller page is open the game listens and the Voice row shows the level against a shout’s mark', () => {
    const { rl, engine, game } = h;
    const menu = () => game.layer.top?.panel as Menu;
    engine.step(1); // a frame's poll comes before its update: the last page's listening ends a frame after it
    expect([engine.input.voice, engine.input.shoutMeter], 'on the title: not listening, nothing heard').toEqual([false, null]);
    rl.ui.click('settings');
    rl.ui.click('controller');
    heard.reads = 0;
    heard.level = 0.01;
    engine.step(40); // a new stream: the room learnt (`SHOUT.learnS`)
    expect([engine.input.voice, heard.reads > 0], 'the Controller page open: listening, heard').toEqual([true, true]);
    expect(engine.input.shoutMeter).toEqual({ level: 0.01, loud: 0.2, shouted: false });
    expect(menu().rects.get('voice:meter'), 'the meter, beside Voice').toBeDefined();
    rl.ui.click('voiceSensitivity');
    expect([engine.settings.values.voiceSensitivity, engine.input.shoutSensitivity, engine.input.shoutMeter?.loud]).toEqual([1.5, 1.5, 0.2 / 1.5]);
    // a shout here counts on the meter, and uses nothing (no hero on the title)
    heard.level = 0.5;
    engine.step(20);
    expect(engine.input.shoutMeter?.shouted, 'lit').toBe(true);
    heard.level = 0;
    engine.settings.set({ voiceSensitivity: undefined });
    rl.ui.close();
    rl.ui.close();
    engine.step(2);
    expect([engine.input.voice, engine.input.shoutMeter, engine.input.shoutSensitivity], 'closed: not listening').toEqual([false, null, 1]);
    expect(engine.errors).toEqual([]);
  });

  it(
    'with War Cry on the bar the game listens, and a shout uses it as its button does, once a shout; never while not allowed, off or muted',
    async () => {
      const { rl, game, engine } = h;
      expect(engine.input.voice, 'on the title: not listening').toBe(false);
      rl.newRun({ seed: 717 });
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false;
      game.dev.god = true;
      for (const m of game.level!.monsters()) m.actor.life = 0;
      engine.step(120); // the hero's pose on arriving over (`VICTORY_HOLD`): it acts from here
      const slot = barSlot();
      expect(slot, 'War Cry on the bar of a new run').toBeGreaterThanOrEqual(0);
      expect(engine.input.voice, 'listening').toBe(true);
      const skills = watch(game);
      shout();
      expect(skills.filter((s) => s >= 0), 'one shout: War Cry, once').toEqual([slot]);
      expect([cried(), warCry()!.remaining > 0], 'cast: its buff, its cooldown').toEqual([true, true]);
      // its button does the same
      hero().mana = hero().maxMana;
      engine.step(60 * 7); // the cooldown over
      skills.length = 0;
      engine.input.setKey(KEYS.skill[slot]![0]!, true);
      engine.step(1);
      engine.input.setKey(KEYS.skill[slot]![0]!, false);
      engine.step(5);
      expect(skills.filter((s) => s >= 0), 'its button: the same intent').toEqual([slot]);
      engine.step(60 * 7);
      // held on: still one; not allowed, the setting off, muted: none, and the microphone never heard
      skills.length = 0;
      heard.level = 0.5;
      engine.step(120);
      heard.level = 0;
      engine.step(30);
      expect(skills.filter((s) => s >= 0), 'a shout held two seconds: once').toEqual([slot]);
      for (const [why, off, back] of [
        ['not allowed', () => change({ mic: false }), () => change({ mic: true })],
        ['the Voice setting off', () => engine.settings.set({ voice: false }), () => engine.settings.set({ voice: undefined })],
        ['muted', () => change({ muted: true }), () => change({ muted: false })],
      ] as const) {
        off();
        skills.length = 0;
        heard.reads = 0;
        shout();
        expect([why, skills.filter((s) => s >= 0), heard.reads]).toEqual([why, [], 0]);
        back();
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'without War Cry on the bar the game doesn’t listen, and a shout’s press does nothing',
    async () => {
      const { rl, game, engine } = h;
      rl.newRun({ seed: 717 });
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false;
      game.dev.god = true;
      for (const m of game.level!.monsters()) m.actor.life = 0;
      engine.step(120);
      let uid = 1;
      const gem = (id: string) => ({ uid: `voice-gem-${uid++}`, base: 'skill-gem', rarity: 'normal', level: 1, name: id, affixes: [], gem: { id, level: 1, support: false } }) as unknown as Item;
      const sockets = [{ slot: 0, gem: gem('cleave'), supports: [] }];
      game.save.hero.skills = sockets;
      game.ports.loot.setSockets?.(sockets);
      game.hero.setSkills?.(sockets);
      engine.step(2);
      expect([barSlot(), engine.input.voice], 'no War Cry: not listening').toEqual([-1, false]);
      const skills = watch(game);
      heard.reads = 0;
      shout();
      expect([skills.filter((s) => s >= 0), heard.reads, cried()]).toEqual([[], 0, false]);
      // a shout's press anyway (a recording's): nothing
      engine.input.setKey(VOICE_KEYS.shout, true);
      engine.step(1);
      engine.input.setKey(VOICE_KEYS.shout, false);
      engine.step(5);
      expect(skills.filter((s) => s >= 0)).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a shout is recorded as a press and replays the same, never hearing the microphone',
    async () => {
      const { rl, game, engine } = h;
      rl.newRun({ seed: 717 });
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false;
      game.dev.god = true;
      for (const m of game.level!.monsters()) m.actor.life = 0;
      engine.step(120); // the hero's pose on arriving over (`VICTORY_HOLD`): it acts from here
      expect(barSlot(), 'War Cry on the bar again').toBeGreaterThanOrEqual(0);
      await engine.restore(await engine.snapshot()); // the recording starts at this moment
      const live = watch(game);
      shout();
      engine.step(30);
      const fingerprint = engine.fingerprint();
      const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
      expect(rec.frames.filter((f) => f.pressed?.includes(VOICE_KEYS.shout)), 'the shout, in the recording').toHaveLength(1);
      expect(live.filter((s) => s >= 0)).toEqual([barSlot()]);
      const again = makeRiftlight(game.store, engine.seed);
      let replayed: number[] = [];
      heard.level = 0.5; // loud all through the replay: never heard
      heard.reads = 0;
      await engine.replay(rec, async () => {
        await engine.loadGame(again);
        replayed = watch(again);
      });
      heard.level = 0;
      expect(replayed).toEqual(live);
      expect(engine.fingerprint()).toBe(fingerprint);
      expect(heard.reads, 'the microphone, never read in the replay').toBe(0);
      expect([cried(again), warCry(again)!.remaining > 0]).toEqual([true, true]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
