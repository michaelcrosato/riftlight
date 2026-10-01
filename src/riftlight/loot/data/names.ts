/**
 * Word lists for rare item names: one word from FIRST, one from the slot's SECOND list
 * ("Doom Bite", "Gale Shroud"). Hand-picked to sound like Riftlight.
 */
export const FIRST: readonly string[] = [
  'Agony', 'Ash', 'Beast', 'Blight', 'Blood', 'Bramble', 'Brood', 'Cinder', 'Corpse', 'Crow',
  'Dawn', 'Death', 'Dire', 'Doom', 'Dread', 'Dusk', 'Echo', 'Ember', 'Fate', 'Frost',
  'Gale', 'Gloom', 'Glyph', 'Grave', 'Grim', 'Hate', 'Havoc', 'Hollow', 'Iron', 'Mire',
  'Moon', 'Morbid', 'Oblivion', 'Onslaught', 'Pain', 'Pyre', 'Rage', 'Rift', 'Rune', 'Shadow',
  'Skull', 'Sol', 'Soul', 'Spark', 'Spire', 'Storm', 'Thorn', 'Torment', 'Vengeance', 'Wraith',
];

/** Second words by base class (look) or slot. */
export const SECOND: Readonly<Record<string, readonly string[]>> = {
  weapon: ['Bane', 'Bite', 'Edge', 'Fang', 'Gnash', 'Hunger', 'Mangler', 'Razor', 'Reaver', 'Song', 'Spike', 'Thirst'],
  bow: ['Arch', 'Bolt', 'Branch', 'Fletch', 'Guide', 'Horn', 'Mark', 'Nock', 'Strike', 'Thirst'],
  caster: ['Barb', 'Bite', 'Call', 'Chant', 'Cry', 'Song', 'Spire', 'Twig', 'Weaver', 'Word'],
  offhand: ['Aegis', 'Bastion', 'Guard', 'Mark', 'Refuge', 'Span', 'Tower', 'Ward', 'Wing'],
  helm: ['Brow', 'Corona', 'Crest', 'Crown', 'Dome', 'Glance', 'Halo', 'Horn', 'Keep', 'Visage'],
  body: ['Carapace', 'Coat', 'Hide', 'Jack', 'Mantle', 'Pelt', 'Shell', 'Shroud', 'Suit', 'Wrap'],
  gloves: ['Claw', 'Clutch', 'Fist', 'Grasp', 'Grip', 'Hand', 'Hold', 'Knuckle', 'Mitts', 'Talons'],
  boots: ['Dash', 'Goad', 'Hoof', 'League', 'March', 'Pace', 'Road', 'Slippers', 'Stride', 'Trail'],
  amulet: ['Beads', 'Charm', 'Choker', 'Collar', 'Gorget', 'Heart', 'Locket', 'Medallion', 'Talisman', 'Torc'],
  ring: ['Band', 'Circle', 'Coil', 'Eye', 'Grasp', 'Hold', 'Knot', 'Loop', 'Nail', 'Spiral'],
  belt: ['Bind', 'Bond', 'Buckle', 'Cord', 'Girdle', 'Lash', 'Lock', 'Shackle', 'Snare', 'Strap'],
};
