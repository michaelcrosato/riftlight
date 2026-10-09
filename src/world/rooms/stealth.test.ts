import { describe, expect, it } from 'vitest';
import { NavGrid } from '../../engine/ai/navgrid';
import { STEALTH_MAP, STEALTH_ROUTES } from './stealth';

describe('Stealth room', () => {
  const nav = NavGrid.fromRows(STEALTH_MAP, { blocked: '#=c' });

  it('every patrol leg is a straight walk clear of walls and crates (a body 0.6 m wide)', () => {
    for (const route of STEALTH_ROUTES) {
      route.forEach(([c, r], i) => {
        expect(nav.isOpen(c, r), `waypoint ${c},${r}`).toBe(true);
        const [c2, r2] = route[(i + 1) % route.length]!;
        if (route.length > 1) expect(nav.lineOfSight(nav.centerX(c), nav.centerZ(r), nav.centerX(c2), nav.centerZ(r2), 0.3), `${c},${r} → ${c2},${r2}`).toBe(true);
      });
    }
  });

  it('the start and the goal are walkable and joined', () => {
    // spawn [-11.5, 0, 6] (bottom left), goal at cell 24, 1 (top right)
    expect(nav.walkable(-11.5, 6)).toBe(true);
    expect(nav.path([-11.5, 0, 6], [nav.centerX(24), 0, nav.centerZ(1)])).not.toBeNull();
  });
});
