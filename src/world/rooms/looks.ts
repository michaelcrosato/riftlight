/**
 * The Looks wing: one village diorama under every look the engine has.
 *
 *   consoles     whole-screen stacks that copy old hardware (NES, Mega Drive, PS1, Game Boy...)
 *   layers       looks that treat characters and the environment differently
 *   filters      the filter bench: stack single filters by stepping on them
 *   transitions  screen transitions, flashes and shockwaves
 */
import { Vector3 } from 'three/webgpu';
import {
  FILTER_PRESETS,
  FILTERS,
  type FilterGroup,
  type Look,
  LOOK_PRESETS,
  lookPresetLabel,
  lookPresetOf,
  type PaletteColor,
  TRANSITIONS,
  type TransitionKind,
} from '../../engine';
import { animate, diorama } from '../kit/diorama';
import { shell } from '../shell';
import type { PadDef, RoomDef, RoomRuntime } from '../types';

const ROOM_W = 30;
const ROOM_D = 26;

const COLORS: readonly PaletteColor[] = ['red', 'orange', 'sand', 'lime', 'green', 'teal', 'blue', 'sky', 'cyan', 'plum'];

function lookPad(name: string, i: number, note: string): PadDef {
  return {
    label: lookPresetLabel(name),
    color: COLORS[i % COLORS.length],
    group: 'look',
    initial: name === 'none',
    note,
    apply: (room) => room.ctx.engine.setLook(LOOK_PRESETS[name]!),
  };
}

const CONSOLE_NOTES: Readonly<Record<string, string>> = {
  none: 'The engine default: pixel art at 480 x 270 with outlines and creases, the Sweetie 16 colours as they are.',
  no_filters: 'Nothing: the scene at the full screen resolution, no pixel art, no outlines. Compare the edges of the roofs.',
  eight_bit: 'NES: half resolution, the 54-colour NES palette and a light dither.',
  sixteen_bit: 'Mega Drive / SNES: 9-bit colour (512 colours) with an ordered dither, and scanlines.',
  playstation: 'PS1: 15-bit colour through the console\'s own 4 x 4 dither table, and vertex wobble: vertices snap to the art-pixel grid.',
  arcade: 'An arcade CRT: curved glass, a shadow mask, scanlines and a vignette.',
  handheld: 'Game Boy: four greens and the gaps of an LCD grid.',
  famicom: 'The NES palette with scanlines, no resolution drop.',
  home_computer: 'Commodore 64 colours, the colour bleed of an NTSC signal, a vignette.',
  vhs_rental: 'A worn tape: wobble, colour bleed, grain.',
  spectrum: 'ZX Spectrum: 15 colours, bright and dark.',
  mac_classic: 'One bit: black and white with a dither, like a 1984 Macintosh.',
  pico: 'The PICO-8 fantasy console\'s 16 colours.',
  dream: 'Bloom, a sunset grade and a vignette.',
  spooky: 'Moonlight blue, grain and a dark vignette.',
};

async function lookRoom(room: RoomRuntime, pads: PadDef[], cols: number): Promise<{ update(dt: number): void }> {
  const { kit } = room;
  kit.room(ROOM_W, ROOM_D, { floor: ['mist', 'white'] });
  const { folk } = await diorama(kit, [0, 0, -5]);
  kit.padGrid(pads, { origin: [-((cols - 1) * 2) / 2, 0, 3.5], cols, pitch: 2 });
  return { update: (dt) => animate(folk, dt) };
}

export const CONSOLES: RoomDef = {
  id: 'consoles',
  title: 'Retro Consoles',
  wing: 'looks',
  about: 'One village, fifteen machines. Every pad is a whole-screen filter stack that copies old hardware: its palette, its dither, its screen. The scene underneath never changes.',
  try: ['Walk the pads from left to right and watch the roofs and the water', 'PLAYSTATION: look at the wobbling edges as you move', 'NO FILTERS against DEFAULT: the pixel art comes from the engine, not a filter'],
  spawn: [0, 0, 8],
  facing: Math.PI,
  guide: {
    what: 'A diorama (houses, trees, a pond, a lamp, crates and three townsfolk) and fifteen pads. Each pad applies a filter stack to the whole frame: the colours of a console, its dither, its screen.',
    how: [
      'The scene renders at the art resolution (480 x 270) into a nearest-filtered target with colour, normal and depth. Outlines come from depth jumps between neighbouring art pixels, creases from normals.',
      'Filters are TSL functions over the finished colour. "Art" filters (palettes, dither, colour grades) run once per art pixel before the single upscale, so they cost 1/16 of a full-screen pass at 4x.',
      '"Display" filters (scanlines, LCD gaps, CRT curvature, VHS wobble) need detail finer than an art pixel, so they run per screen pixel after the upscale.',
      'A palette filter finds the nearest palette colour per art pixel (weighted RGB distance), after adding an ordered-dither offset from a 4 x 4 Bayer matrix, so gradients turn into patterns instead of bands.',
      'The PS1 stack also switches on vertex snapping in every toon material: clip-space vertices round to the art-pixel grid, the famous wobble.',
      'Every parameter is a uniform: changing a slider never rebuilds or recompiles the graph. Changing the stack picks a cached graph (8 are kept).',
    ],
    uses: [
      'Shovel Knight (an NES palette on purpose), Celeste (low resolution, modern light), Hyper Light Drifter.',
      'Retro modes: Hotline Miami\'s VHS look, Blasphemous, the CRT options of many re-releases.',
      'Fantasy consoles: PICO-8 and TIC-80 make their limits the style.',
    ],
    ask: ['make it look like a NES game', 'a Game Boy palette with an LCD grid', 'PS1 vertex wobble and dither', 'a curved arcade CRT with scanlines', 'a 1-bit Macintosh look'],
    cost: 'Art filters: one small pass at 480 x 270 (about 130 thousand pixels), even at 4K. Display filters run per screen pixel; a CRT is the most expensive, a few texture reads per pixel.',
    code: [
      {
        title: 'Nearest palette colour, with dither',
        file: 'src/engine/render/filters.ts',
        src: `const d = dot(rgb.sub(cv).mul(rgb.sub(cv)), w);
best = select(d.lessThan(bestD), cv, best);
bestD = min(d, bestD);`,
      },
      {
        title: 'Bayer threshold per art pixel',
        file: 'src/engine/render/filters.ts',
        src: `const bayer2 = (a: N): N => fract(a.x.div(2).add(a.y.mul(a.y).mul(0.75)));
const bayer4 = (a: N): N => bayer2(floor(a.mul(0.5))).mul(0.25).add(bayer2(a));`,
      },
    ],
    words: ['art resolution', 'art pixel', 'palette', 'dither', 'Bayer matrix', 'filter', 'TSL', 'uniform', 'outline', 'crease', 'nearest-neighbour'],
  },
  async build(room) {
    const names = ['none', 'no_filters', ...Object.keys(FILTER_PRESETS).filter((n) => n !== 'none')];
    const pads = names.map((n, i) => lookPad(n, i, CONSOLE_NOTES[n] ?? `The ${lookPresetLabel(n)} stack: ${(FILTER_PRESETS[n] ?? []).join(', ')}.`));
    const r = await lookRoom(room, pads, 8);
    return { update: r.update, status: () => `look ${lookPresetOf(room.ctx.engine.look) ?? 'custom'}` };
  },
};

const LAYER_NOTES: Readonly<Record<string, string>> = {
  pixel_heroes: 'Characters and crates in pixel art, the world clean at full resolution.',
  pixel_world: 'The other way round: a pixel-art world, clean characters.',
  chunky_world: 'The world at 3x chunkier pixels than the characters.',
  cel_cartoon: 'Everything clean, cel-shaded with ink lines.',
  cel_heroes: 'Cel-shaded characters on a pixel-art world.',
  retro_heroes: 'NES characters in chunky pixels, a glowing clean world.',
  spotlight: 'A moonlit world, characters in their own colours.',
  sketchbook: 'A pencil-sketched world, inked characters.',
  dream_world: 'A bloomy sunset world, characters untouched.',
  handheld_heroes: 'Game Boy characters on a grey world.',
  noir: 'Black and white, heavy ink, grain.',
  sin_city: 'A grey posterized world, comic-coloured characters.',
  comic_book: 'Cel shading on a halftone print screen.',
  pop_art: 'Punchy colour, bold ink, big halftone dots.',
  storybook: 'A soft painted world, pixel-art characters.',
  neon_nights: 'A dark blue world, saturated characters, glow on what is bright.',
  heat_vision: 'Characters glow with body heat over a grey world.',
  night_ops: 'Night-vision goggles.',
  ps1_horror: 'PS1 wobble, dark and blue, grain.',
  found_footage: 'Heavy grain, a worn tape, a split signal.',
  old_photo: 'Sepia, grain and a dark edge.',
  virtual_boy: 'Red on black, with scanlines.',
  pico_world: 'PICO-8 colours, the world chunkier than its characters.',
};

export const LAYERS: RoomDef = {
  id: 'layers',
  title: 'Mix & Match',
  wing: 'looks',
  about: 'Characters and objects are one layer, the environment the other, and each can have its own look: pixel art or clean, its own pixel size, its own filters. Twenty-three pads mix them.',
  try: ['PIXEL HEROES then PIXEL WORLD: the same frame, the two layers swapped', 'CHUNKY WORLD: two pixel sizes at once', 'SIN CITY and HEAT VISION: each layer through a different filter'],
  spawn: [0, 0, 9],
  facing: Math.PI,
  guide: {
    what: 'The village again, with pads for looks that treat the two layers differently. The hero, the townsfolk and the crates are "actors"; houses, trees and the floor are "environment".',
    how: [
      'A root object is tagged with setLookLayer(object, "actors"); its children follow. Anything untagged is environment.',
      'When the layers look different, two scene passes render: each draws only its own layer\'s opaque objects (a render-object filter), so lights, fog and shadows are the same in both.',
      'Each layer runs its own pixel size and filter stack. Then, per pixel, the nearer of the two depth buffers wins, and the whole-frame filters run on the result.',
      'Transparent things (glows, blob shadows) draw in both passes, so they blend over whichever layer wins a pixel.',
      'Filters that move pixels (CRT, chromatic, VHS) only run on the whole frame: inside one layer they would no longer line up with the other.',
      'When both layers look the same, one pass renders: the default look costs nothing extra.',
    ],
    uses: [
      'Octopath Traveler and Triangle Strategy (HD-2D): pixel-art characters in a high-resolution world.',
      'Paper Mario and Don\'t Starve: characters drawn differently from the world they walk in.',
      'Thermal and night vision in stealth games: one layer stands out from the rest.',
    ],
    ask: ['pixel-art characters in a smooth 3D world', 'cel-shade only the characters', 'a grey world with characters in full colour', 'a chunkier pixel size for the environment'],
    cost: 'A split look renders the scene twice (each pass draws only its layer, so the draws are shared, not doubled) plus one compose. The default, unsplit look is one pass.',
    code: [
      {
        title: 'A look per layer',
        file: 'src/engine/render/look.ts',
        src: `sin_city: {
  scene: stack('vignette'),
  actors: { pixel: clean, filters: [at('cel', 'comic')] },
  environment: { pixel: crisp(),
    filters: [{ id: 'grayscale' }, at('posterize', 'bold')] },
},`,
      },
      {
        title: 'The nearer layer wins',
        file: 'src/engine/render/PixelRenderer.ts',
        src: `const front = (actors.depth(screenUV as unknown as Node) as unknown as { lessThan(n: Node): Node }).lessThan(world.depth(screenUV as unknown as Node));
const composed: Img = {
  node: select(front as never, actors.node as never, world.node as never) as unknown as Node,`,
      },
    ],
    words: ['look', 'look layer', 'art resolution', 'filter', 'draw call'],
  },
  async build(room) {
    const names = Object.keys(LAYER_NOTES);
    const pads = [lookPad('none', 9, 'Back to the default look.'), ...names.map((n, i) => lookPad(n, i, LAYER_NOTES[n]!))];
    const r = await lookRoom(room, pads, 8);
    return { update: r.update, status: () => `look ${lookPresetOf(room.ctx.engine.look) ?? 'custom'} · ${room.ctx.engine.renderer.split ? 'two passes' : 'one pass'}` };
  },
};

const BENCH_GROUPS: readonly FilterGroup[] = ['palette', 'color', 'era', 'display', 'signal', 'stylize', 'shading'];

export const FILTER_BENCH: RoomDef = {
  id: 'filters',
  title: 'Filter Bench',
  wing: 'looks',
  about: 'Every filter on its own pad. Step on pads to add them to the stack, step again to take them off; the stack runs in the order you added them. CLEAR empties it.',
  try: ['Stack NES, then SCANLINES, then CRT', 'Add BLOOM before and after a palette: order matters', 'Press T to see every parameter of the stack'],
  spawn: [0, 0, 7],
  facing: Math.PI,
  camera: { preset: 'iso', pitch: 40, yaw: 45, viewHeight: 19, stiffness: 7, minZoom: 0.4, maxZoom: 3 },
  guide: {
    what: 'Thirty-seven filter pads in rows by kind (palettes, colour grades, console eras, screens, signals, stylize, shading) and a CLEAR pad. The HUD lists the stack in order.',
    how: [
      'Each pad toggles one filter id in the whole-frame stack (engine.setFilters(ids)). The order is the order you added them.',
      'A stack is split at its first "display" filter: everything before it runs at the art resolution, everything from it on per screen pixel. Put art filters first.',
      'Changing the stack builds a new node graph (or takes it from a cache of 8). Changing a parameter never does: every parameter is a uniform.',
      'Filters that need neighbouring pixels (bloom, CRT, chromatic) first render their input to a texture at their stage\'s resolution, then sample it.',
    ],
    uses: ['Photo modes (Ghost of Tsushima, Spider-Man) let players stack grades and effects live.', 'Accessibility: colour-blind and high-contrast modes are filters on the final frame.', 'Prototyping a style before committing to art: stack filters over grey boxes.'],
    ask: ['a filter stack the player can build', 'let the player toggle scanlines and a CRT', 'a bloom that runs after the palette'],
    cost: 'Each art filter is a full pass at the art resolution, cheap; each display filter a full pass at the screen resolution. Bloom renders a small mip chain.',
    code: [
      {
        title: 'Split a stack at the first display filter',
        file: 'src/engine/render/PixelRenderer.ts',
        src: `for (const f of filters) {
  const def = getFilter(f.id);
  if (img.art && def.space === 'display') img = toDevice(img);
  img = { ...img, node: applyFilter(img.node, f.id, fx) as Node };
}`,
      },
    ],
    words: ['filter', 'uniform', 'art resolution', 'render pipeline'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(34, 30, { floor: ['mist', 'white'] });
    const stack: string[] = [];
    const pads: { id: string; pad: ReturnType<typeof kit.pad> }[] = [];
    const sync = () => {
      e.setFilters(stack);
      for (const p of pads) kit.lightPad(p.pad, stack.includes(p.id));
    };
    let row = 0;
    for (const group of BENCH_GROUPS) {
      const list = FILTERS.filter((f) => f.group === group);
      list.forEach((f, i) => {
        const pad = kit.pad(
          [-14 + (i % 10) * 2.6, 0, -11 + (row + Math.floor(i / 10)) * 2.6],
          {
            label: f.label,
            color: COLORS[BENCH_GROUPS.indexOf(group) % COLORS.length],
            note: `${f.label}, ${f.space === 'art' ? 'once per art pixel' : 'once per screen pixel'}. On: added at the end of the stack; step again to take it off.`,
            apply: () => {
              const at = stack.indexOf(f.id);
              if (at >= 0) stack.splice(at, 1);
              else stack.push(f.id);
              sync();
            },
          },
          [2.1, 2.1],
        );
        pads.push({ id: f.id, pad });
      });
      row += Math.ceil(list.length / 10);
    }
    kit.pad([0, 0, 10], { label: 'CLEAR', color: 'red', note: 'The stack is empty: the default pixel art.', apply: () => ((stack.length = 0), sync()) }, [3, 2]);
    // something to look at on the bench: crates, a column and a light
    for (const [x, z] of [[13, -4], [14, -2]] as const) kit.crate([x, 0.5, z], { tags: ['pushable'] });
    kit.cylinder([13.5, 1.5, 2], 0.6, 3, 'sky');
    kit.light({ position: [13.5, 3.5, 2], color: 0xffcd75, intensity: 8, radius: 8, flicker: 'torch' });
    e.setFilters([]);
    return {
      draw() {
        const text = stack.length ? `STACK: ${stack.join(' > ')}` : 'STACK: EMPTY';
        ctx.hud.text(4, 18, text.toUpperCase().slice(0, 70), { anchor: 'bottom-left', color: 'sand' });
      },
      status: () => `stack ${stack.join(',') || 'empty'}`,
      api: { stack: () => [...stack] },
    };
  },
};

const TRANSITION_NOTES: Readonly<Record<TransitionKind, string>> = {
  fade: 'A fade in five steps, the way old hardware faded (no smooth blend).',
  iris: 'A circle closing on the hero, opening again on the same spot.',
  diamonds: 'Diamonds swept left to right, 16 art pixels each.',
  dissolve: 'Random 3-pixel blocks, more of them each frame.',
  dither: 'An ordered dither: the 4 x 4 Bayer pattern fills in.',
  blinds: 'Horizontal bands 12 art pixels high closing like blinds.',
  wipe: 'A hard edge from left to right.',
  curtain: 'Two halves closing from the sides.',
  mosaic: 'Pixels grow into 20-pixel blocks, then fade.',
};

export const TRANSITIONS_ROOM: RoomDef = {
  id: 'transitions',
  title: 'Screen Transitions',
  wing: 'looks',
  about: 'How a game changes scene: fades, an iris, diamonds, a dither, blinds, a mosaic. Every pad plays one, closing and opening around you. Also: a flash and a shockwave.',
  try: ['IRIS, then walk while it closes: it follows you', 'MOSAIC: the picture blocks up before it goes dark', 'SHOCKWAVE next to the crates; FLASH for a lightning strike', 'USE FOR DOORS makes the last one the world\'s room change'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  guide: {
    what: 'Pads for nine transitions, three speeds, a flash and a shockwave. Each transition pad covers the screen and opens it again; the last one played can become the transition every door in the world uses.',
    how: [
      'engine.screen keeps a handful of uniforms: the transition kind, its progress (0 clear, 1 covered), a centre and a colour; the flash colour and amount; four shockwave rings.',
      'Every output graph ends with the same small TSL function. Per art pixel (screen pixel divided by the scale) it decides "covered or not" for the current kind: an iris compares the distance to the centre with (1 - progress) x the farthest corner; dither compares the Bayer threshold with the progress.',
      'So a transition is a pixel pattern at any scale, starting one never rebuilds a shader, and it works with every look, in Pixel and Raw mode.',
      'Progress runs on real time, so it keeps moving while the game is paused or the next room builds: cover, loadGame, reveal. A cover resolves true when it finished, false when something else took the screen over.',
      'Shockwaves (and the mosaic\'s growing blocks) resample the art-resolution picture where it is upscaled: near a ring the lookup is pushed outward from the centre, by up to a few art pixels. While nothing runs, both stages are skipped by one uniform test.',
    ],
    uses: ['The Legend of Zelda: A Link to the Past (mosaic and iris), Super Mario World (iris on Mario).', 'Pokemon battle intros (blinds, swirls, diamonds).', 'Shockwaves: explosions in Nuclear Throne and Enter the Gungeon push the screen.'],
    ask: ['an iris transition that closes on the player', 'a SNES mosaic when changing levels', 'a white flash when the player is hit', 'a shockwave on explosions'],
    cost: 'A few dozen arithmetic operations per screen pixel at the end of the frame, always on (a clear screen runs the same code). Shockwaves add four ring tests to the one upscale lookup.',
    code: [
      {
        title: 'An iris, per art pixel',
        file: 'src/engine/render/screenFx.ts',
        src: `const c = this.uCenter.xy.mul(size);
const reach = length(max(c, size.sub(c)));
const iris = covered(length(a.add(0.5).sub(c))
  .greaterThan(float(1).sub(p).mul(reach)));`,
      },
      {
        title: 'Cover, load, reveal (the room\'s own pads)',
        file: 'src/world/rooms/looks.ts',
        src: `const ok = (await e.screen.cover(kind, { duration: speed, center })) && (await ctx.tweens.call(0.25, () => {}).done) && !gone;
if (ok) await e.screen.reveal(kind, { duration: speed, center });`,
      },
    ],
    words: ['screen transition', 'iris', 'mosaic', 'flash', 'shockwave', 'uniform', 'Bayer matrix', 'art pixel'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(26, 20, { floor: ['sand', 'orange'] });
    let speed = 0.6;
    let last: TransitionKind = 'iris';
    let playing = false;
    let gone = false;
    /** The hero's chest, updated every frame: the iris follows them while it closes. */
    const center = new Vector3();
    const play = async (kind: TransitionKind) => {
      if (playing) return;
      playing = true;
      last = kind;
      // stop if something else takes over the screen (a door) or the room unloads
      const ok = (await e.screen.cover(kind, { duration: speed, center })) && (await ctx.tweens.call(0.25, () => {}).done) && !gone;
      if (ok) await e.screen.reveal(kind, { duration: speed, center });
      playing = false;
    };
    kit.padGrid(
      TRANSITIONS.map((k, i) => ({ label: k, color: COLORS[i % COLORS.length], note: TRANSITION_NOTES[k], apply: () => void play(k) })),
      { origin: [-8, 0, -6], cols: 5, pitch: 4 },
    );
    const speeds: [string, number][] = [
      ['QUICK', 0.3],
      ['NORMAL', 0.6],
      ['SLOW', 1.6],
    ];
    speeds.forEach(([label, s], i) =>
      kit.pad([-4 + i * 4, 0, 3], { label, color: 'slate', group: 'speed', initial: s === 0.6, note: `Transitions take ${s} s each way.`, apply: () => (speed = s) }),
    );
    kit.pad([-8, 0, 7], { label: 'FLASH', color: 'white', note: 'A white flash that fades out in four steps: lightning, a hit, a camera.', apply: () => e.screen.flash(0xffffff, { duration: 0.3, strength: 1 }) });
    kit.pad([-4, 0, 7], {
      label: 'SHOCKWAVE',
      color: 'red',
      note: 'A ring from the crates: the picture is pushed outward near it, and the crates are pushed too.',
      apply: () => {
        const at = new Vector3(6, 0.5, 7);
        e.screen.shockwave(at, { radius: 0.5, strength: 1.2 });
        e.shake.add(0.5);
        ctx.particles.burst('impact', at);
        ctx.audio.play('groundPound');
        for (const c of crates) {
          const p = c.body.translation();
          const d = new Vector3(p.x - at.x, 0, p.z - at.z);
          const k = Math.max(0, 1 - d.length() / 5) * 9 * c.body.mass();
          d.normalize().multiplyScalar(k).setY(k * 0.6);
          c.body.applyImpulse(d, true);
        }
      },
    });
    kit.pad([0, 0, 7], {
      label: 'USE FOR DOORS',
      color: 'sand',
      note: 'The last transition you played is now the one every door in Engine World uses (T changes it too).',
      apply: () => (shell.transition = last),
    });
    const crates = [[5, 6], [7, 6], [6, 8], [5.5, 7], [6.5, 7]].map(([x, z]) => kit.crate([x!, 0.5, z!], { size: 0.8 }));
    return {
      knobs: [{ id: 'time', label: 'Transition time', min: 0.1, max: 2, step: 0.05, get: () => speed, set: (v) => (speed = v), format: (v) => `${v.toFixed(2)} s`, initial: 0.6 }],
      update() {
        const p = room.hero?.position;
        if (p) center.set(p.x, p.y + 0.9, p.z);
      },
      dispose() {
        gone = true;
      },
      status: () => `${last} ${speed}s`,
      api: { play, state: () => ({ last, speed, playing }) },
    };
  },
};

/** For tests: the look each named pad applies. */
export function lookOf(name: string): Look | undefined {
  return LOOK_PRESETS[name];
}
