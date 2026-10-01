// Animation workbench CLI — how agents look at, measure and iterate on animations
// without a browser. Run through tsx:  npm run anim -- <command> [...]
//
//   list                         clips with length, loop, speed, notes
//   check [clip...]              validate + metrics table; exit 1 on problems (no --character:
//                                every character: the hero and Riftlight's townsfolk)
//   sheet <clip...|all> [opts]   PNG contact sheet(s) → .scratch/anim/<clip>.png
//        --frames 0,4,8  --views side,front,three,top  --scale 64  --no-trails  --no-skeleton
//   curves <clip...> [opts]      PNG motion curves (graph editor) → .scratch/anim/<clip>.curves.png
//        --joints ArmR,LegL  --cycles 1  --width 900
//   diff <clip...>               what changed since the previous version you rendered
//                                (frames are on the longer version's timeline, scaled)
//   overview [clip...]           one PNG, a side-view strip per clip → .scratch/anim/overview.png
//   pose <clip> <frame>          JSON: authored joint rotations + world positions at that frame
//
// Options for every command: --json (machine-readable output), --out <dir>,
// --character <hero|brann|ilsa|oru|vex|villager|villager2> (default hero).
// sheet and curves take --compare: draw the previous version of the clip (magenta skeleton
// and paths on sheets, grey curves). Every
// sheet/curves run records the clip in .scratch/anim/history/, so "previous" is the last
// *different* version you rendered.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  analyzeClip,
  compileClip,
  defaultFrames,
  renderCurves,
  renderSheet,
  restPoseOf,
  sampleClip,
  sampleFrames,
  validateClip,
  type ClipDef,
  type ClipReport,
  type RigSpec,
  type SheetImage,
  type ViewName,
} from '../src/engine/animation';
import { HERO_CLIPS, HERO_MODEL, HERO_RIG } from '../src/game/hero';
import { NPC_CLIPS } from '../src/riftlight/town/npcClips';
import { TOWNSFOLK } from '../src/riftlight/town/npcModel';
import { encodePng } from './png';

// `npm run anim -- list | head` closes the pipe early; that's not an error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Character {
  /** A GLB under public/, or a builder (Riftlight's townsfolk are built in code). */
  model: string | (() => Object3D);
  rig: RigSpec;
  clips: readonly ClipDef[];
}

const CHARACTERS: Record<string, Character> = {
  hero: { model: HERO_MODEL, rig: HERO_RIG, clips: HERO_CLIPS },
  // Riftlight townsfolk wear the hero rig (src/riftlight/town/npcModel.ts).
  ...Object.fromEntries(Object.entries(TOWNSFOLK).map(([id, build]) => [id, { model: build, rig: HERO_RIG, clips: NPC_CLIPS[id] ?? [] }])),
};

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const next = argv[i + 1];
    const valued = ['frames', 'views', 'scale', 'out', 'character', 'joints', 'cycles', 'width'].includes(a.slice(2));
    flags.set(a.slice(2), valued && next !== undefined ? next : true);
    if (valued) i++;
  } else args.push(a);
}
const command = args.shift() ?? 'help';
const json = flags.has('json');
const outDir = resolve(ROOT, String(flags.get('out') ?? '.scratch/anim'));
const character = CHARACTERS[String(flags.get('character') ?? 'hero')];
if (!character) fail(`unknown character; have: ${Object.keys(CHARACTERS).join(', ')}`);

async function loadModel(url: string | (() => Object3D)): Promise<Object3D> {
  if (typeof url === 'function') return url();
  const buf = readFileSync(join(ROOT, 'public', url));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  return gltf.scene;
}

function pick(names: string[]): ClipDef[] {
  if (!names.length || names.includes('all')) return [...character!.clips];
  return names.map((n) => {
    const c = character!.clips.find((d) => d.name.toLowerCase() === n.toLowerCase());
    if (!c) fail(`no clip "${n}". Try: npm run anim -- list`);
    return c!;
  });
}

async function checkCharacter(c: Character, names: string[]): Promise<(ClipReport & { errors: string[] })[]> {
  const { rig } = c;
  const model = await loadModel(c.model);
  const rest = restPoseOf(model, rig);
  const defs = !names.length || names.includes('all') ? [...c.clips] : names.map((n) => c.clips.find((d) => d.name.toLowerCase() === n.toLowerCase()) ?? fail(`no clip "${n}". Try: npm run anim -- list`));
  const reports: (ClipReport & { errors: string[] })[] = [];
  for (const def of defs) {
    const errors = validateClip(def, rig);
    const report = analyzeClip(model, rig, def, compileClip(def, rig, rest));
    reports.push({ ...report, errors });
  }
  const bad = reports.filter((r) => r.errors.length || r.problems.length);
  if (!json) {
    table(
      ['clip', 'soleMin', 'slide', 'seam°', 'pelvisY', 'fastest', 'status'],
      reports.map((r) => [
        r.name,
        `${(r.minSoleY * 100).toFixed(0)}cm`,
        r.footSlide.toFixed(2),
        r.loop ? r.loopSeam.toFixed(1) : '',
        `${r.pelvisY[0].toFixed(2)}..${r.pelvisY[1].toFixed(2)}`,
        `${r.maxAngularSpeed.joint} ${r.maxAngularSpeed.degPerSec.toFixed(0)}°/s`,
        r.errors.length || r.problems.length ? 'PROBLEM' : r.warnings.length ? 'warn' : 'ok',
      ]),
    );
    for (const r of reports) {
      for (const e of r.errors) console.log(`  ✗ ${e}`);
      for (const p of r.problems) console.log(`  ✗ ${r.name}: ${p}`);
      for (const w of r.warnings) console.log(`  · ${r.name}: ${w}`);
    }
    console.log(`\n${reports.length} clip(s), ${bad.length} with problems, ${reports.filter((r) => r.warnings.length).length} with warnings`);
  }
  return reports;
}

async function main(): Promise<void> {
  const { rig } = character!;
  switch (command) {
    case 'list': {
      const rows = character!.clips.map((c) => ({ name: c.name, frames: c.frames, seconds: +(c.frames / rig.fps).toFixed(2), loop: !!c.loop, speed: c.speed ?? null, keys: c.keys.length, notes: c.notes ?? '' }));
      if (json) return print(rows);
      table(['clip', 'frames', 'sec', 'loop', 'speed', 'keys', 'notes'], rows.map((r) => [r.name, r.frames, r.seconds, r.loop ? 'loop' : '', r.speed ?? '', r.keys, r.notes.slice(0, 70)]));
      return;
    }
    case 'check': {
      // No --character: every character (the hero and the townsfolk) is checked.
      const which = flags.has('character') ? [String(flags.get('character'))] : Object.keys(CHARACTERS);
      let bad = 0;
      const all: Record<string, unknown> = {};
      for (const name of which) {
        const c = CHARACTERS[name]!;
        if (!json && which.length > 1) console.log(`\n${name}`);
        const reports = await checkCharacter(c, flags.has('character') ? args : []);
        all[name] = reports;
        bad += reports.filter((r) => r.errors.length || r.problems.length).length;
      }
      if (json) print(flags.has('character') ? all[which[0]!] : all);
      if (bad) process.exitCode = 1;
      return;
    }
    case 'sheet': {
      if (!args.length) fail('usage: sheet <clip...|all>');
      const model = await loadModel(character!.model);
      const rest = restPoseOf(model, rig);
      mkdirSync(outDir, { recursive: true });
      const written: string[] = [];
      for (const def of pick(args)) {
        const clip = compileClip(def, rig, rest);
        const report = analyzeClip(model, rig, def, clip);
        const prev = remember(def);
        const img = renderSheet(model, rig, def, clip, {
          ghost: flags.has('compare') && prev ? compileClip(prev, rig, rest) : undefined,
          frames: flags.has('frames') ? String(flags.get('frames')).split(',').map(Number) : undefined,
          views: flags.has('views') ? (String(flags.get('views')).split(',') as ViewName[]) : undefined,
          scale: flags.has('scale') ? Number(flags.get('scale')) : undefined,
          trails: !flags.has('no-trails'),
          skeleton: !flags.has('no-skeleton'),
          report,
        });
        const file = join(outDir, `${def.name}.png`);
        writeFileSync(file, encodePng(img));
        written.push(file);
      }
      if (json) print(written);
      else for (const f of written) console.log(f);
      return;
    }
    case 'curves': {
      if (!args.length) fail('usage: curves <clip...>');
      const model = await loadModel(character!.model);
      const rest = restPoseOf(model, rig);
      mkdirSync(outDir, { recursive: true });
      const written: string[] = [];
      for (const def of pick(args)) {
        const prev = remember(def);
        const img = renderCurves(model, rig, def, compileClip(def, rig, rest), {
          joints: flags.has('joints') ? String(flags.get('joints')).split(',') : undefined,
          cycles: flags.has('cycles') ? Number(flags.get('cycles')) : undefined,
          width: flags.has('width') ? Number(flags.get('width')) : undefined,
          compare: flags.has('compare') && prev ? { def: prev, clip: compileClip(prev, rig, rest) } : undefined,
        });
        const file = join(outDir, `${def.name}.curves.png`);
        writeFileSync(file, encodePng(img));
        written.push(file);
      }
      if (json) print(written);
      else for (const f of written) console.log(f);
      return;
    }
    case 'diff': {
      const out: Record<string, unknown> = {};
      for (const def of pick(args)) {
        const prev = previous(def);
        if (!prev) {
          out[def.name] = 'no previous version (render it with sheet or curves first)';
          continue;
        }
        out[def.name] = diffClips(prev, def, rig);
      }
      if (json) return print(out);
      for (const [name, d] of Object.entries(out)) {
        console.log(`${name}:`);
        if (typeof d === 'string') console.log(`  ${d}`);
        else for (const line of d as string[]) console.log(`  ${line}`);
      }
      return;
    }
    case 'overview': {
      const model = await loadModel(character!.model);
      const rest = restPoseOf(model, rig);
      mkdirSync(outDir, { recursive: true });
      const strips: SheetImage[] = [];
      for (const def of pick(args)) {
        const clip = compileClip(def, rig, rest);
        const report = analyzeClip(model, rig, def, clip);
        strips.push(renderSheet(model, rig, def, clip, { views: ['side'], frames: defaultFrames(def, 8), trails: false, skeleton: false, scale: 40, report }));
      }
      const file = join(outDir, 'overview.png');
      writeFileSync(file, encodePng(stack(strips)));
      console.log(file);
      return;
    }
    case 'pose': {
      const [name, frameArg] = args;
      if (!name || frameArg === undefined) fail('usage: pose <clip> <frame>');
      const def = pick([name!])[0]!;
      const frame = Number(frameArg);
      const model = await loadModel(character!.model);
      const clip = compileClip(def, rig, restPoseOf(model, rig));
      const authored = sampleClip(def, frame, rig);
      const [s] = sampleFrames(model, rig, clip as AnimationClip, [frame]);
      const r3 = (v: { x: number; y: number; z: number }) => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
      print({
        clip: def.name,
        frame,
        joints: Object.fromEntries(
          rig.joints.map((j) => [j, { r: authored[j]!.r.map((v) => +v.toFixed(1)), p: authored[j]!.p.map((v) => +v.toFixed(3)), s: authored[j]!.s.map((v) => +v.toFixed(3)), world: r3(s!.joints[j]!) }]),
        ),
        soles: Object.fromEntries(Object.entries(s!.soles).map(([k, v]) => [k, { minY: +v.minY.toFixed(3), centre: r3(v.centre) }])),
        trace: Object.fromEntries(Object.entries(s!.trace).map(([k, v]) => [k, r3(v)])),
      });
      return;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  }
}

// ---- version history: .scratch/anim/history/<clip>.last.json / .prev.json -------------
function historyFile(def: ClipDef, which: 'last' | 'prev'): string {
  return join(outDir, 'history', `${def.name}.${which}.json`);
}

/** Record `def` as the latest rendered version; returns the previous different version. */
function remember(def: ClipDef): ClipDef | null {
  mkdirSync(join(outDir, 'history'), { recursive: true });
  const last = historyFile(def, 'last');
  const text = JSON.stringify(def);
  if (existsSync(last) && readFileSync(last, 'utf8') !== text) renameSync(last, historyFile(def, 'prev'));
  writeFileSync(last, text);
  return previous(def);
}

function previous(def: ClipDef): ClipDef | null {
  const prev = historyFile(def, 'prev');
  const last = historyFile(def, 'last');
  // `diff` without a render in between: the last render is the previous version
  if (existsSync(last) && readFileSync(last, 'utf8') !== JSON.stringify(def)) return JSON.parse(readFileSync(last, 'utf8')) as ClipDef;
  return existsSync(prev) ? (JSON.parse(readFileSync(prev, 'utf8')) as ClipDef) : null;
}

/** Human-readable summary of how a clip changed: length, flags, and per-joint deltas. */
function diffClips(a: ClipDef, b: ClipDef, rig: RigSpec): string[] {
  const lines: string[] = [];
  for (const k of ['frames', 'loop', 'speed', 'grounded', 'fast'] as const) if (a[k] !== b[k]) lines.push(`${k}: ${String(a[k])} → ${String(b[k])}`);
  const ka = a.keys.map((k) => k[0]).join(',');
  const kb = b.keys.map((k) => k[0]).join(',');
  if (ka !== kb) lines.push(`keys: [${ka}] → [${kb}]`);
  const n = Math.round(Math.max(a.frames, b.frames) * 2);
  const worst: Record<string, { d: number; f: number; axis: string; from: number; to: number }> = {};
  for (let i = 0; i <= n; i++) {
    const f = i / 2;
    const pa = sampleClip(a, (f / Math.max(a.frames, b.frames)) * a.frames, rig);
    const pb = sampleClip(b, (f / Math.max(a.frames, b.frames)) * b.frames, rig);
    for (const j of rig.joints) {
      const ch: [string, number, number][] = [
        ['rx', pa[j]!.r[0], pb[j]!.r[0]],
        ['ry', pa[j]!.r[1], pb[j]!.r[1]],
        ['rz', pa[j]!.r[2], pb[j]!.r[2]],
        ['px', pa[j]!.p[0] * 100, pb[j]!.p[0] * 100],
        ['py', pa[j]!.p[1] * 100, pb[j]!.p[1] * 100],
        ['pz', pa[j]!.p[2] * 100, pb[j]!.p[2] * 100],
        ['sy', pa[j]!.s[1] * 100, pb[j]!.s[1] * 100],
      ];
      for (const [axis, from, to] of ch) {
        const d = Math.abs(to - from);
        if (d > 0.5 && d > (worst[j]?.d ?? 0)) worst[j] = { d, f, axis, from, to };
      }
    }
  }
  const joints = Object.entries(worst).sort((x, y) => y[1].d - x[1].d);
  for (const [j, w] of joints) lines.push(`${j}.${w.axis}: up to ${w.d.toFixed(1)}${w.axis[0] === 'r' ? '°' : ' (cm or %)'} at f${w.f} (${w.from.toFixed(1)} → ${w.to.toFixed(1)})`);
  if (!lines.length) lines.push('no visible change');
  return lines;
}

function stack(images: SheetImage[]): SheetImage {
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((s, i) => s + i.height, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  let y = 0;
  for (const img of images) {
    for (let row = 0; row < img.height; row++) data.set(img.data.subarray(row * img.width * 4, (row + 1) * img.width * 4), ((y + row) * width) * 4);
    y += img.height;
  }
  for (let i = 3; i < data.length; i += 4) if (!data[i]) data.set([36, 40, 56, 255], i - 3);
  return { width, height, data };
}

// ---- output helpers ---------------------------------------------------------------------
function table(head: string[], rows: (string | number | boolean)[][]): void {
  const cells = [head, ...rows.map((r) => r.map(String))];
  const w = head.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? '').length)));
  for (const [i, r] of cells.entries()) {
    console.log(r.map((c, j) => c.padEnd(w[j]!)).join('  '));
    if (i === 0) console.log(w.map((n) => '-'.repeat(n)).join('  '));
  }
}

function print(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

try {
  await main();
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
