import { noteFrequency, type SoundDef } from './synth';

/** A track's instrument: a SoundDef without pitch or length (each note sets those). */
export type Instrument = Omit<SoundDef, 'freq' | 'freqEnd' | 'sustain' | 'delay'>;

/**
 * A chiptune song as data. Each pattern holds one string per track: space-separated steps,
 * where a step is a note ('C4', 'F#5', 'Bb2'), '.' (rest) or '-' (hold the previous note).
 * Every track of a pattern must have the same number of steps. For `noise` tracks the
 * note's pitch is the noise rate: C6 is a snare-ish hiss, C8 a hi-hat tick.
 */
export interface Song {
  bpm: number;
  /** Steps per beat (4 = sixteenth notes). Default 4. */
  stepsPerBeat?: number;
  tracks: Record<string, Instrument>;
  patterns: Record<string, Record<string, string>>;
  /** Pattern names in play order. */
  order: readonly string[];
  /** Loop forever (default true). */
  loop?: boolean;
}

export interface SongNote {
  track: string;
  /** Step index from the start of the song. */
  step: number;
  /** Length in steps (1 + following holds). */
  steps: number;
  freq: number;
}

export interface ParsedSong {
  /** Seconds per step. */
  stepTime: number;
  /** Total steps in one pass of `order`. */
  length: number;
  notes: SongNote[];
}

/** Flatten a song into timed notes. Throws on malformed patterns, so tests catch typos. */
export function parseSong(song: Song): ParsedSong {
  const stepTime = 60 / song.bpm / (song.stepsPerBeat ?? 4);
  const notes: SongNote[] = [];
  let offset = 0;
  for (const name of song.order) {
    const pattern = song.patterns[name];
    if (!pattern) throw new Error(`song: unknown pattern "${name}"`);
    let length = -1;
    for (const [track, row] of Object.entries(pattern)) {
      if (!song.tracks[track]) throw new Error(`song: pattern "${name}" uses unknown track "${track}"`);
      const steps = row.trim().split(/\s+/);
      if (length >= 0 && steps.length !== length) throw new Error(`song: pattern "${name}" track "${track}" has ${steps.length} steps, expected ${length}`);
      length = steps.length;
      let current: SongNote | null = null;
      steps.forEach((tok, i) => {
        if (tok === '-') {
          if (current) current.steps++;
          return;
        }
        current = null;
        if (tok === '.') return;
        const freq = noteFrequency(tok);
        if (freq === null) throw new Error(`song: pattern "${name}" track "${track}" step ${i}: bad note "${tok}"`);
        current = { track, step: offset + i, steps: 1, freq };
        notes.push(current);
      });
    }
    offset += Math.max(length, 0);
  }
  notes.sort((a, b) => a.step - b.step);
  return { stepTime, length: offset, notes };
}

/** The playable SoundDef for one note of a track. */
export function noteSound(instrument: Instrument, freq: number, seconds: number): SoundDef {
  const attack = instrument.attack ?? 0.005;
  return { ...instrument, freq, attack, sustain: Math.max(0, seconds * 0.85 - attack) };
}

/** The playground's short looping track: C major, bouncy, 2 × 16 steps. */
export const PLAYGROUND_SONG: Song = {
  bpm: 128,
  tracks: {
    lead: { wave: 'square', duty: 0.25, decay: 0.08, volume: 0.13 },
    bass: { wave: 'triangle', decay: 0.06, volume: 0.32 },
    drums: { wave: 'noise', attack: 0.001, decay: 0.05, volume: 0.09 },
  },
  patterns: {
    a: {
      lead: 'E5 . G5 . C6 . G5 . A5 - G5 . E5 . D5 .',
      bass: 'C3 . . . C3 . G2 . A2 . . . A2 . E2 .',
      drums: 'C6 . C8 . C7 . C8 . C6 . C8 . C7 . C8 .',
    },
    b: {
      lead: 'F5 . A5 . C6 . A5 . G5 - E5 . D5 . C5 .',
      bass: 'F2 . . . F2 . C3 . G2 . . . G2 . B2 .',
      drums: 'C6 . C8 . C7 . C8 . C6 . C8 . C7 C7 C8 .',
    },
  },
  order: ['a', 'b', 'a', 'b'],
};
