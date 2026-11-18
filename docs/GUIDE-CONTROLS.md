# Pixel Engine: controls, devices and 52in1

The standard every game built on the kit meets, and the engine parts that do most of it. Read
`GUIDE.md` first; `API.md` has every signature. Picture the player on a couch, three metres from a
TV, with a controller: they are the first player. The keyboard and mouse player at a desk and the
one on a phone come right after, and 52in1 (the hub that runs the games) gives all three their
settings and friends to play with.

## 1. The checklist

- [ ] **Controller first, at ten feet.** Every action, menus included, plays on any standard pad,
  the DualSense first. Bind a pad button beside each key: `isDown('Space', 'PadA')`. Options
  (`PadStart`) pauses, Circle (`PadB`) goes back. PS (button 16) and Create + Options held together
  open 52in1's bar (`HOST_CHORD`): the engine never reads PS, and presses Options (and Create) as it
  is let go, only when the other never joined it, so a pause never opens behind the bar.
- [ ] **Keyboard and mouse native for the genre**: WASD and the mouse to aim in a shooter, WASD or
  the arrows and Space in a platformer, clicks in a strategy game. Never the pad's layout on keys.
- [ ] **Prompts follow the device used last** (`input.device`: `'keyboard'`, `'pad'` or
  `'touch'`), never a fixed "Press Space": a `controls` table, then `{key:action}` in lines and
  `hud.prompt`, `hud.legend`, `hud.glyph` on the HUD. Pads show PlayStation's buttons unless the
  player chose Xbox's (the settings panel, Controls); the keyboard key caps and mouse buttons;
  touch the touch button.
- [ ] **No dense web-style screens.** One choice per large row (HUD text at `scale: 2`), a few rows
  at a time, a focus the d-pad moves and a legend of the buttons. No hover-only controls, small
  links, forms or scroll boxes: `MenuInput` and `FocusList` (section 3).
- [ ] **Touch is an add-on.** It plays on a phone held either way, the stick and a button at once;
  the controls step aside while a pad or keys are used and come back on the next touch. A swipe
  dismisses, an action's button shows when there is something to do, and touch gets simple assists.
- [ ] **The whole window at every shape.** `aspect: 'fill'` (the default) reaches every edge at
  16:9, 21:9, 4:3 and a phone's; lay the HUD out from `ctx.hud.width` / `height`, never 480 × 270.
- [ ] **The player's 52in1 settings.** Volumes and vibration apply by themselves; use a DualSense's
  extras where they fit (light bar, rumble, analog and adaptive triggers, touchpad, motion aim,
  speaker), each adding to a control that works without it; the microphone only once 52in1 allows it.
- [ ] **Together.** Every online mode the game can support (parallel at least; ghost, a shared
  world, moments) on one page, and play on one device in its own menu (section 7).
- [ ] **The head says so**: `hub:controls`, `hub:tags` with `gamepad` and `touch`, `hub:dualsense`,
  `hub:multiplayer`, `hub:moment` (section 6).
- [ ] **Checked on each device**, and you looked at the PNGs: `node check.mjs --keys PadA*10` (a
  `Pad*` code presses a fake standard pad, so the pad's prompts show), `"index.html?touch=1"` with
  `--size 390x844` (a phone, portrait) and `--size 844x390`, and `--size 2100x900` (21:9).

## 2. Controls as data, prompts for the device in use

A game's `controls` (`Game.controls`) names each action's key, pad button and touch button. The
engine reads it at each level: `{key:action}` in a line (`langFor`, `lang.t`), `hud.prompt`,
`hud.legend` and `hud.glyph` show the control in use. The game reads input by codes as before
(`consumePress('KeyE', 'PadA')`); a touch button presses its key code (`touchButtons`), so the
code list stays the same on every device.

Pad codes: `PadA` Cross / A · `PadB` Circle / B · `PadX` Square / X · `PadY` Triangle / Y ·
`PadLB` `PadRB` L1 R1 · `PadLT` `PadRT` L2 R2 · `PadBack` Create / View · `PadStart` Options /
Menu · `PadL3` `PadR3` · `PadTouchpad` (the DualSense's click); the d-pad presses the arrows.
Prompts also draw `PadLStick`, `PadRStick` and `DPad`. A table's `key` may be a name for several
(`WASD`, `Arrows`); its `touch` is a button's label or a gesture (`TouchTap`, `TouchSwipe`,
`TouchStick`).

Beacon Yard plays on all three devices: prompts and the line at the bottom follow the device,
a pause menu on Options holds the engine's settings, the light button shows only next to a dark
beacon, and on a DualSense the light bar and rumble join in (`examples/beacon-yard.html`):

```js beacon-yard
// Beacon Yard: light the four beacons. A pad (any standard one), the keyboard or touch: every
// prompt shows the device used last. Options / Esc / the ≡ button pause.
import { Engine, FocusList, langFor, MenuInput, PALETTE, THREE, toonMaterial, withUrlOptions, wrapText } from './pixel-engine.js';

const { BoxGeometry, CylinderGeometry, Mesh, Vector3 } = THREE;

/** Every word is a line: `{key:action}` names the key, pad button or touch button in use. */
const lang = langFor({ version: 1, language: 'en', lines: { 'help.walk': '{key:move} to walk, {key:use} to light', 'menu.resume': 'Resume', 'menu.settings': 'Settings', 'menu.restart': 'Restart' } });
const ROWS = ['menu.resume', 'menu.settings', 'menu.restart'];
const SPOTS = [[-6, -4], [6, -4], [-6, 4], [6, 4]];
/** Touch: the stick, a light button and a pause button (each presses its key). */
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
  menu = null; // the pause menu, while it is open

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
    const m = ctx.input.moveAxis(); // the keys, the left stick or the touch stick (top-down: up is -z)
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
    ctx.input.rumble({ strong: 0.2, weak: 0.6, ms: 120 }); // a short pulse on the pad in use
    ctx.dualsense.light(this.lit() === SPOTS.length ? PALETTE.lime : PALETTE.orange); // 52in1's DualSense: how far along
  }

  update(ctx, dt) {
    const { hud, input } = ctx;
    this.keeper.position.copy(this.at);
    const opening = !this.menu && input.wasPressed('Escape', 'PadStart');
    if (opening) {
      this.menu = { input: new MenuInput({ keys: ['PadStart'] }), list: new FocusList(ROWS.length) };
      input.release(); // the press that opened it never acts in it
    }
    ctx.engine.touch?.set('KeyE', { hidden: !this.near || !!this.menu }); // there only when there is something to light
    hud.clear();
    if (this.menu) return this.updateMenu(ctx, opening ? [] : this.menu.input.events(input, dt));
    hud.text(6, 6, `BEACONS ${this.lit()}/${SPOTS.length}`, { color: 'sand' });
    if (ctx.engine.controls.device !== 'touch') hud.prompt(hud.width - 6, 6, 'pause', 'MENU', { align: 'right' }); // on touch: the ≡ button
    if (this.lit() === SPOTS.length) hud.text(0, 0, 'THE YARD IS LIT', { anchor: 'center', scale: 2 });
    else if (this.near) hud.prompt(hud.width / 2, hud.height - 24, 'use', 'LIGHT', { align: 'center', scale: 2 });
    else wrapText(lang.t('help.walk'), hud.width - 12).reverse().forEach((line, i) => hud.text(0, 8 + i * 10, line, { anchor: 'bottom' })); // a phone's 130 columns too
  }

  /** Big rows, a focus, a legend: the d-pad or stick, a click, a tap; Circle, Esc, Options or a swipe closes. */
  updateMenu(ctx, events) {
    const { hud, input } = ctx;
    const w = Math.min(160, hud.width - 16);
    const rects = ROWS.map((_, i) => ({ x: Math.floor((hud.width - w) / 2), y: Math.floor(hud.height / 2) - 40 + i * 28, w, h: 22 }));
    const r = this.menu.list.update(events, input, hud, rects);
    if (r.moved) ctx.audio.play('step');
    if (r.confirm === 1) ctx.engine.settings.open(); // the engine's panel: picture, sound, controls
    if (r.confirm === 2) return void ctx.engine.loadGame(createGame());
    if (r.back || r.confirm === 0 || events.some((e) => e.kind === 'key')) {
      this.menu = null;
      input.release(); // what closed it never acts in the game
      return void input.clearQueued();
    }
    rects.forEach((b, i) => {
      const on = i === this.menu.list.index;
      const text = lang.t(ROWS[i]);
      hud.rect(b.x, b.y, b.w, b.h, on ? 'sand' : 'navy');
      hud.text(b.x + Math.floor((b.w - hud.measure(text, 2).width) / 2), b.y + 4, text, { color: on ? 'ink' : 'white', scale: 2, shadow: false });
    });
    hud.legend(Math.floor(hud.width / 2), hud.height - 14, [['confirm', 'SELECT'], ['back', 'BACK']], { align: 'center' });
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

if (typeof document !== 'undefined') await Engine.start(createGame(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'topdown' }, settings: { button: false }, touchButtons: TOUCH, touchStick: 'floating', touchDensity: 2 }));
```

## 3. Menus at ten feet

`MenuInput` turns the keys, the pad, the left stick and swipes into menu events (with repeat on a
held direction); `FocusList` keeps a list's focus and takes the pointer too (hover, click, tap),
so one menu works on every device. Read both in `update`; they read only `ctx.input`, so a menu
replays. Draw rows big, lay them out from `hud.width` / `height`, and put a `hud.legend` under
them. Call `input.release()` when a menu opens or closes: the press that opened it never acts in
it, and a stick held from a run never steps its rows (`input.clearQueued()` as it closes too, so a
Cross that chose Resume never reaches `fixedUpdate`).

The engine's settings panel (picture, sound, controls; saved per game) is made the same way. A
game with a pause menu opens it from there (`ctx.engine.settings.open()`) and hides the ⚙ button
(`settings: { button: false }`); a game with no pause menu passes `settings: { padButton: true }`,
so Options and Esc open it, as the kit's `game.js` does.

## 4. Touch as an add-on

- `touchButtons` places the buttons (each presses a key code; `at` puts one in a corner, sized
  for a thumb); `touchStick: 'floating'` brings the stick under the thumb anywhere in the lower
  left; `touchDensity: 2` keeps a phone's art at two CSS pixels a pixel or more, for a HUD that
  fits about 180 rows. The stick and the buttons take fingers at once.
- **Context buttons**: `ctx.engine.touch?.set('KeyE', { hidden, label, cooldown, badge })` each
  frame from the game's state (null headless and without touch controls, hence `?.`).
- **Swipes**: a quick flick presses `SwipeLeft`, `SwipeRight`, `SwipeUp` or `SwipeDown`
  (`SWIPE_KEYS`): dismiss a dialogue or a card with them; `FocusList` closes on a sideways one.
- **Assists** where precise thumbs are hard: aim at the nearest target, a longer reach, auto-run,
  when `ctx.input.device === 'touch'` (recorded, so a replay agrees).
- **Phones both ways**: in portrait the art can be 130 columns wide; keep the HUD clear of the
  controls (`ctx.engine.touch?.rects()`), and of the stick's zone with a floating stick.

## 5. The player's settings and the DualSense

In 52in1 the player sets volumes, vibration and a DualSense's extras once, for every game. The
engine applies the volumes (music on the music bus, everything else as effects: never a master
volume) and the hub scales rumble; outside 52in1 everything still plays.

```js
Engine.start(game, { settings: { motion: true, voice: true } }); // Motion aim and Microphone rows in the panel
ctx.input.rumble({ strong: 0.3, weak: 0.6, ms: 120 });            // the pad in use, × the player's vibration
ctx.dualsense.light(PALETTE.red);                                  // the light bar says something; null gives it back
ctx.dualsense.trigger('right', { kind: 'weapon', from: 0.3, to: 0.6, strength: 0.8 }); // resist | weapon | vibrate
ctx.dualsense.trigger('right', null);                              // let it go when its use ends
const throttle = ctx.input.triggers.right;                         // 0..1, every pad's analog trigger
const aim = ctx.input.lookAxis;                                    // the right stick, y up (motion aim adds to it)
ctx.input.touchpad = true;                                         // swipes and taps press PadTouchpadLeft ... Tap
ctx.audio.play('hurt', { bus: 'speaker' });                        // from the controller's speaker, else with the rest
if (ctx.engine.voiceOn) mic = await ctx.engine.hubSettings.openMicrophone(); // only once 52in1 allows it
```

- Every extra adds to a control that works without it: a touchpad swipe has a button that does
  the same; motion aim adds to the right stick, with the panel's on / off row and sensitivity.
- The light bar says something (health, the team, danger); the engine gives it back between
  levels. Let a trigger go when its use ends; the engine lets go while paused.
- Motion and the touchpad are input: read them through `ctx.input` (recorded), never
  `window.AIHubSettings.dualsense` yourself; never `navigator.hid` or `getUserMedia`.
- A voice feature's row stays off until 52in1 allows games the microphone
  (`ctx.engine.hubSettings.micAllowed`; `micLater`: allowed after this game was opened, so it
  needs opening again); what it hears reaches gameplay through `ctx.input.send`.

## 6. 52in1 sessions and the head

52in1 deals games into rounds for up to four friends, each on their own device. A game offers
every online mode it can: `parallel` (the same start each, best time or score), `ghost` (the
others shown as ghosts: `session.send`, `RemoteTrack`), `shared-world` (one world run by the host:
`session.finish`) and `moments` (three short moments of the game, each a fresh load). It joins
with all of them and plays the one the hub picks (`info.mode`). Gem Rush plays parallel and
moments, and alone outside 52in1 (`examples/gem-rush.html`):

```js gem-rush
// Gem Rush: grab every gem before the time runs out. In 52in1 it plays the round the hub picks:
// parallel (the fastest clear wins) or one moment (each a fresh load); anywhere else, alone.
import { Engine, headSession, HubSession, hubEvents, PALETTE, THREE, toonMaterial, withUrlOptions } from './pixel-engine.js';

const { BoxGeometry, Mesh, OctahedronGeometry, Vector3 } = THREE;

/** Each moment's set-up, by its hub:moment tag's id; RUN is a parallel round's, or a run alone. */
export const MOMENTS = { 'gem-dash': { gems: 3, seconds: 8 }, 'gem-hunt': { gems: 6, seconds: 15 }, 'gem-sweep': { gems: 10, seconds: 25 } };
const RUN = { gems: 12, seconds: 60 };

class GemRush {
  name = 'Gem Rush';
  controls = { move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' } };
  at = new Vector3(0, 0.4, 0);
  center = new Vector3();
  gems = [];
  got = 0;
  over = null; // 'cleared' or 'failed'

  constructor(session) {
    this.session = session; // null outside 52in1
    this.moment = session?.info.moment ?? null; // in a round of moments, the one this load plays
    this.plan = MOMENTS[this.moment] ?? RUN;
    this.left = this.plan.seconds;
    this.countdown = session ? Infinity : 0; // in a session: set up and still until the hub's start
  }

  setup(ctx) {
    // the same gems on every copy: the session's numbers for this moment, else the engine's seed
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
    this.session?.attach(ctx.engine).ready(); // the hub's events arrive as input; ready with no key press
  }

  fixedUpdate(ctx, dt) {
    if (this.countdown > 0) return void (this.countdown -= dt);
    if (this.over) return;
    const m = ctx.input.moveAxis();
    this.at.x = Math.max(-8.5, Math.min(8.5, this.at.x + m.x * 6 * dt));
    this.at.z = Math.max(-5.5, Math.min(5.5, this.at.z - m.y * 6 * dt));
    for (const gem of this.gems) if (gem.visible && gem.position.distanceTo(this.at) < 0.8) this.grab(ctx, gem);
    this.left -= dt;
    if (this.got === this.gems.length) this.finish(ctx, true);
    else if (this.left <= 0) this.finish(ctx, false);
  }

  grab(ctx, gem) {
    gem.visible = false;
    this.got++;
    ctx.audio.play('coin');
    ctx.input.rumble({ weak: 0.5, ms: 60 });
    this.session?.progress(this.got, 'GEMS'); // the hub's scoreboard (parallel and ghost)
  }

  /** Cleared or failed: reported once, with the hub's time (real time: for the report, never for play). */
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
    this.runner.position.copy(this.at);
    for (const gem of this.gems) gem.rotation.y += dt * 3;
    ctx.dualsense.light(this.over || this.left > 3 ? PALETTE.cyan : PALETTE.red); // the light bar: time running out
    const { hud } = ctx;
    hud.clear();
    hud.text(6, 6, `GEMS ${this.got}/${this.gems.length}`, { color: 'cyan' });
    hud.text(6, 6, `${Math.ceil(Math.max(0, this.left))}`, { anchor: 'top-right', color: this.left > 3 ? 'white' : 'red' });
    if (this.countdown > 0 && this.countdown < Infinity) hud.text(0, 0, `${Math.ceil(this.countdown)}`, { anchor: 'center', scale: 3 });
    if (this.over) hud.text(0, 0, this.over === 'cleared' ? 'CLEARED!' : 'TIME!', { anchor: 'center', scale: 2 });
  }

  cameraTarget() {
    return this.center;
  }

  status() {
    return `gems ${this.got}/${this.gems.length}${this.over ? `, ${this.over}` : ''}`;
  }
}

export const createGame = (session = null) => new GemRush(session);

// In 52in1 (hub:session 1 in the head, the hub's client its first script) join the round the hub
// picks; anywhere else there is no hub, headSession() is null and it plays alone.
const offer = headSession();
const session = offer && (await HubSession.join({ mode: offer.modes, seats: offer.seats }));
if (typeof document !== 'undefined') await Engine.start(createGame(session), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'topdown' }, seed: session?.info.seed }));
```

- **In a session** the game opens straight into the round: no title, menu or prompt to press. It
  sets up from `session.rng(label)` (the same on every copy and in a replay), readies up with no
  key press, waits still until `start`, and counts the countdown in game time.
- **Moments** are short stretches the game already has (3 to 30 s), one per load: `info.moment`
  names it, `session.result({ won, time })` reports it once, and at `time-up` it counts as cleared
  only when its goal is to last.
- **Reports**: parallel and ghost `session.progress(score)` then one `result({ time })` or
  `result({ score })`; a shared world's host one `session.finish({ standings })`.
- **Test without the hub**: `LocalHub` runs a round in memory (`new LocalHub({ mode: 'moments',
  moment: { id: 'gem-dash', seconds: 8 }, players: 2 })`, its `client(i)` to `HubSession.join`).
  Then 52in1's harness on the built page, every mode.

The page's head, after `<meta charset>` and the session client, names what the game does (the
52in1 catalogue: https://52in1.com/lib/hub/catalogue.md):

```html
<meta name="hub:tags" content="3d, arcade, top-down, gamepad, touch">
<meta name="hub:controls" content="WASD or arrows to walk; gamepad to play it all; touch to play on a phone">
<meta name="hub:dualsense" content="light bar, haptics">
<meta name="hub:session" content="1">
<meta name="hub:session-mode" content="parallel">
<meta name="hub:session-players" content="1-4">
<meta name="hub:multiplayer" content="parallel 1-4, moments 1-4">
<meta name="hub:moment" content="gem-dash collect 8 Grab three gems in eight seconds">
<meta name="hub:moment" content="gem-hunt collect 15 Grab six gems in fifteen seconds">
<meta name="hub:moment" content="gem-sweep collect 25 Grab all ten gems in time">
```

`gamepad` goes in `hub:tags` only when the game plays fully on a controller, `touch` only when it
plays by touch alone; `hub:dualsense` lists only the extras the game uses (`light bar`, `adaptive
triggers`, `haptics`, `motion`, `touchpad`, `speaker`, `microphone`).

## 7. Several players on one device

`same-screen`, `split-screen` and `hot-seat` modes are the game's own menu's, named in
`hub:multiplayer` (`split-screen versus 2-4`) and `hub:players`, never a session's. The engine's
input is one player's: every pad, the keys and touch press the same codes. A second player on the
keyboard reads keys of their own (WASD for one, the arrows for the other). For a pad each, read
`navigator.getGamepads()` in `update` and hand each pad's state to the game with
`ctx.input.send({ pads })`, so it is recorded and replays. A split screen gives each player a view
at every window shape, a same-screen game keeps everyone in view, and a hot-seat game says whose
turn it is, with a screen between turns.
