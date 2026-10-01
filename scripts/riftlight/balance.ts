// Balance sim CLI: build archetypes × depth, headless, from the game's real code.
// Run through tsx:  npm run balance -- [options]
//
// For every build (melee, caster, bow, minion) naked and geared, and every simulated depth
// (designed levels 1–12, then rifts), it reports time to kill a normal, magic and rare
// monster and the boss; damage taken per second, hits to die and time to die; clear time
// per level; and the XP curve (the hero's level after each depth with the real formula).
// Writes .scratch/balance/: balance.json, balance.csv, xp.csv and PNG charts (ttk.png,
// survival.png, clear.png, balance.png = all of them), and prints the worst outliers.
//
// Options:
//   --depths 1-12,15,20      depths to simulate (default 1-12 then every 4th to --max)
//   --max 60                 deepest depth (the XP curve plans every depth up to it)
//   --builds melee,caster    build archetypes (default all: melee caster bow minion)
//   --variants naked,geared  (default both)
//   --seed 1                 run seed (levels, genomes, gear rolls)
//   --samples 6              genomes per depth and rank
//   --candidates 12          rares rolled per gear slot
//   --uptime 0.5             share of time a monster attacks
//   --raw                    no stat aliases: count only stats combat reads by their exact name
//   --top 5                  outliers to print
//   --json                   machine-readable output (the same as balance.json)
//   --out .scratch/balance
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../../src/riftlight/core/rng';
import type { Rank } from '../../src/riftlight/core/scaling';
import { DAMAGE_TYPES } from '../../src/riftlight/core/types';
import { AILMENTS } from '../../src/riftlight/combat/ailments';
import { WEAPON_CLASSES } from '../../src/riftlight/combat/tuning';
import { planLevel } from '../../src/riftlight/levels/plan';
import { levelSpec } from '../../src/riftlight/levels/rift';
import { buildBoss, buildMonster, designedBoss, generateBoss, generateGenome, genomeBudget, MECHANIC_THEMES } from '../../src/riftlight/monsters';
import {
  BUILDS,
  DEFAULT_ASSUMPTIONS,
  describeAssumptions,
  findOutliers,
  GRADES,
  runBalance,
  type Assumptions,
  type DepthInput,
  type Grade,
  type MonsterInput,
  type Row,
  type Variant,
} from '../../src/riftlight/balance';
import { renderBalanceCharts } from '../../src/riftlight/balance/charts';
import { encodePng } from '../png';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const VALUED = ['depths', 'max', 'builds', 'variants', 'seed', 'samples', 'candidates', 'uptime', 'top', 'out'];
const flags = new Map<string, string | true>();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  if (k === 'help') {
    console.log('npm run balance -- [--depths 1-12,20] [--max 60] [--builds melee,caster,bow,minion] [--variants naked,geared] [--seed 1] [--samples 6] [--candidates 12] [--uptime 0.5] [--raw] [--top 5] [--json] [--out dir]');
    process.exit(0);
  }
  flags.set(k, VALUED.includes(k) ? (argv[++i] ?? '') : true);
}
const opt = (k: string, d: string) => String(flags.get(k) ?? d);
const json = flags.has('json');
const OUT = resolve(ROOT, opt('out', '.scratch/balance'));
const seed = Number(opt('seed', '1'));
const max = Math.max(1, Number(opt('max', '60')));

function parseDepths(s: string): number[] {
  const out = new Set<number>();
  for (const part of s.split(',').filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`bad --depths "${part}" (use 1-12,15,20-60/5)`);
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    const step = Number(m[3] ?? 1);
    for (let d = a; d <= b; d += step) out.add(d);
  }
  return [...out].filter((d) => d >= 1 && d <= max).sort((x, y) => x - y);
}
const defaultDepths = [...Array.from({ length: 12 }, (_, i) => i + 1), ...Array.from({ length: Math.max(0, Math.floor((max - 12) / 4)) }, (_, i) => 16 + i * 4)].filter((d) => d <= max);
const depths = flags.has('depths') ? parseDepths(opt('depths', '')) : defaultDepths;
const builds = flags.has('builds') ? opt('builds', '').split(',').map((id) => BUILDS.find((b) => b.id === id) ?? fail(`no build "${id}" (have ${BUILDS.map((b) => b.id).join(', ')})`)) : BUILDS;
const variants = (flags.has('variants') ? opt('variants', '').split(',') : ['naked', 'geared']) as Variant[];
const assumptions: Assumptions = {
  ...DEFAULT_ASSUMPTIONS,
  samples: Number(opt('samples', String(DEFAULT_ASSUMPTIONS.samples))),
  gearCandidates: Number(opt('candidates', String(DEFAULT_ASSUMPTIONS.gearCandidates))),
  monsterUptime: Number(opt('uptime', String(DEFAULT_ASSUMPTIONS.monsterUptime))),
  aliases: !flags.has('raw'),
};

function fail(m: string): never {
  console.error(m);
  process.exit(2);
}
const log = (m: string) => {
  if (!json) process.stderr.write(m);
};

// ---------------------------------------------------------------- inputs (levels + genomes)

const t0 = performance.now();
const sim = new Set(depths);
const inputs: DepthInput[] = [];
log(`planning ${max} depths`);
for (let d = 1; d <= Math.max(max, ...depths); d++) {
  const spec = levelSpec(d, seed);
  const plan = planLevel(spec);
  const packs = plan.packs.map((p) => p.members.map((m) => m.rank).filter((r) => r !== 'boss')).filter((p) => p.length);
  const input: { -readonly [K in keyof DepthInput]: DepthInput[K] } = { depth: d, name: spec.name, path: plan.layout.path.length, packs };
  if (sim.has(d)) {
    const power = plan.packs.length ? plan.packs.reduce((s, p) => s + p.power, 0) / plan.packs.length : 0;
    const tags = [...new Set(spec.mechanics.flatMap((m) => MECHANIC_THEMES[m] ?? []))];
    const monsters = {} as Record<Grade, MonsterInput[]>;
    for (const g of GRADES) {
      monsters[g] = [];
      for (let i = 0; i < assumptions.samples; i++) {
        const archetype = spec.archetypes?.[i % spec.archetypes.length];
        const genome = generateGenome(new Rng(seed).fork(`balance:${d}:${g}:${i}`), { depth: d, rank: g as Rank, archetype, tags: tags.length ? tags : undefined, budget: genomeBudget(d, g as Rank) + power });
        const m = buildMonster(genome);
        monsters[g].push({ id: `${g}:${i}`, rank: g, depth: d, mods: m.stats, skills: m.skills, archetype: genome.archetype, plan: genome.plan });
      }
    }
    input.monsters = monsters;
    const boss = d <= 12 ? designedBoss(d) : generateBoss(new Rng(seed).fork(`boss:${d}`), d, spec.mechanics);
    const bm = buildBoss(boss);
    input.boss = { id: boss.id, name: boss.name, rank: 'boss', depth: d, mods: bm.stats, skills: bm.skills, archetype: boss.genome.archetype, plan: boss.genome.plan, phases: boss.phases.map((p) => p.mods ?? []), enrage: boss.enrage };
  }
  inputs.push(input);
  log('.');
}
const tInputs = performance.now() - t0;
log(` ${(tInputs / 1000).toFixed(1)} s\nsimulating ${builds.length} builds × ${variants.length} variants × ${depths.length} depths`);

// ---------------------------------------------------------------- run

const result = runBalance(inputs, { builds, variants, seed, assumptions, onRow: () => log('.') });
const tSim = performance.now() - t0 - tInputs;
log(` ${(tSim / 1000).toFixed(1)} s\n`);
const outliers = findOutliers(result.rows);

/**
 * Who reads a dead stat? A static scan of src/riftlight for the stat's name as a string
 * (content tables, UI, tools and tests excluded) plus the names combat builds from damage
 * types and ailments. 'runtime': something outside the sim reads it (movement, loot,
 * mechanics); 'none': no reader by that name anywhere, so the mod does nothing.
 */
function staticReaders(): Set<string> {
  const names = new Set<string>();
  const skip = /([\\/](data|ui|balance)[\\/])|\.test\.ts$|[\\/]loot[\\/]stats\.ts$|lootlab|levelLab/;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !skip.test(p)) for (const m of readFileSync(p, 'utf8').matchAll(/['"`]([a-zA-Z][\w.]*)['"`]/g)) names.add(m[1]!);
    }
  };
  walk(join(ROOT, 'src/riftlight'));
  for (const t of DAMAGE_TYPES) for (const k of [`${t}.damage`, `res.${t}`, `res.max.${t}`, `pen.${t}`, `added.${t}.min`, `added.${t}.max`, `weapon.${t}.min`, `weapon.${t}.max`, `no.${t}`]) names.add(k);
  for (const a of AILMENTS.all()) for (const k of [`${a.id}.chance`, `avoid.${a.id}`, `${a.id}.threshold`, `${a.id}.damage`, `${a.id}.effect`, `${a.id}.duration`]) names.add(k);
  for (const c of WEAPON_CLASSES) names.add(`weapon.${c}`); // HeroController: skills tagged bow / wand need one
  return names;
}
const readers = staticReaders();
const deadStats = result.deadStats.map((d) => ({ ...d, reader: readers.has(d.stat) ? ('runtime' as const) : ('none' as const) }));

// ---------------------------------------------------------------- write

mkdirSync(OUT, { recursive: true });
const report = {
  tool: 'npm run balance',
  seed,
  depths,
  builds: builds.map((b) => ({ id: b.id, name: b.name, skill: b.skill, supports: b.supports, weapon: b.weapon, offhand: b.offhand })),
  variants,
  assumptions: { ...assumptions, lines: describeAssumptions(assumptions) },
  aliasesUsed: result.aliasesUsed,
  deadStats,
  outliers,
  xp: result.xp,
  rows: result.rows,
  ms: { inputs: Math.round(tInputs), sim: Math.round(tSim) },
};
writeFileSync(join(OUT, 'balance.json'), JSON.stringify(report, (_k, v) => (v === Infinity ? 'Infinity' : v), 2));

const COLS: [string, (r: Row) => string | number][] = [
  ['build', (r) => r.build],
  ['variant', (r) => r.variant],
  ['depth', (r) => r.depth],
  ['level', (r) => r.level],
  ['gem_level', (r) => r.gemLevel],
  ['points', (r) => r.points],
  ['tree_nodes', (r) => r.tree],
  ['item_level', (r) => r.itemLevel],
  ['life', (r) => r.life],
  ['es', (r) => r.es],
  ['armour', (r) => r.armour],
  ['evasion', (r) => r.evasion],
  ['res', (r) => r.res.toFixed(3)],
  ['dps', (r) => r.dps.toFixed(1)],
  ['pack_dps', (r) => r.packDps.toFixed(1)],
  ['sustain', (r) => r.sustain.toFixed(2)],
  ...(['normal', 'magic', 'rare', 'boss'] as const).flatMap((g): [string, (r: Row) => string | number][] => [
    [`ttk_${g}`, (r) => r.ttk[g].toFixed(2)],
    [`dtps_${g}`, (r) => r.dtps[g].toFixed(1)],
    [`hits_to_die_${g}`, (r) => r.hitsToDie[g].toFixed(1)],
    [`time_to_die_${g}`, (r) => (Number.isFinite(r.timeToDie[g]) ? r.timeToDie[g].toFixed(1) : 'inf')],
  ]),
  ['boss_dies', (r) => (r.bossDies ? 1 : 0)],
  ['boss_enraged', (r) => (r.bossEnraged ? 1 : 0)],
  ['clear_walk', (r) => r.clear.walk.toFixed(0)],
  ['clear_packs', (r) => r.clear.packs.toFixed(0)],
  ['clear_boss', (r) => r.clear.boss.toFixed(0)],
  ['clear_total', (r) => r.clear.total.toFixed(0)],
  ['deadly_packs', (r) => r.deadlyPacks],
];
writeFileSync(join(OUT, 'balance.csv'), [COLS.map((c) => c[0]).join(','), ...result.rows.map((r) => COLS.map((c) => c[1](r)).join(','))].join('\n') + '\n');
writeFileSync(join(OUT, 'xp.csv'), ['depth,name,normal,magic,rare,boss,xp,level_before,level_after', ...result.xp.map((x) => `${x.depth},"${inputs[x.depth - 1]!.name}",${x.kills.normal},${x.kills.magic},${x.kills.rare},${x.kills.boss},${x.xp},${x.levelBefore},${x.levelAfter}`)].join('\n') + '\n');
const charts = renderBalanceCharts(result, builds, { seed, raw: !assumptions.aliases });
const files: string[] = [];
for (const [name, img] of Object.entries(charts)) {
  const f = join(OUT, `${name}.png`);
  writeFileSync(f, encodePng(img));
  files.push(f);
}

// ---------------------------------------------------------------- print

if (json) {
  console.log(JSON.stringify({ ...report, files }, (_k, v) => (v === Infinity ? 'Infinity' : v), 2));
} else {
  const top = Number(opt('top', '5'));
  const rel = (f: string) => f.slice(ROOT.length + 1);
  const t = (v: number) => (!Number.isFinite(v) ? '∞' : v >= 100 ? v.toFixed(0) : v.toFixed(1));
  console.log(`balance: ${builds.length} builds × ${variants.length} variants × ${depths.length} depths (seed ${seed}${assumptions.aliases ? '' : ', --raw'}) in ${((tInputs + tSim) / 1000).toFixed(1)} s`);
  const show = depths.filter((d) => [1, 6, 12, 20, 40, max].includes(d) || d === depths[depths.length - 1]);
  console.log(`\n  ${'build'.padEnd(15)} ${'depth'.padStart(5)} ${'lvl'.padStart(4)} ${'dps'.padStart(7)} ${'ttk n/m/r'.padStart(16)} ${'boss'.padStart(6)} ${'hits'.padStart(5)} ${'clear'.padStart(6)}`);
  for (const r of result.rows.filter((x) => show.includes(x.depth))) {
    console.log(`  ${`${r.build}/${r.variant}`.padEnd(15)} ${String(r.depth).padStart(5)} ${String(r.level).padStart(4)} ${t(r.dps).padStart(7)} ${`${t(r.ttk.normal)}/${t(r.ttk.magic)}/${t(r.ttk.rare)}`.padStart(16)} ${t(r.ttk.boss).padStart(6)} ${t(r.hitsToDie.boss).padStart(5)} ${`${(r.clear.total / 60).toFixed(1)}m`.padStart(6)}${r.bossDies ? '  dies to boss' : ''}`);
  }
  const lv = result.xp.filter((x) => [1, 6, 12, 20, 30, 40, 60].includes(x.depth)).map((x) => `d${x.depth}→L${x.levelAfter}`);
  console.log(`\n  XP curve (level after each depth): ${lv.join('  ')}`);
  console.log(`\n  worst ${Math.min(top, outliers.length)} of ${outliers.length} outliers:`);
  for (const o of outliers.slice(0, top)) console.log(`  ! ${o.text}`);
  if (result.aliasesUsed.length) console.log(`\n  stat aliases applied (contract gaps; --raw to turn off): ${result.aliasesUsed.join('; ')}`);
  const none = deadStats.filter((d) => d.reader === 'none');
  const runtime = deadStats.filter((d) => d.reader === 'runtime');
  if (none.length) console.log(`  stats the builds carry that nothing reads by that name (they do nothing): ${none.slice(0, 14).map((s) => `${s.stat} (${s.mods})`).join(', ')}${none.length > 14 ? ', …' : ''}`);
  if (runtime.length) console.log(`  read only outside the sim (movement, loot, mechanics; not modelled): ${runtime.slice(0, 10).map((s) => s.stat).join(', ')}${runtime.length > 10 ? ', …' : ''}`);
  console.log(`\n  assumptions:`);
  for (const l of describeAssumptions(assumptions)) console.log(`  · ${l}`);
  console.log(`\n  wrote ${[join(OUT, 'balance.json'), join(OUT, 'balance.csv'), join(OUT, 'xp.csv'), ...files].map(rel).join(', ')}`);
}
