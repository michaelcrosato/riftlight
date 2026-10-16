# Monster bodies, parts and animation (`monsters/plans/`, `parts/`, `anim/`)

The genome, brains, bosses and adding content: docs/game/monsters.md.

## Body plans (`plans/`)

| plan | skeleton | locomotion |
| --- | --- | --- |
| `biped` | pelvis → spine → chest → neck → head; 2 arms, 2 legs, optional tail | 2-leg walk/run |
| `brute` | biped grammar: hunched, short legs, huge arms, small low head | heavy 2-leg gait |
| `quadruped` | hips (root) → spine, chest; neck chain, tail chain; front knees forward, hind hocks back | lateral walk, trot |
| `hexapod` | thorax, abdomen, head; 3 or 4 pairs of splayed legs (`legPairs`) | tripod / tetrapod |
| `serpent` | front segment (root) + 5–9 tapering segments; 2-joint neck (`posture` = cobra) | slither wave |
| `floater` | the head part *is* the body, at hover height; tentacles, wings, wisp tail | bob, lean, trail |
| `blob` | a squashy mass on a flat base (its sole) | squash-hop |
| `avian` | egg body, long neck, folded wings, fan tail, backward knees | 2-foot hop (or stride) |
| `centipede` | head segment + 4–8 segments, a splayed leg pair on each | wave gait |

A plan is a `BodyPlanDef`: genes (mean, spread), slot chances, mods (serpents evade, brutes
have life), a base scale and `build(ctx)`, which describes the body with `SkeletonBuilder`
(`plans/builder.ts`):

- `joint(name, parent, pos, yaw?)`, `shape(joint, kind, size, at, colour)`, `chain(...)`;
- `leg({ pair, side, parent, hip, splay, upper, lower, ankle, bend, thick, sole })` adds
  Hip (yaw/roll) → Thigh → Shin → Foot plus a `Sole<pair><side>` mesh; `splay` turns the
  leg plane sideways (spiders), `bend` −1 gives a backward knee (birds, hocks);
- `arm(side, parent, at, upper, lower, thick)`, `addWings`, `addTail`, `addTentacles`;
- `head(joint, size, anchors)` places the head socket and the eye, horn, helm and jaw
  sockets from the chosen head part's anchors (a Jaw joint when it has one);
- `stance[joint] = [x, y, z]`: the base pose every clip starts from (lean, neck, folded wings);
- `done({ roles, locomotion, gaits, height, radius, length })`. **Roles** name the joints
  animation templates address: `root`, `spine`, `chest`, `neck`, `head`, `jaw`, `tail`,
  `wings`, `tentacles`, `segments`, `mass`.

Conventions: faces +Z, the monster's right is −X, feet at y = 0, metres at genome scale 1,
joint names ending in R/L are mirror pairs (`Hip0R` ↔ `Hip0L`).

## Parts (`parts/`)

Hand-made parts: heads (snout, lizard, skull, beak, maw, insect, cyclops, horned,
iron visage, wisp orb, floating eye, jelly bell, hooded wraith), jaws, eyes (pair, big,
cluster, stalk, slit), horns/antlers/antennae/spikes, helms and crests, back pieces
(spikes, plates, shells, fins, crystals, armour, ribs, vents, mushrooms, sails), shoulders,
wings (bat, feather, insect, bone), tails (club, stinger, whip, fan, flame, blade), cores
(crystal, ember, void, rune, heart), tentacles, hands (claws, fists, pincers, scythes,
paws), weapons (club, spear, staff, axe, cleaver, orb) and feet (hooves, talons, claws).

Slots: `head`, `jaw`, `eyes`, `horns`, `helm`, `back`, `shoulders`, `wings`, `tail`, `hands`,
`weapon`, `feet`, `core`, `tentacles`, and `mantle` (boss dressing, never rolled). Mirrored
sockets share their slot's part.

**Cosmetic parts** (weight 0, cost 0, no mods, never rolled; stats only come from the
genome's own parts):

- *Plan defaults* (`BodyPlanDef.defaults`): what an empty slot shows, so no body ends in a
  stump: bare clawed hands (`hand.bare`), knuckle fists for brutes (`hand.knuckles`), toes,
  paws, bird feet, chitin leg tips, a plain toothed lower jaw, mouthparts, a gape for blobs
  and floaters, tail feathers.
- *Archetype marks* (`parts/marks.ts`, chosen by `ARCHETYPE_LOOKS` in `looks.ts`) on slots the
  genome left empty, so behaviour reads from shape: the charger's ram brow, the caster's rune
  sigil, the summoner's motes, the bomber's glowing sac, the tank's plates, the sniper's
  quills, the skirmisher's blade fins, the leaper's spine ridge, the totem's runestones.
  `ARCHETYPE_LOOKS[a].genes` also nudges the generated genes (chargers hunch, leapers get long
  legs, tanks go wide, swarms get big heads).
- *Boss mantles* (`parts/dress.ts`, `BOSS_DRESS` in `looks.ts`): a rank-boss body wears its
  leading element on the `mantle` socket (the back's spot, layered over the back part): a
  brazier of coals (fire), dead lanterns (shadow, undead), lightning pylons (storm), glass
  spires (ice, crystal), thornweave (nature), a bog crown (poison, water), echo rings
  (arcane), a rift ring (void), a blood moon (blood), ruin slabs (earth, construct), trophy
  bones (beast, insect). Designed and rift bosses get them alike.

**Faces.** Every head is a face: a skull mass that takes the body pattern, brows over the
eye anchors and a mouth (upper teeth over a dark gape, the jaw part or the plan's plain
jaw biting below). Eyes glow (unlit) in a dark socket under a hard brow, so two bright
pixels and a frown read as a creature at 480×270 and in the dark. Keratin (teeth, claws,
horns, tusks) uses the derived `bone` slot (`paletteColour`, an ivory leaning to the body
hue).

**Skin** (`skin.ts`). Every monster body is drawn with **one** shared toon material
(`skinMaterial`) whose colour comes from vertex attributes, plus one shared unlit
`skinGlowMaterial`: the whole bestiary is two shaders, and a pack spawning or a boss
summoning adds builds nothing. Per vertex: base colour, belly colour, marking colour, rim
colour (`color`, `skinB`, `skinM`, `skinR`), the joint-space position and stripe coordinate
(`skinX`) and the pattern parameters (`skinK`). The TSL draws belly counter-shading (normal
· the plan's belly direction: down for beasts, front-and-down for upright bodies), wavy
stripes or rings, spots (a hashed cell pattern), or thin emissive **veins** in the glow
colour (elemental bosses and rares), plus the rim light and the pixel dissolve. Genes
`pattern`, `patternScale` and `markHue` pick the skin (genomes saved before them get a
default hashed from their body, so pack mates match). Shapes in the `primary` slot take
the pattern; parts opt in with `{ pattern: true }`. `skinRegion` is the same maths in JS:
merged geometry carries `userData.triColors` (engine `presetTriangleColour`) so contact
sheets, portraits and `inspect` show the patterns too.

**Merging.** A joint's shapes and parts are merged into one skin mesh and one glow mesh
(`mergePieces`, indexed), cached per body shape + palette and shared by pack mates (not
`shared`: a level unload disposes them, and the cache forgets them). A monster is about a
draw call per moving joint. Sole meshes keep their names (the foot's parts merge into them).
Small detail spheres use a low-poly sphere (`SMALL_SPHERE`).

A part is `part(id, name, fits, tags, cost, mods, build, { anchors?, anims?, plans? })`.
`build(c)` uses the kit (`parts/kit.ts`): `box`, `ball`, `lump`, `cone`, `cyl`, `taper`,
`horn` (curved, tapered), `slab` (extruded outline), `turned` (lathe), each taking a palette
slot (`primary`, `secondary`, `accent`, `dark`, `glow`) and positions/sizes **in socket
units** (multiplied by the socket's size). Author for the character's **left** (+X); right
sockets are mirrored automatically. `{ glow: true }` makes it unlit (eyes, cores, crystals).
Unit geometry is shared by every part and cached; materials are the engine's cached toon
materials. Socket spaces: heads span x ±0.5, y 0..1, z −0.45..0.55 from the neck joint;
back pieces have +Y out of the body and Z along the spine; tails point −Z from the tip;
hands hang down (−Y) with +Z forward; feet sit on the sole (y = 0 is the floor).
Tags are themes (`fire`, `ice`, `undead`, `insect`, `beast`, `construct`, `void`, `storm`,
`poison`, `nature`, `blood`, `earth`, `shadow`, `crystal`, `arcane`, `water`, or `any`)
and part kinds; mods use the one modifier language (horns `knockback`, wings `move.speed`,
shells `armour`, stingers `chance.poison`...). `anims: ['TailWhip']` lets a melee monster
use its tail.

## Animation (`anim/`)

Every clip is a template over the **semantic poser** (`anim/poser.ts`: `root`, `spine`,
`neck`, `head`, `jaw`, `arm(s)`, `tail`, `wings(raise, spread, fold)`, `tentacles`,
`segments`, `mass(squash)`), so one template animates every body. `bake()` samples the
template (`sampleClip`: keys, eases, layers) on top of the stance, solves every foot with
the **N-leg IK** (`anim/ik.ts`, built on the engine's `twoBoneX`; legs may hang from any
joint, the solver reads that joint's animated transform; splayed legs yaw their plane,
upright legs roll it; feet are levelled to the floor; too-close targets slide outwards
instead of through the floor), then a **floor clamp** lifts the root until no mesh is below
the floor. The result is a plain `ClipDef` (one key per frame) → `compileClip`.

| clips | how |
| --- | --- |
| `Idle` | breathing layers, look-around keys; slither sway, float bob, blob wobble |
| `Walk`, `Run`, `Charge` | `gaitClip` generalised to N legs: a phase per leg (biped 0/½; quadruped lateral walk and trot; tripod, tetrapod, wave gaits are phase tables); stance feet slide back at exactly the clip speed, swing feet arc forward; cadence from leg length (`1.3·√reach` m/s walking, `4·√reach` running, × the gait's `pace`). Hoppers (avian, blob) move both feet together; serpents slither (a lateral wave travelling down the chain at the ground speed); floaters bob and lean. |
| attacks | `Bite`, `Claw` (weapon: overhead chop), `Slam`, `ChargeWindup`, `Spit`, `Cast`, `Summon`, `Leap`, `TailWhip`, `Explode`: anticipation against the strike, a **hit frame**, follow-through |
| `Hit`, `Death`, `Spawn` | flinch; collapse (upright bodies pitch forward, beasts fall on their side, serpents go limp, blobs pop); grow up out of the floor |

`MonsterClipDef.hit` (frame) and `windup` ([start, end] frames) are on the def, in
`clipInfo(name)` (`hitFrame`, `hitTime`) and on `clip.userData` (`hit`, `hitFrame`,
`windup`, `kind`). Combat applies the skill at the hit frame; telegraphs and the wind-up
glow cover the wind-up. Monster clips pass the hero's checks (`analyzeClip`: no floor
penetration, no sliding, clean loop seams): `npm run monster -- check` and the unit tests run
them on every plan and boss.

**Runtime layers** (`runtime.ts`, `MonsterRuntime`): `play(name)` (cross-fades; one-shots hold
their last frame), `locomote(speed)` (Idle/Walk/Run with playback matched to the ground
speed), `update(dt, { lookAt, ground })` returns `hit` / `end` events and applies look-at
(neck and head), hit flinch (`flinch(from)`), optional foot placement on uneven ground
(`ground(x, z)`) and the wind-up glow (`setGlow(t)`). `createTelegraph(spec, damageType)`
builds the ground decals (circle, cone, line) that fill up as the wind-up runs out (combat's
pixel telegraphs, docs/game/wire.md *Telegraphs*).

**Performance**: `buildMonster` builds the rig, merges the meshes and poses one standing frame; pack
mates share the merged meshes and clips. Clips are baked and compiled the first time they're played
and cached per body shape (plan + archetype + genes + parts + anims), so pack mates and respawns
share them; `buildMonster(g, { eager: true })` compiles everything up front (loading screens).

**Floor clamp**: `bake` lifts the root until no mesh is below the floor, measured on a small hull per
joint (`hullPoints`: the shapes' extreme points along 64 directions, from the merged geometry's
`userData.hull`), not on boxes: a box's corners dip below a tilted, rounded limb and lift the body
off its feet.

**Deaths** collapse by body: upright bodies buckle and pitch onto their face, beasts fall on
their side, crawlers (splayed legs) roll onto their back and curl their legs in with a last
twitch, serpents writhe, blobs pop, floaters drop. Legs stay planted (IK) until the body
starts to fall, then go limp from exactly those angles (`releaseLegs`) and fold over the
fall, so no knee flips in a frame. Folded wings lie along the flanks (`WING_FOLD`: the outer
half folds back onto the inner one), and clips unfold them over several frames.
