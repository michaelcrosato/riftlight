/**
 * Riftlight on a phone: the engine's touch controls laid out as an ARPG action cluster
 * (Diablo Immortal style), driven every frame from the hero's skill bar.
 *
 *   bottom-left   the engine's joystick (move)
 *   bottom-right  a big attack button in the corner, the four skills on an arc around it,
 *                 the dodge outside the arc and a contextual interact button next to it
 *                 (TALK, OPEN, TAKE, GO) that shows only when there is something to use
 *   top-left      ≡ (the pause menu: inventory, skills, tree, settings...)
 *
 * The buttons ARE the skill bar on a touch screen: each one shows its gem's icon
 * (`skills/icons.ts`, the same pixels as the HUD's bar), its cooldown shutter and seconds, its
 * mana cost, and dims when it can't be paid. The HUD drops its own bar and lays the orbs and
 * the XP bar out around the controls (`TouchPad.zones` → `hudGeometry`). Positions are CSS
 * pixels from the screen corner (`TouchButton.at`), so tap targets keep their size whatever
 * the art scale is.
 */
import type { Engine, TouchButton, TouchButtonState } from '../../engine';
import { PALETTE, type PaletteColor } from '../../engine/palette';
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
} as const;

const L = TOUCH_LAYOUT;
const polar = (angle: number, r: number, size: number) => {
  const a = (angle * Math.PI) / 180;
  return { x: Math.round(L.attack.x + Math.cos(a) * r), y: Math.round(L.attack.y + Math.sin(a) * r), size };
};

/** Key codes the buttons press (the shell's `KEYS`: J attack, Space dodge, 1-4 skills, F interact, Esc pause). */
export const TOUCH_CODES = { attack: 'KeyJ', dodge: 'Space', skills: ['Digit1', 'Digit2', 'Digit3', 'Digit4'], interact: 'KeyF', menu: 'Escape' } as const;

/** Riftlight's on-screen buttons for phones (`EngineOptions.touchButtons`). The attack comes first (the engine colours the first button). */
export const RIFTLIGHT_TOUCH_BUTTONS: readonly TouchButton[] = [
  { label: 'A', code: TOUCH_CODES.attack, hint: 'attack', at: { ...L.attack } },
  ...TOUCH_CODES.skills.map((code, i) => ({ label: String(i + 1), code, hint: 'skill', at: polar(L.angles[i]!, L.ring, L.skill) })),
  { label: 'B', code: TOUCH_CODES.dodge, hint: 'dodge', at: polar(L.dodge.angle, L.dodge.r, L.dodge.size) },
  { label: 'F', code: TOUCH_CODES.interact, hint: 'talk', at: polar(L.interact.angle, L.interact.r, L.interact.size) },
  { label: '≡', code: TOUCH_CODES.menu, at: { ...L.menu, corner: 'top-left' } },
];

/** What the shell tells the pad each frame. */
export interface TouchFrame {
  /** The world is playable (town or level, alive, no panel on top). */
  playing: boolean;
  /** A showcase mode (arcade, hall, photo) owns the game: stick, attack, jump, interact and ≡ only. */
  showcase?: boolean;
  skills: readonly SkillSlotView[];
  /** The interaction on offer (`Riftlight.interactOffer`: TALK, OPEN, TAKE, GO and its target), or null. */
  interact: { verb: string; name: string } | null;
}

/**
 * Keeps the engine's touch buttons in step with the game: visibility, icons, cooldowns,
 * costs and the contextual interact button. Does nothing without touch controls.
 */
export class TouchPad {
  private readonly icons = new Map<string, HTMLCanvasElement>();
  private readonly state: TouchButtonState = {};

  constructor(private readonly engine: Engine) {}

  get active(): boolean {
    return !!this.engine.touch;
  }

  /**
   * The controls on screen, in art pixels (`toArt` maps client → art), for the HUD layout.
   * While they are hidden (a panel is open) the last rects stand in, so the HUD under a menu
   * keeps its touch layout instead of jumping back to the desktop bar.
   */
  zones(toArt: (x: number, y: number) => { x: number; y: number }): Box[] {
    const touch = this.engine.touch;
    if (!touch) return [];
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

  sync(f: TouchFrame): void {
    const touch = this.engine.touch;
    if (!touch) return;
    touch.show(f.playing || !!f.showcase);
    if (!touch.visible) return;
    const find = (slot: SkillSlotView['slot']) => f.skills.find((s) => s.slot === slot);
    this.slot(TOUCH_CODES.attack, find('attack'), 'A');
    this.slot(TOUCH_CODES.dodge, find('dodge'), 'B');
    TOUCH_CODES.skills.forEach((code, i) => {
      if (f.showcase) touch.set(code, { hidden: true });
      else this.slot(code, find(i), String(i + 1));
    });
    const it = f.showcase ? { verb: 'F', name: 'use' } : f.interact;
    touch.set(TOUCH_CODES.interact, it ? { hidden: false, label: it.verb.split(' ')[0]!.slice(0, 5), hint: it.name.toLowerCase().slice(0, 9) } : { hidden: true });
  }

  /** One skill button from its bar slot: icon, shutter, seconds, cost, dimmed when unaffordable. */
  private slot(code: string, s: SkillSlotView | undefined, label: string): void {
    const st = this.state;
    st.hidden = false;
    st.label = label;
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
