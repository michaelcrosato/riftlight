import { BoxGeometry, Group, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { ContactShadow, mergeStaticMeshes, toonMaterial, type Game, type GameContext } from '../../engine';
import { resolveDebugKeys, type DebugKeyMap } from '../../engine/debugKeys';
import { PALETTE } from '../../engine/palette';
import { HERO_CLIPS, HERO_MODEL } from '../../game/hero';
import { flat } from '../core/mods';
import { Rng } from '../core/rng';
import { Actor, type ActorWorld, type Brain } from '../actors/Actor';
import { ActorManager } from '../actors/ActorManager';
import { HERO_DEBUG_KEYS, HERO_GAMEPAD_BUTTONS, SLOT_LABELS } from '../actors/controls';
import { HeroController, type SlotSpec } from '../actors/HeroController';
import { openFloor, GridMover } from '../actors/movers';
import { buildSkill } from '../skills/build';
import type { ResolvedSkill, SkillGem } from '../skills/types';
import { Combat, type WallQuery } from './Combat';

/**
 * Combat test arena (`/?game=arena`): a flat floor with a few pillars, the hero with a
 * sword and a full skill bar, and target dummies (cubes) that walk up and swat back weakly.
 * Everything combat does is on show: combos, hit-stop, knockback, flashes, numbers, shake,
 * ailments, every delivery, deaths. It is also what `npm run film -- arena-*` and the
 * `riftlight-combat` e2e suite drive.
 *
 *   ?skills=fireball,frost-nova+increased-area,leap-slam   skill bar (gem+support+support,...)
 *   ?dummies=6                                              how many dummies
 */
export const ARENA = {
  size: 15,
  spawn: [0, 0, 4] as [number, number, number],
  pillars: [[-6, 0, -5], [6, 0, -5], [-6, 0, 6], [6, 0, 6]] as [number, number, number][],
  /** Default skill bar: RMB/K, Q, E, R, F. */
  slots: ['cleave', 'fireball', 'frost-nova', 'leap-slam', 'whirlwind'],
  dummies: [
    { at: [0, 0, -2], life: 400, still: true },
    { at: [-3, 0, -4], life: 90 },
    { at: [3, 0, -4], life: 90 },
    { at: [-2, 0, -7], life: 140 },
    { at: [2, 0, -7], life: 140 },
  ] as { at: [number, number, number]; life: number; still?: boolean }[],
};

/** The dummies' swat: a short melee strike with its own small damage. */
export const DUMMY_SWAT: SkillGem = {
  id: 'dummy-swat', name: 'Swat', description: 'A training dummy hits back.', tags: ['attack', 'melee', 'strike', 'physical', 'damage'],
  cost: 0, cooldown: 0, castTime: 1, anim: 'Slash1', delivery: { kind: 'strike', range: 1.5, arc: 90 },
  effects: [{ kind: 'damage', base: { physical: [3, 6] }, effectiveness: 1 }, { kind: 'knockback', force: 3 }],
  look: { color: 'red', burst: 'spark', sound: { cast: 'swing', hit: 'hit' } }, weight: 0,
};

/** Walk up to the hero, wind up (telegraphed by a squash), swat. Still dummies only turn. */
class DummyBrain implements Brain {
  windup = 0;
  private cooldown: number;
  constructor(
    private readonly combat: Combat,
    private readonly swat: ResolvedSkill,
    private readonly still: boolean,
    seed: number,
  ) {
    this.cooldown = 1 + (seed % 5) * 0.3;
  }

  think(a: Actor, dt: number, world: ActorWorld): void {
    a.velocity.set(0, 0, 0);
    const foe = world.nearest(a.position, 9, (x) => x.alive && a.hostileTo(x));
    if (!foe) return;
    const dx = foe.position.x - a.position.x;
    const dz = foe.position.z - a.position.z;
    const d = Math.hypot(dx, dz);
    a.facing = Math.atan2(dx, dz);
    this.cooldown -= dt * a.actionSpeed;
    if (this.windup > 0) {
      this.windup -= dt * a.actionSpeed;
      if (this.windup <= 0) this.combat.cast(a, this.swat, foe.position.clone());
      return;
    }
    if (d > a.radius + foe.radius + 0.9) {
      if (!this.still && d < 9) a.velocity.set((dx / d) * a.moveSpeed, 0, (dz / d) * a.moveSpeed);
      return;
    }
    if (this.cooldown <= 0) {
      this.cooldown = 1.8;
      this.windup = 0.45;
    }
  }
}

/** Parse `?skills=a+support,b,...` into slot specs. */
export function parseSlots(param: string | null): SlotSpec[] {
  const list = param ? param.split(',') : ARENA.slots;
  return list.map((entry) => {
    const [skill, ...supports] = entry.split('+');
    return { skill: skill!, supports };
  });
}

export class Arena implements Game {
  readonly name = 'Riftlight Arena';
  readonly assets = [HERO_MODEL];
  actors!: ActorManager;
  combat!: Combat;
  hero!: HeroController;
  heroModel!: Object3D;
  readonly dummies: Actor[] = [];
  respawns = 0;
  private readonly shadow = new ContactShadow(0.42);
  private readonly target = new Vector3();
  private readonly rng = new Rng('arena');
  private restore: { keys: DebugKeyMap; pad: Record<number, string> } | null = null;
  private respawnAt = -1;
  /** Hero damage dealt in the last seconds (HUD meter). */
  private readonly dealt: { t: number; amount: number }[] = [];
  private time = 0;

  async setup(ctx: GameContext): Promise<void> {
    const { scene, physics } = ctx;
    // R is a skill key here: move the resolution hotkey to F2; pad buttons to the ARPG layout
    this.restore = { keys: ctx.engine.debugKeys, pad: { ...ctx.input.gamepadButtons } };
    ctx.engine.debugKeys = resolveDebugKeys(HERO_DEBUG_KEYS);
    ctx.input.gamepadButtons = { ...HERO_GAMEPAD_BUTTONS };

    const s = ARENA.size;
    const floor = new Mesh(new BoxGeometry(s * 2, 1, s * 2), [toonMaterial(PALETTE.slate), toonMaterial(PALETTE.slate), toonMaterial(PALETTE.night), toonMaterial(PALETTE.slate), toonMaterial(PALETTE.slate), toonMaterial(PALETTE.slate)]);
    floor.position.y = -0.5;
    floor.receiveShadow = true;
    const tiles: Object3D[] = [floor];
    // a checker of slightly lighter tiles so movement reads
    for (let x = -s + 1; x < s; x += 4) for (let z = -s + 1; z < s; z += 4) {
      const t = new Mesh(new BoxGeometry(2, 0.02, 2), toonMaterial(PALETTE.navy));
      t.position.set(x + ((z / 4) % 2 ? 2 : 0), 0.005, z);
      t.receiveShadow = true;
      tiles.push(t);
    }
    for (const [x, , z] of ARENA.pillars) {
      const p = new Mesh(new BoxGeometry(1.2, 3, 1.2), toonMaterial(PALETTE.mist));
      p.position.set(x, 1.5, z);
      p.castShadow = p.receiveShadow = true;
      tiles.push(p);
      physics.addStaticBox({ position: [x, 1.5, z], halfExtents: [0.6, 1.5, 0.6] });
    }
    scene.add(...mergeStaticMeshes(tiles));
    physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [s, 0.5, s] });
    for (const [x, z, hx, hz] of [[0, -s, s, 0.5], [0, s, s, 0.5], [-s, 0, 0.5, s], [s, 0, 0.5, s]] as const) {
      physics.addStaticBox({ position: [x, 1, z], halfExtents: [hx, 1, hz] });
    }

    this.actors = new ActorManager(undefined, scene);
    const wall: WallQuery = (from, to) => {
      const dir = to.clone().sub(from);
      const len = dir.length();
      if (len < 1e-4) return null;
      const hit = physics.castRay(from, dir.divideScalar(len), len, ['character']);
      return hit ? hit.distance / len : null;
    };
    this.combat = new Combat({ actors: this.actors, scene, audio: ctx.audio, particles: ctx.particles, wall, hero: () => this.hero?.actor ?? null });
    this.combat.lights.warm();

    const model = await ctx.loadModel(HERO_MODEL, { castShadow: false });
    this.heroModel = model.scene;
    scene.add(this.heroModel, this.shadow);
    const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    this.hero = new HeroController({
      physics,
      combat: this.combat,
      model: this.heroModel,
      clips: HERO_CLIPS,
      at: ARENA.spawn,
      slots: parseSlots(params.get('skills')),
      // a starter sword: what the arena's attacks scale from (loot equips real weapons)
      mods: { weapon: [flat('weapon.physical.min', 6), flat('weapon.physical.max', 11), flat('weapon.crit', 0.05)] },
      canvas: ctx.engine.renderer.renderer.domElement,
    });
    this.hero.bindInput(ctx.input, ctx.engine.renderer.renderer.domElement);
    this.actors.add(this.hero.actor);
    this.hero.actor.events!.on('hit', ({ hit, result }) => {
      if (hit.source === this.hero.actor || (hit.source as Actor | null)?.owner === this.hero.actor) this.dealt.push({ t: this.time, amount: result.total });
    });
    const n = Number(params.get('dummies'));
    this.spawnDummies(n > 0 ? n : ARENA.dummies.length);
  }

  /** Put the dummies back (all of them, fresh). */
  spawnDummies(count = ARENA.dummies.length): void {
    for (const d of this.dummies) if (d.alive) d.die(null);
    this.dummies.length = 0;
    for (let i = 0; i < count; i++) {
      const def = ARENA.dummies[i % ARENA.dummies.length]!;
      const at: [number, number, number] = i < ARENA.dummies.length ? def.at : [this.rng.range(-8, 8), 0, this.rng.range(-9, -3)];
      this.dummies.push(this.actors.add(this.makeDummy(at, def.life, def.still === true, i)));
    }
    this.respawns++;
  }

  private makeDummy(at: [number, number, number], life: number, still: boolean, i: number): Actor {
    const root = new Group();
    const body = new Mesh(box(), toonMaterial(still ? PALETTE.sand : PALETTE.red));
    body.scale.set(0.8, 1.1, 0.8);
    body.position.y = 0.55;
    body.castShadow = true;
    const eye = new Mesh(box(), toonMaterial(PALETTE.ink));
    eye.scale.set(0.5, 0.12, 0.05);
    eye.position.set(0, 0.85, 0.41);
    root.add(body, eye);
    const actor = new Actor({
      faction: 'monster',
      name: still ? 'training dummy' : 'dummy',
      base: { life, 'move.speed': 2.6, 'life.regen': still ? 20 : 0, armour: still ? 0 : 20 },
      body: root,
      mover: new GridMover(openFloor(ARENA.size - 0.6), at, 0.45),
      tags: ['dummy'],
      seed: `dummy:${i}:${this.respawns}`,
    });
    const brain = new DummyBrain(this.combat, buildSkill(DUMMY_SWAT, [], actor.stats), still, i);
    actor.brain = brain;
    actor.facing = Math.PI;
    // squash while winding up (the telegraph), wobble when hit
    actor.animate = () => {
      const w = brain.windup > 0 ? 1 - brain.windup / 0.45 : 0;
      body.scale.set(0.8 + w * 0.15, 1.1 - w * 0.25, 0.8 + w * 0.15);
      body.position.y = (1.1 - w * 0.25) / 2;
    };
    return actor;
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    this.time += dt;
    this.hero.fixedUpdate(ctx, dt);
    this.actors.fixedUpdate(dt);
    this.combat.fixedUpdate(dt);
    if (this.dummies.length && this.dummies.every((d) => !d.alive)) {
      if (this.respawnAt < 0) this.respawnAt = this.time + 2;
      else if (this.time >= this.respawnAt) {
        this.respawnAt = -1;
        this.spawnDummies(this.dummies.length);
      }
    }
    if (!this.hero.actor.alive && this.hero.actor.deadFor > 3) {
      this.hero.revive();
      this.hero.teleport(ARENA.spawn);
    }
  }

  update(ctx: GameContext, dt: number): void {
    this.actors.update(dt, ctx.physics.alpha);
    this.hero.update(dt);
    this.combat.update(dt);
    this.combat.shake.apply(ctx.camera, dt);
    const p = this.heroModel.position;
    this.shadow.place(p.x, 0, p.z, Math.max(0, p.y));
    this.drawHud(ctx);
  }

  private drawHud(ctx: GameContext): void {
    const { hud } = ctx;
    const a = this.hero.actor;
    hud.clear();
    // life and mana bars, bottom left
    bar(hud, 6, 6, 70, a.life / a.maxLife, 'red', `${Math.ceil(a.life)}`);
    bar(hud, 6, 16, 70, a.mana / Math.max(1, a.maxMana), 'blue', `${Math.floor(a.mana)}`);
    // skill bar, bottom centre
    const slots = [this.hero.basic, ...this.hero.slots];
    const labels = ['LMB', ...SLOT_LABELS];
    const w = 34;
    const x0 = -((slots.length - 1) * w) / 2;
    slots.forEach((s, i) => {
      const x = Math.round(x0 + i * w);
      const cd = s ? (this.hero.cooldowns.get(s.id) ?? 0) : 0;
      const cost = s ? s.cost : 0;
      const ok = s && cd <= 0 && a.mana >= (s.channel ? cost * 0.25 : cost);
      hud.text(x, 16, labels[i]!, { anchor: 'bottom', color: 'mist' });
      hud.text(x, 6, s ? short(s.def.name) : '-', { anchor: 'bottom', color: ok ? 'white' : 'slate' });
    });
    // damage per second over the last 4 s
    while (this.dealt.length && this.time - this.dealt[0]!.t > 4) this.dealt.shift();
    const dps = this.dealt.reduce((s, d) => s + d.amount, 0) / 4;
    hud.text(6, 6, `DPS ${Math.round(dps)}`, { anchor: 'top-right', color: 'sand' });
    hud.text(6, 6, this.status(), { color: 'mist' });
    if (this.hero.feedback && this.hero.feedback.until > this.time) hud.text(0, 40, this.hero.feedback.text, { anchor: 'center', color: 'sand' });
    if (!a.alive) hud.text(0, 0, 'DOWN', { anchor: 'center', scale: 2, color: 'red' });
    this.combat.drawNumbers(hud, ctx.camera.camera);
  }

  cameraTarget(): Vector3 {
    if (!this.heroModel) return this.target.set(ARENA.spawn[0], 0.9, ARENA.spawn[2]);
    const p = this.heroModel.position;
    return this.target.set(p.x, p.y * 0.3 + 0.9, p.z);
  }

  status(): string {
    if (!this.hero) return '';
    const alive = this.dummies.filter((d) => d.alive).length;
    return `${this.hero.state} ${this.hero.anim} | dummies ${alive}/${this.dummies.length} | kills ${this.combat.stats.kills}`;
  }

  dispose(ctx: GameContext): void {
    this.hero?.dispose();
    this.combat?.dispose();
    if (this.restore) {
      ctx.engine.debugKeys = this.restore.keys;
      ctx.input.gamepadButtons = this.restore.pad;
    }
  }
}

let boxGeo: BoxGeometry | null = null;
function box(): BoxGeometry {
  if (!boxGeo) {
    boxGeo = new BoxGeometry(1, 1, 1);
    boxGeo.userData.shared = true;
  }
  return boxGeo;
}

function short(name: string): string {
  const words = name.toUpperCase().split(' ');
  return words.length > 1 ? words.map((w) => w.slice(0, 3)).join('').slice(0, 5) : words[0]!.slice(0, 5);
}

function bar(hud: GameContext['hud'], x: number, y: number, w: number, k: number, color: 'red' | 'blue', label: string): void {
  hud.rect(x - 1, y - 1, w + 2, 8, 'ink', 'bottom-left');
  hud.rect(x, y, Math.max(0, Math.round(w * Math.min(1, k))), 6, color, 'bottom-left');
  hud.text(x + w + 4, y, label, { anchor: 'bottom-left', color: 'white' });
}
