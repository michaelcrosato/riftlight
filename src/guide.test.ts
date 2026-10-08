// docs/GUIDE.md is the engine's manual for agents outside this repo (it ships in the kit,
// scripts/bundle.mjs). These checks keep it true to the code: its games import only what
// pixel-engine.js exports, the lists it gives (palette, looks, filters, sounds, particles,
// cameras, URL flags) are the engine's, it stays within its token budget, and CHANGELOG.md
// has a section for this version. The bundle e2e suite then plays its games.
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { guideBlocks } from '../scripts/bundle/guide.mjs';
import * as bundle from './bundle';
import { CAMERA_PRESETS, FILTER_IDS, LOOK_PRESETS, PALETTE, PARTICLES, SFX, optionsFromUrl } from './engine';

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
  it('has a quick start and uniquely named recipes', () => {
    const names = blocks.map((b) => b.name);
    expect(names[0]).toBe('quickstart');
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(new Set(names).size).toBe(names.length);
    // the guide names its recipe pages by these names
    for (const [, page] of guide.matchAll(/examples\/([a-z0-9-]+)\.html/g)) expect(names, page).toContain(page);
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
      expect(code, name).toMatch(/await Engine\.start\(new \w+\(\), withUrlOptions\(\{ container: document\.getElementById\('app'\), .*\}\)\);\n$/);
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
