/**
 * `window.__RIFTLIGHT__`: the typed agent API. Everything a playtest bot, an e2e suite or
 * an agent needs to drive and inspect the game without pixels:
 *
 *   const rl = window.__RIFTLIGHT__;
 *   rl.newRun({ slot: 0, seed: 42 });          // fresh run, in town
 *   await rl.enterDepth(1);                     // straight into a level
 *   rl.step(60, { move: { x: 1, z: 0 } });      // 60 frames (Engine.step) holding an intent
 *   rl.state();                                  // screen, depth, hero, monsters, loot, ui...
 *   rl.bot.run({ maxFrames: 7200 });            // let the playtest bot clear the level
 *
 * Steps are frame-exact (`Engine.step` switches the engine to manual time); call
 * `rl.realtime()` to hand time back to the render loop.
 */
import { Vector3 } from 'three/webgpu';
import { describeMod } from '../core/mods';
import type { Rank } from '../core/scaling';
import type { DifficultyTuning } from '../core/types';
import type { Menu } from '../ui/menu';
import { type BotIntent, type BotReport, PlaytestBot } from './bot';
import { sanitizeTuning } from './difficulty';
import type { HeroIntent } from './ports';
import type { Riftlight } from './Riftlight';

export interface RiftlightState {
  screen: string;
  paused: boolean;
  ui: string[];
  slot: number;
  depth: number | null;
  levelName: string | null;
  levelTime: number;
  cleared: boolean;
  exitOpen: boolean;
  dead: boolean;
  deepest: number;
  hero: { level: number; xp: number; gold: number; life: number; maxLife: number; mana: number; maxMana: number; es: number; position: number[]; busy: number };
  monsters: { alive: number; killed: number; total: number };
  loot: { gold: number; items: number };
  boss: { name: string; life: number; maxLife: number; phase: number } | null;
  difficulty: DifficultyTuning;
  codex: string[];
  session: Riftlight['session'];
  town: { timeOfDay: number; nearest: string | null } | null;
}

export interface IntentInput {
  move?: { x: number; z: number };
  aim?: { x: number; y?: number; z: number };
  attack?: boolean;
  skill?: number;
  dodge?: boolean;
  interact?: boolean;
}

export function createApi(game: Riftlight) {
  const engine = () => game.ctx.engine;
  let bot = new PlaytestBot();

  const state = (): RiftlightState => {
    const h = game.hero;
    const v = h.vitals();
    const level = game.level;
    const ground = game.ports.loot.ground();
    const boss = level?.boss() ?? null;
    return {
      screen: game.screen,
      paused: game.worldPaused,
      ui: game.layer.stack.map((o) => o.panel.id),
      slot: game.slot,
      depth: level?.spec.depth ?? null,
      levelName: level?.spec.name ?? null,
      levelTime: +game.levelTime.toFixed(3),
      cleared: game.cleared,
      exitOpen: level?.exitOpen ?? false,
      dead: game.dead,
      deepest: game.save.deepest,
      hero: {
        level: game.save.hero.level,
        xp: game.save.hero.xp,
        gold: game.save.hero.gold,
        life: +v.life.toFixed(2),
        maxLife: +v.maxLife.toFixed(2),
        mana: +v.mana.toFixed(2),
        maxMana: +v.maxMana.toFixed(2),
        es: +v.es.toFixed(2),
        position: h.actor.position.toArray().map((n) => +n.toFixed(3)),
        busy: h.busy,
      },
      monsters: { alive: level?.monsters().length ?? 0, ...(level?.progress() ?? { killed: 0, total: 0 }) },
      loot: { gold: ground.filter((l) => l.drop.kind === 'gold').length, items: ground.filter((l) => l.drop.kind === 'item').length },
      boss: boss ? { name: boss.name, life: boss.life, maxLife: boss.maxLife, phase: boss.phase } : null,
      difficulty: { ...game.save.difficulty },
      codex: [...(game.save.codex ?? [])],
      session: { ...game.session },
      town: game.screen === 'town' || game.screen === 'title' ? { timeOfDay: game.town.dayTime, nearest: game.town.nearest(h.actor.position)?.id ?? null } : null,
    };
  };

  const toIntent = (i: IntentInput): BotIntent => {
    const p = game.hero.actor.position;
    const move = i.move ?? { x: 0, z: 0 };
    const len = Math.hypot(move.x, move.z);
    const aim = i.aim ? new Vector3(i.aim.x, i.aim.y ?? p.y, i.aim.z) : len > 0 ? new Vector3(p.x + move.x, p.y, p.z + move.z) : new Vector3(p.x, p.y, p.z + 1);
    return { move: len > 1 ? { x: move.x / len, z: move.z / len } : move, aim, attack: !!i.attack, skill: i.skill ?? -1, dodge: !!i.dodge, interact: !!i.interact };
  };

  /** Advance n frames holding an intent (one-shot fields fire on the first frame only). */
  const step = (frames = 1, intent?: IntentInput): RiftlightState => {
    for (let f = 0; f < frames; f++) {
      if (intent) {
        const it = toIntent(f === 0 ? intent : { ...intent, skill: -1, dodge: false, interact: false });
        game.botIntent = it;
      }
      engine().step(1);
    }
    game.botIntent = null;
    return state();
  };

  /**
   * Walk to a ground point: in a level along the grid route (the bot's navigation), in town
   * in a straight line that sidesteps whatever it bumps into.
   */
  const moveTo = (x: number, z: number, o: { maxFrames?: number; radius?: number } = {}) => {
    const max = o.maxFrames ?? 900;
    const r = o.radius ?? 0.6;
    const nav = new PlaytestBot();
    const goal = new Vector3(x, 0, z);
    let frames = 0;
    let stuck = 0;
    let side = 0;
    const last = new Vector3().copy(game.hero.actor.position);
    const screen = game.screen;
    for (; frames < max; frames++) {
      // a panel that pauses the world (the loot window at the portal) or a stage change ends the walk
      if (game.worldPaused || game.screen !== screen) break;
      const p = game.hero.actor.position;
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= r) break;
      if (game.level) {
        const it = toIntent({});
        nav.walk(game.level, p, goal, it);
        game.botIntent = it;
      } else {
        stuck = p.distanceTo(last) < 0.01 ? stuck + 1 : 0;
        if (stuck > 12) side = 30;
        const k = side-- > 0 ? 1 : 0;
        game.botIntent = toIntent({ move: { x: dx / d - (k * dz) / d, z: dz / d + (k * dx) / d } });
      }
      last.copy(p);
      engine().step(1);
    }
    game.botIntent = null;
    const p = game.hero.actor.position;
    return { arrived: Math.hypot(x - p.x, z - p.z) <= r + 0.05, frames, state: state() };
  };

  /**
   * A bot session: `start()` resets the counters for the level in progress, `advance(n)`
   * plays up to n frames and reports whether the run ended (cleared through the portal,
   * died, or still going). `run()` does both in one call.
   */
  let session: { depth: number; frames: number; deaths: number; time: number; outcome: BotReport['outcome']; done: boolean } | null = null;
  const botStart = () => {
    session = { depth: game.level?.spec.depth ?? 0, frames: 0, deaths: 0, time: 0, outcome: 'timeout', done: game.screen !== 'level' };
    bot = new PlaytestBot(); // a fresh mind per run (routes, stuck and reach memory)
    return session;
  };
  const botAdvance = (frames: number) => {
    const ss = session ?? botStart();
    for (let n = 0; n < frames && !ss.done; n++) {
      if (game.screen !== 'level' || !game.level) {
        ss.done = true;
        if (game.screen === 'town' && game.save.deepest >= ss.depth) ss.outcome = 'cleared';
        break;
      }
      ss.time = game.levelTime;
      if (game.layer.has('death')) {
        ss.deaths++;
        ss.outcome = 'died';
        ss.done = true;
        game.goTown('death');
        break;
      }
      if (game.layer.has('loot')) {
        for (const l of [...game.ports.loot.ground()]) if (!l.filtered) game.pickup(l);
        ss.outcome = 'cleared';
        ss.done = true;
        game.returnToTown();
        break;
      }
      if (game.layer.top) game.layer.close(); // the bot never browses menus
      game.botIntent = bot.decide({ hero: game.hero, level: game.level, loot: game.ports.loot.ground(), frame: ss.frames });
      engine().step(1);
      ss.frames++;
    }
    game.botIntent = null;
    return { done: ss.done, report: botReport() };
  };
  const botReport = (): BotReport => {
    const ss = session ?? botStart();
    const s = game.session;
    return { depth: ss.depth, cleared: ss.outcome === 'cleared', time: +ss.time.toFixed(2), frames: ss.frames, deaths: ss.deaths, damageTaken: Math.round(s.damageTaken), kills: s.kills, xp: s.xp, gold: s.gold, items: s.items, stuck: bot.stuckCount, outcome: ss.outcome };
  };
  const runBot = (o: { maxFrames?: number } = {}): BotReport => {
    botStart();
    return botAdvance(o.maxFrames ?? 60 * 60 * 3).report;
  };

  /** Kill every monster with the given bot style (default: basic attacks only, no loot, no exit). */
  const fight = (o: { maxFrames?: number; skills?: boolean } = {}) => {
    const killer = new PlaytestBot({ skills: o.skills ?? false, loot: false, exit: false });
    const max = o.maxFrames ?? 60 * 60 * 3;
    let frames = 0;
    for (; frames < max && game.level && game.screen === 'level' && !game.dead; frames++) {
      if (!game.level.monsters().some((m) => m.actor.alive)) break;
      game.botIntent = killer.decide({ hero: game.hero, level: game.level, loot: [], frame: frames });
      engine().step(1);
    }
    game.botIntent = null;
    return { frames, state: state() };
  };

  /** Walk over every gold pile (gold is picked up by walking over it). */
  const collectGold = (o: { maxFrames?: number } = {}) => {
    let frames = 0;
    for (let guard = 0; guard < 50; guard++) {
      const p = game.hero.actor.position;
      const gold = game.ports.loot.ground().filter((l) => l.drop.kind === 'gold').sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
      if (!gold) break;
      frames += moveTo(gold.position.x, gold.position.z, { radius: 0.5, maxFrames: o.maxFrames ?? 600 }).frames;
      engine().step(2);
    }
    return { frames, state: state() };
  };

  const api = {
    version: 1 as const,
    game,
    state,
    /** Fresh run in a slot (default 0), straight to town. */
    newRun(o: { slot?: number; seed?: number } = {}) {
      game.newRun(o.slot ?? 0, o.seed);
      return state();
    },
    continueRun(slot?: number) {
      if (slot === undefined) game.continueRun();
      else game.loadSlot(slot);
      return state();
    },
    toTown() {
      game.goTown('portal');
      return state();
    },
    toTitle() {
      game.toTitle();
      return state();
    },
    async enterDepth(depth: number) {
      if (game.screen === 'title') game.newRun(game.slot);
      await game.enterDepth(depth);
      return state();
    },
    step,
    moveTo,
    fight,
    collectGold,
    /** Walk to a townsperson (or the stash) and talk to them / open it. */
    talkTo(id: string) {
      const it = game.town.interactables.find((x) => x.id === id);
      if (!it) return { ok: false, state: state() };
      const r = moveTo(it.position.x, it.position.z, { radius: Math.min(1.2, it.radius - 0.4) });
      const ok = r.arrived && game.interact();
      step(1);
      return { ok, state: state() };
    },
    interact() {
      const ok = game.interact();
      return { ok, state: state() };
    },
    /** Press a key for one frame (menus: Escape, ArrowDown, Enter...). */
    press(code: string, frames = 1) {
      const input = game.ctx.input;
      input.setKey(code, true);
      engine().step(frames);
      input.setKey(code, false);
      engine().step(1);
      return state();
    },
    spawn(o: { seed?: number; x?: number; z?: number; rank?: Rank } = {}) {
      if (!game.level) return null;
      const p = game.hero.actor.position;
      const m = game.level.spawn(o.seed ?? game.services.rng.int(1, 1e9), new Vector3(o.x ?? p.x + 3, 0, o.z ?? p.z), o.rank ?? 'normal');
      return { id: m.actor.id, name: m.name, rank: m.rank, life: m.actor.life };
    },
    give(o: { xp?: number; gold?: number; items?: number; levels?: number }) {
      if (o.xp) game.gainXp(o.xp);
      if (o.gold) game.addGold(o.gold);
      for (let i = 0; i < (o.items ?? 0); i++) game.devGive('item');
      for (let i = 0; i < (o.levels ?? 0); i++) game.devGive('level');
      return state();
    },
    /** Hero stats: every stat on the sheet, or one with its sources (`explain`). */
    hero(stat?: string, tags?: string[]) {
      const sheet = game.hero.actor.stats;
      if (stat) return { stat, value: sheet.get(stat, tags), sources: sheet.explain(stat, tags).map((e) => ({ source: e.source, mod: e.mod, text: describeMod(e.mod) })) };
      return Object.fromEntries(sheet.stats().map((s) => [s, +sheet.get(s).toFixed(3)]));
    },
    actors() {
      return (game.level?.monsters() ?? []).map((m) => ({
        id: m.actor.id,
        name: m.name,
        rank: m.rank,
        alive: m.actor.alive,
        life: +m.actor.life.toFixed(2),
        maxLife: +m.actor.stats.get('life').toFixed(2),
        position: m.actor.position.toArray().map((n) => +n.toFixed(3)),
        radius: m.actor.radius,
        telegraph: m.telegraph() ? { at: m.telegraph()!.at.toArray(), radius: m.telegraph()!.radius, remaining: m.telegraph()!.remaining } : null,
      }));
    },
    loot() {
      return game.ports.loot.ground().map((l) => ({ id: l.id, kind: l.drop.kind, label: l.label, filtered: l.filtered, position: l.position.toArray().map((n) => +n.toFixed(3)) }));
    },
    pickupAll() {
      let n = 0;
      for (const l of [...game.ports.loot.ground()]) if (game.pickup(l)) n++;
      return n;
    },
    killAll() {
      game.devKillAll();
      return state();
    },
    setDifficulty(t: Partial<DifficultyTuning>) {
      game.setDifficulty(sanitizeTuning({ ...game.difficulty(), ...t }));
      return game.difficulty();
    },
    dev: game.dev,
    ui: {
      stack: () => game.layer.stack.map((o) => o.panel.id),
      open: (id: Parameters<Riftlight['openPanel']>[0]) => !!game.openPanel(id),
      close: (id?: string) => game.layer.close(id),
      /** Widgets of the top menu: id, kind, rect (art pixels), focus. */
      widgets: () => {
        const top = game.layer.top?.panel as Menu | undefined;
        if (!top || !('items' in top)) return [];
        return top.items().map((w, i) => ({ id: w.id, kind: w.kind, focus: i === top.focus, rect: top.rects.get(w.id) ?? null }));
      },
      /** Activate a widget of the top panel by id (menus, the loot window, the recap). */
      click: (id: string) => {
        const top = game.layer.top?.panel as { activate?: (id: string) => boolean } | undefined;
        return !!top?.activate?.(id);
      },
    },
    save(slot = game.slot) {
      game.slot = slot;
      return game.autosave('api');
    },
    load(slot = game.slot) {
      return game.loadSlot(slot);
    },
    exportSave(slot = game.slot) {
      return game.store.exportSlot(slot);
    },
    importSave(slot: number, text: string) {
      game.store.importSlot(slot, text);
      return true;
    },
    slots() {
      return game.store.summaries();
    },
    setTimeOfDay(t: number, freeze = true) {
      game.setTimeOfDay(t);
      if (freeze) game.town.dayLength = 0;
    },
    /** Hand time back to the render loop after `step()`. */
    realtime() {
      engine().manual = false;
    },
    log(n = 50) {
      return game.log.slice(-n);
    },
    bot: {
      run: runBot,
      start: botStart,
      advance: botAdvance,
      report: botReport,
      /** One decision without stepping (inspect what the bot would do). */
      decide: () => (game.level ? bot.decide({ hero: game.hero, level: game.level, loot: game.ports.loot.ground(), frame: 0 }) : null),
    },
  };
  return api;
}

/** The agent API's type (what `window.__RIFTLIGHT__` holds). */
export type RiftlightApi = ReturnType<typeof createApi>;

/** Install `window.__RIFTLIGHT__`; returns the uninstaller (Game.dispose calls it). */
export function installApi(game: Riftlight): () => void {
  const api = createApi(game);
  const w = window as unknown as { __RIFTLIGHT__?: RiftlightApi };
  w.__RIFTLIGHT__ = api;
  return () => {
    if (w.__RIFTLIGHT__ === api) delete w.__RIFTLIGHT__;
  };
}

export type { HeroIntent };
