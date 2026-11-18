// Riftlight's 52in1 head (scripts/hub/riftlight.mjs, written by build:single): the tags pass the
// hub's own checker, and each one says what the game does: the controls are its bindings, the
// DualSense extras are the ones its code uses, and couch co-op is a way to play on one device,
// never a session's (docs/game/hub.md *What the head says*).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkPage, DUALSENSE, readMultiplayer } from '../../../scripts/hub/catalogue-check.mjs';
import { hubHead, hubPage, readHead } from '../../../scripts/hub/head.mjs';
import { CATALOGUE, riftlightTags } from '../../../scripts/hub/riftlight.mjs';
import { headSession, TOUCHPAD_KEYS } from '../../engine';
import { KEYS, MOUSE } from '../game/controls';
import { RIFTLIGHT_OPTIONS } from '../index';
import { riftlightLines } from '../lang';
import { momentTags } from './moments';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { tags, session, moments } = riftlightTags({ model: 'Claude Opus 5.5', effort: 'max', moments: momentTags() });
/** The page's head as build:single writes it, on a page with no game code but the hub settings it reads. */
const page = hubPage(
  '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body><script type="module">window.AIHubSettings?.addEventListener("change", () => {});</script></body>\n</html>\n',
  hubHead({
    client: true,
    title: `${CATALOGUE.name} — ${CATALOGUE.tagline}`,
    description: CATALOGUE.description,
    themeColor: CATALOGUE.themeColor,
    icon: `data:image/svg+xml;base64,${readFileSync(join(root, 'public/favicon.svg')).toString('base64')}`,
    tags,
    session,
    moments,
    lines: riftlightLines(),
  }),
  'en',
);
const head = readHead(page);
const one = (name: string) => head.one(name) ?? '';

describe('Riftlight’s 52in1 head', () => {
  it('passes the hub’s checker with nothing to say', () => {
    expect(checkPage(page).problems).toEqual([]);
  });

  it('is tagged for its inputs: a controller and touch alone play it all', () => {
    expect(one('hub:tags')).toBe('action-rpg, pixel art, co-op, gamepad, touch');
  });

  it('names the keys the game binds, then a pad or touch, then couch co-op’s pads', () => {
    const controls = one('hub:controls').split('; ');
    // each keycap the head names, as the game's codes (game/controls.ts)
    const NAMED: Record<string, readonly string[]> = { WASD: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], click: [MOUSE.left[0]], 'right click': [MOUSE.right[0]], Space: ['Space'], Tab: ['Tab'], Esc: ['Escape'] };
    const codesOf = (key: string): readonly string[] | undefined => {
      if (/^[A-Z]$/.test(key)) return [`Key${key}`];
      const digits = /^(\d)–(\d)$/.exec(key);
      if (digits) return Array.from({ length: Number(digits[2]) - Number(digits[1]) + 1 }, (_, i) => `Digit${Number(digits[1]) + i}`);
      return NAMED[key];
    };
    // what each action is bound to
    const BOUND: Record<string, readonly string[]> = {
      move: [...KEYS.up, ...KEYS.down, ...KEYS.left, ...KEYS.right],
      attack: [MOUSE.left[0], ...KEYS.attack],
      skills: [MOUSE.right[0], ...KEYS.skill.flat()],
      dodge: KEYS.dodge,
      interact: KEYS.interact,
      'the map': KEYS.map,
      pause: KEYS.pause,
    };
    const keyed = controls.filter((c) => !c.startsWith('gamepad'));
    expect(controls.slice(keyed.length)).toEqual(['gamepad or touch to play', 'gamepads for players 2–4']);
    const wrong = keyed.filter((c) => {
      const m = /^(.+?) (?:to|for) (.+)$/.exec(c);
      const codes = m?.[1]!.split(' or ').map(codesOf);
      const bound = BOUND[m?.[2] ?? ''];
      return !codes || !bound || codes.some((k) => !k || k.some((code) => !bound.includes(code)));
    });
    expect(wrong).toEqual([]);
  });

  it('names the DualSense extras its code uses, and no others', () => {
    const code = (dir: string): string =>
      readdirSync(dir, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? code(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.includes('.test.') ? readFileSync(join(dir, e.name), 'utf8') : ''))
        .join('\n');
    const src = code(join(root, 'src/riftlight'));
    const uses: Record<string, boolean> = {
      'light bar': /\bdualsense\.light\(/.test(src),
      'adaptive triggers': /\bdualsense\.trigger\(/.test(src),
      haptics: /\binput\.rumble\(/.test(src),
      motion: RIFTLIGHT_OPTIONS.settings?.motion === true && /\bmotionTurn\b/.test(src),
      // its gestures, not only its press (which a browser reports as a button with 52in1's touchpad off): the game reads them, and a binding uses one
      touchpad: /\binput\.touchpad = true\b/.test(src) && Object.values(TOUCHPAD_KEYS).some((code) => (Object.values(KEYS).flat(2) as string[]).includes(code)),
      speaker: /\bbus: 'speaker'/.test(src),
      microphone: /\bopenMicrophone\(/.test(src),
    };
    expect(one('hub:dualsense')).toBe(DUALSENSE.filter((x) => uses[x]).join(', '));
    expect(one('hub:dualsense')).toBe('light bar, haptics, motion, touchpad, speaker');
  });

  it('offers couch co-op on one device, and only the online modes to a session', () => {
    const ways = readMultiplayer(one('hub:multiplayer')).modes.map((m) => `${m.key} ${m.seats.join('-')}`);
    expect(ways).toEqual(['shared-world co-op 1-4', 'shared-world versus 2-4', 'ghost 1-4', 'parallel 1-4', 'moments 1-4', 'same-screen co-op 2-4']);
    expect([one('hub:players'), one('hub:session-players'), one('hub:session-mode')]).toEqual(['1-4', '1-4', 'shared-world']);
    // what the page joins a session with (src/main.ts): the online four, never the couch
    expect(headSession((name) => head.one(name) ?? null)).toEqual({ modes: ['shared-world', 'ghost', 'parallel', 'moments'], seats: [1, 4] });
    // a card for each online mode, none for the couch
    const cards = Object.keys(session).filter((k) => /^hub:session-(goal|howto)-/.test(k));
    expect(cards.map((k) => k.replace(/^hub:session-(goal|howto)-/, '')).filter((w, i, all) => all.indexOf(w) === i)).toEqual(['co-op', 'versus', 'ghost', 'parallel', 'moments']);
    for (const k of ['hub:session-howto', ...cards.filter((k) => k.includes('howto'))]) expect(one(k).length, k).toBeLessThanOrEqual(80);
  });
});
