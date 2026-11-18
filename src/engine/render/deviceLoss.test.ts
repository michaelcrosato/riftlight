// What a lost GPU device leaves behind (render/deviceLoss.ts): three's pipeline error scopes that a
// dying GPU process drops (`OperationError: Instance dropped in popErrorScope`, popped in three with
// no catch) settle as empty once the device is lost, and nothing else does: another rejection, the
// same message under another name, or that one on a device that is not lost all reject as before.
// The browser half (a real GPU process killed under the game) is the e2e `phone` suite's device loss.
import { describe, expect, it, vi } from 'vitest';
import { absorbDroppedScopes, DROPPED_SCOPE, droppedScopes, isDroppedScope, LOST_WAIT_MS } from './deviceLoss';

describe('three’s dropped error scopes after a device loss', () => {
  it('names exactly that rejection', () => {
    expect(isDroppedScope(new DOMException(DROPPED_SCOPE, 'OperationError'))).toBe(true);
    expect(isDroppedScope({ name: 'OperationError', message: DROPPED_SCOPE })).toBe(true);
    for (const other of [new DOMException('Device lost', 'OperationError'), new DOMException(DROPPED_SCOPE, 'AbortError'), new Error(DROPPED_SCOPE), DROPPED_SCOPE, null, undefined, { name: 'OperationError', message: `${DROPPED_SCOPE}.` }]) {
      expect(isDroppedScope(other), String(other)).toBe(false);
    }
  });

  it('settles it as an empty scope on a lost device, once wrapped; nothing else, and not on a device that is not lost', async () => {
    /** A device whose next scope settles as `next` says; `lose()` loses it. */
    class Device {
      next: { error?: unknown; value?: unknown } = { value: null };
      lose!: () => void;
      readonly lost = new Promise<void>((r) => (this.lose = r));
      popErrorScope(): Promise<unknown> {
        return 'error' in this.next ? Promise.reject(this.next.error) : Promise.resolve(this.next.value);
      }
    }
    absorbDroppedScopes(Device.prototype);
    absorbDroppedScopes(Device.prototype); // once
    const dropped = new DOMException(DROPPED_SCOPE, 'OperationError');
    const other = new DOMException('Device lost', 'OperationError');
    const settle = (p: Promise<unknown>) => p.then((value) => ({ value }), (error: unknown) => ({ error }));
    const d = new Device();
    const from = droppedScopes();
    expect(await settle(d.popErrorScope()), 'a scope with nothing in it').toEqual({ value: null });
    d.next = { value: 'a validation error' };
    expect(await settle(d.popErrorScope()), 'a scope with an error in it').toEqual({ value: 'a validation error' });
    vi.useFakeTimers();
    try {
      d.next = { error: dropped };
      const early = settle(d.popErrorScope());
      await vi.advanceTimersByTimeAsync(LOST_WAIT_MS + 10);
      expect(await early, 'a device that is not lost: rejected as before').toEqual({ error: dropped });
    } finally {
      vi.useRealTimers();
    }
    d.lose();
    expect(await settle(d.popErrorScope()), 'lost: an empty scope').toEqual({ value: null });
    d.next = { error: other };
    expect(await settle(d.popErrorScope()), 'anything else rejects').toEqual({ error: other });
    expect(droppedScopes() - from, 'counted once each').toBe(1);
    // lost in the same moment the scope drops (the GPU process gone): it waits for the loss
    const e = new Device();
    e.next = { error: dropped };
    const racing = settle(e.popErrorScope());
    setTimeout(() => e.lose(), 20);
    expect(await racing).toEqual({ value: null });
    expect(droppedScopes() - from).toBe(2);
  });
});
