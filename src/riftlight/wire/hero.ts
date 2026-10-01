import { Group, type Object3D, Vector3 } from 'three/webgpu';
import { ContactShadow, type PaletteColor } from '../../engine';
import type { LightHandle } from '../../engine/render/lights';
import { HERO_CLIPS, HERO_MODEL } from '../../game/hero';
import { Actor } from '../actors/Actor';
import { HERO_KEYS } from '../actors/controls';
import { HeroController, type InputLike, type SlotSpec } from '../actors/HeroController';
import { AILMENTS } from '../combat/ailments';
import { CHARGE_TYPES, CHARGES } from '../combat/charges';
import type { Mod, StatSheet } from '../core/mods';
import type { SaveData } from '../core/types';
import type { BuffView, HeroFactory, HeroIntent, HeroPort, ShellServices, SkillSlotView, StageWorld, Vitals } from '../game/ports';
import { socketsToSlots } from '../loot/sockets';
import { SKILLS, SUPPORTS } from '../skills';
import type { ResolvedSkill } from '../skills/types';
import { skillIcon } from './icons';
import { StageMover } from './stage';
import { levelMods, starterWeapon } from './progression';
import { WIRE_TUNING } from './tuning';
import { CombatWorld, type Worlds } from './world';

const T = WIRE_TUNING.hero;

/** Gem ids the loot tables used before the skills registry existed → their skills-registry ids. */
export const GEM_ALIASES: Readonly<Record<string, string>> = {
  'ice-nova': 'frost-nova',
  spark: 'arc',
  'frost-blink': 'blink',
  'flame-dash': 'dash',
  'whirling-blades': 'shield-charge',
  'poison-arrow': 'split-arrow',
  'multiple-projectiles': 'gmp',
};

/** A gem item with its id renamed through GEM_ALIASES (old saves). */
function aliased<T>(g: T): T {
  const item = g as { gem?: { id: string } } | null;
  const id = item?.gem?.id;
  return id && GEM_ALIASES[id] ? ({ ...item, gem: { ...item.gem, id: GEM_ALIASES[id] } } as T) : g;
}

function alias(skills: SaveData['hero']['skills'] | undefined): SaveData['hero']['skills'] {
  return (skills ?? []).map((s) => (s && typeof s === 'object' ? { ...s, gem: aliased(s.gem), supports: (s.supports ?? []).map(aliased) } : s));
}

/** True when nothing is socketed (a save from before sockets): the bar uses the default gems. */
export function usesDefaultGems(skills: SaveData['hero']['skills'] | undefined): boolean {
  return !socketsToSlots(alias(skills)).some(Boolean);
}

/**
 * The skill bar from a save's sockets (`socketsToSlots`: each slot's gem, its linked supports
 * and gear's `skill.level` from the hero's sheet), unknown gems skipped. A save with nothing
 * socketed (from before sockets) gets the default gems (`WIRE_TUNING.defaultSkills`), which
 * level with the hero; an empty slot in a socketed bar stays empty.
 */
export function slotsFromSave(save: SaveData['hero'], level: number, sheet: StatSheet | null = null): (SlotSpec | null)[] {
  const out: (SlotSpec | null)[] = socketsToSlots(alias(save.skills), sheet)
    .slice(0, 4)
    .map((x) => (x && SKILLS.has(x.skill) ? { skill: x.skill, level: x.level, supports: x.supports.filter((g) => SUPPORTS.has(g.gem)) } : null));
  while (out.length < 4) out.push(null);
  if (out.some(Boolean)) return out;
  const gemLevel = Math.max(1, Math.min(20, 1 + Math.floor((level - 1) * T.gemLevelPerLevel)));
  return WIRE_TUNING.defaultSkills.slice(0, 4).map((skill) => ({ skill, level: gemLevel }));
}

export { levelMods, starterWeapon } from './progression';

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/**
 * The shell's `HeroIntent` as the controller's input: one input path (keys, mouse, pads and
 * touch are read once, by the shell's controls). Moves are already world directions, so the
 * "camera" basis is the world's; the aim point is the shell's.
 */
class IntentInput implements InputLike {
  intent: HeroIntent | null = null;
  readonly gamepadConnected = false;
  readonly mouseDelta = { x: 0, y: 0 };
  private dodgeUsed = false;
  private skillUsed = false;

  set(intent: HeroIntent): void {
    this.intent = intent;
    this.dodgeUsed = this.skillUsed = false;
  }

  moveAxis(): { x: number; y: number } {
    const m = this.intent?.move;
    return m ? { x: m.x, y: m.z } : { x: 0, y: 0 };
  }

  consumeAny(codes: readonly string[]): boolean {
    const i = this.intent;
    if (!i) return false;
    if (codes === HERO_KEYS.dodge) {
      if (!i.dodge || this.dodgeUsed) return false;
      return (this.dodgeUsed = true);
    }
    const slot = HERO_KEYS.slots.indexOf(codes as never);
    if (slot >= 0) {
      if (i.skill !== slot || this.skillUsed) return false;
      return (this.skillUsed = true);
    }
    return false; // the basic attack is held, not pressed (anyDown)
  }

  anyDown(codes: readonly string[]): boolean {
    const i = this.intent;
    if (!i) return false;
    if (codes === HERO_KEYS.attack) return i.attack;
    const slot = HERO_KEYS.slots.indexOf(codes as never);
    if (slot >= 0) return i.skill === slot || ((i.held ?? 0) & (1 << slot)) !== 0;
    return false;
  }

  aimAt(out: Vector3): boolean {
    if (!this.intent) return false;
    out.copy(this.intent.aim);
    return true;
  }
}

const AILMENT_COLOR: Partial<Record<string, PaletteColor>> = { bleed: 'red', poison: 'lime', ignite: 'orange', chill: 'sky', freeze: 'cyan', shock: 'sand', stun: 'white' };

/**
 * The real hero behind the HeroPort: R1's `HeroController` (combo, skills, dodge, i-frames,
 * hit-stop, attack-speed-scaled clips, the sword) on an `Actor`, moved by a `StageMover`
 * over whatever stage it is in, fighting in that stage's `CombatWorld`.
 */
export class RealHero implements HeroPort {
  readonly hc: HeroController;
  readonly actor: Actor;
  readonly object = new Group();
  /** Combat plays hit sounds and particles itself (the shell skips its stub juice). */
  readonly juice = true;
  private readonly mover: StageMover;
  private readonly input = new IntentInput();
  private readonly ctrl: Parameters<HeroController['fixedUpdate']>[0];
  private readonly shadow = new ContactShadow(0.42);
  private world: CombatWorld | null = null;
  /** The town's world, owned by the hero (levels own theirs). */
  private owned: CombatWorld | null = null;
  private stage: StageWorld | null = null;
  private light: LightHandle | null = null;
  private readonly sources = new Map<string, readonly Mod[]>();
  private level = 1;
  /** The save's sockets the bar was built from. */
  private sockets: SaveData['hero']['skills'] = [];
  private skillLevels = 0;
  private readonly buffSeen = new Map<string, number>();

  constructor(
    private readonly services: ShellServices,
    private readonly worlds: Worlds,
    model: Object3D,
    save: SaveData['hero'],
  ) {
    const ctx = services.ctx;
    // A placeholder world until the first stage: the controller needs a combat runtime.
    const boot = new CombatWorld({ services, root: this.object, depth: 0 });
    this.mover = new StageMover(null, [0, 0, 0], 0.35, () => this.actor.impulse.lengthSq() > 16);
    this.hc = new HeroController({ combat: boot.combat, mover: this.mover, model, clips: HERO_CLIPS, at: [0, 0, 0], base: T.base, slots: [null, null, null, null] });
    this.actor = this.hc.actor;
    this.owned = boot;
    this.world = boot;
    boot.addHero(this.actor);
    this.object.name = 'Hero';
    this.object.add(model, this.shadow);
    this.ctrl = { input: this.input, camera: { camera: ctx.engine.camera.camera, groundBasis: () => ({ right: X, forward: Z }) } };
    this.stats(save);
    this.setSkills(save.skills);
  }

  private stats(save: SaveData['hero']): void {
    this.level = save.level;
    this.actor.level = save.level;
    this.actor.stats.set('level', levelMods(save.level));
    this.refreshStarter();
    this.restore();
  }

  get busy(): number {
    const s = this.hc.state;
    return s === 'attack' || s === 'cast' || s === 'channel' || s === 'dodge' ? 0.2 : 0;
  }

  vitals(): Vitals {
    const a = this.actor;
    return { life: a.life, maxLife: a.maxLife, mana: a.mana, maxMana: a.maxMana, es: a.es, maxEs: a.maxEs, reserved: a.reservesLife ? 0 : a.maxMana - a.unreservedMana };
  }

  skills(): readonly SkillSlotView[] {
    const hc = this.hc;
    const a = this.actor;
    const view = (slot: SkillSlotView['slot'], s: ResolvedSkill | null): SkillSlotView => {
      if (!s) return { slot, id: null, name: '', cost: 0, cooldown: 0, remaining: 0, usable: false };
      const cost = s.channel ? s.cost * 0.25 : s.cost;
      const pool = a.stats.has('skills.costLife') ? a.life - 1 : a.mana + (a.stats.has('es.protectsMana') ? a.es : 0);
      // an aura reserves instead of costing: usable while on (to turn it off) or when its reservation fits
      const aura = s.delivery.kind === 'aura' && s.reservation > 0;
      const usable = aura ? hc.auraOn(s.id) || a.canReserve(s.id, s.reservation) : pool >= cost;
      return { slot, id: s.id, name: s.def.name, ...skillIcon(s), cost: Math.round(s.cost), cooldown: s.cooldown, remaining: hc.cooldowns.get(s.id) ?? 0, usable, tags: s.tags };
    };
    const out = [0, 1, 2, 3].map((i) => view(i, hc.slots[i] ?? null));
    out.push(view('attack', hc.basic));
    const dodge = view('dodge', hc.dodgeSkill);
    out.push(a.stats.has('cannotDodge') ? { ...dodge, usable: false } : dodge);
    return out;
  }

  buffs(): readonly BuffView[] {
    const a = this.actor;
    const out: BuffView[] = [];
    const seen = new Set<string>();
    const add = (id: string, name: string, remaining: number, color: PaletteColor, debuff = false, stacks?: number) => {
      const key = `${id}`;
      seen.add(key);
      const duration = Math.max(remaining, this.buffSeen.get(key) ?? remaining);
      this.buffSeen.set(key, duration);
      out.push({ id, name, remaining, duration: Math.max(0.01, duration), color, debuff, stacks });
    };
    for (const [key, until] of a.buffs) {
      const left = until === Infinity ? 1 : Math.max(0, until - a.time);
      const name = SKILLS.has(key) ? SKILLS.get(key).name : key.replace(/^aura:/, '').replace(/[-:]/g, ' ');
      add(`buff:${key}`, name, left, key === 'rampage' ? 'red' : 'sand', false, key === 'rampage' ? a.rampage : undefined);
    }
    for (const b of (this.stage as { timedBuffs?: (actor: Actor) => { source: string; remaining: number }[] } | null)?.timedBuffs?.(a) ?? []) {
      const shrine = b.source.startsWith('shrine:');
      add(b.source, b.source.split(':').pop()!.replace(/-/g, ' '), b.remaining, shrine ? 'cyan' : 'lime');
    }
    // charges: one icon per kind held, the count as stacks
    for (const t of CHARGE_TYPES) {
      const n = a.charges.count[t];
      if (n > 0) add(`charge:${t}`, `${CHARGES[t].name} charges`, a.charges.left[t], CHARGES[t].color, false, n);
    }
    // curses on the hero (monster hexes)
    for (const c of a.curses.list) add(`curse:${c.id}`, c.name, Math.max(0, c.until - a.time), c.color, true);
    const ailments = new Map<string, { left: number; n: number }>();
    for (const x of a.ailments) {
      const cur = ailments.get(x.id);
      ailments.set(x.id, { left: Math.max(cur?.left ?? 0, x.remaining), n: (cur?.n ?? 0) + 1 });
    }
    for (const [id, x] of ailments) add(`ailment:${id}`, AILMENTS.get(id as never).name, x.left, AILMENT_COLOR[id] ?? 'plum', true, x.n);
    for (const k of [...this.buffSeen.keys()]) if (!seen.has(k)) this.buffSeen.delete(k);
    return out;
  }

  enter(stage: StageWorld, at: Vector3, facing: number): void {
    const prev = this.world;
    let world = this.worlds.get(stage);
    if (prev && prev !== world) {
      prev.removeHero();
      if (prev === this.owned) {
        // the town's world (or the boot one) goes with the hero
        prev.dispose();
        this.worlds.forget(prev);
        this.owned = null;
      }
    }
    if (!world) {
      // a stage without its own world (the town): the hero brings one
      world = new CombatWorld({ services: this.services, root: stage.root, depth: 0 });
      this.worlds.set(stage, world);
      this.owned = world;
    }
    this.world = world;
    this.stage = stage;
    world.addHero(this.actor);
    this.hc.attach(world.combat);
    stage.root.add(this.object);
    this.mover.stage = stage;
    this.hc.teleport([at.x, stage.groundY(at.x, at.z), at.z]);
    this.actor.facing = facing;
    this.actor.impulse.set(0, 0, 0);
    // Riftwalker: more damage per mechanic in the level
    const per = this.actor.stats.get('damage.morePerMechanic');
    const mechanics = stage.kind === 'level' ? ((stage as { spec?: { mechanics: readonly string[] } }).spec?.mechanics.length ?? 0) : 0;
    if (per > 0 && mechanics > 0) this.actor.stats.set('keystone:riftwalker', [{ stat: 'damage', kind: 'more', value: per * mechanics }]);
    else this.actor.stats.remove('keystone:riftwalker');
    this.ensureLight(stage.kind === 'town');
  }

  private ensureLight(town: boolean): void {
    const L = T.light;
    const radius = L.radius * Math.max(0.2, this.actor.stats.get('light.radius') || 1);
    if (!this.light || !this.light.alive) this.light = this.services.ctx.lights.request({ follow: this.hc.model, offset: [0, 1.7, 0], color: L.color, intensity: town ? L.town : L.intensity, radius, priority: 8, flicker: 'candle', name: 'hero' });
    else this.light.update({ intensity: town ? L.town : L.intensity, radius });
  }

  fixedUpdate(dt: number, intent: HeroIntent): void {
    const a = this.actor;
    if (this.services.dev().god) {
      a.iframes = Math.max(a.iframes, 0.1);
      a.life = Math.max(a.life, a.maxLife * 0.5);
    }
    this.input.set(intent);
    this.hc.fixedUpdate(this.ctrl, dt);
    // conditions the tree promises (moving, lowLife, recentlyKilled... are the Actor's)
    a.stats.setCondition('inLight', this.stage?.kind === 'level' && !a.stats.hasCondition('inDark'));
    if (this.owned && this.world === this.owned) this.world.fixedUpdate(dt);
  }

  update(dt: number): void {
    if (this.owned && this.world === this.owned) this.world.update(dt, this.services.ctx.physics.alpha);
    this.hc.update(dt);
    const p = this.hc.model.position;
    this.shadow.place(p.x, this.stage?.groundY(p.x, p.z) ?? 0, p.z, Math.max(0, p.y - (this.stage?.groundY(p.x, p.z) ?? 0)));
    if (this.light) {
      const r = T.light.radius * Math.max(0.2, this.actor.stats.get('light.radius') || 1);
      if (Math.abs(this.light.radius - r) > 1e-3) this.light.update({ radius: r });
    }
  }

  setLevel(level: number): void {
    this.level = level;
    this.actor.level = level;
    this.rescaled(() => this.actor.stats.set('level', levelMods(level)));
    if (usesDefaultGems(this.sockets)) this.setSkills(this.sockets); // the default gems grow with the hero
  }

  /** The skill bar from the save's sockets (the shell calls it after a load, a new run and `changed('skills')`). */
  setSkills(skills: SaveData['hero']['skills']): void {
    this.sockets = skills;
    slotsFromSave({ skills } as SaveData['hero'], this.level, this.actor.stats).forEach((spec, i) => {
      const s = this.hc.slots[i];
      const same = !!s && !!spec && s.id === spec.skill && s.level === (spec.level ?? 1) && JSON.stringify(s.supports) === JSON.stringify(spec.supports ?? []);
      if (!same && (s || spec)) this.hc.setSlot(i, spec);
    });
  }

  setMods(source: string, mods: readonly Mod[]): void {
    this.rescaled(() => {
      if (mods.length) this.actor.stats.set(source, mods);
      else this.actor.stats.remove(source);
    });
    if (mods.length) this.sources.set(source, mods);
    else this.sources.delete(source);
    if (source !== 'starter') this.refreshStarter();
    // gear's "+1 to the level of fire skill gems" re-levels the bar
    const levels = this.actor.stats.get('skill.level');
    if (levels !== this.skillLevels || mods.some((m) => m.stat === 'skill.level')) {
      this.skillLevels = levels;
      this.setSkills(this.sockets);
    }
  }

  /** The starter sword stays until some gear source brings weapon damage. */
  private refreshStarter(): void {
    let armed = false;
    for (const mods of this.sources.values()) if (mods.some((m) => m.stat.startsWith('weapon.') && m.stat.endsWith('.max'))) armed = true;
    if (armed) this.actor.stats.remove('starter');
    else if (!this.actor.stats.hasSource('starter')) this.actor.stats.set('starter', starterWeapon());
  }

  /** Change the sheet keeping life, mana and shield fractions. */
  private rescaled(change: () => void): void {
    const a = this.actor;
    const prev = { life: a.maxLife, mana: a.maxMana, es: a.maxEs };
    change();
    if (prev.life > 0) a.life = Math.min(a.maxLife, (a.life / prev.life) * a.maxLife);
    if (prev.mana > 0) a.mana = Math.min(a.maxMana, (a.mana / prev.mana) * a.maxMana);
    if (prev.es > 0) a.es = Math.min(a.maxEs, (a.es / prev.es) * a.maxEs);
    else a.es = Math.min(a.es, a.maxEs);
  }

  restore(): void {
    const a = this.actor;
    if (!a.alive || a.deadFor >= 0) this.hc.revive();
    for (const key of [...a.buffs.keys()]) a.removeBuff(key);
    a.ailments.length = 0;
    a.charges.clear();
    a.curses.clear();
    a.hitStop = 0;
    a.iframes = 0;
    a.impulse.set(0, 0, 0);
    a.life = a.maxLife;
    a.mana = a.maxMana;
    a.es = a.maxEs;
    this.hc.cooldowns.clear();
  }

  emote(name: string): void {
    if (name === 'victory' || name === 'wave') this.hc.celebrate();
    // 'death' plays by itself (the controller's dead state), 'hurt' is the hit react
  }

  dispose(): void {
    this.light?.release();
    this.light = null;
    this.world?.removeHero();
    this.owned?.dispose();
    this.hc.dispose();
    this.object.removeFromParent();
  }
}

/** The HeroFactory over the shared stage worlds. */
export function realHeroFactory(worlds: Worlds): HeroFactory {
  return {
    async create(services: ShellServices, save: SaveData['hero']): Promise<HeroPort> {
      const hero = await services.ctx.loadModel(HERO_MODEL, { castShadow: true });
      return new RealHero(services, worlds, hero.scene, save);
    },
  };
}
