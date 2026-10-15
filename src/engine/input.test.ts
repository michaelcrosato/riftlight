import { describe, expect, it } from 'vitest';
import { applyDeadzone, type GamepadLike, Input } from './input';

const target = () => new EventTarget() as unknown as Window;
const key = (type: string, code: string) => Object.assign(new Event(type), { code, repeat: false });

function pad(axes: number[] = [0, 0, 0, 0], pressed: number[] = []): GamepadLike {
  return { connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) };
}

describe('Input presses', () => {
  it('queued presses expire after the press window (game time)', () => {
    const input = new Input(target());
    input.beginFrame(1, 1 / 60, []);
    input.setKey('Space', true);
    input.beginFrame(1.1, 0.1, []);
    expect(input.consumePress('Space')).toBe(true); // 100 ms old: still valid
    input.setKey('Space', false);
    input.setKey('Space', true);
    input.beginFrame(1.3, 0.2, []);
    expect(input.consumePress('Space')).toBe(false); // 200 ms old: expired
    expect(input.queuedPresses).toEqual([]);
  });

  it('stale presses never pile up while no fixed step consumes them', () => {
    const input = new Input(target());
    for (let i = 0; i < 100; i++) {
      input.setKey('KeyJ', true);
      input.setKey('KeyJ', false);
      input.beginFrame(i * 0.05, 0.05, []);
    }
    expect(input.queuedPresses.length).toBeLessThanOrEqual(1);
  });

  it('dispose() removes its window listeners', () => {
    const t = target();
    const input = new Input(t);
    t.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.isDown('KeyA')).toBe(true);
    t.dispatchEvent(key('keyup', 'KeyA'));
    input.dispose();
    t.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.isDown('KeyA')).toBe(false);
  });
});

describe('Gamepad', () => {
  it('applies a radial deadzone and rescales to the rim', () => {
    expect(applyDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const full = applyDeadzone(1, 0, 0.2);
    expect(full.x).toBeCloseTo(1);
    const half = applyDeadzone(0, 0.6, 0.2);
    expect(half.y).toBeCloseTo(0.5);
    const diag = applyDeadzone(0.6, 0.6, 0.2);
    expect(diag.x).toBeCloseTo(diag.y); // direction kept
  });

  it('left stick feeds moveAxis (up = forward) and buttons press mapped keys once', () => {
    const input = new Input(target());
    input.beginFrame(0, 1 / 60, [pad([0, -1, 0, 0], [0])]);
    expect(input.moveAxis().y).toBeCloseTo(1);
    expect(input.isDown('Space')).toBe(true);
    expect(input.wasPressed('Space')).toBe(true);
    expect(input.consumePress('Space')).toBe(true);
    input.endFrame();
    input.beginFrame(1 / 60, 1 / 60, [pad([0, -1, 0, 0], [0])]); // still held: no new press
    expect(input.wasPressed('Space')).toBe(false);
    expect(input.consumePress('Space')).toBe(false);
    input.beginFrame(2 / 60, 1 / 60, [pad([0.05, 0.05, 0, 0], [])]); // released, stick in deadzone
    expect(input.isDown('Space')).toBe(false);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    input.beginFrame(3 / 60, 1 / 60, [pad([0, 0, 0, 0], [14])]); // d-pad left = ArrowLeft
    expect(input.moveAxis().x).toBe(-1);
  });

  it('ignores pads without the standard mapping (unknown layouts)', () => {
    const input = new Input(target());
    input.beginFrame(0, 1 / 60, [{ ...pad([1, 0, 0, 0], [0]), mapping: '' }]);
    expect(input.moveAxis()).toEqual({ x: 0, y: 0 });
    expect(input.isDown('Space')).toBe(false);
  });

  it('right stick turns into pointer movement for the camera', () => {
    const input = new Input(target());
    input.beginFrame(0, 0.5, [pad([0, 0, 1, 0])]);
    expect(input.mouseDelta.x).toBeCloseTo(input.gamepadLookSpeed * 0.5);
    expect(input.gamepadConnected).toBe(true);
  });

  it('its state as data: keys held, presses still queued with their age, the pointer (save-states)', () => {
    const a = new Input(new EventTarget() as unknown as Window);
    a.beginFrame(1, 1 / 60, []);
    a.setKey('KeyW', true);
    a.setKey('KeyJ', true);
    a.setKey('KeyJ', false); // a tap: queued, not held
    a.setPointer(0.25, -0.5);
    a.beginFrame(1.05, 0.05, []);
    const b = new Input(new EventTarget() as unknown as Window);
    b.setState(JSON.parse(JSON.stringify(a.state())), 3.05);
    expect([b.isDown('KeyW'), b.isDown('KeyJ'), b.pointer.x, b.pointer.y, b.pointer.over]).toEqual([true, false, 0.25, -0.5, true]);
    b.beginFrame(3.15, 0.1, []);
    expect(b.consumePress('KeyJ')).toBe(true); // 0.15 s old: still in the window, as it would be in `a`
    b.setState(JSON.parse(JSON.stringify(a.state())), 3.05);
    b.beginFrame(3.25, 0.2, []);
    expect(b.consumePress('KeyJ')).toBe(false); // 0.25 s old: gone, as in `a`
  });

  it('data sent and not yet delivered is part of the moment: kept by a snapshot, dropped by a restore', () => {
    const a = new Input(new EventTarget() as unknown as Window);
    a.send({ lift: 1 });
    const s = JSON.parse(JSON.stringify(a.state())) as ReturnType<Input['state']>;
    a.deliver();
    expect(a.commands).toEqual([{ lift: 1 }]);
    // sent after the snapshot: not the restored moment's
    a.send({ lift: 2 });
    a.send({ lift: 3 });
    a.setState(s, 0);
    a.deliver();
    expect(a.commands).toEqual([{ lift: 1 }]);
    a.deliver();
    expect(a.commands).toEqual([]);
  });
});
