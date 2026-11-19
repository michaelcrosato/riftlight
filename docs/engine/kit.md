# The engine kit (`npm run bundle`)

Games outside this repo use the engine through a kit (`scripts/bundle.mjs`; `npm run build`
also writes it to `dist/engine/` and `dist/engine.zip`, which the e2e suite `bundle` checks; there
is no hosted copy, agents get a GitHub Release or build it: README.md, *Handing the engine to
another agent*):

- `pixel-engine.js`: a Vite library build of `src/bundle.ts`, one self-contained ES module
  (about 4.8 MB, 1.6 MB gzipped). It exports the public engine API (`src/engine/index.ts`),
  three.js as `THREE` and `TSL` (a game must never load a second copy), `RAPIER`, the hero kit
  and `BUILTIN_MODELS`. Everything is inlined: Rapier's wasm as a data URL (`?url`), the
  engine CSS (injected on import, before the page's own), and `public/assets/*.glb` through
  `__PIXEL_BUILTINS__` → `window.__PIXEL_ASSETS__`, which `loadModel` reads first. Built with
  `base: './'`, so a game's own `assets/x.glb` resolves next to its page.
  Imported packs are never inlined: they ship as `packs/<id>.json` (`scripts/bundle.mjs`), and
  a game loads only the ones it uses (`loadPack`).
- `GUIDE.md` (docs/GUIDE.md, stamped with the version and build): the manual. Its fenced
  blocks `js <name>` are whole games: `quickstart` becomes the kit's `game.js` (+ `index.html`),
  the others `examples/<name>.html`; its section 5 names every game page of the kit (its own Cliff
  Run and the other guides'). `src/guide.test.ts` checks that they import only real exports, that
  it names exactly the kit's pages, that its lists (palette, looks, filters, sounds, particles,
  cameras, URL flags, built-in models) are the engine's and that the starter's legend fits the HUD
  at every window shape (played headless, a phone held either way too, and as a touch page at the
  `touchDensity` it passes: about two CSS pixels a pixel, sideways too); the `bundle` e2e suite
  plays every one of them.
- `CONTROLS.md` (docs/GUIDE-CONTROLS.md, stamped): the standard every game built on the kit meets
  (controller first at ten feet, keyboard and mouse native, prompts for the device in use, menus,
  touch as an add-on, the player's 52in1 settings and the DualSense, sessions in every online mode
  and moments, the head tags, play on one device), as a checklist, then recipes. Its blocks are
  Beacon Yard and Gem Rush, `examples/beacon-yard.html` and `examples/gem-rush.html`; its `html
  gem-rush` fence is Gem Rush's head (`guideHeads`), which its page carries after 52in1's session
  client (`scripts/hub/session.js`, byte for byte: `examplePage`), so the page joins a round as
  handed out.
  `src/guide-controls.test.ts` checks their imports, plays both headless (prompts follow the device,
  Options pauses as it is let go and never under 52in1's chord; a moment in a `LocalHub` round
  readies up by itself and reports once), checks the codes and names its prose and its unnamed code
  give (a dotted one walked member by member on a live engine and session, `Game.<x>` one of the
  `Game` hooks, a bare option or field such as `touchDensity: 2` or `micLater` one the engine's
  source declares: `EngineOptions`, the touch controls, the HUD, 52in1's settings), runs the page
  the kit writes for Gem Rush through 52in1's catalogue checker (`checkPage`,
  `scripts/hub/catalogue-check.mjs`) and holds its budget; every text the games draw lies inside the
  HUD, clear of the others and in whole words, in every state, on a phone held either way, a
  360x1000 window and a TV; what a player needs is in view at every window shape (Gem Rush's whole
  arena, every beacon from Beacon Yard's start: both pass the camera a `minWidth`, so a phone held
  upright zooms out, past `minZoom` for a 360x1000 window); the player's wheel and + / - zoom both
  and the zoom stays; Gem Rush alone plays again once it is over. The `bundle` e2e suite plays Gem
  Rush's own page in a `LocalHub` round (no ⚙, Esc and Options never pause it) and in 52in1's
  session harness (a parallel round of two), and every game page
  of the kit (the starter, Cliff Run, both games here, RECIPES.md's and Market Corner) on a phone
  (Playwright's touch screen, upright and sideways, real taps) and on a TV with a fake pad, in every
  state a player reaches (playing, a menu, the settings, won and lost, a 52in1 round's start, Look
  Lab's looks): each has the touch buttons its guide gives it (Beacon Yard's LIGHT only by a dark
  beacon, none over its menu; none on Market Corner, nothing to press), the pad's legend on a TV,
  every HUD text lies inside the HUD and clear of the controls (the stick, its zone, a button, the
  ⚙) and other texts, every tap target is reachable, and a phone held sideways shows the art at two
  CSS pixels a pixel at least.
- `RECIPES.md` (docs/GUIDE-RECIPES.md, stamped): more whole games, each meeting CONTROLS.md's
  checklist the same way (a `controls` table and a legend of the device's controls, touch buttons of
  its own, `touchDensity: 2`, the HUD from `hud.width` clear of the ⚙ and the controls, the camera's
  `minWidth`): Lantern Night (`examples/top-down.html`) and Look Lab
  (`examples/looks.html`, looks picked by Q / E, L1 / R1 or touch buttons). GUIDE.md section 5 has a
  line for each. `src/guide-recipes.test.ts` checks its imports, names and budget, then plays every
  recipe of the kit headless (Cliff Run, these two, Market Corner; CONTROLS.md's games are its own
  test's): every text inside the HUD, clear of the others and in whole words, in every state on
  every device, on a phone held either way, a 360x1000 window and a TV (a legend there on the
  keyboard and a pad); what a player needs in view at every window shape and under no text; the
  player's wheel and + / - zoom each, and the zoom stays.
- `ASSETS.md` (docs/GUIDE-ASSETS.md, stamped): models and textures for outside agents, written for
  someone with only the kit (docs/ASSETS.md stays the in-repo guide). Its blocks are Market
  Corner, `examples/market.html`, and the module of the game's own models it imports
  (`examples/market-models.js`, no page: a block that doesn't start the engine is a module).
  `src/guide-assets.test.ts` checks its imports, names, lists and budget and runs the models
  module through `checkModel`; the `bundle` e2e suite plays the scene and draws the module's sheets.
- `LIBRARY.md` and `CREDITS.md`, generated by `scripts/bundle/assets.ts` (loaded through tsx):
  every built-in model and texture (id, size, params, slots, about), and where everything the kit
  carries came from (each def's `source`, as `npm run model -- credits` reads it, and three.js's
  and Rapier's licence texts).
- `API.md`: every export with its signature and doc comment, grouped by subsystem, generated
  from the TypeScript program (`scripts/bundle/api.mjs`), nothing cut: whole docs (a member's
  later paragraphs indented under its bullet), whole types (no `... 4 more ...`;
  `src/bundle-api.test.ts`). Mark a public member that games
  shouldn't use `/** @internal */`: it leaves API.md and the `.d.ts`.
- `pixel-engine.d.ts` + `types/`: declarations (`stripInternal`); a strict TypeScript game
  typechecks against them (the `bundle` e2e suite does it).
- `check.mjs` (`scripts/bundle/check.mjs`): the receiving agent's test tool (Playwright beside
  the game or installed globally, found through `npm root -g`). It serves the kit
  folder, plays a page in headless Chromium on WebGPU (`--keys KeyD*60,Space*4`, where a pad's
  button, d-pad (`PadUp` ...) or stick (`PadLStick:1,0`, y up) is held on a fake standard pad so
  the pad's prompts show, `Mouse@x,y` / `MouseLeft@x,y` point and click at art pixels with the
  browser's own mouse, and any other code is refused; `--cameras`, `--looks`; a page
  with `?touch=1` plays as on a phone, Playwright's touch screen, touch the device in use, and adds
  `<page>-page.png`, the page with its touch controls, and the controls' rects as `report.touch`),
  saves PNGs with the HUD and a `report.json`, and exits 1 on any page,
  console, game or GPU error or a blank frame. `--sheets models.js,crate` plays no page: it
  imports the module and the engine on an empty page and draws, with the engine's `modelSheet`
  and `textureSheet` (the software rasterizer the CLIs use), a sheet of every def the module
  exports and of library ids; exit 1 on any problem. `--headless game.js` plays no browser: it
  boots the module's `createGame()` with `Engine.headless` in Node, plays the `--keys` frames,
  replays the recording in a fresh game and writes `report.json`; exit 1 on an error or a replay
  that ends elsewhere (no pictures: those need the browser).
- `CHANGELOG.md`, `README.md` (generated: what is where, sizes, token estimates, where newer
  versions are) and `manifest.json` (version, build, every file with its bytes, and `latest`,
  `releases` and `source`: the newest release's zip, every release and the repository, from
  `package.json`'s `repository`, so a game finds its
  upgrades). The kit is a GitHub Release per engine version, `engine-v<version>`,
  holding its zip: CI's `release` job publishes the version of `main`'s newest commit once check
  and e2e pass (a version superseded on `main` before then is skipped) (`scripts/release/notes.mjs` writes its notes from the version's `CHANGELOG.md`
  section).

Diagnostics that make the kit self-correcting live in the engine: `Engine.start` sets
`window.__PIXEL_ENGINE__` (`dispose()` clears it); an exception in a game hook is caught per
frame, kept once in `engine.errors` (at most 20; also `state().errors`), logged and shown in a
box (`[data-engine-error]`) while the loop keeps running; `step()` throws it to its caller
instead (tools); a failed start shows "Failed to start: ..." in `.fatal`. Games start with
`withUrlOptions(options)`, so the URL's review flags (`?look=`, `?camera=`, `?zoom=`,
`?debug=1`) work in any kit game without replacing its own camera.
`ENGINE_VERSION` comes from `package.json` (`__ENGINE_VERSION__` in `vite.config.ts`).

## Build size

`npm run build` prints the gzipped sizes: `three`, Rapier's JS and its `rapier_wasm3d_bg.wasm`
(fetched and compiled while it streams, in parallel with the renderer and models), and the engine and
game chunks (`hero`: the engine, the animation toolkit and every hero clip as data, shared with the
Animation Lab; `main`: the playground and game systems). `vite.config.ts` has a tiny
`rapier-wasm-stub` plugin: wasm-bindgen's bundler build imports the `.wasm` as an ES module, which
the plugin stubs out so `initRapier()` can instantiate it explicitly (no top-level await blocking the
app). Serve `.wasm` compressed (gzip/brotli; most static hosts and CDNs do, `vite preview` does not):
uncompressed it is 2.0 MB on the wire instead of 774 kB.
