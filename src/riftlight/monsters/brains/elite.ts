import { Vector3 } from 'three/webgpu';
import { flag, flat, inc, more } from '../../core/mods';
import { Registry } from '../../core/registry';
import type { ActorLike, EliteModDef, HitResult } from '../../core/types';
import type { BrainLike, BrainWorld, MonsterBody } from './types';

/**
 * Elite modifiers: plain `Mod`s (the one modifier language) plus an optional behaviour
 * hook the brain runs. Conditional mods (`when: 'shielded'`, 'lowLife', 'frenzy',
 * 'phased') switch on through `body.setCondition`. Add one by appending an entry here
 * and, if it acts, a behaviour in `ELITE_BEHAVIOURS`.
 */
export interface MonsterEliteDef extends EliteModDef {
  readonly description: string;
  /** Archetypes it never rolls on (a teleporting totem makes no sense). */
  readonly excludes?: readonly string[];
  /** Ranks it may roll on (default magic, rare). */
  readonly ranks?: readonly string[];
}

const E = (e: MonsterEliteDef): MonsterEliteDef => e;

export const ELITE_MODS = new Registry<MonsterEliteDef>('elite mods', [
  E({ id: 'hasted', name: 'Hasted', description: 'Moves and attacks much faster.', tags: ['offensive', 'speed'], mods: [inc('move.speed', 0.4), inc('attack.speed', 0.3), inc('cast.speed', 0.3)], glow: 0xa7f070, cost: 1 }),
  E({ id: 'vampiric', name: 'Vampiric', description: 'Heals from the damage it deals.', tags: ['defensive', 'blood'], mods: [flat('life.leech', 0.12)], behaviour: 'vampiric', glow: 0xb13e53, cost: 1 }),
  E({ id: 'fire-enchanted', name: 'Fire Enchanted', description: 'Adds fire to its hits; bursts into flame on death.', tags: ['offensive', 'fire'], mods: [flat('fire.damage.added', 0.6), flat('res.fire', 0.3)], behaviour: 'deathNova:fire', glow: 0xef7d57, cost: 2 }),
  E({ id: 'frost-aura', name: 'Frost Aura', description: 'Chills everything around it.', tags: ['aura', 'ice'], mods: [flat('res.cold', 0.3)], behaviour: 'aura:chill', glow: 0x73eff7, cost: 2 }),
  E({ id: 'teleporter', name: 'Teleporter', description: 'Blinks next to you when you keep your distance.', tags: ['mobility', 'arcane'], mods: [], behaviour: 'teleport', glow: 0x9b5de5, cost: 2, excludes: ['totem'] }),
  E({ id: 'shielded', name: 'Shielded', description: 'Periodically raises a shield that absorbs most damage.', tags: ['defensive'], mods: [more('damage.taken', -0.75, undefined, 'shielded')], behaviour: 'shield', glow: 0x41a6f6, cost: 2 }),
  E({ id: 'splitter', name: 'Splitter', description: 'Splits into two smaller copies when it dies.', tags: ['summon'], mods: [], behaviour: 'split', glow: 0x38b764, cost: 2, ranks: ['magic', 'rare'] }),
  E({ id: 'frenzied', name: 'Frenzied', description: 'Every nearby ally death drives it into a frenzy.', tags: ['offensive', 'blood'], mods: [inc('attack.speed', 0.5, undefined, 'frenzy'), inc('move.speed', 0.3, undefined, 'frenzy')], behaviour: 'frenzy', glow: 0xb13e53, cost: 1 }),
  E({ id: 'berserker', name: 'Berserker', description: 'Hits much harder below half life.', tags: ['offensive'], mods: [more('damage', 0.6, undefined, 'lowLife'), inc('attack.speed', 0.25, undefined, 'lowLife')], behaviour: 'lowLife', glow: 0xef7d57, cost: 1 }),
  E({ id: 'juggernaut', name: 'Juggernaut', description: 'Unstoppable: immune to knockback and stuns, extra life.', tags: ['defensive'], mods: [more('life', 0.4), flag('knockbackImmune'), flag('stunImmune'), flag('curse.immune'), inc('move.speed', -0.15)], glow: 0x566c86, cost: 2 }),
  E({ id: 'vengeful', name: 'Vengeful', description: 'Retaliates with a shockwave after taking heavy damage.', tags: ['offensive'], mods: [], behaviour: 'vengeful', glow: 0xffcd75, cost: 2 }),
  E({ id: 'arcane-beams', name: 'Arcane Beams', description: 'Rotating beams of arcane energy sweep around it.', tags: ['offensive', 'arcane'], mods: [], behaviour: 'beams', glow: 0x9b5de5, cost: 3 }),
  E({ id: 'molten-trail', name: 'Molten Trail', description: 'Leaves burning ground wherever it walks.', tags: ['offensive', 'fire'], mods: [flat('res.fire', 0.2)], behaviour: 'trail:fire', glow: 0xef7d57, cost: 2, excludes: ['totem'] }),
  E({ id: 'storm-caller', name: 'Storm Caller', description: 'Calls telegraphed lightning strikes on you.', tags: ['offensive', 'storm'], mods: [flat('res.lightning', 0.3)], behaviour: 'strikes:lightning', glow: 0x41a6f6, cost: 2 }),
  E({ id: 'venomous', name: 'Venomous', description: 'Every hit poisons.', tags: ['offensive', 'poison'], mods: [flat('chance.poison', 0.6), flat('res.chaos', 0.4)], glow: 0xa7f070, cost: 1 }),
  E({ id: 'thorned', name: 'Thorned', description: 'Reflects melee damage.', tags: ['defensive'], mods: [flat('thorns', 5), more('thorns', 0.5)], glow: 0x38b764, cost: 1 }),
  E({ id: 'regenerating', name: 'Regenerating', description: 'Rapidly regenerates life out of combat and in.', tags: ['defensive', 'nature'], mods: [flat('life.regen.percent', 0.03)], glow: 0x38b764, cost: 1 }),
  E({ id: 'deathbomb', name: 'Volatile', description: 'Explodes violently a moment after death.', tags: ['offensive', 'fire'], mods: [], behaviour: 'deathNova:physical', glow: 0xffcd75, cost: 1 }),
  E({ id: 'necromancer', name: 'Necromancer', description: 'Raises minions from the ground.', tags: ['summon', 'undead'], mods: [inc('cast.speed', 0.2)], behaviour: 'summon', glow: 0x5d275d, cost: 2 }),
  E({ id: 'mirror-image', name: 'Mirror Image', description: 'Splits off illusions when badly hurt.', tags: ['summon', 'arcane'], mods: [], behaviour: 'clone', glow: 0x73eff7, cost: 2, excludes: ['totem'] }),
  E({ id: 'ghostly', name: 'Ghostly', description: 'Fades in and out of phase; hard to hit while phased.', tags: ['defensive', 'shadow'], mods: [flat('evasion.chance', 0.5, undefined, 'phased'), inc('move.speed', 0.2, undefined, 'phased')], behaviour: 'phase', glow: 0x94b0c2, cost: 1 }),
  E({ id: 'gravity-well', name: 'Gravity Well', description: 'Pulls you towards it every few seconds.', tags: ['control', 'void'], mods: [], behaviour: 'pull', glow: 0x5d275d, cost: 2 }),
  E({ id: 'armoured', name: 'Armoured', description: 'Thick plating: lots of armour.', tags: ['defensive', 'construct'], mods: [flat('armour', 120), more('armour', 0.5)], glow: 0x94b0c2, cost: 1 }),
  E({ id: 'hexproof', name: 'Hexproof', description: 'Shrugs off every curse.', tags: ['defensive', 'arcane'], mods: [flag('curse.immune')], glow: 0xf4f4f4, cost: 1 }),
  E({ id: 'hexer', name: 'Hexer', description: 'Curses you with Enfeeble every few seconds.', tags: ['control', 'shadow'], mods: [], behaviour: 'hex:enfeeble', glow: 0x5d275d, cost: 2 }),
  E({ id: 'empowering', name: 'Empowering', description: 'Its aura makes nearby monsters hit harder.', tags: ['aura', 'support'], mods: [], behaviour: 'aura:empower', glow: 0xffcd75, cost: 2 }),
]);

// ---------------------------------------------------------------- behaviours

/** What a behaviour hook sees of its monster. */
export interface EliteHost extends BrainLike {
  readonly body: MonsterBody;
  readonly target: ActorLike | null;
  /** Life fraction 0..1 (needs the actor's max life; see MonsterBrain). */
  lifeFraction(): number;
  readonly moving: boolean;
}

export interface EliteContext {
  readonly host: EliteHost;
  readonly world: BrainWorld;
  /** Per-monster scratch state for this behaviour. */
  readonly state: Record<string, number>;
  readonly param: string;
}

export interface EliteBehaviour {
  start?(c: EliteContext): void;
  update?(c: EliteContext, dt: number): void;
  onHitTaken?(c: EliteContext, result: HitResult): void;
  onHitDealt?(c: EliteContext, result: HitResult): void;
  onDeath?(c: EliteContext): void;
  onAllyDeath?(c: EliteContext, ally: BrainLike): void;
}

const pos = (c: EliteContext) => c.host.body.actor.position.clone();
const every = (c: EliteContext, dt: number, key: string, seconds: number): boolean => {
  c.state[key] = (c.state[key] ?? seconds * (0.5 + c.world.rng.next() * 0.5)) - dt;
  if (c.state[key]! > 0) return false;
  c.state[key] = seconds;
  return true;
};

/** Behaviour hooks by id; a behaviour id may carry a parameter after ':' ('aura:chill'). */
export const ELITE_BEHAVIOURS: Readonly<Record<string, EliteBehaviour>> = {
  vampiric: {
    onHitDealt: (c, r) => r.total > 0 && c.host.body.emit?.({ type: 'heal', amount: r.total * 0.12 }),
  },
  deathNova: {
    onDeath: (c) => c.host.body.emit?.({ type: 'nova', at: pos(c), radius: 3, damage: c.param || 'fire' }),
  },
  aura: {
    start: (c) => c.host.body.emit?.({ type: 'aura', radius: 4, effect: c.param || 'chill', on: true }),
    onDeath: (c) => c.host.body.emit?.({ type: 'aura', radius: 4, effect: c.param || 'chill', on: false }),
  },
  teleport: {
    update(c, dt) {
      const t = c.host.target;
      if (!t || !every(c, dt, 'cd', 4)) return;
      const me = c.host.body.actor.position;
      if (me.distanceTo(t.position) < 4) return;
      const a = c.world.rng.range(0, Math.PI * 2);
      c.host.body.teleport?.(new Vector3(t.position.x + Math.sin(a) * 2, t.position.y, t.position.z + Math.cos(a) * 2));
    },
  },
  shield: {
    update(c, dt) {
      if (c.state.on) {
        c.state.left = (c.state.left ?? 0) - dt;
        if (c.state.left <= 0) {
          c.state.on = 0;
          c.host.body.setCondition?.('shielded', false);
          c.host.body.emit?.({ type: 'shield', on: false, amount: 0 });
        }
      } else if (c.host.target && every(c, dt, 'cd', 7)) {
        c.state.on = 1;
        c.state.left = 3;
        c.host.body.setCondition?.('shielded', true);
        c.host.body.emit?.({ type: 'shield', on: true, amount: 0.75 });
      }
    },
  },
  split: {
    onDeath: (c) => c.host.body.emit?.({ type: 'split', at: pos(c), count: 2, scale: 0.65 }),
  },
  frenzy: {
    onAllyDeath(c) {
      c.state.left = 6;
      c.host.body.setCondition?.('frenzy', true);
    },
    update(c, dt) {
      if (!c.state.left) return;
      c.state.left -= dt;
      if (c.state.left <= 0) {
        c.state.left = 0;
        c.host.body.setCondition?.('frenzy', false);
      }
    },
  },
  lowLife: {
    update(c) {
      const low = c.host.lifeFraction() < 0.5 ? 1 : 0;
      if (low !== (c.state.low ?? 0)) {
        c.state.low = low;
        c.host.body.setCondition?.('lowLife', !!low);
      }
    },
  },
  vengeful: {
    onHitTaken(c, r) {
      c.state.taken = (c.state.taken ?? 0) + r.total;
      const max = c.host.body.actor.stats.get('life') || 100;
      if (c.state.taken > max * 0.2) {
        c.state.taken = 0;
        c.host.body.emit?.({ type: 'nova', at: pos(c), radius: 3.5, damage: 'physical' });
      }
    },
  },
  beams: {
    start: (c) => c.host.body.emit?.({ type: 'beam', count: 2, length: 6, speed: 0.6, on: true }),
    onDeath: (c) => c.host.body.emit?.({ type: 'beam', count: 2, length: 6, speed: 0.6, on: false }),
  },
  trail: {
    update(c, dt) {
      if (c.host.moving && every(c, dt, 'drop', 0.35)) c.host.body.emit?.({ type: 'trail', at: pos(c), damage: c.param || 'fire', duration: 3 });
    },
  },
  strikes: {
    update(c, dt) {
      const t = c.host.target;
      if (t && every(c, dt, 'cd', 3.5)) c.host.body.emit?.({ type: 'strike', at: t.position.clone(), radius: 1.4, delay: 1.1, damage: c.param || 'lightning' });
    },
  },
  summon: {
    update(c, dt) {
      if (c.host.target && every(c, dt, 'cd', 10)) c.host.body.emit?.({ type: 'summon', at: pos(c), count: 2, archetype: 'swarm', scale: 0.8 });
    },
  },
  clone: {
    onHitTaken(c) {
      if (!c.state.done && c.host.lifeFraction() < 0.5) {
        c.state.done = 1;
        c.host.body.emit?.({ type: 'clone', at: pos(c), count: 2 });
      }
    },
  },
  phase: {
    update(c, dt) {
      if (every(c, dt, 'cd', c.state.on ? 2 : 4)) {
        c.state.on = c.state.on ? 0 : 1;
        c.host.body.setCondition?.('phased', !!c.state.on);
      }
    },
  },
  pull: {
    update(c, dt) {
      if (c.host.target && every(c, dt, 'cd', 6)) c.host.body.emit?.({ type: 'pull', at: pos(c), radius: 7, force: 6 });
    },
  },
  /** 'hex:<curse gem>': curse its target every 8 s while it is within 10 m (heroes with `curse.immune` shrug it off). */
  hex: {
    update(c, dt) {
      const t = c.host.target;
      if (t && every(c, dt, 'cd', 8) && t.position.distanceTo(c.host.body.actor.position) < 10) c.host.body.emit?.({ type: 'hex', at: t.position.clone(), curse: c.param || 'enfeeble' });
    },
  },
};

/** Resolve 'aura:chill' → [behaviour, 'chill']. */
export function eliteBehaviour(id: string | undefined): [EliteBehaviour, string] | null {
  if (!id) return null;
  const [name, param = ''] = id.split(':');
  const b = ELITE_BEHAVIOURS[name!];
  return b ? [b, param] : null;
}
