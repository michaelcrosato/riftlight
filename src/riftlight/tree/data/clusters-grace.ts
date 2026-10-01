/**
 * Cluster templates for the Grace / Guile side of the wheel: bows, projectiles, evasion,
 * movement, frenzy and power charges, poison, chaos, critical strikes, traps, cooldowns and
 * fighting in the dark (the Gloom level's mechanic).
 */
import { flat, inc } from '../../core/mods';
import { N, T } from './dsl';
import { R } from './stats';

export const GRACE_CLUSTERS = [
  T({
    id: 'bow',
    name: 'Fletcher',
    tags: ['bow', 'projectile'],
    shapes: ['fork', 'trident', 'zigzag', 'wheel2'],
    pool: [R('damage', 'inc', 3, ['bow']), R('attack.speed', 'inc', 1, ['bow']), R('projectile.speed', 'inc', 1), R('crit.chance', 'inc', 1, ['bow'])],
    notables: [
      N('fletchers-pride', "Fletcher's Pride", [inc('damage', 0.3, ['bow'])], 'Straight shafts, true flights.'),
      N('deadeye', 'Deadeye', [inc('crit.chance', 0.4, ['bow']), flat('crit.multi', 0.15, ['bow'])], 'Breathe out. Release.'),
      N('volley', 'Volley', [flat('projectile.count', 1, ['bow']), inc('damage', -0.1, ['bow'])], 'Why aim, when you can blanket?'),
      N('hunters-patience', "Hunter's Patience", [inc('damage', 0.25, ['bow']), inc('attack.speed', 0.05, ['bow'])], 'The stag will step into the clearing. Wait.'),
    ],
  }),
  T({
    id: 'projectile',
    name: 'Far Shot',
    tags: ['projectile'],
    shapes: ['hook', 'diamond', 'ring2', 'line'],
    pool: [R('damage', 'inc', 3, ['projectile']), R('projectile.speed', 'inc', 2), R('pierce', 'flat', 0.3)],
    notables: [
      N('far-shot', 'Far Shot', [inc('damage', 0.25, ['projectile']), inc('projectile.speed', 0.2)], 'Distance is just another kind of armour.'),
      N('skewer', 'Skewer', [flat('pierce', 2), inc('damage', 0.1, ['projectile'])], 'Line them up.'),
      N('ricochet', 'Ricochet', [flat('projectile.count', 1, ['projectile']), inc('projectile.speed', 0.1)], 'Walls are suggestions.'),
      N('wind-guided', 'Wind-Guided', [inc('projectile.speed', 0.3), inc('damage', 0.15, ['projectile'])], 'The Gale carries your aim.'),
    ],
  }),
  T({
    id: 'evasion',
    name: 'Ghost Step',
    tags: ['evasion'],
    shapes: ['loop', 'wheel2', 'diamond', 'fork'],
    pool: [R('evasion', 'inc', 3), R('evasion', 'flat', 2), R('move.speed', 'inc', 0.5)],
    notables: [
      N('ghost-step', 'Ghost Step', [inc('evasion', 0.35), inc('move.speed', 0.03)], 'Strike where I was. I am elsewhere.'),
      N('blur', 'Blur', [inc('evasion', 0.3), flat('evasion', 40)], 'Hard to hit what you cannot see.'),
      N('catlike', 'Catlike', [inc('evasion', 0.25), inc('dodge.distance', 0.15)], 'Always lands on its feet. Never where you expect.'),
      N('sidestep', 'Sidestep', [inc('evasion', 0.2), inc('dodge.cooldown', -0.15)], 'A half step is enough.'),
    ],
  }),
  T({
    id: 'movement',
    name: 'Swiftfoot',
    tags: ['movement'],
    shapes: ['hook', 'zigzag', 'line', 'fork'],
    pool: [R('move.speed', 'inc', 3), R('dodge.cooldown', 'inc', 1, undefined, undefined, true), R('dodge.distance', 'inc', 1)],
    notables: [
      N('quicksilver', 'Quicksilver', [inc('move.speed', 0.08)], 'Already gone.'),
      N('tumbler', 'Tumbler', [inc('dodge.cooldown', -0.2), inc('dodge.distance', 0.2)], 'Roll, roll, and roll again.'),
      N('wind-at-your-back', 'Wind at Your Back', [inc('move.speed', 0.06), inc('projectile.speed', 0.1)], 'Ride the gusts; they know the way.'),
      N('fleetfoot', 'Fleetfoot', [inc('move.speed', 0.1, undefined, 'notHitRecently')], 'Untouched, unstoppable.'),
    ],
  }),
  T({
    id: 'frenzy',
    name: 'Frenzy',
    tags: ['frenzy', 'attackspeed'],
    shapes: ['trident', 'fork', 'wheel1'],
    pool: [R('charge.onKill', 'flat', 1, ['frenzy']), R('charge.duration', 'inc', 1), R('attack.speed', 'inc', 1)],
    notables: [
      N('frenzied', 'Frenzied', [flat('frenzy.max', 1), inc('charge.duration', 0.15)], 'Faster. Faster. FASTER.'),
      N('hunting-fever', 'Hunting Fever', [flat('charge.onKill', 0.15, ['frenzy']), inc('attack.speed', 0.05)], 'The blood sings when the chase is on.'),
      N('restless', 'Restless', [inc('charge.duration', 0.3), inc('move.speed', 0.04)], 'Sleep is for the slain.'),
    ],
  }),
  T({
    id: 'poison',
    name: 'Venomcraft',
    tags: ['poison', 'chaos'],
    shapes: ['fork', 'trident', 'wheel2', 'ring2'],
    pool: [R('poison.chance', 'flat', 2), R('poison.damage', 'inc', 3), R('chaos.damage', 'inc', 1)],
    notables: [
      N('virulence', 'Virulence', [flat('poison.chance', 0.15), inc('poison.damage', 0.15)], 'One drop is a warning. Two is a sentence.'),
      N('lingering-venom', 'Lingering Venom', [inc('ailment.duration', 0.2, ['poison']), inc('poison.damage', 0.2)], 'It takes its time. It has plenty.'),
      N('toxic-strikes', 'Toxic Strikes', [inc('poison.damage', 0.35)], 'Every edge wet, every point green.'),
      N('nightshade', 'Nightshade', [flat('poison.chance', 0.1), inc('chaos.damage', 0.2)], 'Pretty flowers, ugly ends.'),
    ],
  }),
  T({
    id: 'chaos',
    name: 'Void Touched',
    tags: ['chaos'],
    shapes: ['hook', 'diamond', 'line'],
    pool: [R('chaos.damage', 'inc', 3), R('res.chaos', 'flat', 1), R('ailment.damage', 'inc', 1)],
    notables: [
      N('void-touched', 'Void Touched', [inc('chaos.damage', 0.35)], 'Something looked back from the rift.'),
      N('corrosion', 'Corrosion', [inc('chaos.damage', 0.2), inc('ailment.damage', 0.15)], 'Everything rusts. You just hurry it along.'),
      N('unmaker', 'Unmaker', [inc('chaos.damage', 0.25), flat('res.chaos', 0.12)], 'What the void unmade, the void protects.'),
    ],
  }),
  T({
    id: 'crit-attack',
    name: 'Keen Edge',
    tags: ['crit', 'attackspeed'],
    shapes: ['fork', 'zigzag', 'diamond'],
    pool: [R('crit.chance', 'inc', 3, ['attack']), R('crit.multi', 'flat', 2, ['attack'])],
    notables: [
      N('keen-edge', 'Keen Edge', [inc('crit.chance', 0.4, ['attack'])], 'Sharp enough to split a hair, or a heart.'),
      N('vital-points', 'Vital Points', [flat('crit.multi', 0.3, ['attack'])], 'There are seven places that matter. You know them all.'),
      N('opportunist', 'Opportunist', [inc('crit.chance', 0.25), flat('crit.multi', 0.15)], 'Every opening is an invitation.'),
    ],
  }),
  T({
    id: 'crit-spell',
    name: 'Arcane Precision',
    tags: ['crit', 'spell'],
    shapes: ['fork', 'trident', 'diamond'],
    pool: [R('crit.chance', 'inc', 3, ['spell']), R('crit.multi', 'flat', 2, ['spell'])],
    notables: [
      N('arcane-precision', 'Arcane Precision', [inc('crit.chance', 0.45, ['spell'])], 'The formula is perfect. So is the result.'),
      N('searing-insight', 'Searing Insight', [flat('crit.multi', 0.3, ['spell'])], 'Understanding hurts. Mostly them.'),
      N('sudden-clarity', 'Sudden Clarity', [inc('crit.chance', 0.25, ['spell']), inc('cast.speed', 0.05)], 'The answer arrives all at once.'),
    ],
  }),
  T({
    id: 'trap',
    name: 'Trapper',
    tags: ['trap'],
    shapes: ['trident', 'fork', 'wheel2', 'ring2'],
    pool: [R('damage', 'inc', 3, ['trap']), R('trap.speed', 'inc', 2), R('area', 'inc', 1, ['trap']), R('cooldown.recovery', 'inc', 1, ['trap'])],
    notables: [
      N('clever-construction', 'Clever Construction', [inc('damage', 0.25, ['trap']), inc('area', 0.1, ['trap'])], 'Springs, gears and a great deal of powder.'),
      N('quick-fingers', 'Quick Fingers', [inc('trap.speed', 0.2), inc('cooldown.recovery', 0.1, ['trap'])], 'Set, arm, gone.'),
      N('snare-master', 'Snare Master', [flat('trap.count', 1), inc('damage', 0.1, ['trap'])], 'The whole floor is a promise.'),
      N('hair-trigger', 'Hair Trigger', [inc('trap.speed', 0.15), inc('damage', 0.2, ['trap'])], 'Even the Thornweave vines learned from you.'),
    ],
  }),
  T({
    id: 'dark',
    name: 'Nightstalker',
    tags: ['dark'],
    shapes: ['wheel2', 'fork', 'trident', 'loop'],
    pool: [R('damage', 'inc', 2, undefined, 'inDark'), R('evasion', 'inc', 1, undefined, 'inDark'), R('move.speed', 'inc', 1, undefined, 'inDark'), R('crit.chance', 'inc', 1, undefined, 'inDark')],
    notables: [
      N('nightstalker', 'Nightstalker', [inc('damage', 0.3, undefined, 'inDark')], 'The Gloom taught you to stop fearing the dark.'),
      N('eyes-of-the-owl', 'Eyes of the Owl', [inc('crit.chance', 0.4, undefined, 'inDark'), inc('evasion', 0.1)], 'Wide pupils, sharp talons.'),
      N('shadow-cloak', 'Shadow Cloak', [inc('evasion', 0.4, undefined, 'inDark'), inc('move.speed', 0.05, undefined, 'inDark')], 'Wear the night. It fits.'),
      N('gloomborn', 'Gloomborn', [flat('life.regenPct', 0.01, undefined, 'inDark'), inc('damage', 0.15, undefined, 'inDark')], 'Where the lanterns end, you begin.'),
    ],
  }),
  T({
    id: 'cooldown',
    name: 'Clockwork',
    tags: ['cooldown'],
    shapes: ['hook', 'line', 'diamond'],
    pool: [R('cooldown.recovery', 'inc', 3), R('duration', 'inc', 1)],
    notables: [
      N('clockwork', 'Clockwork', [inc('cooldown.recovery', 0.15)], 'Tick. Tock. Again.'),
      N('borrowed-time', 'Borrowed Time', [inc('cooldown.recovery', 0.1), inc('duration', 0.15)], 'Pay it back later. Much later.'),
      N('patient-hand', 'Patient Hand', [inc('duration', 0.25), inc('damage', 0.1)], 'Let it linger.'),
    ],
  }),
  T({
    id: 'power',
    name: 'Power Siphon',
    tags: ['power'],
    shapes: ['trident', 'fork', 'wheel1'],
    pool: [R('charge.onKill', 'flat', 1, ['power']), R('charge.duration', 'inc', 1), R('crit.chance', 'inc', 1)],
    notables: [
      N('empowered', 'Empowered', [flat('power.max', 1), inc('charge.duration', 0.15)], 'Hold the charge. Hold it.'),
      N('siphon', 'Siphon', [flat('charge.onKill', 0.15, ['power']), inc('crit.chance', 0.2)], 'Their spark, your fire.'),
      N('static-mind', 'Static Mind', [inc('charge.duration', 0.3), inc('damage', 0.1, ['spell'])], 'Thoughts crackle at the edges.'),
    ],
  }),
];
