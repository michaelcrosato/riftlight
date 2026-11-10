import { Vector3 } from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import { Rng } from '../core/rng';
import { headlessRiftlight } from '../headless';
import { installLanguage, riftlightLines } from '../lang';
import { bubbleText, Npc, NPCS, talkText } from './npcs';

// Emberfall's words are lines (docs/game/lang.md): the townsfolk's names, titles, barks and talk
// come from the registry (NPCS) and show in the player's language; what a save keeps is a line's id.

const english = () => installLanguage(new Lang(riftlightLines()));
afterEach(english);

describe("the townsfolk's words", () => {
  it('every name, title, bark and talk is a line, as the registry says it; a talk line is just the speech', () => {
    const lines = riftlightLines().lines;
    for (const def of Object.values(NPCS)) {
      expect(lines[`town.npc.${def.id}.name`]).toBe(def.name);
      expect(lines[`town.npc.${def.id}.title`]).toBe(def.title);
      def.barks.forEach((b, i) => expect(lines[`town.npc.${def.id}.bark.${i + 1}`]).toBe(b));
      def.lines.forEach((l, i) => {
        expect(lines[`town.npc.${def.id}.talk.${i + 1}`]).toBe(l);
        expect(l, `${def.id}: no speaker in the speech`).not.toMatch(/^\w+: "/);
      });
      expect(riftlightLines().notes?.[`town.npc.${def.id}.bark.1`], 'who speaks to whom').toMatch(/to the hero/);
    }
  });

  it('a talk is the speech in a bubble and, with the speaker, the header over the panel, in the player’s language', () => {
    const brann = new Npc(NPCS.brann!, new Vector3(), 0, new Rng('brann'));
    const said = brann.talk();
    expect(said).toMatch(/^town\.npc\.brann\.talk\.\d+$/);
    const speech = riftlightLines().lines[said] as string;
    expect(bubbleText(brann.bubble!)).toBe(speech);
    expect(talkText(said)).toBe(`Brann: "${speech}"`);
    // a translation puts the speaker and the quotes where its language does
    installLanguage(new Lang(riftlightLines(), { fr: { by: 'test', lines: { 'town.talk.said': '« {speech} », dit {name}', [said]: 'Pose-le sur l’enclume.' } } }, { code: 'fr' }));
    expect(bubbleText(brann.bubble!)).toBe('Pose-le sur l’enclume.');
    expect(talkText(said)).toBe('« Pose-le sur l’enclume. », dit Brann');
    brann.dispose();
  });

  it('a villager with nothing to say but barks says one; the cat says its lines', () => {
    const wren = new Npc(NPCS.villager!, new Vector3(), 0, new Rng('wren'));
    expect(wren.talk()).toMatch(/^town\.npc\.villager\.bark\.\d+$/);
    expect(talkText(wren.bubble!.line!)).toMatch(/^Wren: "/);
    wren.dispose();
    expect(bubbleText({ line: 'town.cat.meow' })).toBe('Meow');
  });

  it("an old snapshot's English shows as it is", () => {
    expect(bubbleText({ text: 'Mind the sparks.' })).toBe('Mind the sparks.');
    expect(talkText('Brann: "Gold first, sparks after."')).toBe('Brann: "Gold first, sparks after."');
  });
});

describe('prompts in town', () => {
  it('every interactable (townsfolk, stash, arcade, Hall of Beasts) says its prompt, name, verb and title as lines', async () => {
    const { game, engine } = await headlessRiftlight();
    const ids = game.town.interactables.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['brann', 'ilsa', 'oru', 'vex', 'stash', 'arcade', 'bestiary']));
    const brann = game.town.interactables.find((i) => i.id === 'brann')!;
    expect([brann.prompt, brann.name, brann.verb, brann.title]).toEqual(['Talk to Brann', 'Brann', 'Talk', 'Blacksmith']);
    expect(game.town.interactables.find((i) => i.id === 'stash')!.prompt).toBe('Open the stash');
    expect(game.town.interactables.find((i) => i.id === 'arcade')!.prompt).toBe('Play Rift Runner');
    // under the test language every word is a line (bracketed), read when shown
    installLanguage(new Lang(riftlightLines(), {}, { code: 'en-XA' }));
    for (const it of game.town.interactables) {
      for (const text of [it.prompt, it.name, it.verb, it.title ?? '[-]']) expect(text, it.id).toMatch(/^\[.*\]$/);
    }
    engine.dispose();
  });
});
