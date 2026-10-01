// Combat inspector for agents: what a skill does with its supports, as numbers.
//
//   npm run combat -- dps <skill> [support ...] [options]
//   npm run combat -- list                       every skill and support, with tags
//   npm run combat -- supports <skill>           supports that fit a skill
//
// Options:
//   --level 5                 gem level (supports: `gmp@3`)
//   --stats build.json        the character: { "base": { "life": 300 }, "mods": [Mod, ...] } or just [Mod, ...]
//   --weapon 8-14             weapon physical damage (attacks; default 6-11, crit 5%)
//   --vs armour=500,evasion=300,res=0.4,res.cold=0.6,block=0.2,life=500   the target's defences
//   --targets 3               how many enemies each use can reach (areas, chains, pierce)
//   --json                    machine-readable output (also written to .scratch/combat/<skill>.json)
//
// It prints the resolved skill (tags, cost, cast time, delivery after supports), the hit
// breakdown per damage type (base → scaled → mitigated), crits, ailments and their damage
// over time, hits per second, DPS (single target and over --targets), and mana per second.
// The numbers are the same functions the game uses (combat/damage.ts expectedHit), through
// src/riftlight/balance/dps.ts, the model `npm run balance` uses too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flat, StatSheet, type Mod } from '../../src/riftlight/core/mods';
import { DAMAGE_TYPES } from '../../src/riftlight/core/types';
import type { Defender } from '../../src/riftlight/combat/damage';
import { ACTOR_BASE } from '../../src/riftlight/combat/tuning';
import { round, skillDps, type DpsReport as Report } from '../../src/riftlight/balance/dps';
import { SKILLS, SUPPORTS, buildSkill, supportsFor, type SupportLink } from '../../src/riftlight/skills';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const k = a.slice(2);
    flags.set(k, ['level', 'stats', 'weapon', 'vs', 'targets'].includes(k) ? (argv[++i] ?? '') : true);
  } else pos.push(a);
}
const json = flags.has('json');
const fail = (m: string): never => {
  console.error(m);
  process.exit(2);
};

const [cmd, ...rest] = pos;
if (!cmd || cmd === 'help') {
  console.log('npm run combat -- dps <skill> [support[@level] ...] [--level n] [--stats file.json] [--weapon 8-14] [--vs armour=500,res=0.4] [--targets 3] [--json]');
  console.log('npm run combat -- list | supports <skill>');
  process.exit(0);
}

if (cmd === 'list') {
  const out = { skills: SKILLS.all().map((s) => ({ id: s.id, delivery: s.delivery.kind, tags: s.tags })), supports: SUPPORTS.all().map((s) => ({ id: s.id, requires: s.requires, excludes: s.excludes ?? [] })) };
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${out.skills.length} skills:`);
    for (const s of out.skills) console.log(`  ${s.id.padEnd(18)} ${s.delivery.padEnd(10)} ${s.tags!.join(' ')}`);
    console.log(`\n${out.supports.length} supports:`);
    for (const s of out.supports) console.log(`  ${s.id.padEnd(24)} needs ${s.requires.join('+')}${s.excludes.length ? `  not ${s.excludes.join(',')}` : ''}`);
  }
  process.exit(0);
}

if (cmd === 'supports') {
  const id = rest[0] ?? fail('which skill?');
  if (!SKILLS.has(id)) fail(`no skill "${id}" (npm run combat -- list)`);
  const fits = supportsFor(id).map((s) => s.id);
  console.log(json ? JSON.stringify(fits) : fits.join('\n'));
  process.exit(0);
}

if (cmd !== 'dps') fail(`unknown command "${cmd}"`);
const skillId = rest[0] ?? fail('which skill? (npm run combat -- list)');
if (!SKILLS.has(skillId)) fail(`no skill "${skillId}" (npm run combat -- list)`);
const links: SupportLink[] = rest.slice(1).map((s) => {
  const [id, lvl] = s.split('@');
  if (!SUPPORTS.has(id!)) fail(`no support "${id}" (npm run combat -- list)`);
  return lvl ? { gem: id!, level: Number(lvl) } : id!;
});

// ---- the character
const sheet = new StatSheet();
const base: Record<string, number> = { ...ACTOR_BASE };
let mods: Mod[] = [];
if (flags.has('stats')) {
  const file = resolve(process.cwd(), String(flags.get('stats')));
  const data = JSON.parse(readFileSync(file, 'utf8')) as Mod[] | { base?: Record<string, number>; mods?: Mod[] };
  if (Array.isArray(data)) mods = data;
  else {
    Object.assign(base, data.base ?? {});
    mods = data.mods ?? [];
  }
}
sheet.set('base', Object.entries(base).map(([k, v]) => flat(k, v)));
sheet.set('build', mods);
const [wlo, whi] = String(flags.get('weapon') ?? '6-11').split('-').map(Number);
sheet.set('weapon', [flat('weapon.physical.min', wlo ?? 6), flat('weapon.physical.max', whi ?? wlo ?? 11), flat('weapon.crit', 0.05)]);

// ---- the target
const vs: Record<string, number> = {};
for (const kv of String(flags.get('vs') ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  vs[k!] = Number(v);
}
const targetSheet = new StatSheet();
const tmods: Mod[] = [flat('damage.taken', 1)];
for (const [k, v] of Object.entries(vs)) {
  if (k === 'res') for (const t of ['fire', 'cold', 'lightning']) tmods.push(flat(`res.${t}`, v));
  else if (k === 'block') tmods.push(flat('block.chance', v), flat('spell.block', v));
  else if (k !== 'life') tmods.push(flat(k, v));
}
targetSheet.set('target', tmods);
const target: Defender = { stats: targetSheet, life: vs.life ?? 1000, maxLife: vs.life ?? 1000, es: 0, shock: 0 };
const targets = Math.max(1, Number(flags.get('targets') ?? 1));

// ---- resolve
const level = Number(flags.get('level') ?? 1);
const skill = buildSkill(skillId, links, sheet, { level });
const report = skillDps(sheet, skill, target, targets);
mkdirSync(join(ROOT, '.scratch/combat'), { recursive: true });
const out = join(ROOT, `.scratch/combat/${skillId}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
if (json) console.log(JSON.stringify(report, null, 2));
else print(report);

function print(r: Report): void {
  const line = (k: string, v: string) => console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`${r.skill} (level ${r.level})${r.supports.length ? ` + ${r.supports.join(', ')}` : ''}`);
  if (r.unsupported.length) console.log(`  ! not linked (don't fit): ${r.unsupported.join(', ')}`);
  line('tags', r.tags.join(' '));
  line('delivery', JSON.stringify(r.delivery));
  line('cost', `${r.cost} mana${r.cooldown ? `, cooldown ${r.cooldown}s` : ''}`);
  line('cast time', `${r.castTime}s${r.repeats > 1 ? ` × ${r.repeats} repeats` : ''}${r.area !== 1 ? `, area ×${r.area}` : ''}`);
  if (r.hit) {
    console.log('  hit');
    const types = DAMAGE_TYPES.filter((t) => r.hit!.perHit[t] || r.hit!.base[t]);
    console.log(`    ${'type'.padEnd(10)} ${'base'.padEnd(14)} ${'scaled'.padEnd(9)} vs target`);
    for (const t of types) {
      const b = r.hit.base[t];
      console.log(`    ${t.padEnd(10)} ${(b ? `${b[0]}-${b[1]}` : '-').padEnd(14)} ${String(r.hit.perHit[t] ?? 0).padEnd(9)} ${r.hit.mitigated[t] ?? 0}`);
    }
    console.log(`    crit ${(r.hit.critChance * 100).toFixed(1)}% × ${r.hit.critMultiplier}   lands ${(r.hit.landChance * 100).toFixed(0)}%   average ${r.hit.average}`);
    for (const [id, a] of Object.entries(r.hit.ailments)) console.log(`    ${id.padEnd(8)} ${(a!.chance * 100).toFixed(0)}% per hit${a!.dps ? `, ${round(a!.dps)} dps` : ''}`);
  }
  line('hits/s', `${r.hitsPerSecond} (per use: ${r.hitsPerUse.single} on one, ${r.hitsPerUse.pack} on ${targets})`);
  line('DPS', `${r.dps.total} (hits ${r.dps.hit} + dots ${r.dps.dot}), vs ${targets} target${targets > 1 ? 's' : ''}: ${r.dps.pack}`);
  line('mana/s', String(r.manaPerSecond));
  for (const n of r.notes) console.log(`  · ${n}`);
  console.log(`  wrote ${out.slice(ROOT.length + 1)}`);
}

