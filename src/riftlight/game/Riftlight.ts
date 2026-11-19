/**
 * Riftlight: the game shell. One `Game` that owns the flow
 *
 *   title ─▶ town ─▶ (rift keeper) ─▶ level ─▶ clear ─▶ loot window ─▶ portal ─▶ town ─▶ …
 *                                       └──▶ death ─▶ recap ─▶ town (XP / gold penalty)
 *
 * and everything around it: save slots, the difficulty sliders, settings, the HUD and
 * menus, the camera, music, the dev tools and the agent API. Gameplay systems plug in
 * through ports (game/ports.ts), implemented on the real systems in src/riftlight/wire.
 *
 * Stages swap inside this one Game instead of through `engine.loadGame`: the town is built
 * once and hidden while a level runs, the hero, its model and clips, the HUD, the light
 * pool and the music survive, and a level is just a root object the shell adds and
 * disposes. `loadGame` would rebuild and re-upload all of that on every trip to town.
 */
import { type Camera, Color, Vector3 } from 'three/webgpu';
import { chooseLanguage, defaultLook, GAMEPAD_BUTTONS, type Game, type GameContext, type Look, LOOK_PRESETS, lookPresetOf, looksEqual, MAX_PADS, MenuInput, PALETTE, pageLanguageSources, type PaletteColor, rebindDebugKeys, SWIPE_KEYS, type SwipeDirection, TOUCH_KEY, wrapText } from '../../engine';
import { HERO_MODEL } from '../../game/hero';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { RANK, SCALING } from '../core/scaling';
import { type ActorLike, DAMAGE_COLORS, type DifficultyTuning, dominantType, type GameEvents, type LevelSpec, type SaveData } from '../core/types';
import { loadRiftlightPacks } from '../packs';
import { type Interactable, Town, type TownState } from '../town/Town';
import { type HudModel, drawHud, drawMap, type FeedLine, hudBoxes, hudGeometry, mapView, type MinimapModel } from '../ui/hud';
import { BannerQueue, type Box, HudLayout, overlaps } from '../ui/layout';
import { clip, inside, miniCovers, miniWidth, type UiCanvas, UiCanvas as Canvas, type UiEvent } from '../ui/kit';
import { tapArt, UiLayer } from '../ui/layer';
import { drawPageStrip, LEGEND_ROOM, type PageStrip, pagesLegend } from '../ui/legend';
import { drawLogo, drawRift, logoScale } from '../ui/logo';
import type { Menu } from '../ui/menu';
import { type LookHost, lookStudio } from '../ui/lookStudio';
import { devMenu, type MenuHost, pauseMenu, riftMenu, settingsMenu, slotsMenu, titleMenu, tuningMenu } from '../ui/menus';
import { CharacterSheet, Codex, DeathRecap, dialogue, LootWindow, talkPlace, type TalkPlace, talkSeconds } from '../ui/panels';
import { talkText } from '../town/npcs';
import { beacon, bubble, Floaters, hitbox, lootLabel, thingLabel, worldBox } from '../ui/world';
import { installApi } from './api';
import { registerAudio, SONGS, type SongName } from './audio';
import { cameraBasis, CONTROLS, type ControlDevice, KEYS, MOUSE, ndcToArt, type Page, PAGES, Pointer, type PointerState, readActions, SHELL_MENU_BINDINGS, touchpadSwipes } from './controls';
import { changedSliders, difficultyLineId, difficultyMods, sanitizeTuning } from './difficulty';
import { registerFx } from './fx';
import { LightPool } from './lights';
import { HeroWalk, type HeroWalkState } from './walk';
import { LEVEL_GAP, lightFor, PadFeel, RUMBLE } from './padFeel';
import { type DevFlags, type HeroIntent, type HeroPort, ITEM_GROUP, type LevelHandle, type MonsterHandle, type Panel, type PanelHost, type RiftlightPorts, type ShellServices, type WorldLoot } from './ports';
import { addGemXp } from '../loot/sockets';
import { addXp, applyDeath, emptyStats, formatTime, killXp, levelTitle, recordClear, unlockedDepths, xpFraction } from './progress';
import { RecapTracker, type RecapState } from './recap';
import { newSave, SaveStore, type SavesView, viewRemoved, viewSaved } from './save';
import { loadSettings, playSettings, type Settings, storeSettings } from './settings';
import { corePorts } from '../wire';
import { realLootPort } from '../wire/loot';
import { realTreePort } from '../wire/tree';
import { Showcase } from '../showcase/Showcase';
import { TouchPad } from './touch';
import { Actor, actorIds, setActorIds } from '../actors/Actor';
import { AIM, attackReach, autoAim, coneTarget, stickAim, TOUCH_AIM, turnOnScreen } from '../actors/aim';
import { COOP, type CoopView, HEAD, LocalCoop, TAG_AT } from './coop';
import { PropTarget } from '../levels/mechanics/common';
import { HubSession } from '../../engine';
import { type RoundCommand, type RoundHost, type RoundMode, SessionRound } from '../session/round';
import { GhostMode, type GhostHost } from '../session/ghosts';
import { type MomentSpec, momentSpot } from '../session/moments';
import { ClientWorld, HostWorld, type SharedShell } from '../session/shared';
import { LevelStage } from '../wire/levels';
import { lang, pageLanguage, t } from '../lang';
import { mechanicName } from '../lang/levels';
import { gemName, itemLabel } from '../loot/names';

export type Screen = 'title' | 'town' | 'level' | 'loading';

/**
 * Camera framing per stage (zoom on the iso preset; the settings zoom multiplies it), the aim
 * lead, and `portrait`: a screen taller than wide (a phone in portrait, 124 art pixels across)
 * zooms out by this much so the fight around the hero fits.
 */
export const CAMERA = { title: 1.0, town: 1.22, level: 1.08, lead: 0.22, leadMax: 1.6, portrait: 0.8 } as const;

/** A moment's spot to escape to is reached this close (metres), shown as a ring that wide. */
const MOMENT_REACH = 1.5;

interface MutableIntent {
  move: { x: number; z: number };
  aim: Vector3;
  attack: boolean;
  skill: number;
  dodge: boolean;
  held: number;
}

export class Riftlight implements Game, MenuHost, LookHost, RoundHost, GhostHost, SharedShell {
  readonly name = 'Riftlight';
  /** Its actions' keys, pad buttons and touch buttons: the engine names them in every `{key:action}` and prompt, for the device in use. */
  readonly controls = CONTROLS;
  readonly assets = [HERO_MODEL, 'assets/tree.glb'];
  readonly ports: RiftlightPorts;
  readonly events = new EventBus<GameEvents>();
  readonly store: SaveStore;
  /** The slots as the game knows them (menus, Continue): read once and recorded, then kept by its own saves. */
  saves: SavesView;
  /** The settings and slots sent at setup (`command` keeps them only if nothing changed them before the first frame). */
  private sentAtSetup = { settings: '', saves: '' };
  readonly settings: Settings = loadSettings();
  readonly dev: DevFlags = { god: false, ai: true, hitboxes: false };
  slot = 0;
  save: SaveData = newSave(1);
  screen: Screen = 'title';
  ctx!: GameContext;
  services!: ShellServices;
  lights!: LightPool;
  town!: Town;
  hero!: HeroPort;
  level: LevelHandle | null = null;
  /** The arcade, the Hall of Beasts and photo mode (showcase/): they own the frame while active. */
  showcase!: Showcase;
  readonly layer = new UiLayer();
  ui!: UiCanvas;
  pointer!: Pointer;
  /** The phone controls (the engine's touch buttons as an action cluster); inert without touch. */
  touchPad!: TouchPad;
  /** What the pad says back: rumbles on hits, crits, level-ups, rare drops, the portal and death; the DualSense's light bar. */
  feel!: PadFeel;
  /** The level's map over the play (Tab / M, R3 or the touchpad's press): a HUD overlay, the world runs on. */
  mapOpen = false;
  /** The touch controls' rects in art pixels this frame (the HUD lays out around them). */
  private hudControls: Box[] = [];
  /**
   * The fixed HUD's zones as drawn this frame: an item window's legend keeps clear of them
   * (`UiLayer.avoid`), above all of the orbs, the bar and the minimap (a passing banner, a boss's
   * name and the top-left text matter less: `weight`).
   */
  private hudZonesShown: (Box & { weight: number })[] = [];
  /**
   * The heroes as they stood when the guests' strips were placed (`HudModel.heroes`, which the
   * strips keep off), the seats whose heroes were made and the screen's size then: taken again
   * when a stage opens (dropped there), a guest's hero comes or goes, or the screen's size changes
   * (once the heroes are known: `heroBoxes`), so the strips stay put as the heroes move. Null without guests.
   */
  private stripHeroes: { seats: string; w: number; h: number; boxes: readonly Box[] } | null = null;
  /** The last row the title's logo and tagline take (the title menu starts under it). */
  private titleBottom = 0;
  private readonly menuInput = new MenuInput(SHELL_MENU_BINDINGS);
  private rng = new Rng(1);
  /**
   * Presentation's own random stream (screen shake, damage-number drift, sound pitch): forked
   * from the run's wherever that one starts, never drawn by play, so a display setting can't
   * change what a seeded run does or drops.
   */
  private fx = new Rng(1).fork('presentation');
  /** What a run starts from, as setup left it: the hero, the loot, the town and the id counters (`startRun`). */
  private fresh: { readonly hero: unknown; readonly loot: unknown; readonly town: TownState; readonly actors: number; readonly props: number } | null = null;
  private readonly recap = new RecapTracker();
  private readonly floaters = new Floaters();
  private feed: FeedLine[] = [];
  /** The centre banners (level card, LEVEL CLEAR, level-ups): one at a time, queued. */
  private readonly banners = new BannerQueue();
  /** What the HUD reserved this frame: world labels and numbers are placed around it. */
  private readonly hudLayout = new HudLayout();
  private streak: { count: number; age: number } | null = null;
  private levelUpAge = 99;
  private hurt = 0;
  private goldShown = 0;
  /** Seconds in the current level (clear time). */
  levelTime = 0;
  cleared = false;
  dead = false;
  private deathTimer = 0;
  private dialogueLine: string | null = null;
  private talkingTo: import('../town/npcs').Npc | null = null;
  /** The panel the townsperson opened as they spoke (`openPanel`'s id): the one `PanelHost.talk` gives their line to. */
  private talkPanel: string | null = null;
  /**
   * The NPC's line on screen (`talkPlace`): when it was said (game time: one over the panels goes
   * after `talkSeconds`), a tap on it put it away, a press on it is down, and where it was laid out
   * last (kept while the line and what it keeps clear of stay the same).
   */
  private talk = { said: 0, gone: false, press: false, key: '', place: null as TalkPlace | null, box: null as Box | null };
  // camera
  private readonly camTarget = new Vector3();
  private readonly lead = new Vector3();
  private readonly shakeOffset = new Vector3();
  private shakeTime = 0;
  private shakeStrength = 0;
  private zoomGoal: number = CAMERA.title;
  // input
  private readonly intent: MutableIntent = { move: { x: 0, z: 0 }, aim: new Vector3(), attack: false, skill: -1, dodge: false, held: 0 };
  /** An agent's intent this frame (`agentInput`: it arrives as recorded input), else null (the player's). */
  botIntent: (HeroIntent & { interact?: boolean }) | null = null;
  /** The frame's commands `frameInput` took last (it runs once a frame). */
  private frameTaken: readonly unknown[] | null = null;
  /**
   * Motion aim on the pad (a DualSense through 52in1): the ground direction (unit) the controller's
   * turns keep and turn (`turnAim`) and the right stick sets, and the seconds since it was last
   * turned or acted along (it lets go after `AIM.hold`); null while motion aim is not steering.
   * It lets go too when motion aim goes off (`watchMotion`), and where the hero starts again: into
   * town (a new run, a load) or a level, and at a death (so it rises without one).
   */
  private motionAim: { x: number; z: number; idle: number } | null = null;
  /** `input.motion.lean` before this game set it (given back at dispose). */
  private savedLean = true;
  /** Couch co-op: the players 2 to 4 at this screen, a pad each (`game/coop.ts`). */
  coop!: LocalCoop;
  /** Where the camera follows a couch group (its centre). */
  private readonly groupAt = new Vector3();
  /** The camera's screen axes in the world, for couch co-op's view (`coopView`). */
  private readonly viewRight = new Vector3();
  private readonly viewUp = new Vector3();
  private interactQueued = false;
  /** What the mouse is over in the world as last drawn (a townsperson, the stash, a loot label, the open portal), or null. */
  worldFocus: WalkTarget | null = null;
  /** A thing clicked out of reach: the hero walks there along the way (`HeroWalk`) and does it on arrival (`walk`, `arrive`). */
  walkTo: WalkTo | null = null;
  /**
   * The stash, the vendor or the bench the hero opened at its place (`interactWith`): its panel and
   * the interactable's id. It closes once the hero is out of that one's reach (`keepInReach`).
   */
  private counter: { readonly panel: string; readonly id: string } | null = null;
  /**
   * The left button (or finger) now held went down on something that took it (a thing in the
   * world: a click there, not a swing; the map, opened or closed): no attack until it is let go.
   */
  private pressTaken = false;
  /** Fixed steps a finger alone has been down on the world, the one it landed in counting 1 (0: none; `FINGER_WAIT`). */
  private fingerHeld = 0;
  /**
   * What a finger can tap or swipe away, as last drawn (art pixels): the loot labels (a tap picks
   * one up, or walks there), the interact prompt's box (a tap does it), the loot feed's lines and
   * the NPC's line over a panel (a swipe from one dismisses it).
   */
  private touchable: { loot: { id: number; rect: Box }[]; prompt: Box | null; feed: Box[]; dialogue: Box | null } = { loot: [], prompt: null, feed: [], dialogue: null };
  private readonly right = new Vector3();
  private readonly forward = new Vector3();
  private readonly tmp = new Vector3();
  private readonly liftDir = new Vector3();
  private readonly eyeAt = new Vector3();
  private time = 0;
  private music: SongName | null = null;
  private combatHeat = 0;
  private combatSince = 0;
  /** Counters for playtests and the agent API (reset on level entry). */
  readonly session = { kills: 0, xp: 0, gold: 0, items: 0, deaths: 0, damageTaken: 0 };
  /** Last events, for agents (`__RIFTLIGHT__.log()`). */
  readonly log: { t: number; type: string; text: string }[] = [];
  private savedGamepad: Record<number, string> | null = null;
  private savedKeys: ReturnType<typeof rebindDebugKeys> | null = null;
  private disposeApi: (() => void) | null = null;
  private readonly unsubs: (() => void)[] = [];
  private playtime = 0;
  private lootFocus: WorldLoot | null = null;
  /** The character screens' strip as last drawn (its names are buttons). */
  private pageStrip: PageStrip['rects'] = [];
  private fileInput: HTMLInputElement | null = null;
  private gifts = 0;
  /** A level system already announced the clear (`levelClear`): the shell doesn't repeat it. */
  private clearEmitted = false;
  private musicKey = '';
  /** What the level on now was built from (save-states rebuild it the same way, then load its state). */
  private levelEntry: LevelEntry | null = null;

  /** New runs' seed when none is given: the `seed` option, else the page's `?seed=` (else the clock: a new run each time). */
  private readonly seed: number | null;
  /**
   * A 52in1 round (docs/game/session.md): the page opens straight into it. Null outside a session
   * (a replay of a recorded round makes one when the round's command plays: `HubSession.offline`).
   */
  round: SessionRound | null;

  constructor(ports: Partial<RiftlightPorts> = {}, options: { store?: SaveStore; seed?: number; session?: HubSession | null } = {}) {
    this.seed = options.seed !== undefined ? options.seed >>> 0 : urlSeed();
    this.round = options.session ? new SessionRound(options.session, this) : null;
    // The real hero, levels and monsters (src/riftlight/wire) and the real loot and tree;
    // pass ports to replace any of them.
    this.ports = { ...corePorts(), loot: realLootPort(), tree: realTreePort(), ...ports };
    // a session's runs are the hub's rounds, thrown away after each: memory only, never the player's slots
    this.store = options.store ?? new SaveStore(options.session ? null : undefined);
    this.saves = this.store.view();
  }

  /**
   * Saves go to the store: not in a replay (the player's slots are not the recording's), nor in a
   * session round (its run is the hub's, thrown away after the round), whatever store it was given.
   */
  private get storing(): boolean {
    return !this.replaying && !this.round;
  }

  get audio() {
    return this.ctx.audio;
  }

  /** The developer tools are on (the dev server or `?debug=1`: the engine's hotkeys are): the pause menu offers Dev. */
  get devTools(): boolean {
    return Object.values(this.ctx.engine.debugKeys).some((keys) => keys.length > 0);
  }

  /** The engine (MenuHost: its player settings). */
  get engine() {
    return this.ctx.engine;
  }

  // ================================================================ lifecycle

  async setup(ctx: GameContext): Promise<void> {
    this.ctx = ctx;
    // the page's language (?lang=, the player's choice, the browser's) and its translations block;
    // headless, the game's own (docs/game/lang.md)
    if (ctx.engine.renderer.container) pageLanguage();
    // ids count from here, as they did in a run this replays (they key loot rolls and random streams)
    setActorIds(1);
    PropTarget.setIds();
    const { engine } = ctx;
    registerAudio(ctx.audio);
    registerFx(ctx.particles);
    // Engine hotkeys (on with ?debug=1) move off the game's keys (P = passive tree, R = skill 3).
    this.savedKeys = engine.debugKeys;
    engine.debugKeys = rebindDebugKeys(engine.debugKeys, { mode: 'F8', resolution: 'F7', mute: 'F9' }); // and M = the map
    ctx.input.preventKeys.add('Tab'); // the map, and menus' tabs: never the browser's focus
    this.savedGamepad = ctx.input.gamepadButtons;
    ctx.input.gamepadButtons = { ...GAMEPAD_BUTTONS }; // the engine's own pad codes (a lab before may have remapped them)
    // motion aim turns a kept aim direction (`turnAim`), never leans the aim stick
    this.savedLean = ctx.input.motion.lean;
    ctx.input.motion.lean = false;
    ctx.input.touchpad = true; // a DualSense's swipes page the character screens (`KEYS.pagePrev`); its press is the map
    // couch co-op: every pad read on its own too, so players 2 to 4 can join (`game/coop.ts`)
    ctx.input.padPlayers = true;
    this.coop = new LocalCoop({
      input: ctx.input,
      hero: () => this.hero,
      guestHero: (at, facing) => this.guestHero(at, facing),
      fitGuest: (hero) => this.fitGuest(hero),
      besideSpot: (p, seat) => this.besideSpot(p, seat),
      enterStage: (hero, at, facing) => hero.enter(this.level ?? this.town, at, facing),
      foes: () => this.level?.actors() ?? [],
      basis: (right, forward) => cameraBasis(ctx.engine, right, forward),
      view: () => this.coopView(ctx),
      project: (p, out) => out.copy(p).project(ctx.engine.camera.camera),
      feed: (text) => this.feedLine(text, 'cyan'),
    });
    this.ui = new Canvas(ctx.hud);
    this.pointer = new Pointer(engine);
    this.touchPad = new TouchPad(engine);
    this.feel = new PadFeel(ctx);
    this.lights = new LightPool(ctx.lights); // the engine's pool: the one light system
    this.layer.onSound = (s) => this.sound(s);
    this.layer.legends = true; // the button legends under panels name this shell's controls
    this.layer.avoid = () => (this.talk.box ? [...this.hudZonesShown, { ...this.talk.box, weight: 100 }] : this.hudZonesShown);
    this.layer.legendExtra = (panel) => (pageOf(panel) ? [pagesLegend()] : []); // L1 R1: the character screens' ring
    const rng = () => this.rng;
    this.services = {
      ctx,
      events: this.events,
      lights: this.lights,
      get rng() {
        return rng();
      },
      difficulty: () => this.save.difficulty,
      difficultyMods: (side) => difficultyMods(this.save.difficulty, side),
      settings: () => this.settings,
      dev: () => this.dev,
      shake: (s, t = 0.25) => {
        this.shakeStrength = Math.max(this.shakeStrength, s * this.settings.screenShake);
        this.shakeTime = Math.max(this.shakeTime, t);
      },
      hero: () => this.hero?.actor ?? null,
    };
    for (const p of [this.ports.loot, this.ports.tree, this.ports.levels, this.ports.monsters]) p.init?.(this.services);
    this.listen();
    // the town's outskirts and the level props build from imported packs (riftlight/packs.ts)
    const [tree] = await Promise.all([ctx.loadModel('assets/tree.glb'), loadRiftlightPacks()]);
    this.town = new Town(this.services);
    this.town.build(tree.scene);
    ctx.scene.add(this.town.root);
    this.town.activate();
    this.town.dayTime = 0.56; // the title opens at nightfall
    this.showcase = new Showcase(this);
    this.showcase.buildTown();
    this.hero = await this.ports.hero.create(this.services, this.save.hero);
    this.hero.object.visible = false;
    // a copy, as snapshot() takes, and copied again per run: no run may change what the next starts from
    this.fresh = structuredClone({ hero: this.hero.saveState?.() ?? null, loot: this.ports.loot.saveState?.() ?? null, town: this.town.saveState(), actors: actorIds(), props: PropTarget.nextId() });
    this.applySettings();
    // the settings play depends on (zoom and shake move what the mouse points at) are the
    // device's: the recording keeps them, so a replay plays with the recorded ones
    this.sentAtSetup = { settings: JSON.stringify(playSettings(this.settings)), saves: JSON.stringify(this.saves) };
    ctx.input.send({ rl: 'settings', settings: playSettings(this.settings) });
    ctx.input.send({ rl: 'saves', saves: this.saves }); // and so are the save slots the menus show
    ctx.input.send({ rl: 'touch', hub: this.touchPad.hub }); // and where the page's ≡ is (52in1's place: the HUD lays out around it)
    if (this.round) {
      // a session opens straight into its round: no title, menus or town (the hub's card is up)
      this.screen = 'loading';
      this.syncTouch(); // the page's controls start shown: none over the loading screen (no frame runs till the level is built)
      this.round.announce();
    } else this.toTitle();
  }

  /** The engine runs this game now: `window.__RIFTLIGHT__` for tools and agents. */
  ready(): void {
    this.disposeApi ??= installApi(this);
  }

  dispose(ctx: GameContext): void {
    this.layer.closeAll(); // first: closing a talk plays the townsperson's goodbye, before the town goes
    this.feel?.release(); // both triggers let go
    this.showcase?.dispose();
    for (const u of this.unsubs) u();
    this.disposeApi?.();
    this.disposeApi = null;
    this.pointer?.dispose();
    this.fileInput?.remove();
    if (this.savedKeys) ctx.engine.debugKeys = this.savedKeys;
    if (this.savedGamepad) ctx.input.gamepadButtons = this.savedGamepad;
    ctx.input.motion.lean = this.savedLean;
    ctx.input.touchpad = false;
    this.coop?.dispose();
    ctx.input.padPlayers = false;
    ctx.input.joinWith = null;
    ctx.input.preventKeys.delete('Tab');
    this.level?.dispose();
    this.level = null;
    this.hero?.dispose();
    this.town?.dispose();
    this.events.clear();
    this.ports.loot.dispose?.();
  }

  // ================================================================ events

  private listen(): void {
    const on = <K extends keyof GameEvents>(k: K, fn: (p: GameEvents[K]) => void) => this.unsubs.push(this.events.on(k, fn));
    on('hit', ({ target, result, hit }) => {
      if (this.hero && target === this.hero.actor) {
        this.recap.record(hit, result);
        this.session.damageTaken += result.total;
        this.hurt = Math.min(1, this.hurt + 0.3 + result.total / Math.max(1, this.hero.vitals().maxLife));
        this.services.shake(0.15 + Math.min(0.4, result.total / 40), 0.15);
        this.ctx.audio.play('hurt', { volume: 0.5 });
        if (result.total > 0) this.feel.rumble(RUMBLE.hurt(result.total / Math.max(1, this.hero.vitals().maxLife)));
        return;
      }
      if (result.crit && result.total > 0 && this.hero && hit.source === this.hero.actor) this.feel.rumble(RUMBLE.crit);
      const at = target.position.clone().setY(1.2);
      this.combatHeat = Math.min(1, this.combatHeat + 0.25);
      this.combatSince = 0;
      // a hero whose combat plays its own juice (sounds, sparks by skill) only gets numbers here
      if (!this.hero?.juice) {
        this.ctx.particles.burst('rl.hit', at);
        this.ctx.audio.play(result.crit ? 'rl.crit' : 'rl.hit', { pitch: this.fx.range(-2, 2), volume: 0.7 });
      }
      // a crit flashes the spot it lands on (one pooled light, gone in a few frames)
      if (result.crit && result.total > 0) this.flash(at, PALETTE.sand, 7, 4.5, 0.14);
      if (this.settings.damageNumbers && result.total > 0) {
        const color: PaletteColor = result.crit ? 'sand' : DAMAGE_COLORS[dominantType(result)];
        this.floaters.add(at.setY(1.6), `${Math.round(result.total)}${result.crit ? '!' : ''}`, color, result.crit, this.fx.range(-1, 1), { key: target.id, value: result.total });
      }
    });
    on('kill', ({ target, rank }) => {
      // monsters only: the hero's minions and totems die too
      if (!this.hero || target === this.hero.actor || target.faction !== 'monster') return;
      // `xp.gain` is a multiplier stat (base 1): shrines, mechanic rewards, gear
      const gain = this.hero.actor.stats.get('xp.gain');
      const xp = Math.max(1, Math.round(killXp(target.level, RANK[rank].xp, this.save.hero.level) * (gain > 0 ? gain : 1)));
      // a shared world's heroes stay as the round made them (the host's would outgrow the others')
      if (this.round?.mode !== 'shared-world') this.gainXp(xp);
      this.session.kills++;
      const stats = (this.save.stats ??= emptyStats());
      stats.kills++;
      this.streak = { count: (this.streak && this.streak.age < 3 ? this.streak.count : 0) + 1, age: 0 };
      this.ctx.audio.play('rl.die', { pitch: rank === 'boss' ? -8 : this.fx.range(-2, 3) });
      this.ctx.particles.burst('smoke', target.position.clone().setY(0.6), { count: rank === 'boss' ? 14 : 5 });
      // the kill lights the room for a moment: bigger and whiter for elites and the boss
      const big = rank === 'boss' ? 3 : rank === 'rare' ? 1.6 : rank === 'magic' ? 1.3 : 1;
      this.flash(target.position.clone().setY(1), rank === 'boss' ? PALETTE.white : PALETTE.orange, 5 * big, 4 + 2 * big, 0.2 * big);
      if (rank === 'boss') this.services.shake(0.8, 0.5);
      this.note('kill', `${target.name ?? 'monster'} +${xp}xp`);
    });
    on('death', ({ actor }) => {
      if (this.hero && actor === this.hero.actor && !this.dead) this.onHeroDeath();
    });
    on('mechanic', ({ id }) => this.unlockCodex(id));
    on('landed', ({ item, loud }) => {
      if (loud) this.feel.rumble(RUMBLE.loud);
      else if (item.rarity === 'rare' || item.rarity === 'unique') this.feel.rumble(RUMBLE.rare);
    });
    on('levelClear', () => (this.clearEmitted = true));
  }

  /** A short light flash from the engine's pool (crits, kills, level-ups): never a new light. */
  private flash(at: Vector3, color: number, intensity: number, radius: number, seconds: number): void {
    this.ctx.lights.request({ position: [at.x, at.y + 0.4, at.z], color, intensity, radius, lifetime: seconds, fadeIn: 0.01, fadeOut: Math.min(0.15, seconds * 0.6), priority: 5, flicker: 'none', name: 'flash' });
  }

  private note(type: string, text: string): void {
    this.log.push({ t: +this.time.toFixed(2), type, text });
    if (this.log.length > 200) this.log.shift();
  }

  // ================================================================ flow

  /** Title screen: the town at dusk behind the logo and menu, no hero. */
  toTitle(): void {
    this.leaveLevel();
    this.coop.leaveAll(); // couch guests leave with the run
    this.screen = 'title';
    this.layer.closeAll();
    this.hero.object.visible = false;
    this.town.activate();
    this.zoomGoal = CAMERA.title;
    this.playMusic('title');
    this.openTitleMenu();
  }

  private openTitleMenu(): void {
    this.layer.closeAll();
    this.layer.open(titleMenu(this), { modal: false, bare: true, sticky: true, silent: true, below: () => this.titleBottom + 6, legend: true });
  }

  /** Start a fresh run in a slot. */
  newRun(slot: number, seed = this.seed ?? (Date.now() ^ (slot * 7919)) >>> 0): void { // real time: a new run's seed when none is given (the save keeps it)
    this.startRun();
    this.slot = slot;
    this.save = newSave(seed);
    if (this.storing) this.store.save(slot, this.save);
    viewSaved(this.saves, slot, this.save);
    this.applySave();
    this.note('run', `new run in slot ${slot + 1} seed ${seed}`);
    this.goTown('new');
  }

  continueRun(): void {
    const last = this.store.lastSlot();
    if (last === null) return this.newRun(0);
    this.loadSlot(last);
  }

  loadSlot(slot: number): boolean {
    const data = this.store.load(slot);
    if (!data) {
      this.sound('error');
      return false;
    }
    this.loadData(slot, data);
    return true;
  }

  /** Play on from a save's data, into town. */
  private loadData(slot: number, data: SaveData): void {
    this.startRun();
    this.slot = slot;
    this.save = data;
    this.applySave();
    this.note('run', `loaded slot ${slot + 1}`);
    this.goTown('load');
  }

  /**
   * The title menu starts or loads a run. What that takes from the page (the save in storage,
   * a new run's seed from `?seed=` or the clock) goes through `ctx.input.send`, so the recording
   * keeps it and a replay loads the same run; it starts at the next frame (`command`).
   */
  play(choice: { readonly kind: 'new' | 'load' | 'continue'; readonly slot?: number }): void {
    if (choice.kind === 'new') {
      const slot = choice.slot ?? 0;
      this.ctx.input.send({ rl: 'run', slot, seed: this.seed ?? (Date.now() ^ (slot * 7919)) >>> 0 }); // real time: a new run's seed when none is given (the save keeps it)
      return;
    }
    const slot = choice.kind === 'continue' ? this.saves.last : (choice.slot ?? null);
    if (slot === null) return this.play({ kind: 'new', slot: 0 });
    const data = this.store.load(slot);
    if (!data) return this.ctx.input.send({ rl: 'storage', error: this.store.lastError || t('menu.slots.error.empty', { slot: slot + 1 }) });
    this.ctx.input.send({ rl: 'load', slot, data });
  }

  /** This frame's data from the page (`play`, the settings at setup), live or replayed. */
  private command(c: unknown): void {
    const m = c as Partial<RiftCommand> | null;
    if (m?.rl === 'run' && typeof m.slot === 'number' && typeof m.seed === 'number') this.newRun(m.slot, m.seed);
    else if (m?.rl === 'load' && typeof m.slot === 'number' && m.data) this.loadData(m.slot, m.data);
    else if (m?.rl === 'round' && 'info' in m && m.info) {
      // live, the session made the round at setup; replayed, the recording's info makes one with no hub behind it
      this.round ??= new SessionRound(HubSession.offline(m.info), this);
      this.round.begin(m.info);
    }
    // the setup's settings and slots apply unless the game changed them before its first frame
    // (an agent's newRun): a replay changes nothing before it, so it always takes the recorded ones
    else if (m?.rl === 'settings' && m.settings) {
      if (JSON.stringify(playSettings(this.settings)) === this.sentAtSetup.settings) Object.assign(this.settings, playSettings(m.settings));
    } else if (m?.rl === 'saves' && m.saves) {
      if (JSON.stringify(this.saves) !== this.sentAtSetup.saves) return;
      this.saves = m.saves;
      if (this.screen === 'title') this.openTitleMenu(); // as these slots make it, its focus on the first
    } else if (m?.rl === 'imported' && typeof m.slot === 'number') {
      if (m.data) viewSaved(this.saves, m.slot, m.data);
      this.saves.lastError = m.error ?? '';
      this.sound(m.data ? 'open' : 'error');
    } else if (m?.rl === 'touch' && typeof m.hub === 'boolean') {
      this.touchPad.hub = m.hub; // a replay lays the touch controls out as the recorded page had them
    } else if (m?.rl === 'storage' && typeof m.error === 'string') {
      this.saves.lastError = m.error; // a save that failed to load or to write
      this.sound('error');
    }
  }

  /** Storage is the player's: a replay reads what it recorded and writes nothing. */
  private get replaying(): boolean {
    return this.ctx?.input.playing ?? false;
  }

  /**
   * A run starts as it would in a fresh game, whatever ran before it in this one: the last run's
   * level left, then the id counters, the hero (its action, combo, aim, random stream,
   * counters), the loot (the world loot's ids and counters) and the town as setup left them, and
   * the shell's own run fields (the level's clock and clear, the session, streaks, the recap,
   * gifts) as they start, so a seed plays the same after other runs as alone. The save that
   * follows (`applySave`) fills them in.
   */
  private startRun(): void {
    this.leaveLevel();
    const f = this.fresh;
    if (!f) return;
    setActorIds(f.actors);
    PropTarget.setIds(f.props);
    this.town.loadState(structuredClone(f.town));
    if (f.loot !== null) this.ports.loot.loadState?.(structuredClone(f.loot), this.town);
    if (f.hero !== null) this.hero.loadState?.(structuredClone(f.hero), (id) => (id === this.hero.actor.id ? this.hero.actor : null));
    this.levelTime = 0;
    this.cleared = false;
    this.clearEmitted = false;
    this.dead = false;
    this.recap.reset();
    this.streak = null;
    Object.assign(this.session, { kills: 0, xp: 0, gold: 0, items: 0, deaths: 0, damageTaken: 0 });
    this.combatHeat = 0;
    this.combatSince = 0;
    this.hurt = 0;
    this.levelUpAge = 99;
    this.gifts = 0;
  }

  /** Push the save into every system: hero level, tree, gear, difficulty, loot. */
  private applySave(): void {
    this.rng = new Rng(this.save.seed).fork('run');
    this.fx = this.rng.fork('presentation');
    this.save.stats ??= emptyStats();
    this.save.codex ??= [];
    this.save.difficulty = sanitizeTuning(this.save.difficulty);
    this.ports.loot.load(this.save);
    this.hero.setLevel(this.save.hero.level);
    this.hero.setSkills?.(this.save.hero.skills);
    this.applyMods();
    this.hero.restore();
    this.goldShown = this.save.hero.gold;
    this.playtime = this.save.stats.playtime;
  }

  /** Tree, gear and difficulty sources on the hero; difficulty on live monsters. */
  applyMods(): void {
    this.hero.setMods('tree', this.ports.tree.mods(this.save.hero.allocated));
    for (const [source, mods] of Object.entries(this.ports.loot.gearMods())) this.hero.setMods(source, mods);
    this.hero.setMods('difficulty', difficultyMods(this.save.difficulty, 'hero'));
    const enemy = difficultyMods(this.save.difficulty, 'enemy');
    for (const m of this.level?.monsters() ?? []) {
      const a = m.actor;
      const prev = a.stats.get('life');
      if (enemy.length) a.stats.set('difficulty', enemy);
      else a.stats.remove('difficulty');
      const next = a.stats.get('life');
      if (prev > 0) a.life = (a.life / prev) * next;
    }
  }

  /** Into town: restore, autosave, music. */
  goTown(reason: 'new' | 'load' | 'portal' | 'death' | 'quit' = 'portal'): void {
    this.leaveLevel();
    this.motionAim = null;
    this.layer.closeAll();
    this.screen = 'town';
    this.dead = false;
    this.town.activate();
    this.town.dayTime = reason === 'new' || reason === 'load' ? 0.18 : this.town.dayTime;
    this.hero.object.visible = true;
    const at = reason === 'portal' ? this.town.portalSpawn : this.town.spawn;
    this.hero.enter(this.town, at, reason === 'portal' ? Math.PI * 0.75 : Math.PI * 0.75 + Math.PI);
    this.hero.restore();
    this.coop.enter(at, reason === 'portal' ? Math.PI * 0.75 : Math.PI * 0.75 + Math.PI);
    this.stripHeroes = null; // a new stage: the strips placed anew once its heroes are known
    this.ctx.engine.camera.teleport(this.camTarget.copy(at).setY(at.y + 0.9));
    this.zoomGoal = CAMERA.town;
    this.playMusic('town');
    this.banners.clear();
    this.banners.push('card', t('place.emberfall'), t('banner.town'), { duration: 2.2 }); // a shorter card at home
    this.autosave('town');
    this.note('flow', `town (${reason})`);
  }

  /** Into a level at `depth` (designed 1..12, rifts after). */
  async enterDepth(depth: number): Promise<void> {
    if (this.screen === 'loading') return;
    const d = Math.max(1, Math.floor(depth));
    this.layer.closeAll();
    this.endTalk();
    this.screen = 'loading';
    this.syncTouch(); // no frame runs while the level builds: the controls step aside now
    this.syncLatch(); // and R2 lets go
    this.portalSound();
    this.leaveLevel();
    this.motionAim = null;
    this.town.deactivate();
    this.ctx.scene.background = new Color(PALETTE.ink);
    const spec = this.ports.levels.spec(d, this.save.seed);
    this.rng = new Rng(this.save.seed).fork(`level:${d}:${this.save.stats?.runs ?? 0}`);
    this.fx = this.rng.fork('presentation');
    const at = { spec, rng: this.rng.state, actors: actorIds(), props: PropTarget.nextId() };
    const level = await this.ports.levels.build(spec, this.levelDeps());
    this.level = level;
    // what it was planned as, from the plan it was built with (planning a level costs tens of ms)
    const entry: LevelEntry = { ...at, plan: level.signature ?? this.ports.levels.signature?.(spec) ?? null };
    this.levelEntry = entry;
    this.ctx.scene.add(level.root);
    this.hero.object.visible = true;
    this.hero.enter(level, level.start, Math.PI);
    this.hero.restore();
    this.screen = 'level';
    this.coop.enter(level.start, Math.PI);
    this.stripHeroes = null; // a new stage: the strips placed anew once its heroes are known
    this.ctx.engine.camera.teleport(this.camTarget.copy(level.start).setY(0.9));
    this.zoomGoal = CAMERA.level;
    this.levelTime = 0;
    this.cleared = false;
    this.clearEmitted = false;
    this.dead = false;
    this.recap.reset();
    this.streak = null;
    Object.assign(this.session, { kills: 0, xp: 0, gold: 0, items: 0, damageTaken: 0 });
    const stats = (this.save.stats ??= emptyStats());
    stats.runs++;
    for (const m of spec.mechanics) this.unlockCodex(m);
    this.banners.clear();
    this.banners.push('card', levelTitle(spec), d > 12 ? t('banner.level.rift') : t('banner.level.depth', { depth: d }));
    this.combatHeat = 0;
    this.playMusic('level');
    this.note('flow', `level ${d} ${spec.name}`);
  }

  private levelDeps() {
    return { services: this.services, monsters: this.ports.monsters, loot: this.ports.loot, hero: this.hero };
  }

  /** Out of the level (to town, the title, a new run, another level): its map closes, a pulse still to come is dropped. */
  private leaveLevel(): void {
    this.levelEntry = null;
    this.mapOpen = false;
    this.feel.cancel();
    if (!this.level) return;
    this.ports.loot.clearGround();
    this.level.dispose();
    this.level = null;
    this.lights.releaseAll();
    this.floaters.clear();
  }

  /** Through the portal (or the loot window) back to town. */
  returnToTown(): void {
    if (this.screen !== 'level') return;
    this.portalSound();
    this.goTown('portal');
  }

  /** The portal's whoosh: from a DualSense's speaker while the player allows it, else with the other sounds. */
  private portalSound(): void {
    this.ctx.audio.play('rl.portal', { bus: 'speaker' });
  }

  private onHeroDeath(): void {
    this.feel.rumble(RUMBLE.death);
    this.dead = true;
    this.motionAim = null;
    this.deathTimer = 0;
    this.session.deaths++;
    this.hero.emote('death');
    this.ctx.audio.playMusic(null);
    this.music = null;
    this.musicKey = '';
    this.ctx.audio.play('rl.death');
    this.note('death', `slain by ${this.recap.recap().killer ?? '?'}`);
    this.round?.heroDied();
  }

  private showRecap(): void {
    const recap = this.recap.recap();
    const penalty = applyDeath(this.save);
    this.goldShown = this.save.hero.gold;
    const where = this.level ? levelTitle(this.level.spec) : t('place.emberfall');
    this.layer.open(new DeathRecap(recap, penalty, where, () => this.goTown('death')), { modal: true, sticky: true });
  }

  private onClear(): void {
    if (!this.level) return;
    this.cleared = true;
    const depth = this.level.spec.depth;
    const deeper = recordClear(this.save, depth, this.levelTime);
    if (!this.clearEmitted) this.events.emit('levelClear', { depth, time: this.levelTime });
    this.feel.rumble(RUMBLE.portal); // the portal opens
    if (this.round?.moment) {
      // a moment says its own cleared or failed, with its own sound (session/round.ts)
    } else {
      this.ctx.audio.play('rl.clear');
      if (this.round) this.banners.push('clear', t('round.cleared'), t('round.cleared_in', { time: formatTime(this.levelTime) }));
      else this.banners.push('clear', t('banner.clear'), deeper ? t('banner.clear.unlocked', { time: formatTime(this.levelTime) }) : formatTime(this.levelTime));
    }
    this.hero.emote('victory');
    this.playMusic('level');
    this.autosave('clear');
    this.note('flow', `clear depth ${depth} in ${this.levelTime.toFixed(1)}s`);
    this.round?.cleared();
  }

  // ================================================================ session rounds (RoundHost)

  /**
   * A session round's run: a fresh hero on the hub's seed, levelled for the depth, straight into
   * the level, standing at its seat's place by the start (every copy puts each seat in the same spot).
   */
  async startRound(seed: number, depth: number, level: number, seat: number): Promise<void> {
    this.newRun(0, seed);
    this.quietLevels = true; // levels given to start a round are not news: no banner rumble
    for (let l = 1; l < level; l++) this.devGive('level');
    this.quietLevels = false;
    this.feed = []; // the levels given are not news
    await this.enterDepth(depth);
    const at = this.seatSpot(seat);
    if (at) {
      this.hero.snap?.(at, Math.PI);
      this.ctx.engine.camera.teleport(this.camTarget.copy(at).setY(0.9));
    }
  }

  /** A moment's targets (its monsters) and, to escape, its spot: set up by `startMoment`. */
  momentAim: { readonly targets: readonly MonsterHandle[]; readonly spot: Vector3 | null } | null = null;

  /**
   * A moment's set-up (session/moments.ts): a fresh hero at the moment's level on `seed`, straight
   * into its level, standing `back` metres short of its targets on the way in and facing them. The
   * same on every copy: the level's design places the targets, the layout the spot.
   */
  async startMoment(moment: MomentSpec, seed: number): Promise<void> {
    this.newRun(0, seed);
    this.quietLevels = true; // as a round's start: the moment's levels are not news, no rumble for each
    for (let l = 1; l < moment.heroLevel; l++) this.devGive('level');
    this.quietLevels = false;
    this.feed = [];
    await this.enterDepth(moment.depth);
    const level = this.level;
    if (!level) return;
    const want = moment.target;
    const targets = level.monsters().filter((m) => ('boss' in want ? m.rank === 'boss' : m.pack !== undefined && want.packs.includes(m.pack)));
    if (!targets.length) throw new Error(`moment ${moment.id}: no ${'boss' in want ? 'boss' : `pack ${want.packs.join(', ')}`} in level ${moment.depth}`);
    const aim = targets.reduce((sum, m) => sum.add(m.actor.position), new Vector3()).multiplyScalar(1 / targets.length);
    const s = momentSpot(level.layout, aim, moment.back);
    const at = new Vector3(s.x, level.start.y, s.z);
    this.hero.snap?.(at, Math.atan2(aim.x - at.x, aim.z - at.z));
    this.ctx.engine.camera.teleport(this.camTarget.copy(at).setY(0.9));
    const away = moment.clear === 'escape' ? moment.spot : undefined;
    if (moment.clear === 'escape' && !away) throw new Error(`moment ${moment.id}: an escape names its spot`);
    this.momentAim = { targets, spot: away ? new Vector3(away.x, level.start.y, away.z) : null };
  }

  /** The moment's goal is met: its targets fallen, or (to escape) the hero at its spot. */
  momentMet(): boolean {
    const aim = this.momentAim;
    if (!aim || this.dead) return false;
    if (aim.spot) return Math.hypot(aim.spot.x - this.hero.actor.position.x, aim.spot.z - this.hero.actor.position.z) <= MOMENT_REACH;
    return aim.targets.every((m) => !m.actor.alive);
  }

  /** Where a seat stands at the level's start (seats spread out, so four heroes aren't one), or null for the start itself. */
  seatSpot(seat: number): Vector3 | null {
    const level = this.level;
    if (!level || seat <= 0) return null;
    const stage = this.stageNow();
    const a = (seat * Math.PI) / 2;
    for (const r of [1.4, 0.9]) {
      const at = new Vector3(level.start.x + Math.sin(a) * r, level.start.y, level.start.z + Math.cos(a) * r);
      if (!stage || stage.walkable(at.x, at.z, false)) return at;
    }
    return null;
  }

  /** The level's boss life as a fraction (1 untouched, 0 dead); null without a boss. */
  bossLife(): number | null {
    const boss = this.level?.boss();
    return boss ? Math.max(0, boss.life) / Math.max(1, boss.maxLife) : null;
  }

  /** A fallen hero rises at the level's start (session rounds: a death never ends the round). */
  respawn(): void {
    if (!this.level || !this.dead) return;
    this.dead = false;
    this.deathTimer = 0;
    this.hero.enter(this.level, this.level.start, Math.PI);
    this.hero.restore();
    this.ctx.engine.camera.teleport(this.camTarget.copy(this.level.start).setY(0.9));
    this.portalSound();
    this.playMusic('level');
  }

  /** The round's mode: ghosts of the other players, or one shared world (session/ghosts.ts, session/shared.ts). */
  roundModes(info: import('../../engine').HubInfo): RoundMode[] {
    const round = this.round;
    if (!round) return [];
    if (round.mode === 'ghost') return [new GhostMode(round.session, this, info.players)];
    if (round.mode !== 'shared-world') return [];
    if (!round.session.isHost) return [new ClientWorld(round.session, this, info.players)];
    if (round.session.server) this.benchHero(); // a server runs the world with no player of its own
    return [new HostWorld(round.session, this, info.players)];
  }

  /** The level now on, as the real level stage (shared worlds work on it). */
  stageNow(): LevelStage | null {
    return this.level instanceof LevelStage ? this.level : null;
  }

  /** A server's own hero sits the round out: hidden, out of the level's fight. */
  private benchHero(): void {
    this.hero.object.visible = false;
    const stage = this.stageNow();
    if (stage) stage.world.removeHero(this.hero.actor as never);
  }

  /** Another player's hero in this level, touching nothing here (a ghost). */
  phantom(): Promise<HeroPort | null> {
    return this.teammate(false);
  }

  /**
   * Another player's hero in this level, levelled and skilled as ours, at its start: a fighter in
   * the level's world (a shared world's host), or a phantom in a world of its own (everyone else).
   */
  async teammate(fighter: boolean): Promise<HeroPort | null> {
    const hero = await this.ports.hero.create(this.services, this.save.hero, { phantom: !fighter });
    if (!this.level) {
      hero.dispose();
      return null;
    }
    this.fitAsOurs(hero);
    hero.enter(this.level, this.level.start, Math.PI);
    hero.restore();
    return hero;
  }

  /** Another hero levelled, skilled and geared as ours (a teammate, a couch guest). */
  private fitAsOurs(hero: HeroPort): void {
    hero.setLevel(this.save.hero.level);
    hero.setSkills?.(this.save.hero.skills);
    hero.setMods('tree', this.ports.tree.mods(this.save.hero.allocated));
    for (const [source, mods] of Object.entries(this.ports.loot.gearMods())) hero.setMods(source, mods);
  }

  /** A couch guest's hero (`game/coop.ts`): as ours, and our difficulty's, in the stage on now at `at` (none on a title or loading screen). */
  async guestHero(at: Vector3, facing: number): Promise<HeroPort | null> {
    const hero = await this.ports.hero.create(this.services, this.save.hero);
    const stage = this.screen === 'level' ? this.level : this.screen === 'town' ? this.town : null;
    if (!stage) {
      hero.dispose();
      return null;
    }
    this.fitGuest(hero);
    hero.enter(stage, at, facing);
    hero.restore();
    return hero;
  }

  /** A couch guest's hero as ours again (a new stage: our level, skills, gear and difficulty may have changed). */
  fitGuest(hero: HeroPort): void {
    this.fitAsOurs(hero);
    hero.setMods('difficulty', difficultyMods(this.save.difficulty, 'hero'));
  }

  /**
   * Where a couch guest of `seat` stands beside `p`, as the screen shows it (seat 2 to the right,
   * 3 to the left, 4 below, `COOP.below` down so that neither its body nor its tag covers player
   * 1's), on ground a hero can stand on; else nearer or the other side, else `p` itself.
   */
  besideSpot(p: Vector3, seat: number): Vector3 {
    const stage = this.stageNow();
    cameraBasis(this.ctx.engine, this.right, this.forward);
    const side = seat === 2 ? this.right : seat === 3 ? this.right.clone().negate() : this.forward.clone().negate();
    // seat 4 nearer than `COOP.below` would cover player 1: above them instead (player 1 then covers nothing of it but its feet)
    for (const r of seat === 4 ? [COOP.below, -COOP.below] : [COOP.beside, COOP.beside * 0.6, -COOP.beside]) {
      const at = new Vector3(p.x + side.x * r, p.y, p.z + side.z * r);
      if (this.screen === 'level' ? !stage || stage.walkable(at.x, at.z, false) : this.town.wall(p, at) === null) return at;
    }
    return p.clone();
  }

  /** A damage number over a spot (a shared world's client shows the host's). */
  number(at: Vector3, total: number, crit: boolean): void {
    if (!this.settings.damageNumbers || total <= 0) return;
    this.floaters.add(at.clone(), `${Math.round(total)}${crit ? '!' : ''}`, crit ? 'sand' : 'white', crit, this.fx.range(-1, 1));
  }

  /** Our hero was hit for `total` (a shared world's client: the host says so). */
  hurtBy(total: number): void {
    this.hurt = Math.min(1, this.hurt + 0.3 + total / Math.max(1, this.hero.vitals().maxLife));
    this.services.shake(0.15 + Math.min(0.4, total / 40), 0.15);
    this.ctx.audio.play('hurt', { volume: 0.5 });
    if (total > 0) this.feel.rumble(RUMBLE.hurt(total / Math.max(1, this.hero.vitals().maxLife)));
  }

  /** A centre banner now (it takes over from whatever showed), `age` seconds into its showing (0: it opens). */
  banner(title: string, subtitle = '', seconds = 1.2, age = 0): void {
    this.banners.clear();
    this.banners.push('card', title, subtitle, { duration: seconds, age });
  }

  /** Portal reached: the loot window if anything is left, else straight home. */
  private atPortal(): void {
    const left = this.ports.loot.ground().filter((l) => !l.filtered);
    if (!left.length) return this.returnToTown();
    if (this.layer.has('loot')) return;
    this.layer.open(
      new LootWindow(
        () => this.ports.loot.ground().filter((l) => !l.filtered),
        () => [
          t('loot_window.cleared', { level: levelTitle(this.level!.spec), time: formatTime(this.levelTime) }),
          t('loot_window.summary', { kills: t('loot_window.kills', { count: this.session.kills }), xp: t('loot_window.xp', { count: this.session.xp }), gold: t('loot_window.gold', { count: this.session.gold }) }),
        ],
        (l) => this.pickup(l),
        () => this.returnToTown(),
      ),
      { modal: true },
    );
  }

  resume(): void {
    this.layer.close('pause');
  }

  saveAndQuit(): void {
    this.autosave('quit');
    this.toTitle();
  }

  // ================================================================ progression

  /** Levels given at once (a session round's or a moment's start): no rumble for them. */
  private quietLevels = false;

  gainXp(amount: number): void {
    const gained = addXp(this.save.hero, amount);
    this.session.xp += amount;
    this.events.emit('xp', { amount, level: this.save.hero.level });
    if (gained > 0) {
      this.hero.setLevel(this.save.hero.level);
      this.hero.restore();
      for (const g of this.coop.guests) g.hero?.setLevel(this.save.hero.level); // couch guests are at player 1's level
      this.levelUpAge = 0;
      this.banners.push('levelup', t('banner.levelup', { level: this.save.hero.level }), t('banner.levelup.point'));
      this.ctx.audio.play('rl.levelUp');
      if (!this.quietLevels) this.feel.pulses(RUMBLE.levelUp, LEVEL_GAP);
      this.ctx.particles.burst('rl.levelup', this.hero.actor.position.clone().setY(0.2));
      this.flash(this.hero.actor.position, PALETTE.lime, 8, 6, 0.6);
      this.events.emit('levelUp', { level: this.save.hero.level });
      this.note('level', `level ${this.save.hero.level}`);
    }
    this.gainGemXp(amount);
  }

  /** Socketed gems earn the XP the hero earns (PoE): a level-up re-slots the bar and shows a toast. */
  private gainGemXp(amount: number): void {
    const skills = this.save.hero.skills;
    if (!skills.length) return;
    const r = addGemXp(skills, amount, this.save.hero.level);
    this.save.hero.skills = r.sockets;
    this.ports.loot.setSockets?.(r.sockets);
    if (!r.levelled.length) return;
    this.hero.setSkills?.(r.sockets);
    for (const g of r.levelled) {
      this.feedLine(t('feed.gem_level', { gem: gemName(g.id, g.link >= 0), level: g.level }), 'cyan');
      this.note('gem', `${g.id} level ${g.level}`);
    }
    this.ctx.audio.play('rl.levelUp', { pitch: 5, volume: 0.6 });
  }

  addGold(amount: number): boolean {
    if (this.save.hero.gold + amount < 0) return false;
    this.save.hero.gold += amount;
    if (amount > 0) this.session.gold += amount;
    return true;
  }

  /** Pick up one ground drop (gold or an item). */
  pickup(l: WorldLoot): boolean {
    const r = this.ports.loot.pickup(l);
    if (!r.ok) {
      this.feedLine(t('feed.inventory_full'), 'red');
      this.sound('error');
      return false;
    }
    if (r.gold) {
      this.addGold(r.gold);
      this.events.emit('gold', { amount: r.gold, at: l.position });
      this.ctx.audio.play('rl.gold', { pitch: this.fx.range(-1, 2) });
      this.ctx.particles.burst('rl.coins', l.position.clone().setY(0.3));
      this.feedGold(r.gold);
    }
    if (r.item) {
      this.session.items++;
      this.events.emit('loot', { item: r.item, at: l.position });
      this.ctx.audio.play('rl.drop');
      // a pop in the item's rarity colour where it was picked up
      this.ctx.particles.burst('sparkle', l.position.clone().setY(0.5), { count: 10, colors: ['white', l.color] });
      this.feedLine(itemLabel(r.item), l.color);
    }
    return true;
  }

  private feedLine(text: string, color: PaletteColor, gold?: number): void {
    this.feed.unshift({ text, color, t: 0, ...(gold !== undefined ? { gold } : {}) });
    if (this.feed.length > 6) this.feed.pop();
  }

  /** "+120 gold" in the feed; pickups close together add up into one line. */
  private feedGold(amount: number): void {
    const same = this.feed.find((f) => f.t < 1 && f.gold !== undefined);
    if (same) {
      same.gold! += amount;
      same.text = t('feed.gold', { count: same.gold! });
      same.t = 0;
      return;
    }
    this.feedLine(t('feed.gold', { count: amount }), 'sand', amount);
  }

  unlockCodex(id: string): void {
    const codex = (this.save.codex ??= []);
    if (codex.includes(id)) return;
    codex.push(id);
    const m = this.ports.levels.mechanics().find((x) => x.id === id);
    if (m && this.screen !== 'title') this.feedLine(t('feed.codex', { mechanic: mechanicName(m.id) }), 'cyan');
  }

  autosave(why: string): boolean {
    if (this.screen === 'title' && why !== 'quit') return false;
    this.ports.loot.write(this.save);
    const stats = (this.save.stats ??= emptyStats());
    stats.playtime = Math.round(this.playtime);
    const ok = !this.storing || this.store.save(this.slot, this.save);
    viewSaved(this.saves, this.slot, this.save);
    if (!ok) this.ctx.input.send({ rl: 'storage', error: this.store.lastError || t('menu.slots.error.unwritable') });
    this.note('save', `${why} → slot ${this.slot + 1}${ok ? '' : ' (memory only)'}`);
    return ok;
  }

  // ================================================================ difficulty & settings (MenuHost)

  difficulty(): DifficultyTuning {
    return this.save.difficulty;
  }

  setDifficulty(t: DifficultyTuning): void {
    this.save.difficulty = sanitizeTuning(t);
    this.applyMods();
  }

  /**
   * The look the settings ask for: a named one, the look studio's custom one, or null for
   * the default (which leaves a look from the URL, `?look=` / `?filters=`, alone).
   */
  private settingsLook(): Look | null {
    const s = this.settings;
    if (s.look === 'custom') return s.customLook;
    return s.look && Object.hasOwn(LOOK_PRESETS, s.look) ? LOOK_PRESETS[s.look]! : null;
  }

  /** The settings last put a look on screen (so going back to "default" takes it off again). */
  private lookFromSettings = false;

  applySettings(): void {
    const e = this.ctx.engine;
    const look = this.settingsLook();
    if (look) {
      if (!looksEqual(look, e.look)) e.setLook(look);
      this.lookFromSettings = true;
    } else if (this.lookFromSettings) {
      e.setLook(defaultLook());
      this.lookFromSettings = false;
    }
    if (this.settings.quality !== 'auto' && e.quality !== this.settings.quality) e.setQuality(this.settings.quality);
    if (!this.replaying) storeSettings(this.settings); // the player's, not a replay's
  }

  openMenu(menu: Menu, modal = true): void {
    this.layer.open(menu, { modal });
  }

  closeMenu(id?: string): void {
    this.layer.close(id);
  }

  exportSlot(slot: number): void {
    if (this.replaying) return; // a replayed click downloads nothing
    const text = this.store.exportSlot(slot);
    if (!text) return this.sound('error');
    // the download is the page's (headless: none); the sound plays either way, as frames must match
    if (this.ctx.engine.renderer.container) try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `riftlight-slot${slot + 1}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      void navigator.clipboard?.writeText(text).catch(() => {});
    } catch {
      /* downloads blocked: the agent API returns the text instead */
    }
    this.sound('click');
  }

  importSlot(slot: number): void {
    if (this.replaying) return; // the recording carries what was imported (the 'imported' command)
    if (!this.ctx.engine.renderer.container) return; // headless: no file to pick (send the 'imported' command instead)
    const input = (this.fileInput ??= Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' }));
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      void f.text().then((text) => {
        // the file is data from the page: what the slot holds now reaches the game as a command
        try {
          this.ctx.input.send({ rl: 'imported', slot, data: this.store.importSlot(slot, text) });
        } catch (e) {
          this.ctx.input.send({ rl: 'imported', slot, error: e instanceof Error ? e.message : String(e) });
        }
        input.value = '';
      });
    };
    input.click();
  }

  deleteSlot(slot: number): void {
    if (!this.replaying) this.store.remove(slot);
    viewRemoved(this.saves, slot);
    this.sound('close');
  }

  depths(): { depth: number; title: string; best?: number; next: boolean }[] {
    return unlockedDepths(this.save).map((depth) => {
      const spec = this.ports.levels.spec(depth, this.save.seed);
      return { depth, title: levelTitle(spec), best: this.save.stats?.best[String(depth)], next: depth === this.save.deepest + 1 };
    });
  }

  devGive(what: 'xp' | 'gold' | 'item' | 'level'): void {
    if (what === 'xp') this.gainXp(100 * this.save.hero.level);
    else if (what === 'level') this.gainXp(Math.max(1, (this.save.hero.xp > 0 ? 0 : 1) + SCALING.xpToNext(this.save.hero.level) - this.save.hero.xp));
    else if (what === 'gold') {
      this.addGold(500);
      this.feedGold(500);
    } else {
      const item = this.ports.loot.give(this.rng.fork(`give:${this.gifts++}`), this.save.hero.level);
      if (item) this.feedLine(itemLabel(item), 'sand');
    }
  }

  devKillAll(): void {
    for (const m of this.level?.monsters() ?? []) {
      const a = m.actor;
      if (!a.alive) continue;
      const hit = { source: this.hero.actor, tags: ['dev'], damage: { chaos: a.life * 10 + 1e6 }, crit: false };
      const result = a.takeHit(hit);
      // an Actor emits its own hit and (through die) its kill: drops, XP, the bot's count, once each
      if (a instanceof Actor) continue;
      this.events.emit('hit', { target: a, result, hit });
      if (result.killed) this.events.emit('kill', { target: a, killer: this.hero.actor, rank: m.rank, depth: this.level!.spec.depth });
    }
  }

  devSpawn(seed = this.rng.int(1, 1e9)): void {
    if (!this.level) return;
    const p = this.hero.actor.position;
    this.level.spawn(seed, new Vector3(p.x + 3, 0, p.z - 2));
  }

  devTeleport(depth: number): void {
    void this.enterDepth(depth);
  }

  setTimeOfDay(t: number): void {
    this.town.dayTime = ((t % 1) + 1) % 1;
  }

  timeOfDay(): number {
    return this.town.dayTime;
  }

  sound(s: 'click' | 'move' | 'open' | 'close' | 'equip' | 'error' | 'buy' | 'sell'): void {
    const name = s === 'buy' || s === 'sell' ? 'buy' : s;
    this.ctx.audio.play(`rl.${name}`, s === 'sell' ? { pitch: -5 } : {});
  }

  // ================================================================ panels

  /** What a panel may ask of the shell; `close` closes that panel (`self` is set once it exists). */
  private panelHost(self: { panel?: Panel; as?: string } = {}): PanelHost {
    return {
      services: this.services,
      save: () => this.save,
      gold: () => this.save.hero.gold,
      addGold: (n) => this.addGold(n),
      level: () => this.save.hero.level,
      changed: (what) => {
        if (what === 'tree' || what === 'gear') this.applyMods();
        if (what === 'skills') this.hero.setSkills?.(this.save.hero.skills);
        this.goldShown = Math.min(this.goldShown, this.save.hero.gold);
      },
      sound: (s) => this.sound(s),
      close: () => (self.panel ? this.layer.close(self.panel.id) : this.layer.close()),
      glyphs: () => this.padGlyphs(),
      // the line is the panel's the townsperson opened (Oru's respec), never one opened over it (P over Ilsa's vendor)
      talk: () => (this.dialogueLine && self.as === this.talkPanel ? talkText(this.dialogueLine) : null),
    };
  }

  openPanel(id: 'inventory' | 'skills' | 'tree' | 'character' | 'codex' | 'vendor' | 'stash' | 'crafting' | 'respec' | 'rift' | 'pause' | 'tuning' | 'settings' | 'dev' | 'slots' | 'look'): Panel | null {
    if (this.screen === 'title' && !['settings', 'slots', 'look'].includes(id)) return null;
    const self: { panel?: Panel; as?: string } = { as: id };
    const host = this.panelHost(self);
    const loot = this.ports.loot;
    let panel: Panel;
    let modal = true;
    switch (id) {
      case 'inventory':
        panel = loot.inventoryView(host);
        modal = false;
        break;
      case 'skills': {
        const skills = loot.skillsView?.(host);
        if (!skills) return null;
        panel = skills;
        modal = false;
        break;
      }
      case 'tree':
      case 'respec':
        panel = this.ports.tree.view(host, { respec: id === 'respec' });
        break;
      case 'character':
        this.closeItems(); // the item windows' canvas would cover a HUD panel
        panel = new CharacterSheet(() => this.hero.actor.stats, () => t('character.subtitle', { level: this.save.hero.level, depth: this.save.deepest }));
        modal = false;
        break;
      case 'codex':
        this.closeItems();
        panel = new Codex(() => this.ports.levels.mechanics(), () => this.save.codex ?? []);
        break;
      case 'vendor':
        panel = loot.vendorView(host);
        modal = false;
        break;
      case 'stash':
        panel = self.panel = loot.stashView(host);
        modal = false;
        this.town.openChest(true);
        this.layer.open(panel, { modal, onClose: () => this.town.openChest(false) });
        return panel;
      case 'crafting':
        panel = loot.craftingView(host);
        modal = false;
        break;
      case 'rift':
        panel = riftMenu(this);
        break;
      case 'pause':
        panel = pauseMenu(this);
        break;
      case 'tuning':
        panel = tuningMenu(this);
        break;
      case 'settings':
        panel = settingsMenu(this);
        break;
      case 'dev':
        panel = devMenu(this);
        break;
      case 'slots':
        panel = slotsMenu(this, 'load');
        break;
      case 'look':
        this.lookStudio();
        return this.layer.top?.panel ?? null;
    }
    self.panel = panel;
    this.layer.open(panel, { modal, onClose: () => this.endTalk() });
    return panel;
  }

  /** Close the item windows (inventory, stash, vendor, bench, skills), if one is open. */
  private closeItems(): void {
    const items = this.layer.stack.find((o) => o.panel.group === ITEM_GROUP);
    if (items) this.layer.close(items.panel.id, true);
  }

  private endTalk(): void {
    this.talkingTo?.endTalk();
    this.talkingTo = null;
    this.dialogueLine = null;
    this.talkPanel = null;
  }

  // ================================================================ per frame

  /**
   * What input brings once a frame, taken as early as it can be (before the first fixed step, or in
   * `update` on a frame without one): an agent's input (`agentInput`), the controller's turn
   * (`turnAim`) and the couch guests who joined (`coop.frame`).
   */
  private frameInput(ctx: GameContext): void {
    const commands = ctx.input.commands;
    if (commands === this.frameTaken) return;
    this.frameTaken = commands;
    this.agentInput(commands);
    this.turnAim(ctx);
    this.coop.frame(); // pads that joined this frame take their seats
  }

  /**
   * Motion aim off (the Settings row, or 52in1 no longer lets games read the controller's motion:
   * `input.motion.on`, which no recording holds) with a direction kept lets go of it, through a
   * command (`rl: 'motion'`, in `agentInput` next frame), so a replay lets go where the run did. On
   * any live frame, not only as it goes off: a save-state restored, or a replay that ended, while
   * steering keeps a direction with motion aim off. Live frames only: a replay has the recorded
   * commands.
   */
  private watchMotion(ctx: GameContext): void {
    if (!ctx.input.motion.on && this.motionAim && !this.replaying) ctx.input.send({ rl: 'motion', on: false });
  }

  /**
   * An agent's input this frame (`rl.step`, `rl.moveTo`, `rl.fight`, the bot: the intent it holds
   * and what the bot does besides), recorded like the keys, so an agent's run replays.
   */
  private agentInput(commands: readonly unknown[]): void {
    this.botIntent = null; // an intent lasts the frame it arrives in: the player's input again after
    for (const c of commands) {
      const m = c as Partial<RiftCommand> | null;
      if (m?.rl === 'intent' && typeof m.intent?.move?.x === 'number' && Array.isArray(m.intent.aim)) this.botIntent = fromSaved(m.intent);
      else if (m?.rl === 'bot') this.botAct(m.act);
      else if (m?.rl === 'motion' && m.on === false) this.motionAim = null; // `watchMotion`
    }
  }

  private botAct(act: BotAct | undefined): void {
    if (act === 'close') this.layer.close();
    else if (act === 'death' && this.layer.has('death')) this.goTown('death');
    else if (act === 'portal' && this.layer.has('loot')) {
      for (const l of [...this.ports.loot.ground()]) if (!l.filtered) this.pickup(l);
      this.returnToTown();
    }
  }

  /**
   * Motion aim (a DualSense through 52in1, recorded as `input.motionTurn`): the controller's turn
   * this frame turns the pad's aim, `AIM.gyro` degrees a degree as the screen shows it (turned left:
   * the aim turns left), from where motion aim keeps it, else from where the hero aims now. In play
   * with no panel open (a turn while browsing the inventory never aims), on the pad, while the right
   * stick lets it (the stick sets the direction itself: `readIntent`); the keyboard and mouse and
   * touch never keep one.
   */
  private turnAim(ctx: GameContext): void {
    const input = ctx.input;
    const deg = input.device === 'pad' ? input.motionTurn.x * AIM.gyro : 0;
    if (!deg || (this.screen !== 'town' && this.screen !== 'level') || this.worldPaused || this.layer.top || this.dead || this.showcase?.active || this.botIntent) return;
    if (Math.hypot(input.lookAxis.x, input.lookAxis.y) > AIM.stick) return;
    cameraBasis(ctx.engine, this.right, this.forward);
    const hp = this.hero.actor.position;
    let dx = this.motionAim ? this.motionAim.x : this.intent.aim.x - hp.x;
    let dz = this.motionAim ? this.motionAim.z : this.intent.aim.z - hp.z;
    if (Math.hypot(dx, dz) < 1e-3) [dx, dz] = [this.forward.x, this.forward.z]; // aimed at its own feet: up the screen
    const d = turnOnScreen(dx, dz, deg, this.right, this.forward);
    const len = Math.hypot(d.x, d.z);
    this.motionAim = { x: d.x / len, z: d.z / len, idle: 0 };
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    this.frameInput(ctx);
    if (this.showcase?.active) return this.showcase.fixedUpdate(dt);
    if (this.screen !== 'town' && this.screen !== 'level') return;
    if (this.worldPaused) return;
    const intent = this.botIntent ?? this.readIntent(ctx, dt);
    if (this.dead) {
      this.intent.move.x = this.intent.move.z = 0;
      this.hero.fixedUpdate(dt, { ...this.intent, attack: false, skill: -1, dodge: false, held: 0 });
    } else this.hero.fixedUpdate(dt, intent);
    this.coop.fixedUpdate(dt);
    this.level?.fixedUpdate(dt, this.hero);
    this.round?.fixedUpdate(dt, intent);
    if (this.botIntent?.interact) this.interactQueued = true;
  }

  /** The world freezes under modal panels (pause, tuning, tree, recap) and while loading. */
  get worldPaused(): boolean {
    return this.screen === 'loading' || this.layer.modal || (this.round?.frozen ?? false);
  }

  /** Player intent from keys, mouse, pad and touch (fixed step). */
  private readIntent(ctx: GameContext, dt: number): HeroIntent {
    const input = ctx.input;
    const i = this.intent;
    const panelOpen = !!this.layer.top;
    // a window on top takes navigation (every panel does: the item windows, the character sheet,
    // the menus): its d-pad, left stick, WASD and arrows move its focus and hold the hero still,
    // as Engine World's panels do; the world runs on under a window that is not modal (a touch
    // screen's floating stick hides under a panel, so a finger moved nothing there already)
    const axis = panelOpen ? HELD : input.moveAxis();
    cameraBasis(ctx.engine, this.right, this.forward);
    i.move.x = this.right.x * axis.x + this.forward.x * axis.y;
    i.move.z = this.right.z * axis.x + this.forward.z * axis.y;
    // the mouse aims where it points; a pad's right stick (while the pad is the device in use,
    // recorded) along itself, snapped to a monster close to that line (aim assist), and so does
    // motion aim along the direction the controller's turns keep (`turnAim`; the stick sets that
    // direction while it leans); else, and with a finger, the nearest monster ahead (`autoAim`)
    const mouseAim = input.device !== 'pad' && !this.pointer.touch && this.pointer.known && this.pointer.idle < AIM.hold;
    const hp = this.hero.actor.position;
    const look = input.lookAxis;
    if (input.device !== 'pad') this.motionAim = null;
    const motion = this.motionAim;
    if (input.device === 'pad' && Math.hypot(look.x, look.y) > AIM.stick) {
      const dx = this.right.x * look.x + this.forward.x * look.y;
      const dz = this.right.z * look.x + this.forward.z * look.y;
      stickAim(hp, dx, dz, this.level?.actors() ?? [], hostile, i.aim);
      if (motion) Object.assign(motion, { x: dx / Math.hypot(dx, dz), z: dz / Math.hypot(dx, dz), idle: 0 });
    } else if (motion) stickAim(hp, motion.x, motion.z, this.level?.actors() ?? [], hostile, i.aim);
    else if (mouseAim && this.pointer.ground(this.tmp, hp.y)) i.aim.copy(this.tmp);
    else i.aim.copy(this.autoAim());
    const overUi = panelOpen && this.layer.top && this.ui.hover(this.layer.top.rect);
    // the mouse buttons are keys: held, or pressed since the last step (a click shorter than a
    // frame); a press is used up here even when a panel takes it, so it never fires later
    const fingerPress = input.consumeAny(FINGER);
    const mousePress = input.consumeAny(MOUSE_LEFT);
    const press = fingerPress || mousePress;
    const hold = input.anyDown(MOUSE.left);
    // a press this frame counts where it went down (a tap's finger: the pointer is placed after this step)
    let down: { x: number; y: number; touch: boolean } | null = null;
    for (const e of input.buttonEvents) if (e.down && (MOUSE.left as readonly string[]).includes(e.code)) down = { ...ndcToArt(ctx.engine, e.x, e.y), touch: e.code === TOUCH_KEY };
    // a click on a thing in the world (a townsperson, a loot label, the portal) goes there, and a
    // finger's tap on a loot label or the interact prompt does it (`update`); a finger on the loot
    // feed or the centre banner may swipe it away: no swing while that button stays down (nor
    // while a press the map took stays down). `update` takes a finger's press there as well, for a
    // finger that lands in a frame no fixed step runs in; a click is hit-tested where it went down
    // (`worldAt`: the hover's label may be gone from a mouse at rest)
    if (press) this.pressTaken = !!(down && !down.touch ? this.worldAt(down.x, down.y) : this.worldFocus) || (!!down?.touch && this.fingerTaken(down.x, down.y));
    else if (!hold) this.pressTaken = false;
    // a finger alone on the world swings once it has stayed down `FINGER_WAIT` steps after the one
    // it landed in: a second finger landing by then lets go of it (a pinch: `Input`), so a pinch is
    // no swing, its fingers a frame or two apart too (the mouse's button swings at once)
    const finger = input.anyDown(FINGER) && !input.anyDown(MOUSE_LEFT);
    this.fingerHeld = !finger ? 0 : fingerPress ? 1 : this.fingerHeld + 1;
    // a finger's press never swings by itself, only a finger still down past the wait: a pinch's
    // first finger let go before a step read it (a frame with no fixed step) is no swing either
    const left = (mousePress || hold) && !this.pressTaken && !(finger && this.fingerHeld <= FINGER_WAIT);
    const right = input.consumeAny(MOUSE.right) || input.anyDown(MOUSE.right);
    const onHud = this.pointerOnHud(down ?? this.pointer.art);
    // the keys' and buttons' actions (a couch guest's pad reads the same: `readActions`), then the mouse's
    readActions(input, i);
    i.attack = !overUi && (i.attack || (left && !onHud));
    if (right && !overUi) i.skill = 0;
    // held skill keys keep channels (whirlwind, beams) going
    if (input.anyDown(MOUSE.right) && !overUi) i.held |= 1;
    if (panelOpen) {
      i.attack = false;
      i.skill = -1;
      i.held = 0;
      i.dodge = false;
    }
    // motion aim holds while the hero acts along it, and lets go `AIM.hold` s after it last did or turned
    if (motion) {
      motion.idle = i.attack || i.skill >= 0 || i.held ? 0 : motion.idle + dt;
      if (motion.idle >= AIM.hold) this.motionAim = null;
    }
    // a finger's assists on a page with touch controls, where Settings has their rows (recorded
    // input, density and settings only: the pad, the keyboard and the mouse play as they always
    // have, and so does a touch on a desktop's page, a touchscreen laptop's)
    if (this.touchControls && input.device === 'touch' && !panelOpen) this.touchAssist(i, axis);
    this.walk(i, axis, panelOpen, dt);
    return i;
  }

  /**
   * What a touch screen adds to the hero's intent, each a setting (on by default):
   * - aim assist (`touchAimAssist`): with the stick pushed, the nearest monster within
   *   `TOUCH_AIM.range` m in a `TOUCH_AIM.cone`° cone of it, else one point-blank
   *   (`TOUCH_AIM.blank` m), else along the stick (`touchAim`);
   * - auto attack (`touchAutoAttack`): the basic attack on the nearest living monster in its reach
   *   (`attackReach`: the bot's rule) when no skill or dodge was pressed, the hero isn't busy or on
   *   its way somewhere, and the stick doesn't point away from it (so kiting works), so the other
   *   thumb is free for the skills.
   */
  private touchAssist(i: MutableIntent, axis: { x: number; y: number }): void {
    const foes = this.level?.actors() ?? [];
    if (this.settings.touchAimAssist) this.touchAim(i, axis, foes);
    if (!this.settings.touchAutoAttack || i.attack || i.skill >= 0 || i.dodge || this.walkTo || this.hero.busy > 0 || this.dead) return;
    const hp = this.hero.actor.position;
    const slot = this.hero.skills().find((s) => s.slot === 'attack');
    let target: ActorLike | null = null;
    let best = Infinity;
    for (const a of foes) {
      if (!a.alive || !hostile(a)) continue;
      const dx = a.position.x - hp.x;
      const dz = a.position.z - hp.z;
      const d = Math.hypot(dx, dz);
      if (d > attackReach(slot?.tags, a.radius) || d >= best) continue;
      // the stick leaning away from it: the player is getting away (kiting), not fighting
      if (Math.hypot(axis.x, axis.y) > 0.1 && dx * i.move.x + dz * i.move.z < 0) continue;
      best = d;
      target = a;
    }
    if (!target) return;
    i.attack = true;
    i.aim.copy(target.position);
  }

  /** A finger's aim (`touchAssist`): along the stick at the monster nearest it, else one point-blank, else on along it; the stick idle, auto-aim. */
  private touchAim(i: MutableIntent, axis: { x: number; y: number }, foes: readonly ActorLike[]): void {
    if (Math.hypot(axis.x, axis.y) <= TOUCH_AIM.stick) return; // `autoAim` stands
    const hp = this.hero.actor.position;
    const target = coneTarget(hp, i.move.x, i.move.z, TOUCH_AIM.cone, TOUCH_AIM.range, foes, hostile) ?? coneTarget(hp, 1, 0, 180, TOUCH_AIM.blank, foes, hostile);
    if (target) i.aim.copy(target.position);
    else {
      const len = Math.hypot(i.move.x, i.move.z) || 1;
      i.aim.set(hp.x + (i.move.x / len) * AIM.reach, hp.y, hp.z + (i.move.z / len) * AIM.reach);
    }
  }

  /**
   * On the way to a thing clicked (`walkTo`): the hero walks there the way `moveTo` does (`HeroWalk`:
   * the town's walkable grid, a level's grid route), unless the player moves, attacks, casts or
   * dodges, a panel opens, it is gone, or it gets no closer for `WALK.giveUp` steps (something in
   * the way). Arriving does it (`arrive`, in `update`).
   */
  private walk(i: MutableIntent, axis: { x: number; y: number }, panelOpen: boolean, dt: number): void {
    const w = this.walkTo;
    if (!w) return;
    const goal = this.walkGoal(w.target);
    w.time += dt;
    const own = Math.hypot(axis.x, axis.y) > 0.1 || i.attack || i.skill >= 0 || i.dodge;
    const p = this.hero.actor.position;
    const d = goal ? Math.hypot(goal.x - p.x, goal.z - p.z) : 0;
    if (d < w.best - WALK.progress) {
      w.best = d;
      w.since = 0;
    } else w.since++;
    if (!goal || own || panelOpen || w.since > WALK.giveUp) {
      this.walkTo = null;
      return;
    }
    i.move.x = i.move.z = 0;
    if (this.level) w.nav.level(this.level, p, goal, i.move);
    else w.nav.town(this.town, p, goal, i.move);
    const len = Math.hypot(i.move.x, i.move.z);
    if (len > 1) {
      i.move.x /= len;
      i.move.z /= len;
    }
  }

  /**
   * Aim without a mouse or the right stick (keys, the left stick, a finger): the nearest monster in
   * the cone ahead (along the move, else where the hero aimed last: the hero's rule, actors/aim.ts),
   * else the nearest one around (within `AIM_AROUND` m), else on along the move or where it aimed.
   */
  private autoAim(): Vector3 {
    autoAim(this.hero.actor.position, this.intent.move, this.intent.aim, AIM_AROUND, this.level?.actors() ?? [], hostile, this.tmp);
    return this.tmp;
  }

  /**
   * A swipe (recorded) where it started (`Pointer.touchDown`, from the recorded touches): on the
   * NPC's line over a panel it ends the talk; on a panel (`UiLayer.swipe`) it closes it as back
   * does; with no panel, on the centre banner it ends it and on the loot feed it clears it. A
   * swipe a panel moves with (a list's scroll, a slider) or that starts elsewhere does nothing here.
   */
  private swipe(dir: SwipeDirection): boolean {
    const at = this.pointer.touchDown;
    if (!at) return false;
    const on = (r: Box | null | undefined) => !!r && inside(r, at.x, at.y);
    const top = this.layer.top;
    if (top) {
      // the line where it shows (over the panels: `talkPlace`)
      if (this.dialogueLine && on(this.touchable.dialogue) && !top.sticky) {
        this.layer.close(top.panel.id);
        return true;
      }
      return this.layer.swipe(dir, at.x, at.y);
    }
    if (this.screen !== 'town' && this.screen !== 'level') return false;
    if (!this.round && this.banners.current && on(this.hudRects().zones.find((z) => z.id === 'banner'))) {
      this.banners.skip();
      return true;
    }
    if (this.touchable.feed.some(on)) {
      this.feed.length = 0;
      return true;
    }
    return false;
  }

  /**
   * The thing in the world at (`x`, `y`) art pixels as last drawn, for a click there (`goTo`): a
   * townsperson or the stash, a loot label, the level's open portal; null on a panel, in a showcase
   * mode, or on nothing. Hit-tested at the press, so a click where the mouse came to rest (its hover
   * label gone after `ui.pointer.used`'s four seconds: `worldFocus` is the hover's) still goes there.
   */
  private worldAt(x: number, y: number): WalkTarget | null {
    if (this.showcase?.active || this.layer.covers(x, y)) return null;
    const ui = this.ui;
    const cam = this.ctx.engine.camera.camera;
    const on = (b: Box | null) => !!b && inside(b, x, y);
    if (this.screen === 'town') {
      const thing = this.town.interactables.find((it) => on(thingBox(it, cam, ui)));
      return thing ? { kind: 'it', id: thing.id } : null;
    }
    if (this.screen !== 'level' || !this.level) return null;
    const label = this.touchable.loot.find((l) => inside(l.rect, x, y));
    if (label) return { kind: 'loot', id: label.id };
    return !this.round && this.level.exitOpen && on(worldBox(this.level.exit, 2.2, 1.6, cam, ui)) ? { kind: 'portal' } : null;
  }

  /**
   * The item windows (`boxes`) and, while the panels draw their legends (a pad or the keys), the row
   * above them where the windows' legend goes when the one under them would cover the HUD
   * (`ItemsUi.legendAt`): what an NPC's line keeps clear of over the item windows.
   */
  private windowsAndLegend(boxes: readonly Box[]): Box[] {
    if (!boxes.length || !this.layer.legendsOn(this.ui.device)) return [...boxes];
    const left = Math.min(...boxes.map((b) => b.x));
    const top = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    return [...boxes, { x: left, y: Math.max(0, top - 12), w: right - left, h: Math.min(12, top) }];
  }

  /** Where the NPC's line goes, clear of `blocked` (a panel, the item windows) and the HUD (`talkPlace`; laid out again only when something changed). */
  private placeTalk(blocked: readonly Box[]): TalkPlace {
    const ui = this.ui;
    const all = [...blocked, ...this.hudZonesShown.map(({ x, y, w, h }) => ({ x, y, w, h }))];
    const key = `${this.dialogueLine}|${ui.w}x${ui.h}|${all.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join(';')}`;
    if (key !== this.talk.key || !this.talk.place) {
      this.talk.key = key;
      this.talk.place = talkPlace(ui, this.dialogueLine!, all);
    }
    return this.talk.place;
  }

  /** The NPC's line shows: in free space while the talk lasts, over the panels for `talkSeconds` after it was said. */
  private talkShows(place: TalkPlace): boolean {
    return !place.over || this.time - this.talk.said < talkSeconds(talkText(this.dialogueLine ?? ''));
  }

  /**
   * A pointer on the NPC's line as last drawn: a press there is the line's (not the panel's under
   * it); let go without a swipe (a tap, a click) the line goes, and with one the talk ends
   * (`swipe`). True when the event was the line's.
   */
  private talkPointer(ctx: GameContext, e: Extract<UiEvent, { kind: 'pointer' }>): boolean {
    if (e.type === 'down') {
      this.talk.press = !!this.touchable.dialogue && inside(this.touchable.dialogue, e.x, e.y) && !!this.layer.top;
      return this.talk.press;
    }
    if (e.type !== 'up' || !this.talk.press) return false;
    this.talk.press = false;
    if (!ctx.input.wasPressed(...Object.values(SWIPE_KEYS))) this.talk.gone = true;
    return true;
  }

  /** A finger down at (`x`, `y`) art pixels is no swing: it taps a loot label or the interact prompt (`touchTarget`), or may swipe away the loot feed or the centre banner (`onDismissable`). */
  private fingerTaken(x: number, y: number): boolean {
    return this.touchTarget(x, y) !== null || this.onDismissable(x, y);
  }

  /** (`x`, `y`) art pixels is on the loot feed or the centre banner as last drawn (a swipe from there dismisses it). */
  private onDismissable(x: number, y: number): boolean {
    if (this.touchable.feed.some((r) => inside(r, x, y))) return true;
    const banner = this.banners.current && !this.round ? this.hudRects().zones.find((z) => z.id === 'banner') : undefined;
    return !!banner && inside(banner, x, y);
  }

  /** What a finger's tap at (`x`, `y`) art pixels does in the world, as last drawn: the interact prompt, a loot label, or nothing (null). */
  private touchTarget(x: number, y: number): 'prompt' | { loot: number } | null {
    if (this.layer.top || this.showcase?.active) return null;
    if (this.touchable.prompt && inside(this.touchable.prompt, x, y)) return 'prompt';
    const label = this.touchable.loot.find((l) => inside(l.rect, x, y));
    return label ? { loot: label.id } : null;
  }

  private pointerOnHud(p: { readonly x: number; readonly y: number } = this.pointer.art): boolean {
    return (p.y > this.ui.h - 36 && Math.abs(p.x - this.ui.w / 2) < 90) || this.onMap(p.x, p.y, true);
  }

  /**
   * (`x`, `y`) in art pixels is on the corner map, or on the level's map while it is open: a click or
   * tap there opens or closes it (and is no attack). `band`: the corner map's part in 52in1's wake
   * band counts too (no attack there either, though a tap there is the hub's and opens nothing).
   */
  private onMap(x: number, y: number, band = false): boolean {
    if (!this.level || this.layer.top || this.screen !== 'level') return false;
    const ui = this.ui;
    const g = this.geometry();
    // in 52in1 on a touch page only below the hub's wake band, where `hudGeometry` could not move it
    // (a tap in the band is the hub's: it brings its bar over the game)
    const wake = g.touch && !band ? this.touchPad.wakeArt() : 0;
    let box: Box = { x: ui.w - g.map.w - 6, y: Math.max(g.map.y, wake), w: g.map.w + 4, h: g.map.y + g.map.h + 4 - Math.max(g.map.y, wake) };
    if (this.mapOpen) {
      const v = mapView(this.mapRoom(), this.minimapModel()!);
      box = { x: v.x - 3, y: v.y - 3, w: v.w + 6, h: v.h + 6 };
    }
    return x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h;
  }

  /** Where the level's map goes (art pixels): the play's middle, under a boss's bar and above the bottom HUD. */
  private mapRoom(): Box {
    const ui = this.ui;
    const g = this.geometry();
    const boss = this.level?.boss();
    let top = 8;
    if (boss && boss.life > 0) {
      // under the boss's name and bar as the HUD places them while the big map shows (no corner map)
      const model = this.hudModel();
      model.controls = this.hudControls;
      model.minimap = null;
      const bar = hudBoxes(ui.w, ui.h, model).find((b) => b.id === 'boss');
      top = Math.max(30, bar ? bar.y + bar.h + 5 : 0);
    }
    return { x: 6, y: top, w: ui.w - 12, h: g.top - 6 - top };
  }

  /** The page has touch controls (its art density is a touch page's: recorded): a finger's assists apply, and Settings shows their rows (`MenuHost.touchControls`). */
  get touchControls(): boolean {
    return this.ctx.engine.renderer.touchDensity > 0;
  }

  /** Prompts show the pad's buttons: the pad is the input used last (`controls.device`; a pad merely connected is not). */
  padGlyphs(): boolean {
    return this.controlDevice() === 'pad';
  }

  /**
   * The device prompts name controls for (glyphs, as `{key:action}` in a line does): the engine's
   * (`engine.controls.device`), the input used last, except that a touch names the keys while no
   * touch controls show (a tap on a touch-screen laptop). The keyboard and mouse, the pad, or a touch
   * screen's buttons. Prompts only: what steers aim reads `input.device`, which is recorded.
   */
  controlDevice(): ControlDevice {
    return this.ctx.engine.controls.device;
  }

  update(ctx: GameContext, dt: number): void {
    this.frameInput(ctx);
    this.watchMotion(ctx);
    for (const c of ctx.input.commands) this.command(c);
    this.round?.update(ctx.input.commands, dt);
    this.time += dt;
    const ui = this.ui;
    ui.time = this.time;
    ui.device = this.controlDevice();
    ui.padStyle = ctx.engine.controls.style;
    ui.touchpad = touchpadSwipes(ctx.engine);
    // rows and tabs a thumb tall on a page with touch controls (the art size: recorded)
    this.layer.tap = tapArt(ctx.engine.renderer);
    // pointer and menu input → the panel stack, then game hotkeys
    const events: UiEvent[] = [...this.pointer.frame(dt), ...this.menuInput.events(ctx.input, dt)].map((e) => this.shellEvent(ctx, e));
    ui.pointer.x = this.pointer.art.x;
    ui.pointer.y = this.pointer.art.y;
    ui.pointer.used = this.pointer.idle < 4 && !this.pointer.touch;
    this.syncTouch();
    this.feel.update(dt);
    this.lightBar();
    if (this.showcase.active) {
      ctx.input.joinWith = null; // nobody joins in the showcase (`joinPolicy` runs only out of it)
      this.syncLatch();
      return this.showcase.update(dt, events);
    }
    this.layer.update(dt);
    // Options from any screen of play: it pauses, and on the pause menu it resumes (a press no menu reads)
    let consumed = ctx.input.wasPressed(...KEYS.options) && this.options();
    for (const e of events) {
      // a swipe dismisses what it started on: a panel, the NPC's line, a banner, the loot feed
      if (e.kind === 'swipe' && this.swipe(e.dir)) {
        consumed = true;
        continue;
      }
      // H on the look studio hides its panel (or shows it): the layer still routes keys to it
      if (e.kind === 'key' && (KEYS.hide as readonly string[]).includes(e.code) && this.layer.togglePeek()) {
        consumed = true;
        continue;
      }
      // L1 / R1 (Q / E) on a character screen: the one before or after it in the ring; a click on the strip's names too
      const dir = e.kind === 'key' ? pageDir(e.code) : 0;
      const strip = e.kind === 'pointer' && e.type === 'down' ? this.pageStrip.find((r) => inside(r, e.x, e.y)) : undefined;
      if ((dir && this.page(dir)) || (strip && this.showPage(strip.page))) {
        consumed = true;
        if (strip) ctx.input.clearQueued(...MOUSE.left, ...MOUSE.right);
        continue;
      }
      // a tap (or click) on an NPC's line puts it away, a swipe on it ends the talk (`swipe`): the
      // press is the line's, never the window's under it
      if (e.kind === 'pointer' && this.talkPointer(ctx, e)) {
        ctx.input.clearQueued(...MOUSE.left, ...MOUSE.right);
        continue;
      }
      if (this.layer.top && this.layer.input(e)) {
        consumed ||= e.kind !== 'pointer';
        // a click a panel took (Resume, a close box) is not an attack once the panel is gone
        if (e.kind === 'pointer' && e.type === 'down') ctx.input.clearQueued(...MOUSE.left, ...MOUSE.right);
        continue;
      }
      // a click or tap on the corner map opens the level's map, one on the map closes it
      if (e.kind === 'pointer' && e.type === 'down' && e.button === 0 && this.onMap(e.x, e.y)) {
        this.mapOpen = !this.mapOpen;
        this.pressTaken = true;
        ctx.input.clearQueued(...MOUSE.left);
        continue;
      }
      // the world: a click on a townsperson, the stash, a loot label or the open portal goes there
      // and does it, hit-tested where it went down (`worldAt`), its hover label shown or not
      if (e.kind === 'pointer' && e.type === 'down' && (e.button ?? 0) === 0 && !e.touch) {
        const at = this.worldAt(e.x, e.y);
        if (at) this.goTo(at);
      }
      // a finger's tap on a loot label picks it up (walking there), on the interact prompt does it;
      // one there, on the loot feed or on the centre banner (a swipe from there dismisses it) is no
      // swing while it stays down, whether or not a fixed step ran in the frame it landed (`readIntent`)
      if (e.kind === 'pointer' && e.type === 'down' && e.touch && !this.layer.top && !this.dead) {
        const hit = this.touchTarget(e.x, e.y);
        if (hit === 'prompt') this.interactQueued = true;
        else if (hit) this.goTo({ kind: 'loot', id: hit.loot });
        if (this.fingerTaken(e.x, e.y)) {
          ctx.input.clearQueued(...MOUSE.left);
          this.pressTaken = true;
        }
      }
    }
    this.arrive();
    this.keepInReach();
    // a key a menu used this frame (Esc closing a panel) must not also reopen one
    if (!consumed) this.hotkeys(ctx);

    if (this.screen === 'town' || this.screen === 'level' || this.screen === 'title') {
      if (!this.worldPaused) this.advance(dt);
      else if (this.screen === 'town' || this.screen === 'title') this.town.update(0, null); // keep town lights/sky consistent
      else if (this.round) this.banners.update(dt); // a round's countdown shows over the still world
    }
    this.updateCamera(ctx, dt);
    this.joinPolicy(ctx);
    this.syncLatch(); // after this frame's presses: a panel R2 opened lets go at once
    this.draw(ctx);
    // the wheel zooms the camera through the settings (and is consumed so the rig doesn't)
    if (ctx.input.wheel && !this.layer.top) {
      this.settings.zoom = Math.max(0.6, Math.min(1.6, this.settings.zoom * Math.pow(1.08, -ctx.input.wheel)));
    }
    ctx.input.wheel = 0;
  }

  /**
   * Couch co-op is offered (its pause menu entry, the town's line, joins): never in a 52in1 round
   * (its players are the hub's) nor in the showcase.
   */
  private get couchOffered(): boolean {
    return !this.round && !this.showcase?.active;
  }

  /** The Couch co-op menu's seats while couch co-op is offered (`MenuHost.couch`), else null. */
  couch(): LocalCoop | null {
    return this.couchOffered ? this.coop : null;
  }

  /**
   * Couch co-op (`game/coop.ts`): who may join at the next poll (`input.joinWith`, Cross). In the
   * Couch co-op menu any pad but player 1's in use; in town, while player 1 plays on a pad, another
   * pad (player 1 on the keyboard picking a pad up must not join by mistake: the menu is the way
   * then). Never in a 52in1 round or the showcase, nor with every seat taken. Joins themselves are
   * recorded input.
   */
  private joinPolicy(ctx: GameContext): void {
    const input = ctx.input;
    const town = this.screen === 'town' && !this.layer.top && !this.dead && input.device === 'pad';
    input.joinWith = this.coop.open && this.couchOffered && (this.layer.has('coop') || town) ? KEYS.join : null;
  }

  /** The town says how to join (`menu.coop.join`): couch co-op offered, player 1 on a pad, a seat free, and a pad that isn't player 1's connected. */
  private joinHint(): boolean {
    const input = this.ctx.input;
    if (!this.coop.open || !this.couchOffered || this.layer.top || this.dead || input.device !== 'pad') return false;
    for (let slot = 0; slot < MAX_PADS; slot++) if (input.player(slot).connected && !input.joined.has(slot) && slot !== input.padIndex) return true;
    return false;
  }

  /** Shift+Tab: the tab before (the menus hear Tab as the next one). */
  private shiftTab(ctx: GameContext): boolean {
    return ctx.input.wasPressed('Tab') && ctx.input.anyDown(SHIFT);
  }

  /**
   * A menu event as the shell's panels take it: Shift+Tab is the tab before; in the stash, the
   * vendor and the bench (no page of the ring) L1 / R1 and Q / E are their tabs, as before.
   */
  private shellEvent(ctx: GameContext, e: UiEvent): UiEvent {
    if (e.kind === 'tab' && e.dir === 1 && this.shiftTab(ctx)) return { kind: 'tab', dir: -1 };
    const dir = e.kind === 'key' ? pageDir(e.code) : 0;
    const top = this.layer.top?.panel;
    if (dir && top?.group === ITEM_GROUP && !pageOf(top)) return { kind: 'tab', dir };
    return e;
  }

  /** L1 / R1 (Q / E) on a character screen: the one before or after it in the ring (`PAGES`), in its place. */
  page(dir: 1 | -1): boolean {
    const top = pageOf(this.layer.top?.panel);
    if (!top) return false;
    const i = PAGES.indexOf(top);
    for (let k = 1; k < PAGES.length; k++) if (this.showPage(PAGES[(i + dir * k + PAGES.length * k) % PAGES.length]!)) return true;
    return false;
  }

  /** Open a character screen in place of the one showing (a pause menu under it stays). False when it can't open (no such view). */
  showPage(page: Page): boolean {
    const was = pageOf(this.layer.top?.panel);
    if (this.layer.top?.panel.id === page) return false;
    if (!this.openPanel(page)) return false;
    if (was && this.layer.has(was)) this.layer.close(was, true);
    return true;
  }

  /**
   * Options (a pad's Start) in town or a level, the console's way: with nothing open it pauses; on
   * the pause menu (and what opened over it) it resumes; over another panel (the item windows, the
   * character sheet, the codex, the tree, a townsperson's menu) it closes them and pauses. Not
   * while the death recap shows, in a session round or a showcase mode. Esc stays back first, then
   * pause. True when it did something.
   */
  private options(): boolean {
    if ((this.screen !== 'town' && this.screen !== 'level') || this.round || this.dead || this.showcase.active) return false;
    const stack = this.layer.stack;
    if (stack.some((o) => o.sticky)) return false;
    if (this.layer.has('pause')) {
      while (this.layer.stack.length > 1) this.layer.close(undefined, true);
      this.resume();
      return true;
    }
    if (stack.length) this.layer.closeAll();
    this.openPanel('pause');
    return true;
  }

  /** The light bar says how the hero is (`lightFor`), asked every frame (the engine sends changes); the hub's own on the title and in a showcase mode. */
  private lightBar(): void {
    if (this.screen === 'loading') return; // between the town and a level: as it was
    const off = this.screen === 'title' || this.showcase.active;
    const v = this.hero.vitals();
    this.feel.light(lightFor({ where: off ? 'off' : this.screen === 'town' ? 'town' : 'level', dead: this.dead, life: v.maxLife > 0 ? v.life / v.maxLife : 0, boss: this.music === 'boss', time: this.time }));
  }

  /**
   * R2 interacts, so a DualSense's R2 works a latch (`LATCH`) while there is something to interact
   * with (`interactOffer`) and player 1 plays on the pad; it lets go in a panel, menu or the pause,
   * on the title, loading, dead, in a showcase mode or a session round (R2 does nothing there), and
   * off the pad or with the DualSense in a couch guest's hands.
   */
  private syncLatch(): void {
    const input = this.ctx.input;
    const play = (this.screen === 'town' || this.screen === 'level') && !this.dead && !this.layer.top && !this.showcase.active && !this.round;
    this.feel.latch(play && input.device === 'pad' && !input.dualSenseGuest && this.interactOffer() !== null);
  }

  /** The touch buttons follow the game: shown while you play, the bar's icons and cooldowns, what F does here. */
  private syncTouch(): void {
    if (!this.touchPad.active) return;
    const playing = (this.screen === 'town' || this.screen === 'level') && !this.dead && !this.layer.top;
    this.touchPad.sync({ playing, round: !!this.round, showcase: this.showcase.active && this.showcase.touch(), skills: playing ? this.hero.skills() : [], interact: playing ? this.interactOffer() : null });
  }

  /** What F (the touch interact button) would do now: the verb and its target, or null. */
  interactOffer(): { verb: string; name: string } | null {
    const p = this.hero.actor.position;
    if (this.screen === 'town') {
      const it = this.town.nearest(p);
      return it ? { verb: it.verb, name: it.name } : null;
    }
    if (this.screen === 'level' && this.level) {
      const near = this.nearestLoot(1.8);
      if (near) return { verb: t('touch.verb.take'), name: near.label };
      if (this.level.exitOpen && p.distanceTo(this.level.exit) < 2.4) return { verb: t('touch.verb.go'), name: t('touch.portal') };
    }
    return null;
  }

  private hotkeys(ctx: GameContext): void {
    const input = ctx.input;
    const pressed = (codes: readonly string[]) => input.wasPressed(...codes);
    if (this.screen === 'title' || this.screen === 'loading') return;
    // the map over the play: a HUD overlay (the world runs on), in a level; a session round's too
    if (pressed(KEYS.map) && !this.layer.top) this.mapOpen = !this.mapOpen && !!this.level;
    // Esc closes the map before it pauses (Circle is the dodge: the map stays open through a fight)
    else if (this.mapOpen && pressed(KEYS.mapBack) && !this.layer.top) {
      this.mapOpen = false;
      return;
    }
    // a session round has no menus or panels: the hub starts and ends rounds (and other players play on)
    if (this.round) return;
    if (this.dead) return;
    if (pressed(KEYS.pause) && !this.layer.top) {
      this.openPanel('pause');
      return;
    }
    if (this.layer.top?.modal) return;
    const toggle = (id: Parameters<Riftlight['openPanel']>[0], panelId = id) => {
      if (this.layer.has(panelId)) this.layer.close(panelId);
      else this.openPanel(id);
    };
    // I closes whichever item window shows the inventory (stash, vendor, bench, skills too)
    const items = this.layer.stack.find((o) => o.panel.group === ITEM_GROUP);
    if (pressed(KEYS.inventory)) {
      if (items) this.layer.close(items.panel.id);
      else this.openPanel('inventory');
    }
    if (pressed(KEYS.skills)) toggle('skills');
    if (pressed(KEYS.tree)) toggle('tree');
    if (pressed(KEYS.character)) toggle('character');
    if (pressed(KEYS.codex)) toggle('codex');
    if (pressed(KEYS.photo) && !this.layer.top) this.showcase.photo.open();
    if (pressed(KEYS.look) && !this.layer.top) this.openPanel('look');
    if (pressed(KEYS.interact) || this.interactQueued) {
      this.interactQueued = false;
      if (!this.layer.top) this.interact();
    }
  }

  /** F: talk to the nearest townsperson / open the stash / pick up the nearest item / use the portal. */
  interact(): boolean {
    const p = this.hero.actor.position;
    if (this.screen === 'town') {
      const it = this.town.nearest(p);
      return it ? this.interactWith(it) : false;
    }
    if (this.screen === 'level' && this.level) {
      const near = this.nearestLoot(1.8);
      if (near) return this.tryPickup(near);
      if (this.level.exitOpen && p.distanceTo(this.level.exit) < 2.4) {
        this.atPortal();
        return true;
      }
    }
    return false;
  }

  /**
   * A click on a thing in the world (the ARPG way): done at once when the hero is in reach, else
   * the hero walks there (`walkTo`) and does it on arrival.
   */
  goTo(target: WalkTarget): void {
    const p = this.hero.actor.position;
    const goal = this.walkGoal(target);
    this.walkTo = { target, time: 0, best: goal ? Math.hypot(goal.x - p.x, goal.z - p.z) : 0, since: 0, nav: new HeroWalk(p) };
    this.arrive();
  }

  /** Where the walk to `target` heads, or null when it is gone (left town, picked up, the portal shut). */
  private walkGoal(target: WalkTarget): Vector3 | null {
    if (target.kind === 'it') return this.screen === 'town' ? (this.town.interactables.find((x) => x.id === target.id)?.position ?? null) : null;
    if (this.screen !== 'level' || !this.level) return null;
    if (target.kind === 'portal') return this.level.exitOpen ? this.level.exit : null;
    return this.ports.loot.ground().find((l) => l.id === target.id && !l.filtered)?.position ?? null;
  }

  /** The hero reached the thing it walks to: it is done (talk, open, pick up, the portal). True when it was. */
  private arrive(): boolean {
    const w = this.walkTo;
    if (!w) return false;
    const goal = this.dead ? null : this.walkGoal(w.target);
    if (!goal) {
      this.walkTo = null;
      return false;
    }
    const p = this.hero.actor.position;
    const d = Math.hypot(goal.x - p.x, goal.z - p.z);
    const t = w.target;
    if (t.kind === 'it') {
      // the F rule: it is the one in reach, nearest (or in reach, and the hero gets no closer)
      const it = this.town.interactables.find((x) => x.id === t.id)!;
      if (this.town.nearest(p) !== it && (d >= it.radius || w.since < WALK.settle)) return false;
      this.walkTo = null;
      return this.interactWith(it);
    }
    if (t.kind === 'portal') {
      if (d >= 2.4) return false;
      this.walkTo = null;
      this.atPortal();
      return true;
    }
    if (d >= 2) return false; // within a pickup's reach (`tryPickup`)
    this.walkTo = null;
    const l = this.ports.loot.ground().find((x) => x.id === t.id);
    return !!l && this.tryPickup(l);
  }

  /**
   * The stash, the vendor or the bench opened at its place (`counter`) closes once the hero is out
   * of that one's reach (its `radius`, F's rule, and `REACH_SLACK` for a nudge): the windows hold
   * the hero still, but an agent's walk or anything else that moves it leaves no counter open
   * behind it. One opened from elsewhere (the agent API, the developer tools) has no place and stays.
   */
  private keepInReach(): void {
    const c = this.counter;
    if (!c) return;
    const it = this.screen === 'town' ? this.town.interactables.find((x) => x.id === c.id) : undefined;
    if (!this.layer.has(c.panel) || !it) {
      this.counter = null;
      return;
    }
    const p = this.hero.actor.position;
    if (Math.hypot(p.x - it.position.x, p.z - it.position.z) < it.radius + REACH_SLACK) return;
    this.counter = null;
    this.layer.close(c.panel);
  }

  /** Talk to a townsperson, open the stash, or play a showcase piece. */
  private interactWith(it: Interactable): boolean {
    const counter = it.action ? COUNTERS[it.action] : undefined;
    this.counter = counter ? { panel: counter, id: it.id } : null;
    if (it.action === 'stash') {
      this.openPanel('stash');
      return true;
    }
    if (it.action === 'showcase') return this.showcase.interact(it.id);
    if (it.npc) {
      this.talkingTo = it.npc;
      this.dialogueLine = it.npc.talk();
      Object.assign(this.talk, { said: this.time, gone: false, press: false });
      this.ctx.audio.play('rl.bark');
    }
    const panel = it.action === 'craft' ? 'crafting' : it.action === 'vendor' ? 'vendor' : it.action === 'tree' ? 'respec' : it.action === 'rift' ? 'rift' : null;
    if (it.npc) this.talkPanel = panel;
    if (panel) this.openPanel(panel);
    return true;
  }

  private tryPickup(l: WorldLoot): boolean {
    if (l.position.distanceTo(this.hero.actor.position) > 2.2) return false;
    return this.pickup(l);
  }

  private nearestLoot(radius: number, items = true): WorldLoot | null {
    const p = this.hero.actor.position;
    let best: WorldLoot | null = null;
    let bd = radius;
    for (const l of this.ports.loot.ground()) {
      if (l.filtered || (items && l.drop.kind !== 'item')) continue;
      const d = Math.hypot(l.position.x - p.x, l.position.z - p.z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  /** Simulation-side per-frame work (not under modal panels). */
  private advance(dt: number): void {
    const playing = this.screen === 'town' || this.screen === 'level';
    if (playing) {
      this.playtime += dt;
      this.hero.update(dt);
      this.coop.update(dt);
    }
    this.town.update(dt, this.screen === 'town' ? this.hero.actor.position : null);
    this.ports.loot.update(dt);
    this.floaters.update(dt);
    for (const f of this.feed) f.t += dt;
    this.feed = this.feed.filter((f) => f.t < 4.5);
    this.banners.update(dt);
    if (this.streak) this.streak.age += dt;
    this.levelUpAge += dt;
    this.hurt = Math.max(0, this.hurt - dt * 2.5);
    this.goldShown += (this.save.hero.gold - this.goldShown) * (1 - Math.exp(-8 * dt));
    if (Math.abs(this.goldShown - this.save.hero.gold) < 0.5) this.goldShown = this.save.hero.gold;
    if (this.screen === 'level' && this.level) {
      const level = this.level;
      level.update(dt, this.hero);
      if (!this.cleared && !this.dead) this.levelTime += dt;
      // gold is picked up by walking over it
      const p = this.hero.actor.position;
      if (!this.dead)
        for (const l of [...this.ports.loot.ground()]) {
          if (l.drop.kind === 'gold' && Math.hypot(l.position.x - p.x, l.position.z - p.z) < 1.2) this.pickup(l);
        }
      if (!this.cleared && level.exitOpen) this.onClear();
      if (!this.round && this.cleared && !this.dead && level.exitOpen && p.distanceTo(level.exit) < 1.4 && !this.layer.has('loot') && !this.layer.top) this.atPortal();
      // death: a beat to watch the hero fall, then the recap (a session round brings the hero back instead)
      if (this.dead) {
        this.deathTimer += dt;
        if (!this.round && this.deathTimer > 1.6 && !this.layer.has('death')) this.showRecap();
      }
      this.updateMusic(dt);
    }
  }

  private playMusic(name: SongName): void {
    // a level may bring its theme's arrangement of the level, combat and boss songs
    const themed = this.screen === 'level' && this.level?.songs ? this.level.songs[name as 'level' | 'combat' | 'boss'] : undefined;
    const key = `riftlight:${name}${themed ? `:${this.level!.spec.theme}` : ''}`;
    if (this.music === name && this.musicKey === key) return;
    this.music = name;
    this.musicKey = key;
    this.ctx.audio.playMusic(themed ?? SONGS[name], key);
  }

  /** Combat intensity: hits heat it up, calm cools it; the combat layer comes in and out with hysteresis. */
  private updateMusic(dt: number): void {
    this.combatSince += dt;
    this.combatHeat = Math.max(0, this.combatHeat - dt * (this.combatSince > 3 ? 0.25 : 0.05));
    const boss = this.level?.boss();
    const bossNear = boss && boss.life > 0 && boss.position.distanceTo(this.hero.actor.position) < 14;
    if (bossNear) this.playMusic('boss');
    else if (this.music === 'boss' && !bossNear) this.playMusic('level');
    else if (this.combatHeat > 0.6 && this.music === 'level') this.playMusic('combat');
    else if (this.combatHeat < 0.05 && this.music === 'combat') this.playMusic('level');
  }

  // ================================================================ camera

  cameraTarget(): Vector3 {
    if (this.showcase?.active) return this.showcase.cameraTarget();
    return this.shakeOffset.lengthSq() > 0 ? this.tmp.copy(this.camTarget).add(this.shakeOffset) : this.camTarget;
  }

  private updateCamera(ctx: GameContext, dt: number): void {
    const rig = ctx.camera;
    if (this.screen === 'title') {
      this.town.titleTarget(this.time, this.camTarget);
    } else if (this.hero && (this.screen === 'town' || this.screen === 'level')) {
      // a couch group: its centre (`coop.centre`), no lead
      const group = this.coop.guests.length > 0;
      const p = this.round?.watch() ?? (group ? this.coop.centre(this.groupAt) : this.hero.actor.position);
      // lead a little toward where the hero aims
      const want = this.tmp.copy(this.intent.aim).sub(p).setY(0);
      if (this.botIntent) want.copy(this.botIntent.aim).sub(p).setY(0);
      want.multiplyScalar(CAMERA.lead);
      if (want.length() > CAMERA.leadMax) want.setLength(CAMERA.leadMax);
      if (this.dead || this.layer.modal || group) want.set(0, 0, 0);
      else this.touchLift(ctx, want);
      this.lead.lerp(want, 1 - Math.exp(-3 * dt));
      this.camTarget.set(p.x + this.lead.x, p.y + 0.9, p.z + this.lead.z);
    }
    // shake
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.shakeTime > 0 && this.shakeStrength > 0) {
      const s = this.shakeStrength * Math.min(1, this.shakeTime * 5);
      this.shakeOffset.set(this.fx.range(-s, s), this.fx.range(-s, s) * 0.5, this.fx.range(-s, s));
    } else {
      this.shakeStrength = 0;
      this.shakeOffset.set(0, 0, 0);
    }
    const goal = this.baseZoom() * (this.screen === 'title' ? 1 : this.coop.zoom());
    if ('zoom' in rig && Math.abs(rig.zoom - goal) > 1e-3) rig.setZoom(rig.zoom + (goal - rig.zoom) * (1 - Math.exp(-4 * dt)));
  }

  /** The zoom the camera asks for, couch co-op's aside: the stage's, the player's (Settings, the wheel), less on a phone held upright. */
  private baseZoom(): number {
    return this.zoomGoal * this.settings.zoom * (this.ui && this.ui.h > this.ui.w ? CAMERA.portrait : 1);
  }

  /** The camera's view for couch co-op (`CoopHost.view`): its screen axes, the picture's aspect, the metres it shows up at zoom 1, the zoom asked for. */
  private coopView(ctx: GameContext): CoopView {
    const m = ctx.engine.camera.camera.matrixWorld;
    const rig = ctx.camera as { viewHeight?: number; zoom?: number };
    return {
      right: this.viewRight.setFromMatrixColumn(m, 0).normalize(),
      up: this.viewUp.setFromMatrixColumn(m, 1).normalize(),
      aspect: this.ui.h > 0 ? this.ui.w / this.ui.h : 0,
      height: (rig.viewHeight ?? 0) * (rig.zoom ?? 1),
      zoom: this.baseZoom(),
    };
  }

  /**
   * A phone in portrait: the touch controls and the orbs take the bottom of the screen, so the
   * camera target slides toward the camera until the hero stands in the middle of the room left
   * above them (adds to the aim lead `want`).
   */
  private touchLift(ctx: GameContext, want: Vector3): void {
    const ui = this.ui;
    if (!this.hudControls.length || ui.h <= ui.w) return;
    const g = this.geometry();
    const rows = Math.max(0, ui.h - g.top - 40) / 2; // the top HUD takes ~40 rows of its own
    const rig = ctx.camera as { viewHeight?: number };
    const view = rig.viewHeight ?? 15;
    const down = Math.max(0.3, Math.abs(ctx.engine.camera.camera.getWorldDirection(this.liftDir).y));
    cameraBasis(ctx.engine, this.right, this.forward);
    want.addScaledVector(this.forward, -((rows * view) / ui.h) / down);
  }

  // ================================================================ drawing

  private draw(ctx: GameContext): void {
    const ui = this.ui;
    const hud = ctx.hud;
    const cam = ctx.engine.camera.camera;
    hud.clear();
    if (this.screen === 'title') {
      // the logo over a breathing rift of light; on a phone a smaller logo, the line in two
      const scale = logoScale(ui.w);
      const ly = scale >= 4 ? 30 : 24;
      const lh = 7 * scale + 5;
      drawRift(ui, ui.w / 2, ly + Math.round(lh / 2), Math.min(ui.w - 8, 6 * 9 * scale + 60), this.time);
      drawLogo(ui, ui.w / 2, ly, this.time, 'RIFTLIGHT', scale);
      const tag = t('title.tagline');
      if (ui.measure(tag) <= ui.w - 8) {
        ui.text(ui.w / 2, ly + lh + 8, tag, { align: 'center', color: 'mist', shadow: 'ink' });
        this.titleBottom = ly + lh + 8 + 9;
      } else {
        // a phone: the mini font, on as many rows as it takes (rows 7 apart; 9 for the normal font's accents)
        const rows = wrapText(tag, ui.w - 8, miniWidth);
        const gap = rows.every(miniCovers) ? 7 : 9;
        rows.forEach((row, i) => ui.mini(ui.w / 2, ly + lh + 6 + i * gap, row, 'mist', 'center', 'ink'));
        this.titleBottom = ly + lh + 6 + rows.length * gap;
      }
      ui.mini(ui.w - 4, ui.h - 8, 'RIFTLIGHT', 'slate', 'right');
      this.layer.draw(ui, this.time);
      return;
    }
    if (this.screen === 'loading') {
      ui.rect(0, 0, ui.w, ui.h, 'ink');
      ui.text(ui.w / 2, ui.h / 2 - 4, t('loading.opening'), { align: 'center', color: 'cyan' });
      // three dots under it, filling in turn (the line itself never changes)
      const lit = 1 + (Math.floor(this.time * 4) % 3);
      for (let i = 0; i < 3; i++) ui.rect(ui.w / 2 - 5 + i * 4, ui.h / 2 + 7, 2, 2, i < lit ? 'cyan' : 'navy');
      return;
    }
    // a banner keeps off the heroes as they stood when it opened (`Banner.heroes`): it doesn't jump
    // as they move, and shows once they are known (`hudModel`; a tenth of a second at most)
    const card = this.banners.current;
    if (card && !card.heroes) card.heroes = this.heroBoxes(cam) ?? (card.age > 0.1 ? [] : undefined);
    // the guests' strips keep off the heroes as they stood when the strips were placed: a stage
    // opened, a guest's hero came (a tick or two after it joined) or went, the screen turned
    // (`stripHeroes`); they stay put as the heroes move
    const s = this.stripHeroes;
    const seats = this.coop.guests.filter((g) => g.hero).map((g) => g.seat).join();
    if (!this.coop.guests.length) this.stripHeroes = null;
    else if (!s || s.seats !== seats || s.w !== ui.w || s.h !== ui.h) {
      const boxes = this.heroBoxes(cam);
      if (boxes?.length) this.stripHeroes = { seats, w: ui.w, h: ui.h, boxes };
    }
    // the HUD's zones first: world overlays are placed around them, most important first
    // (the prompt, the focused loot label, other labels, damage numbers)
    const model = this.hudModel();
    model.controls = this.hudControls = this.touchPad.zones((x, y) => this.pointer.toArt(x, y));
    const talking = this.touchable.dialogue; // the NPC's line as last placed (it stays put: `placeTalk`)
    this.touchable = { loot: [], prompt: null, feed: [], dialogue: null };
    const layout = this.hudLayout;
    layout.clear(ui.w, ui.h);
    this.hudZonesShown = hudBoxes(ui.w, ui.h, model).map(({ id, x, y, w, h }) => ({ x, y, w, h, weight: id === 'banner' || id === 'boss' || id === 'where' || id === 'time' ? 1 : 10 }));
    for (const { x, y, w, h } of this.hudZonesShown) layout.reserve({ x, y, w, h });
    // the world's bubbles and labels keep off an NPC's line over a panel too, and off the item
    // windows (their canvas is over the HUD: one there would show cut)
    if (talking && this.layer.top) layout.reserve(talking);
    for (const b of this.layer.top?.panel.boxes?.() ?? []) layout.reserve(b);
    // world overlays
    this.coop.draw(ui, cam); // each couch guest's tag over its head
    if (this.screen === 'town') {
      const it = !this.layer.top ? this.town.nearest(this.hero.actor.position) : null;
      // interaction prompts sit above the skill bar (the world has bubbles and labels)
      if (it) this.prompt(it.prompt, it.title);
      // couch co-op: another pad may join here (player 1 on a pad, a seat free): say how
      if (this.joinHint()) this.joinLine();
      // townsfolk's speech bubbles through the HUD's layout, the speaker nearest the hero first: one
      // that would cover another (or the HUD, the prompt) is nudged up off it, else waits its turn
      const hp = this.hero.actor.position;
      const said = this.town.bubbles().sort((a, b) => Math.hypot(a.at.x - hp.x, a.at.z - hp.z) - Math.hypot(b.at.x - hp.x, b.at.z - hp.z));
      for (const b of said) bubble(ui, cam, b.at, b.text, b.t, layout);
    }
    // the mouse in the world (not over a panel, not a finger): the thing under it shows what a click does there
    const mouse = ui.pointer.used && !this.padGlyphs() && !this.layer.covers(ui.pointer.x, ui.pointer.y) && !this.showcase.active;
    this.worldFocus = null;
    if (this.screen === 'town' && mouse) {
      for (const thing of this.town.interactables) {
        const box = thingBox(thing, cam, ui);
        if (!box || !ui.hover(box)) continue;
        this.worldFocus = { kind: 'it', id: thing.id };
        thingLabel(ui, box, thing.prompt, 'attack', layout);
        break;
      }
    }
    this.lootFocus = null;
    if (this.screen === 'level' && this.level) {
      const near = this.nearestLoot(1.8);
      const p = this.hero.actor.position;
      if (near) this.prompt(t('prompt.pick_up', { item: near.label }));
      else if (!this.round && this.level.exitOpen && p.distanceTo(this.level.exit) < 4) this.prompt(t('prompt.return'), t('prompt.return.sub'));
      // a moment's spot to escape to, before the labels (the way out matters most): a ring on the
      // ground with a chevron over it, else an arrow pointing the way, clear of the HUD
      const spot = this.momentAim?.spot;
      if (spot && this.round?.phase !== 'over') beacon(ui, cam, spot, MOMENT_REACH, 'cyan', this.time, layout);
      // labels: the focused one first, then loud ones, then by distance (near labels win)
      const labels = this.ports.loot
        .ground()
        .filter((l) => !l.filtered && l.drop.kind !== 'gold' && l.position.distanceTo(p) <= 9)
        .sort((a, b) => Number(b === near) - Number(a === near) || Number(b.tier === 'loud') - Number(a.tier === 'loud') || a.position.distanceTo(p) - b.position.distanceTo(p));
      for (const l of labels) {
        const r = lootLabel(ui, cam, l.position, l.label, l.color, l === near || this.walkTo?.target.kind === 'loot' && this.walkTo.target.id === l.id, l.tier, layout);
        if (r && this.ui.hover(r)) this.lootFocus = l;
        if (r) this.touchable.loot.push({ id: l.id, rect: r });
      }
      if (mouse && this.lootFocus) this.worldFocus = { kind: 'loot', id: this.lootFocus.id };
      // the open portal under the mouse: a click goes home
      const portal = !this.round && this.level.exitOpen && mouse && !this.worldFocus ? worldBox(this.level.exit, 2.2, 1.6, cam, ui) : null;
      if (portal && ui.hover(portal)) {
        this.worldFocus = { kind: 'portal' };
        thingLabel(ui, portal, t('prompt.return'), 'attack', layout);
      }
      if (this.dev.hitboxes) {
        hitbox(ui, cam, p, this.hero.actor.radius, 'lime');
        for (const a of this.level.actors()) if (a.alive) hitbox(ui, cam, a.position, a.radius, 'red');
        for (const t of this.level.telegraphs()) hitbox(ui, cam, t.at, t.radius, 'orange');
      }
      this.floaters.draw(ui, cam, layout);
      this.round?.draw(ui, cam);
    }
    // the level's map over the play, under the HUD (which drops its corner map meanwhile)
    if (this.mapOpen && model.minimap && !this.layer.top) {
      drawMap(ui, model.minimap, this.mapRoom(), this.time);
      model.minimap = null;
    }
    this.touchable.feed = drawHud(ui, model, layout).feed;
    // an NPC's line in free space (`talkPlace`), clear of the HUD and of the item windows (placed
    // before the layer, so their legend keeps clear of it) or of a framed panel and its legend
    // (after it, the frame where it is now), drawn over them; with no free spot, across the top
    // over them for a while (`talkSeconds`: the item windows' canvas draws it there, the HUD being
    // under it). A panel that covers the screen (the passive tree's view) shows it itself
    // (`PanelHost.talk`)
    const said = this.dialogueLine && !this.talk.gone ? this.layer.top : undefined;
    let talk = said?.panel.overlay && said.panel.boxes ? this.placeTalk(this.windowsAndLegend(said.panel.boxes())) : null;
    this.talk.box = talk && this.talkShows(talk) ? talk.box : null; // the legend keeps clear of it
    this.layer.draw(ui, this.time);
    if (said && !said.panel.overlay) {
      const r = said.rect;
      talk = this.placeTalk([{ x: r.x - 6, y: r.y - 16, w: r.w + 12, h: r.h + 22 + LEGEND_ROOM }]);
    }
    const shows = !!talk && this.talkShows(talk);
    const over = this.layer.top?.panel.overlay ? this.layer.top.panel.talkOver : undefined;
    over?.call(this.layer.top!.panel, shows && talk!.over ? talk : null);
    if (shows) this.touchable.dialogue = talk!.over && over ? talk!.box : dialogue(ui, talk!);
    // a character screen on top: the ring's strip across the top (the tree's view covers the screen: its own bar says it)
    const top = pageOf(this.layer.top?.panel);
    this.pageStrip = top && top !== 'tree' ? drawPageStrip(ui, top).rects : [];
    if (this.dead && !this.layer.has('death')) {
      const k = Math.min(1, this.deathTimer / 1.2);
      for (let y = 0; y < ui.h; y += 2) if ((y / 2) % 3 < k * 3) ui.rect(0, y, ui.w, 1, 'plum');
      const died = t('death.title');
      ui.text(ui.w / 2, ui.h / 2 - 20, died, { align: 'center', scale: ui.measure(died, 3) <= ui.w - 8 ? 3 : 2, color: 'red', shadow: 'ink' });
      const rise = this.round?.respawnIn;
      if (rise !== null && rise !== undefined) ui.text(ui.w / 2, ui.h / 2 + 6, t('round.respawn', { seconds: Math.max(1, Math.ceil(rise)) }), { align: 'center', color: 'white', shadow: 'ink' });
    }
  }

  /** "[F] Talk to Brann" centred above the skill bar. */
  /**
   * Couch co-op's line in town (`joinHint`): how another pad joins, in rows that fit the screen. At
   * the top centre while that is clear of the HUD (the place name, the gold), else above the bottom
   * HUD and any prompt (a phone held upright); placed through the HUD's layout, so it covers no
   * other text, and the loot feed goes around it.
   */
  private joinLine(): void {
    const ui = this.ui;
    const rows = wrapText(t('menu.coop.join'), ui.w - 12, (s) => ui.measure(s)).map((r) => clip(r, ui.w - 12, (s) => ui.measure(s)));
    const w = Math.max(...rows.map((r) => ui.measure(r))) + 4;
    const h = rows.length * 9 + 1;
    const x = Math.round(ui.w / 2 - w / 2);
    const layout = this.hudLayout;
    let at: Box | null = { x, y: 3, w, h };
    if (layout.free(at)) layout.reserve(at);
    else at = layout.place({ x, y: this.geometry().top - 4 - h, w, h }, { step: 3, tries: Math.floor(ui.h / 3) });
    if (!at) return;
    rows.forEach((r, i) => ui.text(ui.w / 2, at.y + 2 + i * 9, r, { align: 'center', color: 'mist', shadow: 'ink' }));
  }

  private prompt(label: string, sub?: string): void {
    const ui = this.ui;
    const g = this.geometry();
    // above the bar; on a phone above the orbs (and the touch controls), with the label cut to the screen
    let y = g.touch ? g.top - 16 - (sub ? 8 : 0) : g.compact ? g.orbY - g.orbR - 18 - (sub ? 8 : 0) : ui.h - 66;
    // on a touch screen the interact button says what F does: the prompt has no key glyph
    const put = (x: number, yy: number, s: string) => (g.touch ? (ui.text(x, yy, s, { align: 'center', color: 'white' }), ui.measure(s)) : ui.prompt(x, yy, 'interact', s, 'white', 'center'));
    const text = clip(label, ui.w - 10 - (g.touch ? 0 : ui.glyphWidth('interact') + 3), (s) => ui.measure(s));
    const w = put(-1000, -1000, text);
    // the line under it: the normal font when it fits the label's box or the mini font can't draw
    // it, else the mini font; cut to the screen, and the box grows to hold it
    const big = sub && (ui.measure(sub) <= w + 8 || !miniCovers(sub)) ? clip(sub, ui.w - 12, (s) => ui.measure(s)) : '';
    const small = sub && !big ? clip(sub, ui.w - 12, miniWidth) : '';
    const sw = big ? ui.measure(big) : small ? miniWidth(small) : 0;
    const bw = Math.max(w, sw) + 8;
    const box = { x: Math.round(ui.w / 2 - bw / 2), y: y - 3, w: bw, h: big ? 22 : sub ? 21 : 13 }; // the normal font's tails (Q, a comma) need a row more
    // a box wider than the room between the orbs goes up over their frames (they are drawn after it)
    const orbTop = Math.min(g.life.y, g.mana.y) - g.orbR - 3;
    const overOrbs = box.x < g.life.x + g.orbR + 3 || box.x + box.w > g.mana.x - g.orbR - 3;
    if (overOrbs && box.y + box.h > orbTop) {
      const lift = box.y + box.h - orbTop;
      box.y -= lift;
      y -= lift;
    }
    // a finger taps it (it does what F does): never in the floating stick's zone, which takes every
    // touch there: beside it on a wide screen, else over it
    const zone = g.touch ? this.touchPad.stickZone() : null;
    let cx = ui.w / 2;
    if (zone && overlaps(box, zone)) {
      const right = zone.x + zone.w + 2;
      const clear = (b: Box) => !this.hudControls.some((c) => overlaps(b, c));
      const beside = { ...box, x: right };
      if (right + box.w <= ui.w - 2 && clear(beside)) {
        box.x = beside.x;
        cx = box.x + box.w / 2;
      } else {
        const lift = box.y + box.h - (zone.y - 2);
        box.y -= lift;
        y -= lift;
      }
    }
    this.touchable.prompt = { ...box };
    this.hudLayout.reserve(box);
    ui.rect(box.x, box.y, box.w, box.h, 'ink');
    ui.outline(box.x, box.y, box.w, box.h, 'slate');
    put(cx, y, text);
    if (big) ui.text(cx, y + 9, big, { align: 'center', color: 'mist' });
    else if (small) ui.mini(cx, y + 10, small, 'mist', 'center');
  }

  /** The fixed HUD's rects in art pixels and the touch controls (agent API `ui.hud()`, the phone e2e). */
  hudRects(): { art: { w: number; h: number }; touch: boolean; controls: Box[]; zones: (Box & { id: string })[] } {
    const ui = this.ui;
    const g = this.geometry();
    const r = g.orbR;
    const orb = (id: string, o: { x: number; y: number }) => ({ id, x: o.x - r - 2, y: o.y - r - 2, w: 2 * r + 5, h: 2 * r + 5 });
    const zones: (Box & { id: string })[] = [orb('life', g.life), orb('mana', g.mana), { id: 'xp', x: g.xp.x, y: g.xp.y, w: g.xp.w, h: 3 }];
    const lv = g.levelAt.mini ? t('hud.level', { level: this.save.hero.level }) : lang().formatNumber(this.save.hero.level);
    const lw = g.levelAt.mini ? miniWidth(lv) : ui.measure(lv);
    zones.push({ id: 'level', x: Math.round(g.levelAt.align === 'center' ? g.levelAt.x - lw / 2 : g.levelAt.x - lw), y: g.levelAt.y, w: lw, h: g.levelAt.mini ? 5 : 7 });
    if (!g.touch) zones.push({ id: 'skillbar', x: g.bx - 5, y: g.by - 4, w: g.barW + 4, h: g.slot + 10 });
    // the rest as the HUD lays it out this frame: the minimap (and the gold under it), the gold,
    // the top-left block, a boss's name and bar, a moment's seconds left, the centre banner
    const model = this.hudModel();
    model.controls = this.hudControls;
    for (const b of hudBoxes(ui.w, ui.h, model)) if (b.id !== 'control' && b.id !== 'bar' && b.id !== 'xp' && b.id !== 'life' && b.id !== 'mana') zones.push(b);
    return { art: { w: ui.w, h: ui.h }, touch: g.touch, controls: this.hudControls, zones };
  }

  /**
   * The heroes standing on screen, player 1's and each couch guest's, as art-pixel boxes from their
   * feet to their heads (to their seat tags with guests) with a quarter of that around (what the
   * centre banner keeps off: the room the camera's settling, as a stage opens, moves them by); null
   * while the camera is not on player 1 standing (the frame a stage is entered draws with the camera
   * where it was).
   */
  private heroBoxes(cam: Camera): Box[] | null {
    const ui = this.ui;
    const out: Box[] = [];
    if (!this.hero.object.visible) return out;
    const top = this.coop.guests.length ? TAG_AT : HEAD; // with guests a seat tag over every head (`LocalCoop.draw`)
    for (const a of [this.hero.actor, ...this.coop.guests.map((g) => g.hero?.actor)]) {
      if (!a?.alive) continue;
      const b = worldBox(a.position, top, 0.9, cam, ui);
      const m = b ? Math.ceil(b.h / 4) : 0;
      if (b && b.x + b.w > 0 && b.y + b.h > 0 && b.x < ui.w && b.y < ui.h) out.push({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });
      else if (a === this.hero.actor) return null;
    }
    return out;
  }

  /** The level's cells, what is explored, the hero, the exit and the boss: the corner map and the big one (null outside a level). */
  private minimapModel(): MinimapModel | null {
    const level = this.level;
    if (!level) return null;
    const boss = level.boss();
    const L = level.layout;
    const p = this.hero.actor.position;
    return {
      width: L.width,
      height: L.height,
      cell: (x, z) => L.cell(x, z),
      explored: level.explored(),
      hero: { x: p.x, z: p.z },
      exit: { x: level.exit.x, z: level.exit.z, open: level.exitOpen },
      boss: boss && boss.life > 0 ? { x: boss.position.x, z: boss.position.z } : null,
      origin: level.origin,
    };
  }

  /** The fixed HUD's geometry on this screen: around the touch controls as last laid out, the corner map below 52in1's wake band on a touch page there (`hudGeometry`). */
  private geometry(): ReturnType<typeof hudGeometry> {
    return hudGeometry(this.ui.w, this.ui.h, this.hudControls, this.touchPad.wakeArt());
  }

  private hudModel(): HudModel {
    const level = this.level;
    const boss = level?.boss() ?? null;
    const minimap = this.minimapModel();
    const tuning = this.save.difficulty;
    const left = this.round?.timeLeft() ?? null;
    return {
      time: this.time,
      vitals: this.hero.vitals(),
      levelUpAge: this.levelUpAge,
      level: this.save.hero.level,
      xp: xpFraction(this.save.hero),
      skills: this.hero.skills(),
      buffs: this.hero.buffs(),
      boss: boss && boss.life > 0 ? boss : null,
      minimap,
      gold: this.save.hero.gold,
      goldShown: this.goldShown,
      feed: this.feed,
      card: this.banners.current?.heroes ? this.banners.current : null, // from the frame it knows where the heroes stand (`draw`)
      streak: this.streak,
      difficulty: changedSliders(tuning).map((k) => t(`hud.tuned.${difficultyLineId(k)}`, { value: lang().formatNumber(tuning[k], { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })),
      hurt: this.hurt,
      levelLabel: level ? levelTitle(level.spec) : t('place.emberfall'),
      timer: level && !this.round?.moment ? formatTime(this.levelTime) : null, // a moment shows its own seconds left
      device: this.controlDevice(),
      padStyle: this.ctx.engine.controls.style,
      wake: this.touchPad.wakeArt(),
      progress: level && !this.round?.moment ? level.progress() : null,
      timeLeft: left === null ? null : { text: t('round.moment_left', { count: left }), urgent: left <= 3 },
      guests: this.coop.strips(),
      // as the strips were placed, on this screen (a new stage's are taken once its heroes are known)
      heroes: this.stripHeroes && this.stripHeroes.w === this.ui.w && this.stripHeroes.h === this.ui.h ? this.stripHeroes.boxes : undefined,
    };
  }

  /** First-person eye (the showcase's hall); otherwise the engine default, 0.7 m over the target. */
  eyePosition(): Vector3 {
    const eye = this.showcase?.eyePosition();
    if (eye) return eye;
    const t = this.cameraTarget();
    return this.eyeAt.set(t.x, t.y + 0.7, t.z);
  }

  onCameraChange(): void {
    this.showcase?.onCameraChange();
  }

  // ================================================================ look studio (LookHost)

  look(): Look {
    return this.ctx.engine.look;
  }

  /** A look from the studio: on screen at once and remembered (a named look, or the custom one). */
  setLook(look: Look): void {
    const name = lookPresetOf(look);
    this.settings.look = name === 'none' ? '' : (name ?? 'custom');
    if (!name) this.settings.customLook = look;
    this.ctx.engine.setLook(look);
    // the default look (Reset) is not one the settings put on screen
    this.lookFromSettings = name !== 'none';
    if (!this.replaying) storeSettings(this.settings); // the player's, not a replay's
  }

  /** Studio pages dock to the right without dimming, so the picture stays in view; H hides them. */
  openStudioPage(menu: Menu): void {
    this.layer.open(menu, { modal: true, dock: 'right', dim: false, solo: true, peek: this.pointer.touch ? t('look.peek.tap') : t('look.peek.key') });
  }

  /** Hide the look studio (the arrows still tweak) or show it again. */
  peek(): void {
    this.layer.togglePeek();
  }

  /** Pause / settings → Look studio. */
  lookStudio(): void {
    this.openStudioPage(lookStudio(this));
  }

  /**
   * The Language menu's languages (MenuHost): the game's and its translations', the one shown;
   * none when the address names one (the hub's own menu is in charge then). Choosing one saves it
   * and reloads the page in it (headless: nothing to reload).
   */
  get language(): NonNullable<MenuHost['language']> {
    const l = lang();
    return {
      available: l.available,
      current: l.code,
      asked: !!pageLanguageSources().asked,
      choose: (code: string) => {
        if (this.ctx.engine.renderer.container && !this.replaying) chooseLanguage(code);
      },
    };
  }

  /**
   * Title or the town's Engine Workshop → Engine World: the same page with ?game=world (other URL
   * options kept), at `room` (the Asset Gallery) or the Atrium. From town the run is saved first,
   * and the hero stays when it can't be kept (the write failed, or saves live only in this page):
   * leaving would lose it. Engine World's way back opens the title, where Continue picks it up.
   * Returns whether the game goes (headless and in a replay there is no page to leave).
   */
  engineWorld(room?: string): boolean {
    if (this.screen === 'town') {
      const kept = this.autosave('engine world'); // a failed write says so itself (the storage toast)
      if (!this.replaying && (!kept || this.store.volatile)) {
        if (kept) this.feedLine(t('menu.slots.volatile'), 'orange');
        return false;
      }
    }
    if (!this.ctx.engine.renderer.container || this.replaying) return true;
    const u = new URL(location.href);
    u.searchParams.set('game', 'world');
    if (room) u.searchParams.set('room', room);
    else u.searchParams.delete('room');
    location.assign(u.toString());
    return true;
  }

  /** Pause → Photo mode. */
  photoMode(): void {
    this.layer.closeAll();
    this.showcase.photo.open();
  }

  status(): string {
    const lvl = this.level ? `depth ${this.level.spec.depth} ${this.level.progress().killed}/${this.level.progress().total}` : this.screen;
    return `${lvl} · lv ${this.save.hero.level} · ${this.save.hero.gold}g`;
  }

  /**
   * The run as `engine.fingerprint()` sees it: where the hero and every monster are and how
   * hurt, the run's random stream, the save (level, gold, tree, gear and bags), the ground loot,
   * the town (its townsfolk and cat, time of day, random stream).
   * A replay of a recorded session ends with the same one.
   */
  fingerprint(): string {
    const at = (p: Vector3) => `${p.x},${p.y},${p.z}`;
    const hero = this.hero.actor;
    return [
      this.screen,
      this.slot,
      this.rng.state,
      this.levelTime,
      this.dead,
      this.cleared,
      `${at(hero.position)} ${this.hero.actor instanceof Actor ? this.hero.actor.facing : ''} ${hero.life} ${hero.mana}`,
      ...(this.coop.guests.length ? [`coop ${JSON.stringify(this.coop.view())}`] : []),
      ...(this.round ? [`round ${this.round.phase} ${this.round.depth} ${this.round.respawnIn ?? ''} ${this.round.clearedAt !== null}${this.round.moment ? ` ${this.round.moment.id} ${this.round.outcome}` : ''}`] : []),
      ...(this.level?.monsters() ?? []).map((m) => `${m.actor.id} ${at(m.actor.position)} ${m.actor instanceof Actor ? m.actor.facing : ''} ${m.actor.life}`),
      ...this.ports.loot.ground().map((l) => `${l.id} ${at(l.position)}`),
      this.town.fingerprint(),
      JSON.stringify(this.save),
      JSON.stringify(this.ports.loot.peek?.() ?? null),
    ].join('|');
  }

  /**
   * The game as data between two frames (`engine.snapshot()`, docs/game/save-states.md): the
   * save and the slots it knows, the run's random stream, the id counters, the hero, the loot,
   * the town and everything the shell keeps (timers, the HUD's banners and numbers, the camera's
   * lead, the pointer) and, in a level, what the level was built from and its own state
   * (`LevelHandle.saveState`). In town or a level, mid-fight included, with no panel open,
   * nobody talked to and no 52in1 round on. The settings kept are those play reads (`playSettings`); the rest are the player's.
   */
  snapshot(): RiftSnapshot {
    const refuse = (why: string): never => {
      throw new Error(`Riftlight.snapshot: ${why}`);
    };
    if (this.screen !== 'town' && this.screen !== 'level') refuse(`the ${this.screen} screen is not a moment of play (take it in town or in a level)`);
    const level = this.screen === 'level' ? this.level : null;
    if (this.screen === 'level' && (!level?.saveState || !level.loadState || !this.levelEntry)) refuse('this level port keeps no state (saveState / loadState)');
    if (this.showcase.active) refuse('the showcase is open');
    if (this.layer.top) refuse(`a panel is open (${this.layer.top.panel.id}): close it first`);
    if (this.talkingTo) refuse('the hero is talking to someone');
    // a round's state is the hub's as much as the game's (its clock, the other copies, a moment's
    // targets): a round is replayed from its recording, not restored
    if (this.round) refuse('a 52in1 round is on (replay its recording instead)');
    // a save-state holds player 1's hero alone: a couch session replays from its recording
    if (this.coop.guests.length) refuse('couch co-op guests are playing (they leave first, or replay the recording instead)');
    const hero = this.hero;
    const loot = this.ports.loot;
    if (!hero.saveState || !hero.loadState) refuse('this hero port keeps no state (saveState / loadState)');
    if (!loot.saveState || !loot.loadState) refuse('this loot port keeps no state (saveState / loadState)');
    const v = (p: Vector3) => p.toArray();
    // a copy as it is (Infinity, -0 kept): engine.snapshot() makes it JSON
    return structuredClone({
      format: 1,
      screen: this.screen,
      slot: this.slot,
      save: this.save,
      saves: this.saves,
      settings: playSettings(this.settings),
      dev: this.dev,
      rng: this.rng.state,
      fx: this.fx.state,
      ids: { actors: actorIds(), props: PropTarget.nextId() },
      hero: hero.saveState!(),
      loot: loot.saveState!(),
      town: this.town.saveState(),
      level: level ? { entry: this.levelEntry, state: level.saveState!() } : null,
      shell: {
        time: this.time,
        playtime: this.playtime,
        levelTime: this.levelTime,
        cleared: this.cleared,
        dead: this.dead,
        deathTimer: this.deathTimer,
        dialogueLine: this.dialogueLine,
        gifts: this.gifts,
        clearEmitted: this.clearEmitted,
        combatHeat: this.combatHeat,
        combatSince: this.combatSince,
        music: this.music,
        session: this.session,
        interactQueued: this.interactQueued,
        pressTaken: this.pressTaken,
        fingerHeld: this.fingerHeld,
        map: this.mapOpen,
        worldFocus: this.worldFocus,
        // what the last frame drew that the next frame's input hits (a finger's targets, the touch controls the HUD laid out around)
        touchable: this.touchable,
        hudControls: this.hudControls,
        touchHub: this.touchPad.hub,
        walk: this.walkTo && { target: this.walkTo.target, time: this.walkTo.time, best: this.walkTo.best, since: this.walkTo.since, nav: this.walkTo.nav.save() },
        lootFocus: this.lootFocus?.id ?? null,
        levelUpAge: this.levelUpAge,
        hurt: this.hurt,
        goldShown: this.goldShown,
        streak: this.streak,
        feed: this.feed,
        intent: { ...this.intent, aim: v(this.intent.aim) },
        motionAim: this.motionAim && { ...this.motionAim },
        botIntent: this.botIntent ? { ...this.botIntent, aim: v(this.botIntent.aim) } : null,
        camera: { target: v(this.camTarget), lead: v(this.lead), shake: v(this.shakeOffset), shakeTime: this.shakeTime, shakeStrength: this.shakeStrength, zoomGoal: this.zoomGoal },
      },
      banners: this.banners.save(),
      floaters: this.floaters.save(),
      recap: this.recap.save(),
      pointer: this.pointer.save(),
      menuInput: this.menuInput.save(),
    }) as RiftSnapshot;
  }

  /** Before a restore: out of whatever mode is on (photo mode, the arcade, the Hall of Beasts keep cameras of their own), panels shut. */
  async beforeRestore(): Promise<void> {
    this.layer.closeAll();
    this.endTalk();
    await this.showcase.abandon();
  }

  /**
   * Back to `snapshot()`'s moment, from wherever the game is (a level is left, panels close).
   * A level is built again from what it was built from (`LevelEntry`: the same layout, props
   * and monsters with the same ids), then its state is loaded on top. Storage is not touched:
   * the restored run is saved the next time the game saves.
   */
  async restore(_ctx: GameContext, state: unknown): Promise<void> {
    const s = state as RiftSnapshot;
    if (s?.format !== 1 || (s.screen !== 'town' && s.screen !== 'level') || (s.screen === 'level' && !s.level)) throw new Error('Riftlight.restore: not a Riftlight snapshot this game can restore');
    const hero = this.hero;
    const loot = this.ports.loot;
    if (!hero.loadState || !loot.loadState) throw new Error('Riftlight.restore: these ports keep no state');
    // what can be checked before anything changes (a snapshot that doesn't fit leaves the game as it was)
    if (!s.town || !s.hero || !s.loot || !s.save?.hero) throw new Error('Riftlight.restore: the snapshot is missing the town, the hero, the loot or the save');
    const plan = s.level?.entry.plan ?? null;
    const now = s.level && plan !== null ? (this.ports.levels.signature?.(s.level.entry.spec) ?? plan) : plan;
    const misfit = this.town.fits(s.town) ?? hero.fits?.(s.hero) ?? (now !== plan ? `the level would not be built the same (plan ${now}, saved ${plan})` : null);
    if (misfit) throw new Error(`Riftlight.restore: ${misfit}`);
    try {
      await this.restoreNow(s);
    } catch (e) {
      // never half a moment: a restore that still fails part way leaves the game at the title
      this.toTitle();
      throw e;
    }
  }

  private async restoreNow(s: RiftSnapshot): Promise<void> {
    const hero = this.hero;
    const loot = this.ports.loot;
    if (!hero.loadState || !loot.loadState) throw new Error('Riftlight.restore: these ports keep no state');
    // leave whatever is on now, quietly (no autosave, no banners, no sounds)
    await this.beforeRestore(); // done already through engine.restore(); here for a direct call
    this.leaveLevel();
    this.coop.leaveAll(); // a save-state holds no couch guests
    // the run as data
    this.slot = s.slot;
    this.save = s.save;
    this.saves = s.saves;
    Object.assign(this.settings, s.settings);
    Object.assign(this.dev, s.dev);
    hero.object.visible = true;
    // every actor by id, for what points at one (looked up once they all exist again)
    const actors = (id: number | null): ActorLike | null => (id === null ? null : id === hero.actor.id ? hero.actor : (this.level?.actorById?.(id) ?? null));
    if (s.level) {
      const e = s.level.entry;
      this.town.deactivate();
      this.town.loadState(s.town);
      this.screen = 'loading';
      this.syncTouch(); // no frame runs while the level builds: the controls step aside now
      this.syncLatch(); // and R2 lets go
      this.ctx.scene.background = new Color(PALETTE.ink);
      this.rng.state = e.rng;
      setActorIds(e.actors);
      PropTarget.setIds(e.props);
      const level = await this.ports.levels.build(e.spec, this.levelDeps());
      if (!level.loadState) throw new Error('Riftlight.restore: this level port keeps no state');
      this.level = level;
      this.levelEntry = e;
      this.ctx.scene.add(level.root);
      hero.enter(level, level.start, Math.PI);
      this.screen = 'level';
      // the level's actors come back first (with their ids), the hero through them, the level's combat last
      level.loadState(s.level.state, actors, (index) => hero.loadState!(s.hero, index));
      loot.loadState(s.loot, level);
    } else {
      this.screen = 'town';
      this.town.activate();
      this.town.loadState(s.town); // active: its sky and lights as they were
      loot.loadState(s.loot, this.town);
      hero.enter(this.town, this.town.spawn, 0); // the town's stage (where and how it stands comes next)
      hero.loadState(s.hero, actors);
    }
    this.rng.state = s.rng;
    this.fx.state = s.fx;
    setActorIds(s.ids.actors);
    PropTarget.setIds(s.ids.props);
    // the shell
    const t = s.shell;
    this.time = t.time;
    this.playtime = t.playtime;
    this.levelTime = t.levelTime;
    this.cleared = t.cleared;
    this.dead = t.dead;
    this.deathTimer = t.deathTimer;
    this.dialogueLine = t.dialogueLine;
    this.gifts = t.gifts;
    this.clearEmitted = t.clearEmitted;
    this.combatHeat = t.combatHeat;
    this.combatSince = t.combatSince;
    Object.assign(this.session, t.session);
    this.interactQueued = t.interactQueued;
    this.pressTaken = t.pressTaken ?? false;
    this.fingerHeld = t.fingerHeld ?? 0;
    this.mapOpen = t.map ?? false;
    this.worldFocus = t.worldFocus ?? null;
    const tt = t.touchable;
    this.touchable = tt ? { loot: tt.loot.map((l) => ({ id: l.id, rect: { ...l.rect } })), prompt: tt.prompt && { ...tt.prompt }, feed: tt.feed.map((b) => ({ ...b })), dialogue: tt.dialogue && { ...tt.dialogue } } : { loot: [], prompt: null, feed: [], dialogue: null };
    this.hudControls = t.hudControls ? t.hudControls.map((c) => ({ ...c })) : [];
    this.touchPad.restoreLast(this.hudControls); // what stands in while the controls are hidden
    if (t.touchHub !== undefined) this.touchPad.hub = t.touchHub; // ≡ where the page had it (52in1's place, or the corner)
    this.walkTo = t.walk?.nav ? { target: t.walk.target, time: t.walk.time, best: t.walk.best, since: t.walk.since, nav: HeroWalk.load(t.walk.nav) } : null;
    this.levelUpAge = t.levelUpAge;
    this.hurt = t.hurt;
    this.goldShown = t.goldShown;
    this.streak = t.streak ? { ...t.streak } : null;
    this.feed = t.feed.map((f) => ({ ...f }));
    Object.assign(this.intent, { ...t.intent, move: { ...t.intent.move }, aim: this.intent.aim.fromArray(t.intent.aim) });
    this.motionAim = t.motionAim ? { ...t.motionAim } : null;
    this.botIntent = t.botIntent ? fromSaved(t.botIntent) : null;
    this.camTarget.fromArray(t.camera.target);
    this.lead.fromArray(t.camera.lead);
    this.shakeOffset.fromArray(t.camera.shake);
    this.shakeTime = t.camera.shakeTime;
    this.shakeStrength = t.camera.shakeStrength;
    this.zoomGoal = t.camera.zoomGoal;
    this.banners.load(s.banners);
    this.floaters.load(s.floaters);
    this.recap.load(s.recap);
    this.pointer.load(s.pointer);
    this.menuInput.load(s.menuInput);
    this.lootFocus = t.lootFocus === null ? null : (this.ports.loot.ground().find((l) => l.id === t.lootFocus) ?? null);
    if (t.music) this.playMusic(t.music);
    else {
      this.ctx.audio.playMusic(null);
      this.music = null;
      this.musicKey = '';
    }
  }
}

/** Where a click in the world sends the hero (`Riftlight.walkTo`): a town interactable, a ground drop, the level's open portal. */
export type WalkTarget = { readonly kind: 'it'; readonly id: string } | { readonly kind: 'loot'; readonly id: number } | { readonly kind: 'portal' };

/** A town interactable as the mouse's target on screen: a townsperson's body (they walk about), else the thing itself. */
export function thingBox(it: Interactable, camera: import('three/webgpu').Camera, ui: UiCanvas): { x: number; y: number; w: number; h: number } | null {
  return it.npc ? worldBox(it.npc.position, 1.9, 0.9, camera, ui) : worldBox(it.position, 1.4, 1.4, camera, ui);
}

/** A walk to a thing clicked (`Riftlight.walk`). */
const WALK = {
  /** Closer by this much (m) is progress... */
  progress: 0.1,
  /** ...none for this many steps (4 s) and it gives up (something in the way). */
  giveUp: 240,
  /** In reach of a townsperson but another is nearer: done once no closer for this many steps. */
  settle: 20,
} as const;

/** `Riftlight.walkTo`: what the click was on, seconds on the way, its closest yet (m) and steps since, the steering. */
interface WalkTo {
  readonly target: WalkTarget;
  time: number;
  best: number;
  since: number;
  readonly nav: HeroWalk;
}

/** Either Shift key. */
const SHIFT = ['ShiftLeft', 'ShiftRight'] as const;

/** `MOUSE.left`'s finger and its mouse button, apart (`readIntent`: a finger's swing waits, the mouse's doesn't). */
const FINGER = [TOUCH_KEY] as const;
/** The move a window on top leaves the hero (`readIntent`): none. */
const HELD: Readonly<{ x: number; y: number }> = { x: 0, y: 0 };
/** The windows a townsperson or the stash opens at their place, by the interactable's action (`keepInReach`). */
const COUNTERS: Readonly<Partial<Record<NonNullable<Interactable['action']>, string>>> = { stash: 'stash', vendor: 'vendor', craft: 'crafting' };
/** Metres past an interactable's reach a counter's window stays open (`keepInReach`): a townsperson brushing past is no walk away. */
const REACH_SLACK = 0.25;
const MOUSE_LEFT = ['MouseLeft'] as const;

/**
 * Fixed steps after the one it landed in that a finger alone on the world waits before it swings
 * (about 33 ms): a pinch's second finger landing by then lets go of the first's press, so a pinch
 * is no swing; a tap shorter than that is none either.
 */
const FINGER_WAIT = 2;

/** A character screen's id (`PAGES`). */
const isPage = (id: string | undefined): id is Page => (PAGES as readonly string[]).includes(id ?? '');

/** The character screen `panel` is in the ring (`PAGES`), or null: not one, or kept out of it (`Panel.ring`: Oru's respec tree). */
const pageOf = (panel: Panel | undefined): Page | null => (panel && panel.ring !== false && isPage(panel.id) ? panel.id : null);

/** The ring's way for a page key: -1 L1 / Q, 1 R1 / E, else 0. */
const pageDir = (code: string): 1 | -1 | 0 => ((KEYS.pagePrev as readonly string[]).includes(code) ? -1 : (KEYS.pageNext as readonly string[]).includes(code) ? 1 : 0);

/** Auto-aim's last resort: the nearest monster this close (m), whichever way it stands. */
const AIM_AROUND = 7;

/** What the shell's aim snaps to: monsters (a level's actors; the hero's own minions are not). */
const hostile = (a: ActorLike): boolean => a.faction === 'monster';

/** What a level was built from: the spec, the run's random stream and the id counters as `build` was called. */
interface LevelEntry {
  readonly spec: LevelSpec;
  readonly rng: number;
  readonly actors: number;
  readonly props: number;
  /** What its plan was (`LevelPort.signature`): a restore checks it before leaving the level on now. */
  readonly plan: string | null;
}

/** `Riftlight.snapshot`: plain JSON. */
interface RiftSnapshot {
  readonly format: 1;
  readonly screen: 'town' | 'level';
  readonly slot: number;
  readonly save: SaveData;
  readonly saves: SavesView;
  readonly settings: Partial<Settings>;
  readonly dev: DevFlags;
  readonly rng: number;
  /** Presentation's stream (shake, damage numbers, sound pitch): a restored moment shakes as the original did. */
  readonly fx: number;
  readonly ids: { readonly actors: number; readonly props: number };
  readonly hero: unknown;
  readonly loot: unknown;
  readonly town: TownState;
  readonly level: { readonly entry: LevelEntry; readonly state: unknown } | null;
  readonly shell: {
    readonly time: number;
    readonly playtime: number;
    readonly levelTime: number;
    readonly cleared: boolean;
    readonly dead: boolean;
    readonly deathTimer: number;
    readonly dialogueLine: string | null;
    readonly gifts: number;
    readonly clearEmitted: boolean;
    readonly combatHeat: number;
    readonly combatSince: number;
    readonly music: SongName | null;
    readonly session: Riftlight['session'];
    readonly interactQueued: boolean;
    /** A held press a thing in the world or the map took (left out by snapshots from before it). */
    readonly pressTaken?: boolean;
    /** Steps a finger alone has been down on the world (`Riftlight.fingerHeld`; left out by older snapshots). */
    readonly fingerHeld?: number;
    /** The map is open (left out by snapshots from before it). */
    readonly map?: boolean;
    /** What the mouse was over in the world and the thing a click walks the hero to (left out by older snapshots). */
    readonly worldFocus?: WalkTarget | null;
    /** What a finger could tap or swipe away as the last frame drew it (`Riftlight.touchable`; left out by older snapshots). */
    readonly touchable?: { readonly loot: readonly { readonly id: number; readonly rect: Box }[]; readonly prompt: Box | null; readonly feed: readonly Box[]; readonly dialogue: Box | null };
    /** The touch controls the last frame's HUD laid out around, art pixels (left out by older snapshots). */
    readonly hudControls?: readonly Box[];
    /** The page's ≡ in 52in1's place (`TouchPad.hub`; left out by older snapshots). */
    readonly touchHub?: boolean;
    readonly walk?: { readonly target: WalkTarget; readonly time: number; readonly best: number; readonly since: number; readonly nav: HeroWalkState } | null;
    readonly lootFocus: number | null;
    readonly levelUpAge: number;
    readonly hurt: number;
    readonly goldShown: number;
    readonly streak: { count: number; age: number } | null;
    readonly feed: readonly FeedLine[];
    readonly intent: Omit<MutableIntent, 'aim'> & { readonly aim: readonly number[] };
    /** Motion aim's kept direction (left out by snapshots from before it). */
    readonly motionAim?: { readonly x: number; readonly z: number; readonly idle: number } | null;
    readonly botIntent: SavedIntent | null;
    readonly camera: { readonly target: readonly number[]; readonly lead: readonly number[]; readonly shake: readonly number[]; readonly shakeTime: number; readonly shakeStrength: number; readonly zoomGoal: number };
  };
  readonly banners: ReturnType<BannerQueue['save']>;
  readonly floaters: ReturnType<Floaters['save']>;
  readonly recap: RecapState;
  readonly pointer: PointerState;
  readonly menuInput: ReturnType<MenuInput['save']>;
}

/** Data the shell takes from the page, through `ctx.input.send` (recorded with the frame it arrives in). */
type RiftCommand =
  | { readonly rl: 'run'; readonly slot: number; readonly seed: number }
  | { readonly rl: 'load'; readonly slot: number; readonly data: SaveData }
  | { readonly rl: 'settings'; readonly settings: Partial<Settings> }
  | { readonly rl: 'saves'; readonly saves: SavesView }
  | { readonly rl: 'imported'; readonly slot: number; readonly data?: SaveData; readonly error?: string }
  | { readonly rl: 'storage'; readonly error: string }
  /** The page's touch controls (sent at setup): in 52in1 ≡ is below the hub's wake band (`TouchPad.hub`). */
  | { readonly rl: 'touch'; readonly hub: boolean }
  | { readonly rl: 'intent'; readonly intent: SavedIntent }
  | { readonly rl: 'bot'; readonly act: BotAct }
  /** Motion aim went off: its kept direction lets go (`watchMotion`). */
  | { readonly rl: 'motion'; readonly on: false }
  | RoundCommand;

/**
 * An agent's intent as data (`rl.step`, `rl.moveTo`, the bot): a recording keeps it, so the run
 * replays. In a command, what is off is left out (no attack, no skill, no dodge...).
 */
export type SavedIntent = { readonly move: { readonly x: number; readonly z: number }; readonly aim: readonly number[]; attack?: boolean; skill?: number; dodge?: boolean; held?: number; interact?: boolean };

/**
 * What the playtest bot does to the shell outside the hero's intent, as recorded input:
 * `close` the top panel (it never browses menus), leave after a `death`, or at the `portal`
 * take the loot window's loot and go home.
 */
export type BotAct = 'close' | 'death' | 'portal';

/** A saved intent back as the hero reads it (what is left out is off). */
function fromSaved(i: SavedIntent): HeroIntent & { interact?: boolean } {
  return { move: { x: i.move.x, z: i.move.z }, aim: new Vector3().fromArray(i.aim), attack: !!i.attack, skill: i.skill ?? -1, dodge: !!i.dodge, held: i.held ?? 0, interact: !!i.interact };
}

/** `?seed=123` makes new runs reproducible (tests, bug reports, playtests). */
function urlSeed(): number | null {
  try {
    const v = new URLSearchParams(location.search).get('seed');
    return v && /^\d+$/.test(v) ? Number(v) >>> 0 : null;
  } catch {
    return null;
  }
}
