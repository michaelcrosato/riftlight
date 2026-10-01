/**
 * Masteries: choice nodes. A cluster shape with a mastery slot ('wheel1', 'wheel2') gets the
 * mastery whose tags best match its template; each mastery appears at most once per region.
 * Allocating it costs a point and the player picks one option (saved as `<nodeId>=<optionId>`).
 */
import { flat, inc } from '../../core/mods';
import { Registry } from '../../core/registry';
import type { MasteryDef } from '../types';

export const MASTERIES = new Registry<MasteryDef>('mastery', [
  {
    id: 'life',
    name: 'Life Mastery',
    tags: ['life', 'regen'],
    options: [
      { id: 'regen', mods: [flat('life.regenPct', 0.01)] },
      { id: 'max', mods: [inc('life', 0.08)] },
      { id: 'recovery', mods: [inc('life.recovery', 0.15)] },
    ],
  },
  {
    id: 'armour',
    name: 'Armour Mastery',
    tags: ['armour', 'endurance'],
    options: [
      { id: 'plate', mods: [inc('armour', 0.3)] },
      { id: 'stun', mods: [inc('stun.threshold', 0.4)] },
      { id: 'taken', mods: [inc('damage.taken', -0.04)] },
    ],
  },
  {
    id: 'evasion',
    name: 'Evasion Mastery',
    tags: ['evasion', 'movement'],
    options: [
      { id: 'evade', mods: [inc('evasion', 0.3)] },
      { id: 'roll', mods: [inc('dodge.recovery', 0.2)] },
      { id: 'speed', mods: [inc('move.speed', 0.05)] },
    ],
  },
  {
    id: 'es',
    name: 'Energy Shield Mastery',
    tags: ['es', 'mana'],
    options: [
      { id: 'recharge', mods: [inc('es.recharge', 0.4)] },
      { id: 'shield', mods: [flat('energy.shield', 40)] },
      { id: 'mana', mods: [inc('mana.regen', 0.3)] },
    ],
  },
  {
    id: 'melee',
    name: 'Melee Mastery',
    tags: ['melee', 'twohand', 'dualwield', 'slam'],
    options: [
      { id: 'damage', mods: [inc('damage', 0.15, ['melee'])] },
      { id: 'reach', mods: [inc('area', 0.12, ['melee'])] },
      { id: 'leech', mods: [flat('life.leech', 0.006, ['melee'])] },
    ],
  },
  {
    id: 'projectile',
    name: 'Projectile Mastery',
    tags: ['projectile', 'bow'],
    options: [
      { id: 'pierce', mods: [flat('pierce', 1)] },
      { id: 'speed', mods: [inc('projectile.speed', 0.25)] },
      { id: 'damage', mods: [inc('damage', 0.15, ['projectile'])] },
    ],
  },
  {
    id: 'elemental',
    name: 'Elemental Mastery',
    tags: ['fire', 'cold', 'lightning', 'elemental', 'spell'],
    options: [
      { id: 'damage', mods: [inc('elemental.damage', 0.15)] },
      { id: 'resist', mods: [flat('res.elemental', 0.1)] },
      { id: 'cast', mods: [inc('cast.speed', 0.06)] },
    ],
  },
  {
    id: 'minion',
    name: 'Minion Mastery',
    tags: ['minion', 'totem'],
    options: [
      { id: 'life', mods: [inc('minion.life', 0.2)] },
      { id: 'damage', mods: [inc('minion.damage', 0.15)] },
      { id: 'speed', mods: [inc('minion.speed', 0.1)] },
    ],
  },
  {
    id: 'aura',
    name: 'Aura Mastery',
    tags: ['aura', 'curse'],
    options: [
      { id: 'aura', mods: [inc('aura.effect', 0.08)] },
      { id: 'curse', mods: [inc('curse.effect', 0.08)] },
      { id: 'reserve', mods: [inc('mana.reservation', -0.08)] },
    ],
  },
  {
    id: 'ailment',
    name: 'Affliction Mastery',
    tags: ['poison', 'bleed', 'ignite', 'chaos'],
    options: [
      { id: 'duration', mods: [inc('ailment.duration', 0.15)] },
      { id: 'damage', mods: [inc('ailment.damage', 0.15)] },
      { id: 'resist', mods: [flat('res.chaos', 0.15)] },
    ],
  },
  {
    id: 'crit',
    name: 'Critical Mastery',
    tags: ['crit', 'power'],
    options: [
      { id: 'multi', mods: [flat('crit.multi', 0.2)] },
      { id: 'chance', mods: [inc('crit.chance', 0.3)] },
      { id: 'charge', mods: [flat('charge.onKill', 0.05, ['power'])] },
    ],
  },
  {
    id: 'charges',
    name: 'Charge Mastery',
    tags: ['endurance', 'frenzy', 'power', 'onkill'],
    options: [
      { id: 'duration', mods: [inc('charge.duration', 0.3)] },
      { id: 'life', mods: [flat('life.onKill', 10)] },
      { id: 'mana', mods: [flat('mana.onKill', 6)] },
    ],
  },
  {
    id: 'mechanist',
    name: 'Mechanist Mastery',
    tags: ['trap', 'cooldown', 'totem'],
    options: [
      { id: 'cooldown', mods: [inc('cooldown.recovery', 0.1)] },
      { id: 'throw', mods: [inc('trap.speed', 0.15)] },
      { id: 'totem', mods: [inc('totem.life', 0.3)] },
    ],
  },
  {
    id: 'shadow',
    name: 'Shadow and Flame Mastery',
    tags: ['dark', 'light'],
    options: [
      { id: 'dark', mods: [inc('damage', 0.15, undefined, 'inDark')] },
      { id: 'lantern', mods: [inc('light.radius', 0.25)] },
      { id: 'warmth', mods: [flat('life.regenPct', 0.008, undefined, 'inLight')] },
    ],
  },
  {
    id: 'guard',
    name: 'Guard Mastery',
    tags: ['block', 'resist'],
    options: [
      { id: 'block', mods: [flat('block', 0.04)] },
      { id: 'resist', mods: [flat('res.elemental', 0.08)] },
      { id: 'recover', mods: [inc('block.recovery', 0.3)] },
    ],
  },
  {
    id: 'tempo',
    name: 'Tempo Mastery',
    tags: ['attackspeed', 'leech', 'castspeed'],
    options: [
      { id: 'attack', mods: [inc('attack.speed', 0.06)] },
      { id: 'rate', mods: [inc('leech.rate', 0.3)] },
      { id: 'cast', mods: [inc('cast.speed', 0.06)] },
    ],
  },
]);
