import type { Song } from '../../engine';
import { hashString } from '../core/rng';
import { SONGS } from '../game/audio';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Shift one note string ('G#3', '.', '-') by `semis` semitones. */
export function transposeNote(note: string, semis: number): string {
  const m = /^([A-G]#?)(-?\d)$/.exec(note);
  if (!m) return note;
  const i = NOTES.indexOf(m[1]!) + Number(m[2]) * 12 + semis;
  return `${NOTES[((i % 12) + 12) % 12]}${Math.floor(i / 12)}`;
}

/** A song moved by `semis` semitones (noise tracks keep their hiss) and `bpm` scaled. */
export function transposeSong(song: Song, semis: number, tempo = 1): Song {
  const noise = new Set(Object.entries(song.tracks).filter(([, t]) => t.wave === 'noise').map(([k]) => k));
  const patterns: Record<string, Record<string, string>> = {};
  for (const [name, tracks] of Object.entries(song.patterns)) {
    patterns[name] = {};
    for (const [track, line] of Object.entries(tracks as Record<string, string>)) {
      patterns[name]![track] = noise.has(track) ? line : line.split(/\s+/).map((n) => transposeNote(n, semis)).join(' ');
    }
  }
  return { ...song, bpm: Math.round(song.bpm * tempo), patterns } as Song;
}

/**
 * A theme's arrangement of the level, combat and boss songs: the theme's `song` id picks a
 * key (−3..+3 semitones) and a tempo (±6%), so every theme sounds its own while the combat
 * layer still swaps in on the same loop. Deterministic per id.
 */
export function themeSongs(songId: string | undefined): { level: Song; combat: Song; boss: Song } | undefined {
  if (!songId) return undefined;
  const h = hashString(`song:${songId}`);
  const semis = (h % 7) - 3;
  const tempo = 0.94 + ((h >>> 8) % 13) / 100;
  return { level: transposeSong(SONGS.level, semis, tempo), combat: transposeSong(SONGS.combat, semis, tempo), boss: transposeSong(SONGS.boss, semis, 1) };
}
