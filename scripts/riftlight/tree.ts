// Passive tree inspector — how agents look at, measure and validate the tree without a browser.
// Run through tsx:  npm run tree -- <command> [...]
//
//   render [--size 2400] [--heat] [--crops] [--alloc id,id]
//                                 .scratch/tree/tree.png: the whole tree, regions coloured,
//                                 keystones labelled. --heat colours nodes by points from the
//                                 nearest start; --crops also writes region-<id>.png zoomed in
//                                 with notable names; --alloc draws a path/allocation.
//   validate [--min-keystone 18]  connectivity, orphans, unique ids, keystone distance, overlap,
//                                 per-node and per-region stat budget; exit 1 on errors
//   stats                         node counts per kind and region, budgets, mod distribution
//   path <from> <to>              shortest path between two nodes (ids or names)
//   search <words...>             nodes matching a search ("fire res", "keystone", "stat:life")
//
// Options for every command: --json (machine-readable output), --seed <s> (default: the game's
// tree), --out <dir> (default .scratch/tree).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, type RGB } from '../../src/engine/animation/raster';
import { PALETTE, type PaletteColor } from '../../src/engine/palette';
import { DEFAULT_TREE_SEED, generateTree, nodeLines, PassiveTree, REGIONS, searchTree, validateTree, type TreeNode } from '../../src/riftlight/tree';
import { encodePng } from '../png';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};
const VALUE_OPTS = new Set(['--seed', '--out', '--size', '--alloc', '--min-keystone']);
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(args[i - 1] ?? ''));
const [command = 'help', ...rest] = positional;
const json = flag('json');
const seedArg = opt('seed', DEFAULT_TREE_SEED);
const seed = /^\d+$/.test(seedArg) ? Number(seedArg) : seedArg;
const outDir = resolve(ROOT, opt('out', '.scratch/tree'));

const nodes = generateTree({ seed });
const tree = new PassiveTree(nodes);

const rgb = (c: PaletteColor | number): RGB => {
  const h = typeof c === 'number' ? c : PALETTE[c];
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
};
const regionColor = (id: string): RGB => (REGIONS.has(id) ? rgb(REGIONS.get(id).color) : rgb('white'));
const regionDim = (id: string): RGB => (REGIONS.has(id) ? rgb(REGIONS.get(id).dim) : rgb('slate'));

function out(file: string, data: Buffer | string): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

function resolveNode(q: string): TreeNode {
  const byId = tree.get(q);
  if (byId) return byId;
  const lower = q.toLowerCase();
  const byName = nodes.find((n) => n.name.toLowerCase() === lower) ?? nodes.find((n) => n.id.endsWith(`:${lower}`));
  if (byName) return byName;
  const found = searchTree(tree, q);
  if (found.length) return tree.node(found[0]!);
  console.error(`no node matches "${q}"`);
  process.exit(2);
}

// ------------------------------------------------------------------ render

function disc(c: Canvas, x: number, y: number, r: number, col: RGB, a = 1): void {
  const ri = Math.max(0.5, r);
  for (let dy = -Math.ceil(ri); dy <= Math.ceil(ri); dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, ri * ri - dy * dy)));
    c.rect(Math.round(x - w), Math.round(y + dy), 2 * w + 1, 1, col, a);
  }
}

function ring(c: Canvas, x: number, y: number, r: number, col: RGB, thick = 1): void {
  const n = Math.max(16, Math.ceil(r * 8));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (let t = 0; t < thick; t++) c.set(x + Math.cos(a) * (r - t), y + Math.sin(a) * (r - t), col);
  }
}

function diamond(c: Canvas, x: number, y: number, r: number, col: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const w = r - Math.abs(dy);
    c.rect(Math.round(x - w), Math.round(y + dy), 2 * w + 1, 1, col);
  }
}

interface View {
  x0: number;
  y0: number;
  scale: number;
  width: number;
  height: number;
}

function heatColor(t: number): RGB {
  const stops: RGB[] = [rgb('lime'), rgb('sand'), rgb('orange'), rgb('red'), rgb('plum')];
  const f = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function draw(view: View, list: readonly TreeNode[], o: { heat?: boolean; labels?: 'keystones' | 'notables'; alloc?: ReadonlySet<string>; title?: string }): Canvas {
  const c = new Canvas(view.width, view.height);
  c.rect(0, 0, view.width, view.height, rgb('ink'));
  const P = (n: { x: number; y: number }) => [(n.x - view.x0) * view.scale, (n.y - view.y0) * view.scale] as const;
  const dist = o.heat ? tree.distances() : null;
  const maxD = dist ? Math.max(...dist.values()) : 1;
  const k = view.scale;
  const thick = k >= 0.9 ? 2 : 1;
  // Links.
  for (const n of list) {
    for (const l of n.links) {
      if (l < n.id) continue;
      const m = tree.get(l);
      if (!m) continue;
      const [ax, ay] = P(n);
      const [bx, by] = P(m);
      const lit = o.alloc && (o.alloc.has(n.id) || tree.roots.has(n.id)) && (o.alloc.has(m.id) || tree.roots.has(m.id));
      const col = lit ? rgb('sand') : n.region === m.region ? regionDim(n.region) : rgb('slate');
      c.line(ax, ay, bx, by, col, 1, lit ? thick + 1 : thick);
    }
  }
  // Nodes.
  for (const n of list) {
    const [x, y] = P(n);
    const col = dist ? heatColor((dist.get(n.id) ?? maxD) / maxD) : regionColor(n.region);
    const lit = o.alloc?.has(n.id) || tree.roots.has(n.id);
    switch (n.kind) {
      case 'small':
        disc(c, x, y, Math.max(1, 7 * k), lit && o.alloc ? rgb('sand') : col);
        break;
      case 'notable':
        disc(c, x, y, Math.max(3, 12 * k), rgb('ink'));
        ring(c, x, y, Math.max(3, 12 * k), rgb('white'));
        disc(c, x, y, Math.max(1.5, 8 * k), lit && o.alloc ? rgb('sand') : col);
        break;
      case 'keystone':
        disc(c, x, y, Math.max(6, 22 * k), rgb('ink'));
        ring(c, x, y, Math.max(6, 22 * k), rgb('sand'), 2);
        disc(c, x, y, Math.max(3.5, 15 * k), col);
        break;
      case 'mastery':
        diamond(c, x, y, Math.max(3, Math.round(12 * k)), rgb('cyan'));
        diamond(c, x, y, Math.max(1, Math.round(6 * k)), col);
        break;
      case 'start':
        disc(c, x, y, Math.max(5, 18 * k), rgb('white'));
        disc(c, x, y, Math.max(3, 12 * k), col);
        break;
      default:
        disc(c, x, y, Math.max(2, 8 * k), rgb('mist'));
    }
  }
  // Labels.
  const label = (n: TreeNode, color: RGB, dy: number) => {
    const [x, y] = P(n);
    const text = n.name.toUpperCase();
    const w = text.length * 6;
    const tx = Math.round(Math.max(2, Math.min(view.width - w - 2, x - w / 2)));
    const ty = Math.round(y + dy);
    c.rect(tx - 2, ty - 2, w + 3, 11, rgb('ink'), 0.75);
    c.text(text, tx, ty, color);
  };
  for (const n of list) {
    if (n.kind === 'keystone') label(n, rgb('sand'), Math.max(8, 24 * k) + 2);
    else if (n.kind === 'start') label(n, rgb('white'), Math.max(7, 20 * k) + 2);
    else if (o.labels === 'notables' && (n.kind === 'notable' || n.kind === 'mastery')) label(n, n.kind === 'mastery' ? rgb('cyan') : rgb('white'), Math.max(5, 14 * k) + 1);
  }
  // Legend.
  if (o.title) {
    c.rect(0, 0, view.width, 14, rgb('night'));
    c.text(o.title, 4, 4, rgb('white'));
    let lx = view.width - 4;
    for (const r of [...REGIONS.all()].reverse()) {
      const t = r.name.toUpperCase();
      lx -= t.length * 6 + 10;
      c.rect(lx, 5, 5, 5, regionColor(r.id));
      c.text(t, lx + 8, 4, regionColor(r.id));
    }
  }
  return c;
}

function bounds(list: readonly TreeNode[], pad: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of list) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x);
    y1 = Math.max(y1, n.y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

function render(): void {
  const size = Number(opt('size', '2400'));
  const b = bounds(nodes, 120);
  const scale = size / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const width = Math.round((b.x1 - b.x0) * scale);
  const height = Math.round((b.y1 - b.y0) * scale) + 14;
  const alloc = opt('alloc', '') ? new Set(opt('alloc', '').split(',').filter(Boolean)) : undefined;
  const title = `RIFTLIGHT PASSIVE TREE  SEED ${String(seed).toUpperCase()}  ${nodes.length} NODES${flag('heat') ? '  HEAT = POINTS FROM START' : ''}`;
  const canvas = draw({ x0: b.x0, y0: b.y0 - 14 / scale, scale, width, height }, nodes, { heat: flag('heat'), labels: 'keystones', ...(alloc ? { alloc } : {}), title });
  const files = [out(join(outDir, flag('heat') ? 'tree-heat.png' : 'tree.png'), encodePng(canvas))];
  if (flag('crops')) {
    for (const r of REGIONS.all()) {
      const own = nodes.filter((n) => n.region === r.id);
      const rb = bounds(own, 80);
      const k = 0.55;
      const view = { x0: rb.x0, y0: rb.y0 - 14 / k, scale: k, width: Math.round((rb.x1 - rb.x0) * k), height: Math.round((rb.y1 - rb.y0) * k) + 14 };
      const near = nodes.filter((n) => n.x >= rb.x0 - 200 && n.x <= rb.x1 + 200 && n.y >= rb.y0 - 200 && n.y <= rb.y1 + 200);
      const crop = draw(view, near, { labels: 'notables', ...(alloc ? { alloc } : {}), title: `${r.name.toUpperCase()}: ${own.length} NODES` });
      files.push(out(join(outDir, `region-${r.id}.png`), encodePng(crop)));
    }
  }
  if (json) console.log(JSON.stringify({ files, nodes: nodes.length, width, height }));
  else for (const f of files) console.log(`wrote ${f.slice(ROOT.length + 1)}`);
}

// ------------------------------------------------------------------ validate / stats / path / search

function validate(): void {
  const report = validateTree(nodes, { minKeystoneDistance: Number(opt('min-keystone', '18')) });
  const errors = report.problems.filter((p) => p.level === 'error');
  if (json) console.log(JSON.stringify({ ok: errors.length === 0, problems: report.problems, stats: { total: report.stats.total, byKind: report.stats.byKind, keystoneDistance: report.stats.keystoneDistance } }));
  else {
    for (const p of report.problems) console.log(`${p.level === 'error' ? '✘' : '!'} ${p.code}: ${p.message}`);
    const kd = Object.values(report.stats.keystoneDistance);
    console.log(`${errors.length ? '✘' : '✔'} ${nodes.length} nodes, ${report.stats.links} links; keystones ${Math.min(...kd)}–${Math.max(...kd)} points from a start; ${errors.length} error(s), ${report.problems.length - errors.length} warning(s)`);
  }
  process.exit(errors.length ? 1 : 0);
}

function stats(): void {
  const s = validateTree(nodes).stats;
  if (json) {
    console.log(JSON.stringify(s));
    return;
  }
  const kinds = ['start', 'small', 'notable', 'mastery', 'keystone', 'total'];
  console.log(`${nodes.length} nodes, ${s.links} links, furthest node ${s.maxDistance} points from a start\n`);
  console.log(['region'.padEnd(8), ...kinds.map((k) => k.padStart(9)), 'budget'.padStart(9)].join(''));
  for (const [r, counts] of Object.entries(s.byRegion)) console.log([r.padEnd(8), ...kinds.map((k) => String(counts[k] ?? 0).padStart(9)), String(s.budget[r]?.total ?? 0).padStart(9)].join(''));
  console.log(['all'.padEnd(8), ...kinds.map((k) => String(k === 'total' ? s.total : (s.byKind[k] ?? 0)).padStart(9))].join(''));
  console.log('\nmod distribution (nodes carrying the stat, budget points):');
  const rows = Object.entries(s.mods).sort((a, b) => b[1].budget - a[1].budget);
  for (const [stat, v] of rows) console.log(`  ${stat.padEnd(24)} ${String(v.count).padStart(5)} ${String(v.budget).padStart(7)}`);
}

function path(): void {
  if (rest.length < 2) {
    console.error('usage: npm run tree -- path <from> <to>');
    process.exit(2);
  }
  const a = resolveNode(rest[0]!);
  const b = resolveNode(rest[1]!);
  const p = tree.path(new Set([a.id]), b.id);
  if (!p) {
    if (json) console.log(JSON.stringify({ from: a.id, to: b.id, path: null }));
    else console.log(`no path from ${a.id} to ${b.id}`);
    process.exit(1);
  }
  const full = [a.id, ...p];
  if (json) console.log(JSON.stringify({ from: a.id, to: b.id, points: p.length, path: full.map((id) => ({ id, name: tree.node(id).name, kind: tree.node(id).kind })) }));
  else {
    console.log(`${a.name} → ${b.name}: ${p.length} points`);
    for (const id of full) {
      const n = tree.node(id);
      console.log(`  ${n.kind.padEnd(8)} ${id.padEnd(34)} ${n.name}${n.kind !== 'small' ? '' : `  (${nodeLines(n).join(', ')})`}`);
    }
  }
}

function search(): void {
  const ids = searchTree(tree, rest.join(' '));
  if (json) console.log(JSON.stringify(ids.map((id) => ({ id, name: tree.node(id).name, kind: tree.node(id).kind, lines: nodeLines(tree.node(id)) }))));
  else {
    for (const id of ids.slice(0, 60)) console.log(`${tree.node(id).kind.padEnd(8)} ${id.padEnd(34)} ${tree.node(id).name}: ${nodeLines(tree.node(id)).join(', ')}`);
    console.log(`${ids.length} match(es)`);
  }
}

const COMMANDS: Record<string, () => void> = { render, validate, stats, path, search };
const run = COMMANDS[command];
if (!run) {
  console.log('usage: npm run tree -- render|validate|stats|path <from> <to>|search <words> [--json] [--seed s] [--out dir]');
  process.exit(command === 'help' ? 0 : 2);
}
run();
