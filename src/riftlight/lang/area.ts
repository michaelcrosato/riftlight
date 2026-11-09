/**
 * One part of the game's words (docs/game/lang.md): its lines by id, notes for the translator and
 * widths for tight spots. `riftlightLines()` gathers every area; an area may be built from a
 * registry (a function), so content added as data brings its lines along.
 */
import type { Line } from '../../engine';

export interface LineArea {
  readonly lines: Readonly<Record<string, Line>>;
  readonly notes?: Readonly<Record<string, string>>;
  readonly max?: Readonly<Record<string, number>>;
}

/**
 * A line id from a prefix and a content id (a registry entry's): lowercase, every run of other
 * characters one underscore, so any id can file a line (`lineKey('item.base', 'Two-Hand Axe')` is
 * `item.base.two_hand_axe`).
 */
export function lineKey(prefix: string, ...ids: readonly (string | number)[]): string {
  const slug = (s: string | number) =>
    String(s)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || '_';
  return [prefix, ...ids.map(slug)].join('.');
}
