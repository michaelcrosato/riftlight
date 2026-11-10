/**
 * Keystones: build-defining trade-offs at the edge of each region (four per region). Each
 * is ordinary Mods (so the StatSheet handles them) plus **flags** that the combat system
 * reads with `stats.has(flag)`. Every flag and special stat is listed in KEYSTONE_FLAGS
 * below: that table is the contract with combat/actors.
 */
import { flag, flat, inc, more, override } from '../../core/mods';
import { Registry } from '../../core/registry';
import type { KeystoneDef } from '../types';

/**
 * Flags and special stats keystones set, with what combat should do about them. Read with
 * `sheet.has(name)` (flags) or `sheet.get(name)` (numbers).
 */
export const KEYSTONE_FLAGS: Readonly<Record<string, string>> = {
  'hits.cannotBeEvaded': 'Your hits always land: skip the evasion roll for hits you deal.',
  cannotCrit: 'You never deal critical strikes (crit chance is also overridden to 0).',
  cannotBeStunned: 'Ignore stun from incoming hits.',
  cannotDodge: 'The dodge roll is disabled.',
  'skills.costLife': 'Skill costs are paid from life instead of mana.',
  'evasion.toArmour': 'Add your evasion rating to armour, then treat evasion as 0.',
  'leech.instant': 'Leech is applied instantly instead of over time.',
  rampage: 'Each kill grants a stack for 4 s (max 25): 2% more damage and 1% more movement speed per stack.',
  pointBlank: 'Projectile damage scales from 30% more (point blank) to 30% less (at max range).',
  'dodge.chance': 'Number: chance to dodge (ignore) an incoming hit outright.',
  'crit.affectsAilments': 'Critical strike multiplier also applies to damage over time from ailments.',
  'damage.morePerMechanic': 'Number: more damage per mechanic active in the current level (Riftwalker).',
  'immune.chaos': 'Chaos damage taken is 0.',
  elementalOverload: 'A critical strike grants 40% more elemental damage for 8 s.',
  'crit.noMultiplier': 'Critical strikes deal no extra damage (multiplier is 1).',
  'es.protectsMana': 'Energy shield takes skill costs before mana, and no longer absorbs damage before life.',
  'damage.toMana': 'Number: fraction of damage taken from mana before life.',
  'convert.toFire': 'Number: fraction of physical, cold and lightning damage converted to fire.',
  'nonFireDamage.none': 'After conversion, deal no damage that is not fire.',
  'cannotDealDamage.self': 'Skills you use yourself deal no damage (totems, minions and traps still do).',
  'auras.selfOnly': 'Your auras affect only you.',
};

/**
 * Conditions (`Mod.when`) tree mods use. The owner of the StatSheet sets them with
 * `sheet.setCondition(name, on)` (the actors/combat systems own that).
 */
export const TREE_CONDITIONS: Readonly<Record<string, string>> = {
  inDark: 'outside every light radius (Gloom lanterns, light effects, your own light)',
  inLight: 'inside a light radius other than your own',
  lowLife: 'life at or below 35%',
  recentlyKilled: 'killed an enemy in the last 4 s',
  hitRecently: 'were hit in the last 4 s',
  notHitRecently: 'were not hit in the last 4 s',
};

const K = (k: KeystoneDef): KeystoneDef => k;

export const KEYSTONES = new Registry<KeystoneDef>('keystone', [
  // ------------------------------------------------------------ Might
  K({
    id: 'resolute-technique',
    name: 'Resolute Technique',
    region: 'might',
    tags: ['might', 'attack'],
    mods: [flag('hits.cannotBeEvaded'), flag('cannotCrit'), override('crit.chance', 0)],
    lines: ["Your hits can't be evaded", 'Never deal critical strikes'],
    flavour: 'The sword does not hope. It arrives.',
  }),
  K({
    id: 'unwavering-stance',
    name: 'Unwavering Stance',
    region: 'might',
    tags: ['might', 'defence'],
    mods: [flag('cannotBeStunned'), flag('cannotDodge')],
    lines: ['Cannot be stunned', 'Cannot dodge roll'],
    flavour: 'Plant your feet. Let the world move around you.',
  }),
  K({
    id: 'blood-magic',
    name: 'Blood Magic',
    region: 'might',
    tags: ['might', 'life'],
    mods: [flag('skills.costLife'), override('mana', 0), inc('life', 0.1)],
    lines: ['Skills cost life instead of mana', 'You have no mana', inc('life', 0.1)],
    flavour: 'Pay in the oldest coin there is.',
  }),
  K({
    id: 'colossus',
    name: 'Colossus',
    region: 'might',
    tags: ['might', 'life'],
    mods: [more('life', 0.25), more('move.speed', -0.15), more('attack.speed', -0.05)],
    lines: [more('life', 0.25), more('move.speed', -0.15), more('attack.speed', -0.05)],
    flavour: 'The mountain does not hurry.',
  }),
  // ------------------------------------------------------------ Edge
  K({
    id: 'iron-reflexes',
    name: 'Iron Reflexes',
    region: 'edge',
    tags: ['edge', 'defence'],
    mods: [flag('evasion.toArmour')],
    lines: ['Converts all evasion rating to armour'],
    flavour: 'Why dodge, when you can simply be iron?',
  }),
  K({
    id: 'crimson-pact',
    name: 'Crimson Pact',
    region: 'edge',
    tags: ['edge', 'leech'],
    mods: [flag('leech.instant'), override('life.regen', 0), override('life.regenPct', 0)],
    lines: ['Life leech is instant', 'You have no life regeneration'],
    flavour: 'Drink deep and fast; nothing grows back.',
  }),
  K({
    id: 'glass-cannon',
    name: 'Glass Cannon',
    region: 'edge',
    tags: ['edge', 'damage'],
    mods: [more('damage', 0.3), more('damage.taken', 0.3)],
    lines: [more('damage', 0.3), more('damage.taken', 0.3)],
    flavour: 'Brilliant, brittle, brief.',
  }),
  K({
    id: 'rampage',
    name: 'Rampage',
    region: 'edge',
    tags: ['edge', 'onkill'],
    mods: [flag('rampage'), more('damage', -0.1)],
    lines: [
      { text: 'Kills grant Rampage for {seconds} s, up to {stacks} stacks', values: { seconds: 4, stacks: 25 } },
      { text: 'Each stack: {damage}% more damage, {speed}% more movement speed', values: { damage: 2, speed: 1 } },
      more('damage', -0.1),
    ],
    flavour: 'Slow to start. Impossible to stop.',
  }),
  // ------------------------------------------------------------ Grace
  K({
    id: 'point-blank',
    name: 'Point Blank',
    region: 'grace',
    tags: ['grace', 'projectile'],
    mods: [flag('pointBlank')],
    lines: [
      { text: 'Projectiles deal up to {value}% more damage to close targets', values: { value: 30 } },
      { text: 'Projectiles deal up to {value}% less damage to far targets', values: { value: 30 } },
    ],
    flavour: 'Close enough to see the whites of their eyes.',
  }),
  K({
    id: 'acrobatics',
    name: 'Acrobatics',
    region: 'grace',
    tags: ['grace', 'defence'],
    mods: [flat('dodge.chance', 0.3), more('armour', -0.5), more('energy.shield', -0.5)],
    lines: [{ text: '{value}% chance to dodge hits', values: { value: 30 } }, more('armour', -0.5), more('energy.shield', -0.5)],
    flavour: 'Armour is for people who stand still.',
  }),
  K({
    id: 'arrow-dancing',
    name: 'Arrow Dancing',
    region: 'grace',
    tags: ['grace', 'defence'],
    mods: [more('evasion', 0.4, ['projectile']), more('evasion', -0.5, ['melee'])],
    lines: [
      { text: '{value}% more evasion against projectiles', values: { value: 40 } },
      { text: '{value}% less evasion against melee', values: { value: 50 } },
    ],
    flavour: 'Watch the archer, not the arrow.',
  }),
  K({
    id: 'wind-dancer',
    name: 'Wind Dancer',
    region: 'grace',
    tags: ['grace', 'defence'],
    mods: [more('damage.taken', -0.2, undefined, 'notHitRecently'), more('damage.taken', 0.2, undefined, 'hitRecently')],
    lines: [
      { text: '{value}% less damage taken if not hit recently', values: { value: 20 } },
      { text: '{value}% more damage taken if hit recently', values: { value: 20 } },
    ],
    flavour: 'The first blow is the hardest to land.',
  }),
  // ------------------------------------------------------------ Guile
  K({
    id: 'perfect-agony',
    name: 'Perfect Agony',
    region: 'guile',
    tags: ['guile', 'ailment'],
    mods: [flag('crit.affectsAilments'), more('damage', -0.3, ['hit'])],
    lines: ['Critical strike multiplier applies to ailments', more('damage', -0.3, ['hit'])],
    flavour: 'The wound is a message. The pain is the reply.',
  }),
  K({
    id: 'gloomwalker',
    name: 'Gloomwalker',
    region: 'guile',
    tags: ['guile', 'dark'],
    mods: [more('damage', 0.3, undefined, 'inDark'), more('light.radius', -0.5)],
    lines: [more('damage', 0.3, undefined, 'inDark'), more('light.radius', -0.5)],
    flavour: 'Snuff the lantern. You see better without it.',
  }),
  K({
    id: 'riftwalker',
    name: 'Riftwalker',
    region: 'guile',
    tags: ['guile', 'rift'],
    mods: [flat('damage.morePerMechanic', 0.08), more('life', -0.15)],
    lines: [{ text: '{value}% more damage for each mechanic active in the level', values: { value: 8 } }, more('life', -0.15)],
    flavour: 'Every broken law of the rift is a door.',
  }),
  K({
    id: 'pain-attunement',
    name: 'Pain Attunement',
    region: 'guile',
    tags: ['guile', 'spell'],
    mods: [more('damage', 0.3, ['spell'], 'lowLife'), more('life.recovery', -0.3)],
    lines: [{ text: '{value}% more spell damage while on low life', values: { value: 30 } }, more('life.recovery', -0.3)],
    flavour: 'Pain is a lens. Focus.',
  }),
  // ------------------------------------------------------------ Wit
  K({
    id: 'chaos-inoculation',
    name: 'Chaos Inoculation',
    region: 'wit',
    tags: ['wit', 'es'],
    mods: [override('life', 1), flag('immune.chaos')],
    lines: [{ text: 'Maximum life is {value}', values: { value: 1 } }, 'Immune to chaos damage'],
    flavour: 'Give up the flesh; the void has nothing left to bite.',
  }),
  K({
    id: 'elemental-overload',
    name: 'Elemental Overload',
    region: 'wit',
    tags: ['wit', 'elemental'],
    mods: [flag('elementalOverload'), flag('crit.noMultiplier')],
    lines: [{ text: 'Critical strikes grant {value}% more elemental damage for {seconds} s', values: { value: 40, seconds: 8 } }, 'Your critical strikes deal no extra damage'],
    flavour: 'Not a harder blow. A bigger storm.',
  }),
  K({
    id: 'eldritch-battery',
    name: 'Eldritch Battery',
    region: 'wit',
    tags: ['wit', 'mana'],
    mods: [flag('es.protectsMana')],
    lines: ['Energy shield pays skill costs before mana', 'Energy shield no longer protects life'],
    flavour: 'Store the lightning in the mind, not the skin.',
  }),
  K({
    id: 'mind-over-matter',
    name: 'Mind Over Matter',
    region: 'wit',
    tags: ['wit', 'mana'],
    mods: [flat('damage.toMana', 0.3), more('mana.regen', -0.2)],
    lines: [{ text: '{value}% of damage is taken from mana before life', values: { value: 30 } }, more('mana.regen', -0.2)],
    flavour: 'It only hurts if you let it reach you.',
  }),
  // ------------------------------------------------------------ Zeal
  K({
    id: 'avatar-of-fire',
    name: 'Avatar of Fire',
    region: 'zeal',
    tags: ['zeal', 'fire'],
    mods: [flat('convert.toFire', 0.5), flag('nonFireDamage.none')],
    lines: [{ text: '{value}% of physical, cold and lightning damage is converted to fire', values: { value: 50 } }, 'Deal no non-fire damage'],
    flavour: 'Everything you touch remembers the brazier.',
  }),
  K({
    id: 'ancestral-bond',
    name: 'Ancestral Bond',
    region: 'zeal',
    tags: ['zeal', 'totem'],
    mods: [flat('totem.count', 1), flag('cannotDealDamage.self')],
    lines: [{ text: { one: '+{count} totem you can summon', other: '+{count} totems you can summon' }, values: { count: 1 } }, "You can't deal damage with skills yourself"],
    flavour: 'Let the ancestors fight. You keep the drum.',
  }),
  K({
    id: 'lantern-bearer',
    name: 'Lantern Bearer',
    region: 'zeal',
    tags: ['zeal', 'light'],
    mods: [more('light.radius', 0.5), more('damage', 0.25, undefined, 'inLight'), more('damage.taken', 0.2, undefined, 'inDark')],
    lines: [more('light.radius', 0.5), more('damage', 0.25, undefined, 'inLight'), more('damage.taken', 0.2, undefined, 'inDark')],
    flavour: 'Carry the flame into the Gloom, and never let it go out.',
  }),
  K({
    id: 'supreme-ego',
    name: 'Supreme Ego',
    region: 'zeal',
    tags: ['zeal', 'aura'],
    mods: [more('aura.effect', 0.5), flag('auras.selfOnly')],
    lines: [{ text: '{value}% more effect of auras on you', values: { value: 50 } }, 'Your auras only affect you'],
    flavour: 'The faithful? You are the faith.',
  }),
]);
