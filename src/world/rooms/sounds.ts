/**
 * Sound Garden: four looping sounds placed in the world. Walk about: each gets quieter with
 * distance, pans to the side it is on, and goes dull behind the wall (a ray from your ears to
 * the source hits it). The HUD meters show what the mixer is doing.
 */
import { CylinderGeometry, DoubleSide, Mesh, MeshBasicNodeMaterial, RingGeometry, SphereGeometry, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor, setLookLayer, type SoundDef, spatialize, toonMaterial, type Voice } from '../../engine';
import type { Knob, RoomDef } from '../types';

interface Emitter {
  name: string;
  color: PaletteColor;
  at: Vector3;
  sound: SoundDef;
  /** Its loudness at full volume (0..1). */
  level: number;
  voice: Voice | null;
  ring: Mesh;
  gain: number;
  pan: number;
  muffle: number;
  occluded: boolean;
  distance: number;
}

/** Loops: no fade in or out (that would dip at every repeat), whole cycles where it matters (55 Hz for 1 s). */
const LOOPS: Record<string, SoundDef> = {
  fountain: { wave: 'noise', freq: 7000, attack: 0, sustain: 2, decay: 0, volume: 0.16 },
  generator: { wave: 'saw', freq: 55, attack: 0, sustain: 1, decay: 0, volume: 0.2, vibrato: { depth: 0.08, rate: 2 } },
  musicBox: { wave: 'triangle', freq: 523.25, arp: [0, 4, 7, 12, 7, 4, 0, -5], arpRate: 0.25, attack: 0, sustain: 2, decay: 0, volume: 0.28 },
  crickets: { wave: 'square', duty: 0.125, freq: 4200, vibrato: { depth: 3, rate: 38 }, attack: 0, sustain: 1, decay: 0, volume: 0.05 },
};

const NOT_HERO = ['character'];

export const SOUNDS: RoomDef = {
  id: 'sounds',
  title: 'Sound Garden',
  wing: 'direction',
  about:
    'Four looping sounds placed in a garden: a fountain, a humming generator behind a wall, a music box and a bush full of crickets. Each is quieter the farther you are, panned to its side, and muffled when the wall is between you. Headphones help.',
  try: ['Walk from the fountain to the music box and listen to them trade places', 'Stand west of the wall: the generator goes dull', 'Turn OCCLUSION or STEREO off and walk the same way'],
  spawn: [0, 0, 5],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'Four sources, each looping one synthesised sound, with a ring on the floor where it falls silent. The HUD has a meter per source: its volume, where it sits from left to right, and whether it is muffled.',
    how: [
      'Every frame each source is worked out from the listener (the hero\'s ears, facing the way the camera looks): the distance gives the volume, the sideways share of the direction (a dot product with the camera\'s right) gives the pan.',
      'Volume falls with distance the way sound does: full inside a reference distance, then inversely (twice as far, half as loud), fading to silence over the last stretch before the maximum.',
      'Occlusion: a ray is cast from the ears to the source; if it hits a wall first, the sound plays at under half volume through a low-pass filter (the high frequencies go: it sounds far away and behind something). It eases in and out so it never clicks.',
      'The engine plays each as a looping voice (AudioManager.loop): buffer source, low-pass filter, gain and stereo panner. Changes glide over a few hundredths of a second. Before the first key press the browser allows no sound; the voices wait and start then.',
    ],
    uses: [
      'Every 3D game: footsteps behind you, a waterfall getting louder, a radio in the next room. Wwise and FMOD do this and more (reverb zones, sound cones).',
      'Thief and Hitman make occlusion part of the play: you hear guards through doors, they hear you.',
    ],
    ask: ['3D positional sound for a game', 'sounds that get quieter with distance', 'muffled audio behind walls', 'stereo panning by direction'],
    cost: 'Per source and frame: a distance, a dot product and one ray cast. The audio graph does the rest on the audio thread.',
    code: [
      {
        title: 'Inverse-distance falloff, faded out before the maximum',
        file: 'src/engine/audio/spatial.ts',
        src: `const inverse = ref / (ref + rolloff * (Math.max(distance, ref) - ref));`,
      },
      {
        title: 'Occlusion: is a wall between the ears and the source?',
        file: 'src/world/rooms/sounds.ts',
        src: `const hit = ctx.physics.raycast(ears, dir, s.distance - 1, NOT_HERO);`,
      },
    ],
    words: ['spatial audio', 'attenuation', 'occlusion', 'low-pass filter'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(22, 16, { floor: ['green', 'lime'], wall: { color: 'teal', side: 'navy' } });
    // the wall that hides the generator from the west
    kit.box([3.5, 1.25, -3.5], [0.5, 2.5, 5], 'slate', { side: 'night' });
    kit.label([3.5, 2.8, -1.2], 'THE WALL', { color: 'mist', range: 8 });

    let range = 9;
    let rolloff = 1;
    let occlusion = true;
    let stereo = true;
    let silent = false;
    const emitters: Emitter[] = [];
    const add = (name: string, color: PaletteColor, at: [number, number, number], sound: SoundDef, level: number) => {
      const ring = new Mesh(new RingGeometry(range - 0.06, range, 72), new MeshBasicNodeMaterial({ color: PALETTE[color], side: DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(at[0], 0.03, at[2]);
      ctx.scene.add(ring);
      kit.label([at[0], 2.6, at[2]], name, { color, range: 14 });
      emitters.push({ name, color, at: new Vector3(...at), sound, level, voice: ctx.audio.loop(sound, { volume: 0 }), ring, gain: 0, pan: 0, muffle: 0, occluded: false, distance: 0 });
    };
    // the fountain: a basin and a column of water
    kit.cylinder([-6, 0.3, -3], 1.1, 0.6, 'slate', { segments: 16 });
    const water = new Mesh(new CylinderGeometry(0.18, 0.3, 1.6, 8), kit.glow('sky'));
    water.position.set(-6, 1.2, -3);
    setLookLayer(water, 'actors');
    ctx.scene.add(water);
    add('FOUNTAIN', 'sky', [-6, 1, -3], LOOPS.fountain!, 0.8);
    // the generator, east of the wall
    kit.box([7, 0.7, -3.5], [1.6, 1.4, 1.2], 'orange', { side: 'red' });
    kit.box([7, 1.2, -2.85], [0.8, 0.3, 0.1], 'sand', { ghost: true });
    add('GENERATOR', 'orange', [7, 1, -3.5], LOOPS.generator!, 0.9);
    // the music box on a plinth
    kit.box([-6, 0.5, 4], [1, 1, 1], 'plum', { side: 'ink' });
    kit.box([-6, 1.2, 4], [0.6, 0.4, 0.4], 'sand', { side: 'orange' });
    add('MUSIC BOX', 'sand', [-6, 1.2, 4], LOOPS.musicBox!, 0.8);
    // the crickets' bush
    const bush = new Mesh(new SphereGeometry(0.9, 10, 8), toonMaterial(PALETTE.green));
    bush.position.set(6, 0.7, 4);
    bush.scale.set(1.3, 0.8, 1.1);
    bush.castShadow = true;
    setLookLayer(bush, 'actors');
    ctx.scene.add(bush);
    add('CRICKETS', 'lime', [6, 0.8, 4], LOOPS.crickets!, 0.7);

    kit.pad([-3, 0, 6.5], { label: 'OCCLUSION', color: 'sky', initial: true, note: 'Off: the wall no longer muffles the generator, as if sound went straight through.', apply: (_r, pad) => ((occlusion = !occlusion), kit.lightPad(pad, occlusion)) });
    kit.pad([0, 0, 6.5], { label: 'STEREO', color: 'sky', initial: true, note: 'Off: everything sits in the middle; only the volume tells you where it is.', apply: (_r, pad) => ((stereo = !stereo), kit.lightPad(pad, stereo)) });
    kit.pad([3, 0, 6.5], { label: 'SILENCE', color: 'red', note: 'Every voice to zero (the meters still show what they would do).', apply: (_r, pad) => ((silent = !silent), kit.lightPad(pad, silent)) });
    const setRange = (v: number) => {
      range = v;
      for (const s of emitters) {
        s.ring.geometry.dispose();
        s.ring.geometry = new RingGeometry(range - 0.06, range, 72);
      }
    };
    const knobs: Knob[] = [
      { id: 'range', label: 'Range', min: 4, max: 16, step: 1, get: () => range, set: setRange, format: (v) => `${v} m`, initial: 9, hint: 'Where each sound falls silent (the rings on the floor).' },
      { id: 'rolloff', label: 'Rolloff', min: 0, max: 3, step: 0.25, get: () => rolloff, set: (v) => (rolloff = v), format: (v) => `${v}`, initial: 1, hint: '1: inverse distance, like real sound. 0: no falloff until the edge. Higher: drops faster.' },
    ];

    const ears = new Vector3();
    const right = new Vector3();
    const dir = new Vector3();
    const mix = (dt: number) => {
      const hero = room.hero?.position;
      if (!hero) return;
      ears.set(hero.x, hero.y + 1.2, hero.z);
      right.setFromMatrixColumn(e.camera.camera.matrixWorld, 0).setY(0).normalize();
      for (const s of emitters) {
        const sp = spatialize({ position: ears, right }, s.at, { ref: 1.5, max: range, rolloff });
        s.distance = sp.distance;
        s.gain = sp.gain * s.level;
        s.pan = stereo ? sp.pan : 0;
        s.occluded = false;
        if (occlusion && s.distance > 1.2 && s.gain > 0) {
          dir.copy(s.at).sub(ears).normalize();
          // stop a metre short: the source's own casing is not in the way
          const hit = ctx.physics.raycast(ears, dir, s.distance - 1, NOT_HERO);
          s.occluded = hit !== null;
        }
        // ease in and out of muffled: no clicks when you step past the wall's end
        const want = s.occluded ? 0.85 : 0;
        s.muffle += (want - s.muffle) * Math.min(1, dt * 8);
        s.voice?.set({ volume: silent ? 0 : s.gain * (1 - s.muffle * 0.6), pan: s.pan, muffle: s.muffle });
      }
    };
    return {
      knobs,
      update(dt) {
        mix(dt);
        water.scale.y = 1 + Math.sin(ctx.time * 7) * 0.05;
      },
      draw() {
        const hud = ctx.hud;
        hud.rect(1, 1, 166, 8 + emitters.length * 11, 'ink');
        emitters.forEach((s, i) => {
          const y = 5 + i * 11;
          hud.text(4, y, s.name, { color: s.color });
          // volume
          hud.rect(70, y, 40, 6, 'night');
          hud.rect(70, y, Math.round(40 * s.gain * (1 - s.muffle * 0.6)), 6, s.muffle > 0.4 ? 'slate' : s.color);
          // left .. right
          hud.rect(116, y + 2, 31, 2, 'night');
          hud.rect(116 + Math.round((s.pan + 1) * 15) - 1, y, 3, 6, 'white');
          if (s.muffle > 0.4) hud.text(150, y, 'M', { color: 'red' });
        });
        hud.text(4, 18, `${occlusion ? 'OCCLUSION ON' : 'OCCLUSION OFF'} · ${stereo ? 'STEREO' : 'MONO'} · M = MUFFLED`, { anchor: 'bottom-left', color: 'mist' });
      },
      dispose() {
        for (const s of emitters) s.voice?.stop();
      },
      status: () => emitters.map((s) => `${s.name} ${s.gain.toFixed(2)}${s.occluded ? ' muffled' : ''}`).join(', '),
      api: {
        /** What the mixer worked out for each source this frame. */
        mix: () => emitters.map((s) => ({ name: s.name, gain: s.gain, pan: s.pan, muffle: s.muffle, occluded: s.occluded, distance: s.distance })),
        /** What each voice was last told (volume, pan, muffle): the same headless or not. */
        voices: () => emitters.map((s) => ({ ...s.voice!.settings, stopped: s.voice!.stopped })),
        sources: () => emitters.map((s) => ({ name: s.name, at: s.at.toArray() })),
      },
    };
  },
};
