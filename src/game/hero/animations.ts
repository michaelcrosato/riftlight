// Every hero animation, as data. The clips live in ./clips/ (one file per family; shared
// helpers in clips/helpers.ts). This module re-exports the list so the playground's and the
// Lab's hot reload (`import.meta.hot.accept('./hero/animations')`) and older imports keep
// working: editing any clip file hot-swaps the clips.
//
//   npm run anim -- check            metrics for every clip (foot slide, floor, seams...)
//   npm run anim -- sheet Walk       contact sheet PNG in .scratch/anim/
//   npm run dev → /lab.html          live Animation Lab (hot-reloads the clips)
export { HERO_CLIPS } from './clips';
