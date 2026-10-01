/**
 * Riftlight: the game shell. One `Game` that owns the flow
 *
 *   title ─▶ town ─▶ (rift keeper) ─▶ level ─▶ clear ─▶ loot window ─▶ portal ─▶ town ─▶ …
 *                                       └──▶ death ─▶ recap ─▶ town (XP / gold penalty)
 *
 * and everything around it: save slots, the difficulty sliders, settings, the HUD and
 * menus, the camera, music, the dev tools and the agent API. Gameplay systems plug in
 * through ports (game/ports.ts); stubs (game/stubs) make it playable on its own.
 *
 * Stages swap inside this one Game instead of through `engine.loadGame`: the town is built
 * once and hidden while a level runs, the hero, its model and clips, the HUD, the light
 * pool and the music survive, and a level is just a root object the shell adds and
 * disposes. `loadGame` would rebuild and re-upload all of that on every trip to town.
 */
import { Color, Vector3 } from 'three/webgpu';
import { FILTER_PRESETS, type Game, type GameContext, PALETTE, type PaletteColor, resolveDebugKeys } from '../../engine';
import { HERO_MODEL } from '../../game/hero';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { RANK, SCALING } from '../core/scaling';
import type { DifficultyTuning, GameEvents, SaveData } from '../core/types';
import { Town } from '../town/Town';
import { type HudModel, drawHud, type FeedLine } from '../ui/hud';
import { type UiCanvas, UiCanvas as Canvas, type UiEvent } from '../ui/kit';
import { UiLayer } from '../ui/layer';
import { drawLogo } from '../ui/logo';
import type { Menu } from '../ui/menu';
import { devMenu, type MenuHost, pauseMenu, riftMenu, settingsMenu, slotsMenu, titleMenu, tuningMenu } from '../ui/menus';
import { CharacterSheet, Codex, DeathRecap, dialogue, LootWindow } from '../ui/panels';
import { bubble, Floaters, hitbox, lootLabel } from '../ui/world';
import { installApi } from './api';
import { registerAudio, SONGS, type SongName } from './audio';
import { cameraBasis, KEYS, MenuInput, PAD_BUTTONS, Pointer } from './controls';
import { changedSliders, DIFFICULTY_SHORT, difficultyMods, sanitizeTuning } from './difficulty';
import { registerFx } from './fx';
import { LightPool } from './lights';
import { type DevFlags, type HeroIntent, type HeroPort, ITEM_GROUP, type LevelHandle, type Panel, type PanelHost, type RiftlightPorts, type ShellServices, type WorldLoot } from './ports';
import { addGemXp } from '../loot/sockets';
import { addXp, applyDeath, emptyStats, formatTime, killXp, levelTitle, recordClear, unlockedDepths, xpFraction } from './progress';
import { RecapTracker } from './recap';
import { newSave, SaveStore } from './save';
import { loadSettings, type Settings, storeSettings } from './settings';
import { stubPorts } from './stubs';
import { corePorts } from '../wire';
import { realLootPort } from '../wire/loot';
import { realTreePort } from '../wire/tree';

export type Screen = 'title' | 'town' | 'level' | 'loading';

/** Camera framing per stage (zoom on the iso preset; the settings zoom multiplies it). */
export const CAMERA = { title: 1.0, town: 1.22, level: 1.08, lead: 0.22, leadMax: 1.6 } as const;

interface MutableIntent {
  move: { x: number; z: number };
  aim: Vector3;
  attack: boolean;
  skill: number;
  dodge: boolean;
  held: number;
}

export class Riftlight implements Game, MenuHost {
  readonly name = 'Riftlight';
  readonly assets = [HERO_MODEL, 'assets/tree.glb'];
  readonly ports: RiftlightPorts;
  readonly events = new EventBus<GameEvents>();
  readonly store: SaveStore;
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
  readonly layer = new UiLayer();
  ui!: UiCanvas;
  pointer!: Pointer;
  private readonly menuInput = new MenuInput();
  private rng = new Rng(1);
  private readonly recap = new RecapTracker();
  private readonly floaters = new Floaters();
  private feed: FeedLine[] = [];
  private card: HudModel['card'] = null;
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
  // camera
  private readonly camTarget = new Vector3();
  private readonly lead = new Vector3();
  private readonly shakeOffset = new Vector3();
  private shakeTime = 0;
  private shakeStrength = 0;
  private zoomGoal: number = CAMERA.title;
  // input
  private readonly intent: MutableIntent = { move: { x: 0, z: 0 }, aim: new Vector3(), attack: false, skill: -1, dodge: false, held: 0 };
  /** Agent / bot override: drives the hero instead of the player while set. */
  botIntent: (HeroIntent & { interact?: boolean }) | null = null;
  private interactQueued = false;
  private readonly right = new Vector3();
  private readonly forward = new Vector3();
  private readonly tmp = new Vector3();
  private time = 0;
  private music: SongName | null = null;
  private combatHeat = 0;
  private combatSince = 0;
  /** Counters for playtests and the agent API (reset on level entry). */
  readonly session = { kills: 0, xp: 0, gold: 0, items: 0, deaths: 0, damageTaken: 0 };
  /** Last events, for agents (`__RIFTLIGHT__.log()`). */
  readonly log: { t: number; type: string; text: string }[] = [];
  private savedGamepad: Record<number, string> | null = null;
  private savedKeys: ReturnType<typeof resolveDebugKeys> | null = null;
  private disposeApi: (() => void) | null = null;
  private readonly unsubs: (() => void)[] = [];
  private playtime = 0;
  private lootFocus: WorldLoot | null = null;
  private fileInput: HTMLInputElement | null = null;
  private gifts = 0;
  /** A level system already announced the clear (`levelClear`): the shell doesn't repeat it. */
  private clearEmitted = false;
  private musicKey = '';

  constructor(ports: Partial<RiftlightPorts> = {}, options: { store?: SaveStore } = {}) {
    // The real hero, levels and monsters (src/riftlight/wire) and the real loot and tree;
    // pass ports to replace any of them (tests: `new Riftlight(stubPorts())`).
    this.ports = { ...stubPorts(), ...corePorts(), loot: realLootPort(), tree: realTreePort(), ...ports };
    this.store = options.store ?? new SaveStore();
  }

  get audio() {
    return this.ctx.audio;
  }

  // ================================================================ lifecycle

  async setup(ctx: GameContext): Promise<void> {
    this.ctx = ctx;
    const { engine } = ctx;
    registerAudio(ctx.audio);
    registerFx(ctx.particles);
    // Engine hotkeys move off the game's keys (P = passive tree, R = skill 3).
    this.savedKeys = engine.debugKeys;
    engine.debugKeys = resolveDebugKeys({ mode: 'F8', resolution: 'F7' });
    this.savedGamepad = ctx.input.gamepadButtons;
    ctx.input.gamepadButtons = { ...PAD_BUTTONS };
    this.ui = new Canvas(ctx.hud);
    this.pointer = new Pointer(engine);
    this.lights = new LightPool(ctx.lights); // the engine's pool: the one light system
    this.layer.onSound = (s) => this.sound(s);
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
    const tree = await ctx.loadModel('assets/tree.glb');
    this.town = new Town(this.services);
    this.town.build(tree.scene);
    ctx.scene.add(this.town.root);
    this.town.activate();
    this.town.dayTime = 0.56; // the title opens at nightfall
    this.hero = await this.ports.hero.create(this.services, this.save.hero);
    this.hero.object.visible = false;
    this.applySettings();
    this.toTitle();
    this.disposeApi = installApi(this);
  }

  dispose(ctx: GameContext): void {
    for (const u of this.unsubs) u();
    this.disposeApi?.();
    this.pointer?.dispose();
    this.fileInput?.remove();
    if (this.savedKeys) ctx.engine.debugKeys = this.savedKeys;
    if (this.savedGamepad) ctx.input.gamepadButtons = this.savedGamepad;
    this.level?.dispose();
    this.level = null;
    this.hero?.dispose();
    this.town?.dispose();
    this.events.clear();
    this.layer.closeAll();
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
        return;
      }
      const at = target.position.clone().setY(1.2);
      this.combatHeat = Math.min(1, this.combatHeat + 0.25);
      this.combatSince = 0;
      // a hero whose combat plays its own juice (sounds, sparks by skill) only gets numbers here
      if (!this.hero?.juice) {
        this.ctx.particles.burst('rl.hit', at);
        this.ctx.audio.play(result.crit ? 'rl.crit' : 'rl.hit', { pitch: this.rng.range(-2, 2), volume: 0.7 });
      }
      if (this.settings.damageNumbers && result.total > 0) {
        const top = (Object.entries(result.byType) as [string, number][]).sort((a, b) => b[1] - a[1])[0]?.[0];
        const color: PaletteColor = result.crit ? 'sand' : top === 'fire' ? 'orange' : top === 'cold' ? 'sky' : top === 'lightning' ? 'cyan' : 'white';
        this.floaters.add(at.setY(1.6), String(Math.round(result.total)), color, result.crit, this.rng.range(-1, 1));
      }
    });
    on('kill', ({ target, rank }) => {
      if (!this.hero || target === this.hero.actor) return;
      // `xp.gain` is a multiplier stat (base 1): shrines, mechanic rewards, gear
      const gain = this.hero.actor.stats.get('xp.gain');
      const xp = Math.max(1, Math.round(killXp(target.level, RANK[rank].xp, this.save.hero.level) * (gain > 0 ? gain : 1)));
      this.gainXp(xp);
      this.session.kills++;
      const stats = (this.save.stats ??= emptyStats());
      stats.kills++;
      this.streak = { count: (this.streak && this.streak.age < 3 ? this.streak.count : 0) + 1, age: 0 };
      this.ctx.audio.play('rl.die', { pitch: rank === 'boss' ? -8 : this.rng.range(-2, 3) });
      this.ctx.particles.burst('smoke', target.position.clone().setY(0.6), { count: rank === 'boss' ? 14 : 5 });
      if (rank === 'boss') this.services.shake(0.8, 0.5);
      this.note('kill', `${target.name ?? 'monster'} +${xp}xp`);
    });
    on('death', ({ actor }) => {
      if (this.hero && actor === this.hero.actor && !this.dead) this.onHeroDeath();
    });
    on('mechanic', ({ id }) => this.unlockCodex(id));
    on('levelClear', () => (this.clearEmitted = true));
  }

  private note(type: string, text: string): void {
    this.log.push({ t: +this.time.toFixed(2), type, text });
    if (this.log.length > 200) this.log.shift();
  }

  // ================================================================ flow

  /** Title screen: the town at dusk behind the logo and menu, no hero. */
  toTitle(): void {
    this.leaveLevel();
    this.screen = 'title';
    this.layer.closeAll();
    this.hero.object.visible = false;
    this.town.activate();
    this.zoomGoal = CAMERA.title;
    this.playMusic('title');
    this.layer.open(titleMenu(this), { modal: false, bare: true, sticky: true, silent: true });
  }

  /** Start a fresh run in a slot. */
  newRun(slot: number, seed = urlSeed() ?? (Date.now() ^ (slot * 7919)) >>> 0): void {
    this.slot = slot;
    this.save = newSave(seed);
    this.store.save(slot, this.save);
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
    this.slot = slot;
    this.save = data;
    this.applySave();
    this.note('run', `loaded slot ${slot + 1}`);
    this.goTown('load');
    return true;
  }

  /** Push the save into every system: hero level, tree, gear, difficulty, loot. */
  private applySave(): void {
    this.rng = new Rng(this.save.seed).fork('run');
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
    this.layer.closeAll();
    this.screen = 'town';
    this.dead = false;
    this.town.activate();
    this.town.dayTime = reason === 'new' || reason === 'load' ? 0.18 : this.town.dayTime;
    this.hero.object.visible = true;
    const at = reason === 'portal' ? this.town.portalSpawn : this.town.spawn;
    this.hero.enter(this.town, at, reason === 'portal' ? Math.PI * 0.75 : Math.PI * 0.75 + Math.PI);
    this.hero.restore();
    this.ctx.engine.camera.teleport(this.camTarget.copy(at).setY(at.y + 0.9));
    this.zoomGoal = CAMERA.town;
    this.playMusic('town');
    this.card = { title: 'EMBERFALL', subtitle: 'the town', age: 1.2 }; // a shorter card at home
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
    this.ctx.audio.play('rl.portal');
    this.leaveLevel();
    this.town.deactivate();
    this.ctx.scene.background = new Color(PALETTE.ink);
    const spec = this.ports.levels.spec(d, this.save.seed);
    this.rng = new Rng(this.save.seed).fork(`level:${d}:${this.save.stats?.runs ?? 0}`);
    const level = await this.ports.levels.build(spec, { services: this.services, monsters: this.ports.monsters, loot: this.ports.loot, hero: this.hero });
    this.level = level;
    this.ctx.scene.add(level.root);
    this.hero.object.visible = true;
    this.hero.enter(level, level.start, Math.PI);
    this.hero.restore();
    this.ctx.engine.camera.teleport(this.camTarget.copy(level.start).setY(0.9));
    this.screen = 'level';
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
    this.card = { title: levelTitle(d, spec.name), subtitle: d > 12 ? 'a rift' : `depth ${d}`, age: 0 };
    this.combatHeat = 0;
    this.playMusic('level');
    this.note('flow', `level ${d} ${spec.name}`);
  }

  private leaveLevel(): void {
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
    this.ctx.audio.play('rl.portal');
    this.goTown('portal');
  }

  private onHeroDeath(): void {
    this.dead = true;
    this.deathTimer = 0;
    this.session.deaths++;
    this.hero.emote('death');
    this.ctx.audio.playMusic(null);
    this.music = null;
    this.musicKey = '';
    this.ctx.audio.play('rl.death');
    this.note('death', `slain by ${this.recap.recap().killer ?? '?'}`);
  }

  private showRecap(): void {
    const recap = this.recap.recap();
    const penalty = applyDeath(this.save);
    this.goldShown = this.save.hero.gold;
    const where = this.level ? levelTitle(this.level.spec.depth, this.level.spec.name) : 'Emberfall';
    this.layer.open(new DeathRecap(recap, penalty, where, () => this.goTown('death')), { modal: true, sticky: true });
  }

  private onClear(): void {
    if (!this.level) return;
    this.cleared = true;
    const depth = this.level.spec.depth;
    const deeper = recordClear(this.save, depth, this.levelTime);
    if (!this.clearEmitted) this.events.emit('levelClear', { depth, time: this.levelTime });
    this.ctx.audio.play('rl.clear');
    this.card = { title: 'LEVEL CLEAR', subtitle: `${formatTime(this.levelTime)}${deeper ? ' · new depth unlocked' : ''}`, age: 0 };
    this.hero.emote('victory');
    this.playMusic('level');
    this.autosave('clear');
    this.note('flow', `clear depth ${depth} in ${this.levelTime.toFixed(1)}s`);
  }

  /** Portal reached: the loot window if anything is left, else straight home. */
  private atPortal(): void {
    const left = this.ports.loot.ground().filter((l) => !l.filtered);
    if (!left.length) return this.returnToTown();
    if (this.layer.has('loot')) return;
    this.layer.open(
      new LootWindow(
        () => this.ports.loot.ground().filter((l) => !l.filtered),
        () => [`${levelTitle(this.level!.spec.depth, this.level!.spec.name)} cleared in ${formatTime(this.levelTime)}`, `${this.session.kills} kills · +${this.session.xp} xp · +${this.session.gold} gold`],
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

  gainXp(amount: number): void {
    const gained = addXp(this.save.hero, amount);
    this.session.xp += amount;
    this.events.emit('xp', { amount, level: this.save.hero.level });
    if (gained > 0) {
      this.hero.setLevel(this.save.hero.level);
      this.hero.restore();
      this.levelUpAge = 0;
      this.ctx.audio.play('rl.levelUp');
      this.ctx.particles.burst('rl.levelup', this.hero.actor.position.clone().setY(0.2));
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
      this.feedLine(`${g.name.toUpperCase()} REACHED LEVEL ${g.level}`, 'cyan');
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
      this.feedLine('INVENTORY FULL', 'red');
      this.sound('error');
      return false;
    }
    if (r.gold) {
      this.addGold(r.gold);
      this.events.emit('gold', { amount: r.gold, at: l.position });
      this.ctx.audio.play('rl.gold', { pitch: this.rng.range(-1, 2) });
      this.ctx.particles.burst('rl.coins', l.position.clone().setY(0.3));
      this.feedLine(`+${r.gold} GOLD`, 'sand');
    }
    if (r.item) {
      this.session.items++;
      this.events.emit('loot', { item: r.item, at: l.position });
      this.ctx.audio.play('rl.drop');
      this.feedLine(r.item.name.toUpperCase(), l.color);
    }
    return true;
  }

  private feedLine(text: string, color: PaletteColor): void {
    const same = this.feed.find((f) => f.t < 1 && f.text.endsWith(' GOLD') && text.endsWith(' GOLD'));
    if (same) {
      same.text = `+${Number(same.text.replace(/\D/g, '')) + Number(text.replace(/\D/g, ''))} GOLD`;
      same.t = 0;
      return;
    }
    this.feed.unshift({ text, color, t: 0 });
    if (this.feed.length > 6) this.feed.pop();
  }

  unlockCodex(id: string): void {
    const codex = (this.save.codex ??= []);
    if (codex.includes(id)) return;
    codex.push(id);
    const m = this.ports.levels.mechanics().find((x) => x.id === id);
    if (m && this.screen !== 'title') this.feedLine(`CODEX: ${m.name.toUpperCase()}`, 'cyan');
  }

  autosave(why: string): boolean {
    if (this.screen === 'title' && why !== 'quit') return false;
    this.ports.loot.write(this.save);
    const stats = (this.save.stats ??= emptyStats());
    stats.playtime = Math.round(this.playtime);
    const ok = this.store.save(this.slot, this.save);
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

  applySettings(): void {
    const e = this.ctx.engine;
    const look = this.settings.look && FILTER_PRESETS[this.settings.look] ? FILTER_PRESETS[this.settings.look]! : [];
    if (this.settings.look || e.filters.length === 0) {
      if (look.join() !== e.filters.join()) e.setFilters(look);
    }
    if (this.settings.quality !== 'auto' && e.quality !== this.settings.quality) e.setQuality(this.settings.quality);
    storeSettings(this.settings);
  }

  openMenu(menu: Menu, modal = true): void {
    this.layer.open(menu, { modal });
  }

  closeMenu(id?: string): void {
    this.layer.close(id);
  }

  exportSlot(slot: number): void {
    const text = this.store.exportSlot(slot);
    if (!text) return this.sound('error');
    try {
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
    const input = (this.fileInput ??= Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' }));
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      void f.text().then((text) => {
        try {
          this.store.importSlot(slot, text);
          this.sound('open');
        } catch (e) {
          this.store.lastError = e instanceof Error ? e.message : String(e);
          this.sound('error');
        }
        input.value = '';
      });
    };
    input.click();
  }

  deleteSlot(slot: number): void {
    this.store.remove(slot);
    this.sound('close');
  }

  depths(): { depth: number; title: string; best?: number; next: boolean }[] {
    return unlockedDepths(this.save).map((depth) => {
      const spec = this.ports.levels.spec(depth, this.save.seed);
      return { depth, title: levelTitle(depth, spec.name), best: this.save.stats?.best[String(depth)], next: depth === this.save.deepest + 1 };
    });
  }

  devGive(what: 'xp' | 'gold' | 'item' | 'level'): void {
    if (what === 'xp') this.gainXp(100 * this.save.hero.level);
    else if (what === 'level') this.gainXp(Math.max(1, (this.save.hero.xp > 0 ? 0 : 1) + SCALING.xpToNext(this.save.hero.level) - this.save.hero.xp));
    else if (what === 'gold') {
      this.addGold(500);
      this.feedLine('+500 GOLD', 'sand');
    } else {
      const item = this.ports.loot.give(this.rng.fork(`give:${this.gifts++}`), this.save.hero.level);
      if (item) this.feedLine(item.name.toUpperCase(), 'sand');
    }
  }

  devKillAll(): void {
    for (const m of this.level?.monsters() ?? []) {
      const a = m.actor;
      if (!a.alive) continue;
      const result = a.takeHit({ source: this.hero.actor, tags: ['dev'], damage: { chaos: a.life * 10 + 1e6 }, crit: false });
      this.events.emit('hit', { target: a, result, hit: { source: this.hero.actor, tags: ['dev'], damage: {}, crit: false } });
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
  private panelHost(self: { panel?: Panel } = {}): PanelHost {
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
    };
  }

  openPanel(id: 'inventory' | 'skills' | 'tree' | 'character' | 'codex' | 'vendor' | 'stash' | 'crafting' | 'respec' | 'rift' | 'pause' | 'tuning' | 'settings' | 'dev' | 'slots'): Panel | null {
    if (this.screen === 'title' && !['settings', 'slots'].includes(id)) return null;
    const self: { panel?: Panel } = {};
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
        panel = new CharacterSheet(() => this.hero.actor.stats, () => `LEVEL ${this.save.hero.level} · DEEPEST ${this.save.deepest}`);
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
  }

  // ================================================================ per frame

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (this.screen !== 'town' && this.screen !== 'level') return;
    if (this.worldPaused) return;
    const intent = this.botIntent ?? this.readIntent(ctx);
    if (this.dead) {
      this.intent.move.x = this.intent.move.z = 0;
      this.hero.fixedUpdate(dt, { ...this.intent, attack: false, skill: -1, dodge: false, held: 0 });
    } else this.hero.fixedUpdate(dt, intent);
    this.level?.fixedUpdate(dt, this.hero);
    if (this.botIntent?.interact) this.interactQueued = true;
  }

  /** The world freezes under modal panels (pause, tuning, tree, recap) and while loading. */
  get worldPaused(): boolean {
    return this.screen === 'loading' || this.layer.modal;
  }

  /** Player intent from keys, mouse, pad and touch (fixed step). */
  private readIntent(ctx: GameContext): HeroIntent {
    const input = ctx.input;
    const i = this.intent;
    const panelOpen = !!this.layer.top;
    const axis = input.moveAxis();
    cameraBasis(ctx.engine, this.right, this.forward);
    i.move.x = this.right.x * axis.x + this.forward.x * axis.y;
    i.move.z = this.right.z * axis.x + this.forward.z * axis.y;
    const mouseAim = !this.padGlyphs() && this.pointer.known && this.pointer.idle < 6;
    const hp = this.hero.actor.position;
    if (mouseAim && this.pointer.ground(this.tmp, hp.y)) i.aim.copy(this.tmp);
    else i.aim.copy(this.autoAim());
    const overUi = panelOpen && this.layer.top && this.ui.hover(this.layer.top.rect);
    i.attack = !overUi && (input.anyDown(KEYS.attack) || ((this.pointer.buttons & 1) !== 0 && !this.pointerOnHud()));
    i.skill = -1;
    for (let s = 0; s < 4; s++) if (input.consumeAny(KEYS.skill[s]!)) i.skill = s;
    if ((this.pointer.buttons & 2) !== 0 && !overUi) i.skill = 0;
    // held skill keys keep channels (whirlwind, beams) going
    let held = 0;
    for (let s = 0; s < 4; s++) if (input.anyDown(KEYS.skill[s]!)) held |= 1 << s;
    if ((this.pointer.buttons & 2) !== 0 && !overUi) held |= 1;
    i.held = panelOpen ? 0 : held;
    i.dodge = input.consumeAny(KEYS.dodge);
    if (panelOpen) {
      i.attack = false;
      i.skill = -1;
      i.dodge = false;
    }
    return i;
  }

  /** Pad / keyboard aim: the nearest living monster in front, else straight ahead. */
  private autoAim(): Vector3 {
    const hp = this.hero.actor.position;
    let best: Vector3 | null = null;
    let bd = 7;
    for (const a of this.level?.actors() ?? []) {
      if (!a.alive) continue;
      const d = a.position.distanceTo(hp);
      if (d < bd) {
        bd = d;
        best = a.position;
      }
    }
    if (best) return best;
    const m = this.intent.move;
    if (Math.hypot(m.x, m.z) > 0.1) return this.tmp.set(hp.x + m.x * 3, hp.y, hp.z + m.z * 3);
    return this.tmp.copy(this.intent.aim);
  }

  private pointerOnHud(): boolean {
    const p = this.pointer.art;
    return p.y > this.ui.h - 36 && Math.abs(p.x - this.ui.w / 2) < 90;
  }

  padGlyphs(): boolean {
    return this.settings.glyphs === 'controller' || (this.settings.glyphs === 'auto' && this.ctx.input.gamepadConnected && this.pointer.idle > 2);
  }

  update(ctx: GameContext, dt: number): void {
    this.time += dt;
    const ui = this.ui;
    ui.time = this.time;
    ui.pad = this.padGlyphs();
    // pointer and menu input → the panel stack, then game hotkeys
    const events: UiEvent[] = [...this.pointer.frame(dt), ...this.menuInput.events(ctx.input, dt)];
    ui.pointer.x = this.pointer.art.x;
    ui.pointer.y = this.pointer.art.y;
    ui.pointer.used = this.pointer.idle < 4 && !this.pointer.touch;
    this.layer.update(dt);
    let consumed = false;
    for (const e of events) {
      if (this.layer.top && this.layer.input(e)) {
        consumed ||= e.kind !== 'pointer';
        continue;
      }
      // the world: a pointer press on a loot label picks it up
      if (e.kind === 'pointer' && e.type === 'down' && this.lootFocus && this.screen === 'level') this.tryPickup(this.lootFocus);
    }
    // a key a menu used this frame (Esc closing a panel) must not also reopen one
    if (!consumed) this.hotkeys(ctx);

    if (this.screen === 'town' || this.screen === 'level' || this.screen === 'title') {
      if (!this.worldPaused) this.advance(dt);
      else if (this.screen === 'town' || this.screen === 'title') this.town.update(0, null); // keep town lights/sky consistent
    }
    this.updateCamera(ctx, dt);
    this.draw(ctx);
    // the wheel zooms the camera through the settings (and is consumed so the rig doesn't)
    if (ctx.input.wheel && !this.layer.top) {
      this.settings.zoom = Math.max(0.6, Math.min(1.6, this.settings.zoom * Math.pow(1.08, -ctx.input.wheel)));
    }
    ctx.input.wheel = 0;
  }

  private hotkeys(ctx: GameContext): void {
    const input = ctx.input;
    const pressed = (codes: readonly string[]) => input.wasPressed(...codes);
    if (this.screen === 'title' || this.screen === 'loading') return;
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
      if (!it) return false;
      if (it.action === 'stash') {
        this.openPanel('stash');
        return true;
      }
      if (it.npc) {
        this.talkingTo = it.npc;
        this.dialogueLine = it.npc.talk();
        this.ctx.audio.play('rl.bark');
      }
      const panel = it.action === 'craft' ? 'crafting' : it.action === 'vendor' ? 'vendor' : it.action === 'tree' ? 'respec' : it.action === 'rift' ? 'rift' : null;
      if (panel) this.openPanel(panel);
      return true;
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
    }
    this.town.update(dt, this.screen === 'town' ? this.hero.actor.position : null);
    this.ports.loot.update(dt);
    this.floaters.update(dt);
    for (const f of this.feed) f.t += dt;
    this.feed = this.feed.filter((f) => f.t < 4.5);
    if (this.card) this.card.age += dt;
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
      if (this.cleared && !this.dead && level.exitOpen && p.distanceTo(level.exit) < 1.4 && !this.layer.has('loot') && !this.layer.top) this.atPortal();
      // death: a beat to watch the hero fall, then the recap
      if (this.dead) {
        this.deathTimer += dt;
        if (this.deathTimer > 1.6 && !this.layer.has('death')) this.showRecap();
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
    return this.shakeOffset.lengthSq() > 0 ? this.tmp.copy(this.camTarget).add(this.shakeOffset) : this.camTarget;
  }

  private updateCamera(ctx: GameContext, dt: number): void {
    const rig = ctx.camera;
    if (this.screen === 'title') {
      this.town.titleTarget(this.time, this.camTarget);
    } else if (this.hero && (this.screen === 'town' || this.screen === 'level')) {
      const p = this.hero.actor.position;
      // lead a little toward where the hero aims
      const want = this.tmp.copy(this.intent.aim).sub(p).setY(0);
      if (this.botIntent) want.copy(this.botIntent.aim).sub(p).setY(0);
      want.multiplyScalar(CAMERA.lead);
      if (want.length() > CAMERA.leadMax) want.setLength(CAMERA.leadMax);
      if (this.dead || this.layer.modal) want.set(0, 0, 0);
      this.lead.lerp(want, 1 - Math.exp(-3 * dt));
      this.camTarget.set(p.x + this.lead.x, p.y + 0.9, p.z + this.lead.z);
    }
    // shake
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.shakeTime > 0 && this.shakeStrength > 0) {
      const s = this.shakeStrength * Math.min(1, this.shakeTime * 5);
      this.shakeOffset.set(this.rng.range(-s, s), this.rng.range(-s, s) * 0.5, this.rng.range(-s, s));
    } else {
      this.shakeStrength = 0;
      this.shakeOffset.set(0, 0, 0);
    }
    const goal = this.zoomGoal * this.settings.zoom;
    if ('zoom' in rig && Math.abs(rig.zoom - goal) > 1e-3) rig.setZoom(rig.zoom + (goal - rig.zoom) * (1 - Math.exp(-4 * dt)));
  }

  // ================================================================ drawing

  private draw(ctx: GameContext): void {
    const ui = this.ui;
    const hud = ctx.hud;
    const cam = ctx.engine.camera.camera;
    hud.clear();
    if (this.screen === 'title') {
      drawLogo(ui, ui.w / 2, 30, this.time);
      ui.text(ui.w / 2, 66, 'A HACK-AND-SLASH OF ENDLESS RIFTS', { align: 'center', color: 'mist' });
      ui.mini(ui.w - 4, ui.h - 8, this.hero?.juice ? 'RIFTLIGHT' : 'STUB SYSTEMS · R6 SHELL', 'slate', 'right');
      this.layer.draw(ui, this.time);
      return;
    }
    if (this.screen === 'loading') {
      ui.rect(0, 0, ui.w, ui.h, 'ink');
      ui.text(ui.w / 2, ui.h / 2 - 4, 'OPENING THE RIFT' + '.'.repeat(1 + (Math.floor(this.time * 4) % 3)), { align: 'center', color: 'cyan' });
      return;
    }
    // world overlays
    if (this.screen === 'town') {
      for (const b of this.town.bubbles()) bubble(ui, cam, b.at, b.text, b.t);
      const it = !this.layer.top ? this.town.nearest(this.hero.actor.position) : null;
      // interaction prompts sit above the skill bar (the world has bubbles and labels)
      if (it) this.prompt(`${it.verb} ${it.name.toUpperCase()}`, it.npc?.def.title);
    }
    this.lootFocus = null;
    if (this.screen === 'level' && this.level) {
      const near = this.nearestLoot(1.8);
      const p = this.hero.actor.position;
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const l of this.ports.loot.ground()) {
        if (l.filtered || l.drop.kind === 'gold') continue;
        const d = l.position.distanceTo(p);
        if (d > 9) continue;
        const r = lootLabel(ui, cam, l.position, l.label, l.color, l === near, l.tier, placed);
        if (r && this.ui.hover(r)) this.lootFocus = l;
      }
      if (near) this.prompt(`PICK UP ${near.label}`);
      else if (this.level.exitOpen && p.distanceTo(this.level.exit) < 4) this.prompt('RETURN TO TOWN', 'the portal is open');
      if (this.dev.hitboxes) {
        hitbox(ui, cam, p, this.hero.actor.radius, 'lime');
        for (const a of this.level.actors()) if (a.alive) hitbox(ui, cam, a.position, a.radius, 'red');
        for (const t of this.level.telegraphs()) hitbox(ui, cam, t.at, t.radius, 'orange');
      }
      this.floaters.draw(ui, cam);
    }
    drawHud(ui, this.hudModel());
    if (this.dialogueLine && this.layer.top) dialogue(ui, this.dialogueLine, this.layer.top.rect);
    this.layer.draw(ui, this.time);
    if (this.dead && !this.layer.has('death')) {
      const k = Math.min(1, this.deathTimer / 1.2);
      for (let y = 0; y < ui.h; y += 2) if ((y / 2) % 3 < k * 3) ui.rect(0, y, ui.w, 1, 'plum');
      ui.text(ui.w / 2, ui.h / 2 - 20, 'YOU DIED', { align: 'center', scale: 3, color: 'red', shadow: 'ink' });
    }
  }

  /** "[F] TALK BRANN" centred above the skill bar. */
  private prompt(label: string, sub?: string): void {
    const ui = this.ui;
    const y = ui.h - 66;
    const w = ui.prompt(-1000, -1000, 'F', 'RT', label);
    ui.rect(ui.w / 2 - w / 2 - 4, y - 3, w + 8, sub ? 21 : 13, 'ink');
    ui.outline(ui.w / 2 - w / 2 - 4, y - 3, w + 8, sub ? 21 : 13, 'slate');
    ui.prompt(ui.w / 2, y, 'F', 'RT', label, 'white', 'center');
    if (sub) ui.text(ui.w / 2, y + 9, sub.toUpperCase(), { align: 'center', color: 'mist' });
  }

  private hudModel(): HudModel {
    const level = this.level;
    const boss = level?.boss() ?? null;
    let minimap: HudModel['minimap'] = null;
    if (level) {
      const L = level.layout;
      const p = this.hero.actor.position;
      minimap = {
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
    const t = this.save.difficulty;
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
      card: this.card,
      streak: this.streak,
      difficulty: changedSliders(t).map((k) => `${DIFFICULTY_SHORT[k]} ${t[k].toFixed(2)}X`),
      hurt: this.hurt,
      levelLabel: level ? levelTitle(level.spec.depth, level.spec.name) : 'EMBERFALL',
      timer: level ? formatTime(this.levelTime) : null,
      pad: this.padGlyphs(),
      progress: level ? level.progress() : null,
    };
  }

  status(): string {
    const lvl = this.level ? `depth ${this.level.spec.depth} ${this.level.progress().killed}/${this.level.progress().total}` : this.screen;
    return `${lvl} · lv ${this.save.hero.level} · ${this.save.hero.gold}g`;
  }
}

/** `?seed=123` makes new runs reproducible (tests, bug reports, playtests). */
function urlSeed(): number | null {
  try {
    const v = Number(new URLSearchParams(location.search).get('seed'));
    return Number.isFinite(v) && v > 0 ? v >>> 0 : null;
  } catch {
    return null;
  }
}
