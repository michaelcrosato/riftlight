/**
 * STUB HeroPort (replaced by combat/actors' Actor + HeroController at integration).
 * The hero model with a sword: WASD movement with acceleration, a two-hit slash combo,
 * four simple skills (cleave, fire nova, dash, war cry), a dodge roll with i-frames,
 * life/mana regen. Every number goes through the StatSheet, so tree / gear / difficulty
 * mods already work.
 */
import { BoxGeometry, Group, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { compileClip, ContactShadow, PALETTE, toonMaterial } from '../../../engine';
import { restPoseOf } from '../../../engine/animation';
import { HERO_CLIPS, HERO_MODEL, HERO_RIG } from '../../../game/hero';
import { flat as flatMod, inc, type Mod } from '../../core/mods';
import type { SaveData } from '../../core/types';
import { ClipPlayer } from '../clipPlayer';
import type { BuffView, HeroFactory, HeroIntent, HeroPort, ShellServices, SkillSlotView, StageWorld, Vitals } from '../ports';
import { StubActor, strike } from './actor';
import { STUB_HERO_CLIPS } from './heroClips';

interface SkillDef {
  id: string;
  name: string;
  cost: number;
  cooldown: number;
  icon: readonly string[];
  colors: Record<string, keyof typeof PALETTE>;
}

const SKILLS: readonly SkillDef[] = [
  { id: 'cleave', name: 'Cleave', cost: 6, cooldown: 1.2, icon: ['....ww..', '...wwm..', '..wwm...', '.wwm....', 'om......', '.o......'], colors: { w: 'white', m: 'mist', o: 'orange' } },
  { id: 'nova', name: 'Fire Nova', cost: 12, cooldown: 4, icon: ['..o..o..', '.o.rr.o.', '..rssr..', 'orsyysro', '..rssr..', '.o.rr.o.'], colors: { o: 'orange', r: 'red', s: 'sand', y: 'white' } },
  { id: 'dash', name: 'Dash', cost: 8, cooldown: 3, icon: ['........', 'cc..ww..', '.cc..ww.', '..cc..ww', '.cc..ww.', 'cc..ww..'], colors: { c: 'cyan', w: 'white' } },
  { id: 'warcry', name: 'War Cry', cost: 10, cooldown: 14, icon: ['..rrrr..', '.r....r.', 'r.ssss.r', 'r.s..s.r', '.r.ss.r.', '..rrrr..'], colors: { r: 'red', s: 'sand' } },
];

const ATTACK_ICON = ['......w.', '.....wm.', '....wm..', '.o.wm...', '..om....', '.o.o....'];
const DODGE_ICON = ['..ss....', '.s..s...', 's....s..', '......s.', '.ss.ss.s', '...s....'];

type Action = { kind: 'attack' | 'skill' | 'dodge'; id: string; t: number; duration: number; hitAt: number; hit: boolean; dir: Vector3 };

export class StubHero implements HeroPort {
  readonly actor: StubActor;
  readonly object = new Group();
  private model!: Object3D;
  private player!: ClipPlayer;
  private readonly shadow = new ContactShadow(0.42);
  private stage: StageWorld | null = null;
  private readonly vel = new Vector3();
  private yaw = 0;
  private action: Action | null = null;
  private combo = 0;
  private readonly cooldowns = new Map<string, number>();
  private readonly buffList = new Map<string, { remaining: number; duration: number }>();
  private dodgeCd = 0;
  private dead = false;
  private readonly tmp = new Vector3();

  constructor(private readonly services: ShellServices) {
    this.actor = new StubActor('hero', 'Hero', 0.4, {
      life: 70,
      mana: 40,
      es: 0,
      damage: 9,
      'move.speed': 5.2,
      'attack.speed': 1,
      'cast.speed': 1,
      'crit.chance': 5,
      'life.regen': 1,
      'mana.regen': 5,
      armour: 10,
    });
    this.object.name = 'StubHero';
  }

  async init(): Promise<void> {
    const hero = await this.services.ctx.loadModel(HERO_MODEL, { castShadow: true });
    this.model = hero.scene;
    const rest = restPoseOf(this.model, HERO_RIG);
    const wanted = new Set(['Idle', 'Walk', 'Run', 'Wave', 'Victory', 'Hurt', 'LieDown']);
    const clips = [...HERO_CLIPS.filter((c) => wanted.has(c.name)), ...STUB_HERO_CLIPS].map((d) => compileClip(d, HERO_RIG, rest));
    this.player = new ClipPlayer(this.model, clips);
    // A sword in the right glove: the blade runs along the hand's -Y.
    const hand = this.model.getObjectByName('HandR');
    if (hand) {
      const sword = new Group();
      sword.name = 'Sword';
      const part = (size: [number, number, number], c: keyof typeof PALETTE, y: number) => {
        const m = new Mesh(new BoxGeometry(...size), toonMaterial(PALETTE[c]));
        m.position.set(0, y, 0.03);
        m.castShadow = true;
        sword.add(m);
      };
      part([0.07, 0.16, 0.07], 'plum', -0.08);
      part([0.26, 0.05, 0.08], 'sand', -0.17);
      part([0.08, 0.72, 0.03], 'white', -0.55);
      part([0.04, 0.6, 0.035], 'mist', -0.52);
      hand.add(sword);
    }
    this.object.add(this.model, this.shadow);
    this.player.play('Idle');
  }

  get busy(): number {
    return this.action ? Math.max(0, this.action.duration - this.action.t) : 0;
  }

  vitals(): Vitals {
    const a = this.actor;
    return { life: a.life, maxLife: a.maxLife, mana: a.mana, maxMana: a.maxMana, es: a.es, maxEs: a.maxEs };
  }

  skills(): readonly SkillSlotView[] {
    const out: SkillSlotView[] = SKILLS.map((s, i) => ({
      slot: i,
      id: s.id,
      name: s.name,
      icon: s.icon,
      colors: s.colors,
      cost: s.cost,
      cooldown: s.cooldown,
      remaining: this.cooldowns.get(s.id) ?? 0,
      usable: this.actor.mana >= s.cost,
    }));
    out.push({ slot: 'attack', id: 'slash', name: 'Slash', icon: ATTACK_ICON, colors: { w: 'white', m: 'mist', o: 'orange' }, cost: 0, cooldown: 0, remaining: 0, usable: true });
    out.push({ slot: 'dodge', id: 'roll', name: 'Roll', icon: DODGE_ICON, colors: { s: 'sky' }, cost: 0, cooldown: 0.7, remaining: this.dodgeCd, usable: true });
    return out;
  }

  buffs(): readonly BuffView[] {
    return [...this.buffList].map(([id, b]) => ({ id, name: id === 'warcry' ? 'War Cry' : id, remaining: b.remaining, duration: b.duration, color: 'red' as const }));
  }

  enter(stage: StageWorld, at: Vector3, facing: number): void {
    this.stage = stage;
    stage.root.add(this.object);
    this.actor.position.copy(at);
    this.actor.velocity.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.yaw = facing;
    this.action = null;
    this.dead = false;
    this.player.play('Idle', { fade: 0 });
    this.sync(0);
  }

  setLevel(level: number): void {
    const s = this.actor.stats;
    const prev = { life: this.actor.maxLife, mana: this.actor.maxMana, es: this.actor.maxEs };
    this.actor.level = level;
    s.setBase('life', 70 + 12 * (level - 1));
    s.setBase('mana', 40 + 4 * (level - 1));
    s.setBase('damage', 9 + 2.2 * (level - 1));
    this.actor.rescale(prev);
  }

  setMods(source: string, mods: readonly Mod[]): void {
    const prev = { life: this.actor.maxLife, mana: this.actor.maxMana, es: this.actor.maxEs };
    if (mods.length) this.actor.stats.set(source, mods);
    else this.actor.stats.remove(source);
    this.actor.rescale(prev);
  }

  restore(): void {
    const a = this.actor;
    a.life = a.maxLife;
    a.mana = a.maxMana;
    a.es = a.maxEs;
    this.dead = false;
    this.buffList.clear();
    this.actor.stats.remove('buff:warcry');
    if (this.player) this.player.play('Idle', { fade: 0.1 });
  }

  emote(name: string): void {
    const clip = name === 'wave' ? 'Wave' : name === 'victory' ? 'Victory' : name === 'hurt' ? 'Hurt' : name === 'death' ? 'LieDown' : '';
    if (!clip) return;
    this.action = { kind: 'skill', id: `emote:${name}`, t: 0, duration: name === 'death' ? 99 : 1.2, hitAt: 99, hit: true, dir: new Vector3() };
    this.player.play(clip, { once: true, fade: 0.12 });
  }

  fixedUpdate(dt: number, intent: HeroIntent): void {
    const a = this.actor;
    const st = a.stats;
    a.invulnerable = this.services.dev().god || (this.action?.kind === 'dodge' && this.action.t < this.action.duration * 0.85);
    if (!a.alive) {
      if (!this.dead) {
        this.dead = true;
        this.action = null;
        this.emote('death');
      }
      this.vel.multiplyScalar(0.8);
      this.move(dt);
      return;
    }
    // regen, cooldowns, buffs
    a.life = Math.min(a.maxLife, a.life + st.get('life.regen') * dt);
    a.mana = Math.min(a.maxMana, a.mana + st.get('mana.regen') * dt);
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, Math.max(0, v - dt));
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    for (const [k, b] of this.buffList) {
      b.remaining -= dt;
      if (b.remaining <= 0) {
        this.buffList.delete(k);
        this.setMods(`buff:${k}`, []);
      }
    }

    const speed = st.get('move.speed');
    const wish = this.tmp.set(intent.move.x, 0, intent.move.z);
    const act = this.action;
    if (act) {
      act.t += dt;
      if (!act.hit && act.t >= act.hitAt) {
        act.hit = true;
        this.resolve(act);
      }
      if (act.kind === 'dodge') {
        this.vel.copy(act.dir).multiplyScalar(4.4 / act.duration);
      } else if (act.id === 'dash') {
        this.vel.copy(act.dir).multiplyScalar(act.t < 0.22 ? 24 : 0);
        if (act.t < 0.22) this.dashHits(act);
      } else {
        this.vel.multiplyScalar(Math.exp(-18 * dt)); // attacks root you
      }
      if (act.t >= act.duration) this.action = null;
    }

    if (!this.action) {
      // what to start: dodge > skill > attack > move
      const aim = intent.aim.clone().sub(a.position).setY(0);
      if (aim.lengthSq() < 1e-4) aim.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      aim.normalize();
      if (intent.dodge && this.dodgeCd <= 0) {
        const dir = wish.lengthSq() > 0.01 ? wish.clone().normalize() : new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.start({ kind: 'dodge', id: 'roll', t: 0, duration: 0.42, hitAt: 99, hit: true, dir }, 'Roll', 1);
        this.dodgeCd = 0.7;
        this.services.ctx.audio.play('rl.dodge');
      } else if (intent.skill >= 0 && intent.skill < SKILLS.length) {
        const s = SKILLS[intent.skill]!;
        if ((this.cooldowns.get(s.id) ?? 0) <= 0 && a.mana >= s.cost) {
          a.mana -= s.cost;
          this.cooldowns.set(s.id, s.cooldown);
          const cast = 1 / Math.max(0.2, st.get(s.id === 'nova' || s.id === 'warcry' ? 'cast.speed' : 'attack.speed'));
          if (s.id === 'cleave') this.start({ kind: 'skill', id: s.id, t: 0, duration: 0.45 * cast, hitAt: 0.22 * cast, hit: false, dir: aim }, 'Slash2', 0.4 / (0.45 * cast));
          else if (s.id === 'nova') this.start({ kind: 'skill', id: s.id, t: 0, duration: 0.55 * cast, hitAt: 0.3 * cast, hit: false, dir: aim }, 'Cast', 0.53 / (0.55 * cast));
          else if (s.id === 'dash') this.start({ kind: 'skill', id: s.id, t: 0, duration: 0.34, hitAt: 99, hit: true, dir: aim }, 'Run', 2.5);
          else this.start({ kind: 'skill', id: s.id, t: 0, duration: 0.6 * cast, hitAt: 0.25 * cast, hit: false, dir: aim }, 'Cast', 0.53 / (0.6 * cast));
          this.services.events.emit('skill', { actor: a, skill: s.id });
        } else if (a.mana < s.cost) this.services.ctx.audio.play('rl.error');
      } else if (intent.attack) {
        const dur = 0.42 / Math.max(0.2, st.get('attack.speed'));
        this.combo = (this.combo + 1) % 2;
        this.start({ kind: 'attack', id: 'slash', t: 0, duration: dur, hitAt: dur * 0.45, hit: false, dir: aim }, this.combo ? 'Slash' : 'Slash2', 0.4 / dur);
      }
    }

    if (!this.action) {
      const target = wish.multiplyScalar(speed);
      this.vel.lerp(target, 1 - Math.exp(-14 * dt));
      if (this.vel.lengthSq() > 0.05) {
        const want = Math.atan2(this.vel.x, this.vel.z);
        this.yaw = turn(this.yaw, want, 14 * dt);
      }
    } else if (this.action.kind !== 'dodge') {
      this.yaw = turn(this.yaw, Math.atan2(this.action.dir.x, this.action.dir.z), 30 * dt);
    } else this.yaw = Math.atan2(this.action.dir.x, this.action.dir.z);
    this.move(dt);
  }

  private start(act: Action, clip: string, rate: number): void {
    this.action = act;
    this.player.play(clip, { once: true, restart: true, fade: 0.06, rate });
    if (act.kind !== 'dodge') this.services.ctx.audio.play('rl.swing', { pitch: act.id === 'slash' ? (this.combo ? 2 : 0) : -3 });
  }

  private move(dt: number): void {
    const a = this.actor;
    a.velocity.multiplyScalar(Math.exp(-8 * dt)); // knockback decays
    a.position.addScaledVector(this.vel, dt).addScaledVector(a.velocity, dt);
    this.stage?.collide(a.position, a.radius);
    a.position.y = this.stage?.groundY(a.position.x, a.position.z) ?? 0;
  }

  private damage(mult: number, tags: readonly string[]): { amount: number; crit: boolean } {
    const st = this.actor.stats;
    const rng = this.services.rng;
    const crit = rng.next() * 100 < st.get('crit.chance', tags);
    const amount = st.get('damage', tags) * mult * rng.range(0.85, 1.15) * (crit ? 1.5 : 1);
    return { amount, crit };
  }

  /** Apply an attack or skill at its hit frame. */
  private resolve(act: Action): void {
    const a = this.actor;
    const ctx = this.services.ctx;
    if (act.id === 'warcry') {
      this.buffList.set('warcry', { remaining: 6, duration: 6 });
      this.setMods('buff:warcry', [inc('damage', 0.4)]);
      ctx.particles.burst('rl.cry', a.position.clone().setY(1.2));
      ctx.audio.play('rl.cry');
      return;
    }
    const nova = act.id === 'nova';
    const range = act.id === 'cleave' ? 2.6 : nova ? 4 : 2.1;
    const arc = act.id === 'cleave' ? 200 : nova ? 360 : 130;
    const mult = act.id === 'cleave' ? 1.5 : nova ? 1.3 : 1;
    const tags = nova ? ['spell', 'area', 'fire'] : ['attack', 'melee'];
    if (nova) {
      ctx.particles.burst('rl.nova', a.position.clone().setY(0.4));
      ctx.audio.play('rl.nova');
      this.services.shake(0.25, 0.2);
    }
    for (const t of this.stage?.actors() ?? []) {
      if (!t.alive || t.faction === 'hero' || !(t instanceof StubActor)) continue;
      const d = this.tmp.copy(t.position).sub(a.position).setY(0);
      const dist = d.length();
      if (dist > range + t.radius) continue;
      if (arc < 360 && dist > 0.2) {
        const ang = Math.acos(Math.max(-1, Math.min(1, d.normalize().dot(act.dir))));
        if (ang > (arc / 2) * (Math.PI / 180)) continue;
      }
      const { amount, crit } = this.damage(mult, tags);
      strike(this.services.events, t, {
        source: a,
        skill: act.id,
        tags,
        damage: nova ? { fire: amount } : { physical: amount },
        crit,
        knockback: nova ? 7 : act.id === 'cleave' ? 4 : 2.5,
        from: a.position,
        hitStop: crit ? 4 : 2,
      });
    }
  }

  private readonly dashed = new Set<number>();
  private dashHits(act: Action): void {
    if (act.t < 1 / 60 + 1e-6) this.dashed.clear();
    for (const t of this.stage?.actors() ?? []) {
      if (!t.alive || t.faction === 'hero' || !(t instanceof StubActor) || this.dashed.has(t.id)) continue;
      if (t.position.distanceTo(this.actor.position) > 1.2 + t.radius) continue;
      this.dashed.add(t.id);
      const { amount, crit } = this.damage(1.2, ['attack', 'movement']);
      strike(this.services.events, t, { source: this.actor, skill: 'dash', tags: ['attack', 'movement'], damage: { physical: amount }, crit, knockback: 5, from: this.actor.position });
    }
  }

  update(dt: number): void {
    const p = this.player;
    if (!this.action && !this.dead) {
      const v = Math.hypot(this.vel.x, this.vel.z);
      if (v > 3.4) p.play('Run', { rate: v / 6, fade: 0.2 });
      else if (v > 0.35) p.play('Walk', { rate: Math.max(0.6, v / 2), fade: 0.2 });
      else p.play('Idle', { fade: 0.25 });
    }
    p.update(dt);
    this.sync(dt);
  }

  private sync(dt: number): void {
    const a = this.actor;
    this.model.position.copy(a.position);
    this.model.rotation.y = this.yaw;
    this.shadow.place(a.position.x, a.position.y, a.position.z, 0);
    void dt;
  }

  dispose(): void {
    this.player.dispose();
    this.object.removeFromParent();
  }

  /** The stub tree/gear use plain mods; exposed for the stub tree's tests. */
  static readonly flat = flatMod;
}

function turn(from: number, to: number, max: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-max, Math.min(max, d));
}

export const stubHeroFactory: HeroFactory = {
  async create(services: ShellServices, save: SaveData['hero']): Promise<HeroPort> {
    const hero = new StubHero(services);
    await hero.init();
    hero.setLevel(save.level);
    hero.restore();
    return hero;
  },
};
