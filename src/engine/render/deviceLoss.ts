/**
 * What a lost GPU device leaves behind that is not an error. Three's render pipeline code calls
 * `device.popErrorScope()` without a catch (WebGPUPipelineUtils, its sync and async paths), so when
 * the GPU process dies while pipelines are being built, each one's scope rejects unhandled with
 * Chrome's `OperationError: Instance dropped in popErrorScope`. The engine recovers (`PixelRenderer`:
 * a new renderer on a new device, the pipelines built again on it), but a page that counts unhandled
 * rejections as errors (52in1's session harness) would fail a run that played on, and a listener
 * can't stop it reaching the page's own: those added first hear it first.
 *
 * So the scope itself settles: `absorbDroppedScopes` (installed with the other WebGPU shims,
 * `installWebGPUCompat`) has a scope that rejects with exactly that, on a device whose `lost`
 * promise settles, resolve as a scope with no error in it. Any other rejection, and that one on a
 * device that is not lost, rejects as before.
 */

/** The message of three's dropped error scope (Chrome's, as an `OperationError`). */
export const DROPPED_SCOPE = 'Instance dropped in popErrorScope';

/** How long a dropped scope waits for its device's `lost` (ms): Chrome settles both as the GPU process goes. */
export const LOST_WAIT_MS = 2000;

/** Whether a rejection's `reason` is three's dropped error scope: an `OperationError` with exactly `DROPPED_SCOPE`. */
export function isDroppedScope(reason: unknown): boolean {
  if (!reason || typeof reason !== 'object') return false;
  const r = reason as { name?: unknown; message?: unknown };
  return r.name === 'OperationError' && r.message === DROPPED_SCOPE;
}

let dropped = 0;

/** How many error scopes a lost device dropped that `absorbDroppedScopes` settled (the page's, since it loaded). */
export function droppedScopes(): number {
  return dropped;
}

/** The part of a device a scope is popped on. */
interface ScopedDevice {
  readonly lost: Promise<unknown>;
  popErrorScope(): Promise<unknown>;
}

const wrapped = new WeakSet<object>();

/**
 * Wrap `proto.popErrorScope` (`GPUDevice.prototype`; once each): a scope that rejects with
 * `isDroppedScope` on a device whose `lost` settles within `LOST_WAIT_MS` resolves to null (no
 * error in it: the device is gone, and so are its pipelines) and is counted (`droppedScopes`; the
 * first said on the console, as info). Everything else is as it was.
 */
export function absorbDroppedScopes(prototype: object | undefined): void {
  const proto = prototype as { popErrorScope?: (this: ScopedDevice) => Promise<unknown> } | undefined;
  if (!proto || typeof proto.popErrorScope !== 'function' || wrapped.has(proto)) return;
  wrapped.add(proto);
  const pop = proto.popErrorScope;
  proto.popErrorScope = function (this: ScopedDevice) {
    return pop.call(this).catch(async (e: unknown) => {
      if (!isDroppedScope(e)) throw e;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const lost = await Promise.race([Promise.resolve(this.lost).then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), LOST_WAIT_MS)))]).finally(() => clearTimeout(timer));
      if (!lost) throw e;
      if (dropped++ === 0) console.info(`[PixelRenderer] the lost GPU device dropped three's pipeline error scopes ("${DROPPED_SCOPE}"): settled as empty, not errors`);
      return null;
    });
  };
}
