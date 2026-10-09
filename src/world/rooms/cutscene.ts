/**
 * Cutscene Stage: a little scene played from a timeline. The camera glides through keys on a
 * smooth curve and cuts between shots, two actors move on cues, subtitles run along the
 * bottom and the bars slide in. Skip it and the world still ends up the way the scene left it.
 */
import { BoxGeometry, type Camera, Mesh, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { type CameraConfig, type CameraRig, PALETTE, Timeline, toonMaterial } from '../../engine';
import { mannequin, type Mannequin } from '../kit/mannequin';
import { WORLD_CAMERA } from '../shell';
import type { Knob, RoomDef } from '../types';

const GUIDE_AT: [number, number, number] = [-2, 0, -2];

/** Words into lines no wider than `width` (a word longer than that gets a line of its own). */
export function wrap(text: string, width: number, measure: (t: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
const SMITH_AT: [number, number, number] = [2, 0, -2];

export const CUTSCENE: RoomDef = {
  id: 'cutscene',
  title: 'Cutscene Stage',
  wing: 'direction',
  about:
    'A short scene played from a timeline: the camera glides through keys and cuts between shots, two actors wave and shout on cues, subtitles run, the bars slide in. Skip it halfway and the chest and the gate still end up open.',
  try: ['Step on PLAY SCENE', 'Press SPACE to skip: the world ends the same', 'Slow the scene down (T) and watch the camera ease into each key'],
  spawn: [0, 0, 3],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A small stage: two actors (clones of the hero model), a chest, a gate at the back and a PLAY SCENE pad. The scene is about 16 seconds of camera, cues and lines.',
    how: [
      'A timeline is one clock and lists of things on it: camera keys (where the camera is and what it looks at, at a time), cues (a function to run once when the playhead passes) and subtitles (text from one time to another). Everything is data.',
      'Between keys the camera follows a Catmull-Rom spline: each key\'s tangent comes from its neighbours, so the camera passes through keys without a jolt. The first and last keys of a shot ease in and out.',
      'A cut is a key with cut: true at the same time as the previous key: one frame shows the end of a shot, the next the start of another, with no glide between.',
      'The game puts its camera where the timeline says each frame: a fixed perspective camera rig, swapped in for the scene (engine.setCamera) and swapped back after. The hero leaves the world meanwhile, so nothing reads the keys but the skip.',
      'Skipping runs every cue not yet fired, except cosmetic ones (a sound, a fanfare): the chest and the gate are world state and must end up open either way.',
    ],
    uses: [
      'Unity\'s Timeline and Unreal\'s Sequencer are editors for exactly this: tracks of camera keys, animation, audio and events on one clock.',
      'Every story game\'s cutscenes, and the camera fly-through at the start of a level.',
    ],
    ask: ['a cutscene system with camera keys', 'a skippable intro that leaves the world right', 'smooth camera paths through points', 'letterbox bars and subtitles'],
    cost: 'Per frame: one spline evaluation and a few comparisons. The scene is a few dozen numbers.',
    code: [
      {
        title: 'Skipping: fire what changes the world, leave out what is only for show',
        file: 'src/engine/cinematic/timeline.ts',
        src: `if (skipping && c.cosmetic) continue;`,
      },
      {
        title: 'A shot: a key the camera cuts to, and one it glides to',
        file: 'src/world/rooms/cutscene.ts',
        src: `{ at: 4, position: [-3.4, 1.8, 0.2], target: [2, 1.3, -2], fov: 40, cut: true },
{ at: 7, position: [-2.9, 1.7, -0.2], target: [2, 1.3, -2] },`,
      },
    ],
    words: ['cutscene', 'timeline', 'cinematic bars', 'Catmull-Rom spline'],
  },
  async build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(20, 14, { floor: ['sand', 'orange'], wall: { color: 'plum', side: 'ink' } });
    // the set: a back wall with a gate, a chest, lamps
    const gate = kit.box([0, 1.25, -5.7], [3, 2.5, 0.3], 'slate', { side: 'night', ghost: true, own: true });
    kit.box([-2.2, 1.6, -5.7], [1.4, 3.2, 0.5], 'plum', { side: 'ink' });
    kit.box([2.2, 1.6, -5.7], [1.4, 3.2, 0.5], 'plum', { side: 'ink' });
    kit.box([0, 0.3, -4], [1.2, 0.6, 0.8], 'orange', { side: 'red' });
    const lid = new Mesh(new BoxGeometry(1.24, 0.16, 0.84), toonMaterial(PALETTE.red));
    lid.geometry.translate(0, 0.08, 0.42); // hinged at the back edge
    lid.position.set(0, 0.6, -4.42);
    lid.castShadow = true;
    ctx.scene.add(lid);
    kit.light({ position: [-3, 2.5, -3], color: PALETTE.orange, intensity: 3, radius: 7, flicker: 'torch' });
    kit.light({ position: [3, 2.5, -3], color: PALETTE.orange, intensity: 3, radius: 7, flicker: 'torch' });
    const hat = (m: Mannequin, color: number) => {
      const cap = m.root.getObjectByName('Cap');
      if (cap) cap.visible = false;
      const h = new Mesh(new BoxGeometry(0.62, 0.22, 0.62), toonMaterial(color));
      h.position.set(0, 0.56, 0);
      m.root.getObjectByName('Head')?.add(h);
    };
    const guide = await mannequin(ctx, 'Idle', GUIDE_AT, Math.PI / 2);
    const smith = await mannequin(ctx, 'Idle', SMITH_AT, -Math.PI / 2);
    hat(guide, PALETTE.plum);
    hat(smith, PALETTE.orange);
    const names = [kit.label([GUIDE_AT[0], 2.3, GUIDE_AT[2]], 'GUIDE', { color: 'plum', range: 6 }), kit.label([SMITH_AT[0], 2.3, SMITH_AT[2]], 'SMITH', { color: 'orange', range: 6 })];
    const showNames = (on: boolean) => names.forEach((l, i) => (l.text = on ? ['GUIDE', 'SMITH'][i]! : '')); // not over the film

    let chestOpen = false;
    let gateOpen = false;
    const openChest = () => {
      chestOpen = true;
      ctx.tweens.to(lid.rotation, { x: -1.9 }, { duration: 0.6, ease: 'outBack' });
    };
    const openGate = () => {
      gateOpen = true;
      ctx.tweens.to(gate.position, { y: 3.9 }, { duration: 1.2, ease: 'inOutSine' });
    };
    const resetSet = () => {
      ctx.tweens.cancel(lid.rotation); // a skip's gate still rising must not run into the next take
      ctx.tweens.cancel(gate.position);
      chestOpen = gateOpen = false;
      lid.rotation.x = 0;
      gate.position.y = 1.25;
      guide.play('Idle', { fade: 0.2 });
      smith.play('Idle', { fade: 0.2 });
    };
    const act = (m: Mannequin, clip: string, once = false) => () => void m.play(clip, { fade: 0.25, once });

    let playing = false;
    let speed = 1;
    let lastCut = 0;
    let cuts = 0;
    let firedFrom = 0;
    const scene = new Timeline({
      shots: [
        { at: 0, position: [0, 6, 10], target: [0, 1, -2], fov: 50 },
        { at: 4, position: [-1, 2.6, 4], target: [0, 1.2, -2] },
        { at: 4, position: [-3.4, 1.8, 0.2], target: [2, 1.3, -2], fov: 40, cut: true },
        { at: 7, position: [-2.9, 1.7, -0.2], target: [2, 1.3, -2] },
        { at: 7, position: [3.4, 1.8, 0.2], target: [-2, 1.3, -2], cut: true },
        { at: 10, position: [2.9, 1.7, -0.2], target: [-2, 1.3, -2] },
        { at: 10, position: [1.8, 1.6, -2.4], target: [0, 0.5, -4], fov: 35, cut: true },
        { at: 11.3, position: [0, 1.7, -1.8], target: [0, 0.5, -4] },
        { at: 12.5, position: [-1.8, 1.6, -2.4], target: [0, 0.5, -4] },
        { at: 12.5, position: [0, 1.6, 3], target: [0, 1.2, -5], fov: 50, cut: true },
        { at: 16, position: [0, 7.5, 7], target: [0, 0.5, -5], fov: 55 },
      ],
      cues: [
        { at: 0.5, name: 'guide waves', cosmetic: true, run: act(guide, 'Wave') },
        { at: 4.2, name: 'smith shouts', cosmetic: true, run: act(smith, 'Shout') },
        { at: 7.2, name: 'guide points', cosmetic: true, run: act(guide, 'Cast', true) },
        { at: 10.3, name: 'chest opens', run: openChest },
        { at: 10.5, name: 'chime', cosmetic: true, run: () => ctx.audio.play('coin') },
        { at: 11.2, name: 'both cheer', cosmetic: true, run: () => (act(guide, 'Victory')(), act(smith, 'Triumph')()) },
        { at: 12.8, name: 'gate opens', run: openGate },
        { at: 13.2, name: 'fanfare', cosmetic: true, run: () => ctx.audio.play('fanfare') },
      ],
      lines: [
        { at: 0.6, until: 3.8, who: 'GUIDE', text: 'WELCOME TO THE STAGE. ALL OF THIS IS ON ONE TIMELINE.' },
        { at: 4.2, until: 6.9, who: 'SMITH', text: 'THE CAMERA RIDES A CURVE THROUGH ITS KEYS. NO HANDS.' },
        { at: 7.2, until: 9.9, who: 'GUIDE', text: 'A CUT STARTS A NEW SHOT. CUES FIRE AS THE CLOCK PASSES.' },
        { at: 10.2, until: 12.4, who: 'SMITH', text: 'LIKE THIS CHEST OPENING.' },
        { at: 12.6, until: 15.6, who: 'GUIDE', text: 'SKIP IT, AND THE CHEST AND THE GATE STILL END UP OPEN.' },
      ],
      onEnd: () => finish(),
    });

    const camera = (): Camera => e.camera.camera;
    /** The scene's own rig, and the camera to go back to after it. */
    let rig: CameraRig | null = null;
    let back: CameraConfig = WORLD_CAMERA;
    const finish = () => {
      if (!playing) return;
      playing = false;
      // back to the camera from before the scene (unless something else took it meanwhile)
      if (e.camera === rig) e.setCamera(back, { syncUrl: false });
      rig = null;
      showNames(true);
      room.enterWorld([0, 0, 4.4], Math.PI);
    };
    const play = () => {
      if (playing) return;
      resetSet();
      playing = true;
      lastCut = 0;
      firedFrom = scene.fired.length;
      room.leaveWorld();
      showNames(false);
      const own = room.def.camera ?? WORLD_CAMERA;
      back = e.camera.preset === own.preset ? own : { preset: e.camera.preset };
      const first = scene.camera(0)!;
      rig = e.setCamera({ preset: 'fixed', projection: 'perspective', position: first.position, target: first.target, fov: first.fov }, { syncUrl: false });
      scene.speed = speed;
      scene.seek(0);
      scene.play();
    };
    const skip = () => {
      if (playing) scene.skip();
    };
    const tmp = new Vector3();
    /** Put the camera where the timeline says. */
    const frame = () => {
      const s = scene.camera();
      const cam = camera();
      if (!s || !(cam instanceof PerspectiveCamera)) return;
      cam.position.set(...s.position);
      cam.lookAt(tmp.set(...s.target));
      if (cam.fov !== s.fov) {
        cam.fov = s.fov;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    };
    kit.pad([0, 0, 6], { label: 'PLAY SCENE', color: 'lime', quiet: true, note: 'The timeline takes the camera; SPACE skips.', apply: play });
    const knobs: Knob[] = [
      {
        id: 'speed',
        label: 'Scene speed',
        min: 0.25,
        max: 2,
        step: 0.25,
        get: () => speed,
        set: (v) => ((speed = v), (scene.speed = v)),
        format: (v) => `${v}x`,
        initial: 1,
        hint: 'The timeline\'s playback rate: slow it down to see the camera ease into and out of each shot.',
      },
    ];
    return {
      knobs,
      update(dt) {
        guide.mixer.update(dt);
        smith.mixer.update(dt);
        if (!playing) return;
        // another camera picked mid-scene (the T panel): the scene ends there, leaving it be
        if (e.camera !== rig) return skip();
        // consumed, not just seen: the hero is back next frame and must not jump on the same press
        if (room.inputFree && ctx.input.consumePress('Space', 'Enter')) skip();
        const before = scene.camera();
        scene.update(dt);
        if (!playing) return; // ended this frame: the game camera is back
        const after = scene.camera();
        if (before && after && Math.hypot(after.position[0] - before.position[0], after.position[1] - before.position[1], after.position[2] - before.position[2]) > 1.5) {
          cuts++;
          lastCut = scene.time;
        }
        frame();
      },
      draw() {
        if (!playing) return;
        const hud = ctx.hud;
        const k = scene.bars();
        const line = scene.line();
        // the subtitle wrapped to the screen (narrow and portrait ones too); the bottom bar grows to hold it
        const rows = line && k > 0.6 ? wrap(line.who ? `${line.who}: ${line.text}` : line.text, hud.width - 12, (t) => hud.measure(t).width).slice(0, 4) : [];
        const top = Math.round(k * 34);
        const bottom = Math.round(k * Math.max(34, rows.length * 9 + 14));
        if (top > 0) {
          hud.rect(0, 0, hud.width, top, 'ink');
          hud.rect(0, 0, hud.width, bottom, 'ink', 'bottom-left');
        }
        rows.forEach((r, i) => hud.text(0, 8 + (rows.length - 1 - i) * 9, r, { anchor: 'bottom', color: line!.who === 'SMITH' ? 'orange' : 'sand' }));
        if (top > 30) hud.text(4, 22, 'SPACE SKIP', { anchor: 'top-left', color: 'slate' }); // under the room's title (narrow screens)
      },
      dispose() {
        playing = false;
      },
      status: () => `scene ${playing ? scene.time.toFixed(1) : 'idle'} chest ${chestOpen} gate ${gateOpen}`,
      api: {
        play,
        skip,
        playing: () => playing,
        time: () => scene.time,
        /** Cues fired since the scene last started. */
        fired: () => scene.fired.slice(firedFrom),
        shot: () => scene.camera(),
        line: () => scene.line()?.text ?? null,
        bars: () => scene.bars(),
        cuts: () => cuts,
        lastCut: () => lastCut,
        chestOpen: () => chestOpen,
        gateOpen: () => gateOpen,
        /** Where the game's camera really is (to compare with the shot). */
        cameraAt: () => camera().getWorldPosition(new Vector3()).toArray(),
        preset: () => e.camera.preset,
      },
    };
  },
};
