import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_CLIPS } from './animations';

/**
 * Clips nothing plays yet, on purpose. Each entry says why; wire the clip and delete its
 * entry (the test fails while a listed clip is referenced, so this list can't go stale).
 */
const PENDING: Record<string, string> = {};

/** Source of everything that picks hero clips by name: the character and the playground. */
function players(): string {
  const dir = new URL('../../engine/character/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  return [...files.map((f) => readFileSync(new URL(f, dir), 'utf8')), readFileSync(new URL('../playground.ts', import.meta.url), 'utf8')].join('\n');
}

describe('hero clips', () => {
  it('every clip is played by the character or the playground, or listed as pending', () => {
    const src = players();
    const referenced = (name: string) => new RegExp(`['"\`]${name}['"\`]`).test(src);
    const unused = HERO_CLIPS.map((c) => c.name).filter((n) => !referenced(n) && !PENDING[n]);
    expect(unused, 'clips nothing plays: wire them or list them in PENDING').toEqual([]);
    const stale = Object.keys(PENDING).filter(referenced);
    expect(stale, 'played now: remove from PENDING').toEqual([]);
    const missing = Object.keys(PENDING).filter((n) => !HERO_CLIPS.some((c) => c.name === n));
    expect(missing, 'PENDING names a clip that does not exist').toEqual([]);
  });
});
