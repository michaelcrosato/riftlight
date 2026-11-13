/**
 * The lines of the showcase: the arcade, the Hall of Beasts, photo mode (showcase/). docs/game/lang.md has the rules for a line.
 * Control hints are one line each (`showcase.hint.<name>`, `HINTS`), shown in a row; photo mode's
 * looks come from the engine's filter presets and filters, so a new one brings its line along.
 */
import { FILTER_IDS, FILTER_PRESETS, getFilter } from '../../engine';
import type { LineArea } from './area';
import { lineKey } from './area';

/**
 * One control hint per line, `{key:<action>}` and what it does; `showcase/hints.ts` shows a row
 * of them. Actions beyond the shell's own: `move` (WASD / arrows / stick), `jump` (the arcade's
 * Space), `pound` (the arcade's C), `confirm` (Enter), `turn` (the Hall: mouse or Q / E),
 * `drag` (photo mode: drag the mouse), `orbit` (the Hall's card: drag or Q / E), `rise`
 * (photo mode: Q / E), `switch_view` (Tab / pad Y), `next_wing` (N), `photo_save` (P / pad X).
 */
export const HINTS = {
  run: '{key:move} run',
  jump: '{key:jump} jump',
  pound: '{key:pound} pound',
  leave: '{key:pause} leave',
  again: '{key:confirm} again',
  move: '{key:move} move',
  look: '{key:turn} look',
  fly: '{key:switch_view} fly',
  walk: '{key:switch_view} walk',
  next_wing: '{key:next_wing} next wing',
  photo: '{key:photo} photo',
  orbit: '{key:orbit} orbit',
  zoom: '{key:zoom} zoom',
  back: '{key:pause} back',
  fly_camera: '{key:move} {key:rise} fly',
  drag_look: '{key:drag} look',
  field_of_view: '{key:zoom} field of view',
  edit: '{key:switch_view} edit',
  save: '{key:photo_save} save',
  hide: '{key:hide} hide',
  show: '{key:hide} show',
  pick: '{key:move} pick and change',
  change: '{key:confirm} change',
} as const;

export type HintName = keyof typeof HINTS;

/** Monster animations the Hall's card plays, by clip name (an unknown clip shows its name). */
const CLIPS: Readonly<Record<string, string>> = {
  Idle: 'Idle',
  Stand: 'Stand',
  Walk: 'Walk',
  Run: 'Run',
  Hit: 'Hit',
  Death: 'Death',
  Spawn: 'Spawn',
  Bite: 'Bite',
  Claw: 'Claw',
  Slam: 'Slam',
  Spit: 'Spit',
  Cast: 'Cast',
  Charge: 'Charge',
  ChargeWindup: 'Charge windup',
  Explode: 'Explode',
  Leap: 'Leap',
  Summon: 'Summon',
  TailWhip: 'Tail whip',
};

/** Photo looks whose name isn't their key in words. */
const PRESET_NAMES: Readonly<Record<string, string>> = { playstation: 'PlayStation', vhs_rental: 'VHS rental' };

/** A preset's name from its key (`home_computer` → "Home computer"). */
const presetName = (key: string): string => {
  const words = key.replace(/_/g, ' ');
  return PRESET_NAMES[key] ?? words.charAt(0).toUpperCase() + words.slice(1);
};

const FIXED: LineArea = {
  lines: {
    'showcase.loading': 'Loading',
    // the places in town
    'showcase.arcade.name': 'Rift Runner',
    'showcase.prompt.arcade': 'Play {game}',
    'showcase.verb.play': 'Play',
    'showcase.bestiary.name': 'Hall of Beasts',
    'showcase.prompt.bestiary': 'Enter the Hall of Beasts',
    'showcase.verb.enter': 'Enter',
    'showcase.prompt.world': 'Step into Engine World',
    'showcase.prompt.gallery': 'Browse the Asset Gallery',
    'showcase.verb.visit': 'Visit',
    // the arcade
    'showcase.arcade.best': 'Best {time}',
    'showcase.arcade.best_none': 'Best --:--.--',
    'showcase.arcade.ready': 'Ready?',
    'showcase.arcade.go': 'Go!',
    'showcase.arcade.clear': 'Course clear!',
    'showcase.arcade.time': 'Time {time}',
    'showcase.arcade.time_new_best': 'Time {time}  New best!',
    'showcase.arcade.coins_par': 'Coins {coins}/{total}   Par {par}',
    'showcase.arcade.reward': '+{gold} gold',
    // the Hall of Beasts
    'showcase.bestiary.summary': '{species} · {kills}',
    'showcase.bestiary.summary_wing': '{species} · {kills} · wing {wing}/{wings}',
    'showcase.bestiary.species': { one: '{count} species', other: '{count} species' },
    'showcase.bestiary.kills': { one: '{count} kill', other: '{count} kills' },
    'showcase.bestiary.plaque': 'x{kills}  depth {first}',
    'showcase.bestiary.plaque_range': 'x{kills}  depth {first}-{last}',
    'showcase.bestiary.empty': 'The pedestals are empty',
    'showcase.bestiary.empty_hint': 'Slay monsters in the rifts to fill the hall',
    'showcase.bestiary.prompt.altar': 'Breed at the rift altar',
    'showcase.bestiary.prompt.inspect': 'Inspect {name}',
    'showcase.bestiary.rank_plan': '{rank} {plan}',
    'showcase.bestiary.rank.normal': 'Normal',
    'showcase.bestiary.rank.magic': 'Magic',
    'showcase.bestiary.rank.rare': 'Rare',
    'showcase.bestiary.rank.boss': 'Boss',
    'showcase.bestiary.archetype': 'Archetype: {name}',
    'showcase.bestiary.kills_depth': 'Kills {kills} · depth {first}',
    'showcase.bestiary.kills_depth_range': 'Kills {kills} · depth {first}-{last}',
    'showcase.bestiary.altar': 'The rift altar',
    'showcase.bestiary.altar_hint': 'Crossover + mutate two kills',
    'showcase.bestiary.generation': 'Generation {generation} · {plan}',
    'showcase.bestiary.parts_seed': { one: '{count} part · seed {seed}', other: '{count} parts · seed {seed}' },
    'showcase.bestiary.pick_parents': 'Pick two parents, then breed',
    'showcase.bestiary.turntable_on': 'Turntable: on',
    'showcase.bestiary.turntable_off': 'Turntable: off',
    'showcase.bestiary.back': 'Back',
    'showcase.bestiary.breed': 'Breed',
    'showcase.bestiary.mutate': 'Mutate child',
    'showcase.bestiary.none': 'None',
    // photo mode
    'showcase.photo.title': 'Photo mode',
    'showcase.photo.sub.fly': 'Fly',
    'showcase.photo.sub.edit': 'Edit',
    'showcase.photo.row.look': 'Look',
    'showcase.photo.row.mode': 'Render',
    'showcase.photo.row.res': 'Art res',
    'showcase.photo.row.time': 'Time',
    'showcase.photo.row.sun': 'Sun',
    'showcase.photo.row.ambient': 'Ambient',
    'showcase.photo.row.light': 'Fill light',
    'showcase.photo.row.capture': 'Save PNG',
    'showcase.photo.row.exit': 'Back to game',
    'showcase.photo.mode.pixel': 'Pixel',
    'showcase.photo.mode.raw': 'Raw',
    'showcase.photo.light.off': 'Off',
    'showcase.photo.light.warm': 'Warm',
    'showcase.photo.light.cold': 'Cold',
    'showcase.photo.light.rift': 'Rift',
    'showcase.photo.light.ember': 'Ember',
    'showcase.photo.saved': 'Saved {file}',
  },
  notes: {
    'showcase.loading': 'While the arcade or the Hall of Beasts is built (animated dots follow it).',
    'showcase.arcade.name': 'The arcade cabinet’s game in the town (a side-scroller where the hero runs, jumps and collects coins): an invented game title, translate it as a catchy title.',
    'showcase.prompt.arcade': 'Prompt at the arcade cabinet; {game} is the game’s title. The key to press is drawn before it.',
    'showcase.verb.play': 'The touch button at the arcade cabinet (one word).',
    'showcase.bestiary.name': 'A gallery in town where every kind of monster the hero has killed stands on a pedestal. Its name, and the title over it.',
    'showcase.prompt.bestiary': 'Prompt at the Hall of Beasts’ lectern; the key to press is drawn before it.',
    'showcase.verb.enter': 'The touch button at the Hall of Beasts (one word).',
    'showcase.prompt.world': 'Prompt at the Engine Workshop’s glowing ring in town: going through leaves the game for Engine World, a separate tech demo of the game engine (a name, as on the title screen). The key to press is drawn before it.',
    'showcase.prompt.gallery': 'Prompt at the Engine Workshop’s easel in town: leaves the game for the Asset Gallery, every 3D model and texture the game has (a name, as on the title screen). The key to press is drawn before it.',
    'showcase.verb.visit': 'The touch button at the Engine Workshop (one word): go to Engine World or the Asset Gallery.',
    'showcase.arcade.best': 'The arcade’s best time, top right ({time} like 01:23.45).',
    'showcase.arcade.best_none': 'The arcade’s best time before any finish (the dashes stand for the digits).',
    'showcase.arcade.ready': 'Big, before the arcade run starts.',
    'showcase.arcade.go': 'Big, the moment the arcade run starts. Very short.',
    'showcase.arcade.clear': 'Big title of the results card when the arcade course is finished.',
    'showcase.arcade.time_new_best': 'Results card: the run’s time, and it beat the best time.',
    'showcase.arcade.coins_par': 'Results card: coins taken of all coins, and the par time (the time to beat).',
    'showcase.arcade.reward': 'Results card: the gold the run paid out.',
    'showcase.bestiary.summary': 'Under the Hall’s title: how many kinds of monster ({species}: "12 species") and how many kills ({kills}: "40 kills").',
    'showcase.bestiary.summary_wing': 'As the summary, with the wing of the hall shown (a wing holds a page of exhibits): wing 1/3.',
    'showcase.bestiary.species': 'Kinds of monster in the Hall (a count).',
    'showcase.bestiary.plaque': 'Plaque over an exhibit: how many were killed (x12) and the rift depth where it was first killed.',
    'showcase.bestiary.plaque_range': 'Plaque over an exhibit: how many were killed (x12) and the rift depths where it was killed, first to last.',
    'showcase.bestiary.prompt.altar': 'Prompt at the altar that breeds a new monster from two killed ones; the key is drawn before it.',
    'showcase.bestiary.prompt.inspect': 'Prompt at an exhibit; {name} is the monster’s name. The key is drawn before it.',
    'showcase.bestiary.rank_plan': 'An exhibit’s card: its rank ({rank}: Normal, Magic, Rare, Boss) and its body plan ({plan}: Biped, Serpent...).',
    'showcase.bestiary.rank.normal': 'A monster’s rank.',
    'showcase.bestiary.rank.magic': 'A monster’s rank (an elite with one modifier).',
    'showcase.bestiary.rank.rare': 'A monster’s rank (an elite with several modifiers).',
    'showcase.bestiary.rank.boss': 'A monster’s rank.',
    'showcase.bestiary.archetype': 'An exhibit’s card: how the monster fights ({name}: Brawler, Caster...).',
    'showcase.bestiary.altar_hint': 'The altar’s card: it crosses two killed monsters’ genes and mutates the child.',
    'showcase.bestiary.generation': 'The altar’s card: how many times the child was bred or mutated, and its body plan.',
    'showcase.bestiary.parts_seed': 'The altar’s card: how many body parts the child has, and the number it was generated from.',
    'showcase.bestiary.turntable_on': 'A button on an exhibit’s card: the monster turns slowly (on).',
    'showcase.bestiary.turntable_off': 'A button on an exhibit’s card: the monster turns slowly (off).',
    'showcase.bestiary.none': 'The altar’s parent button when the hall has no monster to pick.',
    'showcase.photo.row.res': 'Photo mode: the resolution the pixel art is drawn at (480x270).',
    'showcase.photo.row.mode': 'Photo mode: how the picture is drawn (Pixel or Raw).',
    'showcase.photo.row.ambient': 'Photo mode: the strength of the ambient light.',
    'showcase.photo.row.light': 'Photo mode: a light that rides with the camera.',
    'showcase.photo.mode.raw': 'Photo mode: the picture at the screen’s full resolution, not pixelated.',
    'showcase.photo.light.rift': 'A colour of the fill light: the purple of the rifts.',
    'showcase.photo.light.ember': 'A colour of the fill light: the orange of embers.',
    'showcase.photo.saved': 'After a photo is taken: {file} is the PNG’s file name.',
  },
  max: {
    'showcase.verb.play': 5,
    'showcase.verb.enter': 5,
    'showcase.verb.visit': 6,
    'showcase.photo.row.look': 10,
    'showcase.photo.row.mode': 10,
    'showcase.photo.row.res': 10,
    'showcase.photo.row.time': 10,
    'showcase.photo.row.sun': 10,
    'showcase.photo.row.ambient': 10,
    'showcase.photo.row.light': 10,
  },
};

export function SHOWCASE(): LineArea {
  const lines: Record<string, LineArea['lines'][string]> = { ...FIXED.lines };
  const notes: Record<string, string> = { ...FIXED.notes };
  for (const [name, line] of Object.entries(HINTS)) {
    lines[`showcase.hint.${name}`] = line;
    notes[`showcase.hint.${name}`] = 'A control hint at the bottom of the arcade, the Hall of Beasts or photo mode, shown in a row with others: the key, then what it does (a word or two).';
  }
  for (const [clip, word] of Object.entries(CLIPS)) {
    lines[lineKey('showcase.bestiary.clip', clip)] = word;
    notes[lineKey('showcase.bestiary.clip', clip)] = 'A button on an exhibit’s card in the Hall of Beasts: plays this animation of the monster.';
  }
  for (const key of Object.keys(FILTER_PRESETS)) {
    lines[lineKey('showcase.photo.look', key)] = presetName(key);
    notes[lineKey('showcase.photo.look', key)] = 'Photo mode: a look for the picture, named after the old screen or console it imitates.';
  }
  for (const id of FILTER_IDS) {
    lines[lineKey('showcase.photo.filter', id)] = getFilter(id)?.label.replace(/\s*\(.*\)$/, '') ?? id; // the label without its details
    notes[lineKey('showcase.photo.filter', id)] = 'Photo mode: one picture filter on its own (a palette, a console, a display, an effect).';
  }
  return { lines, notes, max: FIXED.max };
}
