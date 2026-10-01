// Loot inspector CLI: how agents see what the loot system rolls, without a browser.
// Run through tsx:  npm run loot -- <command> [...]
//
//   sim [--depth 20] [--kills 5000] [--seed 1] [--rarity 0] [--quantity 0] [--kph 2400]
//        Simulate kills (90% normal, 8% magic, 2% rare monsters) at one depth and write
//        .scratch/loot/sim-d<depth>.json plus PNG charts: rarity, slot, affix tier, and
//        rarity share by depth (1..60). Prints gold/hour at --kph kills per hour.
//   roll [--seed 1] [--ilvl 40] [--rarity rare] [--base id]
//        Print one rolled item: tooltip text and the mods it gives the StatSheet.
//   tooltip <seed> [--ilvl 40] [--rarity rare] [--base id] [--alt]
//        Render that item's tooltip to .scratch/loot/tooltip-<seed>.png (3x).
//   uniques  List every unique (base, level, mods, flavour) and render them all to
//            .scratch/loot/uniques.png.
//
// Options: --json (machine-readable output), --out <dir>.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, type RGB } from '../../src/engine/animation/raster';
import { Rng } from '../../src/riftlight/core/rng';
import { type Rank, SCALING } from '../../src/riftlight/core/scaling';
import type { Item, Rarity } from '../../src/riftlight/core/types';
import { AFFIXES, BASES, UNIQUES } from '../../src/riftlight/loot/content';
import { RARITY_COLOURS } from '../../src/riftlight/loot/filter';
import { makeUnique, rarityBoost, rarityWeights, RARITIES, rollDrops, rollItem } from '../../src/riftlight/loot/generate';
import { itemMods } from '../../src/riftlight/loot/itemMods';
import { describeItemMods } from '../../src/riftlight/loot/stats';
import type { Painter } from '../../src/riftlight/ui/items/paint';
import { drawTooltip, measureTooltip, tooltipLines } from '../../src/riftlight/ui/items/tooltip';
import { encodePng } from '../png';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const cmd = args[0] ?? 'help';
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : def;
};
const num = (name: string, def: number) => Number(opt(name, String(def)));
const OUT = resolve(ROOT, opt('out', '.scratch/loot'));
const json = flag('json');

const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const TEXT: RGB = [230, 232, 240];
const DIM: RGB = [150, 156, 180];
const AXIS: RGB = [58, 64, 88];

function rasterPainter(c: Canvas, scale: number, ox = 0, oy = 0): Painter {
  return {
    rect: (x, y, w, h, color) => c.rect((ox + x) * scale, (oy + y) * scale, w * scale, h * scale, rgb(color)),
    text: (x, y, s, color) => {
      c.text(s, (ox + x) * scale, (oy + y) * scale, rgb(color), scale);
      return s.length * 6;
    },
  };
}

function save(name: string, c: Canvas): string {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  writeFileSync(file, encodePng(c));
  return file;
}

// ---------------------------------------------------------------- charts

interface Bar {
  label: string;
  value: number;
  color?: RGB;
}

/** A horizontal bar chart: one row per bar, value labels at the bar end. */
function barChart(title: string, bars: readonly Bar[], fmt: (v: number) => string): Canvas {
  const labelW = Math.max(...bars.map((b) => b.label.length)) * 6 + 12;
  const plotW = 360;
  const rowH = 14;
  const c = new Canvas(labelW + plotW + 70, 30 + bars.length * rowH + 10);
  c.text(title, 8, 8, TEXT);
  const max = Math.max(1e-9, ...bars.map((b) => b.value));
  bars.forEach((b, i) => {
    const y = 26 + i * rowH;
    c.text(b.label, 8, y + 2, DIM);
    const w = Math.max(1, Math.round((b.value / max) * plotW));
    c.rect(labelW, y, w, rowH - 4, b.color ?? rgb(0x41a6f6));
    c.text(fmt(b.value), labelW + w + 4, y + 2, TEXT);
  });
  c.rect(labelW - 1, 24, 1, bars.length * rowH, AXIS);
  return c;
}

/** Lines over depth: share of each rarity (one series per rarity, labelled at the end). */
function lineChart(title: string, xs: readonly number[], series: readonly { label: string; color: RGB; ys: readonly number[] }[], yMax: number): Canvas {
  const W = 520;
  const H = 260;
  const L = 44;
  const T = 26;
  const pw = W - L - 90;
  const ph = H - T - 30;
  const c = new Canvas(W, H);
  c.text(title, 8, 8, TEXT);
  for (let k = 0; k <= 4; k++) {
    const y = T + ph - (k / 4) * ph;
    c.rect(L, Math.round(y), pw, 1, AXIS);
    c.text(`${Math.round((k / 4) * yMax * 100)}%`, 4, Math.round(y) - 3, DIM);
  }
  const x0 = xs[0]!;
  const x1 = xs[xs.length - 1]!;
  const px = (x: number) => L + ((x - x0) / (x1 - x0)) * pw;
  const py = (v: number) => T + ph - (Math.min(v, yMax) / yMax) * ph;
  for (const x of [x0, Math.round((x0 + x1) / 2), x1]) c.text(`D${x}`, Math.round(px(x)) - 6, T + ph + 8, DIM);
  for (const s of series) for (let i = 1; i < xs.length; i++) c.line(px(xs[i - 1]!), py(s.ys[i - 1]!), px(xs[i]!), py(s.ys[i]!), s.color, 1, 2);
  // End labels, pushed apart so converging lines stay readable.
  const ends = series.map((s) => ({ s, y: Math.round(py(s.ys[s.ys.length - 1]!)) - 3 })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 10);
  for (const e of ends) c.text(e.s.label, Math.round(px(x1)) + 6, e.y, TEXT);
  return c;
}

// ---------------------------------------------------------------- commands

const RANK_MIX: readonly [Rank, number][] = [
  ['normal', 0.9],
  ['magic', 0.08],
  ['rare', 0.02],
];

function sim(): void {
  const depth = num('depth', 20);
  const kills = num('kills', 5000);
  const seed = num('seed', 1);
  const kph = num('kph', 2400);
  const itemRarity = num('rarity', 0);
  const itemQuantity = num('quantity', 0);
  const rng = new Rng(seed).fork(`sim:${depth}`);
  const rarity: Record<string, number> = { normal: 0, magic: 0, rare: 0, unique: 0, currency: 0, gem: 0 };
  const slots: Record<string, number> = {};
  const tiers: number[] = [];
  const affixes: Record<string, number> = {};
  const uniques: Record<string, number> = {};
  let gold = 0;
  let items = 0;
  for (let k = 0; k < kills; k++) {
    const rank = rng.weighted(RANK_MIX, (r) => r[1])[0];
    const d = rollDrops(rng.fork(`kill:${k}`), { depth, rank, itemRarity, itemQuantity });
    gold += d.gold;
    for (const it of d.items) {
      items++;
      const slot = BASES.get(it.base).slot;
      const cls = slot === 'currency' ? 'currency' : slot === 'gem' ? 'gem' : it.rarity;
      rarity[cls] = (rarity[cls] ?? 0) + 1;
      slots[slot] = (slots[slot] ?? 0) + 1;
      if (it.unique) uniques[it.unique] = (uniques[it.unique] ?? 0) + 1;
      for (const a of it.affixes) {
        const n = AFFIXES.get(a.id).tiers.length - a.tier; // T1 = best
        tiers[n] = (tiers[n] ?? 0) + 1;
        affixes[a.id] = (affixes[a.id] ?? 0) + 1;
      }
    }
  }
  const goldPerHour = Math.round((gold / kills) * kph);
  const summary = {
    depth,
    kills,
    seed,
    itemLevel: SCALING.monsterLevel(depth),
    rarityBoost: rarityBoost(depth, itemRarity),
    items,
    itemsPerKill: items / kills,
    rarity,
    slots,
    tiers: Object.fromEntries(tiers.map((v, t) => [`T${t}`, v ?? 0]).filter(([, v]) => v)),
    topAffixes: Object.fromEntries(Object.entries(affixes).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    uniques,
    gold,
    goldPerKill: gold / kills,
    goldPerHour,
    killsPerHour: kph,
  };
  mkdirSync(OUT, { recursive: true });
  const base = `sim-d${depth}`;
  writeFileSync(join(OUT, `${base}.json`), JSON.stringify(summary, null, 2));
  const pctOf = (v: number) => `${v} (${((v / Math.max(1, items)) * 100).toFixed(1)}%)`;
  const files = [
    save(
      `${base}-rarity.png`,
      barChart(
        `DEPTH ${depth}: ${items} ITEMS FROM ${kills} KILLS (ILVL ${summary.itemLevel})`,
        Object.entries(rarity).map(([k, v]) => ({ label: k.toUpperCase(), value: v, color: rgb(RARITY_COLOURS[k as Rarity | 'currency' | 'gem']) })),
        pctOf,
      ),
    ),
    save(
      `${base}-slots.png`,
      barChart(
        `DEPTH ${depth}: DROPS BY SLOT`,
        Object.entries(slots)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => ({ label: k.toUpperCase(), value: v })),
        pctOf,
      ),
    ),
    save(
      `${base}-tiers.png`,
      barChart(
        `DEPTH ${depth}: AFFIX TIERS (T1 = BEST)`,
        tiers.map((v, t) => ({ label: `T${t}`, value: v ?? 0 })).filter((b) => b.value),
        (v) => String(v),
      ),
    ),
  ];
  // Rarity share by depth (equipment rolls only, from the weights: no sampling noise).
  const xs = Array.from({ length: 60 }, (_, i) => i + 1);
  const share = (r: Rarity) =>
    xs.map((d) => {
      const w = rarityWeights(rarityBoost(d, itemRarity));
      const total = RARITIES.reduce((s, k) => s + w[k], 0);
      return w[r] / total;
    });
  files.push(
    save(
      'rarity-by-depth.png',
      lineChart(
        'RARITY SHARE OF EQUIPMENT DROPS BY DEPTH',
        xs,
        RARITIES.map((r) => ({ label: r.toUpperCase(), color: rgb(RARITY_COLOURS[r]), ys: share(r) })),
        0.8,
      ),
    ),
  );
  if (json) console.log(JSON.stringify({ ...summary, files }, null, 2));
  else {
    console.log(`depth ${depth} (item level ${summary.itemLevel}, rarity boost ${summary.rarityBoost.toFixed(2)}), ${kills} kills → ${items} items (${summary.itemsPerKill.toFixed(3)}/kill)`);
    console.log(`rarity  ${Object.entries(rarity).map(([k, v]) => `${k} ${pctOf(v)}`).join('  ')}`);
    console.log(`gold    ${gold} total, ${summary.goldPerKill.toFixed(1)}/kill, ${goldPerHour}/hour at ${kph} kills/hour`);
    console.log(`tiers   ${Object.entries(summary.tiers).map(([k, v]) => `${k} ${v}`).join('  ')}`);
    console.log(`uniques ${Object.keys(uniques).length} different, ${Object.values(uniques).reduce((a, b) => a + b, 0)} total`);
    for (const f of [join(OUT, `${base}.json`), ...files]) console.log(`wrote ${f}`);
  }
}

function itemFromArgs(seedArg: string): Item {
  const seed = Number(seedArg);
  const rarity = opt('rarity', 'rare') as Rarity;
  const base = opt('base', '');
  if (!RARITIES.includes(rarity)) throw new Error(`--rarity must be one of ${RARITIES.join(', ')}`);
  return rollItem(new Rng(Number.isFinite(seed) ? seed : seedArg), { itemLevel: num('ilvl', 40), rarity, ...(base ? { base } : {}) });
}

function roll(): void {
  const item = itemFromArgs(opt('seed', '1'));
  const mods = itemMods(item);
  if (json) {
    console.log(JSON.stringify({ item, mods }, null, 2));
    return;
  }
  for (const l of tooltipLines(item, { showTiers: true })) console.log(l.sep ? '  ----' : `  ${l.text}`);
  console.log('\nStatSheet mods (source item:<slot>):');
  for (const m of mods) console.log(`  ${m.stat} ${m.kind} ${m.value}${m.tags ? ` [${m.tags.join(',')}]` : ''}${m.when ? ` when ${m.when}` : ''}`);
}

function tooltip(): void {
  const seedArg = args[1] && !args[1].startsWith('--') ? args[1] : opt('seed', '1');
  const item = itemFromArgs(seedArg);
  const lines = tooltipLines(item, { showTiers: flag('alt') });
  const size = measureTooltip(lines);
  const scale = 3;
  const c = new Canvas((size.w + 8) * scale, (size.h + 8) * scale);
  drawTooltip(rasterPainter(c, scale, 4, 4), 0, 0, lines);
  const file = save(`tooltip-${seedArg}.png`, c);
  if (json) console.log(JSON.stringify({ item, file }, null, 2));
  else console.log(`${item.name} (${item.rarity} ${BASES.get(item.base).name}) → ${file}`);
}

function uniques(): void {
  const all = UNIQUES.all();
  if (json) console.log(JSON.stringify(all, null, 2));
  else
    for (const u of all) {
      console.log(`${u.name}  (${BASES.get(u.base).name}, level ${u.level}${u.weight !== undefined ? `, weight ${u.weight}` : ''})`);
      for (const t of describeItemMods(u.mods)) console.log(`    ${t}`);
      console.log(`    "${u.flavour}"`);
    }
  // A sheet with every unique's tooltip.
  const tips = all.map((u) => tooltipLines(makeUnique(new Rng(1), u.id)));
  const sizes = tips.map(measureTooltip);
  const cols = 6;
  const cw = Math.max(...sizes.map((s) => s.w)) + 6;
  const rows = Math.ceil(tips.length / cols);
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...sizes.slice(r * cols, r * cols + cols).map((s) => s.h)) + 6);
  const scale = 2;
  const c = new Canvas((cols * cw + 6) * scale, (rowH.reduce((a, b) => a + b, 0) + 6) * scale);
  let y = 6;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const i = r * cols + k;
      if (i < tips.length) drawTooltip(rasterPainter(c, scale), 6 + k * cw, y, tips[i]!);
    }
    y += rowH[r]!;
  }
  const file = save('uniques.png', c);
  if (!json) console.log(`\n${all.length} uniques → ${file}`);
}

const COMMANDS: Record<string, () => void> = { sim, roll, tooltip, uniques };
const run = COMMANDS[cmd];
if (!run) {
  console.log('usage: npm run loot -- sim|roll|tooltip|uniques [options]   (see scripts/riftlight/loot.ts)');
  process.exit(cmd === 'help' ? 0 : 1);
}
run();
