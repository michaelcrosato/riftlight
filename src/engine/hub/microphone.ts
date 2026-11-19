/**
 * 52in1's microphone as a shout's loudness (`input.microphone`, docs/engine/hub.md *Shouts*).
 * The engine makes one on a page in 52in1; Input asks it on every poll whether the game listens
 * (`input.voice`, never in a replay). It opens a stream through `hubSettings.openMicrophone()` (never
 * the browser's own) once while the game listens and `on` holds (the game's voice feature on,
 * `engine.voiceOn`, and the DualSense's mute button off), and closes it, its tracks stopped, as soon
 * as either ends: the setting turned off, the microphone muted or no longer allowed, a replay. Its
 * loudness is an `AnalyserNode`'s RMS in the engine's AudioContext, which exists after the first
 * key, click or touch (until then nothing is heard).
 */
import type { VoiceInput } from '../input';
import type { HubSettings } from './settings';

/** Samples the loudness is measured over: 43 ms at 48 kHz, longer than a frame at 30 fps. */
const SAMPLES = 2048;

/** A stream's tracks stopped: the browser's recording light goes out. */
const stop = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

export class Microphone implements VoiceInput {
  private stream: MediaStream | null = null;
  private source: AudioNode | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  /** 52in1 was asked since the last close (answered with a stream, nothing yet, or none): never asked twice. */
  private asked = false;
  /** Counts closes: a stream answering an ask from before one is stopped at once. */
  private token = 0;

  /**
   * `hub`: the player's 52in1 settings (`engine.hubSettings`); `allowed`: the game's voice feature
   * is on (`engine.voiceOn`); `context`: the engine's AudioContext, or null before the first input.
   */
  constructor(
    private readonly hub: Pick<HubSettings, 'micMuted' | 'openMicrophone'>,
    private readonly allowed: () => boolean,
    private readonly context: () => AudioContext | null,
  ) {}

  /** The player lets the game hear them now: its voice feature on and the microphone not muted. */
  get on(): boolean {
    return this.allowed() && !this.hub.micMuted;
  }

  /** A stream is open (tools and tests). */
  get open(): boolean {
    return this.stream !== null;
  }

  /** Input, on every poll: open the stream while the game listens and `on` holds, close it otherwise. */
  listen(listening: boolean): void {
    if (!listening || !this.on) return this.close();
    if (!this.asked) {
      this.asked = true;
      const token = this.token;
      void this.hub.openMicrophone().then((stream) => {
        if (stream && token !== this.token) stop(stream);
        else if (stream) this.stream = stream;
      });
    }
    if (this.stream && !this.analyser) this.connect(this.stream);
  }

  /** The loudness now: the RMS of the last `SAMPLES` samples, 0..1; null with no stream or no sound yet. */
  level(): number | null {
    const a = this.analyser;
    const s = this.samples;
    if (!a || !s || !this.on) return null;
    a.getFloatTimeDomainData(s);
    let sum = 0;
    for (const v of s) sum += v * v;
    return Math.sqrt(sum / s.length);
  }

  /** Stop listening: the stream's tracks stopped, its nodes let go, an answer still on its way stopped as it comes. */
  close(): void {
    this.token++;
    this.asked = false;
    this.source?.disconnect();
    if (this.stream) stop(this.stream);
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.samples = null;
  }

  /** Measure `stream` in the engine's AudioContext, once there is one. */
  private connect(stream: MediaStream): void {
    const ctx = this.context();
    if (!ctx) return;
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = SAMPLES;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      this.source = source;
      this.analyser = analyser;
      this.samples = new Float32Array(SAMPLES);
    } catch {
      // a stream with no sound in it: nothing to hear, and 52in1 is not asked again until a close
      stop(stream);
      this.stream = null;
    }
  }
}
