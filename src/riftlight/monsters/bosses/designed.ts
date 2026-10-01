import { inc, more } from '../../core/mods';
import { Rng } from '../../core/rng';
import { generateGenome, type GenomeOptions } from '../genome';
import type { BossDef, BossPhase } from './types';

/**
 * The twelve designed bosses, one per level, each built around its level's mechanic
 * (docs/GAME.md): hand-picked plan, parts and genes, a three-phase script, a signature
 * attack and an enrage. Later levels mix in earlier mechanics, like the levels do.
 */
const ENRAGE = { after: 150, mods: [more('damage', 0.5), inc('attack.speed', 0.3), inc('move.speed', 0.2)] };

function boss(
  id: string,
  level: number,
  name: string,
  mechanics: string[],
  genome: GenomeOptions & { plan: string; archetype: string; tags: string[] },
  phases: [BossPhase['attacks'], BossPhase['attacks'], BossPhase['attacks']],
  extra: { signature: string; hazards: string[]; flavour: string; cadence?: number; onEnter?: [string[], string[]] },
): BossDef {
  const c = extra.cadence ?? 6;
  const g = generateGenome(new Rng(`boss:${id}`), { depth: level, rank: 'boss', ...genome });
  return {
    id,
    name,
    level,
    mechanics,
    tags: ['boss', ...mechanics, ...genome.tags],
    weight: 0,
    genome: g,
    phases: [
      { from: 1, name: 'Awakened', attacks: phases[0], cadence: c },
      { from: 0.66, name: 'Wrath', attacks: phases[1], cadence: c * 0.85, onEnter: extra.onEnter?.[0] ?? [], mods: [inc('attack.speed', 0.1)] },
      { from: 0.33, name: 'Desperation', attacks: phases[2], cadence: c * 0.7, onEnter: extra.onEnter?.[1] ?? [], mods: [more('damage', 0.2), inc('move.speed', 0.15)] },
    ],
    signature: extra.signature,
    enrage: { ...ENRAGE, after: ENRAGE.after + level * 5 },
    arena: { radius: 11 + Math.floor(level / 3), hazards: extra.hazards },
    flavour: extra.flavour,
  };
}

export const DESIGNED_BOSSES: readonly BossDef[] = [
  boss('vorgath', 1, 'Vorgath, the Emberhide', ['embers'],
    { plan: 'brute', archetype: 'charger', tags: ['fire'], genes: { girth: 0.8, armLength: 0.75, posture: 0.7 }, parts: { head: 'head.horned', eyes: 'eye.pair', jaw: 'jaw.tusks', back: 'back.vents', shoulders: 'spikes.shoulder', hands: 'hand.fist', helm: 'crest.flame', core: 'core.ember', weapon: null, tail: null, horns: null, feet: 'foot.hooves' } },
    [['quake-slam', 'brazier-slam'], ['quake-slam', 'brazier-slam', 'ember-spiral'], ['ember-spiral', 'arena-charge', 'brazier-slam']],
    { signature: 'brazier-slam', hazards: ['braziers'], flavour: 'A forge-beast that never cooled. Lure it onto the braziers.', onEnter: [['brazier-slam'], ['call-brood']] }),
  boss('nyx-hollow', 2, 'Nyx-Hollow, the Lantern Eater', ['gloom'],
    { plan: 'floater', archetype: 'caster', tags: ['shadow'], genes: { headSize: 0.85, tentacles: 0.9 }, parts: { head: 'head.eyeball', tentacles: 'tentacle.spiked', horns: 'horn.demon', helm: 'helm.crown', core: 'core.void', wings: 'wing.bat', jaw: null, eyes: null, back: null, tail: null } },
    [['snuff-lights', 'void-spiral'], ['snuff-lights', 'void-spiral', 'shade-call'], ['snuff-lights', 'pounce', 'void-spiral']],
    { signature: 'snuff-lights', hazards: ['lanterns'], flavour: 'It eats the light first. Keep a lantern lit and it bleeds.', onEnter: [['shade-call'], ['snuff-lights']] }),
  boss('skraal', 3, 'Skraal, the Gale Mother', ['gale'],
    { plan: 'avian', archetype: 'leaper', tags: ['storm'], genes: { wingSpan: 0.95, legLength: 0.75, hop: 0.2, neck: 0.7 }, parts: { head: 'head.beak', eyes: 'eye.big', wings: 'wing.feather', helm: 'crest.feather', tail: 'tail.fan', feet: 'foot.talons', horns: null, back: null, core: null } },
    [['gust', 'pounce'], ['gust', 'pounce', 'cyclone'], ['cyclone', 'gust', 'arena-charge']],
    { signature: 'gust', hazards: ['windLanes', 'pits'], flavour: 'Her wingbeat is the wind in the lanes. Stay out of the gust line near the pits.', cadence: 5.5, onEnter: [['call-brood'], ['cyclone']] }),
  boss('kryssa', 4, 'Kryssa, the Glass Matriarch', ['frostglass'],
    { plan: 'hexapod', archetype: 'caster', tags: ['ice', 'crystal'], genes: { legPairs: 0.95, abdomen: 0.8, legLength: 0.7 }, parts: { head: 'head.insect', eyes: 'eye.cluster', jaw: 'jaw.mandibles', back: 'crystals.back', core: 'core.crystal', tail: 'tail.stinger', horns: 'horn.spike', wings: null } },
    [['frost-spiral', 'glaze-floor'], ['frost-spiral', 'glaze-floor', 'call-brood'], ['quake-slam', 'frost-spiral', 'glaze-floor']],
    { signature: 'glaze-floor', hazards: ['iceFloor'], flavour: 'Her brood freezes on the glaze: shatter them against her.', onEnter: [['call-brood'], ['glaze-floor']] }),
  boss('bramblemaw', 5, 'Bramblemaw, the Root Mother', ['thornweave'],
    { plan: 'serpent', archetype: 'charger', tags: ['nature'], genes: { girth: 0.85, segments: 0.9, posture: 0.85, headSize: 0.8 }, parts: { head: 'head.maw', jaw: 'jaw.fangs', eyes: 'eye.big', back: 'back.mushrooms', shoulders: 'spikes.shoulder', tail: 'tail.club', horns: 'horn.antlers', core: null, wings: null, helm: null } },
    [['vine-eruption', 'root-pull'], ['vine-eruption', 'root-pull', 'arena-charge'], ['vine-eruption', 'arena-charge', 'call-brood']],
    { signature: 'vine-eruption', hazards: ['thornVines'], flavour: 'Her thorns cut her own brood. Kite them through the vines.', onEnter: [['vine-eruption'], ['call-brood']] }),
  boss('volthorn', 6, 'Volthorn, the Pylon King', ['stormspire'],
    { plan: 'quadruped', archetype: 'charger', tags: ['storm'], genes: { girth: 0.75, legLength: 0.7, posture: 0.7, neck: 0.6 }, parts: { head: 'head.snout', horns: 'horn.antlers', back: 'crystals.back', feet: 'foot.hooves', tail: 'tail.whip', core: 'core.rune', jaw: 'jaw.tusks', eyes: 'eye.pair', shoulders: null, wings: null } },
    [['pylon-surge', 'arena-charge'], ['pylon-surge', 'arena-charge', 'storm-strikes'], ['storm-strikes', 'arena-charge', 'pylon-surge']],
    { signature: 'pylon-surge', hazards: ['pylons'], flavour: 'Every pylon it passes charges. Make it charge through its own arcs.', onEnter: [['pylon-surge'], ['storm-strikes']] }),
  boss('gulgoth', 7, 'Gulgoth, the Bog Sovereign', ['mire', 'gale'],
    { plan: 'blob', archetype: 'summoner', tags: ['poison', 'nature'], genes: { girth: 0.95, length: 0.8 }, parts: { eyes: 'eye.stalk', jaw: 'jaw.fangs', back: 'back.mushrooms', helm: 'helm.crown', core: 'core.heart', horns: 'horn.spike' } },
    [['mud-wave', 'bog-spawn'], ['mud-wave', 'bog-spawn', 'gust'], ['mud-wave', 'gust', 'pounce']],
    { signature: 'mud-wave', hazards: ['mud', 'hastePads', 'windLanes'], flavour: 'It is the mire. Chain the haste pads; never fight it in the mud.', onEnter: [['bog-spawn'], ['bog-spawn']] }),
  boss('aurelion', 8, 'Aurelion, the Twice-Struck', ['echoes'],
    { plan: 'biped', archetype: 'caster', tags: ['arcane'], genes: { legLength: 0.75, length: 0.7, headSize: 0.55 }, parts: { head: 'head.wraith', eyes: 'eye.pair', helm: 'helm.halo', weapon: 'weapon.staff', shoulders: 'crystals.shoulder', back: 'crystals.back', core: 'core.rune', wings: 'wing.feather', hands: null, horns: null, jaw: null, tail: null, feet: null } },
    [['echo-slam', 'mirror-beam'], ['echo-slam', 'mirror-beam', 'void-spiral'], ['echo-slam', 'mirror-beam', 'quake-slam']],
    { signature: 'echo-slam', hazards: ['echoes'], flavour: 'Every blow lands twice. So do yours.', onEnter: [['mirror-beam'], ['call-brood']] }),
  boss('xal-vey', 9, "Xal'Vey, the Gate Warden", ['riftgates', 'stormspire'],
    { plan: 'centipede', archetype: 'charger', tags: ['void'], genes: { segments: 1, legLength: 0.7, girth: 0.8 }, parts: { head: 'head.insect', jaw: 'jaw.mandibles', eyes: 'eye.cluster', back: 'shell.beetle', tail: 'tail.stinger', horns: 'horn.antennae', core: 'core.void' } },
    [['gate-charge', 'void-spiral'], ['gate-charge', 'void-spiral', 'pylon-surge'], ['gate-charge', 'pylon-surge', 'call-brood']],
    { signature: 'gate-charge', hazards: ['portals', 'pylons'], flavour: 'It runs the gates. Knock it through one mid-charge.', onEnter: [['call-brood'], ['pylon-surge']] }),
  boss('sanguine', 10, 'Sanguar, the Bloodmoon Herald', ['bloodmoon', 'embers'],
    { plan: 'quadruped', archetype: 'leaper', tags: ['blood', 'fire'], genes: { girth: 0.7, legLength: 0.6, length: 0.8 }, parts: { head: 'head.horned', jaw: 'jaw.fangs', back: 'back.bones', tail: 'tail.blade', feet: 'foot.claws', core: 'core.heart', shoulders: 'bone.shoulder', eyes: 'eye.big', horns: null, wings: null } },
    [['blood-nova', 'pounce'], ['blood-nova', 'pounce', 'bog-spawn'], ['blood-nova', 'brazier-slam', 'ember-spiral']],
    { signature: 'blood-nova', hazards: ['braziers', 'corpses'], flavour: 'Every corpse is a bomb under the red moon. Including its brood.', onEnter: [['bog-spawn'], ['brazier-slam']] }),
  boss('vexithas', 11, 'Vexithas, the Hollow Star', ['gravewell', 'frostglass'],
    { plan: 'floater', archetype: 'caster', tags: ['void', 'ice'], genes: { headSize: 0.9, tentacles: 1, hover: 0.8 }, parts: { head: 'head.orb', eyes: 'eye.cluster', tentacles: 'tentacle.glow', helm: 'helm.halo', horns: 'horn.demon', core: 'core.void', back: 'crystals.back', jaw: null, wings: null, tail: null } },
    [['gravity-well', 'void-spiral'], ['gravity-well', 'void-spiral', 'glaze-floor'], ['gravity-well', 'frost-spiral', 'glaze-floor']],
    { signature: 'gravity-well', hazards: ['wells', 'iceFloor'], flavour: 'It pulls everything in. Group its adds in the well and burst them.', onEnter: [['glaze-floor'], ['call-brood']] }),
  boss('korrak', 12, 'Korrak, the Ruin Titan', ['collapse', 'gloom'],
    { plan: 'brute', archetype: 'tank', tags: ['earth', 'construct'], genes: { girth: 1, armLength: 0.8, legLength: 0.6, posture: 0.6 }, parts: { head: 'head.cyclops', eyes: 'eye.big', jaw: 'jaw.tusks', back: 'armour.back', shoulders: 'armour.pauldron', hands: 'hand.fist', helm: 'helm.iron', core: 'core.ember', weapon: null, tail: null, horns: null, feet: null } },
    [['cave-in', 'quake-slam'], ['cave-in', 'meteor-fall', 'snuff-lights'], ['cave-in', 'arena-charge', 'meteor-fall']],
    { signature: 'cave-in', hazards: ['crumblingFloor', 'darkness'], flavour: 'The floor goes where it walks. Keep moving; never stand where it stood.', cadence: 5, onEnter: [['snuff-lights'], ['cave-in']] }),
];
