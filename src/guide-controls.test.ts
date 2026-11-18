// docs/GUIDE-CONTROLS.md is the kit's CONTROLS.md (scripts/bundle.mjs): the standard every game
// built on the kit meets (controller first, prompts for the device in use, menus at ten feet, touch
// as an add-on, the player's 52in1 settings, sessions). These checks keep it true to the code: its
// games import only what pixel-engine.js exports and play headless as the guide says (prompts follow
// the device, Options pauses as it is let go and never under 52in1's chord, a moment reports once in
// a LocalHub round); the names and codes its prose gives are the engine's; its head tags pass 52in1's
// catalogue rules and name the game's moments; it stays within its token budget. The bundle e2e
// suite then plays its pages with check.mjs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { guideBlocks, startsEngine } from '../scripts/bundle/guide.mjs';
import { CATALOGUE_TAGS, DUALSENSE, LIMITS, opensWithKeys, readMoments, readMultiplayer, SESSION_TAGS, TAGS } from '../scripts/hub/catalogue-check.mjs';
import * as bundle from './bundle';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guide = read('docs/GUIDE-CONTROLS.md');
const blocks = guideBlocks(guide);
/** The prose: the guide without its fenced code. */
const prose = guide.replace(/^```[\s\S]*?^```$/gm, '');

const tmp = mkdtempSync(join(tmpdir(), 'guide-controls-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
/** A game block as a module, its './pixel-engine.js' this repo's src/bundle.ts. */
async function load(name: string): Promise<Record<string, unknown>> {
  const b = blocks.find((m) => m.name === name)!;
  const file = join(tmp, `${name}.mjs`);
  writeFileSync(file, b.code.replaceAll(`from './pixel-engine.js'`, `from ${JSON.stringify(fileURLToPath(new URL('./bundle.ts', import.meta.url)))}`));
  return (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
}

/** A standard pad holding `pressed` (button indices). */
const pad = (...pressed: number[]): bundle.GamepadLike => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

describe('docs/GUIDE-CONTROLS.md', () => {
  it('has games named apart from the other guides, and the pages it names are its games', () => {
    const names = blocks.map((b) => b.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    const others = [...guideBlocks(read('docs/GUIDE.md')), ...guideBlocks(read('docs/GUIDE-ASSETS.md'))].map((b) => b.name);
    expect(names.filter((n) => others.includes(n))).toEqual([]);
    for (const [, page] of guide.matchAll(/examples\/([a-z0-9-]+)\.html/g)) expect(names, page).toContain(page);
    for (const name of names) expect(guide, `${name} has a page named in the prose`).toContain(`examples/${name}.html`);
  });

  it('every game parses, imports only what pixel-engine.js exports and uses it all, exports createGame() and starts only where there is a page', () => {
    for (const { name, code } of blocks) {
      const out = ts.transpileModule(code, { fileName: `${name}.js`, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true } });
      expect((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), name).toEqual([]);
      const imports = [...code.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)];
      expect(imports.map((m) => m[2]), name).toEqual(['./pixel-engine.js']);
      const imported = imports[0]![1]!.split(',').map((s) => s.trim()).filter(Boolean);
      expect(imported.filter((n) => !(n in bundle)), name).toEqual([]);
      for (const n of imported) expect(code.split(n).length - 1, `${name}: ${n} used`).toBeGreaterThan(1);
      for (const [, list] of code.matchAll(/const \{([^}]*)\} = THREE;/g)) {
        const names = list!.split(',').map((s) => s.trim());
        expect(names.filter((n) => !(n in THREE)), name).toEqual([]);
        for (const n of names) expect(code.split(n).length - 1, `${name}: THREE.${n} used`).toBeGreaterThan(1);
      }
      expect(code, name).toMatch(/^export const createGame = /m);
      expect(code, name).toMatch(/\nif \(typeof document !== 'undefined'\) await Engine\.start\(createGame\([^)]*\), withUrlOptions\(\{ container: document\.getElementById\('app'\), .*\}\)\);\n$/);
      expect(startsEngine(code), `${name} is a game (a page in the kit)`).toBe(true);
    }
  });

  it('the names and codes its prose gives are the engine’s', () => {
    const TYPES = ['Game']; // type-only exports (API.md has them)
    const spans = prose.split('`').filter((_, i) => i % 2 === 1);
    // (a file's name and a pattern of codes, `Pad*`, aside)
    const lead = spans.map((s) => s.match(/^(?:new )?([A-Za-z_$][\w$]*)(.*)/s)).filter((m): m is RegExpMatchArray => !!m && !/^\.(md|m?js|html|png)\b/.test(m[2]!) && m[2] !== '*');
    // input codes: a pad's must be one the engine presses or draws, a swipe's one it presses
    const padCodes = new Set([...Object.values(bundle.GAMEPAD_BUTTONS), ...Object.values(bundle.TOUCHPAD_KEYS), 'PadLStick', 'PadRStick', 'PadStick', 'DPad']);
    const codes = lead.map((m) => m[1]!).filter((n) => /^(Pad|DPad$|Swipe|Touch[A-Z]|Key[A-Z]|Arrow|Escape$|Space$|Enter$|WASD$|Arrows$)/.test(n));
    expect(codes.filter((c) => (c.startsWith('Pad') || c === 'DPad') && !padCodes.has(c))).toEqual([]);
    expect(codes.filter((c) => c.startsWith('Swipe') && !(Object.values(bundle.SWIPE_KEYS) as string[]).includes(c))).toEqual([]);
    expect(codes.filter((c) => c.startsWith('Touch') && !['TouchTap', 'TouchSwipe', 'TouchStick', 'TouchControls'].includes(c))).toEqual([]);
    // a capitalised name is an export; a call, an export or a method of the engine's input, HUD,
    // engine, controls or a session
    const classes = [bundle.Input, bundle.Hud, bundle.Engine, bundle.Controls, bundle.HubSession, bundle.LocalHub, bundle.HubSettings, bundle.DualSense, bundle.Lang];
    const named = lead.filter((m) => !codes.includes(m[1]!) && /^[A-Z]/.test(m[1]!)).map((m) => m[1]!);
    const called = lead.filter((m) => /^[a-z]/.test(m[1]!) && m[2]!.startsWith('(')).map((m) => m[1]!);
    expect(named.length + called.length).toBeGreaterThan(15);
    expect([...new Set(named)].filter((n) => !(n in bundle) && !TYPES.includes(n))).toEqual([]);
    expect([...new Set(called)].filter((n) => !(n in bundle) && !classes.some((c) => n in c.prototype))).toEqual([]);
    // every pad button it lists by name is the engine's, and every button the engine presses is listed
    const listed = guide.match(/^Pad codes: ([\s\S]*?)\n\n/m)![1]!;
    const buttons = new Set(Object.values(bundle.GAMEPAD_BUTTONS).filter((c) => c.startsWith('Pad')));
    expect([...buttons].filter((c) => !listed.includes(`\`${c}\``))).toEqual([]);
    expect(bundle.HOST_CHORD.map((i) => bundle.GAMEPAD_BUTTONS[i])).toEqual(['PadBack', 'PadStart']);
  });

  it('Beacon Yard plays as it says: prompts follow the device, Options pauses as it is let go (never under 52in1’s chord), its menu, the light button only by a dark beacon', async () => {
    const { createGame } = await load('beacon-yard');
    type Yard = bundle.Game & { at: THREE.Vector3; menu: unknown; lit(): number; status(ctx: unknown): string };
    const game = (createGame as () => Yard)();
    const engine = await bundle.Engine.headless(game, { touch: true });
    try {
      const status = () => game.status(engine.context);
      const label = (action: string) => engine.controls.label(action);
      engine.input.noteDevice('keyboard');
      engine.step(2);
      expect([status(), label('use'), label('move'), label('pause')]).toEqual(['beacons 0/4, keyboard', 'E', 'WASD', 'Esc']);
      // the keyboard lights the first beacon
      game.at.set(-6, 0.6, -4);
      engine.input.setKey('KeyE', true);
      engine.step(1);
      engine.input.setKey('KeyE', false);
      engine.step(1);
      expect(game.lit()).toBe(1);
      // a pad lights the second: the prompts turn to its buttons, PlayStation's, then Xbox's
      game.at.set(6, 0.6, -4);
      engine.input.setGamepads([pad(0)]);
      engine.step(1);
      engine.input.setGamepads([pad()]);
      engine.step(1);
      expect([game.lit(), status(), label('use'), label('move'), label('pause')]).toEqual([2, 'beacons 2/4, pad', 'Cross', 'Left stick', 'Options']);
      engine.settings.set({ padGlyphs: 'xbox' });
      expect([label('use'), label('pause')]).toEqual(['A', 'Menu']);
      engine.settings.set({ padGlyphs: undefined });
      // Options opens the menu as it is let go; Circle closes it
      engine.input.setGamepads([pad(9)]);
      engine.step(1);
      expect(game.menu, 'Options held: not yet').toBeNull();
      engine.input.setGamepads([pad()]);
      engine.step(2);
      expect(game.menu, 'Options let go: the menu').not.toBeNull();
      engine.input.setGamepads([pad(1)]);
      engine.step(1);
      engine.input.setGamepads([pad()]);
      engine.step(2);
      expect(game.menu, 'Circle closes it').toBeNull();
      // Create + Options held for 52in1's bar, Options a poll first: no menu behind the bar
      engine.input.setGamepads([pad(9)]);
      engine.step(1);
      engine.input.setGamepads([pad(8, 9)]);
      engine.step(60);
      engine.input.setGamepads([pad()]);
      engine.step(2);
      expect(game.menu, '52in1’s chord').toBeNull();
      // on touch the prompts name the touch buttons
      engine.input.noteDevice('touch');
      engine.step(1);
      expect([label('use'), label('move'), label('back')]).toEqual(['LIGHT', 'Stick', 'Swipe']);
      expect(engine.errors).toEqual([]);
    } finally {
      engine.input.setGamepads(null);
      engine.dispose();
    }
  });

  it('Gem Rush: every copy of a moment sets up the same, waits for the start, and reports once whether it was cleared; a parallel round reports progress, then its result', async () => {
    const { createGame, MOMENTS } = await load('gem-rush');
    type Rush = bundle.Game & { at: THREE.Vector3; gems: THREE.Mesh[]; got: number; over: string | null };
    const make = createGame as (session: bundle.HubSession | null) => Rush;
    const moments = MOMENTS as Record<string, { gems: number; seconds: number }>;
    /** A round in a LocalHub: each player's session, game and engine. */
    async function round(options: ConstructorParameters<typeof bundle.LocalHub>[0]) {
      const hub = new bundle.LocalHub(options);
      const copies = await Promise.all(
        hub.players.map(async (p) => {
          const session = (await bundle.HubSession.join({ mode: ['parallel', 'moments'], seats: [1, 4], client: hub.client(p.id), autoFlush: false, clock: () => hub.now }))!;
          const game = make(session);
          const engine = await bundle.Engine.headless(game, { seed: session.info.seed });
          return { session, game, engine };
        }),
      );
      const step = (frames: number) => copies.forEach((c) => c.engine.step(frames));
      return { hub, copies, step };
    }

    const { hub, copies, step } = await round({ mode: 'moments', moment: { id: 'gem-hunt', seconds: moments['gem-hunt']!.seconds }, players: 2, seed: 41 });
    const [a, b] = copies;
    try {
      expect(a!.game.gems.length).toBe(moments['gem-hunt']!.gems);
      expect(a!.game.gems.map((g) => g.position.toArray())).toEqual(b!.game.gems.map((g) => g.position.toArray()));
      a!.engine.input.setKey('KeyD', true);
      step(60);
      expect(a!.game.at.x, 'still until the start').toBe(0);
      hub.start();
      hub.advance(3000);
      step(200); // the countdown, in game time
      expect(a!.game.at.x, 'it plays once the countdown is over').toBeGreaterThan(0);
      a!.engine.input.setKey('KeyD', false);
      hub.advance(2500);
      for (const gem of a!.game.gems) {
        a!.game.at.copy(gem.position);
        step(1);
      }
      expect([a!.game.got, a!.game.over]).toEqual([moments['gem-hunt']!.gems, 'cleared']);
      expect(hub.results.get(0)).toEqual({ won: true, time: 2500 });
      hub.advance(moments['gem-hunt']!.seconds * 1000 - 2500 + 10); // time-up: the other copy fails it
      step(2);
      expect([b!.game.over, hub.results.get(1)?.won]).toEqual(['failed', false]);
      hub.advance(3000);
      expect([hub.endReason, hub.standings(), hub.problems]).toEqual(['finished', [[0], [1]], []]);
      expect([...a!.engine.errors, ...b!.engine.errors]).toEqual([]);
    } finally {
      copies.forEach((c) => c.engine.dispose());
    }

    const run = await round({ mode: 'parallel', players: 1, seed: 7 });
    const [solo] = run.copies;
    try {
      expect(solo!.game.gems.length).toBe(12);
      run.hub.start();
      run.hub.advance(3000);
      run.step(200);
      solo!.game.at.copy(solo!.game.gems[0]!.position);
      run.step(1);
      run.hub.advance(1000);
      expect(run.hub.progress.get(0)).toMatchObject({ score: 1 });
      run.hub.timeUp();
      run.hub.advance(10);
      run.step(2);
      expect([solo!.game.over, run.hub.results.get(0), run.hub.problems]).toEqual(['failed', { score: 1 }, []]);
    } finally {
      solo!.engine.dispose();
    }

    // alone (no 52in1): it plays at once
    const alone = make(null);
    const engine = await bundle.Engine.headless(alone);
    try {
      engine.input.setKey('KeyD', true);
      engine.step(30);
      expect([alone.at.x > 0, alone.gems.length]).toEqual([true, 12]);
    } finally {
      engine.dispose();
    }
  });

  it('its head tags pass 52in1’s catalogue rules and name Gem Rush’s moments', async () => {
    const head = guide.match(/^```html\n([\s\S]*?)^```$/m)![1]!;
    const tags = [...head.matchAll(/^<meta name="([\w:-]+)" content="([^"]*)">$/gm)].map((m) => [m[1]!, m[2]!] as const);
    expect(tags.length).toBe(head.trim().split('\n').length); // every line is a tag that reads
    const all = (name: string) => tags.filter(([k]) => k === name).map(([, v]) => v);
    const one = (name: string) => all(name)[0] ?? '';
    expect(tags.map(([k]) => k).filter((k) => !CATALOGUE_TAGS.includes(k) && !SESSION_TAGS.includes(k))).toEqual([]);
    const tagList = one('hub:tags').split(', ');
    expect([tagList.filter((t) => !TAGS.includes(t)), tagList.length >= 2 && tagList.length <= 5, tagList.includes('gamepad') && tagList.includes('touch')]).toEqual([[], true, true]);
    const controls = one('hub:controls');
    expect(controls.length).toBeLessThanOrEqual(LIMITS.controls);
    expect(controls.split(';').filter((c) => !opensWithKeys(c.trim()))).toEqual([]);
    expect(controls).toMatch(/\bgamepad\b/);
    expect(one('hub:dualsense').split(', ').filter((d) => !DUALSENSE.includes(d))).toEqual([]);
    const multiplayer = readMultiplayer(one('hub:multiplayer'));
    expect(multiplayer.problems).toEqual([]);
    expect(multiplayer.modes.map((m) => m.where)).toEqual(['parallel', 'moments']);
    const read = readMoments(all('hub:moment'));
    expect(read.problems).toEqual([]);
    const { MOMENTS } = await load('gem-rush');
    expect(Object.fromEntries(read.moments.map((m) => [m.id, m.seconds]))).toEqual(Object.fromEntries(Object.entries(MOMENTS as Record<string, { seconds: number }>).map(([id, m]) => [id, m.seconds])));
    // what the game joins with, read from these tags as a page would
    expect(bundle.headSession((name) => one(name) || null)).toEqual({ modes: ['parallel', 'moments'], seats: [1, 4] });
  });

  it('stays within its token budget (~4 characters a token)', () => {
    expect(guide.length / 4).toBeLessThan(6000);
  });
});
