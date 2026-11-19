// Townsfolk's words on screen, headless, at 1280×720 and on phones held upright and on their side:
// - their speech bubbles never cover each other (placed through the HUD's layout, the speaker
//   nearest the hero first: one that would cover another waits its turn);
// - the line a townsperson says as a window opens (Ilsa's vendor, Brann's anvil) is laid out in free
//   space, whole, clear of the item windows, the HUD and the windows' legend; where a phone has no
//   room for it, it goes over the windows (their canvas draws it) a while, then out of the way, and
//   goes with them (the next window to open never shows it); the legend keeps off it wherever it is;
// - Oru's line shows in the passive tree's own view (the shell's would be under its canvas), and
//   only the panel a townsperson opened shows their line (the tree opened over Ilsa's vendor shows none).
// One engine per screen, tests in order.
import { Vector3 } from 'three/webgpu';
import { afterAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight, type HudTextBox, hudTexts } from '../headless';
import { t } from '../lang';
import { talkText } from '../town/npcs';
import { type Rect, wrap } from '../ui/kit';
import { type TalkPlace, talkSeconds } from '../ui/panels';
import type { RealLoot } from '../wire/loot';
import type { TreePanel } from '../wire/tree';

const T = 60_000;
let h: HeadlessRiftlight | null = null;
afterAll(() => h?.engine.dispose());

const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
/** The boxes of `rows` among the texts drawn (each row once, first match). */
const find = (texts: readonly HudTextBox[], rows: readonly string[]) => rows.map((r) => texts.find((x) => x.text === r));
const union = (boxes: readonly Rect[]): Rect => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

for (const view of [
  { name: '1280×720', viewport: { width: 1280, height: 720, dpr: 1 }, touch: false },
  { name: '390×844', viewport: { width: 390, height: 844, dpr: 3 }, touch: true },
  { name: '844×390', viewport: { width: 844, height: 390, dpr: 2 }, touch: true },
]) {
  describe(`townsfolk's words at ${view.name}`, () => {
    const shell = () => h!.game as unknown as { talk: { place: TalkPlace | null; key: string }; touchable: { dialogue: Rect | null } };
    const legendRows = () => [t('legend.select'), t('legend.back'), t('legend.tabs')];
    const items = () => (h!.game.ports.loot as RealLoot).itemsUi() as unknown as { rects(): Rect[]; said: { box: Rect; rows: readonly string[] } | null };

    it(
      'speech bubbles never cover each other: the nearest speaker’s shows whole',
      async () => {
        h?.engine.dispose();
        h = await headlessRiftlight({ seed: 31, viewport: view.viewport, options: view.touch ? { touch: true } : {} });
        const { rl, game, engine } = h;
        rl.newRun({ slot: 1, seed: 31 });
        if (view.touch) engine.input.noteTouch();
        engine.step(5 * 60); // the town's card has gone (a bubble keeps off the HUD and its banner)
        const npc = (id: string) => game.town.npcs.find((n) => n.def.id === id)!;
        const ilsa = npc('ilsa');
        // the hero a few steps from Ilsa, Pell and Wren beside her: all three speak at once
        game.hero.enter(game.town, ilsa.position.clone().add(new Vector3(0, 0, 3.2)), 0);
        engine.step(3);
        const speakers = [
          { n: ilsa, line: 'town.npc.ilsa.bark.3' },
          { n: npc('villager2'), line: 'town.npc.villager2.bark.2' },
          { n: npc('villager'), line: 'town.npc.villager.bark.2' },
        ];
        speakers[1]!.n.position.copy(ilsa.position).add(new Vector3(0.5, 0, 0.3));
        speakers[2]!.n.position.copy(ilsa.position).add(new Vector3(-0.4, 0, -0.2));
        for (const s of speakers) s.n.say(s.line, 10);
        engine.step(12); // popped in
        const texts = hudTexts(engine, 1);
        const hp = game.hero.actor.position;
        speakers.sort((a, b) => a.n.position.distanceTo(hp) - b.n.position.distanceTo(hp));
        const shown = speakers.map((s) => find(texts, wrap(t(s.line), 120)));
        expect(shown[0]!.every(Boolean), `the nearest speaker's bubble shows whole: ${JSON.stringify(shown[0])}`).toBe(true);
        const whole = shown.filter((rows) => rows.every(Boolean)).map((rows) => union(rows as HudTextBox[]));
        // a bubble is its rows and a margin round them (4 px)
        const grow = (b: Rect) => ({ x: b.x - 4, y: b.y - 3, w: b.w + 8, h: b.h + 5 });
        for (let i = 0; i < whole.length; i++) for (let j = i + 1; j < whole.length; j++) expect(apart(grow(whole[i]!), grow(whole[j]!)), `bubbles ${JSON.stringify(whole[i])} and ${JSON.stringify(whole[j])} apart`).toBe(true);
        // nor is a bubble's row drawn half under another's
        const partial = shown.filter((rows) => rows.some(Boolean) && !rows.every(Boolean));
        expect(partial, 'no bubble cut by another').toEqual([]);
        expect(engine.errors).toEqual([]);
      },
      T,
    );

    for (const [id, panel] of [
      ['ilsa', 'vendor'],
      ['brann', 'crafting'],
    ] as const) {
      it(
        `${id}'s line shows whole, in free space clear of the item windows, the HUD and the legend (else over the windows a while)`,
        () => {
          const { rl, game, engine } = h!;
          expect(rl.talkTo(id).ok).toBe(true);
          expect(rl.state().ui).toEqual([panel]);
          engine.step(3);
          const said = (game as unknown as { dialogueLine: string }).dialogueLine;
          const place = shell().talk.place!;
          expect(place, 'laid out').not.toBeNull();
          expect(place.rows.join(' ').replace(/\s+/g, ' '), 'all of it').toBe(talkText(said).replace(/\s+/g, ' '));
          const box = shell().touchable.dialogue!;
          expect(box, 'it shows').not.toBeNull();
          expect(box.x >= 0 && box.y >= 0 && box.x + box.w <= game.ui.w && box.y + box.h <= game.ui.h, `on screen: ${JSON.stringify(box)}`).toBe(true);
          if (view.name === '390×844') expect(place.over, 'a phone held upright: no free space beside its stacked windows').toBe(true);
          else expect(place.over, 'free space for it').toBe(false);
          const texts = hudTexts(engine, 1);
          if (!place.over) {
            for (const w of items().rects()) expect(apart(box, w), `clear of the window ${JSON.stringify(w)}`).toBe(true);
            const rows = find(texts, place.rows);
            expect(rows.every(Boolean), 'every row drawn').toBe(true);
            // nothing else the HUD draws runs into it: the legend, the place name, the gold
            const others = texts.filter((x) => !place.rows.includes(x.text));
            for (const o of others) expect(apart(box, o), `"${o.text}" ${JSON.stringify(o)} clear of the line ${JSON.stringify(box)}`).toBe(true);
            if (!view.touch) {
              // the legend shows, and keeps its place clear of the HUD (the line left it room)
              const legend = texts.filter((x) => legendRows().includes(x.text));
              expect(legend.length, 'the legend shows').toBeGreaterThan(0);
              const hud = rl.ui.hud().zones.filter((z) => ['skillbar', 'life', 'mana', 'level'].includes(z.id));
              for (const l of legend) for (const z of hud) expect(apart(l, z), `the legend's "${l.text}" clear of the HUD's ${z.id}`).toBe(true);
            }
          } else {
            // the windows' canvas draws it on top, for a while
            expect(items().said?.box, 'drawn over the windows').toEqual(place.box);
            engine.step(Math.ceil(talkSeconds(talkText(said)) * 60) + 5);
            expect(shell().touchable.dialogue, 'then out of the way').toBeNull();
            expect(items().said, 'the windows show whole again').toBeNull();
            expect(rl.state().ui, 'the talk goes on').toEqual([panel]);
          }
          rl.press('Escape');
          expect(rl.state().ui).toEqual([]);
          expect(engine.errors).toEqual([]);
        },
        T,
      );
    }

    if (!view.touch)
      it(
        'the legend keeps off the line wherever it is laid out (the line put on the legend’s row: the legend moves)',
        () => {
          const { rl, engine } = h!;
          expect(rl.talkTo('ilsa').ok).toBe(true);
          engine.step(3);
          const legend = (texts: readonly HudTextBox[]) => texts.filter((x) => legendRows().includes(x.text));
          const before = legend(hudTexts(engine, 1));
          expect(before.length, 'the legend shows').toBeGreaterThan(0);
          // the line's own spots keep clear of the legend's usual row (`windowsAndLegend`): lay it out
          // there by hand (its place is kept while nothing it keeps clear of changes) and the legend,
          // laid out after it, has to move
          const at = union(before);
          const box = { x: at.x - 4, y: at.y - 3, w: at.w + 8, h: at.h + 5 };
          shell().talk.place = { box, rows: ['…'], over: false };
          const after = legend(hudTexts(engine, 1));
          expect(shell().touchable.dialogue, 'the line shows there').toEqual(box);
          expect(after.length, 'the legend still shows').toBeGreaterThan(0);
          for (const l of after) expect(apart(l, box), `the legend's "${l.text}" ${JSON.stringify(l)} clear of the line ${JSON.stringify(box)}`).toBe(true);
          rl.press('Escape');
          expect(rl.state().ui).toEqual([]);
          expect(engine.errors).toEqual([]);
        },
        T,
      );

    if (view.name === '390×844')
      it(
        'the line over the windows goes with them: the next window to open never shows it',
        () => {
          const { rl, engine } = h!;
          expect(rl.talkTo('ilsa').ok).toBe(true);
          engine.step(3);
          expect(items().said, 'over the vendor').not.toBeNull();
          rl.press('Escape');
          expect(rl.state().ui).toEqual([]);
          expect(items().said, 'gone as the vendor closes').toBeNull();
          rl.press('KeyI');
          expect(rl.state().ui).toEqual(['inventory']);
          expect(items().said, 'the inventory opens without it').toBeNull();
          rl.press('Escape');
          expect(engine.errors).toEqual([]);
        },
        T,
      );

    it(
      "Ilsa's line stays her vendor's: the passive tree opened over it (P) shows none",
      () => {
        const { rl, game, engine } = h!;
        expect(rl.talkTo('ilsa').ok).toBe(true);
        rl.press('KeyP');
        expect(rl.state().ui).toEqual(['vendor', 'tree']);
        expect((game.layer.find('tree') as TreePanel).debug().talk, 'not Ilsa’s').toBeNull();
        rl.press('PadB');
        rl.press('PadB');
        expect(rl.state().ui).toEqual([]);
        expect(engine.errors).toEqual([]);
      },
      T,
    );

    it(
      "Oru's line shows in the passive tree's own view, not under its canvas",
      () => {
        const { rl, game, engine } = h!;
        expect(rl.talkTo('oru').ok).toBe(true);
        engine.step(2);
        expect(rl.state().ui).toEqual(['tree']);
        const said = (game as unknown as { dialogueLine: string }).dialogueLine;
        expect((game.layer.find('tree') as TreePanel).debug().talk, 'the tree view shows it').toBe(talkText(said));
        expect(shell().touchable.dialogue, 'the shell draws none under the view').toBeNull();
        rl.press('PadB');
        expect(rl.state().ui).toEqual([]);
        expect(engine.errors).toEqual([]);
      },
      T,
    );
  });
}
