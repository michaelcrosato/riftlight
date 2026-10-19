/**
 * Telegraph decals live with combat's visuals (`combat/telegraph.ts`: hero skills, monster
 * attacks and level hazards share them); this re-export keeps the monsters API.
 */
export { createTelegraph, type Telegraph, type TelegraphColor, telegraphColors } from '../combat/telegraph';
