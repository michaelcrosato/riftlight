/**
 * Just enough Web Audio for the AudioManager's tests (`vi.stubGlobal('AudioContext', FakeContext)`):
 * what a sound wires up (each node's `outs`) and the values its parameters end at.
 */
export class FakeParam {
  value = 0;
  setTargetAtTime(v: number) {
    this.value = v; // the glide's destination
  }
}
export class FakeNode {
  readonly outs: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    if (!(n instanceof FakeNode)) throw new TypeError('connect: not an AudioNode'); // as Web Audio does
    this.outs.push(n);
    return n;
  }
  disconnect() {
    this.outs.length = 0;
  }
}
export class FakeContext {
  static made: FakeContext[] = [];
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  sources: (FakeNode & { loop: boolean; started: boolean; stopped: boolean; playbackRate: FakeParam })[] = [];
  constructor() {
    FakeContext.made.push(this);
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: Object.assign(new FakeParam(), { value: 1 }) });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam() });
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam() });
  }
  createBufferSource() {
    const s = Object.assign(new FakeNode(), {
      buffer: null,
      loop: false,
      started: false,
      stopped: false,
      playbackRate: Object.assign(new FakeParam(), { value: 1 }),
      start() {
        s.started = true;
      },
      stop() {
        s.stopped = true;
      },
    });
    this.sources.push(s);
    return s;
  }
  createBuffer(_c: number, n: number) {
    return { length: n, copyToChannel() {} };
  }
  /** Decoding finishes when the test says so. */
  static finishDecode: (() => void) | null = null;
  decodeAudioData() {
    return new Promise((done) => (FakeContext.finishDecode = () => done({ length: 100 })));
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}
