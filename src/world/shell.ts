/**
 * The shell of Engine World: what lasts while rooms come and go (each room is its own
 * `Game`, loaded with `engine.loadGame`). It owns the UI (card, toasts, labels, panels),
 * the hotkeys, the room transitions and the list of visited rooms.
 *
 *   H · R3 / touchpad · ?   how it works (the station guide)
 *   T                       tweak: the room's and the engine's settings (and the player's)
 *   G · Create · GO         go to any room          I · a tap on it   the room's card again / away
 *   Esc · Options · ≡       menu (all of the above, the room card, field guide, back to the Atrium, reset)
 *
 * Every prompt names the control for the input used last (controls.ts `WORLD_CONTROLS`, the
 * rooms' `Game.controls`); Circle closes a panel, a sideways swipe too, and a swipe or a tap
 * sends the card and a toast away. On a phone the hero's buttons, the menu, the room list and
 * the guide are on screen, with up to three of the room's own (`RoomLogic.touch`).
 */
import { type Camera, Color, Vector3 } from 'three/webgpu';
import {
  type ControlTable,
  type Engine,
  FPS_OPTIONS,
  type Game,
  type GameContext,
  type HudColor,
  type InputDevice,
  KEYMAP,
  type Look,
  LOOK_PRESETS,
  MenuInput,
  type MoveInput,
  PALETTE,
  PIXEL_SIZES,
  QUALITY_OPTIONS,
  readMoveInput,
  TRANSITIONS,
  type TouchButtonState,
  type TransitionKind,
} from '../engine';
import { HERO_MODEL } from '../game/hero';
import { MENU_BINDINGS, ndcToArt, Pointer } from '../riftlight/game/controls';
import { inside, miniWidth, type Rect, UiCanvas, type UiEvent, wrap } from '../riftlight/ui/kit';
import { UiLayer } from '../riftlight/ui/layer';
import { HeldPresses } from '../riftlight/showcase/held';
import { moveInput, Visitor } from '../riftlight/showcase/visitor';
import { controlText, keyText, SHELL_PAD, touchStates, WORLD_CONTROLS, WORLD_KEYS, type WorldAction, worldTouchLayout } from './controls';
import { type KitHost, type Label, type Pad, RoomKit } from './kit/RoomKit';
import type { Knob, RoomDef, RoomLogic, RoomRuntime, Vec3 } from './types';
import { fieldGuide, guidePanel, pauseMenu, roomsMenu, tweakMenu } from './ui/panels';
import { wing } from './wings';

/** Keys the shell claims from the browser (F1 help, Tab focus). */
const SHELL_KEYS = ['F1', 'F2', 'Tab'];
const KEY = WORLD_KEYS;
/** The prompts along the bottom while nothing is open, most wanted first (a narrow screen drops from the end). */
const HINTS: Readonly<Record<'keyboard' | 'pad', readonly (readonly [WorldAction, string])[]>> = {
  keyboard: [
    ['menu', 'MENU'],
    ['guide', 'HOW IT WORKS'],
    ['rooms', 'ROOMS'],
    ['tweak', 'TWEAK'],
  ],
  pad: [
    ['menu', 'MENU'],
    ['guide', 'HOW IT WORKS'],
    ['rooms', 'ROOMS'],
  ],
};
const percent = (v: number) => `${Math.round(v * 100)}%`;
/** What the hero and the rooms read held (`KEYMAP`, `WORLD_KEYS`): a press of one a panel took stays the panel's while held (`WorldShell.held`). */
const HELD_CODES: readonly string[] = [...new Set<string>([...Object.values(KEYMAP).flat(), ...Object.values(WORLD_KEYS).flat()])];
/** A swipe this far across sends a panel away (the engine's convention: vertical ones scroll). */
const DISMISS = new Set(['left', 'right']);

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
  private readonly menuInput = new MenuInput(MENU_BINDINGS);
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
  /** Where the card and the toast were drawn last (a tap on one sends it away). */
  private cardRect: Rect | null = null;
  private toastRect: Rect | null = null;
  private lastNow = -1;
  /** Game speed while a modal panel froze the room. */
  private frozenSpeed: number | null = null;
  /** The last engine frame that began with a panel open or a room change under way (or whose click hid the card): its presses were theirs. */
  private swallowed = -1;
  /** Pointer buttons (`MouseLeft`, `Touch`...) whose press sent the card or a toast away: the shell's until they let go. */
  private readonly taken = new Set<string>();
  /** Pointer buttons pressed while a panel or a room change owned the input (a row, the close box): theirs until they let go. */
  private readonly panelHeld = new Set<string>();
  /** Keys and pad buttons pressed while a panel or a room change owned the input: theirs while held. */
  private readonly presses = new HeldPresses(HELD_CODES);
  /** The engine frame `begin` ran in. */
  private begun = -1;

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

  /** The toast on screen (its text with `{key:...}` filled in), or null. */
  get toastShown(): string | null {
    return this.toastTime > 0 ? keyText(this.engine, this.toastText) : null;
  }

  /** The room's card is on screen. */
  get cardShown(): boolean {
    return this.cardTime > 0;
  }

  /** `{key:action}` in the World's words, for the device in use. */
  keys(text: string): string {
    return keyText(this.engine, text);
  }

  /** True while the UI owns the keys (a panel is open or a room is changing). */
  get capturing(): boolean {
    return this.busy || !!this.layer.top;
  }

  /**
   * A room may read input itself (`RoomRuntime.inputFree`): nothing owns the keys, and nothing did
   * when this frame began. The press that closes a panel (Circle, Backspace, Esc, the key that
   * opened it) is the panel's: the Workshop must not also undo on it, nor the Gallery step.
   */
  get roomInputFree(): boolean {
    return !this.capturing && this.swallowed !== this.engine?.frame;
  }

  /**
   * A room may read the pointer's buttons itself (`RoomRuntime.pointerFree`): its input is free,
   * and no click or tap that sent the card or a toast away, or that a panel took (its row, its
   * close box), is still held. The Workshop must not place on the tap that hid the card or closed
   * the guide when it lifts, nor the Sandbox grab what was under the menu's Resume.
   */
  get roomPointerFree(): boolean {
    return this.roomInputFree && this.taken.size === 0 && this.panelHeld.size === 0;
  }

  /**
   * Held, as the hero and a room read a held key (`RoomRuntime.held`): any of `codes` down, but not
   * one still held from a press a panel took. The Circle that closed the guide never crouches the
   * hero, nor does the Cross that chose Resume pull the car's handbrake.
   */
  held(codes: readonly string[]): boolean {
    const input = this.engine?.input;
    return !!input && this.presses.held(input, codes);
  }

  /** The hero's held moves (`readMoveInput`'s) without a key or button a panel's press still holds. */
  heroHeld(m: MoveInput): MoveInput {
    return this.engine ? this.presses.mask(this.engine.input, m, KEYMAP) : m;
  }

  /**
   * Once a frame, before the room reads input (`RoomGame.fixedUpdate` calls it before the room's
   * step, `frame` too): a click or a tap on the card or a toast is the shell's (`claimPointer`).
   */
  begin(): void {
    const e = this.engine;
    if (!e || this.begun === e.frame) return;
    this.begun = e.frame;
    this.claimPointer(e);
  }

  /**
   * A click or a tap on the card or the toast sends it away, and the press is the shell's: taken
   * before the room reads this frame's input (`begin`), its queued press dropped, the rest of the
   * frame the shell's, and the button the shell's until it lets go (`roomPointerFree`). A press
   * while a panel or a room change owns the input is theirs until it lets go too (a menu row and
   * the close box act on the press, and the button is still down once the panel has gone). A press
   * anywhere else is the room's.
   */
  private claimPointer(e: Engine): void {
    const input = e.input;
    for (const b of input.buttonEvents) {
      if (!b.down) {
        this.taken.delete(b.code);
        this.panelHeld.delete(b.code);
        continue;
      }
      if (this.busy || this.layer.top) {
        this.panelHeld.add(b.code); // a panel's (frame hands it the pointer's events)
        continue;
      }
      const at = ndcToArt(e, b.x, b.y);
      if (!this.hideAt(at.x, at.y)) continue;
      this.taken.add(b.code);
      this.swallowed = e.frame;
      input.clearQueued(b.code);
    }
    // every button up (a release lost to a blur is one too)
    if (input.mouseButtons === 0) {
      this.taken.clear();
      this.panelHeld.clear();
    }
    // nor does a drag that started on the card turn the camera
    else if (this.taken.size) input.mouseDelta.x = input.mouseDelta.y = 0;
  }

  /** The card (else the toast) away when (x, y) in art pixels is on it, as drawn last. True if it was. */
  private hideAt(x: number, y: number): boolean {
    if (this.cardTime > 0 && this.cardRect && inside(this.cardRect, x, y)) this.cardTime = 0;
    else if (this.toastTime > 0 && this.toastRect && inside(this.toastRect, x, y)) this.toastTime = 0;
    else return false;
    return true;
  }

  // ------------------------------------------------------------------ panels

  openGuide(): void {
    const room = this.room;
    if (!room) return;
    this.layer.open(guidePanel(room.def, room.kit.pads, room.logic.knobs ?? [], (s) => this.keys(s)), { modal: false, dock: 'right', dim: false });
  }

  openTweak(): void {
    const room = this.room;
    if (!room || !this.engine) return;
    this.layer.open(
      tweakMenu(`Tweak: ${room.def.title}`, room.logic.knobs ?? [], this.engineKnobs(), () => this.layer.close('tweak'), () => this.keys('{key:change} change · {key:back} closes'), () => this.resetSettings()),
      { modal: false, dock: 'right', dim: false },
    );
  }

  /**
   * " (H)": the control that opens `action` on the device in use, for a menu row; nothing where
   * the menu is that control (Tweak on a pad or a phone lives in this menu).
   */
  private tag(action: WorldAction): string {
    const e = this.engine;
    if (!e) return '';
    const c = WORLD_CONTROLS[action] as { key: string; pad?: string; touch?: string };
    const d = e.controls.device;
    if ((d === 'pad' && (!c.pad || c.pad === 'PadStart')) || (d === 'touch' && (!c.touch || c.touch === '≡'))) return '';
    return ` (${controlText(e, action)})`;
  }

  /** The menu's way to Riftlight: the same page without ?game (Riftlight is the default), other URL options kept. Headless: nothing (no page to leave). */
  toRiftlight(): void {
    if (typeof location === 'undefined') return;
    const u = new URL(location.href);
    u.searchParams.delete('game');
    u.searchParams.delete('room');
    location.assign(u.toString());
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
        // the room card away or back (a pad has no button for it: here it is)
        card: () => (close(), this.toggleCard()),
        glossary: () => (close(), this.openGlossary()),
        atrium: () => void this.leave(),
        reset: () => void this.reset(),
        riftlight: () => this.toRiftlight(),
      }, { guide: this.tag('guide'), tweak: this.tag('tweak'), rooms: this.tag('rooms'), card: this.engine?.controls.device === 'keyboard' ? this.tag('card') : '' }, this.cardTime > 0),
      { modal: true, onClose: () => this.unfreeze() },
    );
    this.freeze();
  }

  openGlossary(): void {
    this.layer.open(fieldGuide((s) => this.keys(s), this.engine?.controls.device === 'touch'), { modal: false, dock: 'right', dim: false });
  }

  showCard(seconds = 14): void {
    this.cardTime = seconds;
  }

  /** The room's card away, or back for 30 s (I, the menu's Room card). */
  toggleCard(): void {
    this.cardTime = this.cardTime > 0 ? 0 : 30;
  }

  /**
   * The engine's own settings, under the room's in the tweak panel. Look, pixel art, pixel size,
   * quality, frame rate, the volumes, the controller's buttons, vibration and debug info are the
   * player's (`engine.settings` and the audio's volumes, the same as the ⚙ panel's): saved, and a
   * chosen look wins over every room's own. The World has no ⚙, so all of them are here.
   */
  engineKnobs(): Knob[] {
    const e = this.engine!;
    const looks = Object.keys(LOOK_PRESETS);
    const cams = ['iso', 'topdown', 'side', 'third', 'first', 'free'] as const;
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
        options: ["the room's", ...looks.map((n) => n.replace(/_/g, ' '))],
        get: () => looks.indexOf(e.settings.values.look ?? '') + 1, // 0: none chosen, the room's own
        set: (i) => e.settings.set({ look: i ? looks[i - 1]! : undefined }),
      },
      {
        kind: 'choice',
        id: 'engine-camera',
        label: 'Camera',
        options: cams,
        get: () => Math.max(0, cams.indexOf(e.camera.preset as (typeof cams)[number])),
        set: (i) => void e.setCamera({ preset: cams[i]! }, { syncUrl: false }),
      },
      { kind: 'toggle', id: 'engine-pixel', label: 'Pixel art', get: () => e.renderer.mode === 'pixel', set: (v) => e.settings.set({ pixelArt: v }) },
      // the room's own art resolution is fine; chunky halves it
      { kind: 'choice', id: 'engine-pixel-size', label: 'Pixel size', options: PIXEL_SIZES, get: () => PIXEL_SIZES.indexOf(e.settings.values.pixelSize ?? 'fine'), set: (i) => e.settings.set({ pixelSize: PIXEL_SIZES[i]! }) },
      // auto: the device's level (measured at start-up), as the page started; a level is the player's
      { kind: 'choice', id: 'engine-quality', label: 'Quality', options: QUALITY_OPTIONS, get: () => Math.max(0, QUALITY_OPTIONS.indexOf(e.settings.values.quality ?? e.qualityOption)), set: (i) => e.settings.set({ quality: QUALITY_OPTIONS[i]! }) },
      { kind: 'choice', id: 'engine-fps', label: 'Frame rate', options: FPS_OPTIONS.map((f) => (f ? `${f} fps` : 'screen')), get: () => Math.max(0, FPS_OPTIONS.indexOf(e.maxFps)), set: (i) => e.settings.set({ fps: FPS_OPTIONS[i]! }) },
      { kind: 'choice', id: 'engine-transition', label: 'Room change', options: TRANSITIONS, get: () => TRANSITIONS.indexOf(this.transition), set: (i) => (this.transition = TRANSITIONS[i]!) },
      { id: 'engine-shake', label: 'Screen shake', min: 0, max: 2, step: 0.1, initial: 1, get: () => e.shake.strength, set: (v) => (e.shake.strength = v) },
      { kind: 'toggle', id: 'engine-sound', label: 'Sound', get: () => !e.audio.muted, set: (v) => e.audio.setMuted(!v) },
      // the player's own, saved: the ⚙ panel's on a page that has one (the World shows these here, on every device)
      { id: 'engine-volume', label: 'Volume', min: 0, max: 1, step: 0.05, get: () => e.audio.volume.master, set: (v) => e.audio.setVolume('master', v), format: percent },
      { id: 'engine-music', label: 'Music', min: 0, max: 1, step: 0.05, get: () => e.audio.volume.music, set: (v) => e.audio.setVolume('music', v), format: percent },
      { id: 'engine-effects', label: 'Effects', min: 0, max: 1, step: 0.05, get: () => e.audio.volume.sfx, set: (v) => e.audio.setVolume('sfx', v), format: percent },
      { kind: 'choice', id: 'engine-buttons', label: 'Controller', options: ['PlayStation', 'Xbox'], get: () => (e.settings.values.padGlyphs === 'xbox' ? 1 : 0), set: (i) => e.settings.set({ padGlyphs: i ? 'xbox' : undefined }), hint: 'The buttons prompts show on a controller.' },
      { id: 'engine-vibration', label: 'Vibration', min: 0, max: 1, step: 0.05, get: () => e.settings.values.vibration ?? 1, set: (v) => e.settings.set({ vibration: v >= 1 ? undefined : v }), format: percent },
      { kind: 'toggle', id: 'engine-debug', label: 'Debug info', get: () => e.debugShown, set: (v) => e.settings.set({ debugInfo: v }), hint: 'The engine\'s panel: renderer, resolution, camera, frame rate, the room\'s state.' },
    ];
  }

  /** The player's settings and volumes back to the game's (Tweak's Reset settings row, as the ⚙ panel's Reset). */
  resetSettings(): void {
    const e = this.engine;
    if (!e) return;
    e.settings.reset();
    e.audio.resetVolumes();
  }

  /**
   * A modal panel stops the room (game speed 0) until it closes, and a DualSense's triggers let go
   * meanwhile, as in the engine's pause (the car's gas and brake push back only while you drive).
   */
  private freeze(): void {
    const e = this.engine;
    if (!e || this.frozenSpeed !== null) return;
    this.frozenSpeed = e.timeScale;
    e.timeScale = 0;
    e.dualsense.hold(true);
  }

  private unfreeze(): void {
    const e = this.engine;
    if (!e || this.frozenSpeed === null) return;
    if (this.layer.stack.some((o) => o.modal)) return;
    e.timeScale = this.frozenSpeed;
    this.frozenSpeed = null;
    e.dualsense.hold(e.paused); // the engine's own pause, if any, keeps them let go
  }

  /**
   * A room's level starts (`RoomGame.setup`, a replay's too): nothing the last one held is still the
   * shell's or a panel's (no click that sent a card away, no press a panel took), and no card or
   * toast drawn before it can take this level's first click. A recording starts from nothing held.
   */
  roomStarted(): void {
    this.taken.clear();
    this.panelHeld.clear();
    this.presses.clear();
    this.swallowed = -1;
    this.begun = -1;
    this.cardRect = this.toastRect = null;
  }

  /** Room unloaded: panels about it go, a frozen room thaws. */
  roomGone(room: RoomGame): void {
    if (this.room !== room) return;
    this.layer.closeAll();
    this.toastTime = 0;
    if (this.engine && this.frozenSpeed !== null) {
      this.engine.timeScale = this.frozenSpeed;
      this.engine.dualsense.hold(this.engine.paused);
    }
    this.frozenSpeed = null;
    this.room = null;
  }

  // ------------------------------------------------------------------ per frame

  /**
   * UI input and hotkeys (from the room's `update`; `dt`: its game seconds). The card and a toast
   * count down on the frame's recorded time, unscaled (`shownTime`), so whether one is still up to
   * take a click or a tap is input-derived and a replay agrees at any live frame rate; the panels'
   * animations and key repeat run on real time, also while a menu freezes the room.
   */
  frame(ctx: GameContext, dt: number): void {
    const e = ctx.engine;
    const now = performance.now() / 1000; // real time: UI timers run while the game is paused
    const real = e.manual ? 1 / 60 : this.lastNow < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const shown = shownTime(dt, e.timeScale);
    this.cardTime = Math.max(0, this.cardTime - shown);
    this.toastTime = Math.max(0, this.toastTime - shown);
    const input = ctx.input;
    this.begin(); // a click on the card is the shell's (once a frame: a fixed step may have run it)
    const hadPanel = !!this.layer.top;
    // the rest of this frame's input is the panel's (or the room change's), even once it closes
    if (hadPanel || this.busy) this.swallowed = e.frame;
    const events = [...(this.pointer?.frame(real) ?? []), ...this.menuInput.events(input, real)];
    const ui = this.ui;
    ui.time += real;
    ui.device = e.controls.device; // prompts follow the input used last, in the player's button style
    ui.padStyle = e.controls.style;
    if (this.pointer) {
      ui.pointer.x = this.pointer.art.x;
      ui.pointer.y = this.pointer.art.y;
      ui.pointer.used = this.pointer.idle < 4 && !this.pointer.touch;
    }
    this.layer.update(real);
    // keys pressed for a panel (Space, J, F confirm) must not reach the hero when it closes, nor
    // while they are held after (Circle's crouch, Cross's handbrake)
    if (hadPanel || this.busy) this.presses.take(input);
    this.syncTouch(hadPanel);
    if (hadPanel) {
      const top = this.layer.top!.panel.id;
      // the key that opened a panel closes it again
      const toggles: Record<string, readonly string[]> = { guide: KEY.guide, tweak: KEY.tweak, rooms: KEY.rooms, glossary: KEY.guide, pause: KEY.menu };
      if (toggles[top] && input.wasPressed(...toggles[top]!)) {
        this.layer.close(top);
        return;
      }
      for (const ev of events) {
        if (ev.kind === 'key') continue;
        // a sideways flick sends the panel away (Circle's back on a phone); an up or down one scrolls
        this.layer.input(ev.kind === 'swipe' && DISMISS.has(ev.dir) ? { kind: 'back' } : ev);
      }
      return;
    }
    if (this.busy) return;
    this.dismiss(events);
    if (input.wasPressed(...KEY.guide)) this.openGuide();
    else if (input.wasPressed(...KEY.tweak)) this.openTweak();
    else if (input.wasPressed(...KEY.rooms)) this.openRooms();
    else if (input.wasPressed(...KEY.menu)) this.openPause();
    else if (input.wasPressed(...KEY.card)) this.toggleCard();
  }

  /** A swipe sends the card (else the toast) away; the room under them plays on (a tap or a click on one: `claimPointer`). */
  private dismiss(events: readonly UiEvent[]): void {
    for (const ev of events) {
      if (ev.kind !== 'swipe') continue;
      if (this.cardTime > 0) this.cardTime = 0;
      else this.toastTime = 0;
    }
  }

  /**
   * The phone's buttons for this frame: hidden while a panel or a room change owns the screen;
   * otherwise the World's own (`WORLD_TOUCH_BUTTONS`) as the room wants them (`RoomLogic.touch`:
   * a base button relabelled or hidden, a slot with the room's action).
   */
  private syncTouch(panel: boolean): void {
    const show = !panel && !this.busy;
    const states = touchStates(this.room?.logic.touch?.() ?? {});
    this.touchShown = show ? states : null; // where a page would show them, for the HUD without one (`touchBoxes`)
    const touch = this.engine?.touch;
    if (!touch) return;
    if (touch.visible !== show) touch.show(show);
    if (!show) return;
    for (const [code, s] of Object.entries(states)) touch.set(code, s);
  }

  /** The phone's buttons as `syncTouch` showed them this frame, or null while a panel or a room change hides them. */
  private touchShown: Readonly<Record<string, TouchButtonState>> | null = null;

  /**
   * The phone's controls on screen, in art pixels, each `high` when it is along the top (≡ GO ?):
   * where the page lays them out (`touch.rects()`), or, without a page (headless, a replay of a
   * phone's recording), where their data puts them (`worldTouchLayout`) while a page would show
   * them (touch controls on, a finger the device in use, no panel or room change). None otherwise.
   * The HUD (the card, the title, a room's line and panels) keeps clear of them.
   */
  touchBoxes(): (Rect & { high: boolean })[] {
    const e = this.engine;
    if (!e) return [];
    const h = e.hud.height;
    const out: (Rect & { high: boolean })[] = [];
    const touch = e.touch;
    if (touch) {
      if (!touch.visible || !this.pointer) return out;
      const c = touch.rects();
      for (const r of [c.stick, ...c.buttons.filter((b) => !b.hidden).map((b) => b.rect)]) {
        if (!r || r.width <= 0 || r.height <= 0) continue;
        const a = this.pointer.toArt(r.left, r.top);
        const b = this.pointer.toArt(r.right, r.bottom);
        if (a.x < 0 && b.x < 0) continue; // no canvas laid out yet
        out.push({ x: a.x, y: a.y, w: b.x - a.x + 1, h: b.y - a.y + 1, high: a.y < h / 3 });
      }
      return out;
    }
    if (!e.controls.touch || e.input.device !== 'touch' || !this.touchShown) return out;
    const { width, height } = e.renderer.viewport;
    const f = e.renderer.framing;
    const ax = (x: number) => Math.floor(((x - f.offsetX) / f.cssWidth) * f.artWidth);
    const ay = (y: number) => Math.floor(((y - f.offsetY) / f.cssHeight) * f.artHeight);
    for (const c of worldTouchLayout(width, height, this.touchShown)) {
      const x = ax(c.x);
      const y = ay(c.y);
      out.push({ x, y, w: ax(c.x + c.w) - x + 1, h: ay(c.y + c.h) - y + 1, high: y < h / 3 });
    }
    return out;
  }

  /**
   * The lowest art row a HUD block across columns `x0`..`x1` can reach: over the phone's controls
   * along the bottom that share its columns (`touchBoxes`), else the screen's last row.
   */
  floor(x0: number, x1: number): number {
    let floor = this.engine?.hud.height ?? 0;
    for (const b of this.touchBoxes()) if (!b.high && b.x + b.w > x0 && b.x < x1) floor = Math.min(floor, b.y - 2);
    return floor;
  }

  /**
   * Where a room's lines of HUD text start (`RoomRuntime.lineTop`): the top of the first of `rows`
   * rows from the left edge, `width` art pixels wide, at the bottom left over the shell's prompts,
   * and over a phone's joystick and buttons where they share its columns.
   */
  lineTop(width: number, rows = 1): number {
    const h = this.engine?.hud.height ?? 0;
    return Math.min(h - 24, this.floor(4, 4 + width) - 9) - (rows - 1) * 9;
  }

  /**
   * A room's line of HUD text (what it counts, the state it is in: `RoomRuntime.hudLine`), at
   * `lineTop`, wrapped to the screen's width (a phone held upright has 130 columns). Returns its top.
   */
  hudLine(text: string, color: HudColor): number {
    const hud = this.engine?.hud;
    if (!hud) return 0;
    const rows = wrap(text, hud.width - 8);
    const top = this.lineTop(Math.max(0, ...rows.map((r) => hud.measure(r).width)), rows.length);
    rows.forEach((r, i) => hud.text(4, top + i * 9, r, { color }));
    return top;
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
      const { y } = this.titleRect(def);
      ui.text(ui.w - 4, y, title, { align: 'right', color: 'white' });
      ui.mini(ui.w - 4, y + 9, w.title.toUpperCase(), w.color, 'right', 'ink');
    }
    const device = this.engine?.controls.device ?? 'keyboard';
    this.cardRect = this.cardTime > 0 && !this.layer.top ? this.drawCard(def, device) : null;
    this.toastRect = this.toastTime > 0 ? this.drawToast(device) : null;
    // the controls along the bottom (a phone's buttons are its prompts)
    if (!this.layer.top && this.cardTime <= 0 && device !== 'touch') this.promptRow(5, ui.h - 11, HINTS[device], ui.w - 10, 'mist', true);
    this.layer.draw(ui, ui.time);
  }

  /** Prompts in a row from (x, y), the glyph of each control then its words; as many as fit `width`. Returns the width drawn. */
  private promptRow(x: number, y: number, items: readonly (readonly [WorldAction, string])[], width: number, color: HudColor = 'mist', back = false): number {
    const hud = this.ui.hud;
    const GAP = 8;
    const fit: [WorldAction, string, number][] = [];
    let used = 0;
    for (const [action, label] of items) {
      const w = hud.glyphWidth(action) + 3 + hud.measure(label).width;
      if (used + w > width) break;
      fit.push([action, label, used]);
      used += w + GAP;
    }
    const total = Math.max(0, used - GAP);
    // on an ink strip: it reads over any floor, at ten feet too
    if (back && total > 0) hud.rect(x - 3, y - 3, total + 6, 13, 'ink');
    for (const [action, label, at] of fit) hud.prompt(x + at, y, action, label, { color, shadow: back ? false : 'ink' });
    return total;
  }

  /**
   * Where the room's title and its wing go (top right): under a phone's top-left buttons when it
   * would run into them (a long title on a narrow screen). A room's panel along the top keeps clear
   * of it (`RoomRuntime.hudTop`).
   */
  titleRect(def: RoomDef): Rect {
    const ui = this.ui;
    const title = def.title.toUpperCase();
    const w = Math.max(ui.measure(title), miniWidth(wing(def.wing).title.toUpperCase()));
    const corner = this.touchCorner();
    const y = ui.w - 4 - ui.measure(title) < corner.right + 4 ? corner.bottom + 1 : 4;
    return { x: ui.w - 4 - w, y, w, h: 16 };
  }

  /**
   * The first art row a panel along the top left, `width` art pixels wide, may use: under a
   * phone's ≡ GO ?, and under the room's title where the title came down under them into its
   * columns (a phone held upright). 1 on a screen without either in its way.
   */
  hudTop(width: number): number {
    const room = this.room;
    let top = Math.max(1, this.touchCorner().bottom + 1);
    if (room && this.cardTime <= 0 && !this.layer.top) {
      const t = this.titleRect(room.def);
      if (t.y > 4 && t.x < 1 + width) top = Math.max(top, t.y + t.h + 2);
    }
    return top;
  }

  /**
   * Where the top-left touch buttons (≡ GO ?) end, in art pixels (`touchBoxes`): the card and a
   * room's panel along the top (`RoomRuntime.hudTop`) start under them and a long title keeps clear.
   * Zero without touch controls on screen.
   */
  touchCorner(): { right: number; bottom: number } {
    const out = { right: 0, bottom: 0 };
    const w = this.engine?.hud.width ?? 0;
    for (const b of this.touchBoxes()) {
      if (!b.high || b.x > w / 2) continue;
      out.right = Math.max(out.right, b.x + b.w - 1);
      out.bottom = Math.max(out.bottom, b.y + b.h + 1);
    }
    return out;
  }

  /** The room's card (top left: what it shows, what to try), as tall as the screen has room for. Returns its rect. */
  private drawCard(def: RoomDef, device: InputDevice): Rect {
    const ui = this.ui;
    const w = Math.min(204, ui.w - 8);
    const inner = w - 12;
    const x = 4;
    const y = Math.max(4, this.touchCorner().bottom + 1);
    const about = wrap(this.keys(def.about).toUpperCase(), inner);
    const tries = def.try.slice(0, 2).flatMap((t) => wrap(`- ${this.keys(t)}`.toUpperCase(), inner));
    // at most half the screen on a phone (the room stays in view under it); a tall screen gets it all
    const room = Math.floor((Math.min(ui.h - 60, Math.max(ui.h * 0.5, 120)) - y) / 9);
    const lines = [...about, ...(tries.length ? ['', ...tries] : [])].slice(0, Math.max(3, room));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const h = 28 + lines.length * 9 + 14;
    const wg = wing(def.wing);
    ui.panel(x, y, w, h, 'ink', wg.color);
    ui.text(x + 6, y + 6, def.title.toUpperCase(), { color: wg.color });
    ui.mini(x + 6, y + 16, wg.title.toUpperCase(), 'slate');
    lines.forEach((l, i) => ui.text(x + 6, y + 26 + i * 9, l, { color: l.startsWith('- ') ? 'white' : 'mist' }));
    // a pad hides it in the menu: Options, then its room card row (`card`'s pad is the menu's)
    const foot: [WorldAction, string][] = device === 'touch' ? [['card', 'TO HIDE'], ['guide', 'HOW IT WORKS']] : [['guide', 'HOW IT WORKS'], ['card', 'HIDE']];
    this.promptRow(x + 6, y + h - 11, foot, w - 12, 'sand');
    return { x, y, w, h };
  }

  /** The toast (bottom middle, over the prompts). Returns its rect. */
  private drawToast(device: InputDevice): Rect {
    const ui = this.ui;
    const width = Math.min(300, ui.w - 16);
    const lines = wrap(this.keys(this.toastText).toUpperCase(), width - 12).slice(0, 4);
    const h = lines.length * 9 + 8;
    const w = Math.min(width, Math.max(...lines.map((l) => ui.measure(l))) + 12);
    const x = Math.floor((ui.w - w) / 2);
    // on a phone over the controls' row (the joystick and the buttons fill the bottom corners)
    const y = ui.h - h - (device === 'touch' ? Math.min(Math.floor(ui.h * 0.3), 90) : 14);
    ui.panel(x, y, w, h, 'ink', 'sand');
    lines.forEach((l, i) => ui.text(ui.w / 2, y + 5 + i * 9, l, { align: 'center', color: 'white' }));
    return { x, y, w, h };
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
    const text = this.keys(l.text).toUpperCase();
    if (small) ui.mini(x, y - 2, text, l.color === 'white' ? 'mist' : l.color, 'center', 'ink');
    else {
      // kept on screen: a label wider than the screen (a phone in portrait) wraps, one near an edge slides in
      const scale = l.scale ?? 1;
      const rows = wrap(text, ui.w - 8, scale);
      const half = Math.max(...rows.map((r) => ui.measure(r) * scale)) / 2;
      const cx = Math.min(ui.w - 4 - half, Math.max(4 + half, x));
      rows.forEach((r, i) => ui.text(cx, y - 4 - (rows.length - 1 - i) * 9 * scale, r, { align: 'center', color: l.color, scale: l.scale }));
    }
  }
}

/** The one shell of the page. */
export const shell = new WorldShell();

/** A room as a `Game`: the hero, the room's build and logic, the shell's UI. */
export class RoomGame implements Game {
  readonly name: string;
  readonly assets: readonly string[];
  /** The World's actions and their keys, pad buttons and touch buttons (with the room's own names, `RoomDef.controls`): what prompts and `{key:action}` name. */
  readonly controls: ControlTable;
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
    this.controls = def.controls ? { ...WORLD_CONTROLS, ...def.controls } : WORLD_CONTROLS;
    this.assets = [...(def.hero === false ? [] : [HERO_MODEL]), ...(def.assets ?? [])];
    this.spawnAt = def.spawn ?? [0, 0, 0];
    this.spawnFacing = def.facing ?? 0;
  }

  /** The room and the door it was entered by (`Game.args`): a recording of it rebuilds the same room. */
  get args(): { room: string; from: string | null } {
    return { room: this.def.id, from: this.arrivedFrom };
  }

  async setup(ctx: GameContext): Promise<void> {
    this.ctx = ctx;
    const e = ctx.engine;
    shell.attach(e);
    shell.roomStarted();
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
    // longer on a fresh start (no door behind it): by the recorded args alone, so a replay shows it as long
    shell.showCard(this.arrivedFrom === null ? 14 : 8);
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
    if (pad.def.enabled?.() === false) return;
    const group = pad.def.group;
    for (const p of this.kit.pads) if (p !== pad && (group ? p.def.group === group : p.def.label === pad.def.label)) this.kit.lightPad(p, false);
    if (group) this.kit.lightPad(pad, true);
    pad.def.apply(this.runtime, pad);
    if (!pad.def.quiet) shell.toast(`${pad.def.label}: ${pad.def.note}`, 6);
    this.ctx.audio.play('pad');
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    const v = this.visitor;
    // Create, R3 and the touchpad are the shell's (rooms, the guide), a room's own pad buttons
    // its own: the hero never waves on Create or lies down on the Gallery's R1
    ctx.input.clearQueued(...SHELL_PAD, ...(this.logic.claims ?? []));
    // a click or a tap on the card or a toast is the shell's, before the room's step reads the pointer
    shell.begin();
    if (v?.hero) v.fixedUpdate(dt, shell.capturing || !ctx.camera.controlsCharacter ? this.idle : shell.heroHeld(readMoveInput(ctx, v.hero, this.input)));
    this.logic.fixedUpdate?.(dt);
  }

  update(ctx: GameContext, dt: number): void {
    shell.frame(ctx, dt);
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
    hudLine: (text: string, color: HudColor) => shell.hudLine(text, color),
    lineTop: (width: number, rows?: number) => shell.lineTop(width, rows),
    hudFloor: (x0: number, x1: number) => shell.floor(x0, x1),
    hudTop: (width: number) => shell.hudTop(width),
    touchBoxes: () => shell.touchBoxes(),
    goto: (id: string) => void shell.goto(id),
    setSpawn: (at: Vec3, facing?: number) => game.setSpawn(at, facing),
    respawn: () => game.respawn(),
    leaveWorld: () => game.removeHero(),
    enterWorld: (at: Vec3, facing?: number) => game.placeHero(at, facing ?? 0),
    get inputFree() {
      return shell.roomInputFree;
    },
    get pointerFree() {
      return shell.roomPointerFree;
    },
    held: (...codes: string[]) => shell.held(codes),
  };
}

/**
 * The seconds the card and a toast count down this frame: the frame's game seconds unscaled (the
 * recorded frame's real `dt` less a hitstop), so slow motion doesn't hold them up, and nothing
 * while a menu freezes the room (speed 0). Input-derived: the same frames count the same in a replay.
 */
export function shownTime(dt: number, timeScale: number): number {
  return timeScale > 0 ? dt / timeScale : 0;
}

/** The most mass the hero shoves by walking into it (PlatformerCharacter.shove). */
export const WORLD_SHOVE = 1.5;
/** How hard the hero presses dynamic floors (PlatformerCharacter.weight, world mass units). */
export const WORLD_WEIGHT = 1;

/** The world's camera unless a room picks its own. */
export const WORLD_CAMERA = { preset: 'iso', pitch: 35, yaw: 45, viewHeight: 15, stiffness: 7, minZoom: 0.4, maxZoom: 3 } as const;
