import { Rng } from '../core/rng';
import { SCALING, type Rank } from '../core/scaling';
import type { Genome } from '../core/types';
import { ARCHETYPES } from './brains/archetypes';
import { ELITE_MODS } from './brains/elite';
import { lookOf } from './looks';
import { generatePalette, mixPalettes, shiftPalette, THEME_COLOURS } from './palette';
import { PARTS } from './parts';
import { DEFAULT_HEAD, PLANS } from './plans';
import type { HeadAnchors, MonsterPartDef, Slot } from './types';

/**
 * Genomes: the whole monster as data (seed + plan + parts + genes + palette + scale +
 * archetype + elite mods + rank). `generateGenome` spends a power budget on parts picked by
 * slot and theme tags; `mutate` and `crossover` are Spore-style evolution for rifts and the
 * lab. Everything is deterministic in the Rng passed in.
 */
export interface GenomeOptions {
  /** Depth (1..12 designed, 13+ rifts): sets the budget. Default 1. */
  depth?: number;
  /** Theme tags ('fire', 'undead', 'insect'...): bias parts and colour the palette. */
  tags?: readonly string[];
  archetype?: string;
  plan?: string;
  rank?: Rank;
  /** Override the power budget. */
  budget?: number;
  /** Force parts per slot (a part id, or null to leave the slot empty). */
  parts?: Partial<Record<Slot, string | null>>;
  /** Force gene values (0..1). */
  genes?: Readonly<Record<string, number>>;
  /** Force elite mods. */
  elite?: readonly string[];
  /** Multiply the generated scale. */
  scale?: number;
  /** Floor colour the palette must read against. */
  floor?: number;
}

export const RANK_SCALE: Record<Rank, number> = { normal: 1, magic: 1.08, rare: 1.18, boss: 2.4 };
const RANK_BUDGET: Record<Rank, number> = { normal: 1, magic: 1.25, rare: 1.5, boss: 3 };
const RANK_ELITES: Record<Rank, [number, number]> = { normal: [0, 0], magic: [1, 1], rare: [2, 3], boss: [1, 2] };
/** Slots every plan with them must fill. */
const REQUIRED: readonly Slot[] = ['head', 'eyes'];

/** Power budget for a monster at `depth` and `rank`. */
export function genomeBudget(depth: number, rank: Rank = 'normal'): number {
  return SCALING.monsterBudget(depth) * RANK_BUDGET[rank];
}

/** Power a genome spends on parts. */
export function genomeCost(g: Genome): number {
  return g.parts.reduce((s, p) => s + (PARTS.has(p.part) ? (PARTS.get(p.part).cost ?? 1) : 0), 0);
}

/** The theme tags a genome's parts lean towards (for bolts, palettes, names). */
export function genomeTags(g: Genome): string[] {
  const counts = new Map<string, number>();
  for (const p of g.parts) {
    if (!PARTS.has(p.part)) continue;
    for (const t of PARTS.get(p.part).tags) if (THEME_COLOURS[t]) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** A part fits a slot on a plan. */
export function partFits(p: MonsterPartDef, slot: Slot, plan: string): boolean {
  return p.fits.includes(slot) && (!p.plans || p.plans.includes(plan));
}

export function generateGenome(rng: Rng, o: GenomeOptions = {}): Genome {
  const depth = o.depth ?? 1;
  const rank: Rank = o.rank ?? 'normal';
  const r = {
    seed: rng.fork('seed'),
    pick: rng.fork('pick'),
    genes: rng.fork('genes'),
    parts: rng.fork('parts'),
    palette: rng.fork('palette'),
    elite: rng.fork('elite'),
    scale: rng.fork('scale'),
  };
  const tags = o.tags?.length ? [...o.tags] : [r.pick.pick(Object.keys(THEME_COLOURS))];
  const archetype = o.archetype ? ARCHETYPES.get(o.archetype) : ARCHETYPES.pick(r.pick, { filter: (e) => (rank === 'boss' ? (e as { id: string }).id !== 'swarm' : true) });
  const planId = o.plan ?? r.pick.weighted(Object.entries(archetype.planWeights), ([, w]) => w)[0];
  const plan = PLANS.get(planId);

  const genes: Record<string, number> = {};
  for (const [name, def] of Object.entries(plan.genes)) genes[name] = clamp01(r.genes.gaussian(def.mean, def.spread) + (rank === 'boss' && (name === 'girth' || name === 'headSize') ? 0.12 : 0));
  genes.wingSpan = clamp01(r.genes.gaussian(0.5, 0.2));
  // skin genes (skin.ts), drawn after every older gene so older seeds keep their bodies
  genes.pattern = r.genes.next();
  genes.patternScale = r.genes.next();
  genes.markHue = r.genes.next();
  // silhouette by behaviour (looks.ts): the archetype nudges the body's proportions
  for (const [name, d] of Object.entries(lookOf(archetype.id).genes ?? {})) if (name in genes) genes[name] = clamp01(genes[name]! + d);
  Object.assign(genes, o.genes ?? {});

  const budget = o.budget ?? genomeBudget(depth, rank);
  const parts = pickParts(r.parts, planId, tags, archetype.prefers, budget, rank, o.parts ?? {});
  const palette = generatePalette(r.palette, tags, { vivid: rank !== 'normal', floor: o.floor, harmony: rank === 'boss' ? 'analogous' : undefined });
  const scale = round3(plan.baseScale * archetype.scale * RANK_SCALE[rank] * r.scale.range(0.92, 1.08) * (o.scale ?? 1));
  const elite = o.elite ? [...o.elite] : pickElites(r.elite, archetype.id, rank, depth);
  return { seed: r.seed.int(1, 0x7fffffff), plan: planId, parts, genes: roundGenes(genes), palette, scale, archetype: archetype.id, elite, rank };
}

function pickParts(rng: Rng, plan: string, tags: readonly string[], prefers: readonly string[], budget: number, rank: Rank, forced: Partial<Record<Slot, string | null>>): Genome['parts'] {
  const def = PLANS.get(plan);
  const out: { socket: string; part: string }[] = [];
  let spent = 0;
  const slots = (Object.keys(def.slots) as Slot[]).filter((s) => !REQUIRED.includes(s));
  rng.shuffle(slots);
  for (const slot of [...REQUIRED.filter((s) => def.slots[s] !== undefined), ...slots]) {
    if (slot in forced) {
      const id = forced[slot];
      if (id) {
        out.push({ socket: slot, part: id });
        spent += PARTS.get(id).cost ?? 1;
      }
      continue;
    }
    const required = REQUIRED.includes(slot) && (def.slots[slot] ?? 0) >= 1;
    let chance = def.slots[slot] ?? 0;
    if (rank === 'boss') chance = Math.min(1, chance * 1.6 + 0.25);
    else if (rank !== 'normal') chance = Math.min(1, chance * 1.2 + 0.05);
    if (!required && !rng.chance(chance)) continue;
    const left = budget - spent;
    const pool = PARTS.query({ filter: (e) => partFits(e as MonsterPartDef, slot, plan) }).filter((p) => (required ? true : (p.cost ?? 1) <= left));
    if (!pool.length) continue;
    const weight = (p: MonsterPartDef) => {
      if (p.tags.includes('boss') && rank !== 'boss') return 0;
      const theme = p.tags.some((t) => tags.includes(t)) ? 4 : p.tags.includes('any') ? 1.6 : 0.3;
      const pref = prefers.some((t) => p.tags.includes(t) || p.id.includes(t)) ? 2.5 : 1;
      const cheap = required ? 1 / (1 + (p.cost ?? 1)) : 1;
      return (p.weight ?? 1) * theme * pref * cheap;
    };
    if (!pool.some((p) => weight(p) > 0)) continue;
    const p = rng.weighted(pool, weight);
    out.push({ socket: slot, part: p.id });
    spent += p.cost ?? 1;
  }
  return out;
}

function pickElites(rng: Rng, archetype: string, rank: Rank, depth: number): string[] {
  const [lo, hi] = RANK_ELITES[rank];
  const n = rng.int(lo, hi);
  if (!n) return [];
  let budget = Math.max(SCALING.eliteBudget(depth), rank === 'rare' ? 3 : 1);
  const out: string[] = [];
  const pool = ELITE_MODS.all().filter((e) => !e.excludes?.includes(archetype) && (!e.ranks || e.ranks.includes(rank)) && (e.weight ?? 1) > 0);
  while (out.length < n && pool.length) {
    const affordable = pool.filter((e) => e.cost <= budget);
    if (!affordable.length) break;
    const e = rng.weighted(affordable, (x) => x.weight ?? 1);
    out.push(e.id);
    budget -= e.cost;
    pool.splice(pool.indexOf(e), 1);
  }
  return out;
}

export interface PackSpec {
  /** One genome per member; member 0 is the leader. */
  readonly genomes: readonly Genome[];
  readonly archetype: string;
}

/**
 * A pack: one body shape for every member (so they share clips), sized by the archetype's
 * pack range; members vary in scale (±8 %) and seed, and at depth the leader may be magic
 * or rare (aura, elite mods). Deterministic in `rng`.
 */
export function generatePack(rng: Rng, o: GenomeOptions & { size?: number } = {}): PackSpec {
  const base = generateGenome(rng.fork('base'), o);
  const arch = ARCHETYPES.get(base.archetype);
  const r = rng.fork('pack');
  const n = o.size ?? r.int(arch.pack[0], arch.pack[1]);
  const depth = o.depth ?? 1;
  const leaderRank = o.rank ?? (r.chance(Math.min(0.6, 0.08 * depth)) ? (r.chance(0.3) ? 'rare' : 'magic') : 'normal');
  const genomes = Array.from({ length: n }, (_, i): Genome => {
    const m = r.fork(i);
    const rank = i === 0 ? leaderRank : (o.rank ?? 'normal');
    return {
      ...base,
      seed: m.int(1, 0x7fffffff),
      scale: round3(base.scale * m.range(0.92, 1.08) * (i === 0 && rank !== 'normal' ? RANK_SCALE[rank] / RANK_SCALE[base.rank] : 1)),
      rank,
      elite: rank === base.rank ? base.elite : pickElites(m.fork('elite'), base.archetype, rank, depth),
    };
  });
  return { genomes, archetype: base.archetype };
}

/** Spore-style mutation: genes drift, parts swap/appear/vanish, colours shift, rarely the plan. */
export function mutate(g: Genome, rng: Rng, amount = 0.3): Genome {
  const a = Math.min(1, Math.max(0, amount));
  const r = { genes: rng.fork('genes'), parts: rng.fork('parts'), plan: rng.fork('plan'), palette: rng.fork('palette'), seed: rng.fork('seed') };
  let plan = g.plan;
  if (r.plan.chance(0.08 * a)) {
    const arch = ARCHETYPES.has(g.archetype) ? ARCHETYPES.get(g.archetype) : null;
    const options = Object.keys(arch?.planWeights ?? {}).filter((p) => p !== g.plan && PLANS.has(p));
    if (options.length) plan = r.plan.pick(options);
  }
  const planDef = PLANS.get(plan);
  const genes: Record<string, number> = {};
  for (const name of new Set([...Object.keys(planDef.genes), ...Object.keys(g.genes)])) {
    const base = g.genes[name] ?? planDef.genes[name]?.mean ?? 0.5;
    genes[name] = clamp01(base + r.genes.gaussian(0, 0.22 * a));
  }
  const bySlot = new Map(g.parts.map((p) => [p.socket as Slot, p.part]));
  const tags = genomeTags(g);
  for (const slot of Object.keys(planDef.slots) as Slot[]) {
    const cur = bySlot.get(slot);
    const required = REQUIRED.includes(slot);
    if (cur && !required && r.parts.chance(0.12 * a)) bySlot.delete(slot);
    else if ((cur && r.parts.chance(0.3 * a)) || (!cur && (required || r.parts.chance(0.15 * a * (planDef.slots[slot] ?? 0) * 2)))) {
      const pool = PARTS.query({ filter: (e) => partFits(e as MonsterPartDef, slot, plan) && !(e as MonsterPartDef).tags.includes('boss') });
      if (pool.length) bySlot.set(slot, r.parts.weighted(pool, (p) => (p.weight ?? 1) * (p.tags.some((t) => tags.includes(t)) ? 3 : 1)).id);
    }
  }
  const palette = r.palette.chance(0.6 * a) ? shiftPalette(g.palette, r.palette.gaussian(0, 40 * a), r.palette.gaussian(0, 0.06 * a)) : g.palette;
  return sanitize({
    ...g,
    seed: r.seed.int(1, 0x7fffffff),
    plan,
    genes: roundGenes(genes),
    parts: [...bySlot].map(([socket, part]) => ({ socket, part })),
    palette,
    scale: round3(g.scale * (1 + r.genes.gaussian(0, 0.06 * a))),
  });
}

/** Spore-style crossover: one parent's plan, per-gene and per-slot inheritance, mixed colours. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const plan = rng.chance(0.5) ? a.plan : b.plan;
  const planDef = PLANS.get(plan);
  const genes: Record<string, number> = {};
  for (const name of new Set([...Object.keys(a.genes), ...Object.keys(b.genes), ...Object.keys(planDef.genes)])) {
    const va = a.genes[name] ?? planDef.genes[name]?.mean ?? 0.5;
    const vb = b.genes[name] ?? planDef.genes[name]?.mean ?? 0.5;
    genes[name] = rng.chance(0.3) ? (va + vb) / 2 : rng.chance(0.5) ? va : vb;
  }
  const slotsA = new Map(a.parts.map((p) => [p.socket, p.part]));
  const slotsB = new Map(b.parts.map((p) => [p.socket, p.part]));
  const parts: { socket: string; part: string }[] = [];
  for (const slot of Object.keys(planDef.slots) as Slot[]) {
    const options = [slotsA.get(slot), slotsB.get(slot)].filter((id): id is string => !!id && PARTS.has(id) && partFits(PARTS.get(id), slot, plan));
    const has = [slotsA.has(slot), slotsB.has(slot)];
    if (!options.length) continue;
    if (!has[0] || !has[1]) if (!REQUIRED.includes(slot) && rng.chance(0.5)) continue;
    parts.push({ socket: slot, part: rng.pick(options) });
  }
  const pick = <T>(x: T, y: T) => (rng.chance(0.5) ? x : y);
  return sanitize({
    seed: rng.int(1, 0x7fffffff),
    plan,
    parts,
    genes: roundGenes(genes),
    palette: mixPalettes(a.palette, b.palette, rng),
    scale: round3((a.scale + b.scale) / 2),
    archetype: pick(a.archetype, b.archetype),
    elite: [...new Set([...a.elite, ...b.elite])].filter(() => rng.chance(0.5)),
    rank: pick(a.rank, b.rank),
  });
}

/** Fix what evolution can break: parts that don't fit the plan, missing required parts. */
export function sanitize(g: Genome): Genome {
  const plan = PLANS.get(g.plan);
  const seen = new Set<string>();
  const parts = g.parts.filter((p) => {
    if (seen.has(p.socket) || !PARTS.has(p.part) || !(p.socket in plan.slots) || !partFits(PARTS.get(p.part), p.socket as Slot, g.plan)) return false;
    seen.add(p.socket);
    return true;
  });
  const rng = new Rng(g.seed);
  for (const slot of REQUIRED) {
    if (plan.slots[slot] === undefined || seen.has(slot)) continue;
    const pool = PARTS.query({ filter: (e) => partFits(e as MonsterPartDef, slot, g.plan) && !(e as MonsterPartDef).tags.includes('boss') });
    if (pool.length) parts.push({ socket: slot, part: rng.weighted(pool, (p) => p.weight ?? 1).id });
  }
  return { ...g, parts };
}

/** Problems with a genome (unknown ids, misfits); empty when it builds cleanly. */
export function validateGenome(g: Genome): string[] {
  const errors: string[] = [];
  if (!PLANS.has(g.plan)) return [`unknown plan ${g.plan}`];
  if (!ARCHETYPES.has(g.archetype)) errors.push(`unknown archetype ${g.archetype}`);
  for (const p of g.parts) {
    if (!PARTS.has(p.part)) errors.push(`unknown part ${p.part}`);
    else if (!partFits(PARTS.get(p.part), p.socket as Slot, g.plan)) errors.push(`${p.part} does not fit ${p.socket} on ${g.plan}`);
  }
  for (const e of g.elite) if (!ELITE_MODS.has(e)) errors.push(`unknown elite mod ${e}`);
  for (const [k, v] of Object.entries(g.genes)) if (!(v >= 0 && v <= 1)) errors.push(`gene ${k} = ${v} outside 0..1`);
  if (!(g.scale > 0)) errors.push(`scale ${g.scale}`);
  return errors;
}

/** Anchors of the genome's head part. */
export function headAnchors(g: Genome): HeadAnchors {
  const head = g.parts.find((p) => p.socket === 'head');
  return (head && PARTS.has(head.part) && PARTS.get(head.part).anchors) || DEFAULT_HEAD;
}

/** Stable key of everything that shapes the skeleton and clips (clip cache). */
export function shapeKey(g: Genome, anims: readonly string[]): string {
  const genes = Object.keys(g.genes)
    .sort()
    .map((k) => `${k}:${g.genes[k]!.toFixed(3)}`)
    .join(',');
  const parts = g.parts
    .map((p) => `${p.socket}=${p.part}`)
    .sort()
    .join(',');
  // the archetype too: its look (cosmetic marks) changes the body's bounds, so the floor clamp
  return `${g.plan}|${g.archetype}|${genes}|${parts}|${[...anims].sort().join(',')}`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function roundGenes(genes: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(genes).sort()) out[k] = round3(genes[k]!);
  return out;
}
