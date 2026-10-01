import { flat, inc, more } from '../core/mods';
import { Registry } from '../core/registry';
import type { SkillGem } from './types';

/**
 * Every active skill gem, as data. Add one by adding an entry: `tags` decide which supports
 * fit and which mods scale it, `delivery` picks the runtime (combat/deliveries), `effects`
 * say what a hit does, `anim` / `combo` name hero clips (src/game/hero/clips/combat.ts),
 * `look` is colour, mesh, sounds and light. `npm run combat -- dps <id>` measures it.
 *
 * Numbers are at gem level 1; `perLevel` mods grow it (default: 6% more damage per level).
 */
const g = (gem: SkillGem): SkillGem => gem;

export const ACTIVE_SKILLS: readonly SkillGem[] = [
  // ------------------------------------------------------------------ melee
  g({
    id: 'slash', name: 'Slash', description: 'Three-hit sword combo. The third hit is a heavy finisher.',
    tags: ['attack', 'melee', 'strike', 'physical', 'damage', 'basic'],
    cost: 0, cooldown: 0, castTime: 0.42, anim: 'Slash1', combo: ['Slash1', 'Slash2', 'Slash3'], moveDuringCast: 0.15,
    delivery: { kind: 'strike', range: 2.3, arc: 120 },
    effects: [{ kind: 'damage', base: {}, effectiveness: 1 }, { kind: 'knockback', force: 2.5 }],
    look: { color: 'white', glow: ['white', 'mist'], burst: 'spark', sound: { cast: 'swing', hit: 'hit' }, shake: 0.08 },
  }),
  g({
    id: 'cleave', name: 'Cleave', description: 'A wide arc that hits everything in front of you.',
    tags: ['attack', 'melee', 'strike', 'area', 'physical', 'damage'],
    cost: 4, cooldown: 0, castTime: 0.55, anim: 'Slash2', combo: ['Slash2', 'Slash1'], moveDuringCast: 0.1,
    delivery: { kind: 'strike', range: 2.8, arc: 200 },
    effects: [{ kind: 'damage', base: {}, effectiveness: 0.9 }, { kind: 'knockback', force: 3 }],
    look: { color: 'white', glow: ['white', 'sand'], burst: 'spark', sound: { cast: 'swing', hit: 'hit' }, shake: 0.1 },
  }),
  g({
    id: 'heavy-strike', name: 'Heavy Strike', description: 'A crushing overhead blow that stuns and throws foes back.',
    tags: ['attack', 'melee', 'strike', 'physical', 'damage'],
    cost: 6, cooldown: 0, castTime: 0.75, anim: 'Slash3', moveDuringCast: 0,
    delivery: { kind: 'strike', range: 2.5, arc: 70 },
    effects: [{ kind: 'damage', base: { physical: [6, 10] }, effectiveness: 2.2 }, { kind: 'knockback', force: 9 }],
    look: { color: 'sand', glow: ['white', 'sand', 'orange'], burst: 'impactSmall', sound: { cast: 'swing', hit: 'crit' }, shake: 0.3 },
  }),
  g({
    id: 'whirlwind', name: 'Whirlwind', description: 'Spin while the key is held, hitting everything around you as you move.',
    tags: ['attack', 'melee', 'area', 'channel', 'physical', 'damage', 'movement'],
    cost: 8, cooldown: 0, castTime: 0.3, anim: 'Spin', channel: true, moveDuringCast: 0.7, tickDamage: 0.6, target: 'self',
    delivery: { kind: 'nova', radius: 2.1 },
    effects: [{ kind: 'damage', base: {}, effectiveness: 0.6 }, { kind: 'knockback', force: 1.5 }],
    look: { color: 'mist', glow: ['white', 'mist'], trail: 'swirl', sound: { cast: 'swing', hit: 'hit' }, shake: 0.04 },
  }),
  g({
    id: 'leap-slam', name: 'Leap Slam', description: 'Leap to the target and slam down, hitting everything where you land.',
    tags: ['attack', 'melee', 'area', 'slam', 'movement', 'physical', 'damage'],
    cost: 10, cooldown: 0, castTime: 0.85, anim: 'LeapSlam', moveDuringCast: 0, leap: { range: 7, height: 2 }, target: 'self',
    delivery: { kind: 'slam', radius: 2.4, delay: 0 },
    effects: [{ kind: 'damage', base: { physical: [8, 14] }, effectiveness: 1.4 }, { kind: 'knockback', force: 7 }],
    look: { color: 'sand', glow: ['sand', 'orange', 'white'], burst: 'impact', sound: { cast: 'dodge', impact: 'explode' }, shake: 0.45 },
  }),
  g({
    id: 'shield-charge', name: 'Shield Charge', description: 'Charge forward, bashing every enemy in your path.',
    tags: ['attack', 'melee', 'movement', 'physical', 'damage'],
    cost: 8, cooldown: 0, castTime: 0.45, anim: 'Charge', moveDuringCast: 0,
    delivery: { kind: 'dash', distance: 7, hitWidth: 1.3 },
    effects: [{ kind: 'damage', base: { physical: [5, 9] }, effectiveness: 1 }, { kind: 'knockback', force: 8 }, { kind: 'ailment', ailment: 'stun', chance: 0.5 }],
    look: { color: 'sky', glow: ['white', 'sky'], trail: 'dust', sound: { cast: 'dodge', hit: 'hit' }, shake: 0.2 },
  }),
  g({
    id: 'ground-slam', name: 'Ground Slam', description: 'Smash the ground ahead, cracking it in a wide burst.',
    tags: ['attack', 'melee', 'area', 'slam', 'physical', 'damage'],
    cost: 9, cooldown: 0, castTime: 0.8, anim: 'Slam', moveDuringCast: 0, target: 'ahead',
    delivery: { kind: 'slam', radius: 2.6, delay: 0.05 },
    effects: [{ kind: 'damage', base: { physical: [4, 8] }, effectiveness: 1.3 }, { kind: 'knockback', force: 6 }],
    look: { color: 'sand', glow: ['sand', 'orange'], burst: 'impact', sound: { impact: 'explode' }, shake: 0.4 },
  }),
  g({
    id: 'frenzy', name: 'Frenzy Strikes', description: 'Quick strikes; every hit grants a short attack speed frenzy, and may grant a frenzy charge.',
    tags: ['attack', 'melee', 'strike', 'physical', 'damage', 'buff', 'duration'],
    cost: 5, cooldown: 0, castTime: 0.3, anim: 'Slash1', combo: ['Slash1', 'Slash2'], moveDuringCast: 0.2,
    delivery: { kind: 'strike', range: 2.2, arc: 90 },
    effects: [
      { kind: 'damage', base: {}, effectiveness: 0.85 },
      { kind: 'buff', mods: [inc('attack.speed', 0.25), inc('move.speed', 0.1)], duration: 3, target: 'self' },
      { kind: 'charges', charge: 'frenzy', count: 1, on: 'hit', chance: 0.25 },
    ],
    look: { color: 'red', glow: ['red', 'orange'], burst: 'spark', sound: { cast: 'swing', hit: 'hit' }, shake: 0.06 },
  }),
  // ------------------------------------------------------------------ bows & projectile attacks
  g({
    id: 'split-arrow', name: 'Split Arrow', description: 'Fires a fan of arrows.',
    tags: ['attack', 'projectile', 'bow', 'physical', 'damage'],
    cost: 6, cooldown: 0, castTime: 0.6, anim: 'BowDraw', combo: ['BowDraw', 'BowRelease'], moveDuringCast: 0.35,
    delivery: { kind: 'projectile', speed: 22, count: 5, spread: 40, pierce: 0, chain: 0, range: 14 },
    effects: [{ kind: 'damage', base: { physical: [4, 8] }, effectiveness: 0.8 }],
    look: { color: 'sand', shape: 'arrow', glow: ['white'], trail: 'streak', sound: { cast: 'projectile', hit: 'hit' } },
  }),
  g({
    id: 'rain-of-arrows', name: 'Rain of Arrows', description: 'Arrows rain down on the target area after a moment.',
    tags: ['attack', 'projectile', 'bow', 'area', 'physical', 'damage'],
    cost: 9, cooldown: 0, castTime: 0.7, anim: 'BowDraw', moveDuringCast: 0.3, target: 'aim',
    delivery: { kind: 'slam', radius: 2.6, delay: 0.5 },
    effects: [{ kind: 'damage', base: { physical: [6, 10] }, effectiveness: 1.1 }],
    look: { color: 'sand', glow: ['sand', 'white'], burst: 'arrows', sound: { cast: 'projectile', impact: 'hit' }, shake: 0.12 },
  }),
  g({
    id: 'explosive-arrow', name: 'Explosive Arrow', description: 'An arrow that bursts into flame where it hits.',
    tags: ['attack', 'projectile', 'bow', 'area', 'fire', 'damage'],
    cost: 9, cooldown: 0, castTime: 0.7, anim: 'BowDraw', moveDuringCast: 0.3, explode: 2.2,
    delivery: { kind: 'projectile', speed: 18, count: 1, spread: 0, pierce: 0, chain: 0, range: 14 },
    effects: [{ kind: 'damage', base: { fire: [10, 16] }, effectiveness: 1.2 }, { kind: 'ailment', ailment: 'ignite', chance: 0.3 }, { kind: 'knockback', force: 5 }],
    look: { color: 'orange', shape: 'arrow', glow: ['sand', 'orange', 'red'], trail: 'ember', burst: 'fire', sound: { cast: 'projectile', impact: 'explode' }, light: { color: 'orange', intensity: 6, radius: 5 }, shake: 0.3 },
  }),
  g({
    id: 'lightning-arrow', name: 'Lightning Arrow', description: 'An arrow that arcs lightning to nearby enemies.',
    tags: ['attack', 'projectile', 'bow', 'lightning', 'damage', 'chain'],
    cost: 7, cooldown: 0, castTime: 0.55, anim: 'BowDraw', combo: ['BowDraw', 'BowRelease'], moveDuringCast: 0.35,
    delivery: { kind: 'projectile', speed: 26, count: 1, spread: 0, pierce: 0, chain: 3, range: 15 },
    effects: [{ kind: 'damage', base: { lightning: [2, 18] }, effectiveness: 1 }, { kind: 'ailment', ailment: 'shock', chance: 0.25 }],
    look: { color: 'cyan', shape: 'arrow', glow: ['white', 'cyan', 'sand'], trail: 'spark', burst: 'zap', sound: { cast: 'projectile', hit: 'zap' }, light: { color: 'cyan', intensity: 4, radius: 4 } },
  }),
  // ------------------------------------------------------------------ spells
  g({
    id: 'fireball', name: 'Fireball', description: 'A ball of fire that bursts on impact and may ignite.',
    tags: ['spell', 'projectile', 'area', 'fire', 'damage'],
    cost: 6, cooldown: 0, castTime: 0.6, anim: 'Cast', moveDuringCast: 0.4, crit: 0.06, explode: 1.4,
    delivery: { kind: 'projectile', speed: 15, count: 1, spread: 0, pierce: 0, chain: 0, range: 14 },
    effects: [{ kind: 'damage', base: { fire: [9, 15] }, effectiveness: 1.6 }, { kind: 'ailment', ailment: 'ignite', chance: 0.25 }],
    look: { color: 'orange', shape: 'orb', glow: ['sand', 'orange', 'red'], trail: 'ember', burst: 'fire', sound: { cast: 'cast', travel: 'projectile', impact: 'explode' }, light: { color: 'orange', intensity: 7, radius: 5 }, shake: 0.15 },
  }),
  g({
    id: 'frost-nova', name: 'Frost Nova', description: 'A ring of frost bursts from you, chilling and freezing.',
    tags: ['spell', 'area', 'nova', 'cold', 'damage'],
    cost: 10, cooldown: 0, castTime: 0.7, anim: 'CastBig', moveDuringCast: 0.1, crit: 0.06, target: 'self',
    delivery: { kind: 'nova', radius: 4 },
    effects: [{ kind: 'damage', base: { cold: [8, 12] }, effectiveness: 1.2 }, { kind: 'ailment', ailment: 'freeze', chance: 0.3 }, { kind: 'knockback', force: 2 }],
    look: { color: 'cyan', glow: ['white', 'cyan', 'sky'], burst: 'frost', sound: { cast: 'ice' }, light: { color: 'cyan', intensity: 6, radius: 6 }, shake: 0.12 },
  }),
  g({
    id: 'arc', name: 'Arc', description: 'A bolt of lightning that chains between enemies.',
    tags: ['spell', 'lightning', 'chain', 'damage'],
    cost: 7, cooldown: 0, castTime: 0.55, anim: 'Cast', moveDuringCast: 0.4, crit: 0.05,
    delivery: { kind: 'projectile', speed: 60, count: 1, spread: 0, pierce: 0, chain: 4, range: 10 },
    effects: [{ kind: 'damage', base: { lightning: [2, 22] }, effectiveness: 1.2 }, { kind: 'ailment', ailment: 'shock', chance: 0.3 }],
    look: { color: 'cyan', shape: 'bolt', glow: ['white', 'cyan'], trail: 'spark', burst: 'zap', sound: { cast: 'zap', hit: 'zap' }, light: { color: 'cyan', intensity: 5, radius: 4 } },
  }),
  g({
    id: 'ice-spear', name: 'Ice Spear', description: 'A fast shard of ice that pierces and crits often.',
    tags: ['spell', 'projectile', 'cold', 'damage'],
    cost: 7, cooldown: 0, castTime: 0.55, anim: 'Cast', moveDuringCast: 0.4, crit: 0.08,
    delivery: { kind: 'projectile', speed: 24, count: 1, spread: 0, pierce: 2, chain: 0, range: 15 },
    effects: [{ kind: 'damage', base: { cold: [10, 15] }, effectiveness: 1.4 }],
    look: { color: 'cyan', shape: 'shard', glow: ['white', 'cyan'], trail: 'frostTrail', burst: 'frost', sound: { cast: 'cast', hit: 'ice' }, light: { color: 'sky', intensity: 3, radius: 3 } },
  }),
  g({
    id: 'flame-wall', name: 'Flame Wall', description: 'A wall of fire that burns everything that stands in it.',
    tags: ['spell', 'area', 'fire', 'duration', 'damage', 'zone'],
    cost: 12, cooldown: 1.5, castTime: 0.6, anim: 'Cast', moveDuringCast: 0.3, target: 'aim', zone: { tick: 0.25, shape: 'wall' }, tickDamage: 0.25,
    delivery: { kind: 'trap', radius: 2.5, arm: 0, duration: 4 },
    effects: [{ kind: 'damage', base: { fire: [6, 10] }, effectiveness: 0.8 }, { kind: 'ailment', ailment: 'ignite', chance: 0.15 }],
    look: { color: 'orange', glow: ['sand', 'orange', 'red'], trail: 'flames', sound: { cast: 'cast', hit: 'burn' }, light: { color: 'orange', intensity: 5, radius: 5 } },
  }),
  g({
    id: 'meteor', name: 'Meteor', description: 'Call down a meteor on the target after a delay.',
    tags: ['spell', 'area', 'fire', 'damage', 'slam'],
    cost: 20, cooldown: 2, castTime: 0.9, anim: 'CastBig', moveDuringCast: 0.2, crit: 0.07, target: 'aim',
    delivery: { kind: 'slam', radius: 3.2, delay: 1 },
    effects: [{ kind: 'damage', base: { fire: [30, 46] }, effectiveness: 3 }, { kind: 'ailment', ailment: 'ignite', chance: 0.5 }, { kind: 'knockback', force: 8 }],
    look: { color: 'red', shape: 'rock', glow: ['white', 'sand', 'orange', 'red'], burst: 'fire', sound: { cast: 'cast', impact: 'explode' }, light: { color: 'orange', intensity: 10, radius: 8 }, shake: 0.7 },
  }),
  g({
    id: 'storm-call', name: 'Storm Call', description: 'Mark the ground; lightning strikes it moments later.',
    tags: ['spell', 'area', 'lightning', 'damage', 'slam', 'duration'],
    cost: 9, cooldown: 0, castTime: 0.6, anim: 'Cast', moveDuringCast: 0.35, crit: 0.06, target: 'aim',
    delivery: { kind: 'slam', radius: 2.2, delay: 0.7 },
    effects: [{ kind: 'damage', base: { lightning: [6, 28] }, effectiveness: 1.6 }, { kind: 'ailment', ailment: 'shock', chance: 0.3 }],
    look: { color: 'cyan', shape: 'bolt', glow: ['white', 'cyan', 'sky'], burst: 'zap', sound: { cast: 'cast', impact: 'zap' }, light: { color: 'cyan', intensity: 8, radius: 6 }, shake: 0.25 },
  }),
  g({
    id: 'chaos-bolt', name: 'Chaos Bolt', description: 'A homing bolt of chaos that poisons.',
    tags: ['spell', 'projectile', 'chaos', 'damage'],
    cost: 7, cooldown: 0, castTime: 0.6, anim: 'Cast', moveDuringCast: 0.4, crit: 0.05,
    delivery: { kind: 'projectile', speed: 11, count: 1, spread: 0, pierce: 0, chain: 0, range: 14, homing: 3 },
    effects: [{ kind: 'damage', base: { chaos: [8, 14] }, effectiveness: 1.3 }, { kind: 'ailment', ailment: 'poison', chance: 0.6 }],
    look: { color: 'plum', shape: 'skull', glow: ['lime', 'green', 'plum'], trail: 'toxic', burst: 'toxic', sound: { cast: 'cast', hit: 'hit' }, light: { color: 'lime', intensity: 4, radius: 4 } },
  }),
  g({
    id: 'searing-beam', name: 'Searing Beam', description: 'Channel a beam of fire that burns everything along it.',
    tags: ['spell', 'fire', 'channel', 'damage', 'beam'],
    cost: 10, cooldown: 0, castTime: 0.25, anim: 'CastBig', channel: true, moveDuringCast: 0.25, crit: 0.05, tickDamage: 1,
    delivery: { kind: 'beam', length: 8, width: 0.8, tick: 0.2 },
    effects: [{ kind: 'damage', base: { fire: [3, 5] }, effectiveness: 0.5 }, { kind: 'ailment', ailment: 'ignite', chance: 0.1 }],
    look: { color: 'orange', glow: ['white', 'sand', 'orange'], trail: 'ember', sound: { cast: 'cast', hit: 'burn' }, light: { color: 'orange', intensity: 6, radius: 6 } },
  }),
  // ------------------------------------------------------------------ movement
  g({
    id: 'dodge-roll', name: 'Dodge Roll', description: 'Roll out of danger; invulnerable for most of it. Always on Space.',
    tags: ['movement', 'dodge'],
    cost: 0, cooldown: 0, castTime: 0.42, anim: 'Roll', moveDuringCast: 0,
    delivery: { kind: 'dash', distance: 4.2, hitWidth: 0 },
    effects: [{ kind: 'sound', sound: 'dodge' }],
    look: { color: 'mist', trail: 'dust', sound: { cast: 'dodge' } },
  }),
  g({
    id: 'blink', name: 'Blink', description: 'Teleport a short distance.',
    tags: ['spell', 'movement', 'blink'],
    cost: 8, cooldown: 2.5, castTime: 0.25, anim: 'Cast', moveDuringCast: 0, teleport: true,
    delivery: { kind: 'dash', distance: 6, hitWidth: 0 },
    effects: [{ kind: 'particles', preset: 'blink' }],
    look: { color: 'sky', glow: ['white', 'cyan', 'sky'], burst: 'blink', sound: { cast: 'zap' }, light: { color: 'cyan', intensity: 4, radius: 4 } },
  }),
  g({
    id: 'dash', name: 'Dash', description: 'Dash forward, cutting through enemies on the way.',
    tags: ['attack', 'movement', 'melee', 'physical', 'damage'],
    cost: 6, cooldown: 1.2, castTime: 0.3, anim: 'Charge', moveDuringCast: 0,
    delivery: { kind: 'dash', distance: 6, hitWidth: 1 },
    effects: [{ kind: 'damage', base: { physical: [3, 6] }, effectiveness: 0.7 }],
    look: { color: 'white', glow: ['white', 'mist'], trail: 'streak', sound: { cast: 'dodge', hit: 'hit' } },
  }),
  // ------------------------------------------------------------------ minions
  g({
    id: 'summon-skeletons', name: 'Summon Skeletons', description: 'Raise skeleton warriors that fight for you.',
    tags: ['spell', 'minion', 'duration', 'summon', 'damage'],
    cost: 15, cooldown: 1, castTime: 0.8, anim: 'CastBig', moveDuringCast: 0.2, target: 'ahead',
    delivery: { kind: 'summon', genome: 'minion', count: 3, duration: 20 },
    // minions hit often and small: their base and growth carry them through armour at depth
    effects: [{ kind: 'damage', base: { physical: [4, 7] }, effectiveness: 1 }],
    perLevel: [more('damage', 0.12), inc('life', 0.05, ['minion'])],
    look: { color: 'white', glow: ['white', 'mist', 'slate'], burst: 'bones', sound: { cast: 'cast' } },
  }),
  g({
    id: 'raise-spectre', name: 'Raise Spectre', description: 'Raise a spectral caster that hurls bolts at your enemies.',
    tags: ['spell', 'minion', 'summon', 'damage'],
    cost: 25, cooldown: 3, castTime: 1, anim: 'CastBig', moveDuringCast: 0.1, target: 'ahead',
    delivery: { kind: 'summon', genome: 'spectre', count: 1, duration: 0 },
    effects: [{ kind: 'damage', base: { chaos: [8, 14] }, effectiveness: 1 }],
    perLevel: [more('damage', 0.12)],
    look: { color: 'plum', glow: ['lime', 'plum'], burst: 'toxic', sound: { cast: 'cast' } },
  }),
  // ------------------------------------------------------------------ auras, buffs, warcries
  g({
    id: 'haste-aura', name: 'Haste', description: 'An aura that speeds up you and your allies. Toggle; reserves 25% of your mana.',
    tags: ['spell', 'aura', 'area', 'buff'],
    cost: 0, reserve: 0.25, cooldown: 0.5, castTime: 0.5, anim: 'CastBig', moveDuringCast: 0.4, target: 'self',
    delivery: { kind: 'aura', radius: 6 },
    effects: [{ kind: 'buff', mods: [inc('attack.speed', 0.15), inc('cast.speed', 0.15), inc('move.speed', 0.12)], duration: 0, target: 'allies' }],
    look: { color: 'lime', glow: ['lime', 'green'], burst: 'sparkle', sound: { cast: 'cast' } },
  }),
  g({
    id: 'wrath', name: 'Wrath', description: 'An aura of storms: you and your allies add lightning to every hit. Toggle; reserves 35% of your mana.',
    tags: ['spell', 'aura', 'area', 'buff', 'lightning'],
    cost: 0, reserve: 0.35, cooldown: 0.5, castTime: 0.5, anim: 'CastBig', moveDuringCast: 0.4, target: 'self',
    delivery: { kind: 'aura', radius: 6 },
    effects: [{ kind: 'buff', mods: [flat('added.lightning.min', 2, ['attack']), flat('added.lightning.max', 16, ['attack']), flat('added.lightning.min', 1, ['spell']), flat('added.lightning.max', 10, ['spell']), inc('lightning.damage', 0.15)], duration: 0, target: 'allies' }],
    look: { color: 'cyan', glow: ['white', 'cyan', 'sky'], burst: 'zap', sound: { cast: 'zap' } },
  }),
  g({
    id: 'determination', name: 'Determination', description: 'An aura of iron resolve: much more armour for you and your allies. Toggle; reserves 40% of your mana.',
    tags: ['spell', 'aura', 'area', 'buff'],
    cost: 0, reserve: 0.4, cooldown: 0.5, castTime: 0.5, anim: 'CastBig', moveDuringCast: 0.4, target: 'self',
    delivery: { kind: 'aura', radius: 6 },
    effects: [{ kind: 'buff', mods: [flat('armour', 120), more('armour', 0.3)], duration: 0, target: 'allies' }],
    look: { color: 'sand', glow: ['white', 'sand', 'orange'], burst: 'impactSmall', sound: { cast: 'block' } },
  }),
  g({
    id: 'molten-shell', name: 'Molten Shell', description: 'Harden your skin with molten rock, then blast nearby foes.',
    tags: ['spell', 'buff', 'area', 'fire', 'duration', 'damage', 'nova'],
    cost: 12, cooldown: 4, castTime: 0.5, anim: 'CastBig', moveDuringCast: 0.3, target: 'self',
    delivery: { kind: 'nova', radius: 2.6 },
    effects: [
      { kind: 'damage', base: { fire: [10, 16] }, effectiveness: 1 },
      { kind: 'buff', mods: [flat('armour', 400), flat('res.fire', 0.2), more('damage.taken', -0.1)], duration: 8, target: 'self' },
    ],
    look: { color: 'orange', glow: ['sand', 'orange', 'red'], burst: 'fire', sound: { cast: 'explode' }, light: { color: 'orange', intensity: 6, radius: 5 }, shake: 0.2 },
  }),
  g({
    id: 'war-cry', name: 'War Cry', description: 'A roar that empowers you and makes nearby enemies take more damage.',
    tags: ['warcry', 'area', 'buff', 'duration'],
    cost: 10, cooldown: 6, castTime: 0.6, anim: 'Shout', moveDuringCast: 0, target: 'self',
    delivery: { kind: 'nova', radius: 5 },
    effects: [
      { kind: 'buff', mods: [inc('damage', 0.25), inc('attack.speed', 0.1)], duration: 6, target: 'self' },
      { kind: 'buff', mods: [inc('damage.taken', 0.15)], duration: 6, target: 'enemies' },
      { kind: 'knockback', force: 4 },
    ],
    look: { color: 'red', glow: ['white', 'red'], burst: 'shout', sound: { cast: 'crit' }, shake: 0.25 },
  }),
  g({
    id: 'enduring-cry', name: 'Enduring Cry', description: 'A defiant roar: gain two endurance charges and regenerate life for a moment.',
    tags: ['warcry', 'area', 'buff', 'duration', 'charge'],
    cost: 8, cooldown: 8, castTime: 0.6, anim: 'Shout', moveDuringCast: 0, target: 'self',
    delivery: { kind: 'nova', radius: 4 },
    effects: [
      { kind: 'charges', charge: 'endurance', count: 2 },
      { kind: 'buff', mods: [flat('life.regen.pct', 0.025)], duration: 4, target: 'self' },
      { kind: 'knockback', force: 3 },
    ],
    look: { color: 'orange', glow: ['white', 'orange', 'red'], burst: 'shout', sound: { cast: 'crit' }, shake: 0.2 },
  }),
  g({
    id: 'discharge', name: 'Discharge', description: 'Release every charge you hold in one storm around you: much more damage for each charge spent.',
    tags: ['spell', 'area', 'nova', 'lightning', 'fire', 'damage', 'charge'],
    cost: 12, cooldown: 1, castTime: 0.65, anim: 'CastBig', moveDuringCast: 0.1, crit: 0.06, target: 'self',
    delivery: { kind: 'nova', radius: 3.6 },
    effects: [
      { kind: 'damage', base: { lightning: [4, 16], fire: [4, 8] }, effectiveness: 1 },
      { kind: 'charges', charge: 'all', count: -99, perCharge: [more('damage', 0.6)] },
      { kind: 'ailment', ailment: 'shock', chance: 0.3 },
      { kind: 'knockback', force: 4 },
    ],
    look: { color: 'cyan', glow: ['white', 'cyan', 'sand', 'orange'], burst: 'zap', sound: { cast: 'zap', hit: 'zap' }, light: { color: 'cyan', intensity: 8, radius: 6 }, shake: 0.3 },
  }),
  // ------------------------------------------------------------------ curses
  // A curse is a hex on an area at the aim point (the `curse` delivery): every enemy inside gets
  // the curse's mods for its duration, scaled by `curse.effect` / `curse.duration`. A caster
  // keeps 1 + `curse.count` curses on a target; `curse.immune` targets shrug them off.
  g({
    id: 'vulnerability', name: 'Vulnerability', description: 'Curse an area: enemies take much more physical damage and damage over time.',
    tags: ['spell', 'curse', 'area', 'duration', 'physical'],
    cost: 10, cooldown: 0, castTime: 0.5, anim: 'Cast', moveDuringCast: 0.4, target: 'aim',
    delivery: { kind: 'curse', radius: 3 },
    effects: [{ kind: 'curse', mods: [inc('damage.taken', 0.3, ['physical']), inc('damage.taken', 0.3, ['dot'])], duration: 6 }],
    perLevel: [inc('curse.effect', 0.015)],
    look: { color: 'red', glow: ['red', 'orange', 'plum'], burst: 'hex', sound: { cast: 'cast', impact: 'hex' } },
  }),
  g({
    id: 'elemental-weakness', name: 'Elemental Weakness', description: 'Curse an area: enemies lose a quarter of their fire, cold and lightning resistance.',
    tags: ['spell', 'curse', 'area', 'duration', 'elemental'],
    cost: 10, cooldown: 0, castTime: 0.5, anim: 'Cast', moveDuringCast: 0.4, target: 'aim',
    delivery: { kind: 'curse', radius: 3 },
    effects: [{ kind: 'curse', mods: [flat('res.fire', -0.25), flat('res.cold', -0.25), flat('res.lightning', -0.25)], duration: 6 }],
    perLevel: [inc('curse.effect', 0.015)],
    look: { color: 'cyan', glow: ['cyan', 'sky', 'white'], burst: 'hex', sound: { cast: 'cast', impact: 'hex' } },
  }),
  g({
    id: 'enfeeble', name: 'Enfeeble', description: 'Curse an area: enemies deal much less damage and miss more often.',
    tags: ['spell', 'curse', 'area', 'duration'],
    cost: 10, cooldown: 0, castTime: 0.5, anim: 'Cast', moveDuringCast: 0.4, target: 'aim',
    delivery: { kind: 'curse', radius: 3 },
    effects: [{ kind: 'curse', mods: [more('damage', -0.3), more('accuracy', -0.25)], duration: 6 }],
    perLevel: [inc('curse.effect', 0.015)],
    look: { color: 'lime', glow: ['lime', 'green', 'plum'], burst: 'hex', sound: { cast: 'cast', impact: 'hex' } },
  }),
  g({
    id: 'temporal-chains', name: 'Temporal Chains', description: 'Curse an area: enemies act and move much more slowly.',
    tags: ['spell', 'curse', 'area', 'duration'],
    cost: 12, cooldown: 0, castTime: 0.55, anim: 'Cast', moveDuringCast: 0.4, target: 'aim',
    delivery: { kind: 'curse', radius: 3 },
    effects: [{ kind: 'curse', mods: [more('action.speed', -0.3), more('move.speed', -0.3)], duration: 5 }],
    perLevel: [inc('curse.effect', 0.015)],
    look: { color: 'sand', glow: ['sand', 'white', 'mist'], burst: 'hex', sound: { cast: 'cast', impact: 'hex' } },
  }),
  // ------------------------------------------------------------------ traps & mines
  g({
    id: 'fire-trap', name: 'Fire Trap', description: 'Throw a trap that explodes in flames when an enemy comes near.',
    tags: ['spell', 'trap', 'area', 'fire', 'duration', 'damage'],
    cost: 8, cooldown: 0.5, castTime: 0.45, anim: 'Cast', moveDuringCast: 0.4, target: 'aim',
    delivery: { kind: 'trap', radius: 2.2, arm: 0.4, duration: 10 },
    effects: [{ kind: 'damage', base: { fire: [14, 22] }, effectiveness: 1.5 }, { kind: 'ailment', ailment: 'ignite', chance: 0.5 }, { kind: 'knockback', force: 5 }],
    look: { color: 'orange', glow: ['sand', 'orange', 'red'], burst: 'fire', sound: { cast: 'cast', impact: 'explode' }, light: { color: 'orange', intensity: 7, radius: 5 }, shake: 0.25 },
  }),
  g({
    id: 'frost-mine', name: 'Frost Mine', description: 'Plant a mine that bursts into freezing shards.',
    tags: ['spell', 'trap', 'mine', 'area', 'cold', 'duration', 'damage'],
    cost: 8, cooldown: 0.5, castTime: 0.45, anim: 'Cast', moveDuringCast: 0.4, target: 'aim',
    delivery: { kind: 'trap', radius: 2.6, arm: 0.6, duration: 10 },
    effects: [{ kind: 'damage', base: { cold: [12, 18] }, effectiveness: 1.4 }, { kind: 'ailment', ailment: 'freeze', chance: 0.6 }],
    look: { color: 'cyan', glow: ['white', 'cyan', 'sky'], burst: 'frost', sound: { cast: 'cast', impact: 'ice' }, light: { color: 'cyan', intensity: 6, radius: 5 }, shake: 0.15 },
  }),
];

export const SKILLS = new Registry<SkillGem>('skill', ACTIVE_SKILLS);
