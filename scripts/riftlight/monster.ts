// Monster generator CLI — how agents look at and check generated monsters without a
// browser. Run through tsx:  npm run monster -- <command> [...]
//
//   gen <seed> [--plan p --archetype a --depth d --rank r --tags fire,undead]
//                         print the genome, its stats, skills, clips (hit frames) as JSON
//   sheet <seed> [same]   .scratch/monsters/<seed>.png: turntable + rig overlay, then one
//                         strip per clip (contact sheet rows with metrics)
//   zoo <n> [--seed s --cols c --plan p ...]
//                         .scratch/monsters/zoo.png: n random monsters across plans
//   check [n] [--seed s]  build n random genomes (default 60) plus every plan × archetype:
//                         build time, clip metrics (floor, sliding, seams), NaNs, bounds;
//                         exits 1 on problems
//   boss <level|seed> [--rift --depth d]
//                         a designed boss (1..12) or a generated rift boss: genome, phases, sheet
//
// Options: --json (machine-readable), --out <dir>.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultFrames, renderSheet, type SheetImage } from '../../src/engine/animation';
import { describeMod } from '../../src/riftlight/core/mods';
import { Rng } from '../../src/riftlight/core/rng';
import type { Rank } from '../../src/riftlight/core/scaling';
import {
  ARCHETYPES,
  BOSSES,
  buildMonster,
  checkMonster,
  clearMonsterCache,
  generateBoss,
  generateGenome,
  genomeBudget,
  grid,
  PARTS,
  PLANS,
  renderPortrait,
  stack,
  type BuiltMonster,
  type Genome,
  type GenomeOptions,
} from '../../src/riftlight/monsters';
import { encodePng } from '../png';

process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const args: string[] = [];
const VALUED = ['plan', 'archetype', 'depth', 'rank', 'tags', 'out', 'seed', 'cols', 'depth'];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const next = argv[i + 1];
    flags.set(k, VALUED.includes(k) && next !== undefined ? next : true);
    if (VALUED.includes(k)) i++;
  } else args.push(a);
}
const command = args.shift() ?? 'help';
const json = flags.has('json');
const outDir = resolve(ROOT, String(flags.get('out') ?? '.scratch/monsters'));

function options(): GenomeOptions {
  const o: GenomeOptions = {};
  if (flags.has('plan')) o.plan = String(flags.get('plan'));
  if (flags.has('archetype')) o.archetype = String(flags.get('archetype'));
  if (flags.has('depth')) o.depth = Number(flags.get('depth'));
  if (flags.has('rank')) o.rank = String(flags.get('rank')) as Rank;
  if (flags.has('tags')) o.tags = String(flags.get('tags')).split(',');
  return o;
}

const seedOf = (s: string | undefined) => (s === undefined ? 1 : /^\d+$/.test(s) ? Number(s) : s);

function summary(m: BuiltMonster) {
  const g = m.genome;
  return {
    genome: g,
    plan: g.plan,
    archetype: g.archetype,
    rank: g.rank,
    parts: g.parts.map((p) => `${p.socket}: ${PARTS.get(p.part).name} (${p.part}, cost ${PARTS.get(p.part).cost ?? 1})`),
    cost: m.cost,
    budget: +genomeBudget(Number(flags.get('depth') ?? 1), g.rank).toFixed(2),
    skills: m.skills,
    stats: m.stats.map((s) => describeMod(s)),
    clips: m.clipNames.map((n) => m.clipInfo(n)!).map((c) => ({ name: c.name, kind: c.kind, frames: c.frames, loop: c.loop, speed: c.speed, hitFrame: c.hitFrame })),
    radius: +m.radius.toFixed(3),
    height: +m.height.toFixed(3),
    joints: m.rig.joints.length,
    buildMs: +m.ms.toFixed(2),
  };
}

function write(name: string, img: SheetImage): string {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, name);
  writeFileSync(file, encodePng(img));
  return file;
}

/** Turntable (4 views) with the rig, then a strip per clip. */
function sheet(m: BuiltMonster, title: string): SheetImage {
  const object = m.object;
  object.scale.setScalar(1);
  const views = [0, 50, 90, 180].map((yaw, i) => renderPortrait(object, { width: 220, height: 220, yaw, pitch: 18, label: i === 0 ? title : `yaw ${yaw}`, sublabel: i === 0 ? `${m.genome.plan} · ${m.genome.archetype} · ${m.genome.rank}` : undefined, skeleton: i === 3 ? undefined : m.rig.joints }));
  const head = grid(views, 4, 4);
  const strips = m.defs.map((def, i) => {
    const frames = defaultFrames(def, 8);
    if (def.hit !== undefined && !frames.includes(def.hit)) frames.push(def.hit);
    frames.sort((a, b) => a - b);
    return renderSheet(object, m.rig, def, m.clips[i]!, { views: ['side', 'three'], frames, trails: !!def.loop, scale: Math.min(64, 140 / Math.max(0.6, m.skeleton.height)), report: checkClip(m, i) });
  });
  object.scale.setScalar(m.genome.scale);
  return stack([head, ...strips]);
}

const reports = new Map<string, ReturnType<typeof checkMonster>>();
function checkClip(m: BuiltMonster, i: number) {
  const key = JSON.stringify(m.genome);
  let r = reports.get(key);
  if (!r) reports.set(key, (r = checkMonster(m.genome, m)));
  return r.clips[i];
}

function main(): void {
  switch (command) {
    case 'gen': {
      const seed = seedOf(args[0]);
      const m = buildMonster(generateGenome(new Rng(seed), options()));
      console.log(JSON.stringify(summary(m), null, 2));
      return;
    }
    case 'sheet': {
      const seed = seedOf(args[0]);
      const m = buildMonster(generateGenome(new Rng(seed), options()));
      const file = write(`${seed}.png`, sheet(m, `seed ${seed}`));
      if (json) console.log(JSON.stringify({ file, ...summary(m) }, null, 2));
      else console.log(file);
      return;
    }
    case 'zoo': {
      const n = Number(args[0] ?? 36);
      const base = new Rng(seedOf(String(flags.get('seed') ?? 'zoo')));
      const plans = PLANS.all().map((p) => p.id);
      const imgs: SheetImage[] = [];
      const rows: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const o = options();
        const g = generateGenome(base.fork(i), { plan: o.plan ?? plans[i % plans.length], ...o });
        const m = buildMonster(g);
        m.object.scale.setScalar(1);
        imgs.push(renderPortrait(m.object, { width: 150, height: 150, yaw: 35 + (i % 3) * 10, label: `${g.plan}`, sublabel: `${g.archetype} ${g.rank === 'normal' ? '' : g.rank}` }));
        rows.push({ i, plan: g.plan, archetype: g.archetype, parts: g.parts.map((p) => p.part) });
      }
      const file = write('zoo.png', grid(imgs, Number(flags.get('cols') ?? Math.ceil(Math.sqrt(n * 1.6)))));
      if (json) console.log(JSON.stringify({ file, monsters: rows }, null, 2));
      else console.log(file);
      return;
    }
    case 'check': {
      const n = Number(args[0] ?? 60);
      const base = new Rng(seedOf(String(flags.get('seed') ?? 'check')));
      const genomes: Genome[] = [];
      for (const plan of PLANS.all()) for (const arch of ARCHETYPES.all()) genomes.push(generateGenome(base.fork(`${plan.id}:${arch.id}`), { plan: plan.id, archetype: arch.id }));
      for (let i = 0; i < n; i++) genomes.push(generateGenome(base.fork(i), { depth: 1 + (i % 30), rank: (['normal', 'normal', 'magic', 'rare', 'boss'] as const)[i % 5] }));
      for (const b of BOSSES.all()) genomes.push(b.genome);
      clearMonsterCache();
      let bad = 0;
      let warned = 0;
      const times: number[] = [];
      const cached: number[] = [];
      const clipTimes: number[] = [];
      const out: unknown[] = [];
      for (const g of genomes) {
        const r = checkMonster(g);
        times.push(r.ms);
        cached.push(r.msCached);
        clipTimes.push(r.clipMs);
        if (r.problems.length) bad++;
        if (r.warnings.length) warned++;
        out.push({ plan: g.plan, archetype: g.archetype, rank: g.rank, ms: +r.ms.toFixed(2), clipMs: +r.clipMs.toFixed(1), problems: r.problems, warnings: r.warnings });
        if (!json && r.problems.length) for (const p of r.problems) console.log(`  ✗ ${g.plan}/${g.archetype} (seed ${g.seed}): ${p}`);
      }
      for (const v of [times, cached, clipTimes]) v.sort((a, b) => a - b);
      const stat = (v: number[]) => ({ median: +v[Math.floor(v.length / 2)]!.toFixed(2), p95: +v[Math.floor(v.length * 0.95)]!.toFixed(2), max: +v[v.length - 1]!.toFixed(2) });
      const result = { monsters: genomes.length, withProblems: bad, withWarnings: warned, buildMs: stat(times), cachedBuildMs: stat(cached), allClipsMs: stat(clipTimes) };
      if (json) console.log(JSON.stringify({ ...result, monsters: out }, null, 2));
      else {
        console.log(`\n${genomes.length} monsters (${PLANS.size} plans × ${ARCHETYPES.size} archetypes, ${n} random, ${BOSSES.size} bosses)`);
        console.log(`buildMonster ms (new shape):            median ${result.buildMs.median}  p95 ${result.buildMs.p95}  max ${result.buildMs.max}`);
        console.log(`buildMonster ms (shape seen, pack mate): median ${result.cachedBuildMs.median}  p95 ${result.cachedBuildMs.p95}  max ${result.cachedBuildMs.max}`);
        console.log(`all clips of a new shape ms (lazy, on first play, once per shape): median ${result.allClipsMs.median}  p95 ${result.allClipsMs.p95}  max ${result.allClipsMs.max}`);
        console.log(`${bad} with problems, ${warned} with warnings`);
      }
      if (bad) process.exitCode = 1;
      return;
    }
    case 'boss': {
      const arg = args[0] ?? '1';
      const boss = flags.has('rift') ? generateBoss(new Rng(seedOf(arg)), Number(flags.get('depth') ?? 15), String(flags.get('tags') ?? 'gale,embers').split(',')) : BOSSES.all().find((b) => String(b.level) === arg || b.id === arg);
      if (!boss) throw new Error(`no boss ${arg}; designed levels are 1..12`);
      const m = buildMonster(boss.genome);
      const file = write(`boss-${boss.id}.png`, sheet(m, boss.name));
      const info = { file, id: boss.id, name: boss.name, level: boss.level, phases: boss.phases, enrage: boss.enrage, signature: boss.signature, ...summary(m) };
      if (json) console.log(JSON.stringify(info, null, 2));
      else console.log(`${boss.name}\n${file}\nphases: ${boss.phases.map((p) => `${Math.round(p.from * 100)}%: ${p.attacks.join(', ')}`).join(' | ')}`);
      return;
    }
    default:
      console.log(
        readFileHeader()
      );
  }
}

function readFileHeader(): string {
  return `npm run monster -- gen <seed> | sheet <seed> | zoo <n> | check [n] | boss <level> (see scripts/riftlight/monster.ts)`;
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(2);
}
