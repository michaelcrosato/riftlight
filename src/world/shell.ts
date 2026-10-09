/**
 * The shell of Engine World: what lasts while rooms come and go (each room is its own
 * `Game`, loaded with `engine.loadGame`). It owns the UI (card, toasts, labels, panels),
 * the hotkeys, the room transitions and the list of visited rooms.
 *
 *   H  how it works (the station guide)      T  tweak: the room's and the engine's settings
 *   G  go to any room                        I  the room's card again
 *   Esc  menu (field guide, back to the Atrium, reset the room)
 */
import { type Camera, Color, Vector3 } from 'three/webgpu';
import {
  type Engine,
  type Game,
  type GameContext,
  type Look,
  LOOK_PRESETS,
  lookPresetOf,
  type MoveInput,
  PALETTE,
  readMoveInput,
  TRANSITIONS,
  type TransitionKind,
} from '../engine';
import { HERO_MODEL } from '../game/hero';
import { MenuInput, Pointer } from '../riftlight/game/controls';
import { UiCanvas, wrap } from '../riftlight/ui/kit';
import { UiLayer } from '../riftlight/ui/layer';
import { moveInput, Visitor } from '../riftlight/showcase/visitor';
import { type KitHost, type Label, type Pad, RoomKit } from './kit/RoomKit';
import type { Knob, RoomDef, RoomLogic, RoomRuntime, Vec3 } from './types';
import { fieldGuide, guidePanel, pauseMenu, roomsMenu, tweakMenu } from './ui/panels';
import { wing } from './wings';

/** Keys the shell claims from the browser (F1 help, Tab focus). */
const SHELL_KEYS = ['F1', 'F2', 'Tab'];
const KEY = {
  guide: ['KeyH', 'F1'],
  tweak: ['KeyT'],
  rooms: ['KeyG', 'F2'],
  card: ['KeyI'],
  menu: ['Escape'],
} as const;

const UI_SOUNDS = {
  'ui-move': { wave: 'square', duty: 0.25, freq: 880, attack: 0.001, decay: 0.03, volume: 0.08 },
  'ui-click': { wave: 'square', duty: 0.5, freq: 660, freqEnd: 990, attack: 0.001, decay: 0.05, volume: 0.12 },
  'ui-open': { wave: 'triangle', freq: 440, freqEnd: 880, attack: 0.002, decay: 0.08, volume: 0.2 },
  'ui-close': { wave: 'triangle', freq: 700, freqEnd: 350, attack: 0.002, decay: 0.08, volume: 0.18 },
  pad: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 7, 12], arpRate: 0.05, attack: 0.002, sustain: 0.06, decay: 0.12, volume: 0.16 },
  portal: { wave: 'sine', freq: 300, freqEnd: 1200, vibrato: { depth: 2, rate: 18 }, attack: 0.02, sustain: 0.1, decay: 0.25, volume: 0.22 },
} as const;

/** Where every room lives; set by rooms/index.ts (kept out of this module to avoid an import cycle). */
let registry: readonly RoomDef[] = [];
export function registerRooms(rooms: readonly RoomDef[]): void {
  registry = rooms;
}
export function rooms(): readonly RoomDef[] {
  return registry;
}
export function roomById(id: string): RoomDef | undefined {
  return registry.find((r) => r.id === id);
}

export class WorldShell {
  engine: Engine | null = null;
  ui!: UiCanvas;
  readonly layer = new UiLayer();
  pointer: Pointer | null = null;
  private readonly menuInput = new MenuInput();
  readonly visited = new Set<string>();
  /** The room on screen. */
  room: RoomGame | null = null;
  /** A transition or a load is under way: doors and keys wait. */
  busy = false;
  /** Room changes cover the screen with this. */
  transition: TransitionKind = 'iris';
  /** The player's own look (rooms with a look of their own put it back when they unload). */
  baseLook: Look | null = null;
  private cardTime = 0;
  private toastText = '';
  private toastTime = 0;
  private lastNow = -1;
  /** Game speed while a modal panel froze the room. */
  private frozenSpeed: number | null = null;

  /** Once per page: the UI canvas, pointer, sounds and claimed keys. */
  attach(engine: Engine): void {
    if (this.engine === engine) return;
    this.engine = engine;
    this.ui = new UiCanvas(engine.hud);
    this.pointer = new Pointer(engine);
    for (const k of SHELL_KEYS) engine.input.preventKeys.add(k);
    for (const [name, def] of Object.entries(UI_SOUNDS)) engine.audio.register(name, def);
    this.layer.onSound = (s) => engine.audio.play(s === 'open' ? 'ui-open' : 'ui-close');
    this.baseLook = engine.look;
  }

  /** Go to a room: cover the screen, load it, uncover. */
  async goto(id: string, o: { from?: string | null; instant?: boolean } = {}): Promise<boolean> {
    const engine = this.engine;
    const def = roomById(id);
    if (!engine || !def || this.busy) return false;
    this.busy = true;
    this.layer.closeAll();
    this.unfreeze();
    const from = o.from === undefined ? (this.room?.def.id ?? null) : o.from;
    const kind = this.transition;
    try {
      engine.audio.play('portal');
      const hero = this.room?.visitor?.position;
      // something else may take over the screen mid-cover (a room's own transition): the load
      // still only happens behind a fully covered screen
      if (o.instant || !(await engine.screen.cover(kind, { duration: 0.4, center: hero ? hero.clone().setY(hero.y + 0.9) : undefined }))) engine.screen.set(kind, 1);
      await engine.loadGame(new RoomGame(def, from));
    } finally {
      // uncovered also when the load failed (the error shows instead of a black screen)
      const next = this.room?.visitor?.position;
      if (o.instant) engine.screen.set(null, 0);
      else await engine.screen.reveal(kind, { duration: 0.4, center: next ? next.clone().setY(next.y + 0.9) : undefined });
      this.busy = false;
    }
    return true;
  }

  /** Back to the Atrium, in front of this room's door. */
  leave(): Promise<boolean> {
    return this.goto('atrium');
  }

  /** Build the current room again. */
  reset(): Promise<boolean> {
    const id = this.room?.def.id;
    return id ? this.goto(id, { from: null }) : Promise.resolve(false);
  }

  toast(text: string, seconds = 5): void {
    this.toastText = text;
    this.toastTime = seconds;
  }

  /** True while the UI owns the keys (a panel is open or a room is changing). */
  get capturing(): boolean {
    return this.busy || !!this.layer.top;
  }

  // ------------------------------------------------------------------ panels

  openGuide(): void {
    const room = this.room;
    if (!room) return;
    this.layer.open(guidePanel(room.def, room.kit.pads, room.logic.knobs ?? []), { modal: false, dock: 'right', dim: false });
  }

  openTweak(): void {
    const room = this.room;
    if (!room || !this.engine) return;
    this.layer.open(
      tweakMenu(`Tweak: ${room.def.title}`, room.logic.knobs ?? [], this.engineKnobs(), () => this.layer.close('tweak')),
      { modal: false, dock: 'right', dim: false },
    );
  }

  openRooms(): void {
    const current = this.room?.def.id ?? '';
    this.layer.open(
      roomsMenu(registry, current, this.visited, (id) => void this.goto(id), () => this.layer.close('rooms')),
      { modal: true, onClose: () => this.unfreeze() },
    );
    this.freeze();
  }

  openPause(): void {
    const inAtrium = this.room?.def.id === 'atrium';
    const close = () => this.layer.close('pause');
    this.layer.open(
      pauseMenu(inAtrium, {
        resume: close,
        guide: () => (close(), this.openGuide()),
        tweak: () => (close(), this.openTweak()),
        rooms: () => (close(), this.openRooms()),
        glossary: () => (close(), this.openGlossary()),
        atrium: () => void this.leave(),
        reset: () => void this.reset(),
      }),
      { modal: true, onClose: () => this.unfreeze() },
    );
    this.freeze();
  }

  openGlossary(): void {
    this.layer.open(fieldGuide(), { modal: false, dock: 'right', dim: false });
  }

  showCard(seconds = 14): void {
    this.cardTime = seconds;
  }

  /** The engine's own settings, under the room's in the tweak panel. */
  engineKnobs(): Knob[] {
    const e = this.engine!;
    const looks = Object.keys(LOOK_PRESETS);
    const cams = ['iso', 'topdown', 'side', 'third', 'first', 'free'] as const;
    const qualities = ['low', 'medium', 'high'] as const;
    return [
      {
        id: 'engine-speed',
        label: 'Game speed',
        min: 0.1,
        max: 3,
        step: 0.05,
        initial: 1,
        get: () => this.frozenSpeed ?? e.timeScale,
        // behind a modal panel the room stays frozen: the new speed applies when it closes
        set: (v) => (this.frozenSpeed !== null ? (this.frozenSpeed = v) : (e.timeScale = v)),
        format: (v) => `${v.toFixed(2)}x`,
      },
      {
        kind: 'choice',
        id: 'engine-look',
        label: 'Look',
        options: looks.map((n) => n.replace(/_/g, ' ')),
        get: () => Math.max(0, looks.indexOf(lookPresetOf(e.look) ?? 'none')),
        set: (i) => {
          e.setLook(LOOK_PRESETS[looks[i]!]!);
          if (!this.room?.def.look) this.baseLook = e.look;
        },
      },
      {
        kind: 'choice',
        id: 'engine-camera',
        label: 'Camera',
        options: cams,
        get: () => Math.max(0, cams.indexOf(e.camera.preset as (typeof cams)[number])),
        set: (i) => void e.setCamera({ preset: cams[i]! }, { syncUrl: false }),
      },
      { kind: 'toggle', id: 'engine-pixel', label: 'Pixel art', get: () => e.renderer.mode === 'pixel', set: (v) => void (v !== (e.renderer.mode === 'pixel') && e.toggleMode()) },
      { kind: 'choice', id: 'engine-quality', label: 'Quality', options: qualities, get: () => qualities.indexOf(e.quality), set: (i) => e.setQuality(qualities[i]!) },
      { kind: 'choice', id: 'engine-transition', label: 'Room change', options: TRANSITIONS, get: () => TRANSITIONS.indexOf(this.transition), set: (i) => (this.transition = TRANSITIONS[i]!) },
      { id: 'engine-shake', label: 'Screen shake', min: 0, max: 2, step: 0.1, initial: 1, get: () => e.shake.strength, set: (v) => (e.shake.strength = v) },
      { kind: 'toggle', id: 'engine-sound', label: 'Sound', get: () => !e.audio.muted, set: (v) => e.audio.setMuted(!v) },
    ];
  }

  /** A modal panel stops the room (game speed 0) until it closes. */
  private freeze(): void {
    const e = this.engine;
    if (!e || this.frozenSpeed !== null) return;
    this.frozenSpeed = e.timeScale;
    e.timeScale = 0;
  }

  private unfreeze(): void {
    const e = this.engine;
    if (!e || this.frozenSpeed === null) return;
    if (this.layer.stack.some((o) => o.modal)) return;
    e.timeScale = this.frozenSpeed;
    this.frozenSpeed = null;
  }

  /** Room unloaded: panels about it go, a frozen room thaws. */
  roomGone(room: RoomGame): void {
    if (this.room !== room) return;
    this.layer.closeAll();
    this.toastTime = 0;
    if (this.engine && this.frozenSpeed !== null) this.engine.timeScale = this.frozenSpeed;
    this.frozenSpeed = null;
    this.room = null;
  }

  // ------------------------------------------------------------------ per frame

  /** UI input and hotkeys (from the room's `update`). */
  frame(ctx: GameContext): void {
    const e = ctx.engine;
    const now = performance.now() / 1000;
    const real = e.manual ? 1 / 60 : this.lastNow < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.cardTime = Math.max(0, this.cardTime - real);
    this.toastTime = Math.max(0, this.toastTime - real);
    const input = ctx.input;
    const hadPanel = !!this.layer.top;
    const events = [...(this.pointer?.frame(real) ?? []), ...this.menuInput.events(input, real)];
    const ui = this.ui;
    ui.time += real;
    if (this.pointer) {
      ui.pointer.x = this.pointer.art.x;
      ui.pointer.y = this.pointer.art.y;
      ui.pointer.used = this.pointer.idle < 4 && !this.pointer.touch;
    }
    this.layer.update(real);
    // keys pressed for a panel (Space, J, F confirm) must not reach the hero when it closes
    if (hadPanel || this.busy) input.clearQueued();
    if (hadPanel) {
      const top = this.layer.top!.panel.id;
      // the key that opened a panel closes it again
      const toggles: Record<string, readonly string[]> = { guide: KEY.guide, tweak: KEY.tweak, rooms: KEY.rooms, glossary: KEY.guide };
      if (toggles[top] && input.wasPressed(...toggles[top]!)) {
        this.layer.close(top);
        return;
      }
      for (const ev of events) {
        if (ev.kind === 'key') continue;
        this.layer.input(ev);
      }
      return;
    }
    if (this.busy) return;
    if (input.wasPressed(...KEY.guide)) this.openGuide();
    else if (input.wasPressed(...KEY.tweak)) this.openTweak();
    else if (input.wasPressed(...KEY.rooms)) this.openRooms();
    else if (input.wasPressed(...KEY.menu)) this.openPause();
    else if (input.wasPressed(...KEY.card)) this.cardTime = this.cardTime > 0 ? 0 : 30;
  }

  /** The HUD: labels, the room's own, the card, a toast, hints, panels. */
  draw(ctx: GameContext, room: RoomGame): void {
    const hud = ctx.hud;
    const ui = this.ui;
    hud.clear();
    if (this.engine?.screen.state().progress === 1) return; // covered: nothing on top
    this.drawLabels(ctx, room);
    room.logic.draw?.();
    const def = room.def;
    // top-right: where you are
    const w = wing(def.wing);
    const title = def.title.toUpperCase();
    if (this.cardTime <= 0 && !this.layer.top) {
      ui.text(ui.w - 4, 4, title, { align: 'right', color: 'white' });
      ui.mini(ui.w - 4, 13, w.title.toUpperCase(), w.color, 'right', 'ink');
    }
    if (this.cardTime > 0 && !this.layer.top) this.drawCard(def);
    if (this.toastTime > 0) this.drawToast();
    if (!this.layer.top && this.cardTime <= 0) {
      const hint = 'H HOW IT WORKS · T TWEAK · G ROOMS · ESC MENU';
      if (ui.measure(hint) < ui.w - 8) ui.mini(4, ui.h - 8, hint, 'mist', 'left', 'ink');
    }
    this.layer.draw(ui, ui.time);
  }

  private drawCard(def: RoomDef): void {
    const ui = this.ui;
    const w = Math.min(204, ui.w - 8);
    const inner = w - 12;
    const about = wrap(def.about.toUpperCase(), inner);
    const tries = def.try.slice(0, 2).flatMap((t) => wrap(`- ${t}`.toUpperCase(), inner));
    const room = Math.floor((ui.h - 60) / 9);
    const lines = [...about, ...(tries.length ? ['', ...tries] : [])].slice(0, Math.max(3, room));
    const h = 28 + lines.length * 9 + 12;
    const x = 4;
    const y = 4;
    const wg = wing(def.wing);
    ui.panel(x, y, w, h, 'ink', wg.color);
    ui.text(x + 6, y + 6, def.title.toUpperCase(), { color: wg.color });
    ui.mini(x + 6, y + 16, wg.title.toUpperCase(), 'slate');
    lines.forEach((l, i) => ui.text(x + 6, y + 26 + i * 9, l, { color: l.startsWith('- ') ? 'white' : 'mist' }));
    ui.mini(x + 6, y + h - 9, 'H HOW IT WORKS · I HIDE', 'sand');
  }

  private drawToast(): void {
    const ui = this.ui;
    const width = Math.min(300, ui.w - 16);
    const lines = wrap(this.toastText.toUpperCase(), width - 12).slice(0, 4);
    const h = lines.length * 9 + 8;
    const w = Math.min(width, Math.max(...lines.map((l) => ui.measure(l))) + 12);
    const x = Math.floor((ui.w - w) / 2);
    const y = ui.h - h - 14;
    ui.panel(x, y, w, h, 'ink', 'sand');
    lines.forEach((l, i) => ui.text(ui.w / 2, y + 5 + i * 9, l, { align: 'center', color: 'white' }));
  }

  private readonly tmp = new Vector3();

  private drawLabels(ctx: GameContext, room: RoomGame): void {
    const camera = ctx.camera.camera;
    const near = room.focusPoint();
    // the pad you stand nearest to (within 3 m) gets its full-size label
    let nearest: Label | null = null;
    let best = 9;
    for (const p of room.kit.pads) {
      const d = (p.at.x - near.x) ** 2 + (p.at.z - near.z) ** 2;
      if (d < best) {
        best = d;
        nearest = p.label;
      }
    }
    for (const l of room.kit.labels) {
      if (!l.visible || l === nearest) continue;
      this.drawLabel(l, near, camera, l.small);
    }
    if (nearest) this.drawLabel(nearest, near, camera, false);
  }

  private drawLabel(l: Label, near: Vector3, camera: Camera, small: boolean): void {
    if (!l.always && near.distanceTo(l.at) > l.range) return;
    const v = this.tmp.copy(l.at).project(camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
    const ui = this.ui;
    const x = Math.round(((v.x + 1) / 2) * ui.w);
    const y = Math.round(((1 - v.y) / 2) * ui.h);
    if (small) ui.mini(x, y - 2, l.text, l.color === 'white' ? 'mist' : l.color, 'center', 'ink');
    else ui.text(x, y - 4, l.text, { align: 'center', color: l.color, scale: l.scale });
  }
}

/** The one shell of the page. */
export const shell = new WorldShell();

/** A room as a `Game`: the hero, the room's build and logic, the shell's UI. */
export class RoomGame implements Game {
  readonly name: string;
  readonly assets: readonly string[];
  visitor: Visitor | null = null;
  logic: RoomLogic = {};
  kit!: RoomKit;
  ctx!: GameContext;
  private spawnAt: Vec3;
  private spawnFacing: number;
  private readonly input: MoveInput = moveInput();
  private readonly idle: MoveInput = moveInput();
  private readonly target = new Vector3();
  private disposed = false;
  private crushes = 0;

  constructor(
    readonly def: RoomDef,
    readonly arrivedFrom: string | null = null,
  ) {
    this.name = `Engine World: ${def.title}`;
    this.assets = [...(def.hero === false ? [] : [HERO_MODEL]), ...(def.assets ?? [])];
    this.spawnAt = def.spawn ?? [0, 0, 0];
    this.spawnFacing = def.facing ?? 0;
  }

  async setup(ctx: GameContext): Promise<void> {
    this.ctx = ctx;
    const e = ctx.engine;
    shell.attach(e);
    shell.room = this;
    shell.visited.add(this.def.id);
    e.setCamera(this.def.camera ?? WORLD_CAMERA, { syncUrl: false });
    ctx.scene.background = new Color(PALETTE[this.def.background ?? 'navy']);
    const host: KitHost = {
      runtime: () => this.runtime,
      padStepped: (pad) => this.padStepped(pad),
    };
    this.kit = new RoomKit(ctx, host);
    if (this.def.hero !== false) {
      this.visitor = await Visitor.load(ctx);
      if (this.disposed) return;
      ctx.scene.add(this.visitor.model, this.visitor.shadow);
    }
    this.logic = (await this.def.build(this.runtime)) ?? {};
    if (this.disposed) return;
    this.kit.finish();
    this.spawn();
    const look = this.def.look;
    if (look) e.setLook(typeof look === 'string' ? (LOOK_PRESETS[look] ?? e.look) : look);
    else if (shell.baseLook) e.setLook(shell.baseLook);
    shell.showCard(shell.visited.size <= 1 || this.arrivedFrom === null ? 14 : 8);
  }

  /** What the room's code sees. */
  readonly runtime: RoomRuntime = roomRuntime(this);

  private spawn(): void {
    this.placeHero(this.spawnAt, this.spawnFacing);
    this.ctx.camera.teleport(this.cameraTarget());
  }

  /** A hero body at `at` with the World's settings (the first spawn, and getting out of a vehicle). */
  placeHero(at: Vec3, facing: number): void {
    const v = this.visitor;
    if (!v) return;
    const hero = v.spawn(this.ctx.physics, at, { facing, lockDepth: this.ctx.camera.lockDepth });
    hero.shove = WORLD_SHOVE; // the hero brushes loose things aside: doors, bags, curtains, debris
    hero.weight = WORLD_WEIGHT; // and presses down what it stands on: bridges sag, spring pads sink
    v.model.visible = true;
  }

  /** The hero out of the world (in a vehicle): no body, hidden. */
  removeHero(): void {
    const v = this.visitor;
    if (!v) return;
    v.despawn();
    v.model.visible = false;
  }

  respawn(): void {
    this.visitor?.teleport(this.spawnAt, this.spawnFacing);
  }

  setSpawn(at: Vec3, facing?: number): void {
    this.spawnAt = at;
    if (facing !== undefined) this.spawnFacing = facing;
  }

  private padStepped(pad: Pad): void {
    const group = pad.def.group;
    for (const p of this.kit.pads) if (p !== pad && (group ? p.def.group === group : p.def.label === pad.def.label)) this.kit.lightPad(p, false);
    if (group) this.kit.lightPad(pad, true);
    pad.def.apply(this.runtime, pad);
    shell.toast(`${pad.def.label}: ${pad.def.note}`, 6);
    this.ctx.audio.play('pad');
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    const v = this.visitor;
    if (v?.hero) v.fixedUpdate(dt, shell.capturing || !ctx.camera.controlsCharacter ? this.idle : readMoveInput(ctx, v.hero, this.input));
    this.logic.fixedUpdate?.(dt);
  }

  update(ctx: GameContext, dt: number): void {
    shell.frame(ctx);
    const v = this.visitor;
    if (v) {
      v.update(dt, !ctx.camera.hidesTarget);
      if (v.position.y < -25) {
        this.respawn();
        ctx.audio.play('hurt');
      }
      // a platform came down on the hero: squashed, back to the start
      const crushes = v.hero?.stats.crushes ?? 0;
      if (crushes > this.crushes) {
        this.respawn();
        shell.toast('Squashed! Platforms that come down don\'t stop for anyone.', 4);
        ctx.audio.play('hurt');
        ctx.engine.shake.add(0.4);
      }
      this.crushes = crushes;
    }
    this.logic.update?.(dt);
    shell.draw(ctx, this);
  }

  /** Where labels measure "near" from: the hero, or what the camera follows. */
  focusPoint(): Vector3 {
    return this.visitor?.hero ? this.visitor.position : this.ctx.camera.focus;
  }

  cameraTarget(): Vector3 {
    const own = this.logic.cameraTarget?.();
    if (own) return this.target.copy(own);
    const p = this.visitor?.hero ? this.visitor.position : null;
    if (!p) return this.target.set(this.spawnAt[0], this.spawnAt[1] + 0.9, this.spawnAt[2]);
    return this.target.set(p.x, p.y + 0.9, p.z);
  }

  eyePosition(ctx: GameContext): Vector3 {
    return this.visitor?.hero ? this.visitor.hero.eye(ctx.physics.alpha) : this.cameraTarget();
  }

  onCameraChange(ctx: GameContext): void {
    this.visitor?.hero?.setLockDepth(ctx.camera.lockDepth);
  }

  status(): string {
    const own = this.logic.status?.() ?? '';
    const h = this.visitor?.hero;
    return [this.def.title, own, h ? `${h.state} (${h.anim})` : ''].filter(Boolean).join(' · ');
  }

  dispose(): void {
    this.disposed = true;
    this.logic.dispose?.();
    this.visitor?.despawn();
    shell.roomGone(this);
  }
}

/** The runtime a room's code sees, over its game. */
function roomRuntime(game: RoomGame): RoomRuntime {
  return {
    get ctx() {
      return game.ctx;
    },
    get kit() {
      return game.kit;
    },
    get def() {
      return game.def;
    },
    get arrivedFrom() {
      return game.arrivedFrom;
    },
    get hero() {
      return game.visitor;
    },
    toast: (text: string, seconds?: number) => shell.toast(text, seconds),
    goto: (id: string) => void shell.goto(id),
    setSpawn: (at: Vec3, facing?: number) => game.setSpawn(at, facing),
    respawn: () => game.respawn(),
    leaveWorld: () => game.removeHero(),
    enterWorld: (at: Vec3, facing?: number) => game.placeHero(at, facing ?? 0),
    get inputFree() {
      return !shell.capturing;
    },
  };
}

/** The most mass the hero shoves by walking into it (PlatformerCharacter.shove). */
export const WORLD_SHOVE = 1.5;
/** How hard the hero presses dynamic floors (PlatformerCharacter.weight, world mass units). */
export const WORLD_WEIGHT = 1;

/** The world's camera unless a room picks its own. */
export const WORLD_CAMERA = { preset: 'iso', pitch: 35, yaw: 45, viewHeight: 15, stiffness: 7, minZoom: 0.4, maxZoom: 3 } as const;
