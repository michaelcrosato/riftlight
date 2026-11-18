// The film's scenarios and its script language (scripts/film.ts runs them in the browser;
// src/riftlight/combat/film.arena.test.ts plays the Arena's headless, so a scenario that presses a
// key the Arena doesn't read goes red there, not in a film of a hero who never moves).

/** Named scenarios (`npm run film -- <name>`): scripts in the language `parse` reads. */
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
  'arena-skills': 'place 0 0 3.5 180; tap E; wait 34; tap R; wait 40; tap T; until idle 120; wait 20',
  'arena-run-cast': 'place -8 0 2 90; down D; wait 20; tap E; wait 26; up D; until idle 40; wait 10',
  'arena-whirlwind': 'place 0 0 2.5 180; down F; wait 70; up F; until idle 40; wait 10',
  // Rift Runner, the arcade side-scroller (?game=arcade, src/riftlight/showcase/arcade): its moves in context
  'arcade-pit': 'place 8 0 0 90; down D; wait 26; tap SPACE; until grounded 90; wait 10; up D; wait 20',
  'arcade-ledge': 'place 18 0 0 90; down D; wait 14; tap SPACE; until grounded 90; tap SPACE; until grounded 120; up D; wait 25',
  'arcade-chimney': 'place 36.8 0 0 90; down D; wait 6; tap SPACE; until wallSlide 60; up D; tap SPACE; until grounded 120; wait 20',
  'arcade-pound': 'place 45.5 5.4 0 90; wait 10; tap SPACE; wait 14; tap C; until grounded 150; wait 40',
  // each step of the basic combo on its own (2 and 3 chain through the steps before them)
  'arena-slash1': 'place 0 0 0.9 180; tap J; until idle 60; wait 15',
  'arena-slash2': 'place 0 0 0.9 180; tap J; wait 7; tap J; until idle 60; wait 15',
  'arena-slash3': 'place 0 0 0.9 180; tap J; wait 7; tap J; wait 7; tap J; until idle 80; wait 20',
  // every skill delivery kind, on the first slot (Q)
  'arena-strike': 'place 0 0 1.2 180; skills cleave; tap Q; until idle 60; wait 15',
  'arena-slam': 'place 0 0 1.4 180; skills ground-slam; tap Q; until idle 80; wait 15',
  'arena-projectile': 'place 0 0 3.5 180; skills fireball; tap Q; until idle 60; wait 20',
  'arena-nova': 'place 0 0 2 180; skills frost-nova; tap Q; until idle 60; wait 20',
  'arena-beam': 'place 0 0 3.5 180; skills searing-beam; down Q; wait 50; up Q; until idle 40; wait 15',
  'arena-dash': 'place 0 0 5 180; skills shield-charge; tap Q; until idle 60; wait 20',
  'arena-summon': 'place 0 0 3.5 180; skills summon-skeletons; tap Q; until idle 80; wait 20',
  'arena-aura': 'place 0 0 3.5 180; skills haste-aura; tap Q; until idle 60; wait 20',
  'arena-trap': 'place 0 0 3.5 180; skills fire-trap; tap Q; until idle 60; wait 20',
  'arena-curse': 'place 0 0 3.5 180; skills vulnerability; tap Q; until idle 60; wait 20',
  'arena-totem': 'place 0 0 3.5 180; skills fireball+spell-totem; tap Q; until idle 90; wait 20',
  'arena-warcry': 'place 0 0 3 180; skills war-cry; tap Q; until idle 60; wait 20',
  'arena-leap': 'place 0 0 4.5 180; skills leap-slam; tap Q; until idle 90; wait 20',
  // weapons: the bow draws a real string, staves and wands point at the target
  'arena-bow': 'place 0 0 4.5 180; weapon bow; skills split-arrow; tap Q; until idle 60; tap Q; until idle 60; wait 15',
  'arena-staff': 'place 0 0 4 180; weapon staff 2h; skills fireball,frost-nova; tap Q; until idle 60; tap E; until idle 60; wait 15',
  'arena-wand': 'place 0 0 4 180; weapon wand; skills fireball; tap Q; until idle 60; wait 15',
  'arena-axe': 'place 0 0 0.9 180; weapon axe; tap J; wait 7; tap J; wait 7; tap J; until idle 80; wait 15',
  // the dodge roll in 8 directions from a standstill
  'arena-roll8': 'place 0 0 3 180; ' + ['W', 'W+D', 'D', 'S+D', 'S', 'S+A', 'A', 'W+A'].map((k) => `down ${k}; tap SPACE; up ${k}; until idle 60; wait 8`).join('; '),
  // taking a heavy hit, then going down
  'arena-hurt': 'place 0 0 3 180; wait 10; hurt 0.2 0 -1; wait 40; hurt 0.25 1 0; wait 40',
  'arena-death': 'place 0 0 3 180; wait 10; kill; wait 110',
};

/** Scenarios that run in another game than the playground (`?game=`). */
export const SCENARIO_GAME = (name: string): string | null => (name.startsWith('arena') ? 'arena' : name.startsWith('arcade') ? 'arcade' : null);

export const KEYS: Record<string, string> = {
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', SPACE: 'Space', SHIFT: 'ShiftLeft', C: 'KeyC', J: 'KeyJ', F: 'KeyF', Z: 'KeyZ', X: 'KeyX', B: 'KeyB', V: 'KeyV',
  // Riftlight's skill bar on the game's key map (game/controls.ts `heroCodes`: RMB / 1 / Q, 2 / E,
  // 3 / R, 4 / T, the Arena's fifth F) and the mouse buttons (the engine's keys for them)
  Q: 'KeyQ', E: 'KeyE', R: 'KeyR', T: 'KeyT', LMB: 'MouseLeft', RMB: 'MouseRight',
};

/** One command of a script. */
export type Cmd = { op: string; keys: string[]; n: number[]; word: string };
/** A script's commands; an unknown key or command throws (a scenario that names a key nothing reads fails loudly). */
export function parse(src: string): Cmd[] {
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
