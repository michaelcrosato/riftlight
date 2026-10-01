/**
 * Cluster templates for the Wit / Zeal side of the wheel: spells by element, cast speed,
 * energy shield, mana, ignite, auras, minions, curses, area, and the lantern light that
 * pushes back the Gloom.
 */
import { flat, inc } from '../../core/mods';
import { N, T } from './dsl';
import { R } from './stats';

export const WIT_CLUSTERS = [
  T({
    id: 'fire',
    name: 'Pyromancy',
    tags: ['fire', 'spell'],
    shapes: ['fork', 'trident', 'wheel2', 'ring2'],
    pool: [R('fire.damage', 'inc', 3), R('damage', 'inc', 1, ['spell']), R('ignite.chance', 'flat', 1), R('res.fire', 'flat', 0.5)],
    notables: [
      N('pyromaniac', 'Pyromaniac', [inc('fire.damage', 0.3), flat('ignite.chance', 0.05)], 'Some people just want to watch the braziers burn.'),
      N('kindling', 'Kindling', [inc('fire.damage', 0.2), inc('cast.speed', 0.05, ['fire'])], 'Small sparks, quickly struck.'),
      N('wildfire', 'Wildfire', [inc('area', 0.15, ['fire']), inc('fire.damage', 0.2)], 'It spreads. That is the point.'),
      N('heart-of-flame', 'Heart of Flame', [inc('fire.damage', 0.25), flat('res.fire', 0.15)], 'You cannot burn what is already burning.'),
    ],
  }),
  T({
    id: 'cold',
    name: 'Hoarfrost',
    tags: ['cold', 'spell'],
    shapes: ['fork', 'trident', 'wheel2', 'diamond'],
    pool: [R('cold.damage', 'inc', 3), R('chill.effect', 'inc', 1), R('freeze.chance', 'flat', 1)],
    notables: [
      N('winters-grasp', "Winter's Grasp", [inc('cold.damage', 0.3), inc('chill.effect', 0.15)], 'Cold fingers close slowly. They do not open.'),
      N('shatterpoint', 'Shatterpoint', [flat('freeze.chance', 0.06), inc('cold.damage', 0.2)], 'On Frostglass, everything is one tap from pieces.'),
      N('glacial-mind', 'Glacial Mind', [inc('cold.damage', 0.2), flat('res.cold', 0.15), flat('mana', 20)], 'Calm as deep ice.'),
      N('frostbite', 'Frostbite', [inc('chill.effect', 0.3), inc('ailment.duration', 0.2, ['cold'])], 'First the fingers, then the will.'),
    ],
  }),
  T({
    id: 'lightning',
    name: 'Stormcalling',
    tags: ['lightning', 'spell'],
    shapes: ['fork', 'zigzag', 'trident', 'ring2'],
    pool: [R('lightning.damage', 'inc', 3), R('shock.chance', 'flat', 1), R('cast.speed', 'inc', 1, ['lightning'])],
    notables: [
      N('stormcaller', 'Stormcaller', [inc('lightning.damage', 0.3), flat('shock.chance', 0.05)], 'Raise a hand; the sky answers.'),
      N('arc-flash', 'Arc Flash', [inc('lightning.damage', 0.2), inc('cast.speed', 0.06, ['lightning'])], 'Faster than thunder can follow.'),
      N('static-field', 'Static Field', [inc('shock.effect', 0.25), flat('shock.chance', 0.08)], 'The Stormspire pylons hum your name.'),
      N('conductor', 'Conductor', [inc('lightning.damage', 0.25), flat('res.lightning', 0.15)], 'Let it pass through you, and onward.'),
    ],
  }),
  T({
    id: 'spell',
    name: 'Spellweaving',
    tags: ['spell'],
    shapes: ['line', 'hook', 'diamond', 'loop'],
    pool: [R('damage', 'inc', 3, ['spell']), R('cast.speed', 'inc', 1), R('mana', 'flat', 1)],
    notables: [
      N('spellweaver', 'Spellweaver', [inc('damage', 0.3, ['spell'])], 'Every word a thread, every spell a cloth.'),
      N('arcane-flow', 'Arcane Flow', [inc('damage', 0.15, ['spell']), inc('mana.regen', 0.2)], 'The well never runs dry if you never stop drawing.'),
      N('runic-script', 'Runic Script', [inc('damage', 0.2, ['spell']), inc('area', 0.1, ['spell'])], 'Written large, read loud.'),
    ],
  }),
  T({
    id: 'castspeed',
    name: 'Quickening',
    tags: ['castspeed', 'spell'],
    shapes: ['hook', 'zigzag', 'line'],
    pool: [R('cast.speed', 'inc', 3), R('damage', 'inc', 1, ['spell'])],
    notables: [
      N('silver-tongue', 'Silver Tongue', [inc('cast.speed', 0.12)], 'The incantation is finished before it began.'),
      N('fluent', 'Fluent', [inc('cast.speed', 0.08), inc('mana.cost', -0.08)], 'Spoken like a native.'),
      N('cadence', 'Cadence', [inc('cast.speed', 0.06), inc('damage', 0.15, ['spell'])], 'Keep the rhythm and the spells keep coming.'),
    ],
  }),
  T({
    id: 'es',
    name: 'Wardweaving',
    tags: ['es'],
    shapes: ['loop', 'wheel2', 'diamond', 'fork'],
    pool: [R('energy.shield', 'flat', 3), R('energy.shield', 'inc', 3), R('es.recharge', 'inc', 1)],
    notables: [
      N('mindshell', 'Mindshell', [inc('energy.shield', 0.2), flat('energy.shield', 30)], 'Thought, hardened into a wall.'),
      N('quickening-ward', 'Quickening Ward', [inc('es.recharge', 0.3), inc('energy.shield', 0.1)], 'Break it, and watch it mend.'),
      N('crystal-skin', 'Crystal Skin', [inc('energy.shield', 0.25), flat('res.elemental', 0.06)], 'Light bends around you.'),
      N('soulwell', 'Soulwell', [flat('es.onKill', 15), inc('energy.shield', 0.12)], 'Their last breath becomes your ward.'),
    ],
  }),
  T({
    id: 'mana',
    name: 'Wellspring',
    tags: ['mana'],
    shapes: ['loop', 'hook', 'fork', 'line'],
    pool: [R('mana', 'flat', 3), R('mana', 'inc', 2), R('mana.regen', 'inc', 2), R('mana.cost', 'inc', 1, undefined, undefined, true)],
    notables: [
      N('wellspring', 'Wellspring', [inc('mana', 0.15), inc('mana.regen', 0.2)], 'Deep water, cold and clear.'),
      N('frugal-mind', 'Frugal Mind', [inc('mana.cost', -0.15)], 'Spend nothing you need not spend.'),
      N('deep-reserves', 'Deep Reserves', [flat('mana', 40), inc('mana', 0.08)], 'There is always a little more.'),
      N('tide-of-thought', 'Tide of Thought', [inc('mana.regen', 0.4)], 'In, out. In, out.'),
    ],
  }),
  T({
    id: 'elemental',
    name: 'Elementalist',
    tags: ['elemental'],
    shapes: ['trident', 'fork', 'diamond'],
    pool: [R('elemental.damage', 'inc', 3), R('res.elemental', 'flat', 1), R('ignite.chance', 'flat', 0.5), R('freeze.chance', 'flat', 0.5), R('shock.chance', 'flat', 0.5)],
    notables: [
      N('trinity', 'Trinity', [inc('elemental.damage', 0.3)], 'Fire, ice and storm, held in balance.'),
      N('prismatic-mind', 'Prismatic Mind', [inc('elemental.damage', 0.2), flat('res.elemental', 0.08)], 'Every colour, every temper.'),
      N('primal-storm', 'Primal Storm', [inc('elemental.damage', 0.15), flat('ignite.chance', 0.04), flat('freeze.chance', 0.03), flat('shock.chance', 0.04)], 'The weather obeys no one. Except you.'),
    ],
  }),
  T({
    id: 'ignite',
    name: 'Kindler',
    tags: ['ignite', 'fire'],
    shapes: ['fork', 'trident', 'wheel2', 'ring2'],
    pool: [R('ignite.chance', 'flat', 2), R('ignite.damage', 'inc', 3), R('ailment.duration', 'inc', 1, ['ignite'])],
    notables: [
      N('burning-hunger', 'Burning Hunger', [inc('ignite.damage', 0.35)], 'The fire eats. It is never full.'),
      N('kindler', 'Kindler', [flat('ignite.chance', 0.15), inc('ignite.damage', 0.15)], 'A touch is enough.'),
      N('slow-burn', 'Slow Burn', [inc('ailment.duration', 0.25, ['ignite']), inc('ignite.damage', 0.15)], 'Embers remember long after the flame forgets.'),
      N('embers-call', "Ember's Call", [inc('ignite.damage', 0.2), inc('area', 0.1, ['fire'])], 'The braziers of Embers lean toward you.'),
    ],
  }),
  T({
    id: 'aura',
    name: 'Auramancy',
    tags: ['aura'],
    shapes: ['wheel2', 'loop', 'trident', 'diamond'],
    pool: [R('aura.effect', 'inc', 3), R('aura.radius', 'inc', 1), R('mana.reservation', 'inc', 1, undefined, undefined, true)],
    notables: [
      N('sovereignty', 'Sovereignty', [inc('mana.reservation', -0.12)], 'A crown weighs less when you believe in it.'),
      N('radiant-presence', 'Radiant Presence', [inc('aura.effect', 0.15), inc('aura.radius', 0.2)], 'Wherever you stand, the air changes.'),
      N('beacon-of-faith', 'Beacon of Faith', [inc('aura.effect', 0.2)], 'They follow the light. You are the light.'),
      N('choir', 'Choir', [inc('aura.effect', 0.1), flat('res.elemental', 0.06)], 'Many voices, one hymn.'),
    ],
  }),
  T({
    id: 'minion',
    name: 'Gravecalling',
    tags: ['minion'],
    shapes: ['wheel2', 'trident', 'fork', 'ring2'],
    pool: [R('minion.damage', 'inc', 3), R('minion.life', 'inc', 2), R('minion.speed', 'inc', 1)],
    notables: [
      N('gravecaller', 'Gravecaller', [flat('minion.count', 1), inc('minion.life', 0.1)], 'There is always room for one more.'),
      N('bone-legion', 'Bone Legion', [inc('minion.damage', 0.3)], 'Rank on rank of rattling loyalty.'),
      N('death-march', 'Death March', [inc('minion.speed', 0.15), inc('minion.damage', 0.15)], 'Left, right, left. They never tire.'),
      N('sturdy-servants', 'Sturdy Servants', [inc('minion.life', 0.35)], 'Built to last. Already dead once.'),
    ],
  }),
  T({
    id: 'necromancy',
    name: 'Necromancy',
    tags: ['minion', 'chaos'],
    shapes: ['fork', 'diamond', 'trident'],
    pool: [R('minion.damage', 'inc', 2), R('minion.life', 'inc', 2), R('chaos.damage', 'inc', 1)],
    notables: [
      N('plague-bearers', 'Plague Bearers', [inc('minion.damage', 0.2), flat('poison.chance', 0.1, ['minion'])], 'They carry more than swords.'),
      N('soul-tether', 'Soul Tether', [inc('minion.life', 0.2), flat('life.regenPct', 0.006)], 'What hurts them feeds you, a little.'),
      N('corpse-pact', 'Corpse Pact', [inc('minion.damage', 0.15), inc('minion.speed', 0.1)], "A deal signed in someone else's blood."),
    ],
  }),
  T({
    id: 'curse',
    name: 'Hexcraft',
    tags: ['curse'],
    shapes: ['trident', 'wheel2', 'fork', 'ring2'],
    pool: [R('curse.effect', 'inc', 3), R('curse.duration', 'inc', 1), R('area', 'inc', 1, ['curse'])],
    notables: [
      N('hex-weaver', 'Hex Weaver', [flat('curse.count', 1)], 'Why stop at one misfortune?'),
      N('malediction', 'Malediction', [inc('curse.effect', 0.15), inc('curse.duration', 0.2)], 'Spoken once. Felt forever.'),
      N('whispers-of-doom', 'Whispers of Doom', [inc('curse.effect', 0.1), inc('area', 0.2, ['curse'])], 'They hear it in the walls.'),
      N('evil-eye', 'Evil Eye', [inc('curse.effect', 0.2)], 'Look at them. Just look.'),
    ],
  }),
  T({
    id: 'light',
    name: 'Lanternlight',
    tags: ['light'],
    shapes: ['wheel2', 'loop', 'fork', 'trident'],
    pool: [R('light.radius', 'inc', 3), R('damage', 'inc', 1, undefined, 'inLight'), R('life.regen', 'flat', 1, undefined, 'inLight')],
    notables: [
      N('lanternlight', 'Lanternlight', [inc('light.radius', 0.3), inc('damage', 0.1, undefined, 'inLight')], 'Hold it high; the Gloom recoils.'),
      N('dawnbringer', 'Dawnbringer', [inc('damage', 0.25, undefined, 'inLight')], 'Where you walk, it is morning.'),
      N('hearthward', 'Hearthward', [flat('life.regenPct', 0.01, undefined, 'inLight'), flat('res.elemental', 0.06)], 'Warm hands, steady heart.'),
      N('wick-and-oil', 'Wick and Oil', [inc('light.radius', 0.4), inc('mana.regen', 0.15)], 'Trim the wick, mind the flame.'),
    ],
  }),
  T({
    id: 'area',
    name: 'Wide Reach',
    tags: ['area'],
    shapes: ['loop', 'hook', 'diamond'],
    pool: [R('area', 'inc', 3), R('damage', 'inc', 2, ['area'])],
    notables: [
      N('widening-gyre', 'Widening Gyre', [inc('area', 0.2)], 'Turning and turning, ever outward.'),
      N('shockwave', 'Shockwave', [inc('area', 0.1), inc('damage', 0.2, ['area'])], 'Felt three rooms away.'),
      N('ripple-effect', 'Ripple Effect', [inc('damage', 0.3, ['area'])], 'One stone, every shore.'),
    ],
  }),
];
