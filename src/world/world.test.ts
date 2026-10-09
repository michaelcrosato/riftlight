import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, term } from './glossary';
import { ROOMS } from './rooms';
import { doorLayout, inFrontOf } from './rooms/atrium';
import { WINGS } from './wings';

describe('Engine World rooms', () => {
  it('have unique ids, the Atrium first', () => {
    expect(ROOMS[0]!.id).toBe('atrium');
    expect(new Set(ROOMS.map((r) => r.id)).size).toBe(ROOMS.length);
    for (const r of ROOMS) expect(r.id, r.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('belong to known wings and keep titles short enough for a door', () => {
    for (const r of ROOMS) {
      expect(WINGS.some((w) => w.id === r.wing), r.id).toBe(true);
      expect(r.title.length, r.id).toBeLessThanOrEqual(24);
    }
  });

  it('every room has a card and a whole station guide', () => {
    for (const r of ROOMS) {
      const g = r.guide;
      expect(r.about.length, r.id).toBeGreaterThan(60);
      expect(r.try.length, r.id).toBeGreaterThanOrEqual(2);
      expect(g.what.length, r.id).toBeGreaterThan(40);
      expect(g.how.length, r.id).toBeGreaterThanOrEqual(3);
      expect(g.uses.length, r.id).toBeGreaterThanOrEqual(2);
      expect(g.ask.length, r.id).toBeGreaterThanOrEqual(2);
      expect(g.cost.length, r.id).toBeGreaterThan(20);
      for (const c of g.code ?? []) expect(c.file, `${r.id}: ${c.title}`).toMatch(/^(src|scripts)\//);
    }
  });

  it('guide code blocks quote the engine: every line is in the file it names', () => {
    const missing: string[] = [];
    for (const r of ROOMS)
      for (const c of r.guide.code ?? []) {
        const file = readFileSync(new URL(`../../${c.file}`, import.meta.url), 'utf8')
          .split('\n')
          .map((l) => l.trim());
        for (const raw of c.src.split('\n')) {
          const line = raw.trim();
          if (!line || line === '...') continue;
          if (!file.some((f) => f.includes(line))) missing.push(`${r.id} / ${c.title} (${c.file}): ${line}`);
        }
      }
    expect(missing).toEqual([]);
  });

  it('every guide word is in the field guide', () => {
    const missing = ROOMS.flatMap((r) => (r.guide.words ?? []).filter((w) => !term(w)).map((w) => `${r.id}: ${w}`));
    expect(missing).toEqual([]);
  });

  it('the field guide has no duplicate words', () => {
    const words = GLOSSARY.map((t) => t.term.toLowerCase());
    expect(new Set(words).size).toBe(words.length);
  });
});

describe('the Atrium', () => {
  const others = ROOMS.filter((r) => r.id !== 'atrium');
  const { doors } = doorLayout(others);

  it('has a door for every room', () => {
    expect(doors.map((d) => d.room.id).sort()).toEqual(others.map((r) => r.id).sort());
  });

  it('keeps doors apart', () => {
    for (const a of doors)
      for (const b of doors) {
        if (a === b) continue;
        expect(Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]), `${a.room.id} / ${b.room.id}`).toBeGreaterThan(4);
      }
  });

  it('puts arrivals in front of the door, facing back into the corridor', () => {
    for (const d of doors) {
      const p = inFrontOf(d);
      // a step back from the door, toward the corridor's middle
      expect(Math.hypot(p.at[0] - d.at[0], p.at[2] - d.at[2])).toBeCloseTo(1.8, 5);
      expect(Math.abs(p.at[0]) + Math.abs(p.at[2])).toBeLessThan(Math.abs(d.at[0]) + Math.abs(d.at[2]) + 1e-6);
    }
  });
});
