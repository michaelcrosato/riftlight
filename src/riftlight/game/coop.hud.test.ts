// Couch co-op's line in town on screen, headless (game/coop.ts, docs/game/shell.md *Couch co-op*):
// player 1 on a pad and another pad connected, the town says how to join. On a phone held upright
// (touch controls or not), held sideways, a laptop and a TV the line is shown whole, on screen,
// over no other text (the place name, the gold, a prompt, the feed) and clear of the HUD's zones.
// Couch co-op is not offered in a 52in1 round or the showcase: no pause entry, no line, no join.
// The level card keeps off the heroes on a short landscape phone with three guests and the tuning's
// rows (where the HUD left it nowhere but the middle of the screen, over them), and so do the
// guests' strips all level with two (they ran side by side across the middle, over the heroes).
import { afterEach, describe, expect, it } from 'vitest';
import type { GamepadLike, Viewport } from '../../engine';
import { type HeadlessRiftlight, headlessMoment, headlessRiftlight, type HudTextBox, hudOverlap, hudTexts, settle } from '../headless';
import { momentById } from '../session/moments';
import { t } from '../lang';
import { type HudModel, hudZones } from '../ui/hud';
import { miniCovers, miniWidth } from '../ui/kit';
import { type Box, overlaps } from '../ui/layout';
import { worldBox } from '../ui/world';
import { HEAD } from './coop';

const SCREENS: readonly [string, Viewport, boolean][] = [
  ['390×844 phone, touch', { width: 390, height: 844, dpr: 3 }, true],
  ['390×844 phone', { width: 390, height: 844, dpr: 3 }, false],
  ['360×740 phone, touch', { width: 360, height: 740, dpr: 2 }, true],
  ['844×390 phone, touch', { width: 844, height: 390, dpr: 2 }, true],
  ['1280×720', { width: 1280, height: 720, dpr: 1 }, false],
  ['1920×1080', { width: 1920, height: 1080, dpr: 1 }, false],
];

let open: HeadlessRiftlight | null = null;
afterEach(() => {
  open?.engine.dispose();
  open = null;
});

const pad = (index: number, pressed: number[] = []): GamepadLike => ({ connected: true, mapping: 'standard', index, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

/** One frame's texts: the normal font's (`hudTexts`) and the mini font's. */
function textsOf(h: HeadlessRiftlight): HudTextBox[] {
  const ui = h.game.ui;
  const mini = ui.mini;
  const minis: HudTextBox[] = [];
  ui.mini = (x, y, s, color, align = 'left', shadow) => {
    if (s && miniCovers(s)) {
      const w = miniWidth(s);
      minis.push({ text: s, x: Math.round(align === 'center' ? x - Math.floor(w / 2) : align === 'right' ? x - w : x), y: Math.round(y), w: w + 1, h: 6 });
    }
    return mini.call(ui, x, y, s, color, align, shadow);
  };
  try {
    return [...hudTexts(h.engine), ...minis];
  } finally {
    ui.mini = mini;
  }
}

describe('couch co-op: the town’s line saying how to join', () => {
  it(
    'is whole, on screen, over no other text and clear of the HUD on phones held both ways, a laptop and a TV',
    async () => {
      const letters = (s: string) => s.replace(/\s+/g, '');
      for (const [name, viewport, touch] of SCREENS) {
        const h = (open = await headlessRiftlight({ seed: 5, viewport, options: { touch } }));
        h.rl.newRun({ seed: 5 });
        h.engine.step(200); // the town's card has come and gone
        h.engine.input.setGamepads([pad(0, [3]), pad(1)]); // player 1 picks up pad 0; pad 1 is there
        h.engine.step(2);
        h.engine.input.setGamepads([pad(0), pad(1)]);
        h.engine.step(2);
        const W = h.game.ui.w;
        const H = h.game.ui.h;
        const where = `${name} (${W}×${H})`;
        expect([h.engine.input.device, h.engine.input.padIndex], where).toEqual(['pad', 0]);
        const texts = textsOf(h);
        const line = t('menu.coop.join'); // its button as the pad in use names it
        const rows = texts.filter((x) => line.includes(x.text) && x.text.length > 2);
        expect(letters(rows.map((r) => r.text).join(' ')), `${where}: the line whole`).toBe(letters(line));
        const model = (h.game as unknown as { hudModel(): HudModel }).hudModel();
        model.controls = h.game.hudRects().controls;
        const zones: Box[] = hudZones(W, H, model);
        for (const r of rows) {
          expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${where}: "${r.text}" on screen ${JSON.stringify(r)}`).toBe(true);
          for (const o of texts) if (!rows.includes(o)) expect(hudOverlap(r, o), `${where}: "${r.text}" over "${o.text}"`).toBe(false);
          for (const z of zones) expect(overlaps(r, z, 0), `${where}: "${r.text}" ${JSON.stringify(r)} over the HUD's ${JSON.stringify(z)}`).toBe(false);
        }
        expect(h.engine.errors, where).toEqual([]);
        h.engine.dispose();
        open = null;
      }
    },
    240_000,
  );
});

describe('couch co-op is not offered in a 52in1 round or the showcase', () => {
  it(
    'a round: no Couch co-op in the pause menu, nobody joins; the showcase (photo mode): no line, nobody joins',
    async () => {
      // a 52in1 moment: its players are the hub's
      const r = await headlessMoment(momentById('gale-escape')!, { seed: 1 });
      open = r;
      r.hub.start();
      for (let f = 0; f < 400 && !r.game.round!.playing; f++) await r.frame();
      r.engine.input.setGamepads([pad(0, [3]), pad(1)]);
      await r.frame();
      r.engine.input.setGamepads([pad(0), pad(1)]);
      await r.frame();
      expect(r.game.openPanel('pause'), 'the pause menu').not.toBeNull();
      expect(r.rl.ui.widgets().map((w) => w.id)).not.toContain('coop');
      expect(r.game.couch()).toBeNull();
      r.rl.ui.close();
      r.engine.input.setGamepads([pad(0), pad(1, [0])]);
      await r.frame();
      await r.frame();
      expect([r.engine.input.joinWith, r.game.coop.guests.length]).toEqual([null, 0]);
      r.engine.dispose();
      open = null;
      // the showcase: in town on a pad (where Cross on another pad would join), photo mode opens
      const h = (open = await headlessRiftlight({ seed: 5 }));
      h.rl.newRun({ seed: 5 });
      h.engine.step(5);
      h.engine.input.setGamepads([pad(0, [3]), pad(1)]);
      h.engine.step(2);
      h.engine.input.setGamepads([pad(0), pad(1)]);
      h.engine.step(2);
      expect(h.engine.input.joinWith, 'in town on a pad: another pad may join').not.toBeNull();
      expect(h.game.couch()).not.toBeNull();
      h.game.showcase.photo.open();
      h.engine.step(2);
      expect([h.game.showcase.active, h.engine.input.joinWith, h.game.couch()]).toEqual([true, null, null]);
      const said = hudTexts(h.engine).map((x) => x.text);
      expect(said.some((x) => /controller/i.test(x)), 'no line saying how to join').toBe(false);
      h.engine.input.setGamepads([pad(0), pad(1, [0])]);
      h.engine.step(2);
      expect(h.game.coop.guests.length, 'nobody joined').toBe(0);
      h.game.showcase.photo.close();
      h.engine.step(2);
      expect(h.engine.errors).toEqual([]);
    },
    240_000,
  );
});

describe('couch co-op: the level card on a short landscape phone', () => {
  it(
    'keeps off the heroes all the while it shows (three guests, the tuning’s rows: 640×360 and 568×320 with touch controls)',
    async () => {
      for (const viewport of [{ width: 640, height: 360, dpr: 3 }, { width: 568, height: 320, dpr: 2 }] as Viewport[]) {
        const h = (open = await headlessRiftlight({ seed: 5, viewport, options: { touch: true } }));
        h.rl.newRun({ seed: 5 });
        h.rl.setDifficulty({ playerDamage: 1.5, playerLife: 1.5, enemyDamage: 1.5, enemyLife: 1.5 }); // four rows in the top-left block
        h.engine.step(5);
        // player 1 picks up pad 0; pads 1 to 3 join with Cross
        const pads = [pad(0), pad(1), pad(2), pad(3)];
        h.engine.input.setGamepads([pad(0, [3]), pad(1), pad(2), pad(3)]);
        h.engine.step(2);
        for (let slot = 1; slot <= 3; slot++) {
          h.engine.input.setGamepads(pads.map((p, i) => (i === slot ? pad(i, [0]) : p)));
          h.engine.step(4);
          h.engine.input.setGamepads(pads);
          h.engine.step(1);
          await settle();
        }
        expect(h.game.coop.seats, `${viewport.width}×${viewport.height}`).toEqual([2, 3, 4]);
        h.engine.input.noteTouch(); // player 1 on the touch controls
        await h.rl.enterDepth(1);
        h.rl.dev.ai = false; // nobody moves: the heroes stand where the level put them
        h.game.settings.touchAutoAttack = false;
        await settle();
        const where = `${viewport.width}×${viewport.height} at DPR ${viewport.dpr}`;
        const cam = h.engine.camera.camera;
        const seen: Box[] = [];
        for (let f = 0; f < 60 * 4; f++) {
          h.engine.step(1);
          const banner = h.game.hudRects().zones.find((z) => z.id === 'banner');
          if (!banner) continue;
          seen.push(banner);
          const heroes = [h.game.hero, ...h.game.coop.guests.map((g) => g.hero!)].map((x) => worldBox(x.actor.position, HEAD, 0.9, cam, h.game.ui)!);
          for (const hero of heroes) expect(overlaps(banner, hero, 0), `${where}, frame ${f}: the card ${JSON.stringify(banner)} over a hero ${JSON.stringify(hero)}`).toBe(false);
        }
        expect(seen.length, `${where}: the card showed`).toBeGreaterThan(60);
        expect(new Set(seen.map((b) => JSON.stringify(b))).size, `${where}: the card stays put while it shows`).toBe(1);
        expect(h.engine.errors, where).toEqual([]);
        h.engine.dispose();
        open = null;
      }
    },
    240_000,
  );
});

describe('couch co-op: the guests’ strips on a short landscape phone', () => {
  it(
    'keep off the heroes and their rows all level, and stay put (two guests, the tuning’s rows: 640×360 and 568×320 with touch controls)',
    async () => {
      for (const viewport of [{ width: 640, height: 360, dpr: 3 }, { width: 568, height: 320, dpr: 2 }] as Viewport[]) {
        const h = (open = await headlessRiftlight({ seed: 5, viewport, options: { touch: true } }));
        h.rl.newRun({ seed: 5 });
        h.rl.setDifficulty({ playerDamage: 1.5, playerLife: 1.5, enemyDamage: 1.5, enemyLife: 1.5 }); // four rows in the top-left block
        h.engine.step(5);
        // player 1 picks up pad 0; pads 1 and 2 join with Cross
        const pads = [pad(0), pad(1), pad(2)];
        h.engine.input.setGamepads([pad(0, [3]), pad(1), pad(2)]);
        h.engine.step(2);
        for (let slot = 1; slot <= 2; slot++) {
          h.engine.input.setGamepads(pads.map((p, i) => (i === slot ? pad(i, [0]) : p)));
          h.engine.step(4);
          h.engine.input.setGamepads(pads);
          h.engine.step(1);
          await settle();
        }
        expect(h.game.coop.seats, `${viewport.width}×${viewport.height}`).toEqual([2, 3]);
        h.engine.input.noteTouch(); // player 1 on the touch controls
        await h.rl.enterDepth(1);
        h.rl.dev.ai = false; // nobody moves: the heroes stand where the level put them
        h.game.settings.touchAutoAttack = false;
        await settle();
        h.engine.step(2); // the stage's first frames: the camera on player 1, the heroes known
        const where = `${viewport.width}×${viewport.height} at DPR ${viewport.dpr}`;
        const cam = h.engine.camera.camera;
        const seen = new Set<string>();
        for (let f = 0; f < 60 * 3; f++) {
          h.engine.step(1);
          const strips = h.game.hudRects().zones.find((z) => z.id === 'guests');
          expect(strips, `${where}, frame ${f}: the strips`).toBeDefined();
          seen.add(JSON.stringify(strips));
          const heroes = [h.game.hero, ...h.game.coop.guests.map((g) => g.hero!)].map((x) => worldBox(x.actor.position, HEAD, 0.9, cam, h.game.ui)!);
          const rows: Box = { x: 0, y: Math.min(...heroes.map((b) => b.y)), w: h.game.ui.w, h: Math.max(...heroes.map((b) => b.y + b.h)) - Math.min(...heroes.map((b) => b.y)) };
          for (const hero of heroes) expect(overlaps(strips!, hero, 0), `${where}, frame ${f}: the strips ${JSON.stringify(strips)} over a hero ${JSON.stringify(hero)}`).toBe(false);
          expect(overlaps(strips!, rows, 0), `${where}, frame ${f}: the strips ${JSON.stringify(strips)} in the heroes' rows ${JSON.stringify(rows)}`).toBe(false);
        }
        expect([...seen], `${where}: the strips stay put`).toHaveLength(1);
        expect(h.engine.errors, where).toEqual([]);
        h.engine.dispose();
        open = null;
      }
    },
    240_000,
  );
});
