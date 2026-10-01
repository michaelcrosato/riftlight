import { flag, flat, inc, more } from '../core/mods';
import { Registry } from '../core/registry';
import type { SupportGem } from './types';

/**
 * Every support gem, as data. A support links to any active skill that has all of its
 * `requires` tags and none of its `excludes`. Its `mods` apply to that skill only (they are
 * folded in at hit time, never put on the character's sheet), `changes` reshape the
 * delivery, `costMultiplier` scales mana cost. `perLevel` mods grow with gem level.
 */
const s = (gem: SupportGem): SupportGem => gem;
const DMG = ['damage'];

export const SUPPORT_GEMS: readonly SupportGem[] = [
  // ---------------------------------------------------------------- added damage
  s({ id: 'added-fire', name: 'Added Fire Damage', description: 'Adds fire damage and converts a little physical to fire.', requires: DMG, tags: ['fire'],
    mods: [flat('added.fire.min', 4), flat('added.fire.max', 8), flat('convert.physical.fire', 0.15)], costMultiplier: 1.2, perLevel: [flat('added.fire.max', 1)] }),
  s({ id: 'added-cold', name: 'Added Cold Damage', description: 'Adds cold damage.', requires: DMG, tags: ['cold'],
    mods: [flat('added.cold.min', 3), flat('added.cold.max', 7)], costMultiplier: 1.2, perLevel: [flat('added.cold.max', 1)] }),
  s({ id: 'added-lightning', name: 'Added Lightning Damage', description: 'Adds lightning damage and a chance to shock.', requires: DMG, tags: ['lightning'],
    mods: [flat('added.lightning.min', 1), flat('added.lightning.max', 12), flat('shock.chance', 0.1)], costMultiplier: 1.2, perLevel: [flat('added.lightning.max', 1.5)] }),
  s({ id: 'added-chaos', name: 'Added Chaos Damage', description: 'Adds chaos damage that can poison.', requires: DMG, tags: ['chaos'],
    mods: [flat('added.chaos.min', 3), flat('added.chaos.max', 6), flat('poison.chance', 0.15)], costMultiplier: 1.2 }),
  // ---------------------------------------------------------------- melee
  s({ id: 'melee-physical', name: 'Melee Physical Damage', description: 'Much more physical melee damage, a little slower.', requires: ['melee'], tags: ['physical'],
    mods: [more('damage', 0.35, ['physical']), more('attack.speed', -0.1)], costMultiplier: 1.3, perLevel: [more('damage', 0.01, ['physical'])] }),
  s({ id: 'multistrike', name: 'Multistrike', description: 'Each use strikes three times, much faster, with less damage.', requires: ['attack', 'melee'], excludes: ['channel', 'movement'],
    mods: [more('attack.speed', 0.6), more('damage', -0.3)], changes: { repeats: 2 }, costMultiplier: 1.4 }),
  s({ id: 'brutality', name: 'Brutality', description: 'Much more physical damage; deals no elemental or chaos damage.', requires: DMG, tags: ['physical'],
    mods: [more('damage', 0.4, ['physical']), flag('no.fire'), flag('no.cold'), flag('no.lightning'), flag('no.chaos')], costMultiplier: 1.3 }),
  s({ id: 'pulverise', name: 'Pulverise', description: 'Bigger slams and strikes, slower.', requires: ['melee', 'area'],
    mods: [more('damage', 0.25, ['area']), inc('area', 0.25), more('attack.speed', -0.15)], costMultiplier: 1.3 }),
  s({ id: 'chance-to-bleed', name: 'Chance to Bleed', description: 'Attacks may make enemies bleed.', requires: ['attack'], tags: ['physical'],
    mods: [flat('bleed.chance', 0.3), more('ailment.effect', 0.15, ['attack'])], costMultiplier: 1.1 }),
  s({ id: 'knockback', name: 'Knockback', description: 'Hits throw enemies back hard.', requires: DMG,
    mods: [flat('knockback', 6), more('knockback', 0.5)], costMultiplier: 1.05 }),
  s({ id: 'stun', name: 'Stun', description: 'Hits stun far more easily.', requires: ['attack'],
    mods: [flat('stun.chance', 0.25)], changes: { addTags: ['stun'] }, costMultiplier: 1.1 }),
  // ---------------------------------------------------------------- projectiles
  s({ id: 'gmp', name: 'Greater Multiple Projectiles', description: 'Four more projectiles, less damage each.', requires: ['projectile'],
    mods: [more('damage', -0.26)], changes: { projectiles: 4 }, costMultiplier: 1.5 }),
  s({ id: 'lmp', name: 'Lesser Multiple Projectiles', description: 'Two more projectiles.', requires: ['projectile'],
    mods: [more('damage', -0.15)], changes: { projectiles: 2 }, costMultiplier: 1.3 }),
  s({ id: 'chain', name: 'Chain', description: 'Projectiles chain to two more enemies.', requires: ['projectile'],
    mods: [more('damage', -0.2)], changes: { chain: 2 }, costMultiplier: 1.4 }),
  s({ id: 'pierce', name: 'Pierce', description: 'Projectiles pierce three enemies and hit harder.', requires: ['projectile'],
    mods: [more('damage', 0.1, ['projectile'])], changes: { pierce: 3 }, costMultiplier: 1.2 }),
  s({ id: 'fork', name: 'Fork', description: 'Projectiles split in two on their first hit.', requires: ['projectile'],
    mods: [more('damage', -0.1)], changes: { fork: 1 }, costMultiplier: 1.3 }),
  s({ id: 'faster-projectiles', name: 'Faster Projectiles', description: 'Projectiles fly much faster and hit a little harder.', requires: ['projectile'],
    mods: [inc('projectile.speed', 0.6), more('damage', 0.1, ['projectile'])], costMultiplier: 1.1 }),
  s({ id: 'homing', name: 'Homing Projectiles', description: 'Projectiles seek out enemies.', requires: ['projectile'],
    mods: [flat('projectile.homing', 4)], costMultiplier: 1.1 }),
  // ---------------------------------------------------------------- area
  s({ id: 'increased-area', name: 'Increased Area', description: 'Areas are much larger.', requires: ['area'],
    mods: [], changes: { area: 0.45 }, costMultiplier: 1.3, perLevel: [inc('area', 0.01)] }),
  s({ id: 'concentrated-effect', name: 'Concentrated Effect', description: 'Smaller areas, much more area damage.', requires: ['area'],
    mods: [more('area', -0.3), more('damage', 0.45, ['area'])], costMultiplier: 1.4 }),
  // ---------------------------------------------------------------- speed
  s({ id: 'faster-attacks', name: 'Faster Attacks', description: 'Attack much faster.', requires: ['attack'],
    mods: [inc('attack.speed', 0.3)], costMultiplier: 1.15, perLevel: [inc('attack.speed', 0.01)] }),
  s({ id: 'faster-casting', name: 'Faster Casting', description: 'Cast spells much faster.', requires: ['spell'],
    mods: [inc('cast.speed', 0.3)], costMultiplier: 1.2, perLevel: [inc('cast.speed', 0.01)] }),
  s({ id: 'spell-echo', name: 'Spell Echo', description: 'Spells repeat once, much faster, with a little less damage.', requires: ['spell'], excludes: ['channel', 'movement', 'minion', 'aura', 'trap', 'zone'],
    mods: [more('cast.speed', 0.6), more('damage', -0.1)], changes: { repeats: 1 }, costMultiplier: 1.4 }),
  // ---------------------------------------------------------------- damage & crit
  s({ id: 'elemental-focus', name: 'Elemental Focus', description: 'Much more elemental damage; can no longer inflict elemental ailments.', requires: DMG,
    mods: [more('damage', 0.4, ['elemental']), flag('noAilments')], costMultiplier: 1.3 }),
  s({ id: 'controlled-destruction', name: 'Controlled Destruction', description: 'More spell damage, far fewer crits.', requires: ['spell', 'damage'],
    mods: [more('damage', 0.3, ['spell']), inc('crit.chance', -0.9)], costMultiplier: 1.3 }),
  s({ id: 'increased-crit', name: 'Increased Critical Strikes', description: 'Crit much more often.', requires: DMG,
    mods: [inc('crit.chance', 1), flat('crit.chance', 0.01)], costMultiplier: 1.15 }),
  s({ id: 'crit-damage', name: 'Increased Critical Damage', description: 'Crits hit much harder.', requires: DMG,
    mods: [flat('crit.multiplier', 0.75)], costMultiplier: 1.15 }),
  s({ id: 'fire-penetration', name: 'Fire Penetration', description: 'Fire damage ignores some fire resistance.', requires: ['fire', 'damage'],
    mods: [flat('pen.fire', 0.25), more('damage', 0.1, ['fire'])], costMultiplier: 1.2 }),
  s({ id: 'cold-penetration', name: 'Cold Penetration', description: 'Cold damage ignores some cold resistance.', requires: ['cold', 'damage'],
    mods: [flat('pen.cold', 0.25), more('damage', 0.1, ['cold'])], costMultiplier: 1.2 }),
  s({ id: 'lightning-penetration', name: 'Lightning Penetration', description: 'Lightning damage ignores some lightning resistance.', requires: ['lightning', 'damage'],
    mods: [flat('pen.lightning', 0.25), more('damage', 0.1, ['lightning'])], costMultiplier: 1.2 }),
  // ---------------------------------------------------------------- ailments
  s({ id: 'burning-damage', name: 'Burning Damage', description: 'Ignites more often and burn much harder.', requires: DMG, tags: ['fire'],
    mods: [flat('ignite.chance', 0.25), more('ailment.effect', 0.4)], costMultiplier: 1.2 }),
  s({ id: 'hypothermia', name: 'Hypothermia', description: 'Freeze more often; more damage to chilled enemies.', requires: DMG, tags: ['cold'],
    mods: [flat('freeze.chance', 0.2), more('damage', 0.15, ['cold'])], costMultiplier: 1.2 }),
  s({ id: 'poison', name: 'Poison', description: 'Hits poison, and poisons hurt more.', requires: DMG, tags: ['chaos'],
    mods: [flat('poison.chance', 0.5), more('ailment.effect', 0.2)], costMultiplier: 1.2 }),
  // ---------------------------------------------------------------- utility
  s({ id: 'life-leech', name: 'Life Leech', description: 'Leech a share of damage dealt as life.', requires: DMG,
    mods: [flat('leech.life', 0.03)], costMultiplier: 1.1, perLevel: [flat('leech.life', 0.001)] }),
  s({ id: 'mana-leech', name: 'Mana Leech', description: 'Leech a share of damage dealt as mana.', requires: DMG,
    mods: [flat('leech.mana', 0.02)], costMultiplier: 1.05 }),
  s({ id: 'culling-strike', name: 'Culling Strike', description: 'Kill enemies left below 10% life.', requires: DMG,
    mods: [flag('cull')], costMultiplier: 1.1 }),
  s({ id: 'increased-duration', name: 'Increased Duration', description: 'Skill effects last much longer.', requires: ['duration'],
    mods: [inc('duration', 0.5)], costMultiplier: 1.2 }),
  s({ id: 'efficacy', name: 'Efficacy', description: 'More damage over time and duration.', requires: ['duration'],
    mods: [more('ailment.effect', 0.25), inc('duration', 0.2)], costMultiplier: 1.2 }),
  s({ id: 'trap-damage', name: 'Trap and Mine Damage', description: 'Traps and mines hit much harder.', requires: ['trap'],
    mods: [more('damage', 0.35, ['trap'])], costMultiplier: 1.3 }),
  s({ id: 'swift-traps', name: 'Swift Assembly', description: 'Traps arm faster and you throw them faster.', requires: ['trap'],
    mods: [inc('cast.speed', 0.25), inc('trap.arm', -0.5)], costMultiplier: 1.1 }),
  // ---------------------------------------------------------------- minions
  s({ id: 'minion-damage', name: 'Minion Damage', description: 'Minions deal much more damage.', requires: ['minion'],
    mods: [more('damage', 0.35, ['minion'])], costMultiplier: 1.3, perLevel: [more('damage', 0.01, ['minion'])] }),
  s({ id: 'minion-life', name: 'Minion Life', description: 'Minions have much more life.', requires: ['minion'],
    mods: [inc('life', 0.45, ['minion'])], costMultiplier: 1.3 }),
  s({ id: 'minion-speed', name: 'Minion Speed', description: 'Minions move and attack faster.', requires: ['minion'],
    mods: [inc('move.speed', 0.3, ['minion']), inc('attack.speed', 0.2, ['minion']), inc('cast.speed', 0.2, ['minion'])], costMultiplier: 1.2 }),
  // ---------------------------------------------------------------- totems & traps (placement)
  // `placement` turns the linked skill into something you place: a totem that casts it at
  // whatever comes in reach (combat/totems.ts), or a trap that releases it at the first enemy
  // to come near (combat/deliveries/trap.ts). The added tag lets `totem` / `trap` mods scale it.
  s({ id: 'spell-totem', name: 'Spell Totem', description: 'Plant a totem that casts the spell for you.', requires: ['spell'], excludes: ['movement', 'channel', 'minion', 'aura', 'trap', 'totem', 'zone', 'warcry'],
    mods: [more('damage', -0.1)], changes: { addTags: ['totem'] }, placement: 'totem', costMultiplier: 1.4, perLevel: [more('damage', 0.01)] }),
  s({ id: 'ballista-totem', name: 'Ballista Totem', description: 'Plant a ballista that fires the projectile attack for you.', requires: ['attack', 'projectile'], excludes: ['movement', 'channel', 'trap', 'totem'],
    mods: [more('attack.speed', -0.1)], changes: { addTags: ['totem'] }, placement: 'totem', costMultiplier: 1.4, perLevel: [more('damage', 0.01)] }),
  s({ id: 'trap-support', name: 'Trap', description: 'Throw the skill as a trap: it goes off at the first enemy that comes near.', requires: ['damage'], excludes: ['melee', 'movement', 'channel', 'minion', 'aura', 'trap', 'totem', 'zone', 'buff', 'warcry'],
    mods: [more('damage', 0.1, ['trap'])], changes: { addTags: ['trap'] }, placement: 'trap', costMultiplier: 1.2 }),
  // ---------------------------------------------------------------- charges
  s({ id: 'power-charge-on-crit', name: 'Power Charge on Critical', description: 'Critical strikes may grant a power charge.', requires: DMG, tags: ['charge'],
    mods: [flat('charge.onCrit', 0.4, ['power'])], costMultiplier: 1.1 }),
  s({ id: 'endurance-charge-on-stun', name: 'Endurance Charge on Melee Stun', description: 'Stunning an enemy grants an endurance charge; stuns last longer.', requires: ['melee'], tags: ['charge'],
    mods: [flat('charge.onStun', 1, ['endurance']), flat('charge.onHit', 0.05, ['endurance']), inc('stun.duration', 0.3)], costMultiplier: 1.1 }),
  s({ id: 'frenzy-charge-on-hit', name: 'Frenzy Charge on Hit', description: 'Attacks may grant a frenzy charge on hit.', requires: ['attack'], tags: ['charge'],
    mods: [flat('charge.onHit', 0.2, ['frenzy'])], costMultiplier: 1.1 }),
  // ---------------------------------------------------------------- auras
  s({ id: 'enlighten', name: 'Enlighten', description: 'Auras reserve less, buffs cost less mana.', requires: ['buff'],
    mods: [], costMultiplier: 0.7 }),
];

export const SUPPORTS = new Registry<SupportGem>('support', SUPPORT_GEMS);
