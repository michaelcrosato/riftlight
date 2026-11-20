/**
 * companion.js — the hub's side inside a game page, on the games' separate address.
 *
 * The hub (52in1.com) and the games (a separate address) are different sites,
 * so the hub cannot reach into a game's frame. The game page tells it what it
 * needs instead, by postMessage: the mouse near the top or a touch (to bring
 * the player's bar back), the controller as this frame sees it (some browsers
 * show a pad only to the frame with focus), and it holds its own sound while
 * the hub's cards are up between a game night's rounds.
 *
 * No game file carries it: the Worker adds it as the first script of every
 * game page it serves (cloudflare/worker.js), and so does pnpm dev, so it is
 * in place before the game's own first script. A game opened on its own page
 * has no hub around it, and the companion does nothing.
 *
 * Messages carry `hubFrame`. From the hub (only the window around this one is
 * listened to): 'pads' { want }, 'hush' { on }, 'settings' { settings },
 * 'ds-input' { gyro, accel, touches }. To the hub: 'hello', 'wake', 'pads'
 * { pads }, 'hushed' { on, contexts, media }, 'ds-light' { colour },
 * 'ds-trigger' { which, effect }, 'ds-want' { input }. The session protocol
 * (lib/hub/session.js) is separate and unchanged.
 *
 * The hush, which the hub did from outside until games moved: while the
 * cards are up, the game's Web Audio contexts are suspended and its audio and
 * video elements muted; when play starts it gets back the sound it had. A sound the game
 * starts (a source node's start(), a media element's play()) says which
 * context or element is the game's; a context it asks to resume while hushed
 * is resumed once the hush lifts. A game night's round page (?aihub=1) starts
 * hushed, since it loads under the cards, until the hub says otherwise.
 *
 * The player's settings (ui/frames.js sends them, and again on every change),
 * which the game reads as window.AIHubSettings (lib/hub/catalogue.md,
 * *Settings and the DualSense*). Two the companion applies itself, so they
 * reach every game without a change to it: the master volume, as a gain in
 * front of each Web Audio context's speakers and on each audio and video
 * element; and the vibration, scaling every rumble the game asks of a
 * controller. The rest the game applies: its music and its other sounds by
 * the music and effects volumes, its voice features only once the
 * microphone is allowed (micLater: allowed after this game was opened, so it
 * reaches the game once it is opened again). The last settings are kept on the games' address
 * ('ai-hub:settings'), so a game that reads them as it starts has them before
 * the hub's word comes.
 *
 * The DualSense, while the player has its extras on for games: the game asks
 * for a light bar colour and a trigger effect, and reads the motion and the
 * touches, which the hub sends once a frame after the game first reads them.
 * The game never opens the controller itself: the hub has it.
 *
 * A game that writes its page anew as it opens (document.open: my-3D2dge's
 * play file opens each of its games so; or document.write after the page
 * has loaded, which opens it without a word) has the browser erase the
 * listeners on its window; the companion adds its own back as open(),
 * write() or writeln() returns.
 *
 * Motion aim, while the player has it on and the game reads no motion of its
 * own: the DualSense's turns are added to its right stick wherever the game
 * reads it (navigator.getGamepads), as a console's gyro aiming does, so a
 * game that aims or looks with the right stick aims by motion unchanged.
 */
(function (win) {
  if (win.__hubCompanion) return;
  win.__hubCompanion = true;
  var parent = win.parent;
  if (!parent || parent === win) return;

  var post = function (msg) {
    try {
      parent.postMessage(msg, '*');
    } catch (e) {
      /* the hub went away */
    }
  };
  /** A number held to 0–1; anything that is not a number gives `fallback`. */
  var unit = function (n, fallback) {
    if (typeof n !== 'number' || !isFinite(n)) return fallback;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  };

  /* --- the mouse and touches: the hub's bar comes back -------------------- */

  var woke = 0;
  var wake = function () {
    var now = Date.now();
    if (now - woke < 250) return;
    woke = now;
    post({ hubFrame: 'wake' });
  };
  var onMouse = function (e) {
    if (e.clientY < 90) wake();
  };
  var onTouch = function (e) {
    var touch = e.touches && e.touches[0];
    if (touch && touch.clientY < 90) wake();
  };

  /* --- the controller, as this frame sees it ------------------------------ */

  // The browser's own getGamepads, kept before motion aim (below) takes its
  // place: the hub hears the controller as it is. (hub-check tells the
  // companion's reads from the game's by readPads in the stack.)
  var navigatorProto = win.Navigator && win.Navigator.prototype;
  var padsAt = navigatorProto && typeof navigatorProto.getGamepads === 'function' ? navigatorProto : win.navigator;
  var browserPads = padsAt && padsAt.getGamepads;
  function readPads() {
    try {
      return (typeof browserPads === 'function' && browserPads.call(win.navigator)) || [];
    } catch (e) {
      return [];
    }
  }

  var wantPads = false;
  var raf = 0;
  var last = '';
  function pads() {
    var list = readPads();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.connected) continue;
      out.push({
        id: p.id,
        index: p.index,
        mapping: p.mapping,
        connected: true,
        timestamp: p.timestamp,
        axes: Array.prototype.slice.call(p.axes),
        buttons: Array.prototype.map.call(p.buttons, function (b) {
          return { pressed: b.pressed, touched: b.touched, value: b.value };
        }),
      });
    }
    return out;
  }
  function tick() {
    raf = 0;
    if (!wantPads) return;
    var now = pads();
    var key = JSON.stringify(now.map(function (p) {
      return [p.index, p.axes.map(function (a) { return Math.round(a * 100); }), p.buttons.map(function (b) { return b.value; })];
    }));
    if (key !== last) {
      last = key;
      post({ hubFrame: 'pads', pads: now });
    }
    raf = win.requestAnimationFrame(tick);
  }

  /* --- the hush ------------------------------------------------------------ */

  var hushed = /[?&]aihub=1(&|$)/.test(win.location.search);
  var seenContexts = [];
  var seenMedia = [];
  var heldContexts = new Map();
  var heldMedia = new Set();
  var remember = function (list, thing) {
    if (thing && list.indexOf(thing) === -1) list.push(thing);
  };
  function holdContext(ctx) {
    if (!ctx || heldContexts.has(ctx)) return;
    var playing = ctx.state === 'running';
    var held = { playing: playing, wanted: false, suspending: null };
    heldContexts.set(ctx, held);
    // A suspend settles later: until then the context still says it is running.
    if (playing) held.suspending = ctx.suspend().catch(function () {});
  }
  function holdMedia(el) {
    if (!el || el.muted || heldMedia.has(el)) return;
    heldMedia.add(el);
    el.muted = true;
  }
  function holdPage() {
    try {
      var playing = win.document.querySelectorAll('audio, video');
      for (var i = 0; i < playing.length; i++) if (!playing[i].paused) holdMedia(playing[i]);
    } catch (e) {
      /* no document yet */
    }
  }
  function report() {
    post({ hubFrame: 'hushed', on: hushed, contexts: heldContexts.size, media: heldMedia.size });
  }
  // While hushed, what the page starts playing on its own (an autoplay element) is held too.
  var watch = 0;
  function watchPage(on) {
    win.clearInterval(watch);
    watch = on ? win.setInterval(holdPage, 500) : 0;
  }
  function hush(on) {
    watchPage(on);
    if (on === hushed) {
      if (on) holdPage();
      return report();
    }
    hushed = on;
    if (on) {
      seenContexts.forEach(holdContext);
      seenMedia.forEach(function (el) {
        if (!el.paused) holdMedia(el);
      });
      holdPage();
      return report();
    }
    heldContexts.forEach(function (held, ctx) {
      if (!held.playing && !held.wanted) return;
      var give = function () {
        if (!hushed && ctx.state === 'suspended') ctx.resume().catch(function () {});
      };
      // suspended: back now; its own suspend still on the way: once that settles, unless the hub
      // has hushed it again meanwhile
      if (ctx.state === 'suspended') give();
      else if (held.suspending) held.suspending.then(give);
    });
    heldMedia.forEach(function (el) {
      el.muted = false;
    });
    heldContexts.clear();
    heldMedia.clear();
    report();
  }

  /* --- the master volume, on everything the page plays --------------------- */

  var master = 1;
  var masters = typeof WeakMap === 'function' ? new WeakMap() : null;
  var gains = [];
  var Node = win.AudioNode && win.AudioNode.prototype;
  var Speakers = win.AudioDestinationNode;
  var Offline = win.OfflineAudioContext;
  var connect = Node && Node.connect;
  var disconnect = Node && Node.disconnect;
  /** A context's speakers: what the master gain goes in front of (never an offline render's). */
  function speakers(node) {
    try {
      return Boolean(Speakers && node instanceof Speakers && !(Offline && node.context instanceof Offline));
    } catch (e) {
      return false;
    }
  }
  /** The gain in front of `ctx`'s speakers, made the first time something is connected to them. */
  function masterOf(ctx) {
    var gain = masters.get(ctx);
    if (!gain) {
      gain = ctx.createGain();
      gain.gain.value = master;
      connect.call(gain, ctx.destination);
      masters.set(ctx, gain);
      gains.push(gain);
    }
    return gain;
  }
  if (masters && Speakers && typeof connect === 'function' && typeof disconnect === 'function') {
    try {
      Node.connect = function (target) {
        if (!speakers(target)) return connect.apply(this, arguments);
        var args = Array.prototype.slice.call(arguments);
        args[0] = masterOf(target.context);
        connect.apply(this, args);
        return target;
      };
      Node.disconnect = function (target) {
        if (!arguments.length || !speakers(target) || !masters.has(target.context)) return disconnect.apply(this, arguments);
        var args = Array.prototype.slice.call(arguments);
        args[0] = masters.get(target.context);
        return disconnect.apply(this, args);
      };
    } catch (e) {
      /* a browser that keeps them: the game plays at its own volume */
    }
  }

  // An audio or video element plays at the volume the game set times the master; the game reads back its own.
  var Media = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
  var volume = Media && Object.getOwnPropertyDescriptor(Media, 'volume');
  var asked = masters && volume && volume.get && volume.set ? new WeakMap() : null;
  if (asked) {
    try {
      Object.defineProperty(Media, 'volume', {
        configurable: true,
        enumerable: volume.enumerable,
        get: function () {
          return asked.has(this) ? asked.get(this) : volume.get.call(this);
        },
        set: function (value) {
          var n = Number(value);
          // Out of range: the browser's own error, as without the companion.
          if (!(n >= 0 && n <= 1)) return volume.set.call(this, value);
          asked.set(this, n);
          remember(seenMedia, this);
          volume.set.call(this, n * master);
        },
      });
    } catch (e) {
      asked = null;
    }
  }
  function mediaVolume(el) {
    if (!asked || !el) return;
    try {
      if (!asked.has(el)) asked.set(el, volume.get.call(el));
      volume.set.call(el, asked.get(el) * master);
    } catch (e) {
      /* not a media element after all */
    }
  }
  function setMaster(level) {
    if (level === master) return;
    master = level;
    for (var i = gains.length - 1; i >= 0; i--) {
      var gain = gains[i];
      try {
        if (gain.context.state === 'closed') gains.splice(i, 1);
        else gain.gain.setTargetAtTime(level, gain.context.currentTime, 0.03);
      } catch (e) {
        gain.gain.value = level;
      }
    }
    seenMedia.forEach(mediaVolume);
    try {
      var all = win.document.querySelectorAll('audio, video');
      for (var j = 0; j < all.length; j++) mediaVolume(all[j]);
    } catch (e) {
      /* no document yet */
    }
  }

  /* --- the vibration, on every rumble -------------------------------------- */

  var rumble = 1;
  var Haptic = win.GamepadHapticActuator && win.GamepadHapticActuator.prototype;
  var FORCES = ['strongMagnitude', 'weakMagnitude', 'leftTrigger', 'rightTrigger'];
  function scaled(params) {
    if (!params || typeof params !== 'object' || rumble >= 1) return params;
    var out = {};
    for (var key in params) out[key] = params[key];
    FORCES.forEach(function (key) {
      if (typeof out[key] === 'number') out[key] *= rumble;
    });
    return out;
  }
  try {
    if (Haptic && typeof Haptic.playEffect === 'function') {
      var playEffect = Haptic.playEffect;
      Haptic.playEffect = function (type, params) {
        if (rumble <= 0) return Promise.resolve('complete');
        return playEffect.call(this, type, scaled(params));
      };
    }
    if (Haptic && typeof Haptic.pulse === 'function') {
      var pulse = Haptic.pulse;
      Haptic.pulse = function (value, duration) {
        if (rumble <= 0) return Promise.resolve(true);
        return pulse.call(this, Number(value) * rumble, duration);
      };
    }
  } catch (e) {
    /* rumble as the game asks */
  }

  try {
    // Each source node's start() says which context is the game's. In Chromium a buffer source,
    // an oscillator and a constant source each have a start() of their own, which never calls
    // AudioScheduledSourceNode's, so each of those is wrapped as well.
    var wrapStart = function (proto) {
      if (!proto || !Object.prototype.hasOwnProperty.call(proto, 'start') || typeof proto.start !== 'function') return;
      var start = proto.start;
      proto.start = function () {
        remember(seenContexts, this.context);
        if (hushed) holdContext(this.context);
        return start.apply(this, arguments);
      };
    };
    ['AudioScheduledSourceNode', 'AudioBufferSourceNode', 'OscillatorNode', 'ConstantSourceNode'].forEach(function (name) {
      wrapStart(win[name] && win[name].prototype);
    });
    ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
      var proto = win[name] && win[name].prototype;
      if (!proto || typeof proto.resume !== 'function') return;
      var resume = proto.resume;
      proto.resume = function () {
        if (hushed && heldContexts.has(this)) {
          heldContexts.get(this).wanted = true;
          return Promise.resolve();
        }
        return resume.apply(this, arguments);
      };
    });
    if (Media && typeof Media.play === 'function') {
      var play = Media.play;
      Media.play = function () {
        remember(seenMedia, this);
        mediaVolume(this);
        if (hushed) holdMedia(this);
        return play.apply(this, arguments);
      };
    }
  } catch (e) {
    /* a browser without these: nothing to hold */
  }

  /* --- the player's settings, for the game: window.AIHubSettings ----------- */

  var KEY = 'ai-hub:settings';
  var storage = null;
  try {
    storage = win.localStorage;
  } catch (e) {
    /* storage refused: the hub's word alone */
  }
  // A game on the hub's own address (pnpm dev, a local run) keeps nothing: the
  // hub's page would hear every write, as a storage event of its own.
  try {
    if (parent.location.href) storage = null;
  } catch (e) {
    /* the games' own address: the hub cannot be read from here */
  }
  var kept = null;
  function target() {
    try {
      if (typeof win.EventTarget === 'function') return new win.EventTarget();
    } catch (e) {
      /* an old browser: the plain list below */
    }
    var fns = [];
    return {
      addEventListener: function (type, fn) {
        if (type === 'change' && typeof fn === 'function' && fns.indexOf(fn) === -1) fns.push(fn);
      },
      removeEventListener: function (type, fn) {
        var at = fns.indexOf(fn);
        if (at !== -1) fns.splice(at, 1);
      },
      dispatchEvent: function (event) {
        fns.slice().forEach(function (fn) {
          try {
            fn(event);
          } catch (e) {
            /* the game's own listener */
          }
        });
        return true;
      },
    };
  }

  var api = target();
  api.version = 1;
  api.music = 1;
  api.effects = 1;
  api.vibration = 1;
  api.mic = false;
  api.micLater = false;
  api.muted = false;
  var pad = { connected: false, lightbar: false, triggers: false, motion: false, touchpad: false, speaker: false, aim: false };
  api.dualsense = pad;

  var settle;
  var settled = new Promise(function (resolve) {
    settle = resolve;
  });
  if (win.setTimeout) win.setTimeout(function () { settle(); }, 1500);

  /* The motion and touches, sent by the hub once a frame after the game first reads them. */
  var still = function () {
    return { gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 }, touches: [] };
  };
  var motion = still();
  var clock = win.performance && typeof win.performance.now === 'function' ? win.performance : Date;
  var motionAt = -Infinity;
  var reading = false;
  /**
   * When the game last read the motion itself: while it does, it aims with it
   * as it likes and motion aim leaves its stick alone. A game that stops (a
   * gyro aim of its own turned off) gives the stick back half a second later.
   */
  var ownAt = -Infinity;
  var OWN_STALE = 500;
  /** The player's Motion aim, while the extras are on. */
  var aimOn = false;
  var aiming = function () {
    return aimOn && clock.now() - ownAt > OWN_STALE;
  };
  var wanting = false;
  /** Tell the hub whether to send the motion: while the game reads it, or motion aim needs it. */
  function want() {
    var next = reading || aiming();
    if (next === wanting) return;
    wanting = next;
    post({ hubFrame: 'ds-want', input: next });
  }
  function read(field) {
    reading = true;
    if (field !== 'touches') ownAt = clock.now();
    want();
    return motion[field];
  }
  Object.defineProperty(pad, 'gyro', { enumerable: true, get: function () { return read('gyro'); } });
  Object.defineProperty(pad, 'accel', { enumerable: true, get: function () { return read('accel'); } });
  Object.defineProperty(pad, 'touches', { enumerable: true, get: function () { return read('touches'); } });

  /* --- motion aim: the DualSense's turns on its right stick ---------------- */

  // Turning the controller left or right moves the stick left or right, and
  // tipping its front up or down moves it up or down, the faster the further.
  var AIM_STILL = 4; // degrees a second: a hand holding still, and what calibration leaves
  var AIM_FULL = 150; // degrees a second beyond that: the stick all the way over
  var AIM_FLOOR = 0.2; // where a turn starts the stick: past the dead zone most games keep (0.12 to 0.18)
  var AIM_STALE = 250; // milliseconds without the hub's word: the controller is still
  var DUALSENSE = /dualsense|054c.*(0ce6|0df2)/i;
  function turn(speed) {
    var past = Math.abs(speed) - AIM_STILL;
    if (!(past > 0)) return 0;
    var push = AIM_FLOOR + (1 - AIM_FLOOR) * Math.min(1, past / AIM_FULL);
    return speed < 0 ? -push : push;
  }
  var axis = function (n) {
    return n < -1 ? -1 : n > 1 ? 1 : n;
  };
  /** `p` with the turns on its right stick: the browser's own pad behind it, every other part as it is. */
  function aimed(p) {
    if (clock.now() - motionAt > AIM_STALE) return p;
    var x = turn(-motion.gyro.y);
    var y = turn(-motion.gyro.x);
    if (!x && !y) return p;
    var axes = Array.prototype.slice.call(p.axes);
    if (axes.length < 4) return p;
    axes[2] = axis(axes[2] + x);
    axes[3] = axis(axes[3] + y);
    // A game that waits for the pad's timestamp to move sees the turn as new.
    var at = clock === Date ? -Infinity : motionAt;
    return new Proxy(p, {
      get: function (real, key) {
        if (key === 'axes') return axes;
        if (key === 'timestamp') return Math.max(real.timestamp, at);
        return Reflect.get(real, key);
      },
    });
  }
  if (typeof browserPads === 'function' && typeof Proxy === 'function' && typeof Reflect === 'object') {
    try {
      var was = Object.getOwnPropertyDescriptor(padsAt, 'getGamepads');
      Object.defineProperty(padsAt, 'getGamepads', {
        configurable: true,
        enumerable: was ? was.enumerable : true,
        writable: true,
        value: function getGamepads() {
          var list = browserPads.apply(this, arguments);
          if (!aiming() || !list) return list;
          var out = [];
          var done = false;
          for (var i = 0; i < list.length; i++) {
            var p = list[i];
            if (!done && p && p.connected && p.mapping === 'standard' && DUALSENSE.test(p.id)) {
              done = true;
              out.push(aimed(p));
            } else out.push(p);
          }
          return out;
        },
      });
    } catch (e) {
      /* the browser keeps its own: no motion aim */
    }
  }

  var light;
  pad.light = function (colour) {
    var next = typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : null;
    if (next === light) return;
    light = next;
    post({ hubFrame: 'ds-light', colour: next });
  };
  var effects = {};
  pad.trigger = function (which, effect) {
    if (which !== 'left' && which !== 'right' && which !== 'both') return;
    var next = null;
    if (effect && typeof effect === 'object' && typeof effect.kind === 'string' && effect.kind !== 'off') {
      next = { kind: effect.kind };
      ['from', 'to', 'strength', 'frequency'].forEach(function (key) {
        if (typeof effect[key] === 'number' && isFinite(effect[key])) next[key] = effect[key];
      });
    }
    var key = JSON.stringify(next);
    var sides = which === 'both' ? ['left', 'right'] : [which];
    if (sides.every(function (side) { return effects[side] === key; })) return;
    sides.forEach(function (side) {
      effects[side] = key;
    });
    post({ hubFrame: 'ds-trigger', which: which, effect: next });
  };

  /** The DualSense's own input or output among the browser's devices, which it names only once the microphone is allowed. */
  function controllerDevice(kind) {
    var devices = win.navigator.mediaDevices;
    if (!devices || !devices.enumerateDevices) return Promise.resolve(null);
    return devices.enumerateDevices().then(function (list) {
      for (var i = 0; i < list.length; i++) if (list[i].kind === kind && /dualsense/i.test(list[i].label)) return list[i].deviceId;
      return null;
    }, function () {
      return null;
    });
  }

  /** A node in the game's `context` that plays from the DualSense's speaker, or null. */
  pad.openSpeaker = function (context) {
    return settled.then(function () {
      if (!pad.speaker || !context || typeof context.createMediaStreamDestination !== 'function' || !win.Audio) return null;
      return controllerDevice('audiooutput').then(function (id) {
        if (!id) return null;
        var out = context.createMediaStreamDestination();
        var el = new win.Audio();
        if (typeof el.setSinkId !== 'function') return null;
        el.srcObject = out.stream;
        return el.setSinkId(id).then(function () {
          var playing = el.play();
          if (playing && playing.catch) playing.catch(function () {});
          return out;
        });
      });
    }).then(null, function () {
      return null;
    });
  };

  var streams = [];
  function quiet() {
    streams.forEach(function (stream) {
      stream.getAudioTracks().forEach(function (track) {
        track.enabled = api.mic && !api.muted; // (the microphone taken back in Settings, or muted: silent at once)
      });
    });
  }
  /** A microphone stream, the DualSense's when one is plugged in, once the player allowed games the microphone; else null. */
  api.openMicrophone = function () {
    return settled.then(function () {
      var devices = win.navigator.mediaDevices;
      if (!api.mic || !devices || !devices.getUserMedia) return null;
      return controllerDevice('audioinput').then(function (id) {
        return devices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
      }).then(function (stream) {
        streams.push(stream);
        quiet();
        return stream;
      });
    }).then(null, function () {
      return null;
    });
  };

  var shown = '';
  function view() {
    return JSON.stringify([api.music, api.effects, api.vibration, api.mic, api.micLater, api.muted, pad.connected, pad.lightbar, pad.triggers, pad.motion, pad.touchpad, pad.speaker, pad.aim]);
  }
  /** The hub's word, made the game's: the master and the vibration applied here, the rest on AIHubSettings. */
  function apply(settings, tell) {
    if (!settings || typeof settings !== 'object') return;
    var volumes = settings.volume || {};
    setMaster(unit(volumes.master, 1));
    rumble = unit(settings.vibration, 1);
    api.music = unit(volumes.music, 1);
    api.effects = unit(volumes.effects, 1);
    api.vibration = rumble;
    api.mic = settings.mic === true;
    api.micLater = settings.micLater === true;
    api.muted = settings.muted === true;
    var ds = settings.dualsense && typeof settings.dualsense === 'object' ? settings.dualsense : null;
    pad.connected = Boolean(ds);
    pad.lightbar = Boolean(ds && ds.lightbar);
    pad.triggers = Boolean(ds && Number(ds.triggers) > 0);
    pad.motion = Boolean(ds);
    pad.touchpad = Boolean(ds);
    pad.speaker = Boolean(ds && ds.speaker);
    pad.aim = Boolean(ds && ds.aim === true);
    aimOn = pad.aim;
    if (!ds) {
      motion = still();
      motionAt = -Infinity;
    }
    want();
    quiet();
    var now = view();
    if (now === shown) return;
    shown = now;
    if (!tell) return;
    var event;
    try {
      event = new win.Event('change');
    } catch (e) {
      event = { type: 'change' };
    }
    try {
      api.dispatchEvent(event);
    } catch (e) {
      /* the game's own listener */
    }
  }
  try {
    kept = storage && storage.getItem(KEY);
    apply(JSON.parse(kept), false);
  } catch (e) {
    /* nothing kept yet */
  }
  win.AIHubSettings = api;

  /* --- the hub's word ------------------------------------------------------ */

  if (hushed) watchPage(true);
  var onMessage = function (event) {
    if (event.source !== parent) return;
    var m = event.data;
    if (!m || typeof m !== 'object' || !m.hubFrame) return;
    if (m.hubFrame === 'pads') {
      wantPads = Boolean(m.want);
      last = '';
      if (wantPads && !raf) raf = win.requestAnimationFrame(tick);
    } else if (m.hubFrame === 'hush') hush(Boolean(m.on));
    else if (m.hubFrame === 'settings') {
      apply(m.settings, true);
      settle();
      try {
        var text = JSON.stringify(m.settings);
        if (storage && text !== kept) storage.setItem(KEY, (kept = text));
      } catch (e) {
        /* kept for this page only */
      }
    } else if (m.hubFrame === 'ds-input' && pad.connected) {
      motionAt = clock.now();
      var n = function (list, i) {
        var value = list && Number(list[i]);
        return isFinite(value) ? value : 0;
      };
      motion = {
        gyro: { x: n(m.gyro, 0), y: n(m.gyro, 1), z: n(m.gyro, 2) },
        accel: { x: n(m.accel, 0), y: n(m.accel, 1), z: n(m.accel, 2) },
        touches: (Array.isArray(m.touches) ? m.touches : []).slice(0, 2).map(function (t) {
          return { id: n(t, 0), x: unit(t && t[1], 0), y: unit(t && t[2], 0) };
        }),
      };
    }
  };

  /* --- the window's listeners, kept through a page written anew ----------- */

  // A game that writes its page anew (document.open, as my-3D2dge's play
  // file opens each of its games; or document.write or writeln once the page
  // has loaded, which open it themselves, past this wrapper) has the browser
  // erase every listener on its window: the companion's are added again as
  // open(), write() or writeln() returns, so the hub's word still reaches the
  // game. Adding one that is still there does nothing (a write while the page
  // is still parsing erases nothing).
  function listen() {
    win.addEventListener('mousemove', onMouse, { passive: true, capture: true });
    win.addEventListener('touchstart', onTouch, { passive: true, capture: true });
    win.addEventListener('message', onMessage);
  }
  listen();
  try {
    var docProto = win.Document && win.Document.prototype;
    var open = docProto && docProto.open;
    if (typeof open === 'function') {
      docProto.open = function () {
        var opened = open.apply(this, arguments);
        // (with three arguments it is window.open: the page stays as it is)
        if (this === win.document && arguments.length < 3) listen();
        return opened;
      };
    }
    ['write', 'writeln'].forEach(function (name) {
      var own = docProto && docProto[name];
      if (typeof own !== 'function') return;
      docProto[name] = function () {
        var done = own.apply(this, arguments);
        if (this === win.document) listen();
        return done;
      };
    });
  } catch (e) {
    /* the browser keeps its own: such a game loses the hub's word */
  }
  post({ hubFrame: 'hello' });
})(window);
