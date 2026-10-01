/**
 * The game shell's ports: the only surface the shell (flow, town, HUD, menus, save, bot)
 * uses to reach the systems other workstreams build. Each port has a stub in `./stubs/`
 * so the whole game is playable now; integration swaps the real modules in by passing
 * them to `new Riftlight({ ...stubPorts(), hero: realHero })`.
 *
 *   HeroPort     combat/actors: the player Actor + HeroController (move, attack, dodge, skills)
 *   LevelPort    levels: specs per depth, buildLevel, explored cells, exit, boss
 *   MonsterPort  monsters: generateGenome + buildMonster
 *   LootPort     loot: rollDrops, world loot, inventory / stash / vendor / crafting views
 *   TreePort     tree: treeMods + TreeView
 *
 * Rules for implementations:
 * - Talk to the rest of the game through `services.events` (core/events.ts GameEvents):
 *   combat emits `hit` / `kill` / `death`, loot emits `gold` / `loot`, levels emit
 *   `mechanic` / `levelClear`. The shell listens; it never reaches into a port's internals.
 * - Everything random comes from the `Rng` you are given (forked by purpose).
 * - Add scene objects under the stage's `root`; the shell disposes a level's root when it
 *   unloads it (shared GLB geometry and cached toon materials survive, see lifecycle.ts).
 * - The `difficulty` Mod source is the shell's: apply `services.difficultyMods(side)` as the
 *   `difficulty` source of every actor's StatSheet when it is created. The shell re-applies
 *   it to live actors when the sliders move.
 */
import type { Object3D, Vector3 } from 'three/webgpu';
import type { GameContext, PaletteColor } from '../../engine';
import type { Mod } from '../core/mods';
import type { Rng } from '../core/rng';
import type { Rank } from '../core/scaling';
import type { ActorLike, DifficultyTuning, GameEventBus, Genome, Item, LayoutLike, LevelSpec, SaveData } from '../core/types';
import type { UiCanvas, UiEvent } from '../ui/kit';

// ------------------------------------------------------------------ shared

/** What the shell gives every port. */
export interface ShellServices {
  readonly ctx: GameContext;
  readonly events: GameEventBus;
  /** Point lights a stage may borrow (a fixed pool: no shader recompiles when stages swap). */
  readonly lights: LightPoolLike;
  /** The run's seed generator; fork it by purpose (`rng.fork('level:3')`). */
  readonly rng: Rng;
  /** Current difficulty sliders (read live; they change while playing). */
  difficulty(): DifficultyTuning;
  /** The `difficulty` Mod source for one side (see game/difficulty.ts). */
  difficultyMods(side: 'hero' | 'enemy'): readonly Mod[];
  /** Player settings the systems may honour (damage numbers, screen shake, loot filter). */
  settings(): Readonly<ShellSettings>;
  /** Dev toggles (god mode, AI off, hitboxes). */
  dev(): Readonly<DevFlags>;
  /** Camera shake request (honours the screen-shake setting). */
  shake(strength: number, seconds?: number): void;
  /**
   * The hero's actor once it exists (null before): loot reads `item.rarity` /
   * `item.quantity` / `gold.find` from its StatSheet, the skill panel resolves skills on it.
   * Optional so older hosts and tests still type-check.
   */
  hero?(): ActorLike | null;
}

export interface ShellSettings {
  damageNumbers: boolean;
  /** 0 = show all loot, 1 = hide normal items, 2 = only rare and unique (gold always shows). */
  lootFilter: number;
  /** 0..1 */
  screenShake: number;
  /** Prompts show controller buttons instead of keys. */
  glyphs: 'auto' | 'keyboard' | 'controller';
}

export interface DevFlags {
  god: boolean;
  ai: boolean;
  hitboxes: boolean;
}

export interface LightPoolLike {
  /** Borrow a light (null when the pool is exhausted). Return it with `release`. */
  acquire(color: number, intensity: number, distance: number, at: Vector3 | readonly [number, number, number]): PooledLight | null;
  release(light: PooledLight): void;
  /** Return every borrowed light (stage swap). */
  releaseAll(): void;
}

export interface PooledLight {
  readonly position: Vector3;
  color: number;
  intensity: number;
  distance: number;
}

/** A place actors stand in: the town or a level. */
export interface StageWorld {
  readonly kind: 'town' | 'level';
  /** Parent for everything the stage shows. */
  readonly root: Object3D;
  /** Push a circle at `p` (x, z) with `radius` out of walls and props, in place. */
  collide(p: Vector3, radius: number): void;
  /** Floor height at (x, z). */
  groundY(x: number, z: number): number;
  /** Actors in the stage other than the hero (monsters; empty in town). */
  actors(): readonly ActorLike[];
}

/** A visible attack warning on the ground: the bot dodges these, the HUD may draw them. */
export interface Telegraph {
  readonly at: Vector3;
  readonly radius: number;
  /** Seconds until it lands. */
  readonly remaining: number;
  readonly kind?: 'circle' | 'cone' | 'line';
  readonly source?: ActorLike;
  /** Lines and cones: they start at `at` and run along `dir` (unit, x/z) for `length` m. */
  readonly dir?: { readonly x: number; readonly z: number };
  readonly length?: number;
  /** Line width (m) or cone angle (degrees). */
  readonly width?: number;
  /** A plain swing with no decal (its reach around the attacker): tanking it is an option. */
  readonly soft?: boolean;
}

// ------------------------------------------------------------------ hero (combat / actors)

/** What the player (or the bot) wants this fixed step. Built by game/controls.ts. */
export interface HeroIntent {
  /** World ground direction (x, z), length 0..1 (stick tilt). */
  readonly move: { readonly x: number; readonly z: number };
  /** World point the hero aims at (cursor on the ground, right stick, or auto-target). */
  readonly aim: Vector3;
  /** Basic attack held. */
  readonly attack: boolean;
  /** Skill slot pressed this step (0..3), or -1. */
  readonly skill: number;
  /** Dodge pressed this step. */
  readonly dodge: boolean;
  /** Skill keys held this step, a bit per slot (channelled skills keep going while held). Optional. */
  readonly held?: number;
}

/** One slot of the skill bar. Slots 0..3 are skills, then `attack` and `dodge`. */
export interface SkillSlotView {
  readonly slot: number | 'attack' | 'dodge';
  readonly id: string | null;
  readonly name: string;
  /** Pixel icon rows (`hud.sprite` format) and its colour map; defaults are drawn if absent. */
  readonly icon?: readonly string[];
  readonly colors?: Readonly<Record<string, PaletteColor>>;
  readonly cost: number;
  readonly cooldown: number;
  /** Seconds of cooldown left. */
  readonly remaining: number;
  /** False when there is not enough mana (drawn dimmed). */
  readonly usable: boolean;
  /** The gem's effective tags ('melee', 'area', 'projectile', 'movement'...): bots pick skills by them. Optional. */
  readonly tags?: readonly string[];
}

export interface BuffView {
  readonly id: string;
  readonly name: string;
  readonly remaining: number;
  readonly duration: number;
  readonly color: PaletteColor;
  readonly stacks?: number;
  readonly debuff?: boolean;
}

export interface Vitals {
  life: number;
  maxLife: number;
  mana: number;
  maxMana: number;
  es: number;
  maxEs: number;
  /** Mana held by active auras (the globe shows it as a sealed cap). Optional. */
  reserved?: number;
}

export interface HeroPort {
  readonly actor: ActorLike;
  /** True when the hero's combat plays hit sounds and particles itself (the shell then only adds numbers, shake and the recap). */
  readonly juice?: boolean;
  /** Visual root (the shell adds it to the active stage). */
  readonly object: Object3D;
  /** Seconds the current attack/dodge still locks movement (the bot waits on it). */
  readonly busy: number;
  vitals(): Vitals;
  skills(): readonly SkillSlotView[];
  buffs(): readonly BuffView[];
  /** Place the hero in a stage (stage swap, respawn, teleport). */
  enter(stage: StageWorld, at: Vector3, facing: number): void;
  fixedUpdate(dt: number, intent: HeroIntent): void;
  update(dt: number): void;
  /** The shell owns XP: it tells the hero its level after a level-up or a load. */
  setLevel(level: number): void;
  /** Mod sources from other systems (tree, gear, difficulty), replaced wholesale by key. */
  setMods(source: string, mods: readonly Mod[]): void;
  /** Full life, mana and shield; clear ailments (town entry, respawn). */
  restore(): void;
  /** Cosmetic: 'wave' | 'victory' | 'hurt' | 'death'. */
  emote(name: string): void;
  /**
   * The skill sockets changed (the skill panel, a load, a new run): rebuild the skill bar
   * from `save.hero.skills` (slot i = keys 1/Q, 2/E, 3/R, 4/T; an empty socket is an empty
   * slot). `loot/sockets.ts` `socketsToSlots` turns them into HeroController slots.
   */
  setSkills?(skills: SaveData['hero']['skills']): void;
  dispose(): void;
}

export interface HeroFactory {
  create(services: ShellServices, save: SaveData['hero']): Promise<HeroPort>;
}

// ------------------------------------------------------------------ levels

/** Codex entry for a mechanic (from MechanicDef). */
export interface MechanicInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly bypass: string;
  readonly exploit: string;
}

export interface BossView {
  readonly name: string;
  readonly life: number;
  readonly maxLife: number;
  /** Life fractions where phases change (e.g. [0.66, 0.33]). */
  readonly phases: readonly number[];
  readonly phase: number;
  readonly position: Vector3;
}

export interface LevelDeps {
  readonly services: ShellServices;
  readonly monsters: MonsterPort;
  readonly loot: LootPort;
  readonly hero: HeroPort;
}

export interface LevelPort {
  /** Called once when the shell starts (before any other call). */
  init?(services: ShellServices): void;
  /** The level for a depth: designed levels 1..12, rifts after (`riftSpec`). */
  spec(depth: number, runSeed: number): LevelSpec;
  /** Every mechanic, for the codex. */
  mechanics(): readonly MechanicInfo[];
  /** Build the level under a fresh root (buildLevel). */
  build(spec: LevelSpec, deps: LevelDeps): Promise<LevelHandle>;
}

export interface LevelHandle extends StageWorld {
  readonly kind: 'level';
  readonly spec: LevelSpec;
  readonly layout: LayoutLike;
  /** World (x, z) of the corner of cell (0, 0); cells are 1 m (minimap, bot navigation). */
  readonly origin: { readonly x: number; readonly z: number };
  /** Hero spawn and the exit portal, world space. */
  readonly start: Vector3;
  readonly exit: Vector3;
  /** The exit portal works (boss dead / objective done). */
  readonly exitOpen: boolean;
  /** Monsters killed / total (level progress and the clear check). */
  progress(): { killed: number; total: number };
  boss(): BossView | null;
  /** Cells seen so far, `layout.width × layout.height`, row-major by z (0 unseen, 1 seen). */
  explored(): Uint8Array;
  telegraphs(): readonly Telegraph[];
  /** Live monsters (handles carry names, ranks and telegraphs). */
  monsters(): readonly MonsterHandle[];
  /** Dev / agent API: spawn a monster from a genome seed. */
  spawn(seed: number, at: Vector3, rank?: Rank): MonsterHandle;
  /** Optional: healing pickups lying in the level (health globes), world positions. */
  pickups?(): readonly Vector3[];
  /** Optional: the level's music (its theme's arrangement of the shell's songs). */
  readonly songs?: Partial<Record<'level' | 'combat' | 'boss', import('../../engine').Song>>;
  fixedUpdate(dt: number, hero: HeroPort): void;
  update(dt: number, hero: HeroPort): void;
  dispose(): void;
}

// ------------------------------------------------------------------ monsters

export interface MonsterBuildOptions {
  readonly services: ShellServices;
  readonly stage: StageWorld;
  readonly at: Vector3;
  readonly depth: number;
  /** Extra Mod sources to apply before life is computed (always includes `difficulty`). */
  readonly mods: Readonly<Record<string, readonly Mod[]>>;
}

export interface MonsterPort {
  init?(services: ShellServices): void;
  /** generateGenome: a seed + depth + rank becomes a genome (pure). */
  genome(seed: number, depth: number, rank: Rank, archetypes?: readonly string[]): Genome;
  /** buildMonster: a genome becomes a live monster in the stage. */
  build(genome: Genome, options: MonsterBuildOptions): MonsterHandle;
}

export interface MonsterHandle {
  readonly actor: ActorLike;
  readonly object: Object3D;
  readonly name: string;
  readonly rank: Rank;
  readonly genome: Genome;
  /** The attack it is winding up, if any. */
  telegraph(): Telegraph | null;
  fixedUpdate(dt: number, ai: { hero: ActorLike; enabled: boolean }): void;
  update(dt: number): void;
  dispose(): void;
}

// ------------------------------------------------------------------ loot

export type Drop = { readonly kind: 'gold'; readonly amount: number } | { readonly kind: 'item'; readonly item: Item };

export interface KillInfo {
  readonly depth: number;
  readonly rank: Rank;
  readonly level: number;
  readonly at: Vector3;
  /** The killer's find stats as fractions (0.3 = 30% increased), when a hero made the kill. Optional. */
  readonly itemRarity?: number;
  readonly itemQuantity?: number;
  readonly goldFind?: number;
  /** What dropped it: 'monster' (default) or 'chest' (level chests, Collapse caches). */
  readonly source?: string;
}

/** A drop lying in the world. */
export interface WorldLoot {
  readonly id: number;
  readonly drop: Drop;
  readonly position: Vector3;
  /** Label text and colour (rarity). */
  readonly label: string;
  readonly color: PaletteColor;
  /** Hidden by the loot filter (still picked up by "take all"). */
  readonly filtered: boolean;
  /** Loot filter emphasis: loud (framed), show, or dim (greyed label). */
  readonly tier?: 'loud' | 'show' | 'dim';
}

export interface LootPort {
  /** Called once when the shell starts (before any other call). */
  init?(services: ShellServices): void;
  /** rollDrops: what a kill drops (pure: same rng → same drops). */
  rollDrops(kill: KillInfo, rng: Rng): Drop[];
  /** Put drops in the stage around `at` (bounce, beam, label). */
  spawn(drops: readonly Drop[], at: Vector3, stage: StageWorld, rng: Rng): WorldLoot[];
  /** Everything lying in the stage (`filtered` follows `services.settings().lootFilter`). */
  ground(): readonly WorldLoot[];
  /** Pick up one drop: items go to the inventory, gold is returned. False when full. */
  pickup(loot: WorldLoot): { ok: boolean; gold: number; item?: Item };
  /** Per-frame visuals (bob, beams, labels). */
  update(dt: number): void;
  /** Remove ground loot (stage swap). */
  clearGround(): void;
  /** Mod sources from equipped gear, keyed by source ("item:weapon"...). */
  gearMods(): Readonly<Record<string, readonly Mod[]>>;
  /** Restore from / write into a save. */
  load(save: SaveData): void;
  write(save: SaveData): void;
  /** Dev / agent API: create an item. */
  give(rng: Rng, level: number, rarity?: Item['rarity']): Item | null;
  /** Counts for the HUD and the bot. */
  counts(): { inventory: number; capacity: number; stash: number };
  /** UI views (InventoryView, StashView, VendorView, the crafting bench). */
  inventoryView(host: PanelHost): Panel;
  stashView(host: PanelHost): Panel;
  vendorView(host: PanelHost): Panel;
  craftingView(host: PanelHost): Panel;
  /** The skill panel: gems in the four skill slots and their supports (optional). */
  skillsView?(host: PanelHost): Panel;
  /** The game is unloaded: remove overlays and listeners (optional). */
  dispose?(): void;
}

// ------------------------------------------------------------------ passive tree

export interface TreePort {
  init?(services: ShellServices): void;
  /** treeMods: the Mods granted by these allocated nodes. */
  mods(allocated: readonly string[]): readonly Mod[];
  /** Total passive points at a character level (and deepest depth cleared: bonus points). */
  points(level: number, deepest?: number): number;
  /** The TreeView. `respec` lets the view refund nodes (the mystic's respec). */
  view(host: PanelHost, options: { respec: boolean }): Panel;
}

// ------------------------------------------------------------------ UI panels

/**
 * A full-screen or windowed UI view drawn on the pixel HUD (see ui/kit.ts).
 *
 * **Overlay panels** (`overlay: true`) are views that paint their own canvas over the HUD:
 * the item windows (ui/items) and the passive tree (ui/tree). The shell treats them like any
 * panel: it opens them (`open`), keeps them on the stack (modal or not), routes every
 * UiEvent to `input` first, calls `draw` each frame with the whole screen as `rect` (time to
 * paint), and closes them (`close`) on back / the close key / a stage change. It draws no
 * frame, title bar or close box for them, and a pointer press counts as the UI's when
 * `covers(x, y)` says so (the view's own canvas handles the press itself).
 */
export interface Panel {
  readonly id: string;
  readonly title: string;
  /** Preferred size in art pixels; the shell centres it, frames it and adds the title bar. */
  readonly size: { readonly w: number; readonly h: number };
  draw(ui: UiCanvas, rect: { x: number; y: number; w: number; h: number }, time: number): void;
  /** Return true when the event was used (the shell then stops routing it). */
  input?(e: UiEvent): boolean;
  /** Called when the shell closes it. */
  close?(): void;
  /** Called when the shell opens it (overlays show their canvas here). */
  open?(): void;
  /** Draws on its own canvas: no shell frame (see above). */
  readonly overlay?: boolean;
  /** Overlay: true when art pixel (x, y) is on the view (pointer presses there are the UI's). */
  covers?(x: number, y: number): boolean;
  /** Views sharing one overlay (the item windows): opening one closes the others in its group. */
  readonly group?: string;
}

/** What a panel may ask of the shell (state it edits, money, sounds, closing itself). */
export interface PanelHost {
  readonly services: ShellServices;
  /** The live save the panel edits (allocated nodes, stash...). */
  save(): SaveData;
  gold(): number;
  /** Spend (negative) or gain gold; false when there is not enough. */
  addGold(amount: number): boolean;
  /** Character level (tree points). */
  level(): number;
  /**
   * Tell the shell the save changed: 'tree' / 'gear' re-apply the Mod sources, 'skills'
   * tells the hero to rebuild its skill bar (`HeroPort.setSkills`).
   */
  changed(what: 'tree' | 'gear' | 'stash' | 'gold' | 'skills'): void;
  sound(name: 'click' | 'open' | 'close' | 'equip' | 'error' | 'buy' | 'sell'): void;
  close(): void;
  /** Controller glyphs instead of keys. */
  glyphs(): boolean;
}

/** `Panel.group` of the item windows (inventory, stash, vendor, crafting bench, skills): they share one overlay, and I closes any of them. */
export const ITEM_GROUP = 'items';

/** Everything the shell needs from the other workstreams. */
export interface RiftlightPorts {
  readonly hero: HeroFactory;
  readonly levels: LevelPort;
  readonly monsters: MonsterPort;
  readonly loot: LootPort;
  readonly tree: TreePort;
}
