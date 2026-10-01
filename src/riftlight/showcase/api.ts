/**
 * The showcase's part of `window.__RIFTLIGHT__` (game/api.ts spreads it in):
 *
 *   await rl.arcade.start();            // into the cabinet (instant; pass { instant: false } for the swoop)
 *   rl.arcade.autoplay();               // the scripted run, frame-exact, until the flag → state()
 *   rl.arcade.leave();
 *   await rl.bestiary.open();           // the Hall of Beasts (first person)
 *   rl.bestiary.inspect(0); rl.bestiary.play('Death'); rl.bestiary.breed(0, 1);
 *   rl.photo.open(); rl.photo.setLook('gameboy'); await rl.photo.capture(); rl.photo.close();
 *
 * Everything advances through `Engine.step`, like the rest of the agent API.
 */
import type { Mesh, Object3D } from 'three/webgpu';
import type { RenderMode } from '../../engine';
import type { Riftlight } from '../game/Riftlight';
import { exhibitOrder, showcaseOf } from './save';
import { PHOTO_LOOKS } from './photo/PhotoMode';
import type { BestiaryView } from './bestiary/BestiaryMode';

export function showcaseApi(game: Riftlight) {
  const sc = () => game.showcase;
  const engine = () => game.ctx.engine;
  const toTown = () => {
    if (game.screen === 'title') game.newRun(game.slot);
    else if (game.screen === 'level') game.goTown('portal');
  };

  const arcadeState = () => {
    const m = sc().arcade;
    const s = m.stage;
    return {
      active: sc().mode === m,
      phase: s?.phase ?? null,
      time: s ? +s.time.toFixed(3) : 0,
      coins: s?.coins ?? 0,
      total: s?.total ?? 0,
      broken: s?.broken ?? false,
      respawns: s?.respawns ?? 0,
      at: s ? s.heroLocal().toArray().map((n) => +n.toFixed(3)) : null,
      heroState: s?.hero?.hero?.state ?? null,
      result: s?.result ? { ...s.result } : null,
      record: { ...showcaseOf(game.save).arcade },
      camera: engine().camera.preset,
      filters: [...engine().filters],
    };
  };

  const bestiaryState = () => {
    const m = sc().bestiary;
    return {
      active: sc().mode === m,
      view: m.view,
      camera: engine().camera.preset,
      species: m.entries.length,
      wing: m.page,
      wings: m.wings,
      exhibits: m.exhibits.map((e) => ({ name: e.entry?.name ?? '', key: e.entry?.key ?? '', rank: e.entry?.rank ?? 'normal', kills: e.entry?.kills ?? 0, plan: e.genome.plan, archetype: e.genome.archetype, parts: e.genome.parts.length, clip: e.clip, clips: [...e.built.clipNames], meshes: countMeshes(e.built.object) })),
      focus: m.focus?.entry?.name ?? null,
      child: m.altar.child ? { plan: m.altar.child.genome.plan, archetype: m.altar.child.genome.archetype, seed: m.altar.child.genome.seed, parts: m.altar.child.genome.parts.length, generation: m.altar.generation } : null,
      hero: m.heroLocal(),
    };
  };

  const photoState = () => {
    const p = sc().photo;
    return { active: p.active, sub: p.sub, look: PHOTO_LOOKS[p.look]?.name ?? '', filters: [...engine().filters], mode: engine().renderer.mode, resolution: { ...engine().renderer.resolution }, camera: engine().camera.preset, timeOfDay: game.town.dayTime, last: p.last ? { ...p.last } : null, looks: PHOTO_LOOKS.length };
  };

  return {
    arcade: {
      /** Into the cabinet from wherever the run is (town first). Instant unless `{ instant: false }`. */
      async start(o: { instant?: boolean } = {}) {
        toTown();
        await sc().open(sc().arcade, { instant: o.instant ?? true });
        engine().step(1);
        return arcadeState();
      },
      state: arcadeState,
      /** Restart and let the scripted pilot play until the flag (or `maxFrames`). */
      autoplay(o: { maxFrames?: number } = {}) {
        const m = sc().arcade;
        if (!m.stage) return { ...arcadeState(), frames: 0 };
        m.autoplay();
        let frames = 0;
        const max = o.maxFrames ?? 60 * 60;
        while (frames < max && m.stage && m.stage.phase !== 'done') {
          engine().step(1);
          frames++;
        }
        engine().step(2);
        return { ...arcadeState(), frames };
      },
      restart() {
        sc().arcade.restart();
        return arcadeState();
      },
      leave(o: { instant?: boolean } = {}) {
        sc().close({ instant: o.instant ?? true });
        engine().step(1);
        return arcadeState();
      },
    },
    bestiary: {
      /** Into the Hall of Beasts (instant unless `{ instant: false }`). */
      async open(o: { instant?: boolean } = {}) {
        toTown();
        await sc().open(sc().bestiary, { instant: o.instant ?? true });
        engine().step(1);
        return bestiaryState();
      },
      state: bestiaryState,
      /** Every species in the save, in exhibit order (bosses first, then most killed). */
      entries: () => exhibitOrder(showcaseOf(game.save).bestiary).map((e) => ({ key: e.key, name: e.name, rank: e.rank, kills: e.kills, first: e.first, last: e.last, plan: e.genome.plan, archetype: e.genome.archetype })),
      /** Walk to exhibit i (in this wing) and inspect it: the orbit camera and the card. */
      inspect(i = 0) {
        const m = sc().bestiary;
        const ex = m.exhibits[i];
        if (!ex || !m.hall) return bestiaryState();
        m.goTo(m.hall.pedestals[i]!);
        m.setView('inspect', ex);
        engine().step(2);
        return bestiaryState();
      },
      /** Play a clip on the inspected exhibit (or exhibit `i`). */
      play(clip: string, i?: number) {
        const m = sc().bestiary;
        const ex = i === undefined ? m.focus : m.exhibits[i];
        const ok = !!ex && m.play(ex, clip);
        engine().step(1);
        return { ok, state: bestiaryState() };
      },
      view(v: BestiaryView) {
        sc().bestiary.setView(v, v === 'inspect' ? (sc().bestiary.focus ?? sc().bestiary.exhibits[0] ?? null) : null);
        engine().step(1);
        return bestiaryState();
      },
      turntable(on = true) {
        sc().bestiary.turntable = on;
        return bestiaryState();
      },
      wing(dir: 1 | -1 = 1) {
        sc().bestiary.turnWing(dir);
        engine().step(1);
        return bestiaryState();
      },
      /** At the Rift Altar: cross species a and b (exhibit order) and show the child. */
      breed(a = 0, b = 1) {
        const m = sc().bestiary;
        const n = m.entries.length;
        if (!n || !m.hall) return bestiaryState();
        m.altar.a = Math.min(a, n - 1);
        m.altar.b = Math.min(b, n - 1);
        m.goTo('altar');
        m.setView('breed');
        m.activate('breed');
        engine().step(2);
        return bestiaryState();
      },
      mutate() {
        sc().bestiary.mutateChild();
        engine().step(2);
        return bestiaryState();
      },
      close(o: { instant?: boolean } = {}) {
        sc().close({ instant: o.instant ?? true });
        engine().step(1);
        return bestiaryState();
      },
    },
    photo: {
      open() {
        sc().photo.open();
        engine().step(1);
        return photoState();
      },
      state: photoState,
      /** A look by name (`gameboy`, `sixteen bit`, a filter id...) or index into the list. */
      setLook(look: string | number) {
        const p = sc().photo;
        const i = typeof look === 'number' ? look : PHOTO_LOOKS.findIndex((l) => l.name === look || l.name === look.replace(/_/g, ' ') || l.filters.join() === look);
        if (i < 0) return { ok: false, state: photoState() };
        p.setLook(i);
        engine().step(1);
        return { ok: true, state: photoState() };
      },
      next(dir: 1 | -1 = 1) {
        sc().photo.setLook(sc().photo.look + dir);
        engine().step(1);
        return photoState();
      },
      setMode(mode: RenderMode) {
        sc().photo.setMode(mode);
        engine().step(1);
        return photoState();
      },
      setTime(t: number) {
        sc().photo.setTime(t);
        engine().step(1);
        return photoState();
      },
      setLight(i: number) {
        sc().photo.setFill(i);
        engine().step(1);
        return photoState();
      },
      /** Save a PNG (no download with `{ download: false }`): its size and data URL. */
      capture(o: { download?: boolean } = {}) {
        return sc().photo.capture(o);
      },
      close() {
        sc().photo.close();
        engine().step(1);
        return photoState();
      },
    },
  };
}

function countMeshes(o: Object3D): number {
  let n = 0;
  o.traverse((x) => {
    if ((x as Mesh).isMesh) n++;
  });
  return n;
}
