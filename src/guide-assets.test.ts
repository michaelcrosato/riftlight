// docs/GUIDE-ASSETS.md is the kit's ASSETS.md (scripts/bundle.mjs): models and textures for agents
// outside this repo. These checks keep it true to the code: every block parses, imports only
// what pixel-engine.js exports (a game also what its models module exports) and uses what it
// imports; the game's own model is clean and composes the library; the names and lists the
// prose gives are the engine's; it stays within its token budget. The bundle e2e suite then
// plays the game and draws the module's sheets with check.mjs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { guideBlocks, startsEngine } from '../scripts/bundle/guide.mjs';
import * as bundle from './bundle';
import { PRIM_KINDS } from './engine/model';
import { PATTERNS } from './engine/texture';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const guide = read('docs/GUIDE-ASSETS.md');
const blocks = guideBlocks(guide);
const games = blocks.filter((b) => startsEngine(b.code));
const modules = blocks.filter((b) => !startsEngine(b.code));
/** The prose: the guide without its fenced code. */
const prose = guide.replace(/^```[\s\S]*?^```$/gm, '');
/** The text of a `## n. Title` section. */
const section = (title: string) => guide.split(/^## /m).find((s) => s.replace(/^\d+\. /, '').startsWith(`${title}\n`)) ?? '';
/** What a module block exports by name. */
const exportsOf = (code: string) => [...code.matchAll(/^export (?:const|function|class) (\w+)/gm)].map((m) => m[1]!);

const tmp = mkdtempSync(join(tmpdir(), 'guide-assets-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
/** A module block, run here: its './pixel-engine.js' is this repo's src/bundle.ts. */
async function load(name: string): Promise<Record<string, unknown>> {
  const b = modules.find((m) => m.name === name)!;
  const file = join(tmp, `${name}.mjs`);
  writeFileSync(file, b.code.replaceAll(`from './pixel-engine.js'`, `from ${JSON.stringify(fileURLToPath(new URL('./bundle.ts', import.meta.url)))}`));
  return (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
}

describe('docs/GUIDE-ASSETS.md', () => {
  it('has a game and the models module it imports, named apart from GUIDE.md', () => {
    const names = blocks.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    expect(games.length).toBeGreaterThanOrEqual(1);
    expect(modules.length).toBeGreaterThanOrEqual(1);
    const guideNames = guideBlocks(read('docs/GUIDE.md')).map((b) => b.name);
    expect(names.filter((n) => guideNames.includes(n))).toEqual([]);
    // the pages and modules it names are its blocks
    for (const [, page] of guide.matchAll(/examples\/([a-z0-9-]+)\.html/g)) expect(games.map((b) => b.name), page).toContain(page);
    for (const [, mod] of guide.matchAll(/examples\/([a-z0-9-]+)\.js/g)) expect(names, mod).toContain(mod);
  });

  it('every block parses as an ES module', () => {
    for (const { name, code } of blocks) {
      const out = ts.transpileModule(code, { fileName: `${name}.js`, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true } });
      expect((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), name).toEqual([]);
    }
  });

  it('imports only what pixel-engine.js and its own modules export, uses all of it, and the game starts the engine', () => {
    for (const { name, code } of blocks) {
      const imports = [...code.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';/gm)];
      expect(imports.length, name).toBeGreaterThanOrEqual(1);
      expect(code.split('\nimport ').length - 1 + (code.startsWith('import ') ? 1 : 0), `${name}: every import is a named one`).toBe(imports.length);
      for (const [, list, from] of imports) {
        const imported = list!.split(',').map((s) => s.trim()).filter(Boolean);
        if (from === './pixel-engine.js') expect(imported.filter((n) => !(n in bundle)), name).toEqual([]);
        else {
          const mod = modules.find((m) => `./${m.name}.js` === from);
          expect(mod, `${name} imports ${from}: a block of this guide`).toBeDefined();
          expect(imported.filter((n) => !exportsOf(mod!.code).includes(n)), name).toEqual([]);
        }
        for (const n of imported) expect(code.split(n).length - 1, `${name}: ${n} used`).toBeGreaterThan(1);
      }
      for (const [, list] of code.matchAll(/const \{([^}]*)\} = THREE;/g)) {
        const names = list!.split(',').map((s) => s.trim());
        expect(names.filter((n) => !(n in THREE)), name).toEqual([]);
        for (const n of names) expect(code.split(n).length - 1, `${name}: THREE.${n} used`).toBeGreaterThan(1);
      }
    }
    for (const { name, code } of games) expect(code, name).toMatch(/await Engine\.start\(new \w+\(\), withUrlOptions\(\{ container: document\.getElementById\('app'\), .*\}\)\);\n$/);
  });

  it("the game's own models: no problem, no warning, each composes the library, all in a catalog of their own", async () => {
    for (const m of modules) {
      const mod = await load(m.name);
      const defs = Object.values(mod).filter((v): v is bundle.ModelDef => !!v && typeof v === 'object' && 'parts' in v && 'palette' in v);
      const catalog = Object.values(mod).find((v): v is bundle.ModelCatalog => v instanceof bundle.ModelCatalog);
      expect(defs.length, m.name).toBeGreaterThanOrEqual(1);
      expect(catalog, `${m.name} exports a ModelCatalog`).toBeDefined();
      for (const def of defs) {
        expect(bundle.MODEL_LIBRARY.has(def.id), `${def.id} is not a library id`).toBe(false);
        expect(catalog!.get(def.id)).toBe(def);
        const c = bundle.checkModel(def, { catalog });
        expect([...c.problems, ...c.warnings], def.id).toEqual([]);
        const parts = JSON.stringify(typeof def.parts === 'function' ? def.parts({}, new bundle.Rng(1)) : def.parts);
        expect([...parts.matchAll(/"use":"([^"]+)"/g)].map((u) => u[1]).filter((id) => bundle.MODEL_LIBRARY.has(id!)).length, `${def.id} uses a library model`).toBeGreaterThan(0);
      }
      // the sheet check.mjs --sheets draws for it
      const sheet = bundle.modelSheet(defs[0]!, { catalog });
      expect([sheet.image.width > 600, sheet.problems.length]).toEqual([true, 0]);
    }
  });

  it("the game's scene builds as written: every id, param and palette slot is the model's, re-coloured and with params", async () => {
    for (const g of games) {
      const own = await Promise.all(modules.filter((m) => g.code.includes(`'./${m.name}.js'`)).map((m) => load(m.name)));
      const catalog = own.flatMap((mod) => Object.values(mod)).find((v): v is bundle.ModelCatalog => v instanceof bundle.ModelCatalog) ?? bundle.MODEL_LIBRARY;
      // the SCENE table is plain literals: evaluate it, then build each entry with its options
      const table = g.code.match(/^const SCENE = (\[[\s\S]*?\n\]);$/m)?.[1];
      expect(table, `${g.name} has a SCENE table`).toBeDefined();
      type Entry = [string, [number, number, number], ({ turn?: number } & bundle.ModelOptions)?];
      const scene = new Function(`return ${table}`)() as Entry[];
      expect(scene.length, g.name).toBeGreaterThanOrEqual(6);
      for (const [id, , { turn, ...options } = {}] of scene) {
        expect(Object.keys(options).filter((k) => !['params', 'palette', 'seed', 'light'].includes(k)), `${g.name}: ${id}'s options are buildModel's`).toEqual([]);
        expect(turn === undefined || Number.isFinite(turn), `${g.name}: ${id}'s turn`).toBe(true);
        expect(catalog.has(id), `${g.name}: model ${id}`).toBe(true);
        // an unknown param or slot, a value out of range, a light slot the model lacks: problems
        expect(bundle.validateModel(id, { ...options, catalog }).problems, `${g.name}: ${id} as placed`).toEqual([]);
        expect(() => bundle.buildModel(id, { ...options, catalog }), `${g.name}: ${id} builds`).not.toThrow();
      }
      const opts = scene.map(([, , o]) => o ?? {});
      expect(opts.some((o) => o.palette) && opts.some((o) => o.params), `${g.name}: a palette re-bind and params`).toBe(true);
      expect(scene.some(([id]) => !bundle.MODEL_LIBRARY.has(id)), `${g.name}: a model of its own`).toBe(true);
      expect(scene.some(([id]) => catalog.get(id).light), `${g.name}: a model with a light`).toBe(true);
      const textures = [...g.code.matchAll(/(?:textureMap|hudSprite|spriteSheet|TEXTURE_LIBRARY\.get)\('([a-z0-9-]+)'/g)].map((t) => t[1]!);
      expect(textures.length, g.name).toBeGreaterThan(0);
      for (const id of textures) expect(bundle.TEXTURE_LIBRARY.has(id), `${g.name}: texture ${id}`).toBe(true);
    }
  });

  it('the names its prose gives are real exports, and its lists are the engine', () => {
    const TYPES = ['ModelDef', 'TextureDef']; // type-only exports (API.md has them)
    // a code span's leading name, when it is a call or capitalised (files aside)
    const spans = prose.split('`').filter((_, i) => i % 2 === 1);
    const named = spans
      .map((s) => s.match(/^(?:new )?([A-Za-z_$][\w$]*)(.*)/s))
      .filter((m): m is RegExpMatchArray => !!m && !/^\.(md|m?js|html|png)\b/.test(m[2]!) && (/[A-Z]/.test(m[1]!) || m[2]!.startsWith('(')))
      .map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(20);
    expect([...new Set(named)].filter((n) => !(n in bundle) && !TYPES.includes(n))).toEqual([]);
    // every primitive a def may write (imports aside) is named in section 2
    const models = section('Models');
    expect(PRIM_KINDS.filter((k) => k !== 'mesh' && !models.includes(`\`${k}\``))).toEqual([]);
    // the patterns and each one's parameters
    const textures = section('Textures');
    const list = textures.match(/\*\*Patterns:\*\* `([^`]+)`/)![1]!.split(' ');
    expect(list).toEqual(Object.keys(PATTERNS));
    const params = textures.match(/Parameters: ([^.]+)\./)![1]!.replace(/\n/g, ' ');
    const given: Record<string, string[]> = {};
    for (const seg of params.split(';')) {
      const [who, ...rest] = seg.trim().split('`');
      const keys = rest.filter((_, i) => i % 2 === 0);
      for (const p of who!.trim().split(/ and /)) given[p.trim()] = keys;
    }
    expect(given).toEqual(Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, Object.keys(v.params)])));
  });

  it('stays within its token budget (~4 characters a token)', () => {
    expect(guide.length / 4).toBeLessThan(5000);
  });
});
