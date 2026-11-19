/**
 * The OS mouse pointer over the engine's canvas (`Engine`, each frame): hidden (`cursor: none`)
 * while the pad is the device in use (`controls.device`) or the pointer is locked, so a resting
 * arrow never sits over a game played on a pad at ten feet; shown again once the mouse travels (the
 * device in use turns back to the keyboard and mouse: `Input`'s few pixels of travel).
 * Presentation only: nothing is recorded and no gameplay reads it. A cursor style the game set on
 * the canvas comes back as it was, and one it sets while the pointer is hidden is kept.
 */

/** What the pointer's style is set on: the engine's canvas (anything with a `style.cursor`). */
export interface CursorTarget {
  readonly style: { cursor: string };
}

export class PointerCursor {
  /** The element the pointer is hidden over and its cursor style before, or null while it shows. */
  private hidden: { readonly el: CursorTarget; readonly was: string } | null = null;

  /** The pointer is hidden now. */
  get isHidden(): boolean {
    return this.hidden !== null;
  }

  /** Once a frame: the pointer over `el` (the canvas now: a lost GPU device's recovery makes another; null headless) hidden or shown. */
  follow(el: CursorTarget | null, hide: boolean): void {
    const h = this.hidden;
    if (h && (h.el !== el || !hide)) {
      if (h.el.style.cursor === 'none') h.el.style.cursor = h.was; // one the game set meanwhile stays
      this.hidden = null;
    }
    if (!el || !hide || this.hidden) return;
    this.hidden = { el, was: el.style.cursor };
    el.style.cursor = 'none';
  }
}
