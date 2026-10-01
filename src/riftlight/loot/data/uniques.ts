/**
 * Uniques: fixed, build-defining mods on a known base, with flavour text. Many of them
 * bend a level mechanic (docs/GAME.md, "The 12 designed levels"): the level systems read
 * the same stats (`brazier.selfIgnite`, `well.immune`, ...) from the hero's StatSheet.
 *
 * `level` is the minimum item level to drop and the level requirement. `weight` is
 * relative rarity among the uniques that can drop (default 1; chase uniques lower).
 */
import { flag, flat, inc, more } from '../../core/mods';
import type { UniqueDef } from '../../core/types';

export const UNIQUES: readonly UniqueDef[] = [
  {
    id: 'emberheart', name: 'Emberheart', base: 'full-plate', level: 34, tags: ['fire', 'mechanic'],
    mods: [flag('brazier.selfIgnite'), more('damage', 0.1, undefined, 'ignited'), inc('brazier.damage', 0.6), flat('life', 60), flat('res.fire', 0.3)],
    flavour: 'The braziers of Embers never go out. Neither does he.',
  },
  {
    id: 'gloomwalker', name: 'Gloomwalker', base: 'stalker-boots', level: 28, tags: ['mechanic', 'speed'],
    mods: [inc('light.radius', -0.3), inc('damage', 0.4, undefined, 'inDark'), inc('move.speed', 0.25, undefined, 'inDark'), flat('evasion', 80)],
    flavour: 'Lanterns are for those who fear what they cannot see.',
  },
  {
    id: 'galecaller', name: 'Galecaller', base: 'galebow', level: 38, tags: ['mechanic', 'projectile'],
    mods: [flat('projectiles', 1, undefined, 'inWind'), inc('projectile.speed', 0.4), inc('wind.resist', -0.5), inc('local.physical', 0.8), inc('local.attack.speed', 0.1)],
    flavour: 'Loose with the gust, and the gust will carry it home.',
  },
  {
    id: 'frostglass-edge', name: 'Frostglass Edge', base: 'arming-sword', level: 16, tags: ['mechanic', 'cold'],
    mods: [flat('shatter.chance', 1), flat('local.added.cold.min', 6), flat('local.added.cold.max', 14), inc('move.speed', 0.2, undefined, 'onIce'), flat('freeze.chance', 0.1)],
    flavour: 'Cut once. The cold does the rest.',
  },
  {
    id: 'thornmothers-embrace', name: "Thornmother's Embrace", base: 'shadow-coat', level: 30, tags: ['mechanic', 'physical'],
    mods: [flag('thorns.immune'), flat('thorns.reflect', 0.5), inc('local.evasion', 1.2), flat('life', 50)],
    flavour: 'The vines know their mother. They part for her children.',
  },
  {
    id: 'stormspire-conductor', name: 'Stormspire Conductor', base: 'stormspire-staff', level: 52, tags: ['mechanic', 'lightning'],
    mods: [flat('pylon.chain', 3), inc('lightning.damage', 0.6), flat('skill.level', 1, ['lightning']), flat('shock.chance', 0.2), inc('cast.speed', 0.12)],
    flavour: 'Every spire on the hill hums when it passes.',
  },
  {
    id: 'mirestride', name: 'Mirestride', base: 'warden-boots', level: 30, tags: ['mechanic', 'speed'],
    mods: [flag('mire.immune'), inc('haste.duration', 1), inc('move.speed', 0.15), inc('local.armour', 0.9)],
    flavour: 'The bog swallowed a hundred men. It spat this one out.',
  },
  {
    id: 'second-voice', name: 'The Second Voice', base: 'lapis-amulet', level: 40, tags: ['mechanic'],
    mods: [flag('echo.repeatsSkills'), more('echo.damage', 0.3), inc('echo.delay', -0.25), flat('mana', 40)],
    flavour: 'Say it once. Hear it twice. Mean it both times.',
  },
  {
    id: 'gatewardens-key', name: "Gatewarden's Key", base: 'gold-ring', level: 36, tags: ['mechanic'],
    mods: [inc('gate.damage', 0.5), inc('cooldown.recovery', 0.15), inc('move.speed', 0.1, undefined, 'recentlyGated'), flat('res.chaos', 0.15)],
    flavour: 'It opens every door, and none of them lead home.',
  },
  {
    id: 'bloodmoon-chalice', name: 'Bloodmoon Chalice', base: 'bone-wand', level: 44, tags: ['mechanic', 'fire'],
    mods: [inc('explosion.damage', 0.8), flat('life.onKill', 20), inc('damage', 0.3, ['spell']), inc('area', 0.15)],
    flavour: 'Drink deep when the moon is red. Then run.',
  },
  {
    id: 'gravewell-anchor', name: 'Gravewell Anchor', base: 'heavy-belt', level: 46, tags: ['mechanic'],
    mods: [flag('well.immune'), inc('armour', 0.3), flat('life', 50), inc('knockback', -0.5)],
    flavour: 'Some things refuse to fall. This is one of them.',
  },
  {
    id: 'collapse-runner', name: 'Collapse Runner', base: 'rawhide-boots', level: 24, tags: ['mechanic', 'speed'],
    mods: [inc('move.speed', 0.3), inc('collapse.bonusLoot', 0.5), flag('collapse.fallImmune'), flat('life', -20)],
    flavour: 'Never look back. There is nothing back there anymore.',
  },
  {
    id: 'lantern-of-the-lost', name: 'Lantern of the Lost', base: 'lens-focus', level: 30, tags: ['mechanic', 'light'],
    mods: [inc('light.radius', 0.5), inc('lantern.duration', 1), flat('mana', 60), inc('local.energy.shield', 0.8)],
    flavour: 'Lit by the last traveller who needed it. Pass it on.',
  },
  {
    id: 'riftlight-crown', name: 'Riftlight Crown', base: 'riftseer-crown', level: 60, weight: 0.3, tags: ['skill'],
    mods: [flat('skill.level', 1), inc('local.energy.shield', 1.5), inc('light.radius', 0.25), flat('mana', 50)],
    flavour: 'The rift remembers every king it ever crowned.',
  },
  {
    id: 'ashen-fang', name: 'Ashen Fang', base: 'kris', level: 18, tags: ['fire', 'ailment'],
    mods: [flat('ignite.chance', 0.25), inc('fire.damage', 0.4), flat('local.added.fire.min', 8), flat('local.added.fire.max', 16), inc('local.attack.speed', 0.1)],
    flavour: 'Forged in Embers, quenched in blood.',
  },
  {
    id: 'widowmaker', name: 'Widowmaker', base: 'executioner-axe', level: 35, tags: ['crit', 'physical'],
    mods: [flat('crit.multi', 0.5), flat('life.leech', 0.012), inc('local.physical', 1.4), inc('local.crit.chance', 0.4)],
    flavour: 'It has never needed a second swing.',
  },
  {
    id: 'starfall', name: 'Starfall', base: 'crystal-sceptre', level: 26, tags: ['spell', 'elemental'],
    mods: [inc('cast.speed', 0.15), inc('fire.damage', 0.3), inc('cold.damage', 0.3), inc('lightning.damage', 0.3), flat('projectiles', 1, ['spell'])],
    flavour: 'Wish on it. It will answer, loudly.',
  },
  {
    id: 'iron-saint', name: 'The Iron Saint', base: 'tower-shield', level: 34, tags: ['defence', 'block'],
    mods: [flag('block.spells'), flat('local.block', 0.06), flat('res.fire', 0.15), flat('res.cold', 0.15), flat('res.lightning', 0.15), inc('move.speed', -0.05)],
    flavour: 'Saints are made of faith. This one was made of iron.',
  },
  {
    id: 'quickfletch', name: 'Quickfletch', base: 'hide-quiver', level: 12, tags: ['projectile', 'speed'],
    mods: [inc('attack.speed', 0.15, ['projectile']), flat('projectiles', 1, ['attack']), inc('damage', -0.15, ['projectile'])],
    flavour: 'Two arrows in the air before the first one lands.',
  },
  {
    id: 'bonechime', name: 'Bonechime', base: 'bone-wand', level: 20, tags: ['minion'],
    mods: [flat('skill.level', 2, ['minion']), inc('damage', 0.4, ['minion']), inc('minion.life', 0.3), flat('mana', 30)],
    flavour: 'They hear it, wherever they were buried.',
  },
  {
    id: 'heartseeker', name: 'Heartseeker', base: 'iron-ring', level: 22, tags: ['crit', 'life'],
    mods: [flat('life.leech', 0.008), inc('crit.chance', 0.3), flat('crit.multi', 0.2), flat('life', 20)],
    flavour: 'It always knows where the heart is.',
  },
  {
    id: 'goldtooth', name: 'Goldtooth', base: 'gold-ring', level: 20, tags: ['find'],
    mods: [inc('gold.find', 0.6), inc('item.rarity', 0.2), flat('life', -15), flat('res.chaos', -0.1)],
    flavour: 'Bit a coin to test it. Kept the coin. Kept the tooth.',
  },
  {
    id: 'weeping-moon', name: 'The Weeping Moon', base: 'war-hammer', level: 32, tags: ['area', 'physical'],
    mods: [inc('knockback', 0.5), inc('area', 0.25), more('damage', 0.2, undefined, 'lowLife'), inc('local.physical', 1.2)],
    flavour: 'It falls slowly, and then all at once.',
  },
  {
    id: 'mantle-of-storms', name: 'Mantle of Many Storms', base: 'starweave-vestment', level: 36, tags: ['lightning', 'spell'],
    mods: [flat('res.lightning', 0.4), flat('added.lightning.min', 4, ['spell']), flat('added.lightning.max', 40, ['spell']), flat('shock.chance', 0.15), inc('local.energy.shield', 1)],
    flavour: 'Woven on Stormspire, between strikes.',
  },
  {
    id: 'kingsbane', name: 'Kingsbane Gauntlets', base: 'ember-gauntlets', level: 30, tags: ['attack', 'physical'],
    mods: [inc('attack.speed', 0.1), flat('added.physical.min', 6, ['attack']), flat('added.physical.max', 12, ['attack']), flat('life.onKill', 15), inc('local.armour', 0.8)],
    flavour: 'Three crowns rolled under these knuckles.',
  },
  {
    id: 'hollow-halo', name: 'Hollow Halo', base: 'hunter-hood', level: 28, tags: ['mana'],
    mods: [inc('mana.cost', -0.3), inc('life', -0.1), inc('mana.regen', 0.6), inc('local.evasion', 1)],
    flavour: 'There is nothing inside. That is the point.',
  },
  {
    id: 'cinderwake', name: 'Cinderwake', base: 'riftwalker-slippers', level: 32, tags: ['fire', 'speed', 'mechanic'],
    mods: [inc('move.speed', 0.2), flat('ignite.chance', 0.15), inc('brazier.area', 0.4), flat('res.fire', 0.25)],
    flavour: 'Every step a spark. Every spark a brazier waiting.',
  },
  {
    id: 'pact-of-the-abyss', name: 'Pact of the Abyss', base: 'coral-amulet', level: 42, weight: 0.5, tags: ['chaos'],
    mods: [inc('chaos.damage', 0.5), flat('res.chaos', 0.3), flat('skill.level', 1, ['chaos']), flat('life.regen', -10)],
    flavour: 'Sign here. And here. And here, in red.',
  },
  {
    id: 'featherfall-sash', name: 'Featherfall Sash', base: 'leather-belt', level: 14, tags: ['mechanic'],
    mods: [flag('collapse.fallImmune'), inc('dodge.recovery', 0.3), flat('life', 30), inc('wind.resist', 0.3)],
    flavour: 'The floor gave way. She did not.',
  },
  {
    id: 'twinfang', name: 'Twinfang', base: 'riftsteel-blade', level: 50, weight: 0.5, tags: ['attack', 'mechanic'],
    mods: [more('echo.damage', 0.5), inc('local.attack.speed', 0.2), inc('local.physical', 1.1), flat('life.leech', 0.006)],
    flavour: 'One blade for you. One for the echo.',
  },
  {
    id: 'dawnbreaker', name: 'Dawnbreaker', base: 'kite-shield', level: 10, tags: ['light', 'defence'],
    mods: [inc('light.radius', 0.4), flat('res.fire', 0.2), flat('res.cold', 0.2), flat('life', 30), inc('damage', 0.2, undefined, 'inDark')],
    flavour: 'Raise it, and the Gloom remembers morning.',
  },
  {
    id: 'pilgrims-staff', name: "Pilgrim's Staff", base: 'gnarled-staff', level: 3, tags: ['starter'],
    mods: [inc('move.speed', 0.1), flat('mana', 25), flat('life', 25), inc('damage', 0.25, ['spell'])],
    flavour: 'It has walked further than any of its owners.',
  },
];
