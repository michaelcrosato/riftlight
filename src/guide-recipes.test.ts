// docs/GUIDE-RECIPES.md is the kit's RECIPES.md (scripts/bundle.mjs): more whole games, beyond
// GUIDE.md's own. These checks keep it true to the code: its games import only what
// pixel-engine.js exports and use all of it, the names its prose gives are real exports, it stays
// within its token budget. Then every recipe of the kit (GUIDE.md's Cliff Run, this guide's games,
// ASSETS.md's Market Corner; CONTROLS.md's own games are src/guide-controls.test.ts's) meets
// CONTROLS.md's checklist, played headless: a controls table, touch buttons of its own,
// `touchDensity: 2` and the settings on a pad; every text it draws inside the HUD, clear of the
// others and in whole words, in every state on every device, on a phone held either way, a tall
// narrow window and a TV, with a legend for the keyboard and the pad; what a player needs in view at
// every window shape and under no text; the player's wheel and + / - zoom it, and the zoom stays.
// The bundle e2e suite then plays their pages on a phone (real taps, the HUD clear of the controls)
// and on a TV with a pad.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import ts from 'typescript';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { guideBlocks, startsEngine } from '../scripts/bundle/guide.mjs';
import * as bundle from './bundle';
import { nodeAssets } from './engine/node';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guide = read('docs/GUIDE-RECIPES.md');
const blocks = guideBlocks(guide);
/** The prose: the guide without its fenced code. */
const prose = guide.replace(/^```[\s\S]*?^```$/gm, '');
/** The kit's recipes: every game block but the starter and CONTROLS.md's (guide-controls.test.ts plays those). */
const RECIPES = ['docs/GUIDE.md', 'docs/GUIDE-RECIPES.md', 'docs/GUIDE-ASSETS.md'].flatMap((path) => guideBlocks(read(path)).map((b) => ({ ...b, path })));
const recipe = (name: string) => RECIPES.find((b) => b.name === name)!;
const games = RECIPES.filter((b) => b.name !== 'quickstart' && startsEngine(b.code));

const tmp = mkdtempSync(join(tmpdir(), 'guide-recipes-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
/** The page's last line, `await Engine.start(new X(), withUrlOptions({ container: …, options }))`. */
const START = /^await Engine\.start\(new (\w+)\(\), withUrlOptions\(\{ container: document\.getElementById\('app'\), (.*)\}\)\);$/m;
/**
 * A recipe as a module Node imports: its './pixel-engine.js' this repo's src/bundle.ts, a module
 * of its guide beside it, and its start line turned into `createGame()` and the options it starts
 * with (`startOptions`), so `Engine.headless` plays it as its page would.
 */
async function load(name: string): Promise<{ createGame: () => bundle.Game; startOptions: bundle.EngineOptions }> {
  const write = (b: { name: string; code: string }) => {
    let code = b.code.replaceAll(`from './pixel-engine.js'`, `from ${JSON.stringify(fileURLToPath(new URL('./bundle.ts', import.meta.url)))}`);
    for (const m of RECIPES) code = code.replaceAll(`from './${m.name}.js'`, `from './${m.name}.mjs'`);
    writeFileSync(join(tmp, `${b.name}.mjs`), code.replace(START, 'export const createGame = () => new $1();\nexport const startOptions = { $2};'));
  };
  const b = recipe(name);
  expect(b.code, `${name} ends by starting the engine`).toMatch(START);
  for (const m of RECIPES) if (b.code.includes(`'./${m.name}.js'`)) write(m);
  write(b);
  return (await import(/* @vite-ignore */ join(tmp, `${name}.mjs`))) as Awaited<ReturnType<typeof load>>;
}

/** The texts the next frame draws (`what` says the state), each with the box `hud.text` places it in. */
function textBoxes(engine: bundle.Engine): { s: string; left: number; top: number; right: number; bottom: number; caption: boolean }[] {
  const { hud } = engine;
  const text = vi.spyOn(hud, 'text');
  try {
    engine.step(1);
    return text.mock.calls.map(([x, y, s, o = {}]) => {
      const { width, height } = hud.measure(s, Math.max(1, Math.round(o.scale ?? 1)));
      const [left, top] = bundle.hudPlace(x, y, width, height, o.anchor ?? 'top-left', { width: hud.width, height: hud.height });
      return { s, left, top, right: left + width, bottom: top + height, caption: o.shadow === false }; // a glyph's caption: no shadow
    });
  } finally {
    text.mockRestore();
  }
}

/**
 * What is amiss with the texts the next frame draws (`what` says the state): one reaching outside
 * the HUD, one over another, or a piece of a word wrapped apart (a word neither the game's `code`
 * nor the names of its controls on the device in use have; a glyph's caption aside).
 */
function textsAmiss(engine: bundle.Engine, what: string, code: string): string[] {
  const words = (s: string) => s.toUpperCase().split(/[^\p{L}]+/u).filter(Boolean);
  const known = new Set([...words(code), ...Object.keys(engine.game.controls ?? {}).flatMap((a) => words(engine.controls.label(a)))]);
  const { width, height } = engine.hud;
  const at = `${what} at ${width}x${height}`;
  const boxes = textBoxes(engine);
  return [
    ...boxes.filter((b) => b.left < 0 || b.top < 0 || b.right > width || b.bottom > height).map((b) => `${at}: ${b.s}`),
    ...boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).map((b) => `${at}: ${a.s} over ${b.s}`)),
    ...boxes.filter((b) => !b.caption).flatMap((b) => words(b.s).filter((w) => !known.has(w)).map((w) => `${at}: ${b.s} (${w}: a piece of a word)`)),
  ];
}

/** The states each recipe's player reaches: a name and what puts the game there. */
type Recipe = bundle.Game & Record<string, unknown>;
const STATES: Record<string, [string, (game: Recipe, ctx: bundle.GameContext) => void][]> = {
  'side-scroller': [
    ['playing', () => {}],
    ['clear', (g, ctx) => ((g.stomps = 99), (g.clear as (ctx: bundle.GameContext) => void)(ctx))],
  ],
  'top-down': [
    ['playing', () => {}],
    ['open', (g) => (g.pads as { lit: boolean }[]).forEach((p) => (p.lit = true))],
    ['escaped', (g, ctx) => (g.escape as (ctx: bundle.GameContext) => void)(ctx)],
  ],
  looks: [0, 1, 2, 3, 4, 5].map((i) => [`look ${i + 1}`, (g, ctx) => (g.pick as (ctx: bundle.GameContext, i: number) => void)(ctx, i)]),
  market: [['playing', () => {}]],
};

describe('docs/GUIDE-RECIPES.md', () => {
  it('has games named apart from the other guides, the pages it names are its games, and GUIDE.md names each', () => {
    const names = blocks.map((b) => b.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    const others = ['docs/GUIDE.md', 'docs/GUIDE-CONTROLS.md', 'docs/GUIDE-ASSETS.md'].flatMap((g) => guideBlocks(read(g))).map((b) => b.name);
    expect(names.filter((n) => others.includes(n))).toEqual([]);
    for (const [, page] of guide.matchAll(/examples\/([a-z0-9-]+)\.html/g)) expect(names, page).toContain(page);
    for (const name of names) {
      expect(guide, `${name} has a page named in the prose`).toContain(`examples/${name}.html`);
      expect(read('docs/GUIDE.md'), `GUIDE.md's recipes name ${name}`).toMatch(new RegExp(`^\\| \`examples/${name}\\.html\` \\|.*\`RECIPES\\.md\``, 'm'));
    }
  });

  it('every game parses, imports only what pixel-engine.js exports and uses all of it, and starts the engine', () => {
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
      expect(code, name).toMatch(START);
      expect(startsEngine(code), `${name} is a game (a page in the kit)`).toBe(true);
    }
  });

  it('the names its prose gives are real exports', () => {
    const TYPES = ['Game', 'MoveInput']; // type-only exports (API.md has them)
    const named = prose
      .split('`')
      .filter((_, i) => i % 2 === 1)
      .map((s) => s.match(/^(?:new )?([A-Za-z_$][\w$]*)(.*)/s))
      .filter((m): m is RegExpMatchArray => !!m && !/^\.(md|m?js|html|png)\b/.test(m[2]!) && (/^[A-Z]/.test(m[1]!) || m[2]!.startsWith('(')))
      .map((m) => m[1]!);
    expect(named.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(named)].filter((n) => !(n in bundle) && !TYPES.includes(n))).toEqual([]);
  });

  it('stays within its token budget (~4 characters a token)', () => {
    expect(guide.length / 4).toBeLessThan(5000);
  });
});

describe("the kit's recipes meet CONTROLS.md", () => {
  it('each has a controls table, touch buttons of its own, a phone’s density and the settings on a pad', () => {
    expect(games.map((g) => g.name).sort()).toEqual(Object.keys(STATES).sort());
    for (const { name, code } of games) {
      const start = START.exec(code)?.[2] ?? '';
      expect(code, name).toMatch(/^ {2}controls = \{/m);
      expect(code, `${name}: a legend of the device's controls`).toMatch(/hud\.legend\(/);
      expect([/\btouchButtons: /.test(start), /\btouchDensity: 2\b/.test(start), /\bsettings: \{ padButton: true \}/.test(start)], name).toEqual([true, true, true]);
    }
  });

  it('every text each draws is inside the HUD, clear of the others and in whole words, in every state, on every device, on a phone held either way, a tall window and a TV; on a TV the keyboard and a pad get a legend', async () => {
    const amiss: string[] = [];
    const legends: string[] = [];
    for (const { name, code } of games) {
      const { createGame, startOptions } = await load(name);
      for (const [width, height] of [[390, 844], [844, 390], [360, 1000], [1920, 1080]] as const) {
        for (const [state, enter] of STATES[name]!) {
          const game = createGame() as Recipe;
          const engine = await bundle.Engine.headless(game, { ...startOptions, assets: nodeAssets(), touch: true, viewport: { width, height, dpr: 1 } });
          try {
            engine.step(2);
            enter(game, engine.context);
            for (const device of ['touch', 'keyboard', 'pad'] as const) {
              engine.input.noteDevice(device);
              const legend = vi.spyOn(engine.hud, 'legend');
              amiss.push(...textsAmiss(engine, `${name} ${state} on ${device}`, code));
              if (device !== 'touch' && width === 1920 && legend.mock.calls.length === 0) legends.push(`${name} ${state} on ${device} at ${width}x${height}`);
              legend.mockRestore();
            }
            expect(engine.errors, name).toEqual([]);
          } finally {
            engine.dispose();
          }
        }
      }
    }
    expect(amiss).toEqual([]);
    expect(legends, 'no legend').toEqual([]);
  });

  it('what a player needs is in view at every window shape, clear of the HUD’s texts: the lane around Cliff Run’s hero, Lantern Night’s crates and pads, Look Lab’s coins and crate, every model of Market Corner', async () => {
    const shapes = [[390, 844], [344, 882], [360, 1000], [1024, 1366], [844, 390], [1920, 1080], [2100, 900], [1280, 720]] as const;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    /** What a player needs, a name, a point and a radius each, read from the game once it runs. */
    const needs: Record<string, (g: Recipe) => [string, THREE.Vector3, number][]> = {
      'side-scroller': (g) => {
        const at = (g.model as THREE.Object3D).position;
        return [['the hero', at.clone(), 0.5], ['4 m ahead', at.clone().add(v(4, 0, 0)), 0.5], ['4 m behind', at.clone().add(v(-4, 0, 0)), 0.5]];
      },
      'top-down': (g) => [
        ['the hero', (g.model as THREE.Object3D).position.clone(), 0.5],
        ...(g.crates as { translation(): THREE.Vector3Like }[]).map((b, i): [string, THREE.Vector3, number] => [`crate ${i}`, v(b.translation().x, b.translation().y, b.translation().z), 0.5]),
        ...(g.pads as { x: number; z: number }[]).map((p, i): [string, THREE.Vector3, number] => [`pad ${i}`, v(p.x, 0, p.z), 0.6]),
      ],
      looks: (g) => [['the hero', (g.model as THREE.Object3D).position.clone(), 0.5], ...(g.coins as THREE.Object3D[]).map((c, i): [string, THREE.Vector3, number] => [`coin ${i}`, c.position.clone(), 0.4]), ['the crate', v(3, 0.5, 2), 0.5]],
      market: (g) => (g.placed as { object: THREE.Object3D }[]).map((m, i): [string, THREE.Vector3, number] => [`model ${i}`, m.object.position.clone(), 0.8]),
    };
    const out: string[] = [];
    for (const { name } of games) {
      const { createGame, startOptions } = await load(name);
      for (const [width, height] of shapes) {
        const game = createGame() as Recipe;
        const engine = await bundle.Engine.headless(game, { ...startOptions, assets: nodeAssets(), touch: true, viewport: { width, height, dpr: 1 } });
        try {
          engine.step(60); // the camera settles on the player
          for (const device of ['touch', 'keyboard', 'pad'] as const) {
            engine.input.noteDevice(device);
            const texts = textBoxes(engine);
            const cam = engine.camera.camera;
            const p = new THREE.Vector3();
            for (const [what, at, r] of needs[name]!(game)) {
              const corners = [-r, r].flatMap((dx) => [-r, r].map((dz) => p.copy(at).add(v(dx, 0, dz)).project(cam).clone()));
              if (corners.some((c) => Math.abs(c.x) > 1 || Math.abs(c.y) > 1)) out.push(`${name} at ${width}x${height}: ${what} (${at.x.toFixed(1)}, ${at.z.toFixed(1)})`);
              // where it is on the HUD, in art pixels: under none of its texts
              const xs = corners.map((c) => ((c.x + 1) / 2) * engine.hud.width);
              const ys = corners.map((c) => ((1 - c.y) / 2) * engine.hud.height);
              const under = texts.find((t) => t.left < Math.max(...xs) && Math.min(...xs) < t.right && t.top < Math.max(...ys) && Math.min(...ys) < t.bottom);
              if (under) out.push(`${name} at ${width}x${height} on ${device}: ${what} under ${under.s}`);
            }
          }
        } finally {
          engine.dispose();
        }
      }
    }
    expect(out).toEqual([]);
  });

  it('the player zooms each with the wheel and + / -, and the zoom stays; a phone held upright comes no closer than the game starts', async () => {
    const out: string[] = [];
    for (const { name } of games) {
      const { createGame, startOptions } = await load(name);
      for (const [width, height] of [[1280, 720], [390, 844]] as const) {
        const engine = await bundle.Engine.headless(createGame(), { ...startOptions, assets: nodeAssets(), touch: true, viewport: { width, height, dpr: 1 } });
        try {
          out.push(...playerZooms(engine, `${name} at ${width}x${height}`, height > width));
        } finally {
          engine.dispose();
        }
      }
    }
    expect(out).toEqual([]);
  });
});

/**
 * What goes wrong when the player zooms `engine`'s game (`what` names it): six wheel notches out,
 * Minus held (to the camera's `minZoom`), three notches in, Plus held, each still there half a
 * second later. Coming back in, it stops where the game started when the window held the camera out
 * (`heldOut`: a phone held upright, the camera's `minWidth` across), and goes on in otherwise.
 * (src/guide-controls.test.ts zooms CONTROLS.md's games the same way.)
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
