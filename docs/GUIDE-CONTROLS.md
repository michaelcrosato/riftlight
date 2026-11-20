# Pixel Engine: controls, devices and 52in1

The standard every game on the kit meets, and the engine parts that do most of it; 52in1 is the
hub that runs the games.

## 1. The checklist

- [ ] **Controller first, at ten feet.** Every action, menus included, plays on any standard pad,
  the DualSense first: a pad button beside each key (`isDown('Space', 'PadA')`), Options
  (`PadStart`) pauses, Circle (`PadB`) goes back. PS and Create + Options together are 52in1's
  bar (`HOST_CHORD`): the engine never reads PS, and presses Options (or Create) as it is let go,
  never under the chord, so no pause opens behind the bar.
- [ ] **Keyboard and mouse native for the genre**: WASD and the mouse to aim in a shooter, WASD or
  the arrows and Space in a platformer, clicks in a strategy game; never the pad's layout on keys.
- [ ] **Prompts follow the device used last** (`input.device`: `'keyboard'`, `'pad'`, `'touch'`),
  never a fixed "Press Space": a `controls` table, `{key:action}` in lines, `hud.prompt`,
  `hud.legend`, `hud.glyph` (PlayStation's buttons, or Xbox's if the player chose them).
- [ ] **No dense web-style screens.** One choice per large row, a few at a time, a focus the d-pad
  moves, a legend of the buttons; no hover-only controls, small links, forms, or lists only a
  scroll bar moves: `MenuInput` and `FocusList` (section 3). Text at ten feet: capitals ≥ 1/40
  of the screen's height (`scale: 1` on 270 rows: 28 px at 1080p).
- [ ] **Touch is an add-on.** A phone held either way plays it, the stick and a button at once;
  the controls step aside while a pad or keys are used and come back on the next touch. A swipe
  dismisses, an action's button shows when there is something to do, and touch gets assists.
- [ ] **The whole window at every shape.** `aspect: 'fill'` (the default) reaches every edge at
  16:9, 21:9, 4:3 and a phone's; lay the HUD out from `ctx.hud.width` / `height`, never 480 × 270.
- [ ] **The player's 52in1 settings.** Volumes and vibration apply by themselves; a DualSense's
  extras where they fit (light bar, rumble, triggers, touchpad, motion aim, speaker), each adding
  to a control that works without it; the microphone only once 52in1 allows it.
- [ ] **Together.** Every online mode it can support (parallel at least; ghost, a shared world,
  moments) on one page, and play on one device in its own menu (section 7).
- [ ] **The head says so**, 52in1's catalogue (section 6): `<title>`, `description`, `theme-color`,
  a `data:image` icon, `hub:catalogue`, `hub:type`, `hub:genre`, `hub:tags`, `hub:controls`,
  `hub:model`, `hub:effort`, `hub:harness`, `hub:session`, `hub:dualsense`, `hub:multiplayer`,
  `hub:moment`, the `game-lines` block.
- [ ] **Storage of its own.** 52in1's games share one origin: keys under your game's prefix,
  removed only by you (never `clear()`), never `ai-hub:`.
- [ ] **Checked on each device**, PNGs looked at (`node check.mjs`, GUIDE.md section 8): a pad
  (`--keys PadLStick:1,0*60,PadDown*8,PadA*9`), the mouse (`--keys Mouse@240,120*5,MouseLeft@240,150*3`),
  a phone each way (`"index.html?touch=1"`, `--size 390x844`, `844x390`), 21:9 (`--size 2100x900`).

## 2. Controls as data, prompts for the device in use

A game's `controls` (`Game.controls`, read at each level) names each action's key, pad button
and touch button; `{key:action}` in a line (`lang.t`), `hud.prompt`, `hud.legend` and
`hud.glyph` show the one in use. Read input by codes (`consumePress('KeyE', 'PadA')` in
`fixedUpdate`): a touch button presses its key code (`touchButtons`).

Pad codes: `PadA` Cross / A · `PadB` Circle / B · `PadX` Square / X · `PadY` Triangle / Y ·
`PadLB` `PadRB` L1 R1 · `PadLT` `PadRT` L2 R2 · `PadBack` Create / View · `PadStart` Options /
Menu · `PadL3` `PadR3` · `PadTouchpad` (its click); the d-pad presses the arrows. Prompts
also draw `PadLStick`, `PadRStick`, `DPad`. A table's `key` may name several (`WASD`, `Arrows`);
its `touch` is a button's label or a gesture (`TouchTap`, `TouchSwipe`, `TouchStick`).

Beacon Yard plays on all three: Options opens a pause menu with the engine's settings, LIGHT
shows only by a dark beacon (`examples/beacon-yard.html`):

```js beacon-yard
// Beacon Yard: light the four beacons on a pad, the keyboard or touch. Options / Esc / ≡ pause.
import { Engine, FocusList, langFor, MenuInput, PALETTE, THREE, toonMaterial, withUrlOptions, wrapText } from './pixel-engine.js';

const { BoxGeometry, CylinderGeometry, Mesh, Vector3 } = THREE;

/** Every word a line; `{key:action}` names the control in use. */
const lang = langFor({ version: 1, language: 'en', lines: { 'help.walk': '{key:move}: walk, {key:use}: light a beacon', 'menu.resume': 'Resume', 'menu.settings': 'Settings', 'menu.restart': 'Restart' } });
const ROWS = ['menu.resume', 'menu.settings', 'menu.restart'];
const SPOTS = [[-6, -4], [6, -4], [-6, 4], [6, 4]];
/** Touch: the stick, LIGHT, a pause button (each presses its key). */
const TOUCH = [{ label: 'LIGHT', code: 'KeyE' }, { label: '≡', code: 'Escape', at: { x: 34, y: 34, size: 48, corner: 'top-right' } }];

class BeaconYard {
  name = 'Beacon Yard';
  controls = {
    move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' },
    use: { key: 'KeyE', pad: 'PadA', touch: 'LIGHT' },
    pause: { key: 'Escape', pad: 'PadStart', touch: '≡' },
    confirm: { key: 'Enter', pad: 'PadA', touch: 'TouchTap' },
    back: { key: 'Escape', pad: 'PadB', touch: 'TouchSwipe' },
  };
  at = new Vector3(0, 0.6, 0);
  beacons = [];
  near = null;
  menu = null; // the pause menu, while open

  setup(ctx) {
    ctx.engine.sun.intensity = 0.25; // night
    const ground = new Mesh(new BoxGeometry(20, 1, 14), toonMaterial(PALETTE.green));
    ground.position.y = -0.5;
    this.keeper = new Mesh(new BoxGeometry(0.6, 1.2, 0.6), toonMaterial(PALETTE.sand));
    ctx.scene.add(ground, this.keeper);
    for (const [x, z] of SPOTS) {
      const mesh = new Mesh(new CylinderGeometry(0.3, 0.4, 1.4, 6), toonMaterial(PALETTE.slate));
      mesh.position.set(x, 0.7, z);
      ctx.scene.add(mesh);
      this.beacons.push({ mesh, lit: false });
    }
  }

  lit() {
    return this.beacons.filter((l) => l.lit).length;
  }

  fixedUpdate(ctx, dt) {
    if (this.menu) return; // paused: nothing moves
    const m = ctx.input.moveAxis(); // keys, a stick or the touch stick (up is -z)
    this.at.x = Math.max(-9, Math.min(9, this.at.x + m.x * 5 * dt));
    this.at.z = Math.max(-6, Math.min(6, this.at.z - m.y * 5 * dt));
    this.near = this.beacons.find((l) => !l.lit && l.mesh.position.distanceTo(this.at) < 1.6) ?? null;
    if (this.near && ctx.input.consumePress('KeyE', 'PadA')) this.light(ctx, this.near);
  }

  light(ctx, beacon) {
    beacon.lit = true;
    beacon.mesh.material = toonMaterial(PALETTE.orange);
    const { x, z } = beacon.mesh.position;
    ctx.lights.request({ position: [x, 1.6, z], color: 0xffa040, intensity: 5, radius: 5, flicker: 'torch' });
    ctx.audio.play('coin');
    ctx.input.rumble({ strong: 0.2, weak: 0.6, ms: 120 }); // a pulse on the pad in use
    ctx.dualsense.light(this.lit() === SPOTS.length ? PALETTE.lime : PALETTE.orange); // the light bar: how far along
  }

  update(ctx, dt) {
    const { hud, input } = ctx;
    this.keeper.position.copy(this.at);
    const opening = !this.menu && input.wasPressed('Escape', 'PadStart');
    if (opening) {
      this.menu = { input: new MenuInput({ keys: ['PadStart'] }), list: new FocusList(ROWS.length) };
      input.release(); // the press that opened it never acts in it
    }
    ctx.engine.touch?.show(!this.menu); // no stick, zone or button over the menu
    ctx.engine.touch?.set('KeyE', { hidden: !this.near }); // only when there is something to light
    hud.clear();
    if (this.menu) return this.updateMenu(ctx, opening ? [] : this.menu.input.events(input, dt));
    const touch = ctx.engine.touch?.visible; // its controls show
    const big = hud.width < 160 ? 1 : 2; // big text, smaller on a narrow HUD
    hud.text(6, 6, `BEACONS ${this.lit()}/${SPOTS.length}`, { color: 'sand' });
    if (!touch) hud.prompt(6, 16, 'pause', 'MENU'); // touch: the ≡
    if (this.lit() === SPOTS.length) return void hud.text(0, 28, 'ALL LIT!', { anchor: 'top', scale: big });
    // a long line wrapped clear of the ≡
    wrapText(lang.t('help.walk'), hud.width - (touch ? 48 : 12)).forEach((line, i) => hud.text(6, (touch ? 18 : 28) + i * 10, line));
    if (this.near && !touch) hud.prompt(hud.width / 2, hud.height - 24, 'use', 'LIGHT', { align: 'center', scale: big }); // touch: the LIGHT button
  }

  /** Big rows, a focus, a legend: the d-pad or stick, a click, a tap; Circle, Esc, Options or a swipe closes. */
  updateMenu(ctx, events) {
    const { hud, input } = ctx;
    const w = Math.min(160, hud.width - 16);
    const k = hud.width < 160 ? 1 : 2; // smaller on a narrow HUD
    const rects = ROWS.map((_, i) => ({ x: Math.floor((hud.width - w) / 2), y: Math.floor(hud.height / 2) - 40 + i * 28, w, h: 22 }));
    const r = this.menu.list.update(events, input, hud, rects);
    if (r.moved) ctx.audio.play('step');
    if (r.confirm === 1) ctx.engine.settings.open(); // the engine's settings panel
    if (r.confirm === 2) return void ctx.engine.loadGame(createGame());
    if (r.back || r.confirm === 0 || events.some((e) => e.kind === 'key')) {
      this.menu = null;
      input.release(); // what closed it never acts in the game
      return void input.clearQueued();
    }
    rects.forEach((b, i) => {
      const on = i === this.menu.list.index;
      const text = lang.t(ROWS[i]);
      const size = hud.measure(text, k);
      hud.rect(b.x, b.y, b.w, b.h, on ? 'sand' : 'navy');
      hud.text(b.x + Math.floor((b.w - size.width) / 2), b.y + Math.floor((b.h - size.height) / 2), text, { color: on ? 'ink' : 'white', scale: k, shadow: false });
    });
    const legend = [['confirm', 'SELECT'], ['back', 'BACK']];
    while (hud.legendWidth(legend) > hud.width - 12) legend.pop(); // what fits
    hud.legend(Math.floor(hud.width / 2), hud.height - 14, legend, { align: 'center' });
  }

  cameraTarget() {
    return this.at;
  }

  status(ctx) {
    return `beacons ${this.lit()}/${SPOTS.length}, ${ctx.input.device}${this.menu ? ', menu' : ''}`;
  }
}

/** A fresh game: the page starts one, `node check.mjs --headless` plays one. */
export const createGame = () => new BeaconYard();

if (typeof document !== 'undefined') await Engine.start(createGame(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'topdown', minWidth: 14 }, settings: { button: false }, touchButtons: TOUCH, touchStick: 'floating', touchDensity: 2 }));
```

## 3. Menus at ten feet

`MenuInput` turns the keys, the pad, the left stick and swipes into menu events (a held direction
repeats); `FocusList` keeps a list's focus and takes the pointer (hover, click, tap). Read both in
`update` (only `ctx.input`: a menu replays); call `input.release()` as a menu opens or closes and
`input.clearQueued()` as it closes (GUIDE.md, *Input*). The engine's settings panel works the
same: a pause menu opens it (`ctx.engine.settings.open()`), else Options and Esc do
(`padButton: 'auto'`, off once you read them or `controls` bind them).

## 4. Touch as an add-on

- **Set up** with `touchButtons` (`at` puts one in a corner), `touchStick: 'floating'` and
  `touchDensity: 2` (GUIDE.md, *Starting*).
- **Context buttons**: `ctx.engine.touch?.set('KeyE', { hidden, label, cooldown, badge })` each
  frame from the game's state (`?.`: null headless).
- **Swipes** press `SwipeLeft`, `SwipeRight`, `SwipeUp` or `SwipeDown` (`SWIPE_KEYS`): dismiss a
  dialogue or a card; `FocusList` closes on a sideways one. A panel over a floating stick's zone
  keeps its taps: `ctx.engine.touch?.giveWay(rects)` (CSS px, each frame; `[]` gives it back).
- **Assists** (the nearest target, a longer reach, auto-run) when `ctx.input.device === 'touch'`
  (recorded).
- **Phones both ways**: upright, the art can be 130 columns wide. Keep the play area in view
  (`camera: { minWidth }`, or follow the player) and the HUD clear of the
  controls while they show (`ctx.engine.touch?.visible`, `rects()`, a floating stick's `zone`:
  GUIDE.md, *Starting*); hide them (`ctx.engine.touch?.show(false)`) while a menu or a result owns
  the screen.

## 5. The player's settings and the DualSense

In 52in1 the player sets volumes, vibration and a DualSense's extras once for every game; the
engine applies the volumes (music, effects; never a master) and the hub scales rumble.

```js
Engine.start(game, { settings: { motion: true, voice: true } }); // Motion aim, Microphone, Shout sensitivity rows
ctx.input.rumble({ strong: 0.3, weak: 0.6, ms: 120 }); // the pad in use, × the player's vibration
ctx.dualsense.light(PALETTE.red); // the light bar; null gives it back
ctx.dualsense.trigger('right', { kind: 'weapon', from: 0.3, to: 0.6, strength: 0.8 }); // resist | weapon | vibrate
ctx.dualsense.trigger('right', null); // let it go after
const throttle = ctx.input.triggers.right; // 0..1, every pad's analog trigger
const aim = ctx.input.lookAxis; // the right stick, y up (motion aim adds to it)
ctx.input.touchpad = true; // swipes and taps press PadTouchpadLeft ... Tap
ctx.audio.play('hurt', { bus: 'speaker' }); // from the controller's speaker, else with the rest
ctx.input.voice = true; // a shout presses VOICE_KEYS.shout once 52in1 allows the mic
```

- A button does what a touchpad swipe does. The engine gives the light bar back between levels
  and lets a trigger go while paused.
- Motion, the touchpad and shouts are input: read them through `ctx.input` (recorded), never
  `window.AIHubSettings.dualsense`, `navigator.hid` or `navigator.mediaDevices`.
- A voice feature's row stays off until 52in1 allows the microphone
  (`ctx.engine.hubSettings.micAllowed`; `micLater`: since this game opened, so after a reload).
  Give a shout (`VOICE_KEYS.shout`) a button that does the same; listen only while it does;
  `ctx.input.shoutMeter` draws a meter by the row.

## 6. 52in1 sessions and the head

52in1 deals rounds for up to four friends, a device each. A game joins with
every online mode it can and plays the one the hub picks (`info.mode`): `parallel` (the same start
each, best time or score), `ghost` (the others as ghosts: `session.send`, `RemoteTrack`),
`shared-world` (one world, the host's: `session.finish`), `moments` (three short moments, each a
fresh load). Gem Rush plays parallel and moments, and alone outside 52in1
(`examples/gem-rush.html`):

```js gem-rush
// Gem Rush: grab every gem in time; in 52in1 a parallel round (fastest wins) or a moment a load.
import { Engine, headSession, HubSession, hubEvents, langFor, PALETTE, THREE, toonMaterial, withUrlOptions } from './pixel-engine.js';

const { BoxGeometry, Mesh, OctahedronGeometry, Vector3 } = THREE;
/** Its words (the page's game-lines block, which 52in1 translates). */
export const LINES = { version: 1, language: 'en', lines: { 'hud.gems': 'GEMS {got}/{all}', 'hud.time': 'TIME {left}', 'hud.cleared': 'CLEARED!', 'hud.failed': 'TIME!', 'hud.again': 'AGAIN' }, names: ['Gem Rush'], brief: 'Gems against the clock; short HUD words.' };
const lang = langFor(LINES);

/** Each moment's set-up by its hub:moment id; RUN: a round's, or a run alone. */
export const MOMENTS = { 'gem-dash': { gems: 3, seconds: 8 }, 'gem-hunt': { gems: 6, seconds: 15 }, 'gem-sweep': { gems: 10, seconds: 25 } };
const RUN = { gems: 12, seconds: 60 };

class GemRush {
  name = 'Gem Rush';
  controls = { move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' }, again: { key: 'Space', pad: 'PadA', touch: 'TouchTap' } };
  at = new Vector3(0, 0.4, 0);
  center = new Vector3();
  gems = [];
  got = 0;
  over = null; // 'cleared' or 'failed'
  after = 0; // seconds since it was over

  constructor(session) {
    this.session = session; // null outside 52in1
    this.moment = session?.info.moment ?? null; // the moment this load plays, if any
    this.plan = MOMENTS[this.moment] ?? RUN;
    this.left = this.plan.seconds;
    this.countdown = session ? Infinity : 0; // in a session: still until the hub's start
  }

  setup(ctx) {
    // the same gems on every copy: the session's numbers, else the engine's seed
    const rng = this.session ? this.session.rng(this.moment ?? 'run') : ctx.random;
    const floor = new Mesh(new BoxGeometry(18, 1, 12), toonMaterial(PALETTE.navy));
    floor.position.y = -0.5;
    this.runner = new Mesh(new BoxGeometry(0.6, 0.8, 0.6), toonMaterial(PALETTE.white));
    ctx.scene.add(floor, this.runner);
    for (let i = 0; i < this.plan.gems; i++) {
      const gem = new Mesh(new OctahedronGeometry(0.35), toonMaterial(PALETTE.cyan));
      gem.position.set(rng.range(-8, 8), 0.5, rng.range(-5, 5));
      ctx.scene.add(gem);
      this.gems.push(gem);
    }
  }

  ready(ctx) {
    this.session?.attach(ctx.engine).ready(); // the hub's events arrive as input
  }

  fixedUpdate(ctx, dt) {
    if (this.countdown > 0) return void (this.countdown -= dt);
    if (this.over) return void (this.after += dt);
    const m = ctx.input.moveAxis();
    this.at.x = Math.max(-8.5, Math.min(8.5, this.at.x + m.x * 6 * dt));
    this.at.z = Math.max(-5.5, Math.min(5.5, this.at.z - m.y * 6 * dt));
    for (const gem of this.gems) if (gem.visible && gem.position.distanceTo(this.at) < 0.8) this.grab(ctx, gem);
    this.session?.progress(this.got, 'GEMS'); // the hub's scoreboard, from the start
    this.left -= dt;
    if (this.got === this.gems.length) this.finish(ctx, true);
    else if (this.left <= 0) this.finish(ctx, false);
  }

  grab(ctx, gem) {
    gem.visible = false;
    this.got++;
    ctx.audio.play('coin');
    ctx.input.rumble({ weak: 0.5, ms: 60 });
  }

  /** Cleared or failed: reported once, with the hub's time (real time: the report's, never play's). */
  finish(ctx, won) {
    if (this.over) return;
    this.over = won ? 'cleared' : 'failed';
    ctx.audio.play(won ? 'fanfare' : 'hurt');
    if (this.moment) this.session.result({ won, time: this.session.time() });
    else this.session?.result(won ? { time: this.session.time() } : { score: this.got });
  }

  update(ctx, dt) {
    for (const e of hubEvents(ctx.input.commands)) {
      if (e.type === 'start') this.countdown = e.in / 1000; // counted in game time, so a replay agrees
      else if (e.type === 'time-up') this.finish(ctx, false); // the hub's clock ran out first
    }
    const again = !this.session && this.after > 1; // alone, once over: play again
    if (again && ctx.input.wasPressed('Space', 'PadA', 'Touch')) return void ctx.engine.loadGame(createGame());
    ctx.engine.touch?.show(this.countdown <= 0 && !this.over); // the stick only while it plays
    this.runner.position.copy(this.at);
    for (const gem of this.gems) gem.rotation.y += dt * 3;
    ctx.dualsense.light(this.over || this.left > 3 ? PALETTE.cyan : PALETTE.red); // the light bar: time running out
    const { hud } = ctx;
    hud.clear();
    hud.text(6, 6, lang.t('hud.gems', { got: this.got, all: this.gems.length }), { color: 'cyan' });
    hud.text(6, 16, lang.t('hud.time', { left: Math.ceil(Math.max(0, this.left)) }), { color: this.left > 3 ? 'white' : 'red' }); // clear of the ⚙
    if (this.countdown > 0 && this.countdown < Infinity) hud.text(0, 0, `${Math.ceil(this.countdown)}`, { anchor: 'center', scale: 3, color: 'sand' });
    if (this.over) hud.text(0, 0, lang.t(`hud.${this.over}`), { anchor: 'center', scale: hud.width < 160 ? 1 : 2, color: 'sand' });
    if (again) hud.prompt(hud.width / 2, hud.height / 2 + 14, 'again', lang.t('hud.again'), { align: 'center' });
  }

  cameraTarget() {
    return this.center;
  }

  status() {
    return `gems ${this.got}/${this.gems.length}${this.over ? `, ${this.over}` : ''}`;
  }
}

export const createGame = (session = null) => new GemRush(session);

// In 52in1 (hub:session 1) join the round it picks; elsewhere headSession() is null: alone.
const offer = headSession();
const session = offer && (await HubSession.join({ mode: offer.modes, seats: offer.seats }));
if (typeof document !== 'undefined') await Engine.start(createGame(session), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'topdown', minWidth: 19 }, seed: session?.info.seed, settings: { button: !session, padButton: !session }, touchButtons: [], touchStick: 'floating', touchDensity: 2 }));
```

- **In a session** it opens straight into the round (no title, menu, prompt or ⚙: a round never
  pauses), sets up from `session.rng(label)` (the same on every copy and in a replay), readies up
  by itself, waits still until `start` and counts the countdown in game time.
- **Moments** are short stretches it already has (3 to 30 s), one a load: `info.moment` names it,
  `session.result({ won, time })` reports it once; at `time-up` it is cleared only if its goal is
  to last.
- **Reports**: parallel and ghost `session.progress(score)`, then one `result({ time })` or
  `result({ score })`; a shared world's host one `session.finish({ standings })`.
- **Test without the hub**: a `LocalHub` round (GUIDE.md section 8), then 52in1's harness on the
  built page, every mode.

Its head is 52in1's catalogue (https://52in1.com/lib/hub/catalogue.md), after `<meta charset>`
and the session client: copy both, fill in yours, and hand in the package (three covers) once its
checker passes (https://52in1.com/lib/hub/catalogue-check.mjs):

```html gem-rush
<title>Gem Rush — Grab every gem in time</title>
<meta name="description" content="Grab every gem before the clock runs out, alone or racing friends.">
<meta name="theme-color" content="#73eff7">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'><path d='M1 0 2 1 1 2 0 1z' fill='%2373eff7'/></svg>">
<meta name="hub:catalogue" content="1">
<meta name="hub:type" content="Game">
<meta name="hub:genre" content="Action">
<meta name="hub:tags" content="3d, arcade, top-down, gamepad, touch">
<meta name="hub:controls" content="WASD or arrows to walk; gamepad to play it all; touch to play on a phone">
<meta name="hub:model" content="TBD">
<meta name="hub:effort" content="high">
<meta name="hub:harness" content="Claude Code">
<meta name="hub:dualsense" content="light bar, haptics">
<meta name="hub:session" content="1">
<meta name="hub:session-mode" content="parallel">
<meta name="hub:session-players" content="1-4">
<meta name="hub:session-goal" content="Grab every gem, fastest">
<meta name="hub:session-howto" content="WASD, arrows, a stick or touch to run over the gems">
<meta name="hub:multiplayer" content="parallel 1-4, moments 1-4">
<meta name="hub:moment" content="gem-dash collect 8 Grab three gems in eight seconds">
<meta name="hub:moment" content="gem-hunt collect 15 Grab six gems in fifteen seconds">
<meta name="hub:moment" content="gem-sweep collect 25 Grab all ten gems in time">
<script type="application/json" id="game-lines">{"version":1,"language":"en","lines":{"hud.gems":"GEMS {got}/{all}","hud.time":"TIME {left}","hud.cleared":"CLEARED!","hud.failed":"TIME!","hud.again":"AGAIN"},"names":["Gem Rush"],"brief":"Gems against the clock; short HUD words."}</script>
```

- `hub:model`, `hub:effort`, `hub:harness`: yours (the model as its maker names it, not TBD; its
  effort; your agent tool). `game-lines`: the lines `langFor` gets.
- `gamepad` in `hub:tags` only if it plays fully on a pad, `touch` by touch alone; `hub:dualsense`
  only the extras it uses (`light bar`, `adaptive triggers`, `haptics`, `motion`, `touchpad`,
  `speaker`, `microphone`).

## 7. Several players on one device

`same-screen`, `split-screen` and `hot-seat` are the game's own menu's, named in `hub:multiplayer`
(`split-screen versus 2-4`) and `hub:players`, never a session's. A pad each joins with Cross
(`ctx.input.padPlayers`: GUIDE.md, *Input*); a second keyboard player gets WASD or the arrows.
Split screen gives each a view at every shape; hot-seat a screen between turns.
