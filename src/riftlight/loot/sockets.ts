/**
 * Skill sockets: the four skill slots of the hero, each an active gem plus linked support
 * gems. Pure and immutable like the inventory (no DOM, no three). The save keeps them as
 * `save.hero.skills[slot] = { slot, gem, supports }` with gem *items*, so a gem keeps its
 * level and comes back to the inventory when it is taken out.
 *
 *   let s = normalizeSockets(save.hero.skills);
 *   const r = socketGem(s, { slot: 0, link: -1 }, gemItem);   // → { sockets, displaced }
 *   hero.setSkills(r.sockets);                                // HeroPort.setSkills
 *   socketsToSlots(r.sockets);                                // HeroController slots
 *   skillNumbers(r.sockets[0], hero.stats);                   // what the skill panel shows
 */
import { StatSheet } from '../core/mods';
import type { Item, SaveData } from '../core/types';
import { expectedHit, sumDamage } from '../combat/damage';
import { StatQuery } from '../combat/stats';
import { buildSkill, MAX_GEM_LEVEL, supportFits } from '../skills/build';
import { SKILLS } from '../skills/actives';
import { SUPPORTS } from '../skills/supports';
import type { ResolvedSkill } from '../skills/types';
import { GEMS } from './content';
import { rollUid } from './generate';
import type { Rng } from '../core/rng';

export type SkillSocket = SaveData['hero']['skills'][number];
export type Sockets = readonly SkillSocket[];

/** Skill slots on the bar (keys 1/Q, 2/E, 3/R, 4/T). */
export const SKILL_SLOTS = 4;
/** Support gems linked to each skill. */
export const SUPPORT_LINKS = 3;

/** A socket: `link` −1 is the slot's active gem, 0..SUPPORT_LINKS−1 its supports. */
export interface SocketRef {
  readonly slot: number;
  readonly link: number;
}

/** What a new run starts with: the stub hero's bar (and the bot's habits) as real gems. */
export const STARTER_GEMS: readonly string[] = ['cleave', 'frost-nova', 'dash', 'war-cry'];

export const isGem = (item: Item | null | undefined): item is Item & { gem: NonNullable<Item['gem']> } => !!item?.gem && GEMS.has(item.gem.id);
const isActive = (item: Item | null | undefined) => isGem(item) && !item.gem.support && SKILLS.has(item.gem.id);
const isSupport = (item: Item | null | undefined) => isGem(item) && item.gem.support && SUPPORTS.has(item.gem.id);

export function emptySockets(): SkillSocket[] {
  return Array.from({ length: SKILL_SLOTS }, (_, slot) => ({ slot, gem: null, supports: Array<Item | null>(SUPPORT_LINKS).fill(null) }));
}

/**
 * Any saved shape → exactly SKILL_SLOTS sockets of SUPPORT_LINKS links. Unknown gems (a
 * skill was removed) and gems in the wrong kind of socket are dropped, never thrown.
 */
export function normalizeSockets(saved: readonly unknown[] | null | undefined): SkillSocket[] {
  const out = emptySockets();
  for (const [i, raw] of (saved ?? []).entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<SkillSocket>;
    const slot = typeof r.slot === 'number' ? r.slot : i;
    const s = out[slot];
    if (!s) continue;
    if (isActive(r.gem)) s.gem = r.gem!;
    (r.supports ?? []).slice(0, SUPPORT_LINKS).forEach((g, k) => {
      if (isSupport(g)) s.supports[k] = g;
    });
  }
  return out;
}

/** A gem item (level 1 unless given) for a skill or support id. */
export function gemItem(rng: Rng, id: string, level = 1): Item {
  const g = GEMS.get(id);
  return { uid: rollUid(rng), base: g.support ? 'support-gem' : 'skill-gem', rarity: 'normal', level: 1, name: g.name, affixes: [], gem: { id, level, support: g.support } };
}

/** A new run's sockets: STARTER_GEMS in slots 0..3, no supports. */
export function starterSockets(rng: Rng): SkillSocket[] {
  const s = emptySockets();
  STARTER_GEMS.forEach((id, i) => {
    if (s[i] && GEMS.has(id)) s[i]!.gem = gemItem(rng.fork(`starter:${id}`), id);
  });
  return s;
}

export function gemAt(s: Sockets, ref: SocketRef): Item | null {
  const socket = s[ref.slot];
  if (!socket) return null;
  return ref.link < 0 ? socket.gem : (socket.supports[ref.link] ?? null);
}

/** Why `item` can't go in `ref` (null = it can). Supports that don't fit the skill still socket (they just don't apply). */
export function socketBlocker(item: Item, ref: SocketRef): string | null {
  if (ref.slot < 0 || ref.slot >= SKILL_SLOTS || ref.link < -1 || ref.link >= SUPPORT_LINKS) return 'no such socket';
  if (!isGem(item)) return 'only gems go in skill sockets';
  if (ref.link < 0 && !isActive(item)) return 'support gems go in the small link sockets';
  if (ref.link >= 0 && !isSupport(item)) return 'skill gems go in the big socket';
  return null;
}

/** Put `item` (or nothing) in a socket; the gem that was there is `displaced`. */
export function setSocket(s: Sockets, ref: SocketRef, item: Item | null): { sockets: SkillSocket[]; displaced: Item | null } {
  const sockets = s.map((x) => ({ ...x, supports: [...x.supports] }));
  const socket = sockets[ref.slot];
  if (!socket) return { sockets, displaced: null };
  const displaced = gemAt(s, ref);
  if (ref.link < 0) socket.gem = item;
  else socket.supports[ref.link] = item;
  return { sockets, displaced };
}

/** Where a right-clicked gem goes: the active socket of `slot`, or that slot's first free (else first non-fitting) support link. */
export function autoSocket(s: Sockets, item: Item, slot: number): SocketRef | null {
  if (isActive(item)) return { slot, link: -1 };
  if (!isSupport(item)) return null;
  const socket = s[slot];
  if (!socket) return null;
  const free = socket.supports.findIndex((g) => !g);
  if (free >= 0) return { slot, link: free };
  // replace a support that doesn't apply to this skill
  const tags = socket.gem ? (SKILLS.get(socket.gem.gem!.id).tags ?? []) : [];
  const bad = socket.supports.findIndex((g) => g && !supportFits(SUPPORTS.get(g.gem!.id), tags));
  return bad >= 0 ? { slot, link: bad } : null;
}

/** Does a support gem apply to the active gem in its slot? (null when the slot has no skill.) */
export function supportApplies(socket: SkillSocket, item: Item): boolean | null {
  if (!socket.gem || !isSupport(item)) return null;
  return supportFits(SUPPORTS.get(item.gem!.id), SKILLS.get(socket.gem.gem!.id).tags ?? []);
}

/** Every gem in the sockets (saving, "all items" counts). */
export function socketedGems(s: Sockets): Item[] {
  return s.flatMap((x) => [x.gem, ...x.supports].filter((g): g is Item => !!g));
}

/** HeroController slots (`{ skill, level, supports }`) for the hero side; null = an empty slot. */
/**
 * HeroController slots (`{ skill, level, supports }`) for the hero side; null = an empty slot.
 * With the hero's sheet, levels include gear's `skill.level` (see `skillLevel`).
 */
export function socketsToSlots(s: Sockets, sheet?: StatSheet | null): ({ skill: string; level: number; supports: { gem: string; level: number }[] } | null)[] {
  return normalizeSockets(s).map((x) => (x.gem ? { skill: x.gem.gem!.id, level: skillLevel(x, sheet ?? null), supports: x.supports.filter((g): g is Item => !!g).map((g) => ({ gem: g.gem!.id, level: g.gem!.level })) } : null));
}

/**
 * A socketed skill's level: its gem's level plus the character's `skill.level` mods that fit
 * the skill's tags (gear: "+1 to the level of fire skill gems"), at most MAX_GEM_LEVEL.
 */
export function skillLevel(socket: SkillSocket, sheet: StatSheet | null): number {
  const g = socket.gem?.gem;
  if (!g) return 0;
  const tags = SKILLS.has(g.id) ? (SKILLS.get(g.id).tags ?? []) : [];
  return Math.max(1, Math.min(MAX_GEM_LEVEL, g.level + Math.round(sheet ? sheet.get('skill.level', tags) : 0)));
}

/** `buildSkill` for a socket on a character (null for an empty slot). */
export function resolveSocket(socket: SkillSocket, sheet: StatSheet | null): ResolvedSkill | null {
  if (!socket.gem?.gem || !SKILLS.has(socket.gem.gem.id)) return null;
  const supports = socket.supports.filter((g): g is Item => !!g?.gem && SUPPORTS.has(g.gem.id)).map((g) => ({ gem: g.gem!.id, level: g.gem!.level }));
  return buildSkill(socket.gem.gem.id, supports, sheet ?? new StatSheet(), { level: skillLevel(socket, sheet) });
}

/** The skill panel's numbers: a pocket `npm run combat -- dps` (one target, no defences). */
export interface SkillNumbers {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly cost: number;
  readonly cooldown: number;
  /** Seconds per use after attack / cast speed. */
  readonly castTime: number;
  readonly channel: boolean;
  /** Average damage of one hit (crits averaged in), 0 for skills that deal none. */
  readonly hit: number;
  /** Damage types of the hit, largest first. */
  readonly types: readonly string[];
  readonly hitsPerSecond: number;
  readonly dps: number;
  readonly area: number;
  /** Projectiles per use (projectile skills), else 0. */
  readonly projectiles: number;
  readonly supports: readonly string[];
  readonly unsupported: readonly string[];
  readonly tags: readonly string[];
}

export function skillNumbers(socket: SkillSocket, sheet: StatSheet | null): SkillNumbers | null {
  const s = resolveSocket(socket, sheet);
  if (!s) return null;
  const d = s.delivery;
  const period = Math.max(s.castTime, s.cooldown);
  let uses = period > 0 ? 1 / period : 0;
  let scale = 1;
  if (s.channel) {
    uses = 1 / (d.kind === 'beam' ? Math.max(0.05, d.tick / s.speed) : Math.max(0.12, 0.3 / s.speed));
    scale = s.def.tickDamage ?? 1;
  } else if (d.kind === 'trap' && s.def.zone) {
    uses = 1 / Math.max(0.1, s.def.zone.tick);
    scale = s.def.tickDamage ?? 0.25;
  }
  let hit = 0;
  let types: string[] = [];
  if (s.damage) {
    const e = expectedHit(new StatQuery(sheet ?? new StatSheet(), s.mods), s.damage);
    hit = sumDamage(e.damage) * scale;
    types = (Object.entries(e.damage) as [string, number][])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }
  const hitsPerSecond = s.damage ? uses * s.repeats : 0;
  return {
    id: s.id,
    name: s.def.name,
    level: s.level,
    cost: s.cost,
    cooldown: s.cooldown,
    castTime: s.castTime,
    channel: s.channel,
    hit,
    types,
    hitsPerSecond,
    dps: hit * hitsPerSecond,
    area: s.area,
    projectiles: d.kind === 'projectile' ? d.count : 0,
    supports: s.supports,
    unsupported: s.unsupported,
    tags: s.tags,
  };
}
