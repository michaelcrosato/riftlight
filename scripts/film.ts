// Film the real game: drive the hero with scripted input in the actual renderer, one exact
// 1/60 s frame at a time (Engine.step), and save what a player would see — plus what the
// animation system was doing — so agents can review moves, blends and transitions in context.
//
//   npm run film -- <scenario|"script">  [options]
//   npm run film -- list                  named scenarios
//
//   --view side|front|three|back|game  film camera (default side; `game` = the game's own camera)
//   --size 2.8           metres of world the film camera frames (side/front/three/back)
//   --every 2            capture an image every N frames (data is logged every frame)
//   --cols 12            filmstrip columns
//   --mode pixel|raw     render mode (default pixel = what the player sees)
//   --look <preset>      post filters (e.g. snes, ps1)
//   --gif                also write an animated GIF (for humans to watch)
//   --webgpu             WebGPU backend (needs a display: run under xvfb-run); default WebGL 2
//   --preview            serve the production build (npm run build) instead of the dev server
//   --game arena         film another level (?game=); `arena-*` scenarios do this themselves
//
// Script language (commands separated by ';' or newlines; keys: W A S D SPACE SHIFT C J F Z X B V K Q E R LMB RMB,
// combine with '+'; yaw in degrees, 0 = +Z, 90 = +X; W = -Z, D = +X):
//   place x y z [yaw]    teleport and settle (not recorded); in the arena also: back on its
//                        feet, full mana, no cooldowns, the default skill bar and the sword
//   skills a,b+sup,...   (arena) the skill bar, RMB/K Q E R F (gem+support+...)
//   weapon CLASS [2h]    (arena) equip a weapon class: sword axe mace sceptre dagger wand staff bow
//   hurt SHARE [dx dz]   (arena) the hero loses SHARE of its life, knocked away from (dx, dz)
//   kill                 (arena) the hero dies
//   hold KEYS n          hold keys for n frames, then release
//   down KEYS / up KEYS  press / release (stay held across commands)
//   tap KEYS             press for 2 frames, release, 1 more frame
//   wait n               n frames with no change
//   until STATE [max]    step until hero.state === STATE (or `grounded`), max 180 frames;
//                        giving up is an `until` issue and makes the film exit 1
//
// Output (.scratch/film/<name>.*): png filmstrip (+ timeline of speed, joint speed, foot
// contact), json per-frame log, gif with --gif. The console summary lists the state/clip
// timeline and flags pops (one-frame joint jumps), foot slip, feet sinking or floating.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { GLYPH_H, textWidth } from '../src/engine/animation/font';
import { BAD, Canvas, CELL_BG, CONTACT, DIM, GRID, GROUND, LEFT, RIGHT, TEXT, WARN, type RGB } from '../src/engine/animation/raster';
import { encodeGif } from './gif';
import { encodePng } from './png';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FILM_PORT) || 4200 + Math.floor(Math.random() * 600);
/** Scenarios whose `until` gave up (exit code 1). */
const failed: string[] = [];

export const SCENARIOS: Record<string, string> = {
  idle: 'place 0 0 4 90; wait 120',
  walk: 'place -6 0 10 90; hold D+SHIFT 70; wait 30',
  'run-stop': 'place -6 0 10 90; hold D 75; wait 45',
  bonk: 'place -3 0 13 90; hold D 70; wait 30',
  skid: 'place -6 0 10 90; down D; wait 45; up D; hold A 30; wait 30',
  jump: 'place 0 0 4 90; tap SPACE; until land 90; wait 30',
  // landing while moving runs on (no 'land' state): wait for the feet instead
  'run-jump': 'place -6 0 10 90; down D; wait 35; tap SPACE; until grounded 90; wait 20; up D; wait 30',
  'triple-jump': 'place -8 0 10 90; down D; wait 35; tap SPACE; until grounded 90; tap SPACE; until grounded 90; tap SPACE; until grounded 120; up D; wait 40',
  backflip: 'place 0 0 4 90; down C; wait 8; tap SPACE; until land 120; up C; wait 30',
  'long-jump': 'place -8 0 10 90; down D; wait 40; down C; wait 1; tap SPACE; up C+D; until grounded 120; wait 40',
  'side-flip': 'place -6 0 10 90; down D; wait 45; up D; down A; until skid 30; tap SPACE; up A; until land 120; wait 30',
  crouch: 'place 0 0 4 90; down C; wait 20; down D; wait 50; up D; wait 15; up C; wait 25',
  // through the 0.75 m tunnel and up on the far side
  crawl: 'place -5.8 0 7 -90; tap Z; until prone 60; hold A 250; tap Z; until idle 60; wait 20',
  // each press lands in the next hit's queue window (> 0.1 s into the current one)
  punches: 'place 0 0 4 90; tap J; wait 7; tap J; wait 17; tap J; until idle 60; wait 20',
  'ground-pound': 'place 0 0 4 90; tap SPACE; wait 20; tap C; until grounded 120; wait 45',
  dive: 'place -6 0 10 90; down D; wait 40; tap SPACE; wait 8; tap J; up D; until getUpFront 150; until idle 60; wait 15',
  'lie-down': 'place 0 0 4 90; tap X; wait 100; tap X; wait 70',
  sit: 'place 0 0 4 90; tap B; wait 60; tap B; wait 30; tap V; wait 60',
  stairs: 'place -1.4 0 0 -90; hold A 110; wait 20',
  // the 15° ramp east of the start: walk up it, stop on the slope; run up, over and down
  ramp: 'place 4 0 10 90; hold D+SHIFT 100; wait 30',
  'ramp-run': 'place 2 0 10 90; hold D 110; wait 40',
  ledge: 'place 4.8 0 0 90; down D; tap SPACE; until hang 90; up D; wait 30; down D; until idle 120; up D; wait 20',
  climb: 'place 8 0 -6.9 180; down W; wait 150; up W; wait 20',
  'hard-land': 'place -12 7 -9.2 180; down W; until hardLand 200; up W; until idle 90; wait 20',
  // in the wall-kick chimney: jump at a wall, slide down it, kick off to the other one
  'wall-slide': 'place -5.6 0 -9 90; down D; tap SPACE; until wallSlide 90; wait 6; tap SPACE; up D; until grounded 120; wait 20',
  // walk into the back wall and lean on it (PushIdle)
  'push-wall': 'place 0 0 -6.6 180; down W+SHIFT; wait 80; up W+SHIFT; wait 20',
  // walk onto the spike pad: knocked back, stunned, blinking
  hurt: 'place 9 0 12.4 0; down S; until hurt 60; up S; until idle 90; wait 20',
  // Riftlight combat arena (?game=arena): the training dummy stands at (0, 0, -2)
  'arena-combo': 'place 0 0 0.9 180; tap J; wait 7; tap J; wait 7; tap J; until idle 60; wait 15',
  'arena-cancel': 'place 0 0 0.9 180; tap J; wait 9; down D; tap SPACE; up D; until idle 60; wait 10',
  'arena-dodge': 'place 0 0 3 90; down D; wait 12; tap SPACE; wait 4; tap SPACE; until run 60; wait 8; up D; until idle 40; wait 10',
  'arena-skills': 'place 0 0 3.5 180; tap Q; wait 34; tap E; wait 40; tap R; until idle 120; wait 20',
  'arena-run-cast': 'place -8 0 2 90; down D; wait 20; tap Q; wait 26; up D; until idle 40; wait 10',
  'arena-whirlwind': 'place 0 0 2.5 180; down F; wait 70; up F; until idle 40; wait 10',
  // each step of the basic combo on its own (2 and 3 chain through the steps before them)
  'arena-slash1': 'place 0 0 0.9 180; tap J; until idle 60; wait 15',
  'arena-slash2': 'place 0 0 0.9 180; tap J; wait 7; tap J; until idle 60; wait 15',
  'arena-slash3': 'place 0 0 0.9 180; tap J; wait 7; tap J; wait 7; tap J; until idle 80; wait 20',
  // every skill delivery kind
  'arena-strike': 'place 0 0 1.2 180; skills cleave; tap K; until idle 60; wait 15',
  'arena-slam': 'place 0 0 1.4 180; skills ground-slam; tap K; until idle 80; wait 15',
  'arena-projectile': 'place 0 0 3.5 180; skills fireball; tap K; until idle 60; wait 20',
  'arena-nova': 'place 0 0 2 180; skills frost-nova; tap K; until idle 60; wait 20',
  'arena-beam': 'place 0 0 3.5 180; skills searing-beam; down K; wait 50; up K; until idle 40; wait 15',
  'arena-dash': 'place 0 0 5 180; skills shield-charge; tap K; until idle 60; wait 20',
  'arena-summon': 'place 0 0 3.5 180; skills summon-skeletons; tap K; until idle 80; wait 20',
  'arena-aura': 'place 0 0 3.5 180; skills haste-aura; tap K; until idle 60; wait 20',
  'arena-trap': 'place 0 0 3.5 180; skills fire-trap; tap K; until idle 60; wait 20',
  'arena-curse': 'place 0 0 3.5 180; skills vulnerability; tap K; until idle 60; wait 20',
  'arena-totem': 'place 0 0 3.5 180; skills fireball+spell-totem; tap K; until idle 90; wait 20',
  'arena-warcry': 'place 0 0 3 180; skills war-cry; tap K; until idle 60; wait 20',
  'arena-leap': 'place 0 0 4.5 180; skills leap-slam; tap K; until idle 90; wait 20',
  // weapons: the bow draws a real string, staves and wands point at the target
  'arena-bow': 'place 0 0 4.5 180; weapon bow; skills split-arrow; tap K; until idle 60; tap K; until idle 60; wait 15',
  'arena-staff': 'place 0 0 4 180; weapon staff 2h; skills fireball,frost-nova; tap K; until idle 60; tap Q; until idle 60; wait 15',
  'arena-wand': 'place 0 0 4 180; weapon wand; skills fireball; tap K; until idle 60; wait 15',
  'arena-axe': 'place 0 0 0.9 180; weapon axe; tap J; wait 7; tap J; wait 7; tap J; until idle 80; wait 15',
  // the dodge roll in 8 directions from a standstill
  'arena-roll8': 'place 0 0 3 180; ' + ['W', 'W+D', 'D', 'S+D', 'S', 'S+A', 'A', 'W+A'].map((k) => `down ${k}; tap SPACE; up ${k}; until idle 60; wait 8`).join('; '),
  // taking a heavy hit, then going down
  'arena-hurt': 'place 0 0 3 180; wait 10; hurt 0.2 0 -1; wait 40; hurt 0.25 1 0; wait 40',
  'arena-death': 'place 0 0 3 180; wait 10; kill; wait 110',
};
/** Scenarios that run in another game than the playground (`?game=`). */
const SCENARIO_GAME = (name: string): string | null => (name.startsWith('arena') ? 'arena' : null);

const KEYS: Record<string, string> = {
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', SPACE: 'Space', SHIFT: 'ShiftLeft', C: 'KeyC', J: 'KeyJ', F: 'KeyF', Z: 'KeyZ', X: 'KeyX', B: 'KeyB', V: 'KeyV',
  // Riftlight: skill keys and the mouse buttons (virtual keys pressed by the hero's MouseAim)
  K: 'KeyK', Q: 'KeyQ', E: 'KeyE', R: 'KeyR', LMB: 'MouseLeft', RMB: 'MouseRight',
};

// ---- args
const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const valued = ['view', 'size', 'every', 'cols', 'mode', 'look', 'out', 'name', 'game'].includes(a.slice(2));
    flags.set(a.slice(2), valued ? (argv[++i] ?? '') : true);
  } else positional.push(a);
}
const opt = (k: string, d: string) => String(flags.get(k) ?? d);
const target = positional.join(' ').trim();
if (!target || target === 'list') {
  console.log('Scenarios (npm run film -- <name>):');
  for (const [k, v] of Object.entries(SCENARIOS)) console.log(`  ${k.padEnd(13)} ${v}`);
  console.log('\nOr pass a script: npm run film -- "place 0 0 4 90; tap SPACE; until land; wait 20"');
  process.exit(0);
}
// several scenario names (or `all`) run in one browser session; anything else is a script
const names = positional.includes('all') ? Object.keys(SCENARIOS).filter((n) => SCENARIO_GAME(n) === (flags.has('game') ? opt('game', '') : null)) : positional;
const jobs: { name: string; script: string }[] = names.every((n) => SCENARIOS[n])
  ? names.map((n) => ({ name: n, script: SCENARIOS[n]! }))
  : [{ name: opt('name', 'custom'), script: target }];
const view = opt('view', 'side');
const every = Math.max(1, Math.round(Number(opt('every', '2'))) || 2);
const outDir = resolve(ROOT, opt('out', '.scratch/film'));

type Cmd = { op: string; keys: string[]; n: number[]; word: string };
function parse(src: string): Cmd[] {
  return src
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [op, ...rest] = line.split(/\s+/);
      const cmd: Cmd = { op: op!.toLowerCase(), keys: [], n: [], word: '' };
      for (const r of rest) {
        if (/^-?\d+(\.\d+)?$/.test(r)) cmd.n.push(Number(r));
        else if (['hold', 'down', 'up', 'tap'].includes(cmd.op)) {
          cmd.keys = r.split('+').map((k) => {
            const code = KEYS[k.toUpperCase()] ?? (/^(Key|Space|Shift)/.test(k) ? k : null);
            if (!code) throw new Error(`unknown key "${k}" in "${line}"`);
            return code;
          });
        } else cmd.word = r;
      }
      if (!['place', 'hold', 'down', 'up', 'tap', 'wait', 'until', 'skills', 'weapon', 'hurt', 'kill'].includes(cmd.op)) throw new Error(`unknown command "${line}"`);
      if (cmd.op === 'skills' || cmd.op === 'weapon') cmd.word = rest.join(' ');
      return cmd;
    });
}

// ---- page side (plain JS string: runs in the browser, no bundler helpers)
const PAGE = String.raw`
window.__FILM = (() => {
  const e = window.__PIXEL_ENGINE__, g = e.game, hero = g.hero, model = g.heroModel;
  const gameCam = e.camera.camera;
  const cam = gameCam.clone();
  if (cam.isPerspectiveCamera) { cam.fov = 30; cam.updateProjectionMatrix(); }
  const V = model.position.constructor;
  const joints = [];
  model.traverse((o) => { if (o !== model && o.name && !o.isMesh) joints.push(o); });
  const shoes = ['ShoeR', 'ShoeL'].map((n) => model.getObjectByName(n));
  const tmp = new V();
  const down = new V(0, -1, 0);
  const noTags = [];
  // the arena's skill bar as it starts (place puts it back)
  const defaults = (hero.slots ?? []).map((s) => (s ? { skill: s.id, supports: [...s.supports] } : null));
  return {
    joints: joints.map((j) => j.name),
    release() { for (const k of ${JSON.stringify(Object.values(KEYS))}) e.input.setKey(k, false); },
    key(code, down) { e.input.setKey(code, down); },
    place(x, y, z, yawDeg) {
      this.release();
      // (arena) a clean slate: alive, full mana, no cooldowns, the default bar and the sword
      if (hero.actor && hero.setSlot) {
        if (!hero.actor.alive || hero.actor.deadFor >= 0) hero.revive();
        hero.actor.stats.remove('film:weapon');
        defaults.forEach((s, i) => hero.setSlot(i, s));
        hero.cooldowns.clear();
        hero.actor.life = hero.actor.maxLife;
        hero.actor.mana = hero.actor.maxMana;
      }
      e.step(1);
      hero.teleport([x, y, z]);
      hero.facing = (yawDeg * Math.PI) / 180;
      model.rotation.y = hero.facing;
      hero.hvel.set(0, 0, 0);
      e.step(20);
    },
    step(n) { e.step(n); },
    skills(list) {
      const specs = list.split(',').map((x) => { const [skill, ...supports] = x.split('+'); return { skill, supports }; });
      for (let i = 0; i < 5; i++) hero.setSlot(i, specs[i] ?? null);
      hero.actor.mana = hero.actor.maxMana;
    },
    weapon(kind, two) {
      const mods = [{ stat: 'weapon.' + kind, kind: 'flag', value: 1 }];
      if (two) mods.push({ stat: 'weapon.twohand', kind: 'flag', value: 1 });
      hero.actor.stats.set('film:weapon', mods);
    },
    hurt(share, dx, dz) {
      const a = hero.actor;
      a.life = Math.max(1, a.life - a.maxLife * share);
      const len = Math.hypot(dx, dz) || 1;
      a.push(new V(-dx / len * 6, 0, -dz / len * 6));
    },
    kill() { hero.actor.life = 0; hero.actor.die(null); },
    /** One round trip per frame: advance, sample, and (optionally) film. */
    async frame(view, size) {
      e.step(1);
      const s = this.sample();
      if (view) s.shot = await this.capture(view, size);
      return s;
    },
    sample() {
      model.updateMatrixWorld(true);
      const soles = shoes.map((s) => {
        const pos = s.geometry.getAttribute('position');
        const verts = [];
        let cx = 0, cz = 0, top = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          tmp.fromBufferAttribute(pos, i).applyMatrix4(s.matrixWorld);
          verts.push(+tmp.x.toFixed(4), +tmp.y.toFixed(4), +tmp.z.toFixed(4));
          cx += tmp.x; cz += tmp.z; top = Math.max(top, tmp.y);
        }
        // the ground under the sole's centre, as a plane (its normal), so a foot flat on a slope
        // reads as on the ground, not half in it
        const hit = e.physics.castRay(new V(cx / pos.count, top + 0.3, cz / pos.count), down, 3, noTags, hero.body);
        // (a ray that starts inside something, e.g. a tree trunk the foot is in, finds no floor)
        if (!hit || hit.normal.y < 0.3 || hit.distance < 0.01) return { verts, ground: null, h: null };
        const n = hit.normal, p = hit.point;
        const h = [];
        for (let i = 0; i < verts.length; i += 3) h.push(+(verts[i + 1] - (p.y - (n.x * (verts[i] - p.x) + n.z * (verts[i + 2] - p.z)) / n.y)).toFixed(4));
        return { verts, ground: +p.y.toFixed(4), h };
      });
      return {
        frame: e.frame, state: hero.state, anim: hero.anim, grounded: hero.grounded,
        mix: hero.animationMix().map((m) => ({ ...m, weight: +m.weight.toFixed(3), time: +m.time.toFixed(3), rate: +m.rate.toFixed(3) })),
        feet: hero.feet.toArray().map((v) => +v.toFixed(3)), vy: +hero.vy.toFixed(3), speed: +hero.speed.toFixed(3), yaw: +((model.rotation.y * 180) / Math.PI).toFixed(1), my: +model.position.y.toFixed(3),
        fp: hero.footPlacement ? hero.footPlacement() : null,
        q: joints.map((j) => j.quaternion.toArray().map((v) => +v.toFixed(5))),
        soles,
      };
    },
    async capture(view, size) {
      // the pass picks up a new camera on its next render: warm it up once
      if (!this.warm && view !== 'game') { this.warm = true; await this.capture(view, size); }
      const mid = model.position.clone(); mid.y += 0.55;
      let c = gameCam;
      if (view !== 'game') {
        const yaw = model.rotation.y;
        const f = new V(Math.sin(yaw), 0, Math.cos(yaw));
        const r = new V(-Math.cos(yaw), 0, Math.sin(yaw));
        const dir = { side: r, front: f, back: f.clone().negate(), three: f.clone().add(r.clone().multiplyScalar(0.9)) }[view] || r;
        const d = cam.isPerspectiveCamera ? (size / 2) / Math.tan((cam.fov * Math.PI) / 360) : 20;
        cam.position.copy(mid).addScaledVector(dir.normalize(), d);
        cam.position.y += d * 0.12;
        cam.lookAt(mid);
        cam.updateMatrixWorld(true);
        c = cam;
        e.renderer.setCamera(cam);
      }
      const shot = await e.renderer.capture();
      if (c !== gameCam) e.renderer.setCamera(gameCam);
      // crop a square around the hero, sampled on the art-pixel grid in pixel mode
      const W = shot.width, H = shot.height;
      const px = (p) => { const v = p.clone().project(c); return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]; };
      const up = new V(0, 1, 0).applyQuaternion(c.quaternion);
      const centre = px(mid);
      const half = view === 'game' ? Math.abs(px(mid.clone().addScaledVector(up, 1.1))[1] - centre[1]) : Math.abs(px(mid.clone().addScaledVector(up, size / 2))[1] - centre[1]);
      const pixel = e.renderer.mode === 'pixel';
      const stride = pixel ? e.renderer.framing.scale : Math.max(1, Math.floor((2 * half) / 240));
      const n = Math.max(8, Math.round((2 * half) / stride));
      const out = new Uint8Array(n * n * 4);
      const x0 = centre[0] - (n * stride) / 2, y0 = centre[1] - (n * stride) / 2;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let sx = x0 + (x + 0.5) * stride, sy = y0 + (y + 0.5) * stride;
        if (pixel) { sx = Math.floor(sx / stride) * stride + stride / 2; sy = Math.floor(sy / stride) * stride + stride / 2; }
        sx = Math.floor(sx); sy = Math.floor(sy);
        const o = (y * n + x) * 4;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) { out[o] = 20; out[o + 1] = 22; out[o + 2] = 30; out[o + 3] = 255; continue; }
        const i = (sy * W + sx) * 4;
        out[o] = shot.pixels[i]; out[o + 1] = shot.pixels[i + 1]; out[o + 2] = shot.pixels[i + 2]; out[o + 3] = 255;
      }
      let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      return { size: n, b64: btoa(s) };
    },
  };
})();
true;
`;

interface Sample {
  frame: number;
  state: string;
  anim: string;
  grounded: boolean;
  mix: { name: string; weight: number; time: number; rate: number }[];
  feet: [number, number, number];
  /** The model's facing (degrees) and height (the drawn body: hops and lunges lift it). */
  yaw: number;
  my: number;
  vy: number;
  speed: number;
  q: number[][];
  /** Per sole: world vertices (x, y, z…), ground height under its centre, each vertex's height above that ground's plane. */
  soles: { verts: number[]; ground: number | null; h: number[] | null }[];
  /** Foot placement this frame (PlatformerCharacter.footPlacement()). */
  fp: { weight: number; drop: number; feet: { side: string; offset: number; pitch: number; locked: boolean; stepping: boolean; correction: number; height: number }[] } | null;
}
interface Shot {
  size: number;
  data: Uint8Array;
}
interface Rec {
  t: number;
  s: Sample;
  shot?: Shot;
}

async function main(): Promise<void> {
  for (const j of jobs) parse(j.script); // fail fast on typos
  const server = await startServer();
  const exe = chromiumPath();
  const webgpu = flags.has('webgpu');
  const browser = await chromium.launch({
    executablePath: exe,
    headless: !process.env.DISPLAY,
    args: webgpu
      ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-fallback-to-gl-for-testing']
      : ['--disable-features=WebGPU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    // Pixel mode: a canvas of exactly the internal resolution (480×270, 1 device pixel per
    // art pixel) is the cheapest to render and read back, and loses nothing.
    const raw = opt('mode', 'pixel') === 'raw';
    const page = await browser.newPage({ viewport: raw ? { width: 960, height: 540 } : { width: 480, height: 270 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // The game's iso camera turned to yaw 0, so the keys move along the axes as scripts
    // assume (W = -Z, D = +X); at its default 45° yaw they ran diagonally.
    const q = new URLSearchParams({ debug: '0', touch: '0', cam: JSON.stringify({ preset: 'iso', yaw: 0 }) });
    // --game picks the level (?game=); arena-* scenarios pick the combat arena themselves; the
    // rest film the playground (/ is Riftlight)
    const game = flags.has('game') ? opt('game', '') : (jobs.map((j) => SCENARIO_GAME(j.name)).find((g) => g) ?? 'playground');
    q.set('game', game);
    if (flags.has('mode')) q.set('mode', opt('mode', 'pixel'));
    if (flags.has('look')) q.set('look', opt('look', ''));
    const t0 = Date.now();
    const log = (m: string) => flags.has('verbose') && console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
    page.on('console', (m) => flags.has('verbose') && console.log(`  [page] ${m.text()}`));
    // The dev server may still be bundling dependencies on the first load; retry once.
    for (let attempt = 0; ; attempt++) {
      errors.length = 0;
      await page.goto(`http://localhost:${PORT}/?${q}`);
      log('page loaded');
      const ok = await page
        .waitForFunction(() => (window as unknown as { __PIXEL_ENGINE__?: { game: { hero?: unknown } } }).__PIXEL_ENGINE__?.game.hero, null, { timeout: 60000 })
        .then(() => true)
        .catch(() => false);
      if (ok && !errors.length) break;
      if (attempt === 1) throw new Error(`game did not start:\n${errors.join('\n')}`);
      log('game did not start, reloading');
    }
    log('game ready');
    await page.evaluate(PAGE);
    const joints = (await page.evaluate('__FILM.joints')) as string[];
    log(`${joints.length} joints`);
    for (const job of jobs) {
      const { recs, stuck } = await film(page, parse(job.script), log);
      report(job.name, job.script, recs, joints, stuck);
      if (stuck.length) failed.push(`${job.name}: ${stuck.map((i) => i.text).join('; ')}`);
    }
  } finally {
    await browser.close();
    stop(server);
  }
}

function stop(proc: ChildProcess): void {
  try {
    process.kill(-proc.pid!, 'SIGTERM');
  } catch {
    proc.kill();
  }
}

async function film(page: Page, cmds: Cmd[], log: (m: string) => void): Promise<{ recs: Rec[]; stuck: Issue[] }> {
  const recs: Rec[] = [];
  // `until` commands that gave up: the scenario never reached the state it was written for
  const stuck: Issue[] = [];
  const size = Number(opt('size', '2.8'));
  {
    let t = 0;
    let recording = false;
    const frame = async () => {
      const s = (await page.evaluate(`__FILM.frame(${t % every === 0 ? JSON.stringify(view) : 'null'}, ${size})`)) as Sample & { shot?: { size: number; b64: string } };
      const rec: Rec = { t, s };
      if (s.shot) rec.shot = { size: s.shot.size, data: Uint8Array.from(Buffer.from(s.shot.b64, 'base64')) };
      delete s.shot;
      recs.push(rec);
      if (t % 20 === 0) log(`frame ${t} ${s.state} ${s.anim}`);
      t++;
    };
    for (const c of cmds) {
      if (c.op === 'place') {
        const [x = 0, y = 0, z = 0, yaw = 0] = c.n;
        await page.evaluate(`__FILM.place(${x}, ${y}, ${z}, ${yaw})`);
        recording = true;
        // frame 0: the settled pose
        const s = (await page.evaluate('__FILM.sample()')) as Sample;
        recs.push({ t, s, shot: await capture(page, view, size) });
        t++;
        continue;
      }
      if (!recording) throw new Error('script must start with `place`');
      const set = async (keys: string[], down: boolean) => {
        for (const k of keys) await page.evaluate(`__FILM.key(${JSON.stringify(k)}, ${down})`);
      };
      if (c.op === 'skills') await page.evaluate(`__FILM.skills(${JSON.stringify(c.word)})`);
      else if (c.op === 'weapon') {
        const [kind, two] = c.word.split(/\s+/);
        await page.evaluate(`__FILM.weapon(${JSON.stringify(kind)}, ${two === '2h'})`);
      } else if (c.op === 'hurt') await page.evaluate(`__FILM.hurt(${c.n[0] ?? 0.2}, ${c.n[1] ?? 0}, ${c.n[2] ?? 1})`);
      else if (c.op === 'kill') await page.evaluate('__FILM.kill()');
      else if (c.op === 'down') await set(c.keys, true);
      else if (c.op === 'up') await set(c.keys, false);
      else if (c.op === 'hold') {
        await set(c.keys, true);
        for (let i = 0; i < (c.n[0] ?? 30); i++) await frame();
        await set(c.keys, false);
      } else if (c.op === 'tap') {
        await set(c.keys, true);
        await frame();
        await frame();
        await set(c.keys, false);
        await frame();
      } else if (c.op === 'wait') {
        for (let i = 0; i < (c.n[0] ?? 30); i++) await frame();
      } else if (c.op === 'until') {
        const max = c.n[0] ?? 180;
        for (let i = 0; i < max; i++) {
          await frame();
          const s = recs.at(-1)!.s;
          if (c.word === 'grounded' ? s.grounded : s.state === c.word) break;
          if (i === max - 1) stuck.push({ t: recs.length - 1, kind: 'until', text: `until ${c.word} gave up after ${max} frames (state ${s.state})` });
        }
      }
    }
    await page.evaluate('__FILM.release()');
  }
  return { recs, stuck };
}

async function capture(page: Page, v: string, size: number): Promise<Shot> {
  const r = (await page.evaluate(`__FILM.capture(${JSON.stringify(v)}, ${size})`)) as { size: number; b64: string };
  return { size: r.size, data: Uint8Array.from(Buffer.from(r.b64, 'base64')) };
}

// ---- analysis ------------------------------------------------------------------------------
interface Issue {
  t: number;
  /** `until` = the script waited for a state that never came (the film exits 1). */
  kind: 'pop' | 'slip' | 'sink' | 'float' | 'until';
  text: string;
}

const SOLE_NAMES = ['ShoeR', 'ShoeL'];
/** Drawn red (the rest yellow). */
const SEVERE = new Set<Issue['kind']>(['pop', 'sink', 'until']);
const SLIDING_STATES = new Set(['skid', 'slide', 'bellySlide', 'crouchSlide', 'dive', 'push', 'pull', 'hang', 'climb']);

function analyse(recs: Rec[], joints: string[]) {
  const n = recs.length;
  // joint angular speed (°/s) per frame
  const speed: number[][] = recs.map((r, i) =>
    i === 0 ? joints.map(() => 0) : r.s.q.map((q, j) => {
      const p = recs[i - 1]!.s.q[j]!;
      const dot = Math.min(1, Math.abs(q[0]! * p[0]! + q[1]! * p[1]! + q[2]! * p[2]! + q[3]! * p[3]!));
      return ((2 * Math.acos(dot) * 180) / Math.PI) * 60;
    }),
  );
  const maxSpeed = speed.map((row) => Math.max(...row));
  const issues: Issue[] = [];
  // pops: one-frame spikes, much faster than the frames either side
  for (let i = 1; i < n - 1; i++) {
    joints.forEach((j, k) => {
      const v = speed[i]![k]!;
      const around = Math.max(speed[i - 1]![k]!, speed[i + 1]![k]!);
      if (v > 700 && v > 3 * around) issues.push({ t: i, kind: 'pop', text: `${j} jumps ${(v / 60).toFixed(0)}° in one frame (${mixText(recs[i]!.s)})` });
    });
  }
  // feet vs ground: slip while planted, sinking, floating in grounded states
  const slip: number[] = new Array<number>(n).fill(0);
  /** Per sole (R, L): its planted slip this frame (m/s). */
  const slipBy: [number, number][] = recs.map(() => [0, 0]);
  const gap: number[][] = recs.map((r) => r.s.soles.map((s) => (s.h === null ? NaN : Math.min(...s.h))));
  for (let i = 1; i < n; i++) {
    recs[i]!.s.soles.forEach((sole, k) => {
      const prev = recs[i - 1]!.s.soles[k]!;
      if (sole.h === null || prev.h === null) return;
      let dx = 0;
      let dz = 0;
      let c = 0;
      for (let v = 0; v < sole.verts.length; v += 3) {
        if (sole.h[v / 3]! > 0.015 || prev.h[v / 3]! > 0.015) continue;
        dx += sole.verts[v]! - prev.verts[v]!;
        dz += sole.verts[v + 2]! - prev.verts[v + 2]!;
        c++;
      }
      if (c) {
        slipBy[i]![k] = (Math.hypot(dx, dz) / c) * 60;
        slip[i] = Math.max(slip[i]!, slipBy[i]![k]!);
      }
    });
  }
  const runs = (pred: (i: number) => boolean, kind: Issue['kind'], text: (a: number, b: number) => string) => {
    for (let i = 0; i < n; i++) {
      if (!pred(i)) continue;
      let j = i;
      while (j + 1 < n && pred(j + 1)) j++;
      issues.push({ t: i, kind, text: text(i, j) });
      i = j;
    }
  };
  runs(
    (i) => slip[i]! > 0.5 && !SLIDING_STATES.has(recs[i]!.s.state),
    'slip',
    (a, b) => `planted foot slides up to ${Math.max(...slip.slice(a, b + 1)).toFixed(2)} m/s, f${a}-${b} (${recs[a]!.s.state}: ${mixText(recs[a]!.s)})`,
  );
  runs(
    (i) => Math.min(...gap[i]!.filter((v) => !Number.isNaN(v))) < -0.03,
    'sink',
    (a, b) => `foot ${(-Math.min(...gap.slice(a, b + 1).flat().filter((v) => !Number.isNaN(v))) * 100).toFixed(0)} cm into the ground, f${a}-${b} (${recs[a]!.s.state}: ${mixText(recs[a]!.s)})`,
  );
  runs(
    (i) => {
      const s = recs[i]!.s;
      const ok = gap[i]!.filter((v) => !Number.isNaN(v));
      // runs and jumps have flight phases; standing, walking and crouching never leave the floor
      return s.grounded && ['idle', 'walk', 'crouch', 'crouchWalk', 'teeter', 'push', 'pull', 'sit'].includes(s.state) && ok.length === 2 && Math.min(...ok) > 0.04;
    },
    'float',
    (a, b) => `both feet >= 4 cm above the ground while ${recs[a]!.s.state}, f${a}-${b} (up to ${(Math.max(...gap.slice(a, b + 1).map((g) => Math.min(...g))) * 100).toFixed(0)} cm)`,
  );
  issues.sort((a, b) => a.t - b.t);
  return { speed, maxSpeed, slip, slipBy, gap, issues };
}

/** Compact foot placement: weight, pelvis drop, then per foot: animated height, offset, pitch, L(ocked) S(tepping), correction. */
function footText(fp: Sample['fp']): string | null {
  if (!fp || fp.weight <= 0) return null;
  const foot = (f: NonNullable<Sample['fp']>['feet'][number]) => `${f.side} h${(f.height * 100).toFixed(1)} ${(f.offset * 100).toFixed(1)}cm ${f.pitch.toFixed(0)}° ${f.locked ? 'L' : ''}${f.stepping ? 'S' : ''} ${(f.correction * 100).toFixed(0)}cm`;
  return `w${fp.weight.toFixed(2)} drop ${(fp.drop * 100).toFixed(0)}cm | ${fp.feet.map(foot).join(' | ')}`;
}


function mixText(s: Sample): string {
  if (s.mix.length <= 1) return s.mix[0] ? `${s.mix[0].name}${Math.abs(s.mix[0].rate - 1) > 0.02 ? ` x${s.mix[0].rate.toFixed(2)}` : ''}` : s.anim;
  return s.mix
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((m) => `${m.name} ${(m.weight * 100).toFixed(0)}%`)
    .join(' + ');
}

// ---- output --------------------------------------------------------------------------------
function report(name: string, script: string, recs: Rec[], joints: string[], stuck: Issue[]): void {
  mkdirSync(outDir, { recursive: true });
  const a = analyse(recs, joints);
  a.issues.push(...stuck);
  a.issues.sort((p, q) => p.t - q.t);
  const shots = recs.filter((r) => r.shot);

  // console summary: state / clip timeline
  console.log(`film ${name}: ${recs.length} frames (${(recs.length / 60).toFixed(2)} s at 60 fps), view ${view}, ${shots.length} images`);
  console.log('timeline:');
  for (let i = 0; i < recs.length; i++) {
    let j = i;
    while (j + 1 < recs.length && recs[j + 1]!.s.state === recs[i]!.s.state && recs[j + 1]!.s.anim === recs[i]!.s.anim) j++;
    const blendEnds = recs.slice(i, j + 1).findIndex((r) => r.s.mix.length <= 1);
    const blend = recs[i]!.s.mix.length > 1 ? `  blend ${mixText(recs[i]!.s)} → settles by f${blendEnds < 0 ? j : i + blendEnds}` : '';
    const rate = recs[j]!.s.mix.find((m) => m.name === recs[j]!.s.anim)?.rate;
    console.log(`  f${String(i).padEnd(4)}-${String(j).padEnd(4)} ${recs[i]!.s.state.padEnd(12)} ${recs[i]!.s.anim}${rate && Math.abs(rate - 1) > 0.02 ? ` x${rate.toFixed(2)}` : ''}${blend}`);
    i = j;
  }
  const peak = a.maxSpeed.reduce((m, v, i) => (v > a.maxSpeed[m]! ? i : m), 0);
  console.log(`fastest joint motion: ${a.maxSpeed[peak]!.toFixed(0)}°/s at f${peak} (${recs[peak]!.s.state}: ${mixText(recs[peak]!.s)})`);
  if (a.issues.length) {
    console.log('issues:');
    for (const i of a.issues.slice(0, 40)) console.log(`  f${String(i.t).padEnd(4)} ${i.kind.padEnd(5)} ${i.text}`);
    if (a.issues.length > 40) console.log(`  … ${a.issues.length - 40} more in the json`);
  } else console.log('issues: none (no pops, foot slip, sinking or floating feet)');

  // filmstrip
  const cols = Number(opt('cols', '12'));
  const maxCells = 72;
  const pick = shots.length > maxCells ? shots.filter((_, i) => i % Math.ceil(shots.length / maxCells) === 0) : shots;
  const art = Math.max(...pick.map((r) => r.shot!.size));
  const zoom = Math.max(1, Math.floor(150 / art));
  const cell = art * zoom;
  const labelH = 3 * (GLYPH_H + 2) + 2;
  const M = 8;
  const rows = Math.ceil(pick.length / cols);
  const plotW = cols * (cell + 4) - 4;
  const timelineH = 4 * 56 + 5 * (GLYPH_H + 6) + 30;
  const headerH = 2 * GLYPH_H + 16 + 4;
  const issueLines = a.issues.slice(0, 16);
  const width = M * 2 + Math.max(plotW, 640);
  const height = M * 2 + headerH + rows * (cell + labelH + 4) + timelineH + (issueLines.length + 1) * (GLYPH_H + 3) + 8;
  const cv = new Canvas(width, height);
  cv.text(`FILM ${name}`, M, M, TEXT, 2);
  cv.text(`VIEW ${view.toUpperCase()}  ${recs.length} FRAMES @60  ONE CELL EVERY ${Math.round((pick[1]?.t ?? every) - (pick[0]?.t ?? 0))} FRAMES  RED BORDER = POP/SINK/UNTIL  YELLOW = SLIP/FLOAT`, M, M + 2 * GLYPH_H + 4, DIM);
  const flagged = new Map<number, Issue['kind']>();
  for (const i of a.issues) {
    const cellIdx = pick.findIndex((r, k) => i.t >= r.t && i.t < (pick[k + 1]?.t ?? Infinity));
    if (cellIdx < 0) continue;
    const prev = flagged.get(cellIdx);
    if (!prev || SEVERE.has(i.kind)) flagged.set(cellIdx, i.kind);
  }
  pick.forEach((r, k) => {
    const x = M + (k % cols) * (cell + 4);
    const y = M + headerH + Math.floor(k / cols) * (cell + labelH + 4);
    const shot = r.shot!;
    const off = Math.floor((art - shot.size) / 2);
    for (let py = 0; py < shot.size; py++)
      for (let pxl = 0; pxl < shot.size; pxl++) {
        const i = (py * shot.size + pxl) * 4;
        cv.rect(x + (pxl + off) * zoom, y + (py + off) * zoom, zoom, zoom, [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!]);
      }
    const flag = flagged.get(k);
    if (flag) {
      const c = SEVERE.has(flag) ? BAD : WARN;
      cv.rect(x - 2, y - 2, cell + 4, 2, c);
      cv.rect(x - 2, y + cell, cell + 4, 2, c);
      cv.rect(x - 2, y, 2, cell, c);
      cv.rect(x + cell, y, 2, cell, c);
    }
    const fit = (s: string) => (textWidth(s) > cell ? s.slice(0, Math.floor(cell / 6)) : s);
    cv.text(fit(`F${r.t} ${r.s.state}`), x, y + cell + 3, TEXT);
    const mix = r.s.mix.slice().sort((p, q) => q.weight - p.weight);
    cv.text(fit(mix[0] ? mix[0].name : r.s.anim), x, y + cell + 3 + GLYPH_H + 2, DIM);
    if (mix.length > 1) cv.text(fit(`<${mix[1]!.name} ${(mix[1]!.weight * 100).toFixed(0)}%`), x, y + cell + 3 + 2 * (GLYPH_H + 2), WARN);
  });

  // timeline: state bands, then speed, joint speed, foot height, foot slip
  let y = M + headerH + rows * (cell + labelH + 4) + 6;
  const x0 = M;
  const tw = width - 2 * M;
  const xOf = (t: number) => x0 + (t / Math.max(1, recs.length - 1)) * (tw - 1);
  const bandH = GLYPH_H + 6;
  const palette: RGB[] = [[88, 110, 190], [70, 150, 120], [170, 110, 70], [140, 90, 160], [60, 140, 170], [160, 150, 70]];
  const colours = new Map<string, RGB>();
  const band = (key: (s: Sample) => string, label: string) => {
    cv.text(label, x0, y, DIM);
    y += GLYPH_H + 2;
    for (let i = 0; i < recs.length; i++) {
      let j = i;
      while (j + 1 < recs.length && key(recs[j + 1]!.s) === key(recs[i]!.s)) j++;
      const k = key(recs[i]!.s);
      if (!colours.has(k)) colours.set(k, palette[colours.size % palette.length]!);
      const xa = Math.round(xOf(i));
      const xb = Math.round(xOf(j + 1 === recs.length ? j : j + 1));
      cv.rect(xa, y, Math.max(1, xb - xa), bandH - 2, colours.get(k)!);
      if (xb - xa > textWidth(k) + 4) cv.text(k, xa + 2, y + 2, TEXT);
      i = j;
    }
    y += bandH + 2;
  };
  band((s) => s.state, 'STATE');
  band((s) => s.anim, 'CLIP (DOMINANT)');
  const plot = (label: string, series: { values: number[]; color: RGB }[], unit: (v: number) => string, lo0?: number, threshold?: number, marks?: number[]) => {
    const h = 56;
    cv.text(label, x0, y, DIM);
    y += GLYPH_H + 2;
    const all = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
    let lo = Math.min(...all, lo0 ?? Infinity);
    let hi = Math.max(...all, threshold ?? -Infinity);
    if (hi - lo < 1e-6) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const yOf = (v: number) => y + h - 1 - ((v - lo) / (hi - lo)) * (h - 1);
    cv.rect(x0, y, tw, h, CELL_BG);
    if (lo < 0 && hi > 0) for (let i = 0; i < tw; i++) cv.set(x0 + i, Math.round(yOf(0)), GROUND);
    if (threshold !== undefined) for (let i = 0; i < tw; i += 2) cv.set(x0 + i, Math.round(yOf(threshold)), BAD, 0.7);
    for (const p of pick) for (let i = 0; i < h; i += 4) cv.set(Math.round(xOf(p.t)), y + i, GRID);
    for (const s of series)
      for (let i = 1; i < s.values.length; i++) {
        const va = s.values[i - 1]!;
        const vb = s.values[i]!;
        if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
        cv.line(xOf(i - 1), yOf(va), xOf(i), yOf(vb), s.color, 1, 2);
      }
    for (const m of marks ?? []) cv.rect(Math.round(xOf(m)) - 1, y + h - 5, 3, 5, BAD);
    cv.text(unit(hi), x0 + tw - textWidth(unit(hi)) - 2, y + 2, DIM);
    cv.text(unit(lo), x0 + tw - textWidth(unit(lo)) - 2, y + h - GLYPH_H - 1, DIM);
    y += h + 4;
  };
  plot('GROUND SPEED (M/S) AND HEIGHT OF FEET POSITION (M, GREY)', [
    { values: recs.map((r) => r.s.speed), color: CONTACT },
    { values: recs.map((r) => r.s.feet[1]), color: [150, 156, 180] },
  ], (v) => v.toFixed(1), 0);
  plot('FASTEST JOINT (°/S), RED TICKS = POPS', [{ values: a.maxSpeed, color: TEXT }], (v) => v.toFixed(0), 0, undefined, a.issues.filter((i) => i.kind === 'pop').map((i) => i.t));
  plot('SOLE HEIGHT ABOVE GROUND (CM): R ORANGE, L CYAN', SOLE_NAMES.map((_, k) => ({ values: a.gap.map((g) => g[k]! * 100), color: k ? LEFT : RIGHT })), (v) => `${v.toFixed(0)}`, 0);
  plot('PLANTED-FOOT SLIP (M/S)', [{ values: a.slip, color: WARN }], (v) => v.toFixed(1), 0, 0.5);
  y += 4;
  cv.text(a.issues.length ? `ISSUES (${a.issues.length}):` : 'NO ISSUES', x0, y, a.issues.length ? WARN : CONTACT);
  y += GLYPH_H + 3;
  for (const i of issueLines) {
    cv.text(`F${i.t} ${i.kind.toUpperCase()} ${i.text}`.slice(0, Math.floor(tw / 6)), x0, y, SEVERE.has(i.kind) ? BAD : WARN);
    y += GLYPH_H + 3;
  }

  const base = join(outDir, name);
  writeFileSync(`${base}.png`, encodePng({ width, height, data: cv.data }));
  writeFileSync(
    `${base}.json`,
    JSON.stringify({
      name,
      script,
      view,
      joints,
      issues: a.issues,
      frames: recs.map((r, i) => ({ t: r.t, state: r.s.state, anim: r.s.anim, mix: r.s.mix, feet: r.s.feet, yaw: r.s.yaw, modelY: r.s.my, speed: r.s.speed, vy: r.s.vy, grounded: r.s.grounded, maxJointSpeed: Math.round(a.maxSpeed[i]!), slip: +a.slip[i]!.toFixed(3), slipRL: a.slipBy[i]!.map((v) => +v.toFixed(2)), soleGap: a.gap[i]!.map((g) => +g.toFixed(3)), footPlacement: footText(r.s.fp) })),
    }),
  );
  const written = [`${base}.png`, `${base}.json`];
  if (flags.has('gif')) {
    const size = Math.max(...shots.map((r) => r.shot!.size));
    const frames = shots.map((r) => {
      const d = new Uint8Array(size * size * 4);
      const s = r.shot!;
      const off = Math.floor((size - s.size) / 2);
      for (let y2 = 0; y2 < s.size; y2++) d.set(s.data.subarray(y2 * s.size * 4, (y2 + 1) * s.size * 4), ((y2 + off) * size + off) * 4);
      return { width: size, height: size, data: d };
    });
    writeFileSync(`${base}.gif`, encodeGif(frames, (every * 100) / 60, Math.max(1, Math.floor(360 / size))));
    written.push(`${base}.gif`);
  }
  console.log(`wrote ${written.map((f) => f.replace(`${ROOT}/`, '')).join(', ')}`);
}

// ---- infrastructure -------------------------------------------------------------------------
async function startServer(): Promise<ChildProcess> {
  const args = flags.has('preview') ? ['vite', 'preview', '--port', String(PORT), '--strictPort'] : ['vite', '--port', String(PORT), '--strictPort'];
  // detached: its own process group, so stop() takes down npx *and* vite
  const proc = spawn('npx', args, { cwd: ROOT, stdio: 'ignore', detached: true, env: { ...process.env, FILM: '1' } });
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  stop(proc);
  throw new Error('vite did not start');
}

function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const last = readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
    if (last) return `/opt/pw-browsers/${last}/chrome-linux/chrome`;
  } catch {
    /* fall through */
  }
  return undefined;
}

main().then(
  () => {
    if (!failed.length) process.exit(0);
    console.error(`\nFAILED: ${failed.length} scenario(s) never reached a state they wait for:\n  ${failed.join('\n  ')}`);
    process.exit(1);
  },
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
