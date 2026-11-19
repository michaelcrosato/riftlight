// The engine's sound under 52in1's companion (scripts/hub/companion.js, vendored unmodified: the
// hub's first script in every game page it serves), run here against Web Audio shaped as a
// browser's: `start` on AudioScheduledSourceNode, and an AudioBufferSourceNode's own `start` over
// it, which the companion's hook never sees. The companion holds a game's AudioContext while the
// hub's cards are up (a game night's round loads under them, `?aihub=1`) once a source started in
// it says which context is the game's, and puts the hub's master volume in front of the speakers.
// The real page: the `hub` e2e suite (scripts/e2e-hub-companion.mjs).
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../audio/AudioManager';

/** A page's Web Audio as a browser's IDL has it, and the hub (the companion's parent): fresh each time (the companion patches it). */
function browser(search: string) {
  class AudioParam {
    value = 1;
    setTargetAtTime(v: number) {
      this.value = v;
    }
  }
  class AudioNode {
    readonly outs: AudioNode[] = [];
    constructor(readonly context: AudioContext) {}
    connect<T extends AudioNode>(n: T): T {
      this.outs.push(n);
      return n;
    }
    disconnect() {
      this.outs.length = 0;
    }
  }
  class AudioDestinationNode extends AudioNode {}
  class GainNode extends AudioNode {
    readonly gain = new AudioParam();
  }
  class AudioScheduledSourceNode extends AudioNode {
    started = 0;
    onended: (() => void) | null = null;
    start() {
      this.started++;
    }
    stop() {}
  }
  class AudioBufferSourceNode extends AudioScheduledSourceNode {
    buffer: unknown = null;
    loop = false;
    readonly playbackRate = new AudioParam();
    // its own start, over AudioScheduledSourceNode's, as in every browser
    override start() {
      this.started++;
    }
  }
  class ConstantSourceNode extends AudioScheduledSourceNode {
    readonly offset = new AudioParam();
  }
  class AudioContext {
    static made: AudioContext[] = [];
    state: 'running' | 'suspended' | 'closed' = 'running';
    onstatechange: (() => void) | null = null;
    currentTime = 0;
    sampleRate = 8000;
    readonly destination: AudioDestinationNode = new AudioDestinationNode(this);
    constructor() {
      AudioContext.made.push(this);
    }
    createGain() {
      return new GainNode(this);
    }
    createBufferSource() {
      return new AudioBufferSourceNode(this);
    }
    createConstantSource() {
      return new ConstantSourceNode(this);
    }
    createBuffer(_channels: number, length: number) {
      return { length, copyToChannel() {} };
    }
    suspend() {
      return this.become('suspended');
    }
    resume() {
      return this.become('running');
    }
    close() {
      return this.become('closed');
    }
    /** As a browser does: the state changes a moment later, then `statechange`. */
    private async become(state: AudioContext['state']) {
      await Promise.resolve();
      if (this.state === 'closed' || this.state === state) return;
      this.state = state;
      this.onstatechange?.();
    }
  }
  const listeners: ((event: unknown) => void)[] = [];
  const hub = { posted: [] as unknown[], postMessage: (m: unknown) => hub.posted.push(m) };
  const win = {
    parent: hub,
    location: { search },
    AudioNode,
    AudioDestinationNode,
    AudioScheduledSourceNode,
    AudioBufferSourceNode,
    AudioContext,
    addEventListener: (type: string, fn: (event: unknown) => void) => type === 'message' && listeners.push(fn),
    setTimeout: (fn: () => void) => (fn(), 0),
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    document: { querySelectorAll: () => [] },
    navigator: {},
    performance,
    EventTarget,
    Event,
  };
  runInNewContext(readFileSync(new URL('../../../scripts/hub/companion.js', import.meta.url), 'utf8'), { window: win });
  /** The hub says something to the game's frame. */
  const say = (data: object) => listeners.forEach((fn) => fn({ source: hub, data }));
  return { AudioContext, hub, say };
}

/** Promise callbacks run (the contexts' state changes). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('the engine under 52in1’s companion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a game night’s page (?aihub=1) loads hushed: the engine’s context is held from its first gesture until the hub lifts the hush, and held again under the next cards', async () => {
    const b = browser('?aihub=1');
    vi.stubGlobal('AudioContext', b.AudioContext);
    const audio = new AudioManager(new EventTarget());
    audio.unlock(); // the first key, click or touch
    await settle();
    const ctx = b.AudioContext.made[0]!;
    expect(ctx.state, 'held under the cards').toBe('suspended');
    expect(audio.unlocked).toBe(false);
    expect(audio.play('coin'), 'no sound under the cards').toBe(false);
    audio.unlock(); // another gesture: its resume waits for the hush to lift
    await settle();
    expect(ctx.state, 'still held').toBe('suspended');
    b.say({ hubFrame: 'hush', on: false }); // play starts
    await settle();
    expect(ctx.state, 'given back once play starts').toBe('running');
    expect(audio.unlocked).toBe(true);
    expect(audio.play('coin')).toBe(true);
    b.say({ hubFrame: 'hush', on: true }); // the next round's cards
    await settle();
    expect(ctx.state, 'held under the next cards').toBe('suspended');
    audio.dispose();
  });

  it('a hush lifted while the companion’s hold is still on its way (the context made as play starts) leaves it suspended: the next gesture brings the sound back', async () => {
    const b = browser('?aihub=1');
    vi.stubGlobal('AudioContext', b.AudioContext);
    const page = new EventTarget();
    const audio = new AudioManager(page);
    page.dispatchEvent(new Event('keydown')); // the companion asks the new context to suspend: it takes a moment
    b.say({ hubFrame: 'hush', on: false }); // play starts meanwhile: the context still runs, so the companion resumes nothing
    await settle();
    const ctx = b.AudioContext.made[0]!;
    expect(ctx.state, 'the suspend lands after the hush lifted').toBe('suspended');
    page.dispatchEvent(new Event('keydown')); // the player's next key: the engine listens again once its context stops
    await settle();
    expect(ctx.state).toBe('running');
    expect(audio.play('coin')).toBe(true);
    audio.dispose();
  });

  it('on the wall (no ?aihub) it plays at once, at the game’s master behind the hub’s, and the hub can still hush it', async () => {
    const b = browser('?lang=en');
    vi.stubGlobal('AudioContext', b.AudioContext);
    const audio = new AudioManager(new EventTarget());
    audio.unlock();
    await settle();
    const ctx = b.AudioContext.made[0]!;
    expect(ctx.state).toBe('running');
    expect(audio.play('coin')).toBe(true);
    b.say({ hubFrame: 'settings', settings: { volume: { master: 0.5, music: 1, effects: 1 } } });
    // what reaches the speakers: the companion's gain at the hub's master, the engine's own master behind it
    type Node = { outs: object[]; gain?: { value: number } };
    const nodes = (ctx as unknown as { destination: object }).destination;
    const master = (audio as unknown as { master: Node }).master;
    const front = master.outs[0] as Node;
    expect(front.outs, 'the hub’s gain is in front of the speakers').toEqual([nodes]);
    expect(front.gain?.value).toBe(0.5);
    expect(master.gain?.value, 'the game’s own master').toBe(audio.volume.master);
    b.say({ hubFrame: 'hush', on: true });
    await settle();
    expect(ctx.state, 'the hub hushes it').toBe('suspended');
    audio.dispose();
  });
});
