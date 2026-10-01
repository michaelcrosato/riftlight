import { describe, expect, it } from 'vitest';
import { flat, inc, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import type { ActorLike, Item } from '../core/types';
import { newSave } from '../game/save';
import type { ShellServices } from '../game/ports';
import { GEMS } from '../loot/content';
import { INNATE_SKILLS } from '../loot/data/gems';
import { autoSocket, emptySockets, gemItem, normalizeSockets, setSocket, skillNumbers, socketBlocker, socketsToSlots, STARTER_GEMS, starterSockets, supportApplies } from '../loot/sockets';
import { ACTIVE_SKILLS, SKILLS } from '../skills/actives';
import { SUPPORT_GEMS, SUPPORTS } from '../skills/supports';
import { pointBudget, treeMods } from '../tree/tree';
import { realLootPort } from './loot';
import { realTreePort } from './tree';

const rng = new Rng(5);
const gem = (id: string, level = 1) => gemItem(rng.fork(id), id, level);

describe('gems come from the skills registry', () => {
  it('every active skill (but the innate ones) and every support is a gem', () => {
    for (const s of ACTIVE_SKILLS) expect(GEMS.has(s.id), s.id).toBe(!INNATE_SKILLS.has(s.id));
    for (const s of SUPPORT_GEMS) expect(GEMS.get(s.id).support, s.id).toBe(true);
    for (const g of GEMS.all()) expect(SKILLS.has(g.id) || SUPPORTS.has(g.id), g.id).toBe(true);
  });
});

describe('skill sockets', () => {
  it('normalize any saved shape to 4 slots × 3 links, dropping unknown or misplaced gems', () => {
    const s = normalizeSockets([{ slot: 1, gem: gem('fireball'), supports: [gem('lmp'), gem('arc'), { uid: 'x', base: 'skill-gem', rarity: 'normal', level: 1, name: '?', affixes: [], gem: { id: 'nope', level: 1, support: true } }, gem('chain')] }, null, 'junk']);
    expect(s).toHaveLength(4);
    expect(s[1]!.gem?.gem?.id).toBe('fireball');
    expect(s[1]!.supports.map((g) => g?.gem?.id ?? null)).toEqual(['lmp', null, null]);
    expect(s[0]!.gem).toBeNull();
  });

  it('a new run starts with the starter gems', () => {
    expect(starterSockets(new Rng(1)).map((x) => x.gem?.gem?.id)).toEqual([...STARTER_GEMS]);
  });

  it('active gems go in the big socket, supports in the links; a socketed gem is displaced', () => {
    const fb = gem('fireball');
    expect(socketBlocker(fb, { slot: 0, link: 0 })).toMatch(/big socket/);
    expect(socketBlocker(gem('lmp'), { slot: 0, link: -1 })).toMatch(/link/);
    const a = setSocket(emptySockets(), { slot: 0, link: -1 }, fb);
    expect(a.displaced).toBeNull();
    const b = setSocket(a.sockets, { slot: 0, link: -1 }, gem('arc'));
    expect(b.displaced?.uid).toBe(fb.uid);
    expect(a.sockets[0]!.gem?.uid).toBe(fb.uid); // immutable
  });

  it('right-click finds a free link, then one that does not fit', () => {
    let s = setSocket(emptySockets(), { slot: 2, link: -1 }, gem('fireball')).sockets;
    expect(autoSocket(s, gem('lmp'), 2)).toEqual({ slot: 2, link: 0 });
    s = setSocket(s, { slot: 2, link: 0 }, gem('lmp')).sockets;
    s = setSocket(s, { slot: 2, link: 1 }, gem('melee-physical')).sockets;
    s = setSocket(s, { slot: 2, link: 2 }, gem('chain')).sockets;
    expect(supportApplies(s[2]!, gem('melee-physical'))).toBe(false);
    expect(autoSocket(s, gem('pierce'), 2)).toEqual({ slot: 2, link: 1 });
    expect(autoSocket(s, gem('arc'), 2)).toEqual({ slot: 2, link: -1 });
  });

  it('turn into hero controller slots and resolved numbers', () => {
    let s = setSocket(emptySockets(), { slot: 0, link: -1 }, gem('fireball', 4)).sockets;
    s = setSocket(s, { slot: 0, link: 0 }, gem('lmp', 2)).sockets;
    expect(socketsToSlots(s)).toEqual([{ skill: 'fireball', level: 4, supports: [{ gem: 'lmp', level: 2 }] }, null, null, null]);
    const sheet = new StatSheet({ 'cast.speed': 1 });
    const n = skillNumbers(s[0]!, sheet)!;
    expect(n.name).toBe('Fireball');
    expect(n.level).toBe(4);
    expect(n.hit).toBeGreaterThan(0);
    expect(n.dps).toBeCloseTo(n.hit * n.hitsPerSecond);
    expect(n.projectiles).toBe(3); // 1 + 2 (lmp)
    expect(n.supports).toEqual(['lmp']);
    // the numbers read the character's sheet
    sheet.set('tree', [inc('damage', 1)]);
    expect(skillNumbers(s[0]!, sheet)!.hit).toBeCloseTo(n.hit * 2, 3);
    // gear's "+1 to the level of fire skill gems" raises the skill's level (and only fitting skills')
    sheet.set('item:helm', [flat('skill.level', 1, ['fire'])]);
    expect(skillNumbers(s[0]!, sheet)!.level).toBe(5);
    expect(socketsToSlots(s, sheet)[0]!.level).toBe(5);
    sheet.set('item:helm', [flat('skill.level', 1, ['cold'])]);
    expect(skillNumbers(s[0]!, sheet)!.level).toBe(4);
    expect(skillNumbers(emptySockets()[0]!, sheet)).toBeNull();
  });
});

/** Just enough of the shell for the port's pure parts. */
function services(stats: StatSheet, lootFilter = 0): ShellServices {
  return { hero: () => ({ stats }) as unknown as ActorLike, settings: () => ({ lootFilter, damageNumbers: true, screenShake: 1, glyphs: 'auto' }), rng: new Rng(3) } as unknown as ShellServices;
}

describe('the real LootPort', () => {
  it('rolls drops from the kill and the hero’s item quantity / rarity', () => {
    const loot = realLootPort();
    const plain = new StatSheet();
    loot.init(services(plain));
    const kill = { depth: 8, rank: 'rare' as const, level: 10, at: null as never };
    const count = (n: number) => Array.from({ length: n }, (_, i) => loot.rollDrops(kill, new Rng(i)).filter((d) => d.kind === 'item').length).reduce((a, b) => a + b, 0);
    const base = count(400);
    plain.set('gear', [flat('item.quantity', 1)]);
    expect(count(400)).toBeGreaterThan(base * 1.5);
    expect(loot.rollDrops({ ...kill, rank: 'boss' }, new Rng(9)).some((d) => d.kind === 'item' && (d.item.rarity === 'rare' || d.item.rarity === 'unique'))).toBe(true);
  });

  it('load → write keeps items, grid cells, the stash and the sockets; a new run gets starter gems', () => {
    const loot = realLootPort();
    loot.init(services(new StatSheet()));
    const save = newSave(11);
    loot.load(save);
    expect(save.hero.skills.map((s) => s.gem?.gem?.id)).toEqual([...STARTER_GEMS]);
    const item = loot.give(new Rng(4), 10, 'rare')!;
    expect(loot.counts().inventory).toBe(1);
    const out = newSave(11);
    loot.write(out);
    expect(out.hero.inventory.map((i: Item) => i.uid)).toEqual([item.uid]);
    expect(out.positions?.[item.uid]).toBeDefined();
    expect(out.hero.skills.map((s) => s.gem?.gem?.id)).toEqual([...STARTER_GEMS]);
    const again = realLootPort();
    again.init(services(new StatSheet()));
    again.load(out);
    expect(again.store.state.inventory.items[0]).toMatchObject({ item: { uid: item.uid }, x: out.positions![item.uid]!.x, y: out.positions![item.uid]!.y });
  });

  it('gear mods have a source per equipment slot (empty when the slot is)', () => {
    const loot = realLootPort();
    const save = newSave(2);
    save.hero.equipment = { belt: { uid: 'b', base: 'leather-belt', rarity: 'magic', level: 3, name: 'Belt', affixes: [{ id: 'life', tier: 0, mods: [flat('life', 9)] }] } };
    loot.load(save);
    const g = loot.gearMods();
    expect(Object.keys(g)).toHaveLength(10);
    expect(g['item:belt']!.some((m) => m.stat === 'life' && m.value === 9)).toBe(true);
    expect(g['item:weapon']).toEqual([]);
  });
});

describe('the real TreePort', () => {
  it('points follow level and deepest; mods are treeMods', () => {
    const tree = realTreePort();
    expect(tree.points(10, 4)).toBe(pointBudget(10, 4).total);
    expect(tree.points(10)).toBe(9);
    expect(tree.mods([])).toEqual(treeMods([]));
  });
});
