// docs/GUIDE.md is the engine's manual for agents outside this repo (it ships in the kit,
// scripts/bundle.mjs). These checks keep it true to the code: its games import only what
// pixel-engine.js exports, the lists it gives (palette, looks, filters, sounds, particles,
// cameras, URL flags) are the engine's, the starter's legend fits the HUD at every window shape, it
// stays within its token budget, and CHANGELOG.md has a section for this version. The bundle e2e
// suite then plays its games.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { guideBlocks, startsEngine } from '../scripts/bundle/guide.mjs';
import * as bundle from './bundle';
import { CAMERA_PRESETS, FILTER_IDS, LOOK_PRESETS, PALETTE, PARTICLES, SFX, optionsFromUrl } from './engine';
import { nodeAssets } from './engine/node';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guide = read('docs/GUIDE.md');
const blocks = guideBlocks(guide);
/** The backticked words of the sentence that follows `marker` (up to the next full stop). */
const listAfter = (marker: string) => {
  const start = guide.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const rest = guide.slice(start + marker.length);
  const sentence = rest.slice(0, rest.search(/\.\s/));
  return [...sentence.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1]!.split(/\s+/));
};
/** The text of a `### title` section. */
const section = (title: string) => guide.split(/^### /m).find((s) => s.startsWith(`${title}\n`)) ?? '';

describe('docs/GUIDE.md', () => {
  it('has a quick start and uniquely named recipes, and names every game page of the kit', () => {
    const names = blocks.map((b) => b.name);
    expect(names[0]).toBe('quickstart');
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    // its recipes and the other guides' games (RECIPES.md, CONTROLS.md, ASSETS.md), by their pages' names
    const pages = ['docs/GUIDE.md', 'docs/GUIDE-RECIPES.md', 'docs/GUIDE-CONTROLS.md', 'docs/GUIDE-ASSETS.md']
      .flatMap((path) => guideBlocks(read(path)))
      .filter((b) => b.name !== 'quickstart' && startsEngine(b.code))
      .map((b) => b.name);
    expect([...new Set([...guide.matchAll(/examples\/([a-z0-9-]+)\.html/g)].map((m) => m[1]!))].sort()).toEqual(pages.sort());
  });

  it('every game imports only names pixel-engine.js exports, and starts the engine', () => {
    for (const { name, code } of blocks) {
      const imports = [...code.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)];
      expect(imports.length, name).toBe(1);
      expect(imports[0]![2], name).toBe('./pixel-engine.js');
      const imported = imports[0]![1]!.split(',').map((s) => s.trim()).filter(Boolean);
      expect(imported.filter((n) => !(n in bundle)), name).toEqual([]);
      // what it takes from THREE is in three.js; nothing imported goes unused
      for (const [, list] of code.matchAll(/const \{([^}]*)\} = THREE;/g)) {
        const names = list!.split(',').map((s) => s.trim());
        expect(names.filter((n) => !(n in THREE)), name).toEqual([]);
        for (const n of names) expect(code.split(n).length - 1, `${name}: THREE.${n} used`).toBeGreaterThan(1);
      }
      for (const n of imported) expect(code.split(n).length - 1, `${name}: ${n} used`).toBeGreaterThan(1);
      // the starter also exports createGame() and starts only where there is a page (check.mjs --headless)
      const start = name === 'quickstart' ? /\nexport const createGame = \(\) => new \w+\(\);\n\nif \(typeof document !== 'undefined'\) await Engine\.start\(createGame\(\), / : /await Engine\.start\(new \w+\(\), /;
      expect(code, name).toMatch(new RegExp(`${start.source}withUrlOptions\\(\\{ container: document\\.getElementById\\('app'\\), .*\\}\\)\\);\\n$`));
      // scripts/bundle.mjs gives a block a page only when it starts the engine: every one here does
      expect(startsEngine(code), `${name} is a game (a page in the kit)`).toBe(true);
    }
  });

  it('lists exactly the engine names', () => {
    expect(listAfter('The 16 names:')).toEqual(Object.keys(PALETTE));
    expect(listAfter('Named looks (`LOOK_PRESETS`):')).toEqual(Object.keys(LOOK_PRESETS));
    expect(listAfter('Filters (`FILTERS`, each with parameters and presets, see API.md):')).toEqual([...FILTER_IDS]);
    const sfx = guide.match(/ctx\.audio\.play\('coin'\);\s+\/\/ built-in: (.*)/)![1]!.split(' ');
    expect(sfx).toEqual(Object.keys(SFX));
    const particles = guide.match(/ctx\.particles\.burst\('dust', at\);\s+\/\/ built-in: (.*)/)![1]!.split(' ');
    expect(particles).toEqual(Object.keys(PARTICLES));
    const cameras = [...section('Camera').matchAll(/^\| `(\w+)`(?:, `(\w+)`)? \|/gm)].flatMap((m) => m.slice(1).filter(Boolean));
    expect(cameras).toEqual([...CAMERA_PRESETS]);
    // the built-in models are public/assets' GLBs (scripts/bundle.mjs)
    const models = readdirSync(new URL('../public/assets', import.meta.url)).filter((f) => f.endsWith('.glb'));
    expect(listAfter('three built-in models (').filter((m) => m.endsWith('.glb')).sort()).toEqual(models.map((f) => `assets/${f}`).sort());
  });

  it('every URL flag it gives does something', () => {
    const flags = listAfter('URL flags (with `withUrlOptions` in `Engine.start`):').filter((f) => f.startsWith('?'));
    expect(flags.length).toBeGreaterThanOrEqual(10);
    for (const flag of flags) expect(Object.keys(optionsFromUrl(flag)), flag).not.toEqual([]);
  });

  it('the starter’s legend fits the HUD at every window shape (a phone held either way too, as a touch page at its density), on the keyboard and a pad', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guide-quickstart-'));
    try {
      // the kit's game.js, its './pixel-engine.js' this repo's src/bundle.ts
      const code = blocks[0]!.code;
      const file = join(tmp, 'game.mjs');
      writeFileSync(file, code.replaceAll(`from './pixel-engine.js'`, `from ${JSON.stringify(fileURLToPath(new URL('./bundle.ts', import.meta.url)))}`));
      const { createGame } = (await import(/* @vite-ignore */ file)) as { createGame: () => bundle.Game };
      // a phone's page has touch controls: the art at the density the page asks for (`touchDensity`),
      // two CSS pixels an art pixel at least, so COINS 0/4 reads on a phone held sideways too
      const touchDensity = Number(/\btouchDensity: (\d+)/.exec(code)?.[1] ?? 0);
      const seen: string[] = [];
      for (const [width, height, touch] of [[960, 540, false], [390, 844, false], [844, 390, false], [2100, 900, false], [390, 844, true], [844, 390, true]] as const) {
        const engine = await bundle.Engine.headless(createGame(), { assets: nodeAssets(), viewport: { width, height, dpr: 1 }, touch, touchDensity });
        try {
          const shape = `${width}x${height}${touch ? ' touch' : ''}`;
          if (touch) seen.push(`${shape}: ${engine.renderer.framing.scale >= 2 ? 'fits' : `${engine.renderer.framing.scale} CSS px an art pixel`}`);
          for (const device of ['keyboard', 'pad'] as const) {
            const legend = vi.spyOn(engine.hud, 'legend');
            engine.input.noteDevice(device);
            engine.step(2);
            const [x, , items] = legend.mock.calls.at(-1)!;
            const right = x + (legend.mock.results.at(-1)!.value as number);
            legend.mockRestore();
            // drawn whole inside the HUD's 6-pixel margin, with WALK and JUMP at least
            seen.push(`${shape} ${device}: ${right <= engine.hud.width - 6 && items.length >= 2 ? 'fits' : `${items.length} items to ${right} of ${engine.hud.width}`}`);
          }
        } finally {
          engine.dispose();
        }
      }
      expect(seen.filter((s) => !s.endsWith(': fits'))).toEqual([]);
      expect(seen.length).toBe(14);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('stays within its token budget (~4 characters a token)', () => {
    expect(guide.length / 4).toBeLessThan(15000);
  });
});

describe('versions', () => {
  it('CHANGELOG.md has a section for package.json version', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string };
    expect(read('CHANGELOG.md')).toMatch(new RegExp(`^## ${version.replaceAll('.', '\\.')}$`, 'm'));
    expect(bundle.ENGINE_VERSION).toBe(version);
  });
});
