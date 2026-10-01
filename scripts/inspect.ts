// Asset inspector for agents ("a Blender plugin for agents"): any asset becomes a turntable
// PNG (8 angles), a rig overlay (front + side, joint names) and counts, without a browser.
// Run through tsx:  npm run inspect -- <target> [options]
//
// Targets:
//   <file.glb> | hero | coin | tree   a GLB (a path, or a name in public/assets/); the hero
//                                     also gets its rig (HERO_RIG) and clips (HERO_CLIPS)
//   clip:<name>                       the hero posed mid-clip (--frame n), plus a contact strip
//   monster:<seed>                    a generated monster (--depth --rank --plan --archetype --tags)
//   boss:<level>                      a designed boss (1..12), or --rift --depth d --tags m1,m2
//   npc:<id>                          a townsfolk model (brann, ilsa, oru, vex, villager, villager2)
//   prop:<id>                         a level prop (--theme id)
//   item:<seed>                       an item's ground-drop model (--ilvl --rarity --base)
//   list                              every target name
//
//   diff <a> <b>                      two assets side by side at one scale, with count deltas
//   diff <a>                          <a> now against the previous version inspected (history)
//
// Options: --angles 8, --size 150, --json (the report as JSON), --out .scratch/inspect.
// Writes <out>/<name>.png and <name>.json; every run records the report in <out>/history/,
// so `diff <a>` shows what a generator change did. Exit code 1 when --strict and warnings.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Box3, Group, type AnimationClip, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { compileClip, renderSheet, restPoseOf, type ClipDef, type SheetImage } from '../src/engine/animation';
import { column, diffPanel, diffReports, inspectObject, renderDiff, renderInspection, renderTurntable, row, titleBar, type ClipInfo, type InspectReport } from '../src/engine/inspect';
import { HERO_CLIPS, HERO_MODEL, HERO_RIG } from '../src/game/hero';
import { Rng } from '../src/riftlight/core/rng';
import type { Rank } from '../src/riftlight/core/scaling';
import type { Rarity } from '../src/riftlight/core/types';
import { THEMES, getTheme } from '../src/riftlight/levels/themes/themes';
import { PROPS, buildProp } from '../src/riftlight/levels/themes/props';
import { rollItem } from '../src/riftlight/loot/generate';
import { itemMods } from '../src/riftlight/loot/itemMods';
import { describeItemMods } from '../src/riftlight/loot/stats';
import { WorldLoot } from '../src/riftlight/loot/world';
import { BOSSES, buildBoss, buildMonster, generateBoss, generateGenome, type BuiltMonster, type GenomeOptions } from '../src/riftlight/monsters';
import { NPC_CLIPS } from '../src/riftlight/town/npcClips';
import { TOWNSFOLK } from '../src/riftlight/town/npcModel';
import { encodePng } from './png';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const VALUED = ['angles', 'size', 'out', 'depth', 'rank', 'plan', 'archetype', 'tags', 'theme', 'ilvl', 'rarity', 'base', 'frame'];
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const k = a.slice(2);
    flags.set(k, VALUED.includes(k) ? (argv[++i] ?? '') : true);
  } else args.push(a);
}
const json = flags.has('json');
const OUT = resolve(ROOT, String(flags.get('out') ?? '.scratch/inspect'));
const angles = Number(flags.get('angles') ?? 8);
const size = Number(flags.get('size') ?? 150);
const fail = (m: string): never => {
  console.error(m);
  process.exit(2);
};

interface Loaded {
  object: Object3D;
  key: string;
  name: string;
  subtitle: string;
  joints?: readonly string[];
  clips?: readonly ClipInfo[] | readonly AnimationClip[];
  /** Extra image under the sheet (a clip's contact strip). */
  extra?: SheetImage;
  /** Extra JSON (an item's mods, a monster's genome). */
  info?: unknown;
  /** Extra lines for the sheet's panel. */
  notes?: string[];
}

const clipInfo = (defs: readonly ClipDef[], fps: number): ClipInfo[] => defs.map((d) => ({ name: d.name, duration: d.frames / fps, loop: !!d.loop, frames: d.frames, tracks: new Set(d.keys.flatMap((k) => Object.keys(k[1]))).size || undefined }));

async function loadGlb(file: string): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  const buf = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return { scene: gltf.scene, animations: gltf.animations };
}

function glbPath(t: string): string | null {
  for (const p of [resolve(process.cwd(), t), resolve(ROOT, t), join(ROOT, 'public', t), join(ROOT, 'public/assets', t), join(ROOT, 'public/assets', `${t}.glb`)]) if (existsSync(p) && p.endsWith('.glb')) return p;
  return null;
}

function monsterLoaded(m: BuiltMonster, key: string, name: string, subtitle: string): Loaded {
  m.object.scale.setScalar(m.genome.scale);
  const fps = 30;
  return {
    object: m.object,
    key,
    name,
    subtitle,
    joints: m.rig.joints,
    clips: m.clipNames.map((n) => m.clipInfo(n)!).map((c) => ({ name: c.name, duration: c.frames / fps, loop: c.loop, frames: c.frames })),
    info: { genome: m.genome, skills: m.skills, cost: m.cost },
    notes: [`skills: ${m.skills.join(', ')}`, `parts: ${m.genome.parts.map((p) => `${p.socket}=${p.part}`).join(', ')}`],
  };
}

async function load(target: string): Promise<Loaded> {
  const [kind, ...restParts] = target.split(':');
  const rest = restParts.join(':');
  const seed = (s: string) => (/^\d+$/.test(s) ? Number(s) : s);
  switch (restParts.length ? kind : '') {
    case 'clip': {
      const def = HERO_CLIPS.find((d) => d.name.toLowerCase() === rest.toLowerCase()) ?? fail(`no hero clip "${rest}" (npm run anim -- list)`);
      const { scene } = await loadGlb(join(ROOT, 'public', HERO_MODEL));
      const clip = compileClip(def, HERO_RIG, restPoseOf(scene, HERO_RIG));
      const frame = flags.has('frame') ? Number(flags.get('frame')) : Math.floor(def.frames / 2);
      const strip = renderSheet(scene, HERO_RIG, def, clip, { views: ['side', 'three'], scale: 56 });
      const mixer = new AnimationMixer(scene);
      mixer.clipAction(clip).play();
      mixer.setTime(Math.min(def.frames, frame) / HERO_RIG.fps);
      scene.updateMatrixWorld(true);
      return { object: scene, key: `clip-${def.name}`, name: `clip ${def.name}`, subtitle: `hero posed at frame ${frame}/${def.frames} (${(def.frames / HERO_RIG.fps).toFixed(2)} s${def.loop ? ', loop' : ''})`, joints: HERO_RIG.joints, clips: clipInfo([def], HERO_RIG.fps), extra: strip };
    }
    case 'monster': {
      const o: GenomeOptions = {};
      if (flags.has('plan')) o.plan = String(flags.get('plan'));
      if (flags.has('archetype')) o.archetype = String(flags.get('archetype'));
      if (flags.has('depth')) o.depth = Number(flags.get('depth'));
      if (flags.has('rank')) o.rank = String(flags.get('rank')) as Rank;
      if (flags.has('tags')) o.tags = String(flags.get('tags')).split(',');
      const g = generateGenome(new Rng(seed(rest)), o);
      const suffix = [o.plan, o.archetype, o.depth && `d${o.depth}`, o.rank, o.tags?.join('+')].filter(Boolean).join('-');
      return monsterLoaded(buildMonster(g), `monster-${rest}${suffix ? `-${suffix}` : ''}`, `monster ${rest}`, `${g.plan} ${g.archetype} ${g.rank}, scale ${g.scale.toFixed(2)}, parts: ${g.parts.map((p) => p.part).join(' ')}`);
    }
    case 'boss': {
      const boss = flags.has('rift') ? generateBoss(new Rng(seed(rest)), Number(flags.get('depth') ?? 15), String(flags.get('tags') ?? 'gale,embers').split(',')) : (BOSSES.all().find((b) => String(b.level) === rest || b.id === rest) ?? fail(`no boss ${rest}; designed levels are 1..12`));
      return monsterLoaded(buildBoss(boss), `boss-${boss.id}`, boss.name, `${boss.genome.plan} ${boss.genome.archetype}, signature ${boss.signature}, scale ${boss.genome.scale.toFixed(2)}`);
    }
    case 'npc': {
      const build = TOWNSFOLK[rest] ?? fail(`no townsfolk "${rest}" (${Object.keys(TOWNSFOLK).join(', ')})`);
      return { object: build(), key: `npc-${rest}`, name: `npc ${rest}`, subtitle: 'townsfolk on the hero rig (src/riftlight/town/npcModel.ts)', joints: HERO_RIG.joints, clips: clipInfo(NPC_CLIPS[rest] ?? [], HERO_RIG.fps) };
    }
    case 'prop': {
      if (!PROPS.has(rest)) fail(`no prop "${rest}" (${PROPS.all().map((p) => p.id).join(', ')})`);
      const theme = flags.has('theme') ? getTheme(String(flags.get('theme'))) : (THEMES.all().find((t) => t.props.includes(rest)) ?? THEMES.all()[0]!);
      const p = buildProp(rest, { theme, rng: new Rng(`prop:${rest}`) }, 0, 0);
      return { object: p.root, key: `prop-${rest}-${theme.id}`, name: `prop ${rest}`, subtitle: `theme ${theme.id}${p.glow ? `, glow ${p.glow.radius} m` : ''}${PROPS.get(rest).blocks ? ', blocks its cell' : ''}` };
    }
    case 'item': {
      const rarity = flags.has('rarity') ? (String(flags.get('rarity')) as Rarity) : undefined;
      const item = rollItem(new Rng(seed(rest)), { itemLevel: Number(flags.get('ilvl') ?? 40), rarity, base: flags.has('base') ? String(flags.get('base')) : undefined });
      // The ground-drop model is WorldLoot's (private) builder; it only needs its geometry cache.
      const proto = WorldLoot.prototype as unknown as { buildMesh(this: unknown, item: unknown, gold: number): Object3D; geometry: unknown; box: unknown };
      const object = proto.buildMesh.call({ geometries: new Map(), geometry: proto.geometry, box: proto.box }, item, 0);
      const group = new Group();
      group.add(object);
      return { object: group, key: `item-${rest}`, name: item.name, subtitle: `${item.rarity} ${item.base}, item level ${item.level}`, info: { item, mods: describeItemMods(itemMods(item)) }, notes: describeItemMods(itemMods(item)) };
    }
    default: {
      const file = glbPath(target) ?? fail(`no asset "${target}": a .glb path, hero/coin/tree, or clip:/monster:/boss:/npc:/prop:/item: (npm run inspect -- list)`);
      const { scene, animations } = await loadGlb(file);
      const isHero = basename(file) === basename(HERO_MODEL);
      const clips: ClipInfo[] = [...animations.map((a) => ({ name: a.name, duration: a.duration, tracks: a.tracks.length })), ...(isHero ? clipInfo(HERO_CLIPS, HERO_RIG.fps) : [])];
      return { object: scene, key: basename(file, '.glb'), name: basename(file), subtitle: `${file.slice(ROOT.length + 1)}${isHero ? ' + HERO_RIG + HERO_CLIPS (clips are data, compiled at load)' : ''}`, joints: isHero ? HERO_RIG.joints : undefined, clips };
    }
  }
}

function report(l: Loaded): InspectReport {
  return inspectObject(l.object, { name: l.name, joints: l.joints, clips: l.clips });
}

function write(name: string, img: SheetImage): string {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  writeFileSync(file, encodePng(img));
  return file;
}

// ---------------------------------------------------------------- history (for `diff <a>`)

interface Snapshot {
  report: InspectReport;
  frame: [number[], number[]];
  width: number;
  height: number;
}
const histDir = (key: string) => join(OUT, 'history', key.replace(/[^\w.-]+/g, '_'));

function snapshot(l: Loaded, r: InspectReport): void {
  const dir = histDir(l.key);
  mkdirSync(dir, { recursive: true });
  const last = join(dir, 'last.json');
  if (existsSync(last)) {
    const prev = JSON.parse(readFileSync(last, 'utf8')) as Snapshot;
    if (prev.report.fingerprint === r.fingerprint) return;
    renameSync(last, join(dir, 'prev.json'));
    renameSync(join(dir, 'last.rgba'), join(dir, 'prev.rgba'));
  }
  const frame = new Box3().setFromObject(l.object, true);
  const img = row(renderTurntable(l.object, { angles: 4, size, frame }));
  writeFileSync(join(dir, 'last.rgba'), Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength));
  writeFileSync(last, JSON.stringify({ report: r, frame: [frame.min.toArray(), frame.max.toArray()], width: img.width, height: img.height } satisfies Snapshot));
}

/** The version to diff against: the last one recorded if it differs from now, else the one before. */
function baseline(key: string, now: InspectReport): { snap: Snapshot; img: SheetImage } | null {
  const dir = histDir(key);
  for (const name of ['last', 'prev']) {
    const f = join(dir, `${name}.json`);
    if (!existsSync(f)) continue;
    const snap = JSON.parse(readFileSync(f, 'utf8')) as Snapshot;
    if (snap.report.fingerprint === now.fingerprint) continue;
    const data = new Uint8ClampedArray(readFileSync(join(dir, `${name}.rgba`)));
    return { snap, img: { width: snap.width, height: snap.height, data } };
  }
  return null;
}

// ---------------------------------------------------------------- commands

async function main(): Promise<void> {
  const cmd = args[0] ?? 'help';
  if (cmd === 'help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return;
  }
  if (cmd === 'list') {
    const glbs = readdirSync(join(ROOT, 'public/assets')).filter((f) => f.endsWith('.glb'));
    const out = {
      glb: glbs.map((f) => f.replace(/\.glb$/, '')),
      clip: HERO_CLIPS.map((c) => c.name),
      monster: ['<seed> [--plan --archetype --depth --rank --tags]'],
      boss: BOSSES.all().map((b) => String(b.level)),
      npc: Object.keys(TOWNSFOLK),
      prop: PROPS.all().map((p) => p.id),
      item: ['<seed> [--ilvl --rarity --base]'],
    };
    if (json) console.log(JSON.stringify(out, null, 2));
    else for (const [k, v] of Object.entries(out)) console.log(`${k === 'glb' ? 'glb (name or path)' : `${k}:`}  ${v.join(' ')}`);
    return;
  }
  if (cmd === 'diff') {
    const [, aT, bT] = args;
    if (!aT) fail('diff <a> [b]');
    const a = await load(aT!);
    const ra = report(a);
    if (bT) {
      const b = await load(bT);
      const rb = report(b);
      const d = diffReports(ra, rb);
      const file = write(`diff-${a.key}-vs-${b.key}.png`.replace(/[^\w.-]+/g, '_'), renderDiff({ object: a.object, report: ra }, { object: b.object, report: rb }, d, { size }));
      writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(d, null, 2));
      printDiff(d, file);
      return;
    }
    const base = baseline(a.key, ra);
    if (!base) {
      snapshot(a, ra);
      console.log(json ? JSON.stringify({ same: true, note: "no different earlier version recorded" }) : `no different earlier version of ${aT} recorded: it has not changed since it was last inspected (change it and diff again)`);
      return;
    }
    const d = diffReports({ ...base.snap.report, name: `${base.snap.report.name} (before)` }, ra);
    const frame = new Box3().setFromArray([...base.snap.frame[0], ...base.snap.frame[1]]);
    const now = row(renderTurntable(a.object, { angles: 4, size, frame: frame.union(new Box3().setFromObject(a.object, true)) }));
    const w = Math.max(now.width, base.img.width);
    const sheet = column([titleBar(`A: ${aT} before (${base.snap.report.fingerprint}, at its own scale)`, w), base.img, titleBar(`B: ${aT} now (${ra.fingerprint})`, w), now, diffPanel(d, w)]);
    const file = write(`diff-${a.key}.png`.replace(/[^\w.-]+/g, '_'), sheet);
    writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(d, null, 2));
    snapshot(a, ra);
    printDiff(d, file);
    return;
  }
  // inspect one or more targets
  const results: unknown[] = [];
  for (const t of args) {
    const l = await load(t);
    const r = report(l);
    const sheet = renderInspection(l.object, r, { angles, size, joints: l.joints, subtitle: l.subtitle, notes: l.notes });
    const file = write(`${l.key.replace(/[^\w.-]+/g, '_')}.png`, l.extra ? column([sheet, l.extra]) : sheet);
    const out = { file, ...r, info: l.info };
    writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(out, null, 2));
    snapshot(l, r);
    results.push(out);
    if (!json) printReport(r, l, file);
  }
  if (json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  if (flags.has('strict') && results.some((x) => (x as InspectReport).warnings.length)) process.exitCode = 1;
}

function printReport(r: InspectReport, l: Loaded, file: string): void {
  console.log(`${r.name}  (${l.subtitle})`);
  console.log(`  triangles ${r.triangles}  vertices ${r.vertices}  meshes ${r.meshes}  draw calls ${r.drawCalls}  materials ${r.materials.length}  textures ${r.textures}`);
  console.log(`  bounds ${r.bounds.size.join(' × ')} m  (min ${r.bounds.min.join(', ')}  max ${r.bounds.max.join(', ')})`);
  console.log(`  joints ${r.joints.length}${r.skinned ? ' (skinned)' : ''}  clips ${r.clips.length}${r.clips.length ? `: ${r.clips.slice(0, 8).map((c) => `${c.name} ${c.duration}s`).join(', ')}${r.clips.length > 8 ? ', …' : ''}` : ''}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  console.log(`  wrote ${file.slice(ROOT.length + 1)} (+ .json)`);
}

function printDiff(d: ReturnType<typeof diffReports>, file: string): void {
  if (json) {
    console.log(JSON.stringify({ file, ...d }, null, 2));
    return;
  }
  console.log(`${d.a}  →  ${d.b}${d.same ? '  (identical)' : ''}`);
  for (const [k, [x, y, dd]] of Object.entries(d.counts)) if (dd) console.log(`  ${k.padEnd(10)} ${String(x).padStart(8)} → ${String(y).padEnd(8)} ${dd > 0 ? '+' : ''}${dd}`);
  for (const [k, s] of Object.entries({ joints: d.joints, clips: d.clips, materials: d.materials, warnings: d.warnings })) {
    if (s.added.length) console.log(`  + ${k}: ${s.added.join(', ')}`);
    if (s.removed.length) console.log(`  - ${k}: ${s.removed.join(', ')}`);
  }
  if (d.clips.changed.length) console.log(`  ~ clip lengths: ${d.clips.changed.join(', ')}`);
  console.log(`  wrote ${file.slice(ROOT.length + 1)} (+ .json)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(2);
});
