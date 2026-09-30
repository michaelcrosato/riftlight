// Animation workbench CLI — how agents look at, measure and iterate on animations
// without a browser. Run through tsx:  npm run anim -- <command> [...]
//
//   list                         clips with length, loop, speed, notes
//   check [clip...]              validate + metrics table; exit 1 on problems
//   sheet <clip...|all> [opts]   PNG contact sheet(s) → .scratch/anim/<clip>.png
//        --frames 0,4,8  --views side,front,three,top  --scale 64  --no-trails  --no-skeleton
//   overview [clip...]           one PNG, a side-view strip per clip → .scratch/anim/overview.png
//   pose <clip> <frame>          JSON: authored joint rotations + world positions at that frame
//
// Options for every command: --json (machine-readable output), --out <dir>.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  analyzeClip,
  compileClip,
  defaultFrames,
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Character {
  model: string;
  rig: RigSpec;
  clips: readonly ClipDef[];
}

const CHARACTERS: Record<string, Character> = {
  hero: { model: HERO_MODEL, rig: HERO_RIG, clips: HERO_CLIPS },
};

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const next = argv[i + 1];
    const valued = ['frames', 'views', 'scale', 'out', 'character'].includes(a.slice(2));
    flags.set(a.slice(2), valued && next !== undefined ? next : true);
    if (valued) i++;
  } else args.push(a);
}
const command = args.shift() ?? 'help';
const json = flags.has('json');
const outDir = resolve(ROOT, String(flags.get('out') ?? '.scratch/anim'));
const character = CHARACTERS[String(flags.get('character') ?? 'hero')];
if (!character) fail(`unknown character; have: ${Object.keys(CHARACTERS).join(', ')}`);

async function loadModel(url: string): Promise<Object3D> {
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
      const model = await loadModel(character!.model);
      const rest = restPoseOf(model, rig);
      const defs = pick(args);
      const reports: (ClipReport & { errors: string[] })[] = [];
      for (const def of defs) {
        const errors = validateClip(def, rig);
        const report = analyzeClip(model, rig, def, compileClip(def, rig, rest));
        reports.push({ ...report, errors });
      }
      const bad = reports.filter((r) => r.errors.length || r.problems.length);
      if (json) print(reports);
      else {
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
      if (bad.length) process.exitCode = 1;
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
        const img = renderSheet(model, rig, def, clip, {
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

// ---- tiny PNG encoder (RGBA8, no filtering) --------------------------------------------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf: Uint8Array): number {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(img: SheetImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width * 4 + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * img.width * 4, img.width * 4).copy(raw, y * (img.width * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
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

await main();
