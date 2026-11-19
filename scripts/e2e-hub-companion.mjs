// Part of the e2e suite `hub`: Riftlight as 52in1 serves it. On 52in1 every game page reaches the
// player with the hub's companion script (scripts/hub/companion.js, vendored unmodified from
// 52in1's lib/hub/) as its first script, which the Worker on the games' address adds; the hub's
// page (52in1's assets/js/ui/frames.js) speaks to it by postMessage. Here the suite does both:
// it serves the built page with the companion placed as the Worker places it (`withCompanion`),
// inside a page of its own on another origin that plays the hub's side (`hubSide`), on a desktop
// and on a phone held upright (`onTheWall`), and in 52in1's own session harness for a game night's
// round, which loads under the hub's cards, hushed (`gameNight`). docs/game/hub.md *In 52in1's frame*.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { WEBGPU_ARGS } from './browser.mjs';

/** What the Worker adds to a game page (52in1's cloudflare/worker.js, `COMPANION`). */
export const COMPANION = '<script src="/lib/hub/companion.js"></script>';

/**
 * `html` with the companion as its first script, where 52in1's Worker puts it (`withCompanion`,
 * an HTMLRewriter there): at the top of its `<head>`, else before its first `<script>`, else at
 * the top of its `<body>`, whichever comes first; a tag inside a comment is no element. A page
 * with none of them is returned as it is.
 */
export function withCompanion(html) {
  const tags = /<!--[\s\S]*?(?:-->|$)|<(head|script|body)(?=[\s/>])[^>]*>/gi;
  for (let m; (m = tags.exec(html)); ) {
    if (!m[1]) continue; // a comment
    const at = m[1].toLowerCase() === 'script' ? m.index : m.index + m[0].length;
    return html.slice(0, at) + COMPANION + html.slice(at);
  }
  return html;
}

/**
 * The hub's side of every game frame's companion, as 52in1's page plays it (assets/js/ui/frames.js
 * at the commit scripts/hub/harness/README.md names), run in the page that frames the game (the top
 * window only). It links each frame the page adds: it asks for its pads, tells it whether to hold
 * its sound and the player's settings, and again when the frame says hello; it sends the
 * DualSense's motion and touches once a frame to a frame that wants them while a DualSense is in
 * the settings. `window.__hub`: what the frames said (`heard`), `hush(on)`, `set(settings)` (sent
 * to every frame, as on a change in the hub's Settings) and `controller` (the DualSense as the hub
 * hears it: `gyro`, `accel` and `touches`, `[id, x, y]` each). `hushed`: the hub's cards are up as
 * the page loads (a game night's next round loads under them).
 */
export function hubSide(hushed = false) {
  if (window.top !== window || window.__hub) return;
  const links = new Map();
  const send = (link, msg) => {
    try {
      link.frame.contentWindow?.postMessage(msg, '*');
    } catch {
      /* gone */
    }
  };
  const say = (link, msg) => {
    hub.sent[msg.hubFrame] = (hub.sent[msg.hubFrame] ?? 0) + 1;
    send(link, msg);
  };
  /** What a frame is told as it is linked, and again at its hello. */
  const tell = (link) => {
    say(link, { hubFrame: 'pads', want: true });
    say(link, { hubFrame: 'hush', on: hub.hushed });
    say(link, { hubFrame: 'settings', settings: hub.settings });
  };
  const hub = (window.__hub = {
    hushed,
    heard: [],
    sent: {},
    settings: { volume: { master: 1, music: 1, effects: 1 }, vibration: 1, mic: false, muted: false, dualsense: null },
    controller: { gyro: [0, 0, 0], accel: [0, 1, 0], touches: [] },
    link(frame) {
      const link = { frame, wantInput: false };
      links.set(frame, link);
      tell(link);
    },
    hush(on) {
      if (Boolean(on) === hub.hushed) return;
      hub.hushed = Boolean(on);
      for (const link of links.values()) say(link, { hubFrame: 'hush', on: hub.hushed });
    },
    set(settings) {
      hub.settings = settings;
      for (const link of links.values()) say(link, { hubFrame: 'settings', settings });
    },
  });
  addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || typeof msg.hubFrame !== 'string') return;
    for (const link of links.values()) {
      if (link.frame.contentWindow !== event.source) continue;
      const note = { at: Math.round(performance.now()), frame: link.frame.title || 'game', ...msg };
      if (msg.hubFrame === 'pads') note.pads = (Array.isArray(msg.pads) ? msg.pads : []).map((p) => p?.id);
      hub.heard.push(note);
      if (hub.heard.length > 400) hub.heard.splice(0, hub.heard.length - 400);
      if (msg.hubFrame === 'hello') tell(link);
      else if (msg.hubFrame === 'ds-want') link.wantInput = Boolean(msg.input);
      return;
    }
  });
  // the motion and touches, once a frame, to the frames that want them while there is a DualSense
  const stream = () => {
    if (hub.settings?.dualsense) {
      const { gyro, accel, touches } = hub.controller;
      for (const link of links.values()) if (link.wantInput) say(link, { hubFrame: 'ds-input', gyro, accel, touches });
    }
    requestAnimationFrame(stream);
  };
  requestAnimationFrame(stream);
  // the player links each frame it opens
  new MutationObserver(() => {
    for (const frame of document.querySelectorAll('iframe')) if (!links.has(frame)) hub.link(frame);
  }).observe(document, { childList: true, subtree: true });
}

/** A game frame's allow on 52in1 (its frames.js `FRAME_ALLOW`, without the microphone). */
const FRAME_ALLOW = 'fullscreen; autoplay; gamepad; pointer-lock; accelerometer; gyroscope; magnetometer; xr-spatial-tracking; screen-wake-lock; clipboard-write; midi';

/** The page of the hub's own that frames the game (`?game=` its address): the frame fills it, as a game fills 52in1's. */
export const HUB_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>52in1</title>
<style>html, body { margin: 0; height: 100%; background: #000; overflow: hidden; } iframe { display: block; width: 100%; height: 100%; border: 0; }</style>
<body><script>(${hubSide})(false);
const frame = document.createElement('iframe');
frame.title = 'riftlight';
frame.allow = '${FRAME_ALLOW}';
document.body.append(frame);
frame.src = new URLSearchParams(location.search).get('game');
</script>`;

/**
 * Before the game frame's first script (and so before the companion's), in a game's frame only: a
 * DualSense the browser shows once the test plugs it in (`window.__pad`: `connected`, its `axes`),
 * and what is connected to the speakers (`window.__speakers`: the companion puts its master gain
 * there, in front of everything the game plays).
 */
export function gameProbe() {
  if (!/\/games\//.test(location.pathname)) return;
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = (window.__pad = { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: false, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons, vibrationActuator: null });
  Object.defineProperty(Navigator.prototype, 'getGamepads', {
    configurable: true,
    writable: true,
    value() {
      if (!pad.connected) return [];
      pad.timestamp = performance.now(); // real time: a pad's timestamp is the browser's clock
      return [{ ...pad, axes: [...pad.axes], buttons: pad.buttons.map((b) => ({ ...b })) }];
    },
  });
  const speakers = (window.__speakers = []);
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode && !speakers.includes(this)) speakers.push(this);
    return connect.call(this, target, ...rest);
  };
}

/** The player's 52in1 settings as the hub sends them (frames.js `settingsFor`): no DualSense yet. */
const SETTINGS = { volume: { master: 0.7, music: 0.5, effects: 0.25 }, vibration: 0.5, mic: false, micLater: false, muted: false, dualsense: null };
/** The player changes them in the hub's Settings over the game, and connects a DualSense with Motion aim on. */
const CHANGED = { ...SETTINGS, volume: { master: 0.4, music: 1, effects: 0.5 } };
const DUALSENSE = { ...CHANGED, dualsense: { lightbar: true, triggers: 1, speaker: false, aim: true } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls `test` (async) every 100 ms for up to `ms`: its last answer. */
async function until(test, ms) {
  const end = Date.now() + ms;
  let last = await test().catch(() => false);
  while (!last && Date.now() < end) {
    await sleep(100);
    last = await test().catch(() => false);
  }
  return last;
}
const near = (a, b, d = 1e-3) => typeof a === 'number' && Math.abs(a - b) <= d;

/** The game's frames in `page` (from the games' address), and the errors their consoles log (`errors`). */
function watch(page) {
  const errors = [];
  const ours = (url) => /\/(games|lib\/hub)\//.test(url ?? '');
  page.on('console', (m) => m.type() === 'error' && ours(m.location()?.url) && errors.push(`${m.text()} (${m.location()?.url?.split('/').pop()})`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, games: () => page.frames().filter((f) => ours(f.url())) };
}

/** What the game would act on: its panels and map, the hero's place and mana, and the level's input recorded so far. */
function riftlightNow() {
  const rl = window.__RIFTLIGHT__;
  const e = window.__PIXEL_ENGINE__;
  const s = rl.state();
  return { ui: s.ui.join(','), map: rl.game.mapOpen, paused: s.paused, at: s.hero.position.map((n) => Math.round(n * 100) / 100).join(','), mana: s.hero.mana, frames: e.recording()?.frames.length ?? 0 };
}

/** Whether the hero swings now (its controller's state). */
const swinging = () => window.__RIFTLIGHT__.game.hero.hc?.state === 'attack';

/** What the level's recording holds since frame `from`: the presses (a finger on the canvas, `Touch`, aside), the frames motion aim turned and the right stick leaned in. */
function recordedSince(from) {
  const frames = window.__PIXEL_ENGINE__.recording()?.frames.slice(from) ?? [];
  return { pressed: frames.flatMap((f) => f.pressed ?? []).filter((c) => c !== 'Touch'), turn: frames.filter((f) => f.turn?.[0] > 0).length, look: frames.filter((f) => f.look).length, frames: frames.length };
}

/** The engine's sound as the speakers hear it: its context, its own gains and the companion's master in front of the speakers. */
function soundNow() {
  const a = window.__PIXEL_ENGINE__.audio;
  return { state: a.context?.state ?? null, own: { ...a.volume }, master: a.master?.gain.value, music: a.buses.music?.gain.value, sfx: a.buses.sfx?.gain.value, speakers: window.__speakers.map((g) => g.gain?.value ?? null), ownAtSpeakers: window.__speakers.includes(a.master) };
}

/**
 * Riftlight on 52in1's wall (no session): the page from the games' address in a frame of the hub's
 * page on another origin, on a desktop or (`phone`) a phone held upright with a touch screen (a
 * picture of it in a level at `shot`, a path, when given). The
 * companion says hello and relays the pads; the hub's settings reach the engine and its volumes
 * apply live, the master in front of the speakers (the companion's), music and effects on the
 * engine's buses; the top 90 CSS px wake the hub's bar (a mouse there, or a touch) and the game
 * does nothing with them, while a touch below wakes nothing; on the desktop the DualSense's motion
 * and touches reach `input.motion` and the touchpad while the game reads them; no console errors.
 */
export async function onTheWall(browser, url, check, { phone = false, shot = null } = {}) {
  const on = phone ? 'on a phone (390×844, touch)' : 'on a desktop (1280×800)';
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } });
  try {
    await context.addInitScript(gameProbe);
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto(url);
    const up = await until(async () => {
      const f = seen.games()[0];
      return !!f && (await f.evaluate(() => !!window.__RIFTLIGHT__?.state && !!window.__PIXEL_ENGINE__));
    }, 90_000);
    if (!up) return check(false, `${on}: the game came up in the hub's frame`);
    const game = seen.games()[0];
    const G = (fn, arg) => game.evaluate(fn, arg);
    const H = (fn, arg) => page.evaluate(fn, arg);
    const heard = (kind) => H((k) => window.__hub.heard.filter((h) => h.hubFrame === k), kind);

    // hello, the pads, and the player's settings in the engine
    await H((s) => window.__hub.set(s), SETTINGS);
    await until(() => G(() => window.__PIXEL_ENGINE__.hubSettings.values.music === 0.5), 5000);
    const read = await G(() => ({ companion: window.__hubCompanion === true, present: window.__PIXEL_ENGINE__.hubSettings.present, values: window.__PIXEL_ENGINE__.hubSettings.values }));
    const v = read.values;
    const hello = (await heard('hello')).length;
    const pads = (await heard('pads')).length;
    check(read.companion && hello >= 1 && pads >= 1, `${on}: the companion runs first in the game's frame, says hello (${hello}) and relays the controllers as the frame sees them (${pads} 'pads')`);
    check(read.present && v.music === 0.5 && v.effects === 0.25 && v.vibration === 0.5 && !v.mic && !v.dualsense.connected, `${on}: the hub's settings reach the engine through the companion's AIHubSettings (engine.hubSettings: present ${read.present}, music ${v.music}, effects ${v.effects}, vibration ${v.vibration}, microphone ${v.mic}, DualSense ${v.dualsense.connected})`);

    // into a level, the monsters still
    await G(async () => {
      const rl = window.__RIFTLIGHT__;
      rl.newRun({ slot: 0, seed: 4242 });
      await rl.enterDepth(1);
      rl.dev.ai = false;
      rl.dev.god = true;
    });
    await until(() => G(() => window.__RIFTLIGHT__.state().screen === 'level' && (window.__PIXEL_ENGINE__.recording()?.frames.length ?? 0) > 30), 30_000);
    if (shot) await page.screenshot({ path: shot });

    // the hub's wake band: the top 90 CSS px are the hub's (its bar comes back), the game does nothing
    // with them. On the phone a finger held there a moment, as one pulling the bar down (a quick tap
    // never swings: a finger on the world swings once it stays down), and the hero watched for a swing
    const wakes = async () => (await heard('wake')).length;
    const cdp = phone ? await context.newCDPSession(page) : null;
    /** A finger down at (x, y) CSS px for `ms`, then up a while: whether the hero swung meanwhile. */
    const hold = async (x, y, ms = 300) => {
      const point = { x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      let swung = false;
      for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) swung ||= await G(swinging);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      for (const end = Date.now() + 500; Date.now() < end; await sleep(40)) swung ||= await G(swinging);
      return swung;
    };
    const band = phone ? [30, 195, 360] : [80, 640, 1200];
    const before = await G(riftlightNow);
    let woke = 0;
    let swung = 0;
    if (phone) {
      // on the phone ≡ sits below the band, where it opens the menu
      const menu = await G(() => window.__PIXEL_ENGINE__.touch?.rects().buttons.find((b) => b.code === 'Escape')?.rect.top ?? null);
      check(menu !== null && menu >= 90, `${on}: ≡ below the hub's wake band (its top at ${menu === null ? 'nothing' : Math.round(menu)} CSS px)`);
      for (const x of band) {
        const w = await wakes();
        if (await hold(x, 40)) swung++;
        if ((await wakes()) > w) woke++;
        await sleep(300); // the companion wakes the hub at most every 250 ms
      }
    } else {
      await page.mouse.move(640, 400); // below the band first: nothing
      await sleep(400);
      for (const x of band) {
        const w = await wakes();
        await page.mouse.move(x, 40);
        await sleep(400);
        if ((await wakes()) > w) woke++;
      }
      await page.mouse.move(640, 400);
    }
    await sleep(500);
    const after = await G(riftlightNow);
    const did = await G(recordedSince, before.frames);
    const still = before.ui === after.ui && !after.map && !after.paused && !swung && before.at === after.at && before.mana === after.mana && !did.pressed.length;
    check(woke === band.length, `${on}: ${phone ? 'a finger' : 'the mouse'} in the top 90 CSS px wakes the hub's bar, each time (${woke} of ${band.length}, along the top)`);
    check(still, `${on}: Riftlight takes no action from ${phone ? 'a finger held' : 'the mouse'} in the hub's wake band (panels ${after.ui || 'none'}, map ${after.map}, paused ${after.paused}, swings ${swung}, the hero ${before.at === after.at ? 'still' : `moved ${before.at} → ${after.at}`}, presses ${did.pressed.join(' ') || 'none'})`);

    // below the band: no wake. On the phone a finger held on the world swings (the game's; the sound's
    // gesture too), a tap on ≡ opens the menu
    if (phone) {
      const w1 = await wakes();
      const world = await hold(300, 300);
      const menu = await G(() => window.__PIXEL_ENGINE__.touch.rects().buttons.find((b) => b.code === 'Escape').rect);
      await page.touchscreen.tap(menu.left + menu.width / 2, menu.top + menu.height / 2);
      const opened = await until(() => G(() => window.__RIFTLIGHT__.state().ui.length > 0), 5000);
      const panel = await G(() => window.__RIFTLIGHT__.state().ui.join(','));
      await G(() => window.__RIFTLIGHT__.ui.close());
      await sleep(400);
      const w2 = await wakes();
      check(w2 === w1 && world && opened, `${on}: below the band a finger wakes nothing (${w2 - w1} 'wake') and is the game's: held on the world it swings (${world}), a tap on ≡ opens the menu (${panel || 'nothing'})`);
    } else {
      await page.mouse.click(640, 500); // a swing: the sound's gesture
    }

    // the sound: the hub's master in front of the speakers (the companion's), music and effects on the engine's buses, live
    await until(() => G(() => window.__PIXEL_ENGINE__.audio.unlocked), 10_000);
    const s1 = await G(soundNow);
    const ownMaster = s1.own.muted ? 0 : s1.own.master;
    check(s1.state === 'running' && s1.speakers.length === 1 && !s1.ownAtSpeakers && near(s1.speakers[0], 0.7) && near(s1.master, ownMaster) && near(s1.music, s1.own.music * 0.5) && near(s1.sfx, s1.own.sfx * 0.25), `${on}: the hub's volumes apply: its master in front of the speakers, not the game's (${s1.ownAtSpeakers ? 'the game\'s master is there' : 'the companion\'s gain'}: ${s1.speakers.map((g) => g?.toFixed(2)).join(', ') || 'nothing there'}), the game's own master ${s1.master?.toFixed(2)}, music ${s1.music?.toFixed(3)} = ${s1.own.music} × 0.5, effects ${s1.sfx?.toFixed(3)} = ${s1.own.sfx} × 0.25 (${s1.state})`);
    await H((s) => window.__hub.set(s), CHANGED);
    await until(() => G(() => Math.abs(window.__speakers[0]?.gain.value - 0.4) < 1e-3), 3000);
    const s2 = await G(soundNow);
    check(near(s2.speakers[0], 0.4) && near(s2.music, s2.own.music) && near(s2.sfx, s2.own.sfx * 0.5), `${on}: a volume changed in the hub's Settings applies live: master ${s2.speakers[0]?.toFixed(2)}, music ${s2.music?.toFixed(3)}, effects ${s2.sfx?.toFixed(3)}`);

    if (!phone) await dualSense(page, game, check, on);
    const errors = [...seen.errors, ...(await G(() => window.__PIXEL_ENGINE__.errors.map((e) => `engine: ${e}`)))];
    check(!errors.length, `${on}: no console errors in the game's frame${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
  } finally {
    await context.close();
  }
}

/**
 * The DualSense's extras through the companion (the desktop's run, in a level): nothing reads its
 * motion before the hub has one; once the player connects it with Motion aim on, the game reads
 * it (the companion asks the hub for it: 'ds-want'), the hub's turns reach `input.motion` with the
 * pad in use and 52in1's own Motion aim keeps off the right stick, a swipe on its touchpad pages
 * the character screens, and the game colours the light bar ('ds-light').
 */
async function dualSense(page, game, check, on) {
  const G = (fn, arg) => game.evaluate(fn, arg);
  const H = (fn, arg) => page.evaluate(fn, arg);
  const wants = () => H(() => window.__hub.heard.filter((h) => h.hubFrame === 'ds-want').map((h) => h.input));
  const before = await wants();
  await H((s) => {
    window.__hub.controller.gyro = [0, -90, 0]; // turned to the right, 90° a second
    window.__hub.set(s);
  }, DUALSENSE);
  const asked = await until(async () => (await wants()).includes(true) && (await G(() => window.__PIXEL_ENGINE__.input.motion.on)), 5000);
  // the pad plugged in, then picked up: the left stick nudged and let go
  await G(() => (window.__pad.connected = true));
  await sleep(300);
  await G(() => (window.__pad.axes[0] = 0.8));
  await sleep(300);
  await G(() => (window.__pad.axes[0] = 0));
  const inUse = await until(() => G(() => window.__PIXEL_ENGINE__.input.device === 'pad'), 3000);
  await sleep(200);
  const from = await G(() => window.__PIXEL_ENGINE__.recording()?.frames.length ?? 0);
  await sleep(1000);
  const turned = await G(recordedSince, from);
  const gyro = await G(() => window.__PIXEL_ENGINE__.input.dualsense?.gyro() ?? null);
  const pads = await H(() => window.__hub.heard.filter((h) => h.hubFrame === 'pads').flatMap((h) => h.pads));
  const relayed = pads.some((id) => /DualSense/.test(id ?? ''));
  check(!before.includes(true) && asked && inUse && near(gyro?.y, -90) && turned.turn > 0 && turned.look === 0 && relayed, `${on}: a DualSense's motion reaches input.motion once the game reads it (no 'ds-want' before the hub had one: ${before.join(',') || 'none'}; then ${asked}; gyro ${JSON.stringify(gyro)}; the pad in use ${inUse}: ${turned.turn} of ${turned.frames} frames turned, 52in1's own Motion aim leaned the right stick in ${turned.look}; the pad relayed to the hub: ${relayed})`);
  // a swipe right on its touchpad (a finger across it in a third of a second, the hub sending it each
  // frame): the next character screen. A slow renderer may poll too seldom to see one: three tries
  await G(() => window.__RIFTLIGHT__.ui.open('inventory'));
  const open = await G(() => window.__RIFTLIGHT__.state().ui.join(','));
  let tries = 0;
  let paged = false;
  while (!paged && tries++ < 3) {
    for (const x of [0.2, 0.4, 0.6, 0.8]) {
      await H((t) => (window.__hub.controller.touches = t), [[1, x, 0.5]]);
      await sleep(80);
    }
    await H(() => (window.__hub.controller.touches = []));
    paged = await until(() => G(() => window.__RIFTLIGHT__.state().ui.join(',') === 'skills'), 2000);
  }
  const now = await G(() => window.__RIFTLIGHT__.state().ui.join(','));
  await G(() => window.__RIFTLIGHT__.ui.close());
  const light = await H(() => window.__hub.heard.filter((h) => h.hubFrame === 'ds-light').map((h) => h.colour));
  check(paged && light.some((c) => /^#[0-9a-f]{6}$/.test(c ?? '')), `${on}: a swipe on the DualSense's touchpad pages the character screens (${open} → ${now}, swipe ${Math.min(tries, 3)} of 3), and the game colours its light bar (${light.slice(-3).join(', ') || 'never'})`);
}

/**
 * A game night's round of parallel for two in 52in1's own harness (scripts/hub/harness/, the page
 * at `url`), with the hub's side of the companion in its page (`hubSide`): the copies load under
 * the hub's cards, hushed. A click into the first copy there (a gesture: its sound starts) leaves
 * its AudioContext held, not running; once the round starts in every copy (its countdown: the cards
 * are gone) the hub lifts the hush and that copy has its sound back, and by the round's end every
 * copy's sound runs (the second's starts with the harness's keys, after the hush); the harness's
 * own checks pass (the session joins and plays the round with the companion in every copy) and no
 * copy logs an error.
 */
export async function gameNight(browser, url, check) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await context.addInitScript(gameProbe);
    const page = await context.newPage();
    await page.addInitScript(hubSide, true);
    const seen = watch(page);
    await page.goto(url);
    const copy = (f) =>
      f
        .evaluate(() => {
          const a = window.__PIXEL_ENGINE__?.audio;
          return { phase: window.__RIFTLIGHT__?.game?.round?.phase ?? null, sound: a?.context?.state ?? null, unlocked: a?.unlocked ?? false };
        })
        .catch(() => null);
    let under = null;
    let lifted = null;
    let last = [];
    const end = Date.now() + 240_000;
    while (Date.now() < end && (await page.evaluate(() => document.body.dataset.complete)) !== 'true') {
      const frames = seen.games();
      const copies = await Promise.all(frames.map(copy));
      last = copies;
      // under the cards: a click into the first copy, its sound's gesture
      if (!under && frames.length && ['waiting', 'countdown'].includes(copies[0]?.phase)) {
        const box = await (await frames[0].frameElement()).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await until(async () => (await copy(frames[0]))?.sound !== null, 3000);
        await sleep(500);
        under = { ...(await copy(frames[0])), hushed: await page.evaluate(() => window.__hub.heard.filter((h) => h.hubFrame === 'hushed' && h.on).length) };
      }
      // the round starts in every copy (its countdown): the cards are gone, the hub gives the sound back
      if (under && !lifted && copies.length === 2 && copies.every((c) => c?.phase === 'countdown' || c?.phase === 'playing')) {
        await page.evaluate(() => window.__hub.hush(false));
        await until(async () => (await copy(frames[0]))?.sound === 'running', 3000);
        lifted = { ...(await copy(frames[0])), played: await frames[0].evaluate(() => window.__PIXEL_ENGINE__.audio.play('coin')).catch(() => false) };
      }
      await sleep(250);
    }
    const report = await page.evaluate(() => window.__hubCheck ?? null);
    check(!!under && under.sound !== null && under.sound !== 'running' && !under.unlocked && under.hushed >= 2, `a game night's round loads under the hub's cards, hushed: a click into a copy there leaves its AudioContext held (${under ? `${under.phase}: ${under.sound}; ${under.hushed} copies said they were hushed` : 'it never showed a copy under the cards'})`);
    check(!!lifted && lifted.sound === 'running' && lifted.unlocked && lifted.played === true && last.length === 2 && last.every((c) => c?.sound === 'running'), `once the round starts the hub lifts the hush: the held copy has its sound back (${lifted ? `${lifted.phase}: ${lifted.sound}, a sound plays: ${lifted.played}` : 'the round never started in every copy'}), and every copy's sound runs at the round's end (${last.map((c) => `${c?.phase}: ${c?.sound}`).join(', ')})`);
    check(report?.pass === true, `the session joins and plays a round of parallel for two with the companion in every copy: the hub's checks pass (${report ? `${report.checks.length}${report.checks.some((c) => !c.pass) ? '; ' + report.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; ') : ''}` : 'no report'})`);
    check(!seen.errors.length, `the game night's copies log no console errors${seen.errors.length ? `: ${seen.errors.slice(0, 5).join(' | ')}` : ''}`);
  } finally {
    await context.close();
  }
}

/**
 * The companion runs (after the harness's, on the page `build:single` wrote in `dir`, served at
 * `port`): the page as the Worker serves it, under `games/`, with `lib/hub/companion.js`, and the
 * hub's page of our own (`HUB_PAGE`) on the other origin (localhost, the game at 127.0.0.1).
 */
export async function runCompanion({ exe, root, dir, port, check }) {
  console.log('\n▶ hub: as 52in1 serves the page, its companion first (scripts/hub/companion.js)');
  const served = withCompanion(await readFile(new URL('riftlight.html', dir), 'utf8'));
  await mkdir(new URL('games/', dir), { recursive: true });
  await mkdir(new URL('lib/hub/', dir), { recursive: true });
  await writeFile(new URL('games/riftlight.html', dir), served);
  await copyFile(new URL('scripts/hub/companion.js', root), new URL('lib/hub/companion.js', dir));
  await writeFile(new URL('companion.html', dir), HUB_PAGE);
  const first = served.indexOf('<script');
  check(first === served.indexOf(COMPANION) && first < served.indexOf('<script>/*! aihub-session'), `the page as 52in1's Worker serves it: the companion its first script, before the session client`);
  const out = new URL('.scratch/e2e/', root);
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: WEBGPU_ARGS });
  try {
    const wall = `http://localhost:${port}/companion.html?game=${encodeURIComponent(`http://127.0.0.1:${port}/games/riftlight.html?lang=en`)}`;
    await onTheWall(browser, wall, check, { shot: fileURLToPath(new URL('hub-companion-desktop.png', out)) });
    await onTheWall(browser, wall, check, { phone: true, shot: fileURLToPath(new URL('hub-companion-phone.png', out)) });
    await gameNight(browser, `http://localhost:${port}/harness.html?game=games/riftlight.html&mode=parallel&players=2&auto=1`, check);
  } finally {
    await browser.close();
  }
}
