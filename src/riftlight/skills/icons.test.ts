import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../engine/palette';
import { SKILLS } from './actives';
import { GLYPHS, gemIcon, SHAPES } from './icons';
import { SUPPORTS } from './supports';

describe('gem icons', () => {
  it('every icon shape is 8 × 6 and uses only h / c / d', () => {
    for (const [name, rows] of Object.entries({ ...SHAPES, ...GLYPHS })) {
      expect(rows.length, name).toBe(6);
      for (const r of rows) {
        expect(r.length, `${name}: ${r}`).toBe(8);
        expect(/^[.hcd]+$/.test(r), `${name}: ${r}`).toBe(true);
      }
    }
  });

  it('every active and support gem gets an icon in palette colours', () => {
    const all = [...SKILLS.all().map((g) => [g.id, false] as const), ...SUPPORTS.all().map((g) => [g.id, true] as const)];
    expect(all.length).toBeGreaterThan(40);
    for (const [id, support] of all) {
      const icon = gemIcon(id, support);
      expect(icon, id).not.toBeNull();
      for (const c of Object.values(icon!.colors)) expect(PALETTE[c], `${id} ${c}`).toBeDefined();
    }
  });

  it('supports read as what they do: different glyphs for different jobs, element colours', () => {
    const glyph = (id: string) => gemIcon(id, true)!.rows.join('/');
    expect(glyph('gmp')).not.toBe(glyph('chain'));
    expect(glyph('chain')).not.toBe(glyph('increased-area'));
    expect(gemIcon('added-fire', true)!.colors.c).toBe('orange');
    expect(gemIcon('added-cold', true)!.colors.c).toBe('cyan');
  });
});
