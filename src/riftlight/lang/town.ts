/**
 * The lines of Emberfall: townsfolk names, titles, barks and talk, the town's labels (town/). docs/game/lang.md has the rules for a line.
 * The townsfolk's words are the registry's (`NPCS`, town/npcs.ts): a townsperson added there brings
 * their lines along (`town.npc.<id>.name`, `.title`, `.bark.<n>`, `.talk.<n>`).
 */
import { NPCS } from '../town/npcs';
import { type LineArea, lineKey } from './area';

/** Who each townsperson is, for the translator (the brief has their voices). */
const WHO: Readonly<Record<string, string>> = {
  brann: 'Brann the blacksmith (a man), gruff and proud of his craft',
  ilsa: 'Ilsa the merchant (a woman), a cheerful haggler',
  oru: 'Oru the mystic (masked, never gendered), calm and cryptic',
  vex: 'Vex the rift keeper (never gendered), terse and watchful',
  villager: 'Wren, a villager (never gendered), friendly and chatty',
  villager2: 'Pell, a villager (never gendered), a little uneasy',
};

/** The town's own labels: the stash, the prompts, the cat. */
const PLACES: LineArea = {
  lines: {
    'town.talk.said': '{name}: "{speech}"',
    'town.prompt.talk': 'Talk to {name}',
    'town.verb.talk': 'Talk',
    'town.stash.name': 'Stash',
    'town.prompt.stash': 'Open the stash',
    'town.verb.open': 'Open',
    'town.cat.meow': 'Meow',
    'town.cat.mrrow': 'Mrrow!',
  },
  notes: {
    'town.talk.said':
      'Over the shop, tree or rift panel a townsperson opens: who speaks ({name}) and what they say ({speech}). Use your language’s quotation marks and punctuation.',
    'town.prompt.talk': 'Prompt by a townsperson ({name}); the key to press is drawn before it.',
    'town.verb.talk': 'The touch button for talking to a townsperson (one word).',
    'town.stash.name': 'The hero’s storage chest in town.',
    'town.prompt.stash': 'Prompt by the stash chest; the key to press is drawn before it.',
    'town.verb.open': 'The touch button for opening the stash (one word).',
    'town.cat.meow': 'The town cat’s speech bubble: the sound a cat makes.',
    'town.cat.mrrow': 'The town cat’s speech bubble when the hero runs at it: a startled cat sound.',
  },
  max: { 'town.verb.talk': 5, 'town.verb.open': 5 },
};

export function TOWN(): LineArea {
  const lines: Record<string, string> = { ...PLACES.lines } as Record<string, string>;
  const notes: Record<string, string> = { ...PLACES.notes };
  for (const def of Object.values(NPCS)) {
    const who = WHO[def.id] ?? `${def.name}, ${def.title}`;
    lines[lineKey('town.npc', def.id, 'name')] = def.name;
    notes[lineKey('town.npc', def.id, 'name')] = `A townsperson’s name: ${who}. Shown on the prompt by them.`;
    lines[lineKey('town.npc', def.id, 'title')] = def.title;
    notes[lineKey('town.npc', def.id, 'title')] = `What ${def.name} does in town, under their name on the prompt.`;
    def.barks.forEach((bark, i) => {
      lines[lineKey('town.npc', def.id, 'bark', i + 1)] = bark;
      notes[lineKey('town.npc', def.id, 'bark', i + 1)] = `${who}, to the hero passing by (informal you): a speech bubble over their head.`;
    });
    def.lines.forEach((talk, i) => {
      lines[lineKey('town.npc', def.id, 'talk', i + 1)] = talk;
      notes[lineKey('town.npc', def.id, 'talk', i + 1)] = `${who}, to the hero who came to talk (informal you): a speech bubble, and the header over the panel they open.`;
    });
  }
  return { lines, notes, max: PLACES.max };
}
