/**
 * The six regions of the wheel, like Path of Exile's str/dex/int: three pure regions
 * (Might, Grace, Wit) and the hybrids between them. A region is a sector of the tree with
 * theme weights (which clusters it picks) and a small-node pool (what its travel nodes roll).
 *
 * To add a region: add an entry here with an unused angle, then rebalance the angles so the
 * sectors stay even (generate.ts splits the circle by the number of regions).
 */
import { Registry } from '../../core/registry';
import type { RegionDef } from '../types';
import { R } from './stats';

export const REGIONS = new Registry<RegionDef>('region', [
  {
    id: 'might',
    name: 'Might',
    angle: -90,
    color: 'red',
    dim: 'plum',
    flavour: 'Strength, steel and stubbornness.',
    themes: { life: 4, armour: 4, melee: 3, twohand: 3, slam: 3, endurance: 3, physical: 2, regen: 2, leech: 1, totem: 1, bleed: 1, block: 1, resist: 1, area: 1 },
    pool: [R('life', 'flat', 3), R('life', 'inc', 2), R('armour', 'inc', 2), R('armour', 'flat', 1), R('damage', 'inc', 2, ['melee']), R('physical.damage', 'inc', 1), R('stun.duration', 'inc', 0.5), R('life.regen', 'flat', 1)],
  },
  {
    id: 'edge',
    name: 'Edge',
    angle: -30,
    color: 'orange',
    dim: 'red',
    flavour: 'Where might learns to move: duellists and blood-drinkers.',
    themes: { dualwield: 4, attackspeed: 3, bleed: 3, leech: 3, block: 2, onkill: 3, crit: 1, melee: 2, frenzy: 1, movement: 1, armour: 1, evasion: 1, physical: 1 },
    pool: [R('attack.speed', 'inc', 2), R('damage', 'inc', 2, ['attack']), R('block', 'flat', 1), R('armour', 'inc', 1), R('evasion', 'inc', 1), R('life', 'flat', 1), R('life.leech', 'flat', 1), R('crit.chance', 'inc', 1, ['attack']), R('bleed.damage', 'inc', 1)],
  },
  {
    id: 'grace',
    name: 'Grace',
    angle: 30,
    color: 'green',
    dim: 'teal',
    flavour: 'Speed, distance and never being where the blow lands.',
    themes: { bow: 4, projectile: 4, evasion: 4, movement: 3, frenzy: 3, attackspeed: 2, poison: 1, crit: 1, cold: 1 },
    pool: [R('evasion', 'inc', 2), R('evasion', 'flat', 1), R('move.speed', 'inc', 1), R('damage', 'inc', 2, ['projectile']), R('attack.speed', 'inc', 1), R('projectile.speed', 'inc', 1), R('life', 'flat', 1), R('crit.chance', 'inc', 1)],
  },
  {
    id: 'guile',
    name: 'Guile',
    angle: 90,
    color: 'cyan',
    dim: 'teal',
    flavour: 'The knife in the dark, the trap under the leaves.',
    themes: { trap: 4, crit: 3, poison: 3, chaos: 3, dark: 4, onkill: 1, curse: 1, cooldown: 2, projectile: 1, evasion: 1, power: 1 },
    pool: [R('crit.chance', 'inc', 2), R('crit.multi', 'flat', 1), R('chaos.damage', 'inc', 1), R('evasion', 'inc', 1), R('energy.shield', 'flat', 1), R('damage', 'inc', 1, ['trap']), R('poison.damage', 'inc', 1), R('move.speed', 'inc', 1), R('cooldown.recovery', 'inc', 0.5)],
  },
  {
    id: 'wit',
    name: 'Wit',
    angle: 150,
    color: 'sky',
    dim: 'navy',
    flavour: 'Fire, frost and storm, bent by a patient mind.',
    themes: { spell: 3, fire: 3, cold: 4, lightning: 4, es: 4, mana: 4, castspeed: 3, power: 3, elemental: 2, crit: 1, light: 1 },
    pool: [R('damage', 'inc', 2, ['spell']), R('elemental.damage', 'inc', 1), R('cast.speed', 'inc', 1), R('energy.shield', 'flat', 2), R('energy.shield', 'inc', 2), R('mana', 'flat', 1), R('mana.regen', 'inc', 1), R('crit.chance', 'inc', 1, ['spell'])],
  },
  {
    id: 'zeal',
    name: 'Zeal',
    angle: 210,
    color: 'lime',
    dim: 'green',
    flavour: 'Faith made loud: auras, servants, totems and fire.',
    themes: { aura: 4, minion: 4, curse: 3, totem: 3, resist: 3, ignite: 3, light: 3, fire: 1, cooldown: 1, block: 1, elemental: 1, regen: 1 },
    pool: [R('aura.effect', 'inc', 1), R('minion.damage', 'inc', 1), R('minion.life', 'inc', 1), R('res.elemental', 'flat', 2), R('life', 'flat', 1), R('energy.shield', 'inc', 1), R('armour', 'inc', 1), R('fire.damage', 'inc', 1), R('curse.effect', 'inc', 0.5), R('block', 'flat', 0.5)],
  },
]);
