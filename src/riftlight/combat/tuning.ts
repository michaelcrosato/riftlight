/**
 * Combat numbers shared by the runtime and the tools (pure data: no three.js, no physics, so
 * `npm run combat` and balance sims can import it).
 */

/**
 * Base numbers every actor starts from, as a `base` mod source (so every system reads them
 * the same way, through the sheet). Override per actor with `ActorOptions.base`.
 */
export const ACTOR_BASE: Readonly<Record<string, number>> = {
  life: 100,
  mana: 50,
  es: 0,
  'life.regen': 1,
  'mana.regen': 3,
  'move.speed': 5,
  accuracy: 400,
  'damage.taken': 1,
  mass: 1,
};

/** Seconds a "recently" condition lasts. */
export const RECENTLY = 4;
/** Below this fraction of life the actor is on `lowLife`. */
export const LOW_LIFE = 0.35;
/** Leech returns at most this fraction of max life (or mana) per second. */
export const LEECH_RATE = 0.2;
/** Frames a block staggers the blocker (shortened by `block.recovery`). */
export const BLOCK_STAGGER = 6;
/** Attacks per second a skill's `castTime` is authored for; a weapon's `attack.speed.base` scales attack times from it. */
export const REFERENCE_APS = 1.4;
/** Skill tags that name a weapon class: such skills need `weapon.<class>` (a flag from the equipped weapon). */
export const WEAPON_CLASSES = ['bow', 'wand'] as const;

/** Energy shield starts recharging after this long without being hit, at 33% per second. */
export const ES_DELAY = 2;

/** Damage, arc and knockback bonus of a combo's last hit. */
export const FINISHER = { damage: 1.6, arc: 1.25, knockback: 2.2, shake: 0.25 } as const;
