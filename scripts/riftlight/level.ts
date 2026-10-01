// Riftlight levels, for agents: see a level before playing it.
//
//   npm run level -- map <depth|seed> [--seed S]   top-down map PNG → .scratch/levels/<name>.png
//   npm run level -- validate [from..to] [--seed S] reachability, bypass guarantee, rooms,
//                                                 budget, overlaps, build time (exit 1 on problems)
//   npm run level -- rift <seed> <depth>           a rift's spec + its map
//   npm run level -- themes                        theme swatch sheet (+ rift palette shifts)
//
// `map 7` is designed level 7 (depths 13+ are rifts of run seed --seed, default 1); a number
// ≥ 1000 is a rift seed at depth 13. Everything is headless: plans, not the renderer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Canvas, type RGB } from '../../src/engine/animation/raster';
import { Rng } from '../../src/riftlight/core/rng';
import type { LevelSpec } from '../../src/riftlight/core/types';
import { FLOOR, VOID, WALL } from '../../src/riftlight/levels/layout/grid';
import { MECHANICS } from '../../src/riftlight/levels/mechanics';
import type { LevelPlan } from '../../src/riftlight/levels/plan';
import { levelSpec, riftSpec } from '../../src/riftlight/levels/rift';
import { luminance, riftShift, shiftTheme } from '../../src/riftlight/levels/themes/palette';
import { THEMES, type LevelTheme } from '../../src/riftlight/levels/themes/themes';
import { validateSpec } from '../../src/riftlight/levels/validate';
import { encodePng } from '../png';

const OUT = '.scratch/levels';
const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const RANK: Record<string, RGB> = { normal: [200, 200, 210], magic: [65, 166, 246], rare: [255, 205, 117], boss: [255, 64, 96] };

function args() {
  const a = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith('--')) flags[a[i]!.slice(2)] = a[++i] ?? '';
    else pos.push(a[i]!);
  }
  return { cmd: pos[0] ?? 'help', pos: pos.slice(1), flags };
}

function specFor(arg: string, runSeed: number): LevelSpec {
  const n = Number(arg);
  if (!Number.isFinite(n) || n < 1) throw new Error(`not a depth or seed: ${arg}`);
  return n >= 1000 ? riftSpec(n, 13) : levelSpec(n, runSeed);
}

// ------------------------------------------------------------------ map

function drawMap(plan: LevelPlan, report: ReturnType<typeof validateSpec>['report']): Canvas {
  const { layout, theme } = plan;
  // Crop to the level (generators may not use the whole grid).
  let bx0 = layout.width;
  let bz0 = layout.height;
  let bx1 = 0;
  let bz1 = 0;
  for (let z = 0; z < layout.height; z++)
    for (let x = 0; x < layout.width; x++)
      if (layout.cells[z * layout.width + x] !== VOID || plan.dynamicFloor[z * layout.width + x]) {
        bx0 = Math.min(bx0, x);
        bz0 = Math.min(bz0, z);
        bx1 = Math.max(bx1, x);
        bz1 = Math.max(bz1, z);
      }
  bx0 = Math.max(0, bx0 - 2);
  bz0 = Math.max(0, bz0 - 2);
  const cw = Math.min(layout.width, bx1 + 3) - bx0;
  const ch = Math.min(layout.height, bz1 + 3) - bz0;
  const S = Math.max(4, Math.min(10, Math.floor(860 / Math.max(cw, ch))));
  const legendW = 300;
  const mapW = cw * S;
  const mapH = ch * S;
  const full = new Canvas(layout.width * S + legendW, Math.max(layout.height * S, 560));
  const c = full;
  const floorC = mix(rgb(theme.palette.floor), [255, 255, 255], 0.15);
  const floorAlt = rgb(theme.floorAlt);
  const wallC = mix(rgb(theme.palette.wall), [255, 255, 255], 0.1);
  const W = layout.width;
  // Cells.
  for (let z = 0; z < layout.height; z++)
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const v = layout.cells[i];
      if (plan.dynamicFloor[i]) c.rect(x * S, z * S, S, S, mix(floorC, [0, 0, 0], 0.35));
      else if (v === FLOOR) c.rect(x * S, z * S, S, S, ((x >> 1) + (z >> 1)) & 1 ? floorAlt : floorC);
      else if (v === WALL) c.rect(x * S, z * S, S, S, wallC);
      else if (v === VOID) c.rect(x * S, z * S, S, S, [16, 18, 26]);
    }
  // Mechanic elements.
  for (const e of plan.elements) {
    const col = rgb(MECHANICS.get(e.mechanic).color);
    for (const i of e.cells) {
      const x = i % W;
      const z = (i - x) / W;
      if (e.block === 'solid') {
        c.rect(x * S, z * S, S, S, [0, 0, 0]);
        c.rect(x * S + 1, z * S + 1, S - 2, S - 2, col);
      } else if (e.block === 'zone') c.rect(x * S, z * S, S, S, col, 0.9);
      else {
        // Hazards: a diagonal hatch, so areas read without hiding the floor.
        for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) c.set(x * S + xx, z * S + yy, col, (xx + yy) % 3 === 0 ? 1 : 0.45);
      }
    }
  }
  // Rooms (outline + id/role), critical rooms brighter.
  for (const r of layout.rooms) {
    const col: RGB = r.critical ? [255, 255, 255] : [150, 156, 180];
    const x0 = r.x * S;
    const z0 = r.z * S;
    c.line(x0, z0, x0 + r.w * S, z0, col, 0.35);
    c.line(x0, z0 + r.h * S, x0 + r.w * S, z0 + r.h * S, col, 0.35);
    c.line(x0, z0, x0, z0 + r.h * S, col, 0.35);
    c.line(x0 + r.w * S, z0, x0 + r.w * S, z0 + r.h * S, col, 0.35);
    c.text(`${r.id}${r.tags[0]![0]!.toUpperCase()}`, x0 + 2, z0 + 2, col);
  }
  // Critical path.
  for (let k = 1; k < layout.path.length; k++) {
    const a = layout.path[k - 1]!;
    const b = layout.path[k]!;
    c.line(a.x * S + S / 2, a.z * S + S / 2, b.x * S + S / 2, b.z * S + S / 2, [255, 230, 90], 0.9, 2);
  }
  // Props (blocking ones as dark dots), features, packs.
  for (const p of plan.props) c.rect(Math.floor(p.x) * S + S / 2 - 1, Math.floor(p.z) * S + S / 2 - 1, 2, 2, p.blocks ? [20, 20, 24] : p.kind === 'torch' || p.kind === 'lantern' ? [255, 170, 60] : [110, 110, 120]);
  for (const f of plan.features) {
    const x = Math.floor(f.x) * S;
    const z = Math.floor(f.z) * S;
    c.rect(x - 1, z - 1, S + 2, S + 2, [0, 0, 0]);
    c.rect(x, z, S, S, f.kind === 'chest' ? [255, 205, 117] : [115, 239, 247]);
  }
  for (const p of plan.packs)
    for (const m of p.members) {
      const r = m.rank === 'boss' ? S : m.rank === 'rare' ? S - 1 : S - 3;
      const x = Math.floor(m.x * S - r / 2);
      const z = Math.floor(m.z * S - r / 2);
      c.rect(x - 1, z - 1, r + 2, r + 2, [0, 0, 0]);
      c.rect(x, z, r, r, RANK[m.rank]!);
    }
  // Start and exit.
  const mark = (x: number, z: number, col: RGB, label: string) => {
    c.rect(x * S - S, z * S - S, S * 3, S * 3, [0, 0, 0]);
    c.rect(x * S - S + 1, z * S - S + 1, S * 3 - 2, S * 3 - 2, col);
    c.text(label, x * S - 2, z * S - 3, [0, 0, 0]);
  };
  mark(layout.start.x, layout.start.z, [56, 183, 100], 'S');
  mark(layout.exit.x, layout.exit.z, [115, 239, 247], 'X');

  // Legend (drawn right of the full grid, moved beside the crop at the end).
  const lx = layout.width * S + 12;
  let y = 10;
  const line = (s: string, col: RGB = [230, 232, 240]) => {
    c.text(s, lx, y, col);
    y += 10;
  };
  line(`${plan.spec.depth}. ${plan.spec.name}`.toUpperCase(), [255, 205, 117]);
  line(`${theme.name} / ${layout.style} / seed ${plan.spec.seed}`.toUpperCase(), [150, 156, 180]);
  y += 4;
  for (const [k, v] of Object.entries(report.stats)) line(`${k}: ${v}`.toUpperCase());
  y += 4;
  line(report.ok ? 'VALID: BYPASS + REACH OK' : 'PROBLEMS:', report.ok ? [56, 183, 100] : [255, 70, 90]);
  for (const p of report.problems.slice(0, 6)) line(p.toUpperCase().slice(0, 44), [255, 70, 90]);
  y += 6;
  const swatch = (col: RGB, label: string, a = 1) => {
    c.rect(lx, y, 8, 8, [0, 0, 0]);
    c.rect(lx + 1, y + 1, 6, 6, col, a);
    c.text(label.toUpperCase(), lx + 12, y + 1, [230, 232, 240]);
    y += 11;
  };
  for (const id of plan.spec.mechanics) {
    const m = MECHANICS.get(id);
    const kinds = new Map<string, number>();
    for (const e of plan.elements) if (e.mechanic === id) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
    swatch(rgb(m.color), `${m.name}: ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`);
  }
  y += 4;
  swatch(floorC, 'floor');
  swatch(wallC, 'wall');
  swatch([16, 18, 26], 'void / pit');
  swatch(mix(floorC, [0, 0, 0], 0.35), 'crumbling floor');
  swatch([255, 230, 90], 'critical path');
  swatch([56, 183, 100], 'S start');
  swatch([115, 239, 247], 'X exit portal / shrine');
  swatch([255, 205, 117], 'chest / rare');
  for (const r of ['normal', 'magic', 'boss']) swatch(RANK[r]!, `${r} monster`);
  swatch([255, 170, 60], 'torch / lantern');
  swatch([20, 20, 24], 'solid prop');
  // Crop the map part and put the legend beside it.
  const out = new Canvas(mapW + legendW, Math.max(mapH, 560));
  for (let y2 = 0; y2 < mapH; y2++)
    for (let x2 = 0; x2 < mapW; x2++) {
      const si = ((y2 + bz0 * S) * full.width + x2 + bx0 * S) * 4;
      const di = (y2 * out.width + x2) * 4;
      for (let k = 0; k < 4; k++) out.data[di + k] = full.data[si + k]!;
    }
  for (let y2 = 0; y2 < Math.min(out.height, full.height); y2++)
    for (let x2 = 0; x2 < legendW; x2++) {
      const si = (y2 * full.width + layout.width * S + x2) * 4;
      const di = (y2 * out.width + mapW + x2) * 4;
      for (let k = 0; k < 4; k++) out.data[di + k] = full.data[si + k]!;
    }
  return out;
}

function writeMap(spec: LevelSpec): string {
  const { plan, report } = validateSpec(spec);
  const canvas = drawMap(plan, report);
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}/${spec.depth <= 12 ? String(spec.depth).padStart(2, '0') + '-' : ''}${slug(spec.name)}.png`;
  writeFileSync(file, encodePng({ width: canvas.width, height: canvas.height, data: canvas.data } as never));
  console.log(`${report.ok ? '✔' : '✘'} ${spec.name}: ${file}`);
  for (const p of report.problems) console.log(`    ✘ ${p}`);
  for (const w of report.warnings) console.log(`    · ${w}`);
  return file;
}

// ------------------------------------------------------------------ themes

function drawThemes(): Canvas {
  const themes = THEMES.all();
  const rowH = 46;
  const c = new Canvas(940, 24 + themes.length * rowH);
  c.text('THEMES (LEFT) AND THREE RIFT SHIFTS EACH (RIGHT), WITH FLOOR/WALL CONTRAST', 8, 8, [230, 232, 240]);
  const swatches = (t: LevelTheme, x: number, y: number, label: string) => {
    const cols: [string, number][] = [
      ['floor', t.palette.floor],
      ['alt', t.floorAlt],
      ['wall', t.palette.wall],
      ['trim', t.trim],
      ['acc', t.palette.accent],
      ['light', t.palette.light],
      ['fog', t.palette.fog],
      ['cliff', t.cliff],
    ];
    cols.forEach(([, v], k) => c.rect(x + k * 14, y, 13, 18, rgb(v)));
    // A tiny iso-ish "room" preview: floor diamond, wall strip, torch dot.
    const px = x + cols.length * 14 + 4;
    c.rect(px, y, 30, 6, rgb(t.trim));
    c.rect(px, y + 6, 30, 6, rgb(t.palette.wall));
    for (let k = 0; k < 6; k++) c.rect(px + k * 5, y + 12, 5, 6, rgb(k % 2 ? t.floorAlt : t.palette.floor));
    c.rect(px + 13, y + 9, 3, 3, rgb(t.palette.light));
    const contrast = (luminance(t.palette.floor) + 0.05) / (luminance(t.palette.wall) + 0.05);
    c.text(label.toUpperCase(), x, y + 22, [230, 232, 240]);
    c.text(`C ${contrast.toFixed(2)}`, x, y + 31, contrast >= 1.25 ? [150, 156, 180] : [255, 70, 90]);
  };
  themes.forEach((t, i) => {
    const y = 24 + i * rowH;
    swatches(t, 8, y, t.name);
    const rng = new Rng(i + 1);
    for (let k = 0; k < 3; k++) {
      const s = riftShift(rng, 20 + k * 20);
      swatches(shiftTheme(t, s), 190 + k * 250, y, `${t.id} hue ${s.hue}`);
    }
  });
  return c;
}

// ------------------------------------------------------------------ main

const { cmd, pos, flags } = args();
const runSeed = Number(flags.seed ?? 1) || 1;
switch (cmd) {
  case 'map': {
    for (const a of pos.length ? pos : ['1']) writeMap(specFor(a, runSeed));
    break;
  }
  case 'rift': {
    const seed = Number(pos[0] ?? 1);
    const depth = Number(pos[1] ?? 13);
    const spec = riftSpec(seed, Math.max(13, depth));
    console.log(JSON.stringify({ ...spec, boss: spec.boss ? { plan: spec.boss.plan, archetype: spec.boss.archetype, scale: +spec.boss.scale.toFixed(2) } : null }, null, 2));
    writeMap(spec);
    break;
  }
  case 'validate': {
    const range = pos[0] ?? '1..60';
    const [a, b] = range.split(/\.\.|-/).map(Number);
    const from = a ?? 1;
    const to = b ?? from;
    let bad = 0;
    const t0 = Date.now();
    for (let d = from; d <= to; d++) {
      const spec = levelSpec(d, runSeed);
      const { report } = validateSpec(spec);
      const s = report.stats;
      console.log(`${report.ok ? '✔' : '✘'} ${String(d).padStart(3)} ${spec.name.padEnd(40)} ${String(s.style).padEnd(8)} rooms ${s.rooms} path ${s.path} el ${s.elements} packs ${s.packs} budget ${s.budget} ${s.ms} ms`);
      for (const p of report.problems) console.log(`      ✘ ${p}`);
      for (const w of report.warnings) console.log(`      · ${w}`);
      if (!report.ok) bad++;
    }
    console.log(`\n${bad ? `✘ ${bad} level(s) with problems` : `✔ ${to - from + 1} levels valid`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    process.exit(bad ? 1 : 0);
    break;
  }
  case 'themes': {
    const c = drawThemes();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/themes.png`, encodePng({ width: c.width, height: c.height, data: c.data } as never));
    console.log(`✔ ${OUT}/themes.png`);
    break;
  }
  default:
    console.log('usage: npm run level -- map <depth|seed> | validate [from..to] | rift <seed> <depth> | themes   [--seed S]');
    process.exit(cmd === 'help' ? 0 : 1);
}
