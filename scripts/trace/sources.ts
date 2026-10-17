// Trace sources (docs/assets/tracing.md): what `npm run model -- trace --against <source>` and
// `npm run model -- export-glb <source>` take, resolved to a source mesh (the importer's
// `SourceMesh`: coloured triangles grouped by node and material) with its provenance:
//
//   <file.glb|.gltf>          a file, read by the importer's reader (files beside a .gltf only)
//   pack:<pack>/<model>       a model in public/packs/<pack>.json (an import)
//   gate-a:<file>             a Gate A model in src/engine/model/fixtures/gate-a/: a Kit
//                             `build(kit)` or a ModelDef
//   town:<building>           a Riftlight town building (src/riftlight/town/Town.ts), in its own
//                             frame: smithy, market, tent, stash, obelisk, plaza, house (house-red,
//                             house-teal, house-plum), lantern
//   monster:<seed|boss id>    a monster body at its game scale (src/riftlight/monsters/); a boss by
//                             id (vorgath, nyx-hollow…), else a generated monster's seed
//   asset:<name>              a generated GLB in public/assets/ (tree, coin, hero)
//
// Code-built sources become meshes here, at the moment they are traced: nothing binary is
// committed (doctrine principle 5). `export-glb` writes one to .scratch/ for other tools; the GLB
// carries the source's provenance in its scene's extras, so tracing the file records the code
// (and the file's sha256). Only a file in a trace-src/ folder under the root's .scratch/ (where
// export-glb writes) is taken at its word: never .scratch/import-cache/, where downloads land. A
// GLB elsewhere in the repository is our own only if git tracks it.
// The town needs the engine index: register ./hooks.ts first under tsx.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, Vector3, type Object3D } from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ModelCatalog, MODEL_LIBRARY, OWN_LICENCE, packCatalog, parsePack, type ModelDef, type Provenance } from '../../src/engine/model';
import { readGltf, type SourceMesh } from '../../src/engine/model/import';
import { colourName, sourceFromModel, sourceFromObject } from '../../src/engine/model/trace';

/** Provenance a def traced from a source records (the tool adds `tool` and `fidelity`). */
export type SourceProvenance = Omit<Provenance, 'tool' | 'colours' | 'fidelity'>;

export interface TraceSource {
  /** As given (`gate-a:hand-cart-a`). */
  readonly spec: string;
  /** File-safe: names exports (`gate-a-hand-cart-a`). */
  readonly name: string;
  /** As built: not yet normalized (`normalizeSource` puts its base on y = 0 and centres it). */
  readonly mesh: SourceMesh;
  readonly provenance: SourceProvenance;
  /** What the provenance can't say (an outside file of unknown licence). */
  readonly notes: readonly string[];
}

export interface ResolveOptions {
  /** The repository root (paths in provenance are relative to it). */
  readonly root: string;
  /** Where pack files are (default <root>/public/packs). */
  readonly packs?: string;
  /** Provenance for a file the GLB doesn't describe: --licence, --source, --author, --pack. */
  readonly provenance?: Partial<SourceProvenance>;
}

/** The kinds `--against` takes, for messages. */
export const SOURCE_KINDS = 'a .glb/.gltf file, pack:<pack>/<model>, gate-a:<file>, town:<building>, monster:<seed|boss id>, asset:<name>';

const AUTHOR = 'riftlight';
const NAME = /^[A-Za-z0-9][\w-]*$/;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const own = (url: string): SourceProvenance => ({ url, licence: OWN_LICENCE, author: AUTHOR });
const fail = (msg: string): never => {
  throw new Error(msg);
};

/** A copy without some keys. */
function omit<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...o } as Record<string, unknown>;
  for (const k of keys) delete out[k as string];
  return out as Omit<T, K>;
}

// ---------------------------------------------------------------- town buildings

interface Building {
  readonly method: string;
  readonly args?: (layout: typeof import('../../src/riftlight/town/Town').TOWN_LAYOUT) => readonly unknown[] | undefined;
  /** Built inside one frame (`kit.frame`): exported in that frame. The plaza sits on the world origin. */
  readonly framed: boolean;
}

const HOUSES = ['red', 'teal', 'plum'] as const;
export const TOWN_BUILDINGS: Readonly<Record<string, Building>> = {
  smithy: { method: 'smithy', framed: true },
  market: { method: 'market', framed: true },
  tent: { method: 'tent', framed: true },
  stash: { method: 'stash', framed: true },
  obelisk: { method: 'obelisk', framed: true },
  plaza: { method: 'plaza', framed: false },
  house: { method: 'house', framed: true, args: (l) => l.houses[0] },
  ...Object.fromEntries(HOUSES.map((roof) => [`house-${roof}`, { method: 'house', framed: true, args: (l: typeof import('../../src/riftlight/town/Town').TOWN_LAYOUT) => l.houses.find((h) => h[2] === roof)! }])),
  lantern: { method: 'lantern', framed: true, args: (l) => l.lanterns[0] },
};

async function townBuilding(name: string): Promise<Object3D> {
  const b = TOWN_BUILDINGS[name] ?? fail(`no town building '${name}' (${Object.keys(TOWN_BUILDINGS).join(', ')})`);
  const { Town, TOWN_LAYOUT } = await import('../../src/riftlight/town/Town');
  const { Kit } = await import('../../src/riftlight/town/kit');
  const { Rng } = await import('../../src/riftlight/core/rng');
  // The first frame a building opens is its own: its axes, local +Z its front.
  class FrameKit extends Kit {
    first: { x: number; z: number; yaw: number; y: number } | null = null;
    private depth = 0;
    override frame(x: number, z: number, yaw: number, build: () => void, y = 0): Group {
      if (this.depth === 0 && !this.first) this.first = { x, z, yaw, y };
      this.depth++;
      try {
        return super.frame(x, z, yaw, build, y);
      } finally {
        this.depth--;
      }
    }
  }
  const town = new Town({ rng: new Rng('town') } as unknown as ConstructorParameters<typeof Town>[0]);
  const kit = new FrameKit();
  // Town's builders are private methods: nothing type-checks these names, so say which one moved
  const build = (town as unknown as Record<string, unknown>)[b.method];
  if (typeof build !== 'function') fail(`town:${name} builds with Town.${b.method}(kit, …), which src/riftlight/town/Town.ts no longer has: update TOWN_BUILDINGS in scripts/trace/sources.ts`);
  const args = (b.args ? b.args(TOWN_LAYOUT) : []) ?? fail(`town:${name}: TOWN_LAYOUT has no entry for it any more: update TOWN_BUILDINGS in scripts/trace/sources.ts`);
  (build as (k: InstanceType<typeof Kit>, ...a: readonly unknown[]) => void).call(town, kit, ...args);
  if (b.framed && !kit.first) fail(`town:${name}: Town.${b.method} opened no kit.frame, so it has no frame of its own to export in: update TOWN_BUILDINGS (framed: false) in scripts/trace/sources.ts`);
  const root = new Group();
  root.add(kit.build(), ...[...town.root.children]); // animated parts (a lid, a crystal) live on the town's root
  const f = b.framed ? kit.first : null;
  if (f) {
    // into the building's own frame: the inverse of translate(x, y, z) · turn(yaw)
    root.rotation.y = (-f.yaw * Math.PI) / 180;
    root.position.set(-f.x, -f.y, -f.z).applyAxisAngle(new Vector3(0, 1, 0), root.rotation.y);
  }
  const out = new Group();
  out.add(root);
  return out;
}

// ---------------------------------------------------------------- the others

async function gateA(file: string, root: string): Promise<{ mesh: SourceMesh; url: string }> {
  const name = file.replace(/\.ts$/, '');
  if (!NAME.test(name)) fail(`gate-a:${file}: name a file in src/engine/model/fixtures/gate-a/ (like hand-cart-a)`);
  const url = `src/engine/model/fixtures/gate-a/${name}.ts`;
  const path = join(root, url);
  if (!existsSync(path)) fail(`no ${url} (${readdirSync(join(root, 'src/engine/model/fixtures/gate-a')).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)).join(', ')})`);
  const mod = (await import(pathToFileURL(path).href)) as { build?: (kit: unknown) => void; default?: unknown } & Record<string, unknown>;
  if (typeof mod.build === 'function') {
    const { Kit } = await import('../../src/riftlight/town/kit');
    const kit = new Kit();
    mod.build(kit);
    const g = new Group();
    g.add(kit.build());
    return { mesh: sourceFromObject(g), url };
  }
  const isDef = (v: unknown): v is ModelDef => !!v && typeof v === 'object' && 'id' in v && 'parts' in v && 'palette' in v;
  const defs = [...new Set([mod.default, ...Object.values(mod)].filter(isDef))];
  if (!defs.length) fail(`${url} exports neither build(kit) nor a ModelDef`);
  const catalog = new ModelCatalog([...MODEL_LIBRARY.all().filter((d) => !defs.some((x) => x.id === d.id)), ...defs]);
  return { mesh: sourceFromModel(defs[0]!, { catalog }), url };
}

async function monster(arg: string): Promise<Object3D> {
  const { BOSSES, buildBoss, buildMonster, generateGenome } = await import('../../src/riftlight/monsters');
  const { Rng } = await import('../../src/riftlight/core/rng');
  const boss = BOSSES.all().find((b) => b.id === arg);
  const m = boss ? buildBoss(boss) : buildMonster(generateGenome(new Rng(/^\d+$/.test(arg) ? Number(arg) : arg)));
  m.object.scale.setScalar(m.genome.scale); // its size in the game
  const aura = m.object.getObjectByName('EliteAura'); // a rank's ground ring, not the body (as monsters.test.ts measures it)
  if (aura) aura.visible = false;
  return m.object;
}

/** A file inside `dir` named by a uri (no '..', not absolute): what a .gltf may read beside it. */
function beside(dir: string, uri: string): string {
  const path = resolve(dir, uri);
  if (isAbsolute(uri) || uri.split(/[\\/]/).includes('..') || !path.startsWith(dir + sep)) throw new Error(`'${uri}' is outside the glTF's folder: only files beside it are read`);
  return path;
}

/** The provenance an exported GLB carries (its scene's extras), or null. */
export function glbProvenance(bytes: Uint8Array): (SourceProvenance & { spec?: string }) | null {
  let json: { scenes?: { extras?: { source?: SourceProvenance & { spec?: string } } }[]; scene?: number };
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const glb = bytes.length >= 20 && dv.getUint32(0, true) === 0x46546c67;
    json = JSON.parse(new TextDecoder().decode(glb ? bytes.subarray(20, 20 + dv.getUint32(12, true)) : bytes));
  } catch {
    return null;
  }
  const s = json.scenes?.[json.scene ?? 0]?.extras?.source;
  return s && typeof s.url === 'string' && typeof s.licence === 'string' ? s : null;
}

/**
 * Where export-glb writes, and the only place a GLB is taken at its word: a root-relative path
 * (with `/`, symlinks resolved: `realPath`) in a `trace-src/` folder under `.scratch/`, never in
 * the import cache, where downloads land.
 */
export function exportPath(rel: string): boolean {
  const dirs = rel.split('/').slice(0, -1);
  return dirs[0] === '.scratch' && dirs.includes('trace-src') && !dirs.includes('import-cache') && !dirs.includes('..');
}

/** A path with every symlink in the part of it that exists resolved; the rest as written. */
export function realPath(path: string): string {
  let head = resolve(path);
  const tail: string[] = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  return join(realpathSync(head), ...tail);
}

/** `path` relative to `root`, with `/` (both real paths). */
export function rootRelative(root: string, path: string): string {
  return relative(realPath(root), realPath(path)).split(sep).join('/');
}

/**
 * A file git tracks under the root, as committed: only those are our own work (an untracked file
 * there may be anyone's, and so may a tracked one overwritten). Paths are literal, never globs.
 */
function tracked(root: string, rel: string): boolean {
  const git = (...args: string[]) => execFileSync('git', ['--literal-pathspecs', ...args, '--', rel], { cwd: root, stdio: 'ignore' });
  try {
    git('ls-files', '--error-unmatch');
    git('diff', '--quiet'); // as git has it (the index), not overwritten since
    return true;
  } catch {
    return false;
  }
}

async function fromFile(file: string, o: ResolveOptions): Promise<TraceSource> {
  const path = resolve(file);
  if (!existsSync(path)) fail(`no file '${file}' (sources: ${SOURCE_KINDS})`);
  const bytes = new Uint8Array(readFileSync(path));
  const mesh = await readGltf(bytes, { inflate: (b) => new Uint8Array(inflateSync(b)), readFile: (uri) => new Uint8Array(readFileSync(beside(dirname(path), uri))) });
  const rel = rootRelative(o.root, path);
  const inRepo = !rel.startsWith('..') && !isAbsolute(rel);
  // what a GLB says of itself is trusted only where export-glb writes: anyone can put extras in a file
  const scratch = inRepo && rel.startsWith('.scratch/');
  const carried = scratch && exportPath(rel) ? glbProvenance(bytes) : null;
  const notes: string[] = [];
  let provenance: SourceProvenance;
  if (carried) {
    provenance = { ...omit(carried, ['spec']), sha256: sha256(bytes) }; // an export of ours: it names the code that built it, and the file is pinned
  } else if (inRepo && !scratch && tracked(o.root, rel)) provenance = { ...own(rel), file: basename(path), sha256: sha256(bytes) };
  else {
    provenance = { url: '', licence: '', file: basename(path), sha256: sha256(bytes) };
    notes.push(`whose is ${file}? it is outside the repository, in .scratch/ or not tracked by git: pass --licence <spdx> --source <url> (and --pack <id> for someone else's, docs/assets/importing.md)`);
  }
  return { spec: file, name: basename(path).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-'), mesh, provenance: { ...provenance, ...o.provenance }, notes };
}

/** Resolve a `--against` source (see the file comment). */
export async function resolveSource(spec: string, o: ResolveOptions): Promise<TraceSource> {
  const m = /^([a-z-]+):(.+)$/.exec(spec);
  if (!m || /\.(glb|gltf)$/i.test(spec)) return fromFile(spec, o);
  const [, kind, arg] = m as unknown as [string, string, string];
  const name = `${kind}-${arg}`.replace(/[^\w-]+/g, '-');
  const done = (mesh: SourceMesh, provenance: SourceProvenance): TraceSource => ({ spec, name, mesh, provenance: { ...provenance, ...o.provenance }, notes: [] });
  switch (kind) {
    case 'gate-a': {
      const r = await gateA(arg, o.root);
      return done(r.mesh, own(r.url));
    }
    case 'town':
      return done(sourceFromObject(await townBuilding(arg)), own('src/riftlight/town/Town.ts'));
    case 'monster':
      return done(sourceFromObject(await monster(arg)), own('src/riftlight/monsters'));
    case 'asset': {
      if (!NAME.test(arg)) fail(`asset:${arg}: name a GLB in public/assets/ (tree, coin, hero)`);
      const url = `public/assets/${arg}.glb`;
      if (!existsSync(join(o.root, url))) fail(`no ${url} (${readdirSync(join(o.root, 'public/assets')).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).join(', ')})`);
      const s = await fromFile(join(o.root, url), o);
      return { ...s, spec, name: arg };
    }
    case 'pack': {
      const [pack, model] = arg.split('/');
      if (!pack || !model || !NAME.test(pack) || !NAME.test(model)) fail(`pack:${arg}: name a model as pack:<pack>/<model>`);
      const file = join(o.packs ?? join(o.root, 'public/packs'), `${pack}.json`);
      if (!existsSync(file)) fail(`no pack file ${relative(o.root, file)}`);
      const p = parsePack(JSON.parse(readFileSync(file, 'utf8')) as unknown, relative(o.root, file));
      const def = p.models.find((d) => d.id === `${pack}/${model}`) ?? fail(`pack ${pack} has no model ${pack}/${model} (${p.models.map((d) => d.id).join(', ')})`);
      // a trace of someone else's model is still theirs: it keeps their licence, author and pack
      const theirs = omit(def.source ?? { url: relative(o.root, file), licence: '' }, ['tool', 'colours', 'fidelity']);
      return done(sourceFromModel(def, { catalog: packCatalog(p) }), theirs);
    }
    default:
      return fail(`unknown source '${spec}' (${SOURCE_KINDS})`);
  }
}

// ---------------------------------------------------------------- export

// GLTFExporter writes binary through FileReader, which Node lacks
function fileReader(): void {
  (globalThis as { FileReader?: unknown }).FileReader ??= class {
    result: unknown = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
        this.onloadend?.();
      });
    }
  };
}

/**
 * A source as a GLB: one mesh per group and colour, named after its node, its material named
 * after the group's (a colour's PALETTE name for code-built sources), unlit groups as
 * KHR_materials_unlit; the provenance in the scene's extras. The importer reads it back exactly.
 */
export async function sourceGlb(src: TraceSource): Promise<Uint8Array> {
  fileReader();
  const scene = new Scene();
  scene.name = src.name;
  scene.userData = { source: { spec: src.spec, ...src.provenance } };
  const parts = new Map<string, { node: string; material: string; unlit: boolean; hex: number; p: number[] }>();
  const m = src.mesh;
  for (let t = 0; t < m.group.length; t++) {
    const g = m.groups[m.group[t]!]!;
    const hex = m.colours[t]!;
    const key = `${m.group[t]}|${hex}`;
    let part = parts.get(key);
    if (!part) parts.set(key, (part = { node: g.node, material: g.material || colourName(hex), unlit: g.unlit, hex, p: [] }));
    for (let k = 0; k < 9; k++) part.p.push(m.positions[t * 9 + k]!);
  }
  const multi = new Map<number, number>();
  for (const key of parts.keys()) multi.set(Number(key.split('|')[0]), (multi.get(Number(key.split('|')[0])) ?? 0) + 1);
  for (const [key, part] of parts) {
    const geo = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(part.p), 3));
    // a group of several colours (a file's vertex colours, an atlas): one material per colour
    const name = (multi.get(Number(key.split('|')[0])) ?? 1) > 1 ? `${part.material} ${colourName(part.hex)}` : part.material;
    const material = part.unlit ? new MeshBasicMaterial({ color: new Color(part.hex), name }) : new MeshStandardMaterial({ color: new Color(part.hex), name, roughness: 1, metalness: 0 });
    const mesh = new Mesh(geo, material);
    mesh.name = part.node;
    scene.add(mesh);
  }
  return new Uint8Array((await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer);
}
