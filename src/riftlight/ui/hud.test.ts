import { afterAll, describe, expect, it } from 'vitest';
import { type AspectMode, computeFraming, RESOLUTIONS, touchScale } from '../../engine/framing';
import { Vector3 } from 'three/webgpu';
import { type HudColor, Lang, textWidthPx, type TouchButton } from '../../engine';
import { HUB_WAKE, RIFTLIGHT_HUB_TOUCH_BUTTONS, RIFTLIGHT_TOUCH_BUTTONS, touchLayout } from '../game/touch';
import { RIFTLIGHT_OPTIONS } from '../index';
import { installLanguage, riftlightLines, t } from '../lang';
import { bossNameShown } from '../lang/monsters';
import { riftlightTranslations } from '../lang/translations';
import { designedBoss } from '../monsters/bosses';
import { MOMENTS, momentGoal } from '../session/moments';
import type { SkillSlotView } from '../game/ports';
import { drawHud, type GuestStrip, type HudBox, hudBoxes, hudGeometry, type HudModel, hudZones } from './hud';
import { type Align, miniCovers, miniWidth, UiCanvas } from './kit';
import { type Box, overlaps } from './layout';

/**
 * The touch controls of a phone screen in art pixels, from the button data and the engine's
 * CSS (stick 128 px + 2 px border, 16 px from the corner; placed buttons from an 8 px safe
 * margin), on the art the game draws there (`fill`, at Riftlight's `touchDensity`: two CSS pixels
 * per art pixel at least on a phone). The e2e `phone` suite checks the same thing against the
 * real DOM rects. `wake`: 52in1's wake band there in art pixels, as `TouchPad.wakeArt` has it;
 * `css`: CSS px per art pixel.
 */
function controlsFor(vw: number, vh: number, dpr: number, aspect: AspectMode = 'fill', density = RIFTLIGHT_OPTIONS.touchDensity ?? 0, buttons: readonly TouchButton[] = RIFTLIGHT_TOUCH_BUTTONS): { W: number; H: number; boxes: Box[]; wake: number; css: number } {
  const f = computeFraming(vw, vh, dpr, RESOLUTIONS.default, aspect, touchScale({ width: vw, height: vh, dpr }, density));
  const k = f.artWidth / f.cssWidth; // art pixels per CSS pixel
  const toArt = (x: number, y: number, w: number, h: number): Box => {
    const ax = Math.floor((x - f.offsetX) * k);
    const ay = Math.floor((y - f.offsetY) * k);
    return { x: ax, y: ay, w: Math.floor((x + w - f.offsetX) * k) - ax + 1, h: Math.floor((y + h - f.offsetY) * k) - ay + 1 };
  };
  const boxes = [toArt(16, vh - 16 - 132, 132, 132)];
  for (const b of buttons) {
    const at = b.at!;
    const size = at.size ?? 58;
    const corner = at.corner ?? 'bottom-right';
    const left = corner.endsWith('left') ? 8 + at.x - size / 2 : vw - 8 - at.x - size / 2;
    const top = corner.startsWith('top') ? 8 + at.y - size / 2 : vh - 8 - at.y - size / 2;
    boxes.push(toArt(left, top, size, size));
  }
  return { W: f.artWidth, H: f.artHeight, boxes, wake: Math.max(0, Math.ceil(((HUB_WAKE - f.offsetY) / f.cssHeight) * f.artHeight)), css: f.cssWidth / f.artWidth };
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

  it('an orb pushed up its side by the controls stops short of the minimap and the gold: it moves in along its row instead', () => {
    // a landscape phone's 422×195 whose right half is taken from row 60 down (a cluster of
    // buttons that tall): the mana orb's lowest spot is at the top, where the corner map is
    const W = 422;
    const H = 195;
    const controls: Box[] = [{ x: 211, y: 60, w: 211, h: 135 }];
    const g = hudGeometry(W, H, controls);
    const mana = orbBox(g.mana, g.orbR);
    expect(mana.y + mana.h, 'it climbed above the controls').toBeLessThanOrEqual(60);
    const z = hudBoxes(W, H, { ...hudModel(controls), minimap: MINIMAP, gold: 9_876_543, goldShown: 9_876_543 });
    for (const b of z.filter((x) => x.id === 'minimap' || x.id === 'gold')) expect(overlaps(mana, b, 0), `the mana orb ${JSON.stringify(mana)} under the ${b.id} ${JSON.stringify(b)}`).toBe(false);
    for (const c of controls) expect(overlaps(mana, c, 0)).toBe(false);
    expect(g.mana.x, 'still on its own side').toBeGreaterThan(W / 2);
  });

  it('portrait: the top-left text starts right of the ≡ button', () => {
    const { W, H, boxes } = controlsFor(390, 844, 2);
    const g = hudGeometry(W, H, boxes);
    const menu = boxes[boxes.length - 1]!;
    expect(g.textX).toBeGreaterThan(menu.x + menu.w);
  });

  it('in 52in1 ≡ sits below the hub’s wake band (a touch above it brings the hub’s bar), still beside the top-left block, over none of the fixed HUD', () => {
    for (const [vw, vh, dpr] of [[390, 844, 3], [844, 390, 3], [740, 360, 2], [915, 412, 2.625]] as const) {
      const where = `${vw}×${vh} at DPR ${dpr}`;
      const css = touchLayout(vw, vh, RIFTLIGHT_HUB_TOUCH_BUTTONS).at(-1)!;
      expect(css.y, `${where}: ≡'s top below the wake band`).toBeGreaterThanOrEqual(HUB_WAKE);
      expect(touchLayout(vw, vh).at(-1)!.y, `${where}: on its own page it is in the corner`).toBeLessThan(HUB_WAKE);
      const { W, H, boxes } = controlsFor(vw, vh, dpr, 'fill', RIFTLIGHT_OPTIONS.touchDensity ?? 0, RIFTLIGHT_HUB_TOUCH_BUTTONS);
      const menu = boxes.at(-1)!;
      const g = hudGeometry(W, H, boxes);
      expect(g.textX, `${where}: the top-left text right of ≡`).toBeGreaterThan(menu.x + menu.w);
      const m = { time: 0, vitals: { life: 50, maxLife: 100, mana: 20, maxMana: 40, es: 0, maxEs: 0 }, levelUpAge: 99, level: 7, xp: 0.3, skills: [], buffs: [], boss: null, minimap: null, gold: 10, goldShown: 10, feed: [], card: null, streak: null, difficulty: ['x2', 'x3'], hurt: 0, levelLabel: 'Depth 3 · The Gale Steps', timer: '4:05', device: 'touch', padStyle: 'playstation', progress: { killed: 1, total: 9 }, controls: boxes } satisfies HudModel;
      for (const z of hudBoxes(W, H, m).filter((z) => z.id !== 'control')) expect(overlaps(z, menu, 0), `${where}: the ${z.id} ${JSON.stringify(z)} under ≡ ${JSON.stringify(menu)}`).toBe(false);
    }
  });

  it(
    'in 52in1 a phone held sideways has the whole corner map and the gold below the hub’s wake band, a thumb across, over no control and none of the HUD (a boss’s bar, a banner, couch guests, a moment’s seconds, the tuning’s rows, a long level name); one too short for that has none, the gold in its corner; a boss’s bar and the label stay where they are with the map at the top, the banner clear of its column; on its own page and on a pad, at the top as ever',
    () => {
      const boss = 'Nyx-Hollow, the Lantern Eater';
      const LONG = 'XII · The Very Long Hollow of Lanterns';
      const strip = (seat: number): GuestStrip => ({ seat, color: 0x3f7fff, life: 0.6, skills: [1, 0.4, -1, 0], rise: seat === 3 ? 3.2 : null });
      const one = (z: readonly HudBox[], id: HudBox['id']) => z.find((b) => b.id === id);
      let checked = 0;
      // [CSS px wide, high, DPR, the gold: beside the corner map, or with none in its corner below the
      // band or at the top]. 915×356 is a Pixel held sideways under Chrome's toolbar (the interact
      // button is beside the map's top rows: the gold goes left of it, 16 of the map's rows a thumb
      // at its CSS scale); 844×346 an iPhone under a browser's bars, 882×344 a Galaxy Z Fold's cover
      // screen (441×172 art at DPR 3, 386×151 at its own 2.625) and 568×320 an iPhone SE (1st) have no
      // room for a map a thumb across between the band and the skills' arc (on 844×346 16 rows would
      // fit: 40 CSS px, under a thumb)
      const SCREENS = [
        [844, 390, 2, 'beside'],
        [844, 390, 3, 'beside'],
        [852, 393, 3, 'beside'],
        [915, 412, 2.625, 'beside'],
        [812, 375, 3, 'beside'],
        [800, 360, 3, 'beside'],
        [780, 360, 3, 'beside'],
        [740, 360, 2, 'beside'],
        [740, 360, 4, 'beside'],
        [640, 360, 3, 'beside'],
        [915, 356, 2.625, 'beside'],
        [844, 346, 2, 'below'],
        [882, 344, 3, 'below'],
        [882, 344, 2.625, 'top'],
        [568, 320, 2, 'below'],
      ] as const;
      for (const [vw, vh, dpr, spot] of SCREENS) {
        const cornerMap = spot === 'beside';
        const { W, H, boxes, wake, css } = controlsFor(vw, vh, dpr, 'fill', RIFTLIGHT_OPTIONS.touchDensity ?? 0, RIFTLIGHT_HUB_TOUCH_BUTTONS);
        expect(hudGeometry(W, H, boxes, wake).map.off, `${vw}×${vh}: ${cornerMap ? 'a' : 'no'} corner map`).toBe(!cornerMap);
        const full = W < 300 ? { w: 44, h: 34 } : { w: 84, h: 64 };
        for (const label of ['II · Gloom', LONG]) {
          for (const guests of [0, 1, 2, 3]) {
            for (const [big, tuned] of [[false, 0], [true, 0], [true, 4], [false, 4]] as const) {
              for (const card of [null, 'card', 'levelup', 'clear'] as const) {
                for (const moment of [false, true]) {
                  const where = `${vw}×${vh} at DPR ${dpr} (${W}×${H}, the band ${wake} rows), “${label}”, ${guests} guest(s)${big ? ', a boss' : ''}${tuned ? `, ${tuned} tuned` : ''}${card ? `, a ${card} banner` : ''}${moment ? ', a moment' : ''}`;
                  const m: HudModel = {
                    ...hudModel(boxes, { boss: big ? boss : null, label, difficulty: Array.from({ length: tuned }, (_, k) => `x${k + 2}`) }),
                    gold: 9_876_543,
                    goldShown: 9_876_543,
                    wake,
                    guests: Array.from({ length: guests }, (_, k) => strip(k + 2)),
                    card: card ? { title: 'The Gale Steps', subtitle: 'Depth 3', age: 1, kind: card } : null,
                    timeLeft: moment ? { text: t('round.moment_left', { count: 30 }), urgent: false } : null,
                  };
                  const z = hudBoxes(W, H, m);
                  const map = one(z, 'minimap');
                  const gold = one(z, 'gold')!;
                  if (cornerMap) {
                    expect(map, `${where}: a corner map`).toBeDefined();
                    expect(gold.y, `${where}: the gold ${JSON.stringify(gold)} below the band`).toBeGreaterThanOrEqual(wake);
                    expect(map!.y, `${where}: the map ${JSON.stringify(map)} below the band`).toBeGreaterThanOrEqual(wake);
                    expect(overlaps(map!, gold, 0), `${where}: the gold ${JSON.stringify(gold)} over the map ${JSON.stringify(map)}`).toBe(false);
                    expect(gold.x + gold.w <= map!.x && gold.y < map!.y + 10, `${where}: the gold ${JSON.stringify(gold)} beside the map ${JSON.stringify(map)}, on its left`).toBe(true);
                    // a tap target (`Riftlight.onMap`): a thumb across both ways
                    expect(Math.min(map!.w, map!.h) * css, `${where}: the corner map ${JSON.stringify(map)} a thumb across`).toBeGreaterThanOrEqual(44);
                  } else {
                    // none (the pause menu opens the level's map): the gold in its corner, below the band
                    // where the skills' arc leaves it room, else at the top as on a page without a corner
                    // map (882×344: the interact button is in its way)
                    expect(map, `${where}: no corner map`).toBeUndefined();
                    expect(gold.x + gold.w, `${where}: the gold ${JSON.stringify(gold)} in its corner`).toBe(W - 5);
                    if (spot === 'below') expect(gold.y, `${where}: the gold ${JSON.stringify(gold)} below the band`).toBeGreaterThanOrEqual(wake);
                    else expect(gold, `${where}: the gold in its corner at the top`).toEqual(one(hudBoxes(W, H, { ...m, minimap: null }), 'gold'));
                  }
                  // a known gap: at 640×360 with three guests' strips and a moment's seconds a big banner (the
                  // level card, LEVEL CLEAR) has no place clear of them and of the gold beside the map, and
                  // covers part of the gold for its four seconds (`bannerRect`'s last resort; on the game's
                  // own page it is in that place too)
                  const gap = vw === 640 && guests === 3 && moment && (card === 'card' || card === 'clear');
                  for (const own of [map, gold]) {
                    if (!own) continue;
                    expect(own.x >= 0 && own.x + own.w <= W && own.y + own.h <= H, `${where}: the ${own.id} ${JSON.stringify(own)} on screen`).toBe(true);
                    for (const o of z) if (o !== map && o !== gold && !(gap && own === gold && o.id === 'banner')) expect(overlaps(own, o, 0), `${where}: the ${own.id} ${JSON.stringify(own)} over the ${o.id} ${JSON.stringify(o)}`).toBe(false);
                  }
                  // a boss's bar at the top and the top-left block (above the gold's row: the tuning's rows
                  // reaching it keep clear of it) stay where they are with the corner map at the top, and the
                  // banner is no wider than the room between the map's full column and its mirror: they keep
                  // clear of that column as they do at the top, so they don't change as the map shrinks or goes
                  // (a bar with no room at the top goes under the map, wherever that is)
                  const atTop = hudBoxes(W, H, { ...m, wake: 0 });
                  const bar = one(atTop, 'boss');
                  if (bar && bar.y < wake) expect(one(z, 'boss'), `${where}: a boss's bar where it is with the map at the top`).toEqual(bar);
                  else if (bar) expect(one(z, 'boss')!.y, `${where}: a boss's bar under the map, as with the map at the top`).toBeGreaterThanOrEqual(wake);
                  const banner = one(z, 'banner');
                  if (banner) expect(banner.w, `${where}: the banner ${JSON.stringify(banner)} between the map's full column and its mirror`).toBeLessThanOrEqual(W - 2 * (full.w + 10));
                  const block = one(z, 'where')!;
                  if (block.y + block.h <= gold.y) expect(block, `${where}: the top-left block where it is with the map at the top`).toEqual(one(atTop, 'where'));
                  checked++;
                }
              }
            }
          }
        }
        // on its own page (≡ in the corner: no band), and on a pad there or in 52in1 (no controls): at the top, its full size, the gold under it
        const alone = controlsFor(vw, vh, dpr);
        for (const [controls, w] of [[alone.boxes, 0], [[], 0], [[], wake]] as const) {
          const z = hudBoxes(W, H, { ...hudModel([...controls]), wake: w });
          expect(one(z, 'minimap'), `${vw}×${vh}${controls.length ? '' : ', a pad'}${w ? ' in 52in1' : ''}: the corner map`).toEqual({ id: 'minimap', x: W - full.w - 6, y: 2, w: full.w + 4, h: full.h + 4 });
          expect(one(z, 'gold')!.y, `${vw}×${vh}${controls.length ? '' : ', a pad'}${w ? ' in 52in1' : ''}: the gold under it`).toBe(full.h + 9);
        }
      }
      expect(checked).toBe(SCREENS.length * 2 * 4 * 4 * 4 * 2);
    },
    60_000,
  );

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

describe('the skill bar names its buttons', () => {
  /** Attack, dodge and the four skills, a skill cooling down (its seconds over the slot's middle). */
  const SKILLS: SkillSlotView[] = (['attack', 'dodge', 0, 1, 2, 3] as const).map((slot, i) => ({ slot, id: `s${i}`, name: `Skill ${i}`, icon: ['xxxxxxx', 'x.....x', 'x.....x', 'x.....x', 'x.....x', 'x.....x', 'xxxxxxx'], colors: { x: 'white' }, cost: i, cooldown: 4, remaining: i === 3 ? 2.5 : 0, usable: true }));
  /** The glyphs `drawHud` draws (their art pixels: a sprite or cap from a row above its `y`, 8 tall) and the mini font's digits. */
  function drawn(W: number, H: number, m: HudModel): { glyphs: (Box & { action: string })[]; digits: Box[] } {
    const glyphs: (Box & { action: string })[] = [];
    const digits: Box[] = [];
    const hud = { width: W, height: H, rect() {}, sprite() {}, text() {}, measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }) };
    let inGlyph = false;
    class Recording extends UiCanvas {
      override glyph(x: number, y: number, action: Parameters<UiCanvas['glyph']>[2]): number {
        glyphs.push({ action, x, y: y - 1, w: this.glyphWidth(action), h: 8 });
        inGlyph = true;
        try {
          return super.glyph(x, y, action);
        } finally {
          inGlyph = false;
        }
      }
      override mini(x: number, y: number, s: string, color?: HudColor, align: Align = 'left', shadow?: HudColor | false): number {
        if (!inGlyph && /^[\d.]+$/.test(s)) digits.push({ x: Math.round(align === 'center' ? x - Math.floor(miniWidth(s) / 2) : align === 'right' ? x - miniWidth(s) : x), y, w: miniWidth(s), h: 5 });
        return super.mini(x, y, s, color, align, shadow);
      }
    }
    drawHud(new Recording(hud as never), m);
    return { glyphs, digits };
  }

  afterAll(() => void installLanguage(new Lang(riftlightLines())));

  it('on a pad, a phone held upright’s tight bar as well (PlayStation’s and Xbox’s): each slot’s button over its lower-left corner, on screen, clear of the next and of a cooldown’s seconds; a key’s where it fits', () => {
    const translations = riftlightTranslations();
    // English, and languages whose L1 (Russian's space bar) the mini font can't draw: the normal font's, wider
    for (const [code, [vw, vh, dpr]] of ['en', 'ja', 'ru'].flatMap((code) => ([[390, 844, 3], [360, 740, 2], [844, 390, 3], [1280, 720, 1]] as const).map((s) => [code, s] as const))) {
      installLanguage(new Lang(riftlightLines(), translations, { code }));
      const { W, H } = controlsFor(vw, vh, dpr);
      const g = hudGeometry(W, H, []);
      const slotX = (i: number) => g.bx + i * (g.slot + g.gap) + (i >= 2 ? g.split : 0);
      for (const [device, padStyle] of [['pad', 'playstation'], ['pad', 'xbox'], ['keyboard', 'playstation']] as const) {
        const where = `${code}, ${vw}×${vh} (${W}×${H}${g.compact ? ', compact' : ''}), ${device}${device === 'pad' ? `, ${padStyle}` : ''}`;
        const m: HudModel = { ...hudModel([]), device, padStyle, skills: SKILLS };
        const { glyphs, digits } = drawn(W, H, m);
        const bar = hudBoxes(W, H, m).find((b) => b.id === 'bar')!;
        if (device === 'pad' || !g.compact) expect(glyphs.map((x) => x.action), `${where}: every slot's button`).toEqual(['attack', 'dodge', 'skill1', 'skill2', 'skill3', 'skill4']);
        else expect(glyphs.length, `${where}: the keys that fit`).toBeGreaterThan(0);
        for (const x of glyphs) {
          const i = ['attack', 'dodge', 'skill1', 'skill2', 'skill3', 'skill4'].indexOf(x.action);
          // within its slot (a wide bar's long key names, Russian's space bar, may run past it: into its 3 px gap)
          if (g.compact || device === 'pad') expect(x.x >= slotX(i) && x.x + x.w <= slotX(i) + g.slot, `${where}: ${x.action} ${JSON.stringify(x)} over its slot (x ${slotX(i)}, ${g.slot} wide)`).toBe(true);
          expect(x.y >= g.by && x.y + x.h <= H, `${where}: ${x.action} ${JSON.stringify(x)} on screen, over the slot's lower half`).toBe(true);
          expect(x.x >= bar.x && x.x + x.w <= bar.x + bar.w && x.y >= bar.y, `${where}: ${x.action} in the bar's zone ${JSON.stringify(bar)}`).toBe(true);
          for (const d of digits) expect(overlaps(x, d, 0), `${where}: ${x.action} ${JSON.stringify(x)} over the digits ${JSON.stringify(d)}`).toBe(false);
        }
        for (const [a, b] of glyphs.flatMap((a, i) => glyphs.slice(i + 1).map((b) => [a, b] as const))) expect(overlaps(a, b, 0), `${where}: ${a.action} over ${b.action}`).toBe(false);
        expect(digits.length, `${where}: the cooldown's seconds and the costs drawn`).toBeGreaterThan(1);
      }
    }
  });
});

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
    // the short landscape phones: 195 rows and fewer at Riftlight's touch density
    ['915×412 phone', 915, 412, 2.625],
    ['812×375 phone', 812, 375, 3],
    ['740×360 phone', 740, 360, 2],
    ['740×360 phone dpr 4', 740, 360, 4],
    ['780×360 phone', 780, 360, 3],
    ['800×360 phone', 800, 360, 3],
    ['640×360 phone', 640, 360, 3],
    ['568×320 phone', 568, 320, 2],
    ['1280×720', 1280, 720, 1],
    ['the hub’s frame, 1000×850', 1000, 850, 1],
  ] as const;
  /** The HUD around the guests' strips: a boss and its bar, and the tuning's rows (sliders off 1.0) in the top-left block. */
  const CASES = [[false, 0, true], [true, 2, true], [true, 4, true], [false, 4, true], [false, 0, false]] as const;
  const minimap: HudModel['minimap'] = { width: 8, height: 8, cell: () => 1, explored: new Uint8Array(64), hero: { x: 4, z: 4 }, exit: null, boss: null, origin: { x: 0, z: 0 } };
  /**
   * A page with touch controls (and Riftlight's touch density), the same page on a pad (the controls
   * stepped aside), a page without touch controls (no touch density), and a page with touch controls
   * in 52in1 (≡ and the corner map below the hub's wake band).
   */
  const PAGES = [
    [true, RIFTLIGHT_OPTIONS.touchDensity ?? 0, false],
    [false, RIFTLIGHT_OPTIONS.touchDensity ?? 0, false],
    [false, 0, false],
    [true, RIFTLIGHT_OPTIONS.touchDensity ?? 0, true],
  ] as const;
  const strip = (seat: number): GuestStrip => ({ seat, color: 0x3f7fff, life: 0.6, skills: [1, 0.4, -1, 0], rise: seat === 3 ? 3.2 : null });
  function model(controls: Box[], o: { guests: number; boss: boolean; tuned: number; map: boolean; wake?: number }): HudModel {
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
      wake: o.wake ?? 0,
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

  /**
   * The heroes on screen as the camera keeps a group (`Banner.heroes`, `HudModel.heroes`, from
   * `worldBox`, as a level opens; measured in the game): player 1 in the middle, its feet half a
   * hero under the screen's middle, seat 2 a hero's height to its right, 3 to its left, 4 below
   * (`besideSpot`), each about a ninth of the screen tall (a tenth on a phone held upright, which
   * shows more).
   */
  const heroesOn = (W: number, H: number, guests: number): Box[] => {
    const h = Math.round(H * (H > W ? 0.092 : 0.112));
    const w = Math.round(h * 0.47);
    const feet = Math.round(H / 2 + 0.5 * h);
    const at = [[0, 0], [1, 0], [-1, 0], [0, 1.5]].slice(0, 1 + guests);
    return at.map(([dx, dy]) => ({ x: Math.round(W / 2 + dx! * h - w / 2), y: Math.round(feet + dy! * h) - h, w, h }));
  };
  /** The rows the heroes stand in, across the screen. */
  const rowsOf = (W: number, heroes: readonly Box[]): Box => ({ x: 0, y: Math.min(...heroes.map((b) => b.y)), w: W, h: Math.max(...heroes.map((b) => b.y + b.h)) - Math.min(...heroes.map((b) => b.y)) });

  it('are on screen, clear of the minimap and gold, the top-left block, a boss’s bar, the orbs, the bars, every text and every touch control; and off the heroes, out of their rows where the HUD leaves room', () => {
    let checked = 0;
    const overHero: string[] = [];
    const inRows: string[] = [];
    for (const [name, vw, vh, dpr] of SCREENS) {
      // a page with touch controls draws at Riftlight's touch density (a pad picked up there too); a page without at the art size the viewport gives
      for (const [touch, density, hub] of PAGES) {
        const f = controlsFor(vw, vh, dpr, 'fill', density, hub ? RIFTLIGHT_HUB_TOUCH_BUTTONS : RIFTLIGHT_TOUCH_BUTTONS);
        const controls = touch ? f.boxes : [];
        const { W, H } = f;
        for (const guests of [1, 2, 3]) {
          // the heroes as the strips were placed (`HudModel.heroes`), and not known yet (the frame a stage opens)
          for (const heroes of [null, heroesOn(W, H, guests)]) {
            for (const [boss, tuned, map] of CASES) {
              const where = `${name} (${W}×${H}), ${touch ? 'touch' : 'pad'}${hub ? ' in 52in1' : ''}${density ? '' : ', no touch density'}, ${guests} guest(s)${boss ? ', a boss' : ''}${tuned ? `, ${tuned} tuned` : ''}${map ? '' : ', no minimap'}${heroes ? ', the heroes known' : ''}`;
              const m: HudModel = { ...model(controls, { guests, boss, tuned, map, wake: hub ? f.wake : 0 }), ...(heroes ? { heroes } : {}) };
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
              // a known gap, kept out of the two lists: a phone held upright in 52in1 (its corner map
              // below the hub's wake band, a boss's bar under it) has no room above the heroes for
              // three guests' strips under the tuning's rows
              const gap = hub && H > W && guests === 3 && boss && tuned > 0;
              if (heroes && !gap) {
                const hero = heroes.find((b) => overlaps(box, b, 0));
                if (hero) overHero.push(`${where}: the strips ${JSON.stringify(box)} over a hero ${JSON.stringify(hero)}`);
                if (overlaps(box, rowsOf(W, heroes), 0)) inRows.push(`${where}: the strips ${JSON.stringify(box)} in the heroes’ rows`);
              }
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(SCREENS.length * PAGES.length * 3 * 2 * CASES.length);
    // they stay all level: over no hero and out of the heroes' rows on every screen here
    expect(overHero).toEqual([]);
    expect(inRows).toEqual([]);
    // the short landscape phones they lay over the heroes on all level, two side by side under the
    // tuning's rows across the middle (x 32-166, y 85-98 of 180 at 640×360; x 31-165, y 63-76 of 160 at 568×320)
    for (const [vw, vh, dpr] of [[640, 360, 3], [568, 320, 2]] as const) {
      for (const [touch, density, hub] of PAGES) {
        const f = controlsFor(vw, vh, dpr, 'fill', density, hub ? RIFTLIGHT_HUB_TOUCH_BUTTONS : RIFTLIGHT_TOUCH_BUTTONS);
        const { W, H } = f;
        for (const guests of [1, 2, 3]) {
          for (const boss of [false, true]) {
            const heroes = heroesOn(W, H, guests);
            const m: HudModel = { ...model(touch ? f.boxes : [], { guests, boss, tuned: 4, map: true, wake: hub ? f.wake : 0 }), heroes };
            const box = hudBoxes(W, H, m).find((b) => b.id === 'guests')!;
            const where = `${vw}×${vh} at DPR ${dpr}${touch ? ', touch' : ''}${density ? '' : ', no touch density'}, ${guests} guest(s)${boss ? ', a boss' : ''}, 4 tuned`;
            for (const hero of heroes) expect(overlaps(box, hero, 0), `${where}: the strips ${JSON.stringify(box)} over a hero ${JSON.stringify(hero)}`).toBe(false);
            expect(overlaps(box, rowsOf(W, heroes), 0), `${where}: the strips ${JSON.stringify(box)} in the heroes' rows ${JSON.stringify(rowsOf(W, heroes))}`).toBe(false);
          }
        }
      }
    }
  }, 30_000);

  it('with no place clear of the heroes’ rows: over none of them, and beside the top-left block rather than side by side across the middle of the screen', () => {
    // a hero the height of the screen at its right edge: its rows are every row, and it is under none of the places on the left
    for (const [vw, vh, dpr] of [[640, 360, 3], [568, 320, 2]] as const) {
      const { W, H, boxes } = controlsFor(vw, vh, dpr);
      const heroes = [{ x: W - 3, y: 0, w: 2, h: H }];
      const m: HudModel = { ...model(boxes, { guests: 2, boss: false, tuned: 4, map: true }), heroes };
      const z = hudBoxes(W, H, m);
      const box = z.find((b) => b.id === 'guests')!;
      const where = z.find((b) => b.id === 'where')!;
      const at = `${vw}×${vh} at DPR ${dpr}: the strips ${JSON.stringify(box)}`;
      for (const hero of heroes) expect(overlaps(box, hero, 0), `${at} over a hero ${JSON.stringify(hero)}`).toBe(false);
      expect(box.x, `${at} beside the top-left block ${JSON.stringify(where)}`).toBeGreaterThan(where.x + where.w);
      expect(box.y, `${at} beside the top-left block ${JSON.stringify(where)}`).toBeLessThan(where.y + where.h);
    }
  });

  it('a banner (the level card, a level-up, LEVEL CLEAR) is on screen and never over the strips, a touch control, an orb or the XP bar (aside in its row, else under them); a boss’s bar stays put as guests come and go', () => {
    let checked = 0;
    for (const [name, vw, vh, dpr] of SCREENS) {
      for (const [touch, density, hub] of PAGES) {
        const f = controlsFor(vw, vh, dpr, 'fill', density, hub ? RIFTLIGHT_HUB_TOUCH_BUTTONS : RIFTLIGHT_TOUCH_BUTTONS);
        const controls = touch ? f.boxes : [];
        const { W, H } = f;
        for (const guests of [0, 1, 2, 3]) {
          for (const boss of [false, true]) {
            for (const kind of ['card', 'levelup', 'clear'] as const) {
              const where = `${name} (${W}×${H}), ${touch ? 'touch' : 'pad'}${hub ? ' in 52in1' : ''}${density ? '' : ', no touch density'}, ${guests} guest(s)${boss ? ', a boss' : ''}, a ${kind} banner`;
              // the shell sets the heroes as the strips were placed (`HudModel.heroes`) whenever guests play
              const m: HudModel = { ...model(controls, { guests, boss, tuned: 0, map: true, wake: hub ? f.wake : 0 }), card: { title: 'The Gale Steps', subtitle: 'Depth 3', age: 1, kind }, ...(guests ? { heroes: heroesOn(W, H, guests) } : {}) };
              const z = hudBoxes(W, H, m);
              const banner = z.find((b) => b.id === 'banner')!;
              expect(banner, where).toBeDefined();
              expect(banner.x >= 0 && banner.y >= 0 && banner.x + banner.w <= W && banner.y + banner.h <= H, `${where}: the banner on screen ${JSON.stringify(banner)}`).toBe(true);
              // a phone held sideways (568×320's compact HUD too) keeps it off the gold under the minimap as well
              const never = ['guests', 'control', 'bar', 'life', 'mana', 'xp', 'minimap', 'boss', ...(W > H ? ['gold'] : [])];
              for (const b of z.filter((b) => never.includes(b.id))) expect(overlaps(banner, b, 0), `${where}: the banner ${JSON.stringify(banner)} over the ${b.id} ${JSON.stringify(b)}`).toBe(false);
              expect(banner.w, `${where}: the plate holds its title`).toBeGreaterThanOrEqual(textWidthPx('The Gale Steps'));
              const alone = hudBoxes(W, H, { ...m, guests: [] });
              expect(z.find((b) => b.id === 'boss'), `${where}: the boss's bar where it was without guests`).toEqual(alone.find((b) => b.id === 'boss'));
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(SCREENS.length * PAGES.length * 4 * 2 * 3);
  }, 30_000);

  /** Somewhere a `w` × `h` plate covers none of `avoid`, 2 px clear of each side by side and 4 px in from the screen's sides (as the banner keeps), or null. */
  const room = (W: number, H: number, w: number, h: number, avoid: readonly Box[]): Box | null => {
    for (let y = 0; y + h <= H; y++) {
      for (let x = 4; x + w <= W - 4; x++) if (!avoid.some((z) => overlaps({ x: x - 2, y, w: w + 4, h }, z, 0))) return { x, y, w, h };
    }
    return null;
  };

  it('a banner keeps off the heroes as they stood when it opened: never over one, out of their rows where the HUD leaves room (on a short landscape phone with three guests and the tuning’s rows, high up over the top-left block rather than over the heroes)', () => {
    let checked = 0;
    let heroFree = 0;
    for (const [name, vw, vh, dpr] of SCREENS) {
      for (const [touch, density, hub] of PAGES) {
        const f = controlsFor(vw, vh, dpr, 'fill', density, hub ? RIFTLIGHT_HUB_TOUCH_BUTTONS : RIFTLIGHT_TOUCH_BUTTONS);
        const controls = touch ? f.boxes : [];
        const { W, H } = f;
        for (const guests of [0, 1, 2, 3]) {
          for (const [boss, tuned, map] of CASES) {
            for (const kind of ['card', 'levelup', 'clear'] as const) {
              const where = `${name} (${W}×${H}), ${touch ? 'touch' : 'pad'}${hub ? ' in 52in1' : ''}${density ? '' : ', no touch density'}, ${guests} guest(s)${boss ? ', a boss' : ''}${tuned ? `, ${tuned} tuned` : ''}${map ? '' : ', no minimap'}, a ${kind} banner`;
              const heroes = heroesOn(W, H, guests);
              const m: HudModel = { ...model(controls, { guests, boss, tuned, map, wake: hub ? f.wake : 0 }), card: { title: 'I · Embers', subtitle: 'Depth 1', age: 1, kind, heroes }, ...(guests ? { heroes } : {}) };
              const z = hudBoxes(W, H, m);
              const banner = z.find((b) => b.id === 'banner')!;
              expect(banner.x >= 0 && banner.y >= 0 && banner.x + banner.w <= W && banner.y + banner.h <= H, `${where}: the banner on screen ${JSON.stringify(banner)}`).toBe(true);
              const never = ['guests', 'control', 'bar', 'life', 'mana', 'xp', 'minimap', 'boss'];
              for (const b of z.filter((b) => never.includes(b.id))) expect(overlaps(banner, b, 0), `${where}: the banner ${JSON.stringify(banner)} over the ${b.id} ${JSON.stringify(b)}`).toBe(false);
              // over a hero only where no plate holding its title fits clear of them and of what it never covers
              const least = textWidthPx('I · Embers') + 4;
              const over = heroes.find((hero) => overlaps(banner, hero, 0));
              if (over) expect(room(W, H, least, banner.h, [...z.filter((b) => never.includes(b.id)), ...heroes]), `${where}: the banner ${JSON.stringify(banner)} over a hero ${JSON.stringify(over)}, with room elsewhere`).toBeNull();
              // a phone held sideways keeps it off the gold as well, but where only a place over the gold
              // is off the heroes (a hero weighs more: in 52in1 a phone too short for a corner map has that
              // place in its corner, the gold under it)
              const gold = z.find((b) => b.id === 'gold')!;
              if (W > H && overlaps(banner, gold, 0)) expect(room(W, H, least, banner.h, [...z.filter((b) => never.includes(b.id) || b.id === 'gold'), ...heroes]), `${where}: the banner ${JSON.stringify(banner)} over the gold ${JSON.stringify(gold)}, with room off it and off the heroes`).toBeNull();
              else heroFree++;
              // where it went without heroes to keep off was clear of their rows: it goes there still
              const before = hudBoxes(W, H, { ...m, card: { ...m.card!, heroes: undefined } }).find((b) => b.id === 'banner')!;
              const rows = rowsOf(W, heroes);
              if (!overlaps(before, rows, 0)) expect(banner, `${where}: clear of the heroes' rows already`).toEqual(before);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(SCREENS.length * PAGES.length * 4 * CASES.length * 3);
    expect(heroFree / checked, 'off the heroes nearly everywhere').toBeGreaterThan(0.98);
    // the short landscape phones the verifier saw it over the heroes on (y 84-118 of 180 at 640×360): above them now
    for (const [vw, vh, dpr, tuned] of [[640, 360, 3, 4], [568, 320, 2, 4], [568, 320, 2, 0]] as const) {
      const { W, H, boxes } = controlsFor(vw, vh, dpr);
      const heroes = heroesOn(W, H, 3);
      const m: HudModel = { ...model(boxes, { guests: 3, boss: false, tuned, map: true }), card: { title: 'I · Embers', subtitle: 'Depth 1', age: 1, kind: 'card', heroes } };
      const banner = hudBoxes(W, H, m).find((b) => b.id === 'banner')!;
      expect(banner.y + banner.h, `${vw}×${vh} at DPR ${dpr}, three guests, ${tuned} tuned: the banner ${JSON.stringify(banner)} above the heroes ${JSON.stringify(heroes)}`).toBeLessThanOrEqual(Math.min(...heroes.map((b) => b.y)));
    }
  }, 30_000);

  it('a kill streak goes right of the strips where it would run into them, never over them', () => {
    let checked = 0;
    for (const [name, vw, vh, dpr] of SCREENS) {
      for (const [touch, density, hub] of PAGES) {
        const f = controlsFor(vw, vh, dpr, 'fill', density, hub ? RIFTLIGHT_HUB_TOUCH_BUTTONS : RIFTLIGHT_TOUCH_BUTTONS);
        const controls = touch ? f.boxes : [];
        const { W, H } = f;
        for (const guests of [1, 2, 3]) {
          for (const [boss, tuned] of [[false, 0], [true, 2]] as const) {
            for (const streak of [{ count: 7, age: 1 }, { count: 12, age: 0.05 }]) {
              const where = `${name} (${W}×${H}), ${touch ? 'touch' : 'pad'}${hub ? ' in 52in1' : ''}${density ? '' : ', no touch density'}, ${guests} guest(s)${boss ? ', a boss' : ''}${tuned ? ', tuned' : ''}, a streak of ${streak.count}`;
              const m: HudModel = { ...model(controls, { guests, boss, tuned, map: true, wake: hub ? f.wake : 0 }), streak };
              const strips = hudBoxes(W, H, m).find((b) => b.id === 'guests')!;
              const inStrips = (x: Box) => x.x >= strips.x && x.y >= strips.y && x.x + x.w <= strips.x + strips.w + 1 && x.y + x.h <= strips.y + strips.h + 1;
              for (const x of drawn(W, H, m).filter((x) => !inStrips(x))) expect(overlaps(strips, x, 0), `${where}: ${JSON.stringify(x)} over the strips ${JSON.stringify(strips)}`).toBe(false);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(SCREENS.length * PAGES.length * 3 * 2 * 2);
  }, 30_000);
});
