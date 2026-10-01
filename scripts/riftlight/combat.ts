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
// The numbers are the same functions the game uses (combat/damage.ts expectedHit).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flat, StatSheet, type Mod } from '../../src/riftlight/core/mods';
import { DAMAGE_TYPES, type AilmentType, type DamageType } from '../../src/riftlight/core/types';
import { AILMENTS } from '../../src/riftlight/combat/ailments';
import { baseRanges, expectedHit, mitigateDot, sumDamage, type Damage, type Defender } from '../../src/riftlight/combat/damage';
import { StatQuery } from '../../src/riftlight/combat/stats';
import { ACTOR_BASE, FINISHER } from '../../src/riftlight/combat/tuning';
import { SKILLS, SUPPORTS, buildSkill, supportsFor, type ResolvedSkill, type SupportLink } from '../../src/riftlight/skills';

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
const report = analyse(skill);
mkdirSync(join(ROOT, '.scratch/combat'), { recursive: true });
const out = join(ROOT, `.scratch/combat/${skillId}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
if (json) console.log(JSON.stringify(report, null, 2));
else print(report);

interface Report {
  skill: string;
  level: number;
  tags: readonly string[];
  supports: readonly string[];
  unsupported: readonly string[];
  delivery: ResolvedSkill['delivery'];
  cost: number;
  castTime: number;
  cooldown: number;
  repeats: number;
  area: number;
  hit: null | {
    base: Partial<Record<DamageType, [number, number]>>;
    perHit: Damage;
    mitigated: Damage;
    critChance: number;
    critMultiplier: number;
    landChance: number;
    average: number;
    ailments: Partial<Record<AilmentType, { chance: number; dps: number }>>;
  };
  hitsPerSecond: number;
  /** Hits on one target per use and per use over --targets. */
  hitsPerUse: { single: number; pack: number };
  dps: { hit: number; dot: number; total: number; pack: number };
  manaPerSecond: number;
  notes: string[];
}

function analyse(s: ResolvedSkill): Report {
  const notes: string[] = [];
  const d = s.delivery;
  const q = new StatQuery(sheet, s.mods);
  const spec = s.damage;
  // uses per second (cooldowns cap it)
  const usePeriod = Math.max(s.castTime, s.cooldown);
  let uses = usePeriod > 0 ? 1 / usePeriod : 0;
  let perUse = 1;
  let pack = 1;
  let scale = 1;
  switch (d.kind) {
    case 'strike':
      if (s.anims.length > 1) {
        scale = (s.anims.length - 1 + FINISHER.damage) / s.anims.length;
        notes.push(`combo of ${s.anims.length}: the last hit deals ${FINISHER.damage}× (averaged in)`);
      }
      perUse = s.repeats;
      pack = s.repeats * targets;
      break;
    case 'projectile': {
      const hitsOne = Math.min(d.count, 1 + Math.floor((d.count - 1) / 3)); // a fan rarely lands every arrow on one target
      perUse = s.repeats * hitsOne;
      pack = Math.max(perUse, s.repeats * Math.min(targets, d.count + d.chain + d.pierce + (d.fork ?? 0) * 2));
      if (s.def.explode) pack = Math.max(pack, perUse * targets);
      if (s.def.explode) notes.push(`explodes in ${(s.def.explode * Math.sqrt(s.area)).toFixed(1)} m (splash counted in pack)`);
      if (d.chain) notes.push(`chains ${d.chain}×`);
      if (d.pierce) notes.push(`pierces ${d.pierce}`);
      if (d.fork) notes.push(`forks ${d.fork}×`);
      break;
    }
    case 'nova':
    case 'beam':
      if (s.channel) {
        const period = d.kind === 'beam' ? Math.max(0.05, d.tick / s.speed) : Math.max(0.12, 0.3 / s.speed);
        uses = 1 / period;
        scale = s.def.tickDamage ?? 1;
        notes.push(`channelled: ${uses.toFixed(1)} ticks/s at ${Math.round(scale * 100)}% of a hit`);
      }
      perUse = s.repeats;
      pack = s.repeats * targets;
      break;
    case 'trap':
      if (s.def.zone) {
        uses = 1 / Math.max(0.1, s.def.zone.tick);
        scale = s.def.tickDamage ?? 0.25;
        notes.push(`burning ground: ${uses.toFixed(1)} ticks/s while standing in it for ${d.duration.toFixed(1)} s`);
      }
      pack = targets;
      break;
    case 'slam':
      perUse = s.repeats;
      pack = s.repeats * targets;
      if (d.delay > 0) notes.push(`lands ${d.delay.toFixed(2)} s after the cast`);
      break;
    case 'summon':
      notes.push(`raises ${d.count} ${d.genome}${d.duration > 0 ? ` for ${d.duration.toFixed(0)} s` : ''}: minion hits use the summoner's 'minion' mods`);
      uses = d.count / 0.8;
      pack = targets;
      break;
    case 'aura':
      notes.push('aura: no damage; buffs allies in range while on');
      break;
    case 'dash':
      pack = targets;
      if (d.hitWidth <= 0) notes.push('movement only');
      break;
  }
  let hit: Report['hit'] = null;
  let hitDps = 0;
  let dotDps = 0;
  if (spec) {
    const e = expectedHit(q, spec, target);
    const perHit = sumDamage(e.mitigated) * e.landChance * scale;
    hitDps = perHit * uses * perUse;
    const ailments: NonNullable<Report['hit']>['ailments'] = {};
    for (const [id, chance] of Object.entries(e.ailments) as [AilmentType, number][]) {
      const def = AILMENTS.get(id);
      if (def.kind !== 'dot') {
        ailments[id] = { chance, dps: 0 };
        continue;
      }
      const src = def.from.reduce((sum, t) => sum + (e.mitigated[t] ?? 0), 0) * scale;
      const tick = mitigateDot(target, def.dotType!, def.magnitude(src, target.maxLife) * q.scale('ailment.effect', spec.tags));
      // stacking ailments add up; the strongest-only ones are up while procs keep coming
      const rate = chance * e.landChance * uses * perUse;
      const dur = def.duration * q.scale('ailment.duration', spec.tags);
      const dps = def.stacks ? tick * rate * dur : tick * Math.min(1, rate * dur);
      ailments[id] = { chance, dps };
      dotDps += dps;
    }
    const ranges = baseRanges(q, spec);
    hit = {
      base: Object.fromEntries(Object.entries(ranges).map(([t, r]) => [t, [round(r[0]), round(r[1])]])) as Partial<Record<DamageType, [number, number]>>,
      perHit: roundD(e.damage),
      mitigated: roundD(e.mitigated),
      critChance: round(e.critChance, 3),
      critMultiplier: round(e.critMultiplier, 2),
      landChance: round(e.landChance, 3),
      average: round(perHit),
      ailments,
    };
  }
  const packMul = perUse > 0 ? pack / perUse : 1;
  const mana = s.channel ? s.cost : s.cost * (usePeriod > 0 ? 1 / usePeriod : 0);
  return {
    skill: s.id,
    level: s.level,
    tags: s.tags,
    supports: s.supports,
    unsupported: s.unsupported,
    delivery: s.delivery,
    cost: s.cost,
    castTime: round(s.castTime, 3),
    cooldown: round(s.cooldown, 2),
    repeats: s.repeats,
    area: round(s.area, 2),
    hit,
    hitsPerSecond: round(uses * perUse, 2),
    hitsPerUse: { single: perUse, pack },
    dps: { hit: round(hitDps), dot: round(dotDps), total: round(hitDps + dotDps), pack: round((hitDps + dotDps) * packMul) },
    manaPerSecond: round(mana, 2),
    notes,
  };
}

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

function round(v: number, digits = 1): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
function roundD(d: Damage): Damage {
  const o: Damage = {};
  for (const t of DAMAGE_TYPES) if (d[t]) o[t] = round(d[t]!);
  return o;
}
