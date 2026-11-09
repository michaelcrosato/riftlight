/**
 * What a translator needs to know that the lines don't say (AI Hub Languages v1, *The list of
 * names and the brief*): the game, its tone, who speaks, and the proper names, as written.
 */

/** Proper names of people, places and invented things, as written (translated by sound in other alphabets). */
export const NAMES: string[] = ['Riftlight', 'Emberfall', 'Vex', 'Brann', 'Ilsa', 'Oru'];

export const BRIEF = [
  'Riftlight is a hack-and-slash action RPG in pixel art: the player’s hero sets out from Emberfall, a small town at the edge of the world, through rifts (portals into dangerous places), kills monsters, picks up loot and grows stronger. Each rift ends with a boss. The tone is classic heroic fantasy with a light touch: earnest, a little wry, never grim.',
  'The interface speaks to the player directly and briefly, in the informal "you" where the language has one. Menus, buttons and item text are terse, as in other action RPGs (Diablo, Path of Exile): keep the genre’s usual terms for things like "life", "mana", "critical strike", "cooldown", "rarity", "socket", "passive tree".',
  'The hero is never named or gendered: avoid forms that assume a gender for the player.',
  'Townsfolk (Vex the rift keeper, Brann the smith, Ilsa the trader, Oru the mystic) talk to the hero in short, friendly lines, each in their own voice; they use the informal "you" with the hero.',
  'Item and monster names are built from parts (a prefix, a base, a suffix): translate each part as a short word or phrase that still reads well when the joining line puts them together; it is fine if some combinations read a little stiffly.',
  'Text is shown in capitals in the game; translate in normal case.',
].join('\n\n');
