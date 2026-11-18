import { afterAll, describe, expect, it } from 'vitest';
import { type AspectMode, computeFraming, RESOLUTIONS, touchScale } from '../../engine/framing';
import { Vector3 } from 'three/webgpu';
import { type HudColor, Lang, textWidthPx } from '../../engine';
import { RIFTLIGHT_TOUCH_BUTTONS } from '../game/touch';
import { RIFTLIGHT_OPTIONS } from '../index';
import { installLanguage, riftlightLines, t } from '../lang';
import { bossNameShown } from '../lang/monsters';
import { riftlightTranslations } from '../lang/translations';
import { designedBoss } from '../monsters/bosses';
import { MOMENTS, momentGoal } from '../session/moments';
import { drawHud, type GuestStrip, hudBoxes, hudGeometry, type HudModel, hudZones } from './hud';
import { type Align, miniCovers, miniWidth, UiCanvas } from './kit';
import { type Box, overlaps } from './layout';

/**
 * The touch controls of a phone screen in art pixels, from the button data and the engine's
 * CSS (stick 128 px + 2 px border, 16 px from the corner; placed buttons from an 8 px safe
 * margin), on the art the game draws there (`fill`, at Riftlight's `touchDensity`: two CSS pixels
 * per art pixel at least on a phone). The e2e `phone` suite checks the same thing against the
 * real DOM rects.
 */
function controlsFor(vw: number, vh: number, dpr: number, aspect: AspectMode = 'fill', density = RIFTLIGHT_OPTIONS.touchDensity ?? 0): { W: number; H: number; boxes: Box[] } {
  const f = computeFraming(vw, vh, dpr, RESOLUTIONS.default, aspect, touchScale({ width: vw, height: vh, dpr }, density));
  const k = f.artWidth / f.cssWidth; // art pixels per CSS pixel
  const toArt = (x: number, y: number, w: number, h: number): Box => {
    const ax = Math.floor((x - f.offsetX) * k);
    const ay = Math.floor((y - f.offsetY) * k);
    return { x: ax, y: ay, w: Math.floor((x + w - f.offsetX) * k) - ax + 1, h: Math.floor((y + h - f.offsetY) * k) - ay + 1 };
  };
  const boxes = [toArt(16, vh - 16 - 132, 132, 132)];
  for (const b of RIFTLIGHT_TOUCH_BUTTONS) {
    const at = b.at!;
    const size = at.size ?? 58;
    const corner = at.corner ?? 'bottom-right';
    const left = corner.endsWith('left') ? 8 + at.x - size / 2 : vw - 8 - at.x - size / 2;
    const top = corner.startsWith('top') ? 8 + at.y - size / 2 : vh - 8 - at.y - size / 2;
    boxes.push(toArt(left, top, size, size));
  }
  return { W: f.artWidth, H: f.artHeight, boxes };
}

const orbBox = (o: { x: number; y: number }, r: number): Box => ({ x: o.x - r - 2, y: o.y - r - 2, w: 2 * r + 5, h: 2 * r + 5 });

describe('hudGeometry with touch controls', () => {
  for (const [name, vw, vh, dpr] of [
    ['portrait phone', 390, 844, 2],
    ['portrait phone dpr 3', 390, 844, 3],
    ['landscape phone', 844, 390, 2],
    ['landscape phone dpr 3', 844, 390, 3],
    ['small portrait phone', 360, 740, 2],
  ] as const) {
    it(`${name}: no skill bar, orbs and the XP bar clear of every control and on screen`, () => {
      const { W, H, boxes } = controlsFor(vw, vh, dpr);
      const g = hudGeometry(W, H, boxes);
      expect(g.touch).toBe(true);
      const hud = [orbBox(g.life, g.orbR), orbBox(g.mana, g.orbR), { x: g.xp.x, y: g.xp.y, w: g.xp.w, h: 3 }, { x: g.levelAt.x - 12, y: g.levelAt.y, w: 24, h: 5 }];
      for (const h of hud) {
        expect(h.x).toBeGreaterThanOrEqual(0);
        expect(h.y).toBeGreaterThanOrEqual(0);
        expect(h.x + h.w).toBeLessThanOrEqual(W);
        expect(h.y + h.h).toBeLessThanOrEqual(H);
        for (const c of boxes) expect(overlaps(h, c, 0), `${JSON.stringify(h)} overlaps control ${JSON.stringify(c)}`).toBe(false);
      }
      // life on the left, mana on the right, in the bottom half
      expect(g.life.x).toBeLessThan(W / 2);
      expect(g.mana.x).toBeGreaterThan(W / 2);
      expect(Math.min(g.life.y, g.mana.y)).toBeGreaterThan(H / 2);
    });
  }

  for (const [vw, vh, dpr] of [
    [844, 390, 2],
    [844, 390, 3],
    [852, 393, 3],
    [740, 360, 2],
    [915, 412, 2.625],
  ] as const)
    it(`landscape ${vw}×${vh} at DPR ${dpr}: the phone's denser art, the orbs beside the controls on the bottom row with the XP bar between them, clear of the minimap and the gold`, () => {
      const { W, H, boxes } = controlsFor(vw, vh, dpr);
      expect(H, 'a landscape phone draws about 180 to 200 rows (two CSS pixels per art pixel)').toBeGreaterThanOrEqual(175);
      expect(H).toBeLessThanOrEqual(210);
      const g = hudGeometry(W, H, boxes);
      expect(g.life.y).toBe(g.mana.y);
      expect(g.life.y + g.orbR).toBeGreaterThan(H - 12);
      expect(g.xp.x).toBeGreaterThan(g.life.x + g.orbR);
      expect(g.xp.x + g.xp.w).toBeLessThan(g.mana.x - g.orbR);
      // the minimap, the gold under it and the orbs never meet (a level, with a big purse)
      const m = { ...hudModel(boxes), minimap: MINIMAP, gold: 9_876_543, goldShown: 9_876_543 };
      const z = hudBoxes(W, H, m);
      const of = (id: string) => z.filter((b) => b.id === id);
      for (const a of [...of('life'), ...of('mana'), ...of('xp')]) for (const b of [...of('minimap'), ...of('gold'), ...of('control')]) expect(overlaps(a, b, 0), `${a.id} ${JSON.stringify(a)} over ${b.id} ${JSON.stringify(b)}`).toBe(false);
    });

  it('portrait: the top-left text starts right of the ≡ button', () => {
    const { W, H, boxes } = controlsFor(390, 844, 2);
    const g = hudGeometry(W, H, boxes);
    const menu = boxes[boxes.length - 1]!;
    expect(g.textX).toBeGreaterThan(menu.x + menu.w);
  });

  it('without controls it is the desktop / compact layout', () => {
    const g = hudGeometry(480, 270);
    expect(g.touch).toBe(false);
    expect(g.life).toEqual({ x: g.orbX, y: g.orbY });
    expect(g.mana).toEqual({ x: 480 - g.orbX, y: g.orbY });
    expect(g.xp).toEqual({ x: g.bx - 4, y: g.by - 8, w: g.barW + 2 });
  });
});

/** The corner map of a level (its cells don't matter here). */
const MINIMAP: HudModel['minimap'] = { width: 8, height: 8, cell: () => 1, explored: new Uint8Array(64), hero: { x: 4, z: 4 }, exit: null, boss: null, origin: { x: 0, z: 0 } };

/** A level's HUD model on a phone (or not: no controls). */
function hudModel(controls: Box[], o: { boss?: string | null; label?: string; difficulty?: string[] } = {}): HudModel {
  return {
    time: 0,
    vitals: { life: 50, maxLife: 100, mana: 20, maxMana: 40, es: 0, maxEs: 0 },
    levelUpAge: 99,
    level: 3,
    xp: 0.5,
    skills: [],
    buffs: [],
    boss: o.boss ? { name: o.boss, life: 50, maxLife: 100, phases: [0.66, 0.33], phase: 1, position: new Vector3() } : null,
    minimap: MINIMAP,
    gold: 1234,
    goldShown: 1234,
    feed: [],
    card: null,
    streak: null,
    difficulty: o.difficulty ?? [],
    hurt: 0,
    levelLabel: o.label ?? 'II · Gloom',
    timer: '12:34',
    device: controls.length ? 'touch' : 'keyboard',
    padStyle: 'playstation',
    progress: { killed: 12, total: 57 },
    controls,
  };
}

describe('a boss\'s name and bar', () => {
  it('never run under the minimap and the gold: at the top beside the minimap where they fit, else across the screen under it (a phone in portrait, a narrow window)', () => {
    const boss = 'Nyx-Hollow, the Lantern Eater';
    for (const W of [130, 160, 260, 300, 334, 360, 400, 422, 427, 460, 480, 640]) {
      const H = W < 300 ? 282 : 240;
      const z = hudBoxes(W, H, hudModel([], { boss }));
      const bar = z.find((b) => b.id === 'boss')!;
      expect(bar, `${W}`).toBeDefined();
      expect(bar.x >= 0 && bar.x + bar.w <= W, `${W}: on screen ${JSON.stringify(bar)}`).toBe(true);
      for (const id of ['minimap', 'gold', 'where'] as const) {
        const o = z.find((b) => b.id === id)!;
        expect(overlaps(bar, o, 0), `${W}: the boss's bar ${JSON.stringify(bar)} over the ${id} ${JSON.stringify(o)}`).toBe(false);
      }
    }
    // a wide screen keeps it where it was: centred at the top, 200 wide
    const wide = hudBoxes(480, 270, hudModel([], { boss })).find((b) => b.id === 'boss')!;
    expect(wide).toEqual({ id: 'boss', x: 138, y: 5, w: 220, h: 20 });
  });
});

describe('the top-left block', () => {
  afterAll(() => void installLanguage(new Lang(riftlightLines())));

  it('reserves every row it draws, the clock, the kills and the tuning too, as wide as the widest (a longer language)', () => {
    const translations = riftlightTranslations();
    for (const code of ['en', 'tr', 'de', 'ru']) {
      installLanguage(new Lang(riftlightLines(), translations, { code }));
      const tuned = [t('hud.tuned.enemy_damage', { value: '1.50' }), t('hud.tuned.enemy_life', { value: '2.00' })];
      for (const [W, H] of [
        [480, 270],
        [422, 195],
        [130, 282],
      ] as const) {
        const m = hudModel([], { difficulty: tuned, label: 'II · Gloom' });
        const texts: { x: number; y: number; w: number; s: string }[] = [];
        const hud = {
          width: W,
          height: H,
          rect() {},
          sprite() {},
          text(x: number, y: number, s: string, o: { scale?: number } = {}) {
            texts.push({ x, y, w: textWidthPx(s, o.scale ?? 1), s });
          },
          measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }),
        };
        class Minis extends UiCanvas {
          override mini(x: number, y: number, s: string, color?: HudColor, align: Align = 'left', shadow?: HudColor | false): number {
            if (align === 'left') texts.push({ x, y, w: miniWidth(s), s });
            return super.mini(x, y, s, color, align, shadow);
          }
        }
        drawHud(new Minis(hud as never), m);
        const where = hudBoxes(W, H, m).find((b) => b.id === 'where')!;
        const left = texts.filter((x) => x.x <= where.x + 4 && x.y < 80);
        expect(left.map((x) => x.s), `${code} ${W}: the clock and the tuning drawn`).toEqual(expect.arrayContaining(['12:34', t('hud.tuned'), ...tuned]));
        for (const x of left) expect(x.x + x.w <= where.x + where.w && x.y + 7 <= where.y + where.h, `${code} ${W}: "${x.s}" ${JSON.stringify(x)} inside ${JSON.stringify(where)}`).toBe(true);
      }
    }
  });
});

describe('the top-left label in a longer language', () => {
  /** The HUD drawn on a stand-in Hud that records where each text goes. */
  function drawn(W: number, label: string, boss: string | null) {
    const texts: { x: number; y: number; s: string; w: number }[] = [];
    const hud = {
      width: W,
      height: 270,
      rect() {},
      sprite() {},
      text(x: number, y: number, s: string, o: { scale?: number } = {}) {
        texts.push({ x, y, s, w: textWidthPx(s, o.scale ?? 1) });
      },
      measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }),
    };
    const model: HudModel = {
      time: 0,
      vitals: { life: 50, maxLife: 100, mana: 20, maxMana: 40, es: 0, maxEs: 0 },
      levelUpAge: 99,
      level: 3,
      xp: 0.5,
      skills: [],
      buffs: [],
      boss: boss ? { name: boss, life: 50, maxLife: 100, phases: [0.5], phase: 0, position: new Vector3() } : null,
      minimap: null,
      gold: 0,
      goldShown: 0,
      feed: [],
      card: null,
      streak: null,
      difficulty: [],
      hurt: 0,
      levelLabel: label,
      timer: '1:05',
      device: 'keyboard',
      padStyle: 'playstation',
      progress: null,
    };
    drawHud(new UiCanvas(hud as never), model);
    return texts;
  }

  it('wraps clear of a boss\'s name instead of running into it', () => {
    const label = '[Ríft 13: [[Stórmspíré ····] [Míré ··] ·] ···]';
    const boss = '[Gorrak, the Ember Tyrant ·····]';
    const texts = drawn(480, label, boss);
    const name = texts.find((x) => x.s === boss)!;
    const left = name.x; // drawn centred: x is its left edge
    const rows = texts.filter((x) => x.y < 30 && x.s !== boss && x.x < 40);
    expect(rows.map((r) => r.s).join(' ').replace(/\s+/g, ' ')).toBe(label.replace(/\s+/g, ' ')); // nothing lost
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r.x + r.w, r.s).toBeLessThan(left);
    // without a boss it has the screen's width
    expect(drawn(480, label, null).filter((x) => x.s === label)).toHaveLength(1);
  });
});

describe('a 52in1 moment: its seconds left and its goal, on a phone and a wide screen', () => {
  afterAll(() => void installLanguage(new Lang(riftlightLines())));

  /** A text drawn (the normal font, or the mini font's), its box with its shadow. */
  type Drawn = Box & { s: string; mini: boolean };

  /** The HUD drawn on a stand-in Hud that records every text, in the normal font and the mini font. */
  function drawn(W: number, H: number, m: HudModel): Drawn[] {
    const texts: Drawn[] = [];
    const hud = {
      width: W,
      height: H,
      rect() {},
      sprite() {},
      text(x: number, y: number, s: string, o: { scale?: number } = {}) {
        const k = o.scale ?? 1;
        texts.push({ x, y, w: textWidthPx(s, k) + k, h: 7 * k + k, s, mini: false });
      },
      measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }),
    };
    class Recording extends UiCanvas {
      override mini(x: number, y: number, s: string, color?: HudColor, align: Align = 'left', shadow?: HudColor | false): number {
        if (s && miniCovers(s)) {
          const w = miniWidth(s);
          texts.push({ x: Math.round(align === 'center' ? x - Math.floor(w / 2) : align === 'right' ? x - w : x), y: Math.round(y), w: w + 1, h: 6, s, mini: true });
        }
        return super.mini(x, y, s, color, align, shadow);
      }
    }
    drawHud(new Recording(hud as never), m);
    return texts;
  }

  const minimap: HudModel['minimap'] = { width: 8, height: 8, cell: () => 1, explored: new Uint8Array(64), hero: { x: 4, z: 4 }, exit: null, boss: null, origin: { x: 0, z: 0 } };

  function model(controls: Box[], o: { boss: string | null; seconds: number; goal: string; label: string }): HudModel {
    return {
      time: 0,
      vitals: { life: 50, maxLife: 100, mana: 20, maxMana: 40, es: 0, maxEs: 0 },
      levelUpAge: 99,
      level: 2,
      xp: 0.2,
      skills: [],
      buffs: [],
      boss: o.boss ? { name: o.boss, life: 90, maxLife: 100, phases: [0.5], phase: 0, position: new Vector3() } : null,
      minimap,
      gold: 120,
      goldShown: 120,
      feed: [],
      // the countdown's number, its plate open, the moment's goal under it
      card: { title: '3', subtitle: o.goal, age: 0.5, duration: 1.05, kind: 'card' },
      streak: null,
      difficulty: [],
      hurt: 0,
      levelLabel: o.label,
      timer: '0:00',
      device: controls.length ? 'touch' : 'keyboard',
      padStyle: 'playstation',
      progress: { killed: 0, total: 54 },
      controls,
      timeLeft: { text: t('round.moment_left', { count: o.seconds }), urgent: false },
    };
  }

  /** Phones held both ways (touch), the narrowest phone, a laptop, and the hub's frame of one player on a 1280×900 window. */
  const SCREENS = [
    ['390×844 phone', 390, 844, 3, true],
    ['360×780 phone', 360, 780, 3, true],
    ['844×390 phone', 844, 390, 2, true],
    ['1280×720', 1280, 720, 1, false],
    ['the hub’s frame, 1000×850', 1000, 850, 1, false],
  ] as const;

  const LANGUAGES = ['en', ...Object.keys(riftlightTranslations())];

  it('the seconds left are on screen and over nothing; the goal is shown whole, inside its plate, under them; in every language', () => {
    const translations = riftlightTranslations();
    let checked = 0;
    for (const code of LANGUAGES) {
      installLanguage(new Lang(riftlightLines(), translations, { code }));
      for (const [name, vw, vh, dpr, touch] of SCREENS) {
        const f = controlsFor(vw, vh, dpr, 'fill');
        const controls = touch ? f.boxes : [];
        const { W, H } = f;
        const g = hudGeometry(W, H, controls);
        for (const mo of MOMENTS) {
          const boss = 'boss' in mo.target ? bossNameShown(designedBoss(mo.depth)) : null;
          const goal = momentGoal(mo);
          const m = model(controls, { boss, seconds: mo.seconds, goal, label: 'III · Gale' });
          const where = `${code}, ${name} (${W}×${H}), ${mo.id}`;
          const texts = drawn(W, H, m);
          const left = texts.find((x) => x.s === m.timeLeft!.text && !x.mini);
          expect(left, `${where}: the seconds left are drawn whole`).toBeDefined();
          expect(left!.x >= 0 && left!.y >= 0 && left!.x + left!.w <= W, `${where}: the seconds left on screen ${JSON.stringify(left)}`).toBe(true);
          for (const o of texts) if (o !== left) expect(overlaps(left!, o, 0), `${where}: the seconds left over "${o.s}"`).toBe(false);
          const map = { x: W - g.map.w - 6, y: 2, w: g.map.w + 4, h: g.map.h + 4 };
          expect(overlaps(left!, map, 0), `${where}: the seconds left under the minimap`).toBe(false);
          if (boss) expect(overlaps(left!, { x: Math.floor((W - g.bossW) / 2) - 1, y: 16, w: g.bossW + 12, h: 10 }, 0), `${where}: the seconds left over the boss's bar`).toBe(false);
          for (const c of controls) expect(overlaps(left!, c, 0), `${where}: the seconds left under a control`).toBe(false);
          // the goal: every word of it, in rows inside the banner's plate, which is under the seconds left
          const title = texts.find((x) => x.s === '3')!;
          const plate = hudZones(W, H, m).find((z) => overlaps(z, title, 0) && z.w >= title.w + 20)!;
          expect(plate, `${where}: the banner`).toBeDefined();
          expect(overlaps(plate, left!, 0), `${where}: the banner over the seconds left`).toBe(false);
          const rows = texts.filter((x) => x.y > title.y && x.y < plate.y + plate.h && x.x >= plate.x && x.x + x.w <= plate.x + plate.w + 1).sort((a, b) => a.y - b.y);
          const letters = (x: string) => x.replace(/[\s\u2066-\u2069]+/gu, ''); // rows break at spaces (a name's isolates aside)
          expect(letters(rows.map((r) => r.s).join(' ')), `${where}: the goal whole`).toBe(letters(goal));
          for (const r of rows) expect(r.y + r.h <= plate.y + plate.h && r.x >= plate.x && r.x + r.w <= plate.x + plate.w + 1, `${where}: "${r.s}" inside its plate ${JSON.stringify(plate)}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBe(LANGUAGES.length * SCREENS.length * MOMENTS.length);
  });
});

describe('couch co-op: the guests’ strips (players 2 to 4) on phones held both ways, touch and pad, and wider screens', () => {
  /** Phones held both ways (with touch controls, and on a pad without them), the narrowest phone, a laptop, the hub's frame of one player. */
  const SCREENS = [
    ['390×844 phone', 390, 844, 3],
    ['390×844 phone dpr 2', 390, 844, 2],
    ['360×740 phone', 360, 740, 2],
    ['844×390 phone', 844, 390, 3],
    ['844×390 phone dpr 2', 844, 390, 2],
    ['1280×720', 1280, 720, 1],
    ['the hub’s frame, 1000×850', 1000, 850, 1],
  ] as const;
  const minimap: HudModel['minimap'] = { width: 8, height: 8, cell: () => 1, explored: new Uint8Array(64), hero: { x: 4, z: 4 }, exit: null, boss: null, origin: { x: 0, z: 0 } };
  /** A page with touch controls (and Riftlight's touch density), the same page on a pad (the controls stepped aside), and a page without touch controls (no touch density). */
  const PAGES = [
    [true, RIFTLIGHT_OPTIONS.touchDensity ?? 0],
    [false, RIFTLIGHT_OPTIONS.touchDensity ?? 0],
    [false, 0],
  ] as const;
  const strip = (seat: number): GuestStrip => ({ seat, color: 0x3f7fff, life: 0.6, skills: [1, 0.4, -1, 0], rise: seat === 3 ? 3.2 : null });
  function model(controls: Box[], o: { guests: number; boss: boolean; tuned: number; map: boolean }): HudModel {
    return {
      time: 0,
      vitals: { life: 50, maxLife: 100, mana: 20, maxMana: 40, es: 0, maxEs: 0 },
      levelUpAge: 99,
      level: 7,
      xp: 0.3,
      skills: [],
      buffs: [],
      boss: o.boss ? { name: 'Vorgath', life: 90, maxLife: 100, phases: [0.5], phase: 0, position: new Vector3() } : null,
      minimap: o.map ? minimap : null,
      gold: 1234,
      goldShown: 1234,
      feed: [],
      card: null,
      streak: null,
      difficulty: Array.from({ length: o.tuned }, (_, k) => `x${k + 2}`),
      hurt: 0,
      levelLabel: 'Depth 3 · The Gale Steps',
      timer: '4:05',
      device: controls.length ? 'touch' : 'pad',
      padStyle: 'playstation',
      progress: { killed: 12, total: 54 },
      controls,
      guests: Array.from({ length: o.guests }, (_, k) => strip(k + 2)),
    };
  }
  /** The texts the HUD draws (normal and mini font) and the guests' strips' frames (their ink rects). */
  function drawn(W: number, H: number, m: HudModel): Box[] {
    const texts: Box[] = [];
    const hud = {
      width: W,
      height: H,
      rect() {},
      sprite() {},
      text(x: number, y: number, s: string, o: { scale?: number } = {}) {
        const k = o.scale ?? 1;
        texts.push({ x, y, w: textWidthPx(s, k) + k, h: 7 * k + k });
      },
      measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }),
    };
    class Recording extends UiCanvas {
      override mini(x: number, y: number, s: string, color?: HudColor, align: Align = 'left', shadow?: HudColor | false): number {
        if (s && miniCovers(s) && color !== 'ink') {
          const w = miniWidth(s);
          texts.push({ x: Math.round(align === 'center' ? x - Math.floor(w / 2) : align === 'right' ? x - w : x), y: Math.round(y), w: w + 1, h: 6 });
        }
        return super.mini(x, y, s, color, align, shadow);
      }
    }
    drawHud(new Recording(hud as never), m);
    return texts;
  }

  it('are on screen, clear of the minimap and gold, the top-left block, a boss’s bar, the orbs, the bars, every text and every touch control', () => {
    let checked = 0;
    for (const [name, vw, vh, dpr] of SCREENS) {
      // a page with touch controls draws at Riftlight's touch density (a pad picked up there too); a page without at the art size the viewport gives
      for (const [touch, density] of PAGES) {
        const f = controlsFor(vw, vh, dpr, 'fill', density);
        const controls = touch ? f.boxes : [];
        const { W, H } = f;
        for (const guests of [1, 2, 3]) {
          for (const [boss, tuned, map] of [[false, 0, true], [true, 2, true], [false, 0, false]] as const) {
            const where = `${name} (${W}×${H}), ${touch ? 'touch' : 'pad'}${density ? '' : ', no touch density'}, ${guests} guest(s)${boss ? ', a boss' : ''}${tuned ? ', tuned' : ''}${map ? '' : ', no minimap'}`;
            const m = model(controls, { guests, boss, tuned, map });
            const others = hudZones(W, H, { ...m, guests: [] });
            const zones = hudZones(W, H, m);
            const strips = zones.filter((z) => !others.some((o) => JSON.stringify(o) === JSON.stringify(z)));
            expect(strips.length, `${where}: the strips' zone`).toBe(1);
            const box = strips[0]!;
            expect(box.x >= 0 && box.y >= 0 && box.x + box.w <= W && box.y + box.h <= H, `${where}: on screen ${JSON.stringify(box)}`).toBe(true);
            for (const z of others) expect(overlaps(box, z, 0), `${where}: the strips ${JSON.stringify(box)} over the HUD's ${JSON.stringify(z)}`).toBe(false);
            for (const c of controls) expect(overlaps(box, c, 0), `${where}: the strips under a control ${JSON.stringify(c)}`).toBe(false);
            const own = drawn(W, H, m);
            const without = drawn(W, H, { ...m, guests: [] });
            for (const x of without) expect(overlaps(box, x, 0), `${where}: the strips over a text ${JSON.stringify(x)}`).toBe(false);
            expect(own.length, `${where}: a guest down shows its seconds`).toBe(without.length + (guests >= 2 ? 1 : 0));
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(SCREENS.length * PAGES.length * 3 * 3);
  });

  it('a banner (the level card, a level-up, LEVEL CLEAR) goes under the strips, never over them; a boss’s bar stays put as guests come and go', () => {
    let checked = 0;
    for (const [name, vw, vh, dpr] of SCREENS) {
      for (const [touch, density] of PAGES) {
        const f = controlsFor(vw, vh, dpr, 'fill', density);
        const controls = touch ? f.boxes : [];
        const { W, H } = f;
        for (const guests of [1, 2, 3]) {
          for (const boss of [false, true]) {
            for (const kind of ['card', 'levelup', 'clear'] as const) {
              const where = `${name} (${W}×${H}), ${touch ? 'touch' : 'pad'}${density ? '' : ', no touch density'}, ${guests} guest(s)${boss ? ', a boss' : ''}, a ${kind} banner`;
              const m: HudModel = { ...model(controls, { guests, boss, tuned: 0, map: true }), card: { title: 'The Gale Steps', subtitle: 'Depth 3', age: 1, kind } };
              const z = hudBoxes(W, H, m);
              const strips = z.find((b) => b.id === 'guests')!;
              const banner = z.find((b) => b.id === 'banner')!;
              expect(banner, where).toBeDefined();
              expect(overlaps(banner, strips, 0), `${where}: the banner ${JSON.stringify(banner)} over the strips ${JSON.stringify(strips)}`).toBe(false);
              expect(banner.y + banner.h <= H, `${where}: the banner on screen ${JSON.stringify(banner)}`).toBe(true);
              const alone = hudBoxes(W, H, { ...m, guests: [] });
              expect(z.find((b) => b.id === 'boss'), `${where}: the boss's bar where it was without guests`).toEqual(alone.find((b) => b.id === 'boss'));
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(SCREENS.length * PAGES.length * 3 * 2 * 3);
  });
});
