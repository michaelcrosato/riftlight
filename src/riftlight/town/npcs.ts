/**
 * The townsfolk: who they are, where they stand, what they say and how they move (data),
 * plus `Npc`, the runtime that plays their clips, turns their heads toward the hero, shows
 * greeting barks and reacts when talked to.
 */
import { type AnimationClip, type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { compileClip } from '../../engine/animation/compile';
import { restPoseOf } from '../../engine/animation';
import { HERO_RIG } from '../../game/hero/rig';
import type { Rng } from '../core/rng';
import { ClipPlayer } from '../game/clipPlayer';
import { COIN_FRAMES, HAMMER_STRIKE_FRAME, NPC_CLIPS } from './npcClips';
import { TOWNSFOLK } from './npcModel';

export type NpcAction = 'craft' | 'vendor' | 'tree' | 'rift' | null;

export interface NpcDef {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  /** What talking to them opens. */
  readonly action: NpcAction;
  /** Model scale (all share the hero rig). */
  readonly scale: number;
  readonly idle: string;
  readonly talk?: string;
  readonly greet?: string;
  /** Said when the hero comes near. */
  readonly barks: readonly string[];
  /** Said when talked to (the panel header). */
  readonly lines: readonly string[];
  /** Turns the whole body toward the hero (not just the head). */
  readonly turns?: boolean;
  /** Head height for bubbles, metres. */
  readonly head: number;
}

export const NPCS: Record<string, NpcDef> = {
  brann: {
    id: 'brann',
    name: 'Brann',
    title: 'Blacksmith',
    action: 'craft',
    scale: 1.08,
    idle: 'Hammer',
    talk: 'Nod',
    barks: ['Steel sings today!', 'Mind the sparks.', 'Bring me something worth reforging.', 'Rifts dull a blade fast.'],
    lines: ['Brann: "Lay it on the anvil. I can reforge what the rift gave you."', 'Brann: "Gold first, sparks after."'],
    head: 2.05,
  },
  ilsa: {
    id: 'ilsa',
    name: 'Ilsa',
    title: 'Merchant',
    action: 'vendor',
    scale: 0.95,
    idle: 'Shuffle',
    greet: 'Greet',
    barks: ['Fresh from the rifts!', 'Over here, traveller!', 'Coin for your trinkets?', 'Best prices this side of the obelisk.'],
    lines: ['Ilsa: "Buy, sell, haggle. Mostly buy."', 'Ilsa: "Everything here came back from a rift. Mostly in one piece."'],
    head: 1.85,
  },
  oru: {
    id: 'oru',
    name: 'Oru',
    title: 'Mystic',
    action: 'tree',
    scale: 0.96,
    idle: 'Meditate',
    talk: 'Bless',
    barks: ['The stars are restless...', 'Your path branches.', 'Breathe. Then choose.'],
    lines: ['Oru: "Your passives are threads. I can unpick a few, for a price."'],
    head: 2.25,
  },
  vex: {
    id: 'vex',
    name: 'Vex',
    title: 'Rift Keeper',
    action: 'rift',
    scale: 1.1,
    idle: 'StaffIdle',
    talk: 'Gesture',
    barks: ['The rift hums for you.', 'Deeper is darker.', 'Ready when you are.'],
    lines: ['Vex: "The obelisk can open any depth you have earned, and one more."'],
    turns: true,
    head: 2.1,
  },
  villager: { id: 'villager', name: 'Wren', title: 'Villager', action: null, scale: 0.9, idle: 'Idle', barks: ['Lovely evening.', 'Back from the rift again?', 'Bread, still warm!'], lines: [], head: 1.75 },
  villager2: { id: 'villager2', name: 'Pell', title: 'Villager', action: null, scale: 0.86, idle: 'Idle', barks: ['Did you hear that?', 'The obelisk glows brighter lately.', 'Watch your step out there.'], lines: [], head: 1.7 },
};

export interface Bubble {
  text: string;
  /** World point above the head. */
  at: Vector3;
  /** Seconds shown so far / total. */
  t: number;
  life: number;
}

const UP = new Vector3(0, 1, 0);

export class Npc {
  readonly model: Object3D;
  readonly root: Object3D;
  readonly player: ClipPlayer;
  readonly position = new Vector3();
  yaw: number;
  private readonly baseYaw: number;
  private readonly head: Object3D | null;
  private lookYaw = 0;
  private lookPitch = 0;
  private near = false;
  private barkCd = 2;
  bubble: Bubble | null = null;
  talking = false;
  /** Fired on authored frames (hammer strikes, coins). */
  onBeat?: (kind: 'strike' | 'coin') => void;
  private idleLoops = 0;
  private lastTime = 0;
  /** Walking villagers: waypoints and state. */
  path: Vector3[] = [];
  private wp = 0;
  private wait = 0;
  private readonly q = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  constructor(
    readonly def: NpcDef,
    at: Vector3,
    yawDeg: number,
    private readonly rng: Rng,
  ) {
    const build = TOWNSFOLK[def.id];
    if (!build) throw new Error(`no townsfolk model "${def.id}"`);
    this.model = build();
    this.root = this.model;
    const rest = restPoseOf(this.model, HERO_RIG);
    const clips: AnimationClip[] = (NPC_CLIPS[def.id] ?? []).map((c) => compileClip(c, HERO_RIG, rest));
    this.player = new ClipPlayer(this.model, clips);
    this.model.scale.setScalar(def.scale);
    this.position.copy(at);
    this.yaw = this.baseYaw = (yawDeg * Math.PI) / 180;
    this.head = this.model.getObjectByName('Head') ?? null;
    this.player.play(def.idle, { fade: 0 });
    // desync identical loops
    this.player.mixer.setTime(rng.range(0, 3));
    this.sync();
  }

  /** Say something (a pixel bubble above the head). */
  say(text: string, seconds = 3.2): void {
    this.bubble = { text, at: this.position.clone().setY(this.def.head * this.def.scale), t: 0, life: seconds };
  }

  /** Talked to: react, face the hero, say a line. */
  talk(): string {
    this.talking = true;
    if (this.def.talk) this.player.play(this.def.talk, { once: true, restart: true, fade: 0.2 });
    const line = this.rng.pick(this.def.lines.length ? this.def.lines : this.def.barks);
    this.say(line.replace(/^[^:]+: /, '').replace(/^"|"$/g, ''), 3.5);
    return line;
  }

  endTalk(): void {
    this.talking = false;
    this.player.play(this.def.idle, { fade: 0.3 });
  }

  update(dt: number, hero: Vector3 | null): void {
    const d = hero ? this.tmp.copy(hero).sub(this.position).setY(0).length() : Infinity;
    // approach: a bark, and Ilsa waves
    const close = d < 4.2;
    this.barkCd -= dt;
    if (close && !this.near && this.barkCd <= 0 && !this.talking) {
      this.say(this.rng.pick(this.def.barks));
      this.barkCd = 14;
      if (this.def.greet) this.player.play(this.def.greet, { once: true, restart: true, fade: 0.15 });
    }
    this.near = close;
    // clip schedule: one-shots go back to the idle loop; Ilsa alternates idles
    if (this.player.finished) {
      const next = this.talking && this.def.id === 'brann' ? 'HammerRest' : this.def.idle;
      if (this.player.name !== next) this.player.play(next, { fade: 0.3 });
    }
    if (this.def.id === 'ilsa' && !this.talking && this.player.time < this.lastTime) {
      this.idleLoops++;
      if (this.player.name === 'Shuffle' && this.idleLoops % 2 === 0) this.player.play('CountCoins', { fade: 0.4 });
      else if (this.player.name === 'CountCoins' && this.idleLoops % 3 === 0) this.player.play('Shuffle', { fade: 0.4 });
    }
    if (this.path.length) this.walk(dt, hero, d);
    this.lastTime = this.player.time;
    this.player.update(dt);
    if (this.player.name === 'Hammer' && this.player.crossed(HAMMER_STRIKE_FRAME)) this.onBeat?.('strike');
    if (this.player.name === 'CountCoins' && COIN_FRAMES.some((f) => this.player.crossed(f))) this.onBeat?.('coin');

    // whole-body turn (Vex) or head look-at (everyone), smoothed
    const want = hero && d < 6.5 && d > 0.3 ? Math.atan2(hero.x - this.position.x, hero.z - this.position.z) : null;
    if (this.def.turns && !this.path.length) {
      const target = want ?? this.baseYaw;
      this.yaw += angle(target - this.yaw) * (1 - Math.exp(-3 * dt));
    }
    let ly = 0;
    let lp = 0;
    if (want !== null && this.head) {
      ly = Math.max(-1.1, Math.min(1.1, angle(want - this.yaw)));
      const hy = this.def.head * this.def.scale;
      lp = Math.max(-0.35, Math.min(0.4, Math.atan2(hy - 1.5, d) * 0.8));
    }
    const k = 1 - Math.exp(-5 * dt);
    this.lookYaw += (ly - this.lookYaw) * k;
    this.lookPitch += (lp - this.lookPitch) * k;
    if (this.head) {
      this.q.setFromAxisAngle(UP, this.lookYaw);
      this.head.quaternion.premultiply(this.q);
      this.q.setFromAxisAngle(new Vector3(1, 0, 0), this.lookPitch);
      this.head.quaternion.multiply(this.q);
    }
    if (this.bubble) {
      this.bubble.t += dt;
      this.bubble.at.copy(this.position).setY(this.def.head * this.def.scale);
      if (this.bubble.t > this.bubble.life) this.bubble = null;
    }
    this.sync();
  }

  private walk(dt: number, hero: Vector3 | null, heroDist: number): void {
    const target = this.path[this.wp]!;
    const to = this.tmp.copy(target).sub(this.position).setY(0);
    const dist = to.length();
    const blocked = hero !== null && heroDist < 1.4 && to.dot(this.tmp2.copy(hero).sub(this.position)) > 0;
    if (this.wait > 0 || blocked || this.talking) {
      this.wait -= dt;
      if (this.player.name !== 'Idle') this.player.play('Idle', { fade: 0.3 });
      return;
    }
    if (dist < 0.2) {
      this.wp = (this.wp + 1) % this.path.length;
      this.wait = this.rng.range(1.5, 4.5);
      return;
    }
    const speed = 1.1;
    to.normalize();
    this.position.addScaledVector(to, Math.min(dist, speed * dt));
    this.yaw += angle(Math.atan2(to.x, to.z) - this.yaw) * (1 - Math.exp(-6 * dt));
    this.player.play('Walk', { rate: speed / 2, fade: 0.25 });
  }

  private sync(): void {
    this.model.position.copy(this.position);
    this.model.rotation.y = this.yaw;
  }

  dispose(): void {
    this.player.dispose();
  }
}

function angle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
