/**
 * Riftlight on a phone: the engine's touch controls laid out as an ARPG action cluster
 * (Diablo Immortal style), driven every frame from the hero's skill bar.
 *
 *   bottom-left   the engine's joystick (move)
 *   bottom-right  a big attack button in the corner, the four skills on an arc around it,
 *                 the dodge outside the arc and a contextual interact button next to it
 *                 (TALK, OPEN, TAKE, GO) that shows only when there is something to use
 *   top-left      ≡ (the pause menu: inventory, skills, tree, settings...); in 52in1 lower, out of
 *                 the hub's wake band (`HUB_WAKE`), and hidden in a 52in1 round (the hub's bar is
 *                 the menu there)
 *
 * The buttons ARE the skill bar on a touch screen: each one shows its gem's icon
 * (`skills/icons.ts`, the same pixels as the HUD's bar), its cooldown shutter and seconds, its
 * mana cost, and dims when it can't be paid. The HUD drops its own bar and lays the orbs and
 * the XP bar out around the controls (`TouchPad.zones` → `hudGeometry`). Positions are CSS
 * pixels from the screen corner (`TouchButton.at`), so tap targets keep their size whatever
 * the art scale is.
 */
import { clusters, type Engine, type TouchButton, type TouchButtonState } from '../../engine';
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { t } from '../lang';
import type { Box } from '../ui/layout';
import type { SkillSlotView } from './ports';

/** The cluster's geometry (CSS pixels from the bottom-right corner, button centres). */
export const TOUCH_LAYOUT = {
  attack: { x: 64, y: 66, size: 84 },
  /** Skill ring radius around the attack button, and the skills' diameter. */
  ring: 108,
  skill: 54,
  /** Skills 1..4 go from the left of the attack button (0°) up to above it (90°). */
  angles: [0, 30, 60, 90],
  /**
   * Outer ring: the dodge and the contextual interact button, both left of the column above
   * the skills (that column is where the mana orb goes on a phone in portrait).
   */
  dodge: { angle: 38, r: 172, size: 52 },
  interact: { angle: 56, r: 182, size: 50 },
  menu: { x: 26, y: 26, size: 44 },
  /** ≡ in 52in1 (`RIFTLIGHT_HUB_TOUCH_BUTTONS`): its top edge on the hub's wake band (`HUB_WAKE`), its centre 112 CSS px down. */
  menuHub: { x: 26, y: 104, size: 44 },
} as const;

/**
 * 52in1's wake band: a touch (or the mouse) less than this many CSS px from the top of the game's
 * frame brings the hub's bar back over the game (its companion script posts 'wake'), so no touch
 * control of the game sits in it there.
 */
export const HUB_WAKE = 90;

const L = TOUCH_LAYOUT;
const polar = (angle: number, r: number, size: number) => {
  const a = (angle * Math.PI) / 180;
  return { x: Math.round(L.attack.x + Math.cos(a) * r), y: Math.round(L.attack.y + Math.sin(a) * r), size };
};

/** Key codes the buttons press (the shell's `KEYS`: J attack, Space dodge, 1-4 skills, F interact, Esc pause). */
export const TOUCH_CODES = { attack: 'KeyJ', dodge: 'Space', skills: ['Digit1', 'Digit2', 'Digit3', 'Digit4'], interact: 'KeyF', menu: 'Escape' } as const;

/**
 * Riftlight's on-screen buttons for phones (`EngineOptions.touchButtons`), with ≡ in the top-left
 * corner, or (`hub`: in 52in1) below the hub's wake band. The attack comes first (the engine colours
 * the first button). The page is made before the game's language is chosen: `TouchPad.sync` puts
 * the hints in it (lines `touch.hint.*`) once the game runs.
 */
export function riftlightTouchButtons(hub: boolean): readonly TouchButton[] {
  return [
    { label: 'A', code: TOUCH_CODES.attack, hint: 'attack', at: { ...L.attack } },
    ...TOUCH_CODES.skills.map((code, i) => ({ label: String(i + 1), code, hint: 'skill', at: polar(L.angles[i]!, L.ring, L.skill) })),
    { label: 'B', code: TOUCH_CODES.dodge, hint: 'dodge', at: polar(L.dodge.angle, L.dodge.r, L.dodge.size) },
    { label: 'F', code: TOUCH_CODES.interact, hint: 'talk', at: polar(L.interact.angle, L.interact.r, L.interact.size) },
    { label: '≡', code: TOUCH_CODES.menu, at: { ...(hub ? L.menuHub : L.menu), corner: 'top-left' } },
  ];
}

/** Riftlight's on-screen buttons on its own page (`riftlightTouchButtons`): ≡ in the top-left corner. */
export const RIFTLIGHT_TOUCH_BUTTONS = riftlightTouchButtons(false);
/** Riftlight's on-screen buttons in 52in1 (`riftlightTouchButtons`): ≡ below the hub's wake band (`HUB_WAKE`). */
export const RIFTLIGHT_HUB_TOUCH_BUTTONS = riftlightTouchButtons(true);

/** The engine's joystick at rest (style.css `.touch-ui .stick`): 16 CSS px from the bottom-left corner, 128 px and a 2 px border. */
const STICK = { margin: 16, size: 132 } as const;

/** The floating joystick's zone (style.css `.stick-zone`): the left 45% of the screen, its lower 75% in landscape and 60% in portrait. */
export const STICK_ZONE = { width: 0.45, landscape: 0.75, portrait: 0.6 } as const;

/**
 * Where the touch controls sit on a `width` × `height` CSS px screen (the page's viewport), from
 * their data (the buttons' `at`, from an 8 px margin, and the joystick at rest), as CSS rects: what
 * the page lays out, for where there is no page (headless, a replay of a phone's recording) and for
 * the checks. The page keeps its controls inside a notched phone's safe area (`env(safe-area-inset-*)`
 * past the margins), which a recording does not keep: on such a phone a replay without the page
 * lays the HUD out around controls a few pixels off where the player saw them (the phone e2e checks
 * the two agree where there is no notch).
 */
export function touchLayout(width: number, height: number, buttons: readonly TouchButton[] = RIFTLIGHT_TOUCH_BUTTONS): Box[] {
  const out: Box[] = [{ x: STICK.margin, y: height - STICK.margin - STICK.size, w: STICK.size, h: STICK.size }];
  for (const b of buttons) {
    if (!b.at) continue;
    const size = b.at.size ?? 58;
    const corner = b.at.corner ?? 'bottom-right';
    const x = corner.endsWith('left') ? 8 + b.at.x - size / 2 : width - 8 - b.at.x - size / 2;
    const y = corner.startsWith('top') ? 8 + b.at.y - size / 2 : height - 8 - b.at.y - size / 2;
    out.push({ x, y, w: size, h: size });
  }
  return out;
}

/** The floating joystick's zone on a `width` × `height` CSS px screen (`STICK_ZONE`): a touch there moves the stick, never the game's HUD. */
export function stickZone(width: number, height: number): Box {
  const h = height * (height >= width ? STICK_ZONE.portrait : STICK_ZONE.landscape);
  return { x: 0, y: height - h, w: width * STICK_ZONE.width, h };
}

/** What the shell tells the pad each frame. */
export interface TouchFrame {
  /** The world is playable (town or level, alive, no panel on top). */
  playing: boolean;
  /** A 52in1 round: no ≡ (a round has no pause menu; the hub's bar is the menu there). */
  round?: boolean;
  /**
   * A showcase mode (arcade, hall, photo) owns the game: stick, attack, jump, ≡ and its own interact
   * (`Showcase.touch`: the Hall's exhibit near, none in the arcade), no skills and no skill icons;
   * none of them while `controls` is false (the Hall's card takes the screen).
   */
  showcase?: boolean | { readonly interact: { verb: string; name: string } | null; readonly controls?: boolean };
  skills: readonly SkillSlotView[];
  /** The interaction on offer (`Riftlight.interactOffer`: a short verb, Talk, Open, Take, Go, and its target, in the player's language), or null. */
  interact: { verb: string; name: string } | null;
}

/**
 * Keeps the engine's touch buttons in step with the game: visibility, icons, cooldowns,
 * costs and the contextual interact button. Does nothing without touch controls.
 */
export class TouchPad {
  private readonly icons = new Map<string, HTMLCanvasElement>();
  private readonly state: TouchButtonState = {};

  /**
   * The page runs in 52in1 (the hub's settings on it: `engine.hubSettings.present`, as the page's
   * options read `window.AIHubSettings`), so its ≡ is below the hub's wake band (`buttons`). The
   * HUD lays out around it and a tap lands on that HUD, so a recording keeps it (`Riftlight`'s
   * setup sends `{ rl: 'touch', hub }`): a replay with no hub behind it lays the controls out as
   * the recorded page had them.
   */
  hub: boolean;

  constructor(private readonly engine: Engine) {
    this.hub = engine.hubSettings.present;
  }

  get active(): boolean {
    return !!this.engine.touch;
  }

  /** The buttons the page has (`RIFTLIGHT_OPTIONS.touchButtons`): in 52in1 (`hub`) ≡ is below the hub's wake band. */
  get buttons(): readonly TouchButton[] {
    return this.hub ? RIFTLIGHT_HUB_TOUCH_BUTTONS : RIFTLIGHT_TOUCH_BUTTONS;
  }

  /**
   * The controls on screen, in art pixels (`toArt` maps client → art), for the HUD layout.
   * While they are hidden (a panel is open) the last rects stand in, so the HUD under a menu
   * keeps its touch layout instead of jumping back to the desktop bar.
   */
  zones(toArt: (x: number, y: number) => { x: number; y: number }): Box[] {
    const touch = this.engine.touch;
    if (!touch) return this.fromData();
    if (touch.deviceHidden) return []; // a pad or the keyboard in use: their layout, with its skill bar
    if (!touch.visible) return this.last;
    const r = touch.rects();
    const out: Box[] = [];
    const add = (c: DOMRect) => {
      if (c.width <= 0 || c.height <= 0) return;
      const a = toArt(c.left, c.top);
      const b = toArt(c.right, c.bottom);
      out.push({ x: a.x, y: a.y, w: b.x - a.x + 1, h: b.y - a.y + 1 });
    };
    if (r.stick) add(r.stick);
    for (const b of r.buttons) add(b.rect);
    this.last = out;
    return out;
  }

  private last: Box[] = [];

  /** The rects that stood in while the controls were hidden, as a snapshot kept them (`Riftlight.restoreNow`). */
  restoreLast(boxes: readonly Box[]): void {
    this.last = boxes.map((b) => ({ ...b }));
  }

  /**
   * Without a page (headless, a replay of a phone's recording): where the page's controls would
   * be on a page with touch controls (`touchDensity` set, recorded) while a finger is the device in
   * use (recorded), from their data (`dataLayout`); none otherwise. So the HUD a replay draws, and
   * what a tap on it hits, is the phone's (but for a notch's safe area: `touchLayout`).
   */
  private fromData(): Box[] {
    const e = this.engine;
    if (!(e.renderer.touchDensity > 0) || e.input.device !== 'touch') return [];
    return this.dataLayout();
  }

  /**
   * The controls laid out from their data in the recorded viewport, in art pixels: the joystick at
   * rest and every placed button, a hidden one too (it keeps its place on the page: the HUD
   * doesn't jump when the interact button comes and goes). The phone e2e holds it to the page's.
   */
  dataLayout(): Box[] {
    const { width, height } = this.engine.renderer.viewport;
    return touchLayout(width, height, this.buttons).map((c) => this.toArt(c));
  }

  /**
   * A CSS px rect of the page (its viewport) as art pixels, by the view's framing: the arithmetic
   * of `Pointer.toArt` on the canvas's client rect (its offset and size: a fill canvas can reach
   * past the viewport's edges), so the page's rects and the data's land on the same art pixels.
   */
  private toArt(c: Box): Box {
    const f = this.engine.renderer.framing;
    const ax = (x: number) => Math.floor(((x - f.offsetX) / f.cssWidth) * f.artWidth);
    const ay = (y: number) => Math.floor(((y - f.offsetY) / f.cssHeight) * f.artHeight);
    const x = ax(c.x);
    const y = ay(c.y);
    return { x, y, w: ax(c.x + c.w) - x + 1, h: ay(c.y + c.h) - y + 1 };
  }

  /**
   * The floating joystick's zone in art pixels while the controls show for a finger (on a page
   * with touch controls: `touchDensity` set, recorded; a finger the device in use, recorded), or
   * null: the game keeps what a finger taps out of it (a touch there moves the stick). From the
   * data (`stickZone`), so a replay agrees.
   */
  stickZone(): Box | null {
    const e = this.engine;
    if (!(e.renderer.touchDensity > 0) || e.input.device !== 'touch') return null;
    const { width, height } = e.renderer.viewport;
    return this.toArt(stickZone(width, height));
  }

  sync(f: TouchFrame): void {
    const touch = this.engine.touch;
    if (!touch) return;
    touch.show(f.showcase ? f.showcase === true || f.showcase.controls !== false : f.playing); // none over the Hall's card
    if (!touch.visible) return;
    // in the showcase the buttons are the stage's (B jumps), not the skill bar's
    const find = (slot: SkillSlotView['slot']) => (f.showcase ? undefined : f.skills.find((s) => s.slot === slot));
    this.slot(TOUCH_CODES.attack, find('attack'), 'A', t('touch.hint.attack'));
    this.slot(TOUCH_CODES.dodge, find('dodge'), 'B', t(f.showcase ? 'touch.hint.jump' : 'touch.hint.dodge'));
    TOUCH_CODES.skills.forEach((code, i) => {
      if (f.showcase) touch.set(code, { hidden: true });
      else this.slot(code, find(i), String(i + 1), t('touch.hint.skill'));
    });
    const it = f.showcase ? (typeof f.showcase === 'object' ? f.showcase.interact : null) : f.interact;
    // the hint under the verb is the target's name, cut to the button (whole letters)
    touch.set(TOUCH_CODES.interact, it ? { hidden: false, label: it.verb, hint: clusters(it.name).slice(0, 9).join('') } : { hidden: true });
    // a 52in1 round has no pause menu: ≡ would do nothing (the hub's bar is the menu there)
    touch.set(TOUCH_CODES.menu, { hidden: !!f.round });
  }

  /** One skill button from its bar slot: icon, shutter, seconds, cost, dimmed when unaffordable. */
  private slot(code: string, s: SkillSlotView | undefined, label: string, hint: string): void {
    const st = this.state;
    st.hidden = false;
    st.label = label;
    st.hint = hint;
    st.icon = s?.id && s.icon && s.colors ? this.icon(code, s.id, s.icon, s.colors) : null;
    const cooling = !!s && s.remaining > 0 && s.cooldown > 0;
    st.cooldown = cooling ? Math.min(1, s.remaining / s.cooldown) : 0;
    st.timer = cooling ? (s.remaining >= 1 ? String(Math.ceil(s.remaining)) : s.remaining.toFixed(1).slice(1)) : '';
    st.badge = s && s.cost > 0 ? String(s.cost) : '';
    st.disabled = !s?.id || !s.usable;
    this.engine.touch!.set(code, st);
  }

  /** A gem icon as a tiny canvas (one pixel per icon pixel; CSS scales it, pixelated), one per button. */
  private icon(code: string, id: string, rows: readonly string[], colors: Readonly<Record<string, PaletteColor>>): HTMLCanvasElement {
    const key = `${code}:${id}:${rows.join('')}`;
    let c = this.icons.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const w = Math.max(...rows.map((r) => r.length));
    // a one-pixel ink outline keeps the icon readable over any background
    c.width = w + 2;
    c.height = rows.length + 2;
    const g = c.getContext('2d');
    if (g) {
      const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
      const at = (x: number, y: number) => rows[y]?.[x] ?? '.';
      for (let y = -1; y <= rows.length; y++)
        for (let x = -1; x <= w; x++) {
          const ch = at(x, y);
          if (ch !== '.' && colors[ch]) {
            g.fillStyle = hex(PALETTE[colors[ch]]);
            g.fillRect(x + 1, y + 1, 1, 1);
          } else if ([at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== '.' && colors[n])) {
            g.fillStyle = hex(PALETTE.ink);
            g.fillRect(x + 1, y + 1, 1, 1);
          }
        }
    }
    this.icons.set(key, c);
    return c;
  }
}
