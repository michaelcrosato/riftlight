/**
 * Riftlight's music and sounds, as data in the engine's formats (docs/ENGINE.md, Audio):
 * songs are patterns of note strings per track, sounds are SoundDefs. `registerAudio`
 * registers every SFX under an `rl.` name; music plays with `ctx.audio.playMusic(SONGS.x)`.
 *
 * The level score has two arrangements of the same 4-bar loop: `level` (exploring) and
 * `combat` (drums and a counter-line on top). The shell switches with a combat-intensity
 * meter (game/music.ts), so fights swell without changing key or tempo.
 */
import type { AudioManager, Song, SoundDef } from '../../engine';


export const TITLE_SONG: Song = {
  bpm: 76,
  tracks: {
    pad: { wave: 'triangle', attack: 0.04, decay: 0.5, volume: 0.16 },
    lead: { wave: 'square', duty: 0.125, attack: 0.02, decay: 0.35, volume: 0.07, vibrato: { depth: 0.25, rate: 5 } },
    bass: { wave: 'triangle', decay: 0.4, volume: 0.24 },
    bell: { wave: 'sine', decay: 0.6, volume: 0.06 },
  },
  patterns: {
    a: {
      pad: 'A3 C4 E4 A4 E4 C4 A3 C4 E4 A4 E4 C4 A3 C4 E4 C4',
      lead: 'E5 - - - - - D5 - C5 - - - B4 - - -',
      bass: 'A2 - - - - - - - A2 - - - - - - -',
      bell: 'A5 . . . . . . . . . . . E6 . . .',
    },
    b: {
      pad: 'F3 A3 C4 F4 C4 A3 F3 A3 G3 B3 D4 G4 D4 B3 G3 B3',
      lead: 'C5 - - - A4 - - - B4 - - - G4 - - -',
      bass: 'F2 - - - - - - - G2 - - - - - - -',
      bell: '. . . . C6 . . . . . . . . . D6 .',
    },
    c: {
      pad: 'A3 C4 E4 A4 E4 C4 A3 C4 E3 G#3 B3 E4 B3 G#3 E3 G#3',
      lead: 'A4 - - - C5 - E5 - D5 - - - B4 - - -',
      bass: 'A2 - - - - - - - E2 - - - - - - -',
      bell: 'E6 . . . . . . . . . . . B5 . . .',
    },
  },
  order: ['a', 'b', 'a', 'c'],
};

export const TOWN_SONG: Song = {
  bpm: 96,
  tracks: {
    lead: { wave: 'square', duty: 0.25, attack: 0.01, decay: 0.12, volume: 0.09 },
    harmony: { wave: 'triangle', decay: 0.2, volume: 0.12 },
    bass: { wave: 'triangle', decay: 0.14, volume: 0.26 },
    hat: { wave: 'noise', attack: 0.001, decay: 0.03, volume: 0.035 },
  },
  patterns: {
    a: {
      lead: 'C5 . E5 . G5 - E5 . F5 . A5 . G5 - - .',
      harmony: 'E4 . . . G4 . . . A4 . . . G4 . . .',
      bass: 'C3 . G2 . C3 . G2 . F2 . C3 . G2 . D3 .',
      hat: 'C8 . . . C8 . . . C8 . . . C8 . C8 .',
    },
    b: {
      lead: 'A4 . C5 . F5 - E5 . D5 . C5 . D5 - - .',
      harmony: 'F4 . . . A4 . . . G4 . . . B4 . . .',
      bass: 'F2 . C3 . F2 . C3 . G2 . D3 . G2 . B2 .',
      hat: 'C8 . . . C8 . . . C8 . . . C8 . C8 C8',
    },
    c: {
      lead: 'E5 . D5 . C5 . D5 . E5 . G5 . C6 - - .',
      harmony: 'C4 . . . F4 . . . G4 . . . E4 . . .',
      bass: 'A2 . E3 . F2 . C3 . G2 . D3 . C3 . G2 .',
      hat: 'C8 . . . C8 . . . C8 . . . C8 . . .',
    },
  },
  order: ['a', 'b', 'a', 'c'],
};

const LEVEL_BASS = {
  a: 'D2 . D2 D3 . D2 C3 . D2 . D2 D3 . F2 E2 .',
  b: 'Bb1 . Bb1 Bb2 . Bb1 A2 . C2 . C2 C3 . C2 A1 .',
};
const LEVEL_PAD = { a: 'D4 - - - F4 - - - A4 - - - F4 - - -', b: 'D4 - - - F4 - - - E4 - - - C#4 - - -' };

export const LEVEL_SONG: Song = {
  bpm: 112,
  tracks: {
    bass: { wave: 'triangle', decay: 0.12, volume: 0.26 },
    pad: { wave: 'square', duty: 0.125, attack: 0.05, decay: 0.3, volume: 0.045 },
    lead: { wave: 'square', duty: 0.25, attack: 0.01, decay: 0.2, volume: 0.06 },
    tick: { wave: 'noise', attack: 0.001, decay: 0.02, volume: 0.03 },
  },
  patterns: {
    a: { bass: LEVEL_BASS.a, pad: LEVEL_PAD.a, lead: 'A4 - - . . . . . F4 - G4 - A4 - - .', tick: 'C8 . . . C8 . . . C8 . . . C8 . . .' },
    b: { bass: LEVEL_BASS.b, pad: LEVEL_PAD.b, lead: 'Bb4 - - . . . A4 . G4 - - . E4 - - .', tick: 'C8 . . . C8 . . . C8 . . . C8 . C8 .' },
  },
  order: ['a', 'a', 'b', 'a'],
};

/** The same loop with the combat layer on: drums, a driving line, a higher lead. */
export const COMBAT_SONG: Song = {
  bpm: 112,
  tracks: {
    ...LEVEL_SONG.tracks,
    kick: { wave: 'triangle', attack: 0.001, decay: 0.08, volume: 0.32 },
    snare: { wave: 'noise', attack: 0.001, decay: 0.07, volume: 0.09 },
    drive: { wave: 'square', duty: 0.5, attack: 0.002, decay: 0.06, volume: 0.045 },
  },
  patterns: {
    a: {
      bass: LEVEL_BASS.a,
      pad: LEVEL_PAD.a,
      lead: 'D5 - A4 . D5 . F5 - E5 - D5 - C5 - A4 .',
      tick: 'C8 C8 . C8 C8 C8 . C8 C8 C8 . C8 C8 C8 C8 C8',
      kick: 'C2 . . . . . C2 . C2 . . . . . . .',
      snare: '. . . . C6 . . . . . . . C6 . . C6',
      drive: 'D4 D4 D4 D4 D4 D4 D4 D4 D4 D4 D4 D4 F4 F4 E4 E4',
    },
    b: {
      bass: LEVEL_BASS.b,
      pad: LEVEL_PAD.b,
      lead: 'F5 - D5 . Bb4 . D5 - E5 - C#5 - A4 - - .',
      tick: 'C8 C8 . C8 C8 C8 . C8 C8 C8 . C8 C8 C8 C8 C8',
      kick: 'C2 . . . . . C2 . C2 . . C2 . . C2 .',
      snare: '. . . . C6 . . . . . . . C6 . C6 C6',
      drive: 'Bb3 Bb3 Bb3 Bb3 Bb3 Bb3 Bb3 Bb3 C4 C4 C4 C4 C#4 C#4 C#4 C#4',
    },
  },
  order: ['a', 'a', 'b', 'a'],
};

export const BOSS_SONG: Song = {
  bpm: 148,
  tracks: {
    bass: { wave: 'square', duty: 0.5, decay: 0.08, volume: 0.12 },
    sub: { wave: 'triangle', decay: 0.1, volume: 0.3 },
    lead: { wave: 'saw', attack: 0.005, decay: 0.12, volume: 0.05 },
    kick: { wave: 'triangle', attack: 0.001, decay: 0.07, volume: 0.34 },
    snare: { wave: 'noise', attack: 0.001, decay: 0.06, volume: 0.1 },
  },
  patterns: {
    a: {
      bass: 'E2 E2 E3 E2 E2 E3 E2 G2 E2 E2 E3 E2 D3 D2 B1 D2',
      sub: 'E1 - - - E1 - - - E1 - - - E1 - D1 -',
      lead: 'E5 - - . G5 - F#5 - E5 - . . B4 - D5 -',
      kick: 'C2 . . C2 . . C2 . C2 . . C2 . . C2 .',
      snare: '. . . . C6 . . . . . . . C6 . C6 .',
    },
    b: {
      bass: 'C2 C2 C3 C2 C2 C3 C2 E2 D2 D2 D3 D2 B1 B1 B2 B1',
      sub: 'C1 - - - C1 - - - D1 - - - B0 - - -',
      lead: 'G5 - E5 - C5 - E5 - F#5 - D5 - B4 - - .',
      kick: 'C2 . . C2 . . C2 . C2 . . C2 . C2 C2 .',
      snare: '. . . . C6 . . . . . . . C6 C6 C6 C6',
    },
  },
  order: ['a', 'a', 'b', 'a'],
};

export const SONGS = { title: TITLE_SONG, town: TOWN_SONG, level: LEVEL_SONG, combat: COMBAT_SONG, boss: BOSS_SONG } as const;
export type SongName = keyof typeof SONGS;

/** UI and game sounds (registered as `rl.<name>`). */
export const SOUNDS = {
  // UI
  click: { wave: 'square', duty: 0.25, freq: 880, freqEnd: 660, attack: 0.001, decay: 0.04, volume: 0.12 },
  move: { wave: 'square', duty: 0.125, freq: 520, attack: 0.001, decay: 0.025, volume: 0.06 },
  open: { wave: 'triangle', freq: 330, freqEnd: 660, attack: 0.004, sustain: 0.04, decay: 0.1, volume: 0.22, layers: [{ wave: 'noise', freq: 3000, attack: 0.002, decay: 0.05, volume: 0.04 }] },
  close: { wave: 'triangle', freq: 600, freqEnd: 300, attack: 0.004, sustain: 0.03, decay: 0.09, volume: 0.2 },
  equip: { wave: 'noise', freq: 2400, freqEnd: 900, attack: 0.001, decay: 0.07, volume: 0.16, layers: [{ wave: 'square', duty: 0.5, freq: 330, freqEnd: 220, decay: 0.06, volume: 0.08 }] },
  error: { wave: 'square', duty: 0.5, freq: 160, attack: 0.002, sustain: 0.06, decay: 0.06, volume: 0.12, arp: [0, -1], arpRate: 0.05 },
  buy: { wave: 'square', duty: 0.5, freq: 987.77, arp: [0, 7, 12], arpRate: 0.05, attack: 0.002, sustain: 0.08, decay: 0.15, volume: 0.14 },
  levelUp: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 4, 7, 12, 16, 19, 24], arpRate: 0.07, attack: 0.004, sustain: 0.5, decay: 0.4, volume: 0.2, layers: [{ wave: 'triangle', freq: 261.63, sustain: 0.5, decay: 0.4, volume: 0.2 }] },
  // game
  swing: { wave: 'noise', freq: 900, freqEnd: 3800, attack: 0.02, decay: 0.08, volume: 0.13 },
  hit: { wave: 'noise', freq: 2600, freqEnd: 400, attack: 0.001, decay: 0.08, volume: 0.24, layers: [{ wave: 'square', duty: 0.5, freq: 180, freqEnd: 60, decay: 0.06, volume: 0.14 }] },
  crit: { wave: 'noise', freq: 4200, freqEnd: 600, attack: 0.001, decay: 0.12, volume: 0.3, layers: [{ wave: 'square', duty: 0.25, freq: 1200, freqEnd: 300, decay: 0.08, volume: 0.1 }] },
  die: { wave: 'square', duty: 0.5, freq: 300, freqEnd: 60, attack: 0.002, sustain: 0.05, decay: 0.2, volume: 0.16, crush: 8, layers: [{ wave: 'noise', freq: 1200, freqEnd: 200, decay: 0.25, volume: 0.12 }] },
  gold: { wave: 'square', duty: 0.5, freq: 1318.5, arp: [0, 5], arpRate: 0.05, attack: 0.001, sustain: 0.04, decay: 0.12, volume: 0.1 },
  drop: { wave: 'triangle', freq: 700, freqEnd: 1400, arp: [0, 7], arpRate: 0.06, attack: 0.002, decay: 0.2, volume: 0.14 },
  dodge: { wave: 'noise', freq: 600, freqEnd: 2400, attack: 0.01, decay: 0.12, volume: 0.1 },
  nova: { wave: 'noise', freq: 400, freqEnd: 2000, attack: 0.005, sustain: 0.1, decay: 0.3, volume: 0.22, layers: [{ wave: 'triangle', freq: 120, freqEnd: 50, decay: 0.3, volume: 0.25 }] },
  cry: { wave: 'saw', freq: 180, freqEnd: 240, vibrato: { depth: 1.5, rate: 18 }, attack: 0.02, sustain: 0.25, decay: 0.2, volume: 0.14 },
  slam: { wave: 'triangle', freq: 140, freqEnd: 40, attack: 0.002, decay: 0.18, volume: 0.4, layers: [{ wave: 'noise', freq: 800, freqEnd: 150, decay: 0.15, volume: 0.16 }] },
  roar: { wave: 'saw', freq: 90, freqEnd: 55, vibrato: { depth: 2, rate: 22 }, attack: 0.05, sustain: 0.5, decay: 0.4, volume: 0.22, crush: 12 },
  portal: { wave: 'sine', freq: 220, freqEnd: 880, vibrato: { depth: 0.8, rate: 9 }, attack: 0.05, sustain: 0.3, decay: 0.4, volume: 0.2, layers: [{ wave: 'noise', freq: 600, freqEnd: 4000, attack: 0.1, decay: 0.4, volume: 0.06 }] },
  clear: { wave: 'square', duty: 0.25, freq: 392, arp: [0, 4, 7, 12, 7, 12, 16], arpRate: 0.09, attack: 0.004, sustain: 0.6, decay: 0.4, volume: 0.18 },
  death: { wave: 'square', duty: 0.5, freq: 392, arp: [0, -1, -3, -5, -8, -12], arpRate: 0.16, attack: 0.004, sustain: 0.9, decay: 0.5, volume: 0.18 },
  anvil: { wave: 'square', duty: 0.125, freq: 1760, freqEnd: 1700, attack: 0.001, decay: 0.16, volume: 0.07, layers: [{ wave: 'noise', freq: 5000, decay: 0.04, volume: 0.05 }] },
  coin: { wave: 'square', duty: 0.25, freq: 2093, attack: 0.001, decay: 0.05, volume: 0.03 },
  bark: { wave: 'square', duty: 0.25, freq: 440, arp: [0, 3, 5], arpRate: 0.04, attack: 0.002, decay: 0.08, volume: 0.06 },
  chest: { wave: 'triangle', freq: 200, freqEnd: 120, attack: 0.01, sustain: 0.06, decay: 0.12, volume: 0.25, layers: [{ wave: 'noise', freq: 900, freqEnd: 400, decay: 0.12, volume: 0.06 }] },
} satisfies Record<string, SoundDef>;

export type SoundName = keyof typeof SOUNDS;

export function registerAudio(audio: AudioManager): void {
  for (const [name, def] of Object.entries(SOUNDS)) audio.register(`rl.${name}`, def);
}

