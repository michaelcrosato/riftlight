import { noteSound, parseSong, type ParsedSong, type Song } from './music';
import { SFX } from './sfx';
import { renderSound, type SoundDef } from './synth';

export type VolumeChannel = 'master' | 'sfx' | 'music';

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
}

export interface PlayOptions {
  /** 0..1 multiplier on the sound's own volume. */
  volume?: number;
  /** Pitch shift in semitones (playback rate), e.g. a rising combo. */
  pitch?: number;
  /** Stereo position -1 (left) .. 1 (right). */
  pan?: number;
}

const STORAGE_KEY = 'pixel-engine:audio';
const DEFAULTS: AudioSettings = { master: 0.8, sfx: 1, music: 0.6, muted: false };
const LOOKAHEAD = 0.25; // seconds of music scheduled ahead of the audio clock
// Events that count as a user activation somewhere (iOS Safari: touchend / click, not
// pointerdown on touch). Listeners stay until the context actually runs.
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'click', 'keydown'] as const;

/**
 * Web Audio for games: procedural retro sound effects (`SFX`, data), a small chiptune
 * sequencer (`Song`, data), optional audio files, and master / sfx / music volume + mute
 * persisted in localStorage. Available as `ctx.audio`.
 *
 * Browsers only allow sound after a user gesture, so the AudioContext is created on the
 * first key / pointer / touch input. Before that, and wherever Web Audio does not exist
 * (headless tests, old browsers), every call is a silent no-op that still records what
 * was played in `log`, so games behave identically and tests can assert on sounds.
 */
export class AudioManager {
  /** Sound registry: the built-in SFX plus anything registered or loaded. */
  readonly sounds = new Map<string, SoundDef>(Object.entries(SFX) as [string, SoundDef][]);
  /** The most recent plays (name and game-independent wall time), newest last; tooling/tests. */
  readonly log: { name: string; at: number }[] = [];
  /** How many times each sound was requested. */
  readonly counts: Record<string, number> = {};
  context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<'sfx' | 'music', GainNode>> = {};
  private readonly settings: AudioSettings;
  private readonly buffers = new WeakMap<SoundDef, AudioBuffer>();
  private readonly files = new Map<string, AudioBuffer>();
  private readonly pendingFiles = new Map<string, ArrayBuffer>();
  private unlockListeners: AbortController | null = null;
  private readonly lifetime = new AbortController();
  private song: { def: Song; parsed: ParsedSong; start: number; nextStep: number; cache: Map<string, AudioBuffer> } | null = null;
  private songName: string | null = null;
  private readonly musicSources = new Set<AudioBufferSourceNode>();
  private disposed = false;

  constructor(target: EventTarget | null = typeof window !== 'undefined' ? window : null) {
    this.settings = { ...DEFAULTS, ...readSettings() };
    if (!AudioManager.supported || !target) return;
    this.target = target;
    this.armUnlock();
    // Coming back to the tab (iOS also suspends / 'interrupts' audio on calls and
    // backgrounding): try to resume; if the browser wants a gesture, the listeners wait for it.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.resume(), { signal: this.lifetime.signal });
    }
  }

  /** Web Audio exists in this environment. */
  static get supported(): boolean {
    return typeof globalThis.AudioContext === 'function';
  }

  /** True once the AudioContext is running (after the first user input). */
  get unlocked(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /** Current volumes and mute (persisted). */
  get volume(): Readonly<AudioSettings> {
    return this.settings;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  /** Name of the playing song ('' when none). */
  get playing(): string {
    return this.song ? (this.songName ?? 'song') : '';
  }

  /**
   * Create / resume the AudioContext. Called automatically on the first user input; call
   * it yourself from a click handler if you start sound from your own UI.
   */
  unlock(): void {
    if (this.disposed || !AudioManager.supported) return;
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain();
        this.master.connect(ctx.destination);
        for (const bus of ['sfx', 'music'] as const) {
          const g = ctx.createGain();
          g.connect(this.master);
          this.buses[bus] = g;
        }
        this.applyVolumes();
        for (const [name, data] of this.pendingFiles) void this.decode(name, data);
        this.pendingFiles.clear();
      }
      this.resume();
    } catch {
      this.context = null; // no audio device: stay silent
    }
  }

  private target: EventTarget | null = null;

  /** Listen for the next user input (until the context is running). */
  private armUnlock(): void {
    if (this.unlockListeners || this.disposed || !this.target) return;
    const ac = (this.unlockListeners = new AbortController());
    for (const type of UNLOCK_EVENTS) this.target.addEventListener(type, () => this.unlock(), { capture: true, signal: ac.signal });
  }

  private disarmUnlock(): void {
    this.unlockListeners?.abort();
    this.unlockListeners = null;
  }

  /** Resume a suspended / interrupted context; stop listening for input once it runs. */
  private resume(): void {
    const ctx = this.context;
    if (!ctx || this.disposed) return;
    if (!ctx.onstatechange) {
      // iOS 'interrupted', or a browser suspending audio: wait for the next gesture again.
      ctx.onstatechange = () => (ctx.state === 'running' ? this.disarmUnlock() : this.armUnlock());
    }
    if (ctx.state === 'running') return this.disarmUnlock();
    this.armUnlock();
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') this.disarmUnlock();
      })
      .catch(() => {}); // not allowed without a gesture: the listeners stay armed
  }

  /** Add or replace a sound effect (data, see SoundDef). */
  register(name: string, def: SoundDef): void {
    this.sounds.set(name, def);
  }

  /**
   * Play a sound effect by name (built-in SFX, `register`ed or `load`ed) or directly from a
   * SoundDef. Returns false when nothing could be heard (locked, muted, no Web Audio).
   */
  play(sound: string | SoundDef, options: PlayOptions = {}): boolean {
    const name = typeof sound === 'string' ? sound : 'custom';
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    this.log.push({ name, at: typeof performance !== 'undefined' ? performance.now() : 0 });
    if (this.log.length > 64) this.log.shift();
    const ctx = this.context;
    const bus = this.buses.sfx;
    if (!ctx || !bus || this.settings.muted || ctx.state !== 'running') return false;
    let buffer: AudioBuffer | undefined;
    if (typeof sound === 'string') {
      buffer = this.files.get(sound);
      const def = this.sounds.get(sound);
      if (!buffer && def) buffer = this.bufferFor(def);
    } else buffer = this.bufferFor(sound);
    if (!buffer) return false;
    this.start(buffer, bus, ctx.currentTime, options);
    return true;
  }

  /**
   * Load an audio file (wav/ogg/mp3…) under `name`; `play(name)` then plays it. Works
   * before the first user input too: the file is decoded once audio unlocks.
   */
  async load(name: string, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`audio: ${url} → HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    if (this.context) await this.decode(name, data);
    else this.pendingFiles.set(name, data);
  }

  /** Start a song (looping by default), replacing the current one. `null` stops music. */
  playMusic(song: Song | null, name = 'song'): void {
    this.stopMusic();
    if (!song) return;
    this.song = { def: song, parsed: parseSong(song), start: -1, nextStep: 0, cache: new Map() };
    this.songName = name;
  }

  stopMusic(): void {
    for (const s of this.musicSources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.musicSources.clear();
    this.song = null;
    this.songName = null;
  }

  setVolume(channel: VolumeChannel, value: number): void {
    this.settings[channel] = Math.min(1, Math.max(0, value));
    this.applyVolumes();
    writeSettings(this.settings);
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyVolumes();
    writeSettings(this.settings);
  }

  toggleMute(): boolean {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  /** Engine: once per rendered frame. Schedules the next notes of the song. */
  update(): void {
    const ctx = this.context;
    const song = this.song;
    const bus = this.buses.music;
    if (!ctx || !song || !bus || ctx.state !== 'running') return;
    const { parsed } = song;
    if (parsed.length === 0) return;
    const now = ctx.currentTime;
    if (song.start < 0 || song.start + song.nextStep * parsed.stepTime < now - 0.1) {
      // First call, or the tab was hidden and we fell behind: restart the clock at "now".
      song.start = now + 0.05 - song.nextStep * parsed.stepTime;
    }
    const total = parsed.length;
    while (song.start + song.nextStep * parsed.stepTime < now + LOOKAHEAD) {
      const step = song.nextStep;
      const inSong = step % total;
      if (step >= total && song.def.loop === false) {
        this.song = null;
        return;
      }
      const when = song.start + step * parsed.stepTime;
      for (const n of parsed.notes) {
        if (n.step !== inSong) continue;
        const key = `${n.track}|${n.freq}|${n.steps}`;
        let buffer = song.cache.get(key);
        if (!buffer) {
          const def = noteSound(song.def.tracks[n.track]!, n.freq, n.steps * parsed.stepTime);
          buffer = this.toBuffer(def);
          song.cache.set(key, buffer);
        }
        const src = this.start(buffer, bus, when, {});
        this.musicSources.add(src);
        src.onended = () => this.musicSources.delete(src);
      }
      song.nextStep++;
    }
  }

  /** Stop everything and close the AudioContext. */
  dispose(): void {
    this.disposed = true;
    this.disarmUnlock();
    this.lifetime.abort();
    this.stopMusic();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.buses = {};
  }

  private start(buffer: AudioBuffer, bus: GainNode, when: number, o: PlayOptions): AudioBufferSourceNode {
    const ctx = this.context!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (o.pitch) src.playbackRate.value = Math.pow(2, o.pitch / 12);
    let node: AudioNode = src;
    if (o.volume !== undefined && o.volume !== 1) {
      const g = ctx.createGain();
      g.gain.value = Math.max(0, o.volume);
      node.connect(g);
      node = g;
    }
    if (o.pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      node = p;
    }
    node.connect(bus);
    src.start(when);
    return src;
  }

  private bufferFor(def: SoundDef): AudioBuffer {
    let buffer = this.buffers.get(def);
    if (!buffer) {
      buffer = this.toBuffer(def);
      this.buffers.set(def, buffer);
    }
    return buffer;
  }

  private toBuffer(def: SoundDef): AudioBuffer {
    const ctx = this.context!;
    const samples = renderSound(def, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, Math.max(1, samples.length), ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  private async decode(name: string, data: ArrayBuffer): Promise<void> {
    if (!this.context) return;
    this.files.set(name, await this.context.decodeAudioData(data));
  }

  private applyVolumes(): void {
    const s = this.settings;
    if (this.master) this.master.gain.value = s.muted ? 0 : s.master;
    if (this.buses.sfx) this.buses.sfx.gain.value = s.sfx;
    if (this.buses.music) this.buses.music.gain.value = s.music;
  }
}

function readSettings(): Partial<AudioSettings> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Partial<AudioSettings>;
    const out: Partial<AudioSettings> = {};
    for (const k of ['master', 'sfx', 'music'] as const) if (typeof v[k] === 'number' && v[k] >= 0 && v[k] <= 1) out[k] = v[k];
    if (typeof v.muted === 'boolean') out.muted = v.muted;
    return out;
  } catch {
    return {}; // storage blocked (privacy mode, sandboxed iframe) or corrupt
  }
}

function writeSettings(s: AudioSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings last for this session only */
  }
}
