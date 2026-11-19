import { describe, expect, it } from 'vitest';
import { setTextLocale } from '../../../engine/animation/font';
import { clampZoom, PointIndex, stepToward, toScreen, toTree, zoomAt, ZOOM_LIMITS } from './camera';
import { css, pack, PixelBuffer, textWidth } from './pixels';
import { t } from '../../lang';
import { tipControl, treeHints, type TreeHintMode } from './TreeView';
import { startNode, TreeCursor } from './cursor';
import { defaultTree } from '../../tree/tree';

describe('tree camera', () => {
  const cam = { x: 100, y: -50, zoom: 0.25 };

  it('maps tree ↔ screen and back', () => {
    expect(toScreen(cam, 480, 270, 100, -50)).toEqual([240, 135]);
    const [tx, ty] = toTree(cam, 480, 270, 300, 35);
    expect(toScreen(cam, 480, 270, tx, ty)).toEqual([300, 35]);
  });

  it('zooms about the cursor and clamps', () => {
    const z = zoomAt(cam, 480, 270, 400, 60, 2);
    expect(z.zoom).toBe(0.5);
    const before = toTree(cam, 480, 270, 400, 60);
    const after = toTree(z, 480, 270, 400, 60);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(clampZoom(100)).toBe(ZOOM_LIMITS.max);
    expect(zoomAt(cam, 480, 270, 0, 0, 0.0001).zoom).toBe(ZOOM_LIMITS.min);
  });

  it('picks the nearest node and steps along a direction', () => {
    const pts = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 60, y: 5 },
      { id: 'c', x: 0, y: 70 },
      { id: 'd', x: 500, y: 500 },
    ];
    const idx = new PointIndex(pts, 50);
    expect(idx.nearest(55, 0, 30)?.id).toBe('b');
    expect(idx.nearest(250, 250, 30)).toBeNull();
    expect(idx.nearest(2, 2, 30, (p) => p.id !== 'a')).toBeNull();
    expect(idx.inRect(-10, -10, 100, 100).map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(stepToward(pts[0]!, 1, 0, pts)?.id).toBe('b');
    expect(stepToward(pts[0]!, 0, 1, pts)?.id).toBe('c');
    expect(stepToward(pts[0]!, -1, 0, pts)).toBeNull();
  });
});

describe('the pad’s cursor as the tree opens', () => {
  it('starts on the node hovered last, else on the start the allocation grows from: the cross, the focus and Cross on it at once', () => {
    const tree = defaultTree();
    const roots = [...tree.roots];
    const nav = new TreeCursor(tree);
    expect([nav.padCursor, nav.hover], 'before: no cross, nothing focused').toEqual([false, null]);
    nav.padStart(null, new Set());
    expect([nav.padCursor, nav.hover], 'nothing allocated: the first start').toEqual([true, roots[0]]);
    // an allocation grown from another start: that start
    const other = roots[3]!;
    const grown = new Set([tree.neighbours(other).find((n) => !tree.roots.has(n))!]);
    expect(startNode(tree, grown)?.id).toBe(other);
    const fresh = new TreeCursor(tree);
    fresh.padStart(null, grown);
    expect(fresh.hover).toBe(other);
    // the node hovered last wins, on screen and under the cross (the camera follows it)
    const last = tree.nodes.find((n) => n.kind === 'notable')!;
    const again = new TreeCursor(tree);
    again.padStart(last.id, grown);
    expect(again.hover).toBe(last.id);
    const [sx, sy] = toScreen(again.cam, again.width, again.height, last.x, last.y);
    expect([Math.round(again.cursor.x), Math.round(again.cursor.y)]).toEqual([Math.round(sx), Math.round(sy)]);
    // one that no longer exists (a changed tree): the start
    const gone = new TreeCursor(tree);
    gone.padStart('no-such-node', new Set());
    expect(gone.hover).toBe(roots[0]);
  });
});

describe('pixel buffer', () => {
  it('draws crisp palette pixels', () => {
    const b = new PixelBuffer(16, 16);
    const red = pack('red');
    b.clear(pack('ink'));
    b.line(0, 0, 15, 15, red);
    for (let i = 0; i < 16; i++) expect(b.get(i, i)).toBe(red);
    b.disc(8, 8, 3, pack('sand'));
    expect(b.get(8, 5)).toBe(pack('sand'));
    expect(b.get(8, 4)).not.toBe(pack('sand'));
    expect(new Set(b.px).size).toBe(3);
  });

  it('paints what the pixel font draws; keeps the rest for the device font, in order with the panels over it', () => {
    const b = new PixelBuffer(64, 32);
    b.clear(pack('ink'));
    expect(b.text('Ab – «c»', 1, 1, pack('white'))).toBe(textWidth('Ab – «c»'));
    expect(b.overlay).toEqual([]);
    expect(new Set(b.px).size).toBe(2);
    b.panel(0, 20, 10, 10, pack('night')); // nothing to cover yet
    expect(b.overlay).toEqual([]);
    setTextLocale('ru');
    try {
      b.text('Пассивы', 2, 3, pack('sand'), 1, pack('ink'));
      b.panel(0, 0, 30, 12, pack('night'));
      b.text('Да', 4, 4, pack('white'));
      expect(b.overlay.map((o) => (o.kind === 'text' ? o.text : 'panel'))).toEqual(['Пассивы', 'Пассивы', 'panel', 'Да']);
      expect(b.overlay[1]).toMatchObject({ x: 2, y: 3, color: pack('sand') });
      expect(b.deviceText).toBe(true);
      expect(css(pack('red'))).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    } finally {
      setTextLocale(undefined);
    }
    b.clear(pack('ink'));
    expect(b.overlay).toEqual([]);
  });
});


describe('bottom bar hints', () => {
  it('with the pad: each button’s glyph (PlayStation’s, or Xbox’s) and a verb; with the mouse: words', () => {
    const ps = treeHints({ mode: 'pad', refunds: true, style: 'playstation' });
    expect(ps.map((h) => h.id)).toEqual(['move', 'take', 'refund', 'stats', 'zoom', 'close']);
    expect(ps.map((h) => h.text)).toEqual(['move', 'take', 'refund', 'stats', 'zoom', 'close']);
    const take = ps.find((h) => h.id === 'take')!.glyphs[0]!;
    expect(take.kind === 'sprite' && take.colors.s).toBe('blue'); // ✕, blue
    expect(ps.find((h) => h.id === 'zoom')!.glyphs).toEqual([{ kind: 'cap', text: 'L2', round: true }, { kind: 'cap', text: 'R2', round: true }]);
    const xbox = treeHints({ mode: 'pad', refunds: false, style: 'xbox' });
    expect(xbox.map((h) => h.id)).not.toContain('refund');
    expect(xbox.find((h) => h.id === 'zoom')!.glyphs.map((g) => (g.kind === 'cap' ? g.text : ''))).toEqual(['LT', 'RT']);
    const mouse = treeHints({ mode: 'mouse', refunds: true, style: 'playstation' });
    expect(mouse.map((h) => h.text)).toEqual(['Drag pan', 'Wheel zoom', 'Click take', 'R-click refund', 'Tab stats', '/ find']);
    expect(mouse.every((h) => h.glyphs.length === 0)).toBe(true);
    // a finger: its gestures, whatever the screen's width (a landscape phone is as wide as a small window)
    expect(treeHints({ mode: 'touch', refunds: true, style: 'playstation' }).map((h) => h.text)).toEqual(['Drag pan', 'Pinch zoom', 'Tap twice: take', 'Hold refund']);
    expect(treeHints({ mode: 'touch', refunds: false, style: 'playstation', pages: { keys: ['KeyQ'], pad: ['PadLB'] } }).map((h) => h.id)).toEqual(['pan', 'pinch', 'tap']);
  });

  it('in the game, names the host’s screens either side of the tree: L1 R1 with a pad, the Q E key caps with the keyboard', () => {
    const pages = { keys: ['KeyQ', 'KeyE'], pad: ['PadLB', 'PadRB'] };
    const ps = treeHints({ mode: 'pad', refunds: false, style: 'playstation', pages });
    expect(ps.map((h) => h.id)).toEqual(['move', 'take', 'stats', 'zoom', 'screens', 'close']);
    expect(ps.find((h) => h.id === 'screens')).toEqual({ id: 'screens', text: 'screens', glyphs: [{ kind: 'cap', text: 'L1', round: true }, { kind: 'cap', text: 'R1', round: true }] });
    const keys = treeHints({ mode: 'mouse', refunds: false, style: 'playstation', pages });
    expect(keys.at(-1)).toEqual({ id: 'screens', text: 'screens', glyphs: [{ kind: 'cap', text: 'Q', round: false }, { kind: 'cap', text: 'E', round: false }] });
    // the tree page (no host): none
    expect(treeHints({ mode: 'mouse', refunds: false, style: 'playstation' }).map((h) => h.id)).not.toContain('screens');
  });
});

describe('a node’s tooltip', () => {
  /** A tooltip line with the control that does `act` on `mode` in it, as the view draws it. */
  const tip = (id: string, act: 'take' | 'refund', mode: TreeHintMode, style: 'playstation' | 'xbox' = 'playstation', values: Record<string, number> = {}) => t(id, { ...values, control: tipControl(act, mode, style) });

  it('names what the pad’s buttons do on a pad (in the player’s style), a finger’s gestures on a touch screen, the mouse’s clicks with the keyboard and mouse', () => {
    // a pad: ✕ takes and turns a mastery, □ refunds
    expect(tip('tree.tip.take', 'take', 'pad', 'playstation', { count: 2, left: 5 })).toBe('Cross: take 2 points (5 left)');
    expect(tip('tree.tip.next_choice', 'take', 'pad')).toBe('Cross: next choice');
    expect(tip('tree.tip.refund', 'refund', 'pad')).toBe('Square: refund');
    expect(tip('tree.tip.refund', 'refund', 'pad', 'xbox')).toBe('X: refund');
    expect(tip('tree.tip.refund_cost', 'refund', 'pad', 'xbox', { cost: 40 })).toBe('X: refund (40 gold)');
    expect(tip('tree.tip.take', 'take', 'pad', 'xbox', { count: 1, left: 3 })).toBe('A: take 1 point (3 left)');
    // a finger: a second tap takes, a long press refunds (the bottom bar's Tap twice: take, Hold refund)
    expect(tip('tree.tip.take', 'take', 'touch', 'playstation', { count: 1, left: 3 })).toBe('Tap twice: take 1 point (3 left)');
    expect(tip('tree.tip.next_choice', 'take', 'touch')).toBe('Tap twice: next choice');
    expect(tip('tree.tip.refund', 'refund', 'touch')).toBe('Hold: refund');
    // the keyboard and mouse: its clicks, as before
    expect(tip('tree.tip.take', 'take', 'mouse', 'playstation', { count: 2, left: 5 })).toBe('Click: take 2 points (5 left)');
    expect(tip('tree.tip.next_choice', 'take', 'mouse')).toBe('Click: next choice');
    expect(tip('tree.tip.refund', 'refund', 'mouse')).toBe('R-click: refund');
    expect(tip('tree.tip.refund_cost', 'refund', 'mouse', 'xbox', { cost: 40 })).toBe('R-click: refund (40 gold)');
  });
});
