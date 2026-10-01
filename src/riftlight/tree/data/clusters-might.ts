/**
 * Cluster templates for the Might / Edge side of the wheel: melee, life, armour, block,
 * charges, totems, bleeding, leech. Each template is a theme: the shapes it may take, the
 * pool its small nodes roll from, and its hand-written notables (used once per tree).
 */
import { flat, inc } from '../../core/mods';
import { N, T } from './dsl';
import { R } from './stats';

export const MIGHT_CLUSTERS = [
  T({
    id: 'twohand',
    name: 'Heavy Arms',
    tags: ['twohand', 'melee', 'physical'],
    shapes: ['fork', 'zigzag', 'trident', 'line'],
    pool: [R('damage', 'inc', 3, ['twohand']), R('attack.speed', 'inc', 1, ['twohand']), R('physical.damage', 'inc', 1), R('stun.duration', 'inc', 1), R('crit.multi', 'flat', 0.5, ['twohand'])],
    notables: [
      N('crushing-weight', 'Crushing Weight', [inc('damage', 0.3, ['twohand']), inc('stun.duration', 0.25)], 'Every swing is a verdict.'),
      N('executioners-arc', "Executioner's Arc", [inc('area', 0.15, ['melee']), inc('damage', 0.2, ['twohand'])], 'Wide enough to end a crowd.'),
      N('iron-momentum', 'Iron Momentum', [inc('attack.speed', 0.08, ['twohand']), inc('knockback', 0.4)], "Once it starts swinging, it doesn't stop."),
      N('headsmans-reach', "Headsman's Reach", [inc('crit.chance', 0.3, ['twohand']), flat('crit.multi', 0.25, ['twohand'])], 'One clean blow is all the law requires.'),
    ],
  }),
  T({
    id: 'brawler',
    name: 'Brawler',
    tags: ['melee', 'physical'],
    shapes: ['hook', 'diamond', 'ring2', 'line'],
    pool: [R('damage', 'inc', 3, ['melee']), R('physical.damage', 'inc', 2), R('life', 'flat', 1), R('stun.threshold', 'inc', 1)],
    notables: [
      N('knuckle-and-bone', 'Knuckle and Bone', [inc('physical.damage', 0.25), flat('life', 20)], 'The body is the first weapon.'),
      N('bar-room-legend', 'Bar-Room Legend', [inc('damage', 0.2, ['melee']), inc('attack.speed', 0.05, ['melee']), inc('stun.threshold', 0.2)], 'Seven chairs, one table, no regrets.'),
      N('hammer-and-anvil', 'Hammer and Anvil', [inc('damage', 0.3, ['melee']), inc('armour', 0.15)], 'Strike, and be struck, and strike again.'),
      N('sawdust-and-blood', 'Sawdust and Blood', [inc('physical.damage', 0.2), flat('life.leech', 0.005, ['melee'])], 'The pit fighter drinks from every wound.'),
    ],
  }),
  T({
    id: 'slam',
    name: 'Earthshaker',
    tags: ['slam', 'area', 'melee'],
    shapes: ['trident', 'fork', 'wheel1'],
    pool: [R('damage', 'inc', 3, ['slam']), R('area', 'inc', 2, ['slam']), R('stun.duration', 'inc', 1), R('knockback', 'inc', 1)],
    notables: [
      N('fault-lines', 'Fault Lines', [inc('area', 0.2, ['slam']), inc('damage', 0.2, ['slam'])], 'The ground remembers where you struck it.'),
      N('aftershock', 'Aftershock', [inc('stun.duration', 0.3), inc('damage', 0.25, ['slam'])], 'The second tremor is the one that kills.'),
      N('mountain-breaker', 'Mountain Breaker', [inc('knockback', 0.5), inc('area', 0.15)], 'Stand where you like. You will not stand long.'),
    ],
  }),
  T({
    id: 'life',
    name: 'Vitality',
    tags: ['life'],
    shapes: ['loop', 'wheel2', 'fork', 'diamond'],
    pool: [R('life', 'flat', 3), R('life', 'inc', 2), R('life.regen', 'flat', 1)],
    notables: [
      N('thick-skin', 'Thick Skin', [inc('life', 0.1), flat('life', 15)], 'Scars are just armour you grew yourself.'),
      N('heart-of-oak', 'Heart of Oak', [inc('life', 0.08), flat('life.regenPct', 0.006)], 'Slow to grow, slower to fall.'),
      N('unbroken', 'Unbroken', [inc('life', 0.12), inc('stun.threshold', 0.2)], 'Knocked down nine times. Stood up ten.'),
      N('second-wind', 'Second Wind', [inc('life.recovery', 0.2), flat('life.regenPct', 0.012, undefined, 'lowLife')], 'The last breath is never the last.'),
    ],
  }),
  T({
    id: 'regen',
    name: 'Mending',
    tags: ['regen', 'life'],
    shapes: ['hook', 'loop', 'zigzag'],
    pool: [R('life.regen', 'flat', 2), R('life.regenPct', 'flat', 1), R('life.recovery', 'inc', 1), R('life', 'flat', 1)],
    notables: [
      N('green-blood', 'Green Blood', [flat('life.regenPct', 0.012), inc('life', 0.05)], 'Cuts close before the blade is clean.'),
      N('stitched-together', 'Stitched Together', [flat('life.regen', 8), inc('life.recovery', 0.15)], 'More thread than flesh, and none the worse for it.'),
      N('trollhide', 'Trollhide', [flat('life.regenPct', 0.02, undefined, 'notHitRecently'), flat('life', 20)], 'Leave it alone for a moment and it is whole again.'),
    ],
  }),
  T({
    id: 'armour',
    name: 'Ironclad',
    tags: ['armour'],
    shapes: ['diamond', 'wheel2', 'loop', 'fork'],
    pool: [R('armour', 'inc', 3), R('armour', 'flat', 2), R('stun.threshold', 'inc', 0.5)],
    notables: [
      N('iron-skin', 'Iron Skin', [inc('armour', 0.35), flat('armour', 40)], 'Hit it as often as you like.'),
      N('layered-plate', 'Layered Plate', [inc('armour', 0.25), inc('damage.taken', -0.03)], 'Steel over leather over stubbornness.'),
      N('anvil-heart', 'Anvil Heart', [inc('armour', 0.25), inc('stun.threshold', 0.3), flat('life', 10)], 'Every blow only tempers it.'),
      N('scrapwall', 'Scrapwall', [inc('armour', 0.2), flat('armour', 30), inc('block.recovery', 0.15)], 'Built from the shields of those who came before.'),
    ],
  }),
  T({
    id: 'endurance',
    name: 'Unyielding',
    tags: ['endurance', 'armour'],
    shapes: ['trident', 'zigzag', 'wheel1'],
    pool: [R('charge.duration', 'inc', 1), R('life', 'flat', 1), R('armour', 'inc', 1), R('charge.onKill', 'flat', 1, ['endurance'])],
    notables: [
      N('stone-will', 'Stone Will', [flat('endurance.max', 1), inc('charge.duration', 0.2)], 'Endure, and endure, and endure.'),
      N('war-drummer', 'War Drummer', [flat('charge.onKill', 0.1, ['endurance']), inc('damage', 0.1, ['melee'])], 'Every fallen foe is another beat.'),
      N('grit', 'Grit', [flat('res.elemental', 0.06), inc('armour', 0.15), flat('life', 10)], 'Sand in the teeth, fire in the eyes.'),
    ],
  }),
  T({
    id: 'totem',
    name: 'Ancestors',
    tags: ['totem'],
    shapes: ['fork', 'trident', 'ring2', 'wheel2'],
    pool: [R('damage', 'inc', 2, ['totem']), R('totem.life', 'inc', 2), R('totem.speed', 'inc', 1)],
    notables: [
      N('ancestral-chant', 'Ancestral Chant', [flat('totem.count', 1)], 'One voice calls. Two voices answer.'),
      N('carved-in-stone', 'Carved in Stone', [inc('totem.life', 0.4), inc('damage', 0.15, ['totem'])], 'The ancestors are patient. The stone more so.'),
      N('spirit-house', 'Spirit House', [inc('totem.speed', 0.3), inc('damage', 0.2, ['totem']), inc('area', 0.1, ['totem'])], 'Raise the pole, and the dead move in.'),
      N('watchful-eyes', 'Watchful Eyes', [inc('damage', 0.3, ['totem'])], 'Carved eyes never blink.'),
    ],
  }),
  T({
    id: 'resist',
    name: 'Warded',
    tags: ['resist'],
    shapes: ['loop', 'fork', 'diamond', 'line'],
    pool: [R('res.elemental', 'flat', 3), R('res.fire', 'flat', 1), R('res.cold', 'flat', 1), R('res.lightning', 'flat', 1), R('res.chaos', 'flat', 0.5)],
    notables: [
      N('prism-guard', 'Prism Guard', [flat('res.elemental', 0.15)], 'Light splits on it and goes elsewhere.'),
      N('salamander-hide', "Salamander's Hide", [flat('res.fire', 0.25), flat('life', 15)], 'Born in the brazier, bored by the flame.'),
      N('stormproof', 'Stormproof', [flat('res.lightning', 0.25), flat('res.cold', 0.12)], 'Lightning looks for an easier path.'),
      N('antidote', 'Antidote', [flat('res.chaos', 0.2), flat('life', 10)], 'A sip of every poison, every morning.'),
    ],
  }),
  T({
    id: 'dualwield',
    name: 'Twin Blades',
    tags: ['dualwield', 'melee', 'attackspeed'],
    shapes: ['fork', 'ring2', 'trident', 'wheel2'],
    pool: [R('attack.speed', 'inc', 2, ['dualwield']), R('damage', 'inc', 2, ['dualwield']), R('crit.chance', 'inc', 1, ['dualwield']), R('block', 'flat', 0.5, ['dualwield'])],
    notables: [
      N('left-and-right', 'Left and Right', [inc('attack.speed', 0.1, ['dualwield']), inc('damage', 0.15, ['dualwield'])], 'Two answers to every question.'),
      N('whirling-steel', 'Whirling Steel', [inc('damage', 0.25, ['dualwield']), inc('area', 0.1, ['melee'])], 'A storm with edges.'),
      N('parry-and-riposte', 'Parry and Riposte', [flat('block', 0.05, ['dualwield']), inc('damage', 0.15, ['dualwield'])], 'The off hand guards. The main hand punishes.'),
      N('twin-fangs', 'Twin Fangs', [inc('crit.chance', 0.4, ['dualwield']), flat('crit.multi', 0.15, ['dualwield'])], 'One bite opens, the other finishes.'),
    ],
  }),
  T({
    id: 'attackspeed',
    name: 'Flurry',
    tags: ['attackspeed'],
    shapes: ['hook', 'zigzag', 'line'],
    pool: [R('attack.speed', 'inc', 3), R('damage', 'inc', 1, ['attack']), R('move.speed', 'inc', 0.5)],
    notables: [
      N('quickened-hands', 'Quickened Hands', [inc('attack.speed', 0.12)], 'Faster than the eye, faster than the thought.'),
      N('tempo', 'Tempo', [inc('attack.speed', 0.08), inc('move.speed', 0.04)], 'Fighting is dancing with the music turned up.'),
      N('relentless', 'Relentless', [inc('attack.speed', 0.06), inc('damage', 0.15, ['attack'])], 'Never a pause, never a breath.'),
    ],
  }),
  T({
    id: 'bleed',
    name: 'Bloodletting',
    tags: ['bleed', 'physical'],
    shapes: ['fork', 'trident', 'wheel2', 'diamond'],
    pool: [R('bleed.damage', 'inc', 3), R('bleed.chance', 'flat', 2), R('physical.damage', 'inc', 1), R('ailment.duration', 'inc', 1, ['bleed'])],
    notables: [
      N('open-veins', 'Open Veins', [flat('bleed.chance', 0.15), inc('bleed.damage', 0.15)], 'A small cut, and time does the rest.'),
      N('red-harvest', 'Red Harvest', [inc('bleed.damage', 0.35)], 'Reap what you opened.'),
      N('haemorrhage', 'Haemorrhage', [inc('bleed.damage', 0.2), inc('ailment.duration', 0.15, ['bleed'])], 'It does not stop. It does not clot.'),
      N('butchers-hook', "Butcher's Hook", [flat('bleed.chance', 0.1), flat('life.leech', 0.004, ['physical'])], 'Hang them up and let them drain.'),
    ],
  }),
  T({
    id: 'leech',
    name: 'Bloodthirst',
    tags: ['leech'],
    shapes: ['hook', 'loop', 'zigzag'],
    pool: [R('life.leech', 'flat', 3), R('mana.leech', 'flat', 1), R('leech.rate', 'inc', 1)],
    notables: [
      N('vampiric-kiss', 'Vampiric Kiss', [flat('life.leech', 0.012)], 'A taste, nothing more. Then another.'),
      N('unquenched', 'Unquenched', [inc('leech.rate', 0.3), flat('life.leech', 0.006)], 'The thirst grows with what it drinks.'),
      N('soul-sipper', 'Soul Sipper', [flat('mana.leech', 0.01), flat('life.leech', 0.004)], 'Body and spirit, both on the menu.'),
    ],
  }),
  T({
    id: 'onkill',
    name: "Reaper's Due",
    tags: ['onkill'],
    shapes: ['fork', 'trident', 'ring2'],
    pool: [R('life.onKill', 'flat', 2), R('mana.onKill', 'flat', 1), R('damage', 'inc', 1, undefined, 'recentlyKilled'), R('move.speed', 'inc', 1, undefined, 'recentlyKilled')],
    notables: [
      N('reapers-due', "Reaper's Due", [flat('life.onKill', 12), flat('mana.onKill', 4)], 'Every death pays a toll.'),
      N('bloodrush', 'Bloodrush', [inc('move.speed', 0.1, undefined, 'recentlyKilled'), inc('attack.speed', 0.08, undefined, 'recentlyKilled')], 'One down. Next.'),
      N('carrion-feast', 'Carrion Feast', [inc('damage', 0.3, undefined, 'recentlyKilled')], 'The pack hunts better with a full belly.'),
      N('grim-tally', 'Grim Tally', [flat('charge.onKill', 0.1, ['frenzy']), flat('es.onKill', 10)], 'Count them. Count them all.'),
    ],
  }),
  T({
    id: 'block',
    name: 'Shieldwall',
    tags: ['block'],
    shapes: ['diamond', 'loop', 'wheel2', 'fork'],
    pool: [R('block', 'flat', 2), R('block.recovery', 'inc', 1), R('armour', 'inc', 1)],
    notables: [
      N('shieldwall', 'Shieldwall', [flat('block', 0.06), inc('armour', 0.15)], 'Lock shields. Hold the line.'),
      N('deflection', 'Deflection', [flat('block', 0.04), inc('block.recovery', 0.3)], 'Turn the blow aside; let it hit the floor.'),
      N('counterweight', 'Counterweight', [flat('block', 0.04), flat('life', 20)], 'The heavier the shield, the steadier the arm.'),
      N('aegis-of-dawn', 'Aegis of Dawn', [flat('block', 0.05), flat('res.elemental', 0.06)], 'Sunrise painted on the boss. Fire bounces off it.'),
    ],
  }),
];
