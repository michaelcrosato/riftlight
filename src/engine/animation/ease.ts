import type { Ease } from './types';

export function applyEase(e: Ease, u: number): number {
  switch (e) {
    case 'linear':
      return u;
    case 'in':
      return u * u;
    case 'out':
      return 1 - (1 - u) * (1 - u);
    case 'inOut':
      return u * u * (3 - 2 * u);
    case 'hold':
      return u >= 1 ? 1 : 0;
    case 'inBack': {
      const c = 1.70158;
      return (c + 1) * u * u * u - c * u * u;
    }
    case 'outBack': {
      const c = 1.70158;
      const v = u - 1;
      return 1 + (c + 1) * v * v * v + c * v * v;
    }
  }
}
