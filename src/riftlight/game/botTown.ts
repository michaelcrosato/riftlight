/**
 * The playtest bot between levels: what a player does in town, as pure functions over the
 * save, through the same loot, socket and tree functions the windows use.
 *
 *   loot.write(save);                                   // the bag, gear and sockets as they are
 *   const r = townVisit(save, { sheet: hero.actor.stats, points, depth, visit });
 *   loot.load(save); hero.setSkills(save.hero.skills); applyMods();
 *
 * A visit, in order (every choice is judged on a clone of the hero's StatSheet):
 *   1. gems: higher-level copies and better skills of the same role into slots 0–1, the
 *      best fitting supports from the bag into their links;
 *   2. gear: the best upgrade per slot from the bag (two-handers and offhands push each
 *      other out, level requirements respected) until nothing improves the score;
 *   3. sell every bag item left over (junk, spare gems, currency);
 *   4. buy: gems from the gem vendor (honed ones too) and gear from the smith that beat what
 *      is worn, then gamble surplus gold on the weakest slots (`GAMBLING`), wearing what is better;
 *   5. passive points: the greedy tree planner (`tree/planner.ts`) toward the bot's score.
 *
 * The score is the bot's idea of a good character: log(DPS) of the bar (weighted by slot,
 * pack reach by area / projectiles, mana sustain against the free basic attack) plus
 * log(effective life) against a reference monster hit at the depth.
 */
import type { Mod, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import { SCALING } from '../core/scaling';
import type { Item, Rarity, SaveData } from '../core/types';
import { armourReduction, hitChance, resistance } from '../combat/damage';
import { addItem, compatibleHands, equip, type LootState, lootFromSave, lootToSave, slotsFor } from '../loot/inventory';
import { applyEquipment, baseOf, EQUIP_SLOTS, type EquipSlot, type Equipment, equipmentMods, requiredLevel } from '../loot/itemMods';
import { gemItem, normalizeSockets, type SkillSocket, skillNumbers } from '../loot/sockets';
import { buy, buyPrice, sell, vendorStock } from '../loot/vendor';
import { SKILLS } from '../skills/actives';
import { MAX_GEM_LEVEL, supportFits } from '../skills/build';
import { SUPPORTS } from '../skills/supports';
import { TreePlanner } from '../tree/planner';
import { defaultTree, treeMods } from '../tree/tree';
import { starterWeapon } from '../wire/progression';

/** How the bot reads a skill from its tags (shared with the fighting bot). */
export type SkillRole = 'area' | 'nova' | 'ranged' | 'gap' | 'buff' | 'none';

export function roleOfTags(t: readonly string[]): SkillRole {
  if (t.includes('movement')) return 'gap';
  if (t.includes('nova')) return 'nova';
  if (t.includes('projectile') || t.includes('chain')) return 'ranged';
  if (t.includes('area') || t.includes('strike')) return 'area';
  if (t.includes('buff') || t.includes('warcry') || t.includes('aura')) return 'buff';
  return 'none';
}

/** How much each bar slot's DPS counts (the bot's main attack is slot 0). */
const SLOT_WEIGHT = [1, 0.45, 0.15, 0.15] as const;
/** Seconds of fighting the mana pool is spread over (sustain = regen + pool / this). */
const MANA_WINDOW = 25;
/** Weight of log(DPS) against log(effective life). */
const DPS_WEIGHT = 0.6;
/** A swap has to beat the current score by this much (no churn over rounding). */
const MARGIN = 0.004;
/**
 * How the bot gambles: at most `perVisit` unrevealed items a visit, weakest slot first, never
 * spending below `reserve` gambles' worth of gold (the smith and the gem vendor come first).
 */
export const GAMBLING = { perVisit: 6, reserve: 2 } as const;

export interface BotScore {
  readonly dps: number;
  readonly ehp: number;
  readonly score: number;
}

export interface TownVisitOptions {
  /** The hero's live StatSheet (cloned, never modified). */
  readonly sheet: StatSheet;
  /** Passive points available now (`TreePort.points`). */
  readonly points: number;
  /** The depth about to be played (reference hits). */
  readonly depth: number;
  /** Vendor visit index (the shell's `stats.runs`, as the vendor window uses). */
  readonly visit: number;
  /** Turn parts off (all on by default). */
  readonly gems?: boolean;
  readonly gear?: boolean;
  readonly sell?: boolean;
  readonly buy?: boolean;
  readonly tree?: boolean;
  readonly gamble?: boolean;
}

export interface TownReport {
  readonly equipped: string[];
  readonly socketed: string[];
  readonly sold: number;
  readonly soldGold: number;
  readonly bought: string[];
  readonly spent: number;
  /** Unrevealed items bought from the gamble tab (also in `bought` and `spent`). */
  readonly gambled: number;
  readonly allocated: number;
  readonly before: BotScore;
  readonly after: BotScore;
  readonly gearScore: number;
}

/** A socket for the basic attack (what the bot swings when the bar is out of mana). */
const SLASH: SkillSocket = { slot: 0, gem: { uid: 'slash', base: 'skill-gem', rarity: 'normal', level: 1, name: 'Slash', affixes: [], gem: { id: 'slash', level: 1, support: false } }, supports: [] };

/** A clone of `base` wearing `equipment` (and the starter sword when it holds no weapon), with tree mods. */
export function rig(base: StatSheet, equipment: Equipment, tree?: readonly Mod[]): StatSheet {
  const s = base.clone();
  applyEquipment(s, equipment);
  const armed = Object.values(equipmentMods(equipment)).some((mods) => mods.some((m) => m.stat.startsWith('weapon.') && m.stat.endsWith('.max')));
  if (armed) s.remove('starter');
  else s.set('starter', starterWeapon());
  if (tree) s.set('tree', tree);
  return s;
}

/** The bot's score of a character: its bar's DPS and effective life at `depth`. */
export function evaluate(sheet: StatSheet, sockets: readonly SkillSocket[], depth: number): BotScore {
  const slash = skillNumbers(SLASH, sheet)?.dps ?? 0;
  const sustain = Math.max(0, sheet.get('mana.regen')) + sheet.get('mana') / MANA_WINDOW;
  let dps = 0;
  sockets.forEach((sock, i) => {
    const n = skillNumbers(sock, sheet);
    if (!n || !(n.dps > 0)) return;
    const rate = n.channel ? n.cost : n.cost / Math.max(0.1, n.castTime, n.cooldown);
    const uptime = rate > 0 ? Math.min(1, sustain / rate) : 1;
    // packs: an area hits more of them (about two at 100% area, more as it grows), each
    // projectile finds another
    const reach = (n.tags.includes('area') ? 1 + Math.sqrt(Math.max(0.25, n.area)) : 1) * (n.projectiles > 1 ? 1 + 0.35 * (n.projectiles - 1) : 1);
    const own = uptime * n.dps * reach + (1 - uptime) * (i === 0 ? slash : 0);
    dps += (SLOT_WEIGHT[i] ?? 0.1) * own;
  });
  dps = Math.max(dps, slash);
  const life = Math.max(1, sheet.get('life') + sheet.get('es'));
  const hit = 14 * SCALING.monsterDamage(depth);
  const accuracy = 320 + 22 * SCALING.monsterLevel(depth);
  const phys = 1 - armourReduction(sheet.get('armour'), hit);
  const elem = (['fire', 'cold', 'lightning'] as const).reduce((a, t) => a + (1 - resistance(sheet, t)), 0) / 3;
  const chaos = 1 - resistance(sheet, 'chaos');
  const block = Math.min(0.75, Math.max(0, sheet.get('block.chance')));
  const evade = 1 - hitChance(accuracy, sheet.get('evasion'));
  const taken = Math.max(0.02, (0.55 * phys * (1 - evade) + 0.38 * elem + 0.07 * chaos) * (1 - 0.6 * block));
  const recovery = Math.max(0, sheet.get('life.regen')) * 4 + Math.max(0, sheet.get('leech.life')) * dps * 2;
  const ehp = (life + Math.min(life, recovery)) / taken;
  return { dps, ehp, score: DPS_WEIGHT * Math.log(Math.max(1e-3, dps)) + Math.log(ehp) };
}

const RARITY_POWER: Readonly<Record<Rarity, number>> = { normal: 1, magic: 1.3, rare: 1.7, unique: 2 };

/** Gear score: item level × rarity power, summed over what is worn (a D4-style item power). */
export function gearScore(equipment: Equipment): number {
  let s = 0;
  for (const slot of EQUIP_SLOTS) {
    const it = equipment[slot];
    if (it) s += it.level * RARITY_POWER[it.rarity];
  }
  return Math.round(s);
}

const cloneSockets = (s: readonly SkillSocket[]): SkillSocket[] => s.map((x) => ({ ...x, supports: [...x.supports] }));
const isActiveGem = (it: Item) => !!it.gem && !it.gem.support && SKILLS.has(it.gem.id);
const isSupportGem = (it: Item) => !!it.gem && it.gem.support && SUPPORTS.has(it.gem.id);
const weaponClass = (eq: Equipment) => ['bow', 'wand'].filter((c) => !!eq.weapon && baseOf(eq.weapon).look === c);

/** Can the bar's slot `i` hold active gem `it` (same role, the weapon it needs, the hero's level)? */
function activeFits(it: Item, current: Item, eq: Equipment, level: number): boolean {
  if (!isActiveGem(it) || requiredLevel(it) > level) return false;
  // the same skill only as a higher level (a cheaper low-level copy is a mana trick, not a plan)
  if (it.gem!.id === current.gem!.id && it.gem!.level <= current.gem!.level) return false;
  const tags = SKILLS.get(it.gem!.id).tags ?? [];
  const cur = SKILLS.get(current.gem!.id).tags ?? [];
  if (roleOfTags(tags) !== roleOfTags(cur)) return false;
  // the bot fights in melee reach: its main attack stays a melee one
  if (cur.includes('melee') !== tags.includes('melee')) return false;
  const need = ['bow', 'wand'].filter((c) => tags.includes(c));
  return need.every((c) => weaponClass(eq).includes(c));
}

/**
 * Fill the bar from `pool` (gems in the bag): better skill gems of the same role in slots 0
 * and 1, then the best fitting support in every link of the damage slots. Returns the new
 * sockets and the gems it used (taken out of the pool) and freed (back into the bag).
 */
export function planGems(sockets: readonly SkillSocket[], pool: readonly Item[], sheet: StatSheet, eq: Equipment, level: number, depth: number): { sockets: SkillSocket[]; used: Item[]; freed: Item[]; socketed: string[] } {
  let s = cloneSockets(sockets);
  const left = [...pool];
  const used: Item[] = [];
  const freed: Item[] = [];
  const socketed: string[] = [];
  const score = (x: SkillSocket[]) => evaluate(sheet, x, depth).score;
  const take = (it: Item) => {
    left.splice(left.indexOf(it), 1);
    used.push(it);
  };
  // 1. skill gems (slots 0 and 1: the damage skills the bot leans on)
  for (const i of [0, 1]) {
    const cur = s[i]?.gem;
    if (!cur?.gem) continue;
    let best: { it: Item; v: number } | null = null;
    const base = score(s);
    for (const it of left) {
      if (!activeFits(it, cur, eq, level)) continue;
      const trial = cloneSockets(s);
      trial[i]!.gem = it;
      const v = score(trial);
      if (v > base + MARGIN && (!best || v > best.v)) best = { it, v };
    }
    if (best) {
      take(best.it);
      freed.push(cur);
      s[i]!.gem = best.it;
      socketed.push(`${best.it.gem!.id}@${best.it.gem!.level}`);
    }
  }
  // 2. supports, link by link, from the bag and what is socketed in that slot
  for (const i of [0, 1, 2, 3]) {
    const sock = s[i];
    if (!sock?.gem?.gem || !SKILLS.has(sock.gem.gem.id)) continue;
    const tags = SKILLS.get(sock.gem.gem.id).tags ?? [];
    if (!tags.includes('damage')) continue;
    for (let l = 0; l < sock.supports.length; l++) {
      const base = score(s);
      let best: { it: Item; v: number } | null = null;
      for (const it of left) {
        if (!isSupportGem(it) || requiredLevel(it) > level || !supportFits(SUPPORTS.get(it.gem!.id), tags)) continue;
        if (s[i]!.supports.some((g, k) => k !== l && g?.gem?.id === it.gem!.id)) continue; // one of each per skill
        const trial = cloneSockets(s);
        trial[i]!.supports[l] = it;
        const v = score(trial);
        if (v > base + MARGIN && (!best || v > best.v)) best = { it, v };
      }
      if (best) {
        take(best.it);
        const old = s[i]!.supports[l];
        if (old) freed.push(old);
        s[i]!.supports[l] = best.it;
        socketed.push(`${best.it.gem!.id}@${best.it.gem!.level}`);
      }
    }
  }
  s = normalizeSockets(s);
  return { sockets: s, used, freed, socketed };
}

/**
 * The best equipment from `pool` on top of `eq`, slot by slot until nothing improves the
 * score (rings try both ring slots; a two-hander and an offhand push each other out).
 */
export function planGear(eq: Equipment, pool: readonly Item[], base: StatSheet, sockets: readonly SkillSocket[], level: number, depth: number, tree?: readonly Mod[]): { equipment: Equipment; picks: { item: Item; slot: EquipSlot }[] } {
  let cur: Equipment = { ...eq };
  // a melee main skill wants a melee weapon (no bow or wand), as a player would
  const main = sockets[0]?.gem?.gem;
  const melee = !!main && SKILLS.has(main.id) && (SKILLS.get(main.id).tags ?? []).includes('melee');
  const ranged = (it: Item) => ['bow', 'wand'].includes(baseOf(it).look ?? '') || baseOf(it).look === 'quiver';
  const left = pool.filter((it) => slotsFor(it).length && requiredLevel(it) <= level && !(melee && ranged(it)));
  const picks: { item: Item; slot: EquipSlot }[] = [];
  const score = (e: Equipment) => evaluate(rig(base, e, tree), sockets, depth).score;
  let now = score(cur);
  for (let guard = 0; guard < 24; guard++) {
    let best: { item: Item; slot: EquipSlot; eq: Equipment; v: number } | null = null;
    for (const it of left) {
      for (const slot of slotsFor(it)) {
        const next: Equipment = { ...cur, [slot]: it };
        // two hands: the other hand comes off (a bow keeps its quiver)
        if ((slot === 'weapon' || slot === 'offhand') && !compatibleHands(next.weapon, next.offhand)) delete next[slot === 'weapon' ? 'offhand' : 'weapon'];
        const v = score(next);
        if (v > now + MARGIN && (!best || v > best.v)) best = { item: it, slot, eq: next, v };
      }
    }
    if (!best) break;
    cur = best.eq;
    now = best.v;
    left.splice(left.indexOf(best.item), 1);
    picks.push({ item: best.item, slot: best.slot });
  }
  return { equipment: cur, picks };
}

/**
 * One town visit: sockets, gear, selling, buying and passive points, applied to `save`
 * (hero equipment, bag, sockets, gold, allocated). The stash is left alone.
 */
export function townVisit(save: SaveData, o: TownVisitOptions): TownReport {
  const level = save.hero.level;
  const depth = Math.max(1, o.depth);
  let state: LootState = lootFromSave({ hero: save.hero, stash: save.stash, positions: save.positions });
  let sockets = normalizeSockets(save.hero.skills);
  const tree = defaultTree();
  const treeNow = treeMods(save.hero.allocated, tree);
  const before = evaluate(rig(o.sheet, state.equipment, treeNow), sockets, depth);
  const equipped: string[] = [];
  const socketed: string[] = [];
  const bought: string[] = [];
  let sold = 0;
  let soldGold = 0;
  let spent = 0;
  let gambled = 0;
  const bag = () => state.inventory.items.map((p) => p.item);

  // 1. gems from the bag
  if (o.gems !== false) {
    const g = planGems(sockets, bag().filter((it) => !!it.gem), rig(o.sheet, state.equipment, treeNow), state.equipment, level, depth);
    sockets = g.sockets;
    socketed.push(...g.socketed);
    let inv = state.inventory;
    for (const it of g.used) inv = { ...inv, items: inv.items.filter((p) => p.item.uid !== it.uid) };
    for (const it of g.freed) inv = addItem(inv, it).grid;
    state = { ...state, inventory: inv };
  }

  // 2. gear from the bag
  const wear = (pool: readonly Item[]) => {
    const r = planGear(state.equipment, pool, o.sheet, sockets, level, depth, treeNow);
    for (const p of r.picks) {
      const e = equip(state, p.item.uid, level, p.slot);
      if (e.ok) {
        state = e.value;
        equipped.push(`${p.slot}: ${p.item.name} (${p.item.rarity}, ilvl ${p.item.level})`);
      }
    }
  };
  if (o.gear !== false) wear(bag());

  // 3. sell what is left in the bag (junk, spare gems, currency)
  const sellAll = () => {
    if (o.sell === false) return;
    for (const it of bag()) {
      const r = sell(state, it.uid);
      if (!r.ok) continue;
      state = r.value.state;
      sold++;
      soldGold += r.value.gold;
    }
  };
  sellAll();

  // 4. buy: supports from the gem vendor, then gear from the smith, while the gold lasts
  if (o.buy !== false) {
    const stockDepth = Math.max(1, save.deepest);
    if (o.gems !== false) {
      const wares = vendorStock(save.seed, stockDepth, o.visit, 'gems').filter((it) => (isSupportGem(it) || isActiveGem(it)) && buyPrice(it) <= state.gold);
      const g = planGems(sockets, wares, rig(o.sheet, state.equipment, treeNow), state.equipment, level, depth);
      const price = g.used.reduce((n, it) => n + buyPrice(it), 0);
      if (g.used.length && price <= state.gold) {
        state = { ...state, gold: state.gold - price };
        spent += price;
        bought.push(...g.used.map((it) => `${it.name} (gem)`));
        socketed.push(...g.socketed);
        sockets = g.sockets;
        let inv = state.inventory;
        for (const it of g.freed) inv = addItem(inv, it).grid;
        state = { ...state, inventory: inv };
      }
    }
    if (o.gear !== false) {
      const wares = vendorStock(save.seed, stockDepth, o.visit, 'smith').filter((it) => slotsFor(it).length && buyPrice(it) <= state.gold);
      const r = planGear(state.equipment, wares, o.sheet, sockets, level, depth, treeNow);
      for (const p of r.picks) {
        const price = buyPrice(p.item);
        if (price > state.gold) continue;
        const a = addItem(state.inventory, p.item);
        if (a.rest) continue;
        state = { ...state, inventory: a.grid, gold: state.gold - price };
        spent += price;
        bought.push(`${p.item.name} (${p.item.rarity}, ${p.slot})`);
        const e = equip(state, p.item.uid, level, p.slot);
        if (e.ok) {
          state = e.value;
          equipped.push(`${p.slot}: ${p.item.name} (${p.item.rarity}, bought)`);
        }
      }
    }
    if (o.gear !== false && o.gamble !== false) {
      // gamble the surplus: weakest slot first (nothing worn, then the lowest item power)
      const stock = vendorStock(save.seed, stockDepth, o.visit, 'gamble');
      const main = sockets[0]?.gem?.gem;
      const melee = !!main && SKILLS.has(main.id) && (SKILLS.get(main.id).tags ?? []).includes('melee');
      const power = (it: Item | undefined) => (it ? it.level * RARITY_POWER[it.rarity] : 0);
      const weakness = (it: Item) => Math.min(...slotsFor(it).map((slot) => power(state.equipment[slot])));
      const order = stock.filter((it) => slotsFor(it).length && !(melee && ['bow', 'wand', 'quiver'].includes(baseOf(it).look ?? ''))).sort((a, b) => weakness(a) - weakness(b));
      for (const it of order) {
        if (gambled >= GAMBLING.perVisit) break;
        const price = buyPrice(it);
        if (state.gold - price < GAMBLING.reserve * price) break;
        const r = buy(state, stock, it.uid);
        if (!r.ok) continue;
        state = r.value.state;
        gambled++;
        spent += price;
        const revealed = state.inventory.items.find((p) => p.item.uid === it.uid)?.item;
        bought.push(`${revealed?.name ?? it.name} (gamble, ${revealed?.rarity ?? '?'})`);
        if (revealed) wear([revealed]);
      }
    }
    sellAll(); // what the purchases pushed out
  }

  // 5. passive points
  let allocated = save.hero.allocated;
  let added = 0;
  if (o.tree !== false) {
    const planner = new TreePlanner(tree, allocated);
    const base = rig(o.sheet, state.equipment);
    const extra = planner.extend(Math.max(planner.allocated.length, o.points), (mods) => {
      base.set('tree', mods);
      return evaluate(base, sockets, depth).score;
    });
    added = extra.length;
    if (added) allocated = [...allocated, ...extra];
  }

  const l = lootToSave(state);
  save.hero.equipment = l.hero.equipment;
  save.hero.inventory = l.hero.inventory;
  save.hero.gold = l.hero.gold;
  save.stash = l.stash;
  save.positions = l.positions;
  save.hero.skills = sockets.map((x) => ({ ...x, supports: [...x.supports] }));
  save.hero.allocated = allocated;
  const after = evaluate(rig(o.sheet, state.equipment, treeMods(allocated, tree)), sockets, depth);
  return { equipped, socketed, sold, soldGold, bought, spent, gambled, allocated: added, before, after, gearScore: gearScore(state.equipment) };
}

/** Gem levels on the bar, e.g. `cleave 4 · frost-nova 3 · +melee-physical 2`. */
export function gemSummary(skills: SaveData['hero']['skills']): { id: string; level: number; support: boolean }[] {
  return normalizeSockets(skills).flatMap((s) => [s.gem, ...s.supports].filter((g): g is Item => !!g?.gem).map((g) => ({ id: g.gem!.id, level: g.gem!.level, support: g.gem!.support })));
}

/** A test helper: a gem item (re-exported so callers need not reach into loot). */
export const botGem = (id: string, level = 1): Item => gemItem(new Rng(1).fork(id), id, Math.min(MAX_GEM_LEVEL, level));
