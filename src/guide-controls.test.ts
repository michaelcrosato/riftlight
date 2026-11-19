// docs/GUIDE-CONTROLS.md is the kit's CONTROLS.md (scripts/bundle.mjs): the standard every game
// built on the kit meets (controller first, prompts for the device in use, menus at ten feet, touch
// as an add-on, the player's 52in1 settings, sessions). These checks keep it true to the code: its
// games import only what pixel-engine.js exports and play headless as the guide says (prompts follow
// the device, Options pauses as it is let go and never under 52in1's chord, a moment readies up by
// itself and reports once in a LocalHub round); the names and codes its prose and its unnamed code
// give are the engine's (dotted ones walked on a live engine and session, `Game.<x>` one of the
// Game hooks; a bare option or field, `touchDensity: 2`, `micLater`, read from the engine's
// source: EngineOptions and its camera config, the touch controls, the 52in1 settings); the page
// the kit writes for Gem Rush (52in1's session client, then its head tags) passes 52in1's
// catalogue checker on them, and they name the game's moments; it stays within its token budget; every text its games draw lies inside the HUD, clear
// of the others and in whole words, what a player needs is in view at every window shape, and the
// player's wheel and + / - zoom both. The bundle e2e suite then plays its pages with check.mjs, on
// a phone too (the touch buttons each game passes, a HUD clear of the controls).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import ts from 'typescript';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { examplePage, guideBlocks, guideHeads, startsEngine } from '../scripts/bundle/guide.mjs';
import { settle } from './engine/node';
import { checkPage, DUALSENSE, LOCAL, MODES, opensWithKeys, readMoments, readMultiplayer, TAGS } from '../scripts/hub/catalogue-check.mjs';
import { readHead } from '../scripts/hub/head.mjs';
import * as bundle from './bundle';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guide = read('docs/GUIDE-CONTROLS.md');
const blocks = guideBlocks(guide);
/** The prose: the guide without its fenced code. */
const prose = guide.replace(/^```[\s\S]*?^```$/gm, '');
/** The prose's code spans. */
const spans = prose.split('`').filter((_, i) => i % 2 === 1);

/**
 * The public members of the interfaces and classes `names` declared in `path`, read from the source
 * (so they keep in step with it): each name, with the members of an object type it holds
 * (`settings: { padButton }`, `rects(): { zone }`) under it. Every one of `names` must be there.
 */
function members(path: string, ...names: string[]): Map<string, Set<string>> {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const out = new Map<string, Set<string>>();
  const found: string[] = [];
  const inner = (type: ts.Node, into: Set<string>): void => {
    if (ts.isTypeLiteralNode(type)) for (const m of type.members) member(m, into);
    else ts.forEachChild(type, (t) => inner(t, into));
  };
  const member = (m: ts.Node, into?: Set<string>): void => {
    if (!(ts.isPropertySignature(m) || ts.isMethodSignature(m) || ts.isPropertyDeclaration(m) || ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m))) return;
    if (!ts.isIdentifier(m.name) || ts.getCombinedModifierFlags(m) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return;
    into?.add(m.name.text);
    const held = out.get(m.name.text) ?? new Set<string>();
    out.set(m.name.text, held);
    if (m.type) inner(m.type, held);
  };
  ts.forEachChild(source, (node) => {
    if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.name && names.includes(node.name.text)) {
      found.push(node.name.text);
      for (const m of node.members) member(m);
    }
  });
  expect(found.sort(), path).toEqual([...names].sort());
  return out;
}
/** Every name in `map`, its members' members too. */
const flat = (map: Map<string, Set<string>>) => new Set([...map.keys(), ...[...map.values()].flatMap((s) => [...s])]);

/** The `Game` hooks (`Game.controls`): a `Game.<x>` in the prose is one of them. */
const GAME_HOOKS = new Set(members('src/engine/Engine.ts', 'Game').keys());
/** An option the prose names as `name: value`: `Engine.start`'s (EngineOptions, its `settings`' and `camera`'s under it) or a HUD text's (`scale: 2`). */
const OPTIONS = new Map([...members('src/engine/Engine.ts', 'EngineOptions'), ['camera', new Set(members('src/engine/camera.ts', 'CameraConfig').keys())], ...members('src/engine/hud/Hud.ts', 'HudOptions')]);
/**
 * A bare lower-case name the prose gives (`touchButtons`, `micLater`, `zone`, `at`, `height`,
 * `update`): an option, a hook, a field of the touch controls (`ctx.engine.touch`, a button), the
 * player's 52in1 settings (`ctx.engine.hubSettings`), the HUD or a controls table, an export; or
 * one of 52in1's words (a tag, a mode, a DualSense extra, a hub event).
 */
const FIELDS = new Set([
  ...flat(OPTIONS),
  ...GAME_HOOKS,
  ...flat(members('src/engine/TouchControls.ts', 'TouchControls', 'TouchButton', 'TouchButtonState')),
  ...flat(members('src/engine/hub/settings.ts', 'HubSettings')),
  ...flat(members('src/engine/hud/Hud.ts', 'Hud')),
  ...flat(members('src/engine/controls.ts', 'Control')),
  ...Object.keys(bundle),
  ...TAGS,
  ...MODES,
  ...LOCAL,
  ...DUALSENSE,
  ...[...read('src/engine/hub/session.ts').matchAll(/\| \{ readonly type: '([\w-]+)'/g)].map((m) => m[1]!),
  'description', // the catalogue head's <meta name="description">
]);
/**
 * The bare lower-case names in `texts` (code spans: a name alone, or `name: value`, an option with
 * the names of an object value under it) that are not the engine's or 52in1's.
 */
function unknownNames(texts: readonly string[]): string[] {
  const unknown: string[] = [];
  for (const text of texts) {
    const m = /^([a-z][A-Za-z0-9]*)(?::\s+([\s\S]*))?$/.exec(text); // (a meta tag's name, `hub:tags`, aside)
    if (!m) continue;
    const [, name, value] = m as unknown as [string, string, string | undefined];
    if (value === undefined) {
      if (!FIELDS.has(name)) unknown.push(name);
      continue;
    }
    if (!OPTIONS.has(name)) unknown.push(name);
    else if (value.startsWith('{')) for (const [, key] of value.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) if (!OPTIONS.get(name)!.has(key!)) unknown.push(`${name}.${key}`);
  }
  return unknown;
}

const tmp = mkdtempSync(join(tmpdir(), 'guide-controls-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
/** A game block as a module, its './pixel-engine.js' this repo's src/bundle.ts. */
async function load(name: string): Promise<Record<string, unknown>> {
  const b = blocks.find((m) => m.name === name)!;
  const file = join(tmp, `${name}.mjs`);
  writeFileSync(file, b.code.replaceAll(`from './pixel-engine.js'`, `from ${JSON.stringify(fileURLToPath(new URL('./bundle.ts', import.meta.url)))}`));
  return (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
}

/** The camera a page starts with, read from its start line (`Engine.headless`'s default is iso). */
function cameraOf(name: string): bundle.CameraConfig {
  const m = /camera: \{ preset: '(\w+)', minWidth: (\d+) \}/.exec(blocks.find((b) => b.name === name)!.code);
  expect(m, `${name} starts a camera that keeps its ground's width in view`).not.toBeNull();
  return { preset: m![1] as bundle.CameraPreset, minWidth: Number(m![2]) };
}

/** The engine's input, HUD, engine, controls, sessions, touch controls, audio, settings and lights: a bare call in the prose (`rects()`) is one of theirs. */
const CLASSES = [bundle.Input, bundle.Hud, bundle.Engine, bundle.Controls, bundle.HubSession, bundle.LocalHub, bundle.HubSettings, bundle.DualSense, bundle.Lang, bundle.TouchControls, bundle.AudioManager, bundle.Settings, bundle.LightPool];

/**
 * What is amiss with the texts the next frame draws (`what` says the state), each placed as
 * `hud.text` places it (a phone held upright has 130 columns, a tall narrow window 90): one reaching
 * outside the HUD, one over another, or a piece of a word wrapped apart (a word neither the game's
 * `code` nor the names of its controls on the device in use have; what `hud.prompt` and
 * `hud.legend` draw, a glyph's caption and its words, aside).
 */
function textsAmiss(engine: bundle.Engine, what: string, code: string): string[] {
  const { hud } = engine;
  const words = (s: string) => s.toUpperCase().split(/[^\p{L}]+/u).filter(Boolean);
  const known = new Set([...words(code), ...Object.keys(engine.game.controls ?? {}).flatMap((a) => words(engine.controls.label(a)))]);
  const text = vi.spyOn(hud, 'text');
  const captions = captionCalls(hud, text);
  try {
    engine.step(1);
    const { width, height } = hud;
    const at = `${what} at ${width}x${height}`;
    const boxes = text.mock.calls.map(([x, y, s, o = {}], i) => {
      const size = hud.measure(s, Math.max(1, Math.round(o.scale ?? 1)));
      const [left, top] = bundle.hudPlace(x, y, size.width, size.height, o.anchor ?? 'top-left', { width, height });
      return { s, left, top, right: left + size.width, bottom: top + size.height, caption: captions.has(i) };
    });
    return [
      ...boxes.filter((b) => b.left < 0 || b.top < 0 || b.right > width || b.bottom > height).map((b) => `${at}: ${b.s}`),
      ...boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).map((b) => `${at}: ${a.s} over ${b.s}`)),
      ...boxes.filter((b) => !b.caption).flatMap((b) => words(b.s).filter((w) => !known.has(w)).map((w) => `${at}: ${b.s} (${w}: a piece of a word)`)),
    ];
  } finally {
    captions.restore();
    text.mockRestore();
  }
}

/**
 * Which of `text`'s calls `hud.prompt` and `hud.legend` make (a glyph's caption and its words),
 * by their index, as the frame draws: the rest are the game's own texts, Beacon Yard's menu rows
 * (drawn with no shadow) too. `restore` puts the two back. (src/guide-recipes.test.ts finds them
 * the same way.)
 */
function captionCalls(hud: bundle.Hud, text: { mock: { calls: unknown[] } }): Set<number> & { restore(): void } {
  const inside = new Set<number>() as Set<number> & { restore(): void };
  // wrapped by hand, not with vi.spyOn: a caller may be spying on them already (the legend)
  const owns = (['prompt', 'legend'] as const).map((name) => {
    const own = hud[name] as (...a: unknown[]) => number;
    (hud as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const from = text.mock.calls.length;
      try {
        return own.apply(hud, args);
      } finally {
        for (let i = from; i < text.mock.calls.length; i++) inside.add(i);
      }
    };
    return () => ((hud as unknown as Record<string, unknown>)[name] = own);
  });
  inside.restore = () => owns.forEach((put) => put());
  return inside;
}

/** A standard pad holding `pressed` (button indices). */
const pad = (...pressed: number[]): bundle.GamepadLike => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

describe('docs/GUIDE-CONTROLS.md', () => {
  it('has games named apart from the other guides, and the pages it names are its games', () => {
    const names = blocks.map((b) => b.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    const others = ['docs/GUIDE.md', 'docs/GUIDE-RECIPES.md', 'docs/GUIDE-ASSETS.md'].flatMap((g) => guideBlocks(read(g))).map((b) => b.name);
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
    const named = lead.filter((m) => !codes.includes(m[1]!) && /^[A-Z]/.test(m[1]!)).map((m) => m[1]!);
    const called = lead.filter((m) => /^[a-z]/.test(m[1]!) && m[2]!.startsWith('(')).map((m) => m[1]!);
    expect(named.length + called.length).toBeGreaterThan(15);
    expect([...new Set(named)].filter((n) => !(n in bundle) && !TYPES.includes(n))).toEqual([]);
    expect([...new Set(called)].filter((n) => !(n in bundle) && !CLASSES.some((c) => n in c.prototype))).toEqual([]);
    // every pad button it lists by name is the engine's, and every button the engine presses is listed
    const listed = guide.match(/^Pad codes: ([\s\S]*?)\n\n/m)![1]!;
    const buttons = new Set(Object.values(bundle.GAMEPAD_BUTTONS).filter((c) => c.startsWith('Pad')));
    expect([...buttons].filter((c) => !listed.includes(`\`${c}\``))).toEqual([]);
    expect(bundle.HOST_CHORD.map((i) => bundle.GAMEPAD_BUTTONS[i])).toEqual(['PadBack', 'PadStart']);
  });

  it('every dotted name in its prose and its unnamed code is the engine’s', async () => {
    const unnamed = [...guide.matchAll(/^```js\n([\s\S]*?)^```$/gm)].map((m) => m[1]!);
    expect(unnamed.length, 'section 5’s snippet').toBeGreaterThan(0);
    // `a.b.c` and `a?.b(`: the root, then each member (a file's name and the page's own globals aside)
    const chains = [...spans, ...unnamed]
      .flatMap((text) => [...text.matchAll(/(?<![\w$.'"/-])([A-Za-z_$][\w$]*)((?:\??\.[A-Za-z_$][\w$]*)+)/g)].map((m) => [m[1]!, ...m[2]!.split(/\??\./).slice(1)]))
      .filter((c) => !/^(md|m?js|html|png|json)$/.test(c.at(-1)!) && !['window', 'navigator'].includes(c[0]!));
    expect(chains.length).toBeGreaterThan(30);
    // each member walked on a live engine's context and a session in a round of moments (a member
    // null headless, `ctx.engine.touch`, on the class it holds on a page): a renamed method or field
    // fails, and a name with a root of its own has to be added here
    const engine = await bundle.Engine.headless({ name: 'Names', setup() {}, cameraTarget: () => new THREE.Vector3() });
    try {
      const hub = new bundle.LocalHub({ mode: 'moments', moment: { id: 'gem-dash', seconds: 8 }, players: 1 });
      const session = (await bundle.HubSession.join({ mode: 'moments', seats: [1, 4], client: hub.client(0), autoFlush: false, clock: () => hub.now }))!;
      const ctx = engine.context;
      const roots: Record<string, unknown> = { ...bundle, ctx, input: ctx.input, hud: ctx.hud, engine: ctx.engine, session, info: session.info, lang: bundle.Lang.prototype };
      const onPage: Record<string, object> = { touch: bundle.TouchControls.prototype };
      const resolves = ([root, ...path]: string[]): boolean => {
        if (root === 'Game') return path.length === 1 && GAME_HOOKS.has(path[0]!); // a type (API.md has it): one of its hooks
        if (!(root! in roots)) return false;
        let at: unknown = roots[root!];
        let held = root!;
        for (const [i, name] of path.entries()) {
          at ??= onPage[held];
          if (at === undefined || !(name in Object(at))) return false;
          if (i < path.length - 1) at = (at as Record<string, unknown>)[name];
          held = name;
        }
        return true;
      };
      expect(chains.filter((c) => !resolves(c)).map((c) => c.join('.'))).toEqual([]);
      // a misspelt hook, member or field fails
      expect(['Game.controls', 'Game.control', 'Game.anything', 'ctx.engine.touch.show', 'ctx.engine.touch.shown', 'ctx.engine.hubSettings.micLatr'].filter((c) => !resolves(c.split('.')))).toEqual(['Game.control', 'Game.anything', 'ctx.engine.touch.shown', 'ctx.engine.hubSettings.micLatr']);
    } finally {
      engine.dispose();
    }
  });

  it('the bare names its prose gives (an option, a hook, a field) are the engine’s, or 52in1’s words', () => {
    const bare = spans.filter((s) => /^[a-z][A-Za-z0-9]*(:\s|$)/.test(s));
    expect(bare.length, 'touchButtons, micLater, zone, touchDensity: 2...').toBeGreaterThan(30);
    expect(unknownNames(spans)).toEqual([]);
    // the lists are the source's: an option or a field misspelt, or one the engine doesn't have, fails
    expect([...OPTIONS.keys()]).toEqual(expect.arrayContaining(['touchDensity', 'touchStick', 'touchButtons', 'aspect', 'settings', 'scale']));
    expect(unknownNames(['touchDensity: 2', 'touchDensty: 2', 'touchStik', 'micLater', 'micLatr', 'zone', 'zones', 'settings: { padButton: true }', 'settings: { padButon: true }', 'camera: { minWidth: 14 }', 'camera: { minWidht: 14 }', 'gamepad', 'gamepads', 'time-up'])).toEqual(['touchDensty', 'touchStik', 'micLatr', 'zones', 'settings.padButon', 'camera.minWidht', 'gamepads']);
  });

  it('Beacon Yard plays as it says: prompts follow the device, Options pauses as it is let go (never under 52in1’s chord), its menu', async () => {
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

  it('Gem Rush: every copy of a moment sets up the same, readies up with no key press, waits for the start, and reports once whether it was cleared; a parallel round reports progress, then its result', async () => {
    const { createGame, MOMENTS } = await load('gem-rush');
    type Rush = bundle.Game & { at: THREE.Vector3; gems: THREE.Mesh[]; got: number; over: string | null; finish(ctx: bundle.GameContext, won: boolean): void };
    const make = createGame as (session: bundle.HubSession | null) => Rush;
    /** Space pressed for a frame, then a few frames: a `loadGame` swaps in after its frame. */
    const space = async (engine: bundle.Engine) => {
      engine.input.setKey('Space', true);
      engine.step(1);
      engine.input.setKey('Space', false);
      await settle();
      engine.step(2);
    };
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
      expect(hub.allReady, 'every copy readied up with no key press').toBe(true);
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
      step(90);
      await space(a!.engine);
      expect(a!.engine.game, 'in a session the hub moves on: no press plays again').toBe(a!.game);
      expect([...a!.engine.errors, ...b!.engine.errors]).toEqual([]);
    } finally {
      copies.forEach((c) => c.engine.dispose());
    }

    const run = await round({ mode: 'parallel', players: 1, seed: 7 });
    const [solo] = run.copies;
    try {
      expect([solo!.game.gems.length, run.hub.allReady]).toEqual([12, true]);
      run.hub.start();
      run.hub.advance(3000);
      run.step(200);
      expect(run.hub.progress.get(0), 'on the hub\'s scoreboard from the start, before a gem (52in1 asks every copy for its progress)').toMatchObject({ score: 0 });
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

    // alone (no 52in1): it plays at once; once over, Space (Cross, a tap) plays again, not at once
    const alone = make(null);
    const engine = await bundle.Engine.headless(alone);
    try {
      engine.input.setKey('KeyD', true);
      engine.step(30);
      engine.input.setKey('KeyD', false);
      expect([alone.at.x > 0, alone.gems.length]).toEqual([true, 12]);
      alone.finish(engine.context, false);
      engine.step(30);
      await space(engine);
      expect(engine.game, 'a press as it ends never skips the result').toBe(alone);
      engine.step(40);
      await space(engine);
      expect([engine.game === alone, (engine.game as Rush).over, (engine.game as Rush).gems.length]).toEqual([false, null, 12]);
    } finally {
      engine.dispose();
    }
  });

  it('the word check finds a menu row wrapped mid-word, drawn with no shadow as Beacon Yard’s rows are, and leaves what a prompt and a legend draw alone', async () => {
    /** A menu row drawn as Beacon Yard draws its rows (no shadow), cut in two at `cut`, over a prompt and a legend. */
    const menu = (cut: number): bundle.Game => ({
      name: 'Menu rows',
      controls: { confirm: { key: 'Enter', pad: 'PadA', touch: 'TouchTap' }, back: { key: 'Escape', pad: 'PadB', touch: 'TouchSwipe' } },
      setup() {},
      cameraTarget: () => new THREE.Vector3(),
      update(ctx) {
        const { hud } = ctx;
        hud.clear();
        const row = 'RESUME';
        hud.text(10, 10, row.slice(0, cut), { shadow: false });
        if (cut < row.length) hud.text(10, 20, row.slice(cut), { shadow: false });
        hud.prompt(10, 40, 'confirm', 'PICK'); // words the game's code doesn't have: a prompt's and a legend's are theirs
        hud.legend(10, 60, [['confirm', 'PICK'], ['back', 'CLOSE']]);
      },
    });
    const amissFor = async (cut: number) => {
      const engine = await bundle.Engine.headless(menu(cut));
      try {
        engine.input.noteDevice('pad');
        return textsAmiss(engine, 'a menu', 'RESUME');
      } finally {
        engine.dispose();
      }
    };
    expect(await amissFor(6), 'the whole row, a prompt and a legend: nothing amiss').toEqual([]);
    expect(await amissFor(3), 'the row wrapped mid-word').toEqual(['a menu at 480x270: RES (RES: a piece of a word)', 'a menu at 480x270: UME (UME: a piece of a word)']);
  });

  it('every text its games draw is inside the HUD, clear of the others and in whole words, in every state, on a phone held either way (at the density their pages ask for), a tall narrow window and a TV', async () => {
    const amiss: string[] = [];
    const code = (name: string) => blocks.find((b) => b.name === name)!.code;
    const shapes = [[390, 844], [844, 390], [360, 1000], [1920, 1080]] as const;
    const { createGame: yard } = await load('beacon-yard');
    type Yard = bundle.Game & { at: THREE.Vector3; menu: unknown; beacons: { mesh: THREE.Mesh }[]; light(ctx: bundle.GameContext, beacon: unknown): void };
    for (const [width, height] of shapes) {
      const game = (yard as () => Yard)();
      const engine = await bundle.Engine.headless(game, { touch: true, touchDensity: 2, viewport: { width, height, dpr: 1 } });
      try {
        for (const device of ['touch', 'keyboard', 'pad'] as const) {
          engine.input.noteDevice(device);
          game.at.set(0, 0.6, 0);
          amiss.push(...textsAmiss(engine, `Beacon Yard on ${device}`, code('beacon-yard')));
          game.at.copy(game.beacons[0]!.mesh.position);
          engine.step(1);
          amiss.push(...textsAmiss(engine, `Beacon Yard by a beacon on ${device}`, code('beacon-yard')));
          engine.input.setKey('Escape', true);
          engine.step(1);
          engine.input.setKey('Escape', false);
          expect(game.menu, 'Esc opens the menu').not.toBeNull();
          amiss.push(...textsAmiss(engine, `Beacon Yard's menu on ${device}`, code('beacon-yard')));
          engine.input.setKey('Escape', true);
          engine.step(1);
          engine.input.setKey('Escape', false);
          engine.step(1);
          expect(game.menu, 'Esc closes it').toBeNull();
        }
        for (const beacon of game.beacons) game.light(engine.context, beacon);
        for (const device of ['touch', 'keyboard', 'pad'] as const) {
          engine.input.noteDevice(device);
          amiss.push(...textsAmiss(engine, `Beacon Yard all lit on ${device}`, code('beacon-yard')));
        }
      } finally {
        engine.dispose();
      }
    }
    const { createGame: rush } = await load('gem-rush');
    type Rush = bundle.Game & { countdown: number; finish(ctx: bundle.GameContext, won: boolean): void };
    for (const [width, height] of shapes) {
      for (const state of ['playing', 'counting down', 'cleared', 'failed', 'play again'] as const) {
        const game = (rush as (session: null) => Rush)(null);
        const engine = await bundle.Engine.headless(game, { touch: true, touchDensity: 2, viewport: { width, height, dpr: 1 } });
        try {
          if (state === 'counting down') game.countdown = 2.5;
          if (state === 'cleared' || state === 'failed' || state === 'play again') game.finish(engine.context, state === 'cleared');
          if (state === 'play again') engine.step(70);
          amiss.push(...textsAmiss(engine, `Gem Rush ${state}`, code('gem-rush')));
        } finally {
          engine.dispose();
        }
      }
    }
    expect(amiss).toEqual([]);
  });

  it('what a player needs is in view at every window shape: Gem Rush’s whole arena (every gem, the runner in each corner it reaches), every beacon from Beacon Yard’s start', async () => {
    // (360x1000: a window so tall that Gem Rush's 19 m fit only below the camera's minimum zoom, 0.35)
    const shapes = [[390, 844], [344, 882], [360, 1000], [1024, 1366], [844, 390], [1920, 1080], [2100, 900], [1280, 720]] as const;
    /** What of `things` (a name, a point and a radius) the camera leaves out of the picture. */
    const outOfView = (engine: bundle.Engine, what: string, things: [string, THREE.Vector3, number][]) => {
      const cam = engine.camera.camera;
      const p = new THREE.Vector3();
      const edge = new THREE.Vector3();
      return things
        .filter(([, at, r]) => [-r, r].some((dx) => [-r, r].some((dz) => (p.copy(at).add(edge.set(dx, 0, dz)).project(cam), Math.abs(p.x) > 1 || Math.abs(p.y) > 1))))
        .map(([name, at]) => `${what} at ${engine.hud.width}x${engine.hud.height}: ${name} (${at.x.toFixed(1)}, ${at.z.toFixed(1)})`);
    };
    const { createGame: rush } = await load('gem-rush');
    type Rush = bundle.Game & { gems: THREE.Mesh[]; runner: THREE.Mesh };
    const { createGame: yard } = await load('beacon-yard');
    type Yard = bundle.Game & { beacons: { mesh: THREE.Mesh }[] };
    const out: string[] = [];
    for (const [width, height] of shapes) {
      const options = { touch: true, touchDensity: 2, viewport: { width, height, dpr: 1 } };
      const g = (rush as (session: null) => Rush)(null);
      const engine = await bundle.Engine.headless(g, { ...options, camera: cameraOf('gem-rush') });
      try {
        engine.step(2);
        out.push(...outOfView(engine, 'Gem Rush', g.gems.map((gem, i) => [`gem ${i}`, gem.position, 0.35])));
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          engine.input.setKey(x < 0 ? 'KeyA' : 'KeyD', true);
          engine.input.setKey(z < 0 ? 'KeyW' : 'KeyS', true);
          engine.step(240); // into the corner
          for (const key of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) engine.input.setKey(key, false);
          out.push(...outOfView(engine, 'Gem Rush', [['the runner', g.runner.position, 0.3]]));
        }
      } finally {
        engine.dispose();
      }
      const y = (yard as () => Yard)();
      const yardEngine = await bundle.Engine.headless(y, { ...options, camera: cameraOf('beacon-yard') });
      try {
        yardEngine.step(2);
        out.push(...outOfView(yardEngine, 'Beacon Yard’s start', y.beacons.map((b, i) => [`beacon ${i}`, b.mesh.position, 0.4])));
      } finally {
        yardEngine.dispose();
      }
    }
    expect(out).toEqual([]);
  });

  it('the player zooms both games with the wheel and + / -, and the zoom stays; a phone held upright comes no closer than the game starts', async () => {
    const out: string[] = [];
    for (const name of ['beacon-yard', 'gem-rush']) {
      const { createGame } = await load(name);
      for (const [width, height] of [[1280, 720], [390, 844]] as const) {
        const engine = await bundle.Engine.headless((createGame as (session?: null) => bundle.Game)(null), { camera: cameraOf(name), touch: true, touchDensity: 2, viewport: { width, height, dpr: 1 } });
        try {
          out.push(...playerZooms(engine, `${name} at ${width}x${height}`, height > width));
        } finally {
          engine.dispose();
        }
      }
    }
    expect(out).toEqual([]);
  });

  it('Gem Rush’s page, as the kit ships it, carries the session client and a whole catalogue head: 52in1’s checker asks only for what each game fills in (hub:model); it names its moments and holds its lines', async () => {
    const head = guideHeads(guide).get('gem-rush')!;
    expect(head, 'an `html gem-rush` fence').toBeTruthy();
    const tags = [...head.matchAll(/^<meta name="([\w:-]+)" content="([^"]*)">$/gm)].map((m) => [m[1]!, m[2]!] as const);
    // every line is a tag that reads: the title, the icon, the meta tags, the game-lines block last
    const lines = head.trim().split('\n');
    expect([lines[0]!.startsWith('<title>'), lines[3]!.startsWith('<link rel="icon"'), tags.length, lines.at(-1)!.startsWith('<script type="application/json" id="game-lines">')]).toEqual([true, true, lines.length - 3, true]);
    const all = (name: string) => tags.filter(([k]) => k === name).map(([, v]) => v);
    const one = (name: string) => all(name)[0] ?? '';
    // the page the kit ships (scripts/bundle.mjs: a folder, the engine in pixel-engine.js reads
    // window.AIHubSettings): the session client byte for byte its first script, after <meta charset>, then the tags
    const page = examplePage({ title: 'Gem Rush', script: 'gem-rush.js', head, client: read('scripts/hub/session.js') });
    expect(page.indexOf(`<script>${read('scripts/hub/session.js')}</script>`), 'the client, unmodified, right after <meta charset>').toBe(page.indexOf('<meta charset="utf-8" />') + '<meta charset="utf-8" />'.length + 5);
    const { problems, fields } = checkPage(page, { folder: { files: new Set(['gem-rush.html', 'gem-rush.js', '../pixel-engine.js']) } });
    expect([fields.session, fields.sessionMode, fields.sessionPlayers, typeof fields.client]).toEqual(['1', 'parallel', '1-4', 'string']);
    // the whole head: the one problem left is the model, which each game fills in (its TBD); the
    // name and tagline split at the em dash; the checklist names every tag the head needs
    expect(problems.map((p) => `${p.level}: ${p.text}`)).toEqual(['error: no hub:model: the model that wrote the game, as its maker names it']);
    expect([fields.name, fields.tagline, fields.type, fields.genre]).toEqual(['Gem Rush', 'Grab every gem in time', 'Game', 'Action']);
    const checklist = guide.slice(guide.indexOf('**The head says so**'), guide.indexOf('**Storage of its own.**'));
    const named = ['<title>', 'description', 'theme-color', 'data:image', 'game-lines', ...new Set(tags.map(([k]) => k).filter((k) => !k.startsWith('hub:session-') && k !== 'hub:moment')), 'hub:moment'];
    expect(named.filter((k) => !checklist.includes(`\`${k}`))).toEqual([]);
    // its game-lines block is the lines the game draws its words from
    const block = /<script type="application\/json" id="game-lines">(.*)<\/script>/.exec(head)![1]!;
    const { LINES } = await load('gem-rush');
    expect(JSON.parse(block)).toEqual(LINES);
    // the Couch draws each control's keys as keycaps; a pad and touch play it all
    expect(one('hub:controls').split(';').filter((c) => !opensWithKeys(c.trim()))).toEqual([]);
    expect([one('hub:tags').split(', ').filter((t) => t === 'gamepad' || t === 'touch'), /\bgamepad\b/.test(one('hub:controls'))]).toEqual([['gamepad', 'touch'], true]);
    expect(readMultiplayer(one('hub:multiplayer')).modes.map((m) => m.where)).toEqual(['parallel', 'moments']);
    const { moments } = readMoments(all('hub:moment'));
    const { MOMENTS } = await load('gem-rush');
    expect(Object.fromEntries(moments.map((m) => [m.id, m.seconds]))).toEqual(Object.fromEntries(Object.entries(MOMENTS as Record<string, { seconds: number }>).map(([id, m]) => [id, m.seconds])));
    // what the game joins with, read from its page's tags as the page does
    expect(bundle.headSession((name) => readHead(page).one(name) ?? null)).toEqual({ modes: ['parallel', 'moments'], seats: [1, 4] });
  });

  it('stays within its token budget (~4 characters a token)', () => {
    expect(guide.length / 4).toBeLessThan(6000);
  });
});

/**
 * What goes wrong when the player zooms `engine`'s game (`what` names it): six wheel notches out,
 * Minus held (to the camera's `minZoom`), three notches in, Plus held, each still there half a
 * second later. Coming back in, it stops where the game started when the window held the camera out
 * (`heldOut`: a phone held upright, the camera's `minWidth` across), and goes on in otherwise.
 * (src/guide-recipes.test.ts zooms the kit's other pages the same way.)
 */
function playerZooms(engine: bundle.Engine, what: string, heldOut: boolean): string[] {
  const rig = () => engine.camera;
  const clamp = (z: number) => Math.min(rig().maxZoom, Math.max(rig().minZoom, z));
  const problems: string[] = [];
  engine.step(2);
  const start = rig().zoom;
  let was = start;
  const after = (did: string, act: () => void, ok: (z: number, was: number) => boolean) => {
    act();
    const z = rig().zoom;
    engine.step(30);
    if (!ok(z, was) || rig().zoom !== z) problems.push(`${what}: ${did}: ${was.toFixed(3)} → ${z.toFixed(3)}, ${rig().zoom.toFixed(3)} half a second later`);
    was = rig().zoom;
  };
  const hold = (key: string, frames: number) => () => {
    engine.input.setKey(key, true);
    engine.step(frames);
    engine.input.setKey(key, false);
  };
  const wheel = (notches: number) => () => {
    engine.input.addPointer(0, 0, notches);
    engine.step(1);
  };
  after('six wheel notches out', wheel(6), (z, from) => z < from && Math.abs(z - clamp(from / 1.12 ** 6)) < 1e-9);
  after('Minus held', hold('Minus', 54), (z, from) => z < from || z === rig().minZoom);
  after('three wheel notches in', wheel(-3), (z, from) => z > from && Math.abs(z - Math.min(start, clamp(from * 1.12 ** 3))) < 1e-9);
  after('Plus held', hold('Equal', 6), (z, from) => (from < start ? z > from : z === from));
  after('Plus held long', hold('Equal', 300), (z, from) => (heldOut ? z === start : z > from));
  return problems;
}
