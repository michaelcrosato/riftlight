/**
 * Pure layout math for pixel-perfect presentation. No DOM, no three.js: unit-tested.
 *
 * The canvas backing store is sized to `art × scale` device pixels with an integer
 * `scale`, and the scene renders at exactly the art resolution (pixelSize = scale). Every
 * art pixel therefore covers an integer block of device pixels, and the canvas is centered
 * inside the viewport. Fixed/adaptive framing letterboxes; fill framing crops only the
 * excess device pixels at the edges of the last art pixel.
 *
 * Three aspect modes:
 * - `fixed`: the art resolution is exactly `internal` (16:9); other screen shapes letterbox.
 * - `adaptive`: the art *height* stays `internal.height` and the art width follows the
 *   screen's aspect (clamped to ADAPTIVE_ASPECT), so phones in portrait or landscape and
 *   odd window shapes fill the screen. Still integer-scaled. On a 16:9 screen it is
 *   identical to `fixed`.
 * - `fill`: the art width and height follow the viewport at the nearest integer scale
 *   to `internal.height`. The canvas covers every edge without stretching art pixels.
 */

export interface Resolution {
  readonly width: number;
  readonly height: number;
}

export const RESOLUTIONS = {
  /** Default internal resolution (16:9, 4× → 1920×1080). */
  default: { width: 480, height: 270 },
  /** Chunkier comparison resolution (16:9, 6× → 1920×1080). */
  compare: { width: 320, height: 180 },
} as const satisfies Record<string, Resolution>;

export type AspectMode = 'fixed' | 'adaptive' | 'fill';

/** Art aspect ratios (width / height) the adaptive mode allows; beyond them it letterboxes. */
export const ADAPTIVE_ASPECT = { min: 0.4, max: 2.4 } as const;

export interface Framing {
  /** Art (internal) resolution actually rendered. Equals `internal` in fixed mode. */
  readonly artWidth: number;
  readonly artHeight: number;
  /** Device pixels per art pixel. Integer whenever `integer` is true. */
  readonly scale: number;
  /** True when every art pixel maps to an integer block of device pixels. */
  readonly integer: boolean;
  /** Canvas backing-store size in device pixels. */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Canvas CSS size and offset inside the viewport, in CSS pixels. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

const evenFloor = (v: number) => Math.max(2, 2 * Math.floor(v / 2));
const clampWidth = (w: number, height: number) =>
  Math.min(Math.max(w, 2 * Math.ceil((height * ADAPTIVE_ASPECT.min) / 2)), evenFloor(height * ADAPTIVE_ASPECT.max));

/**
 * @param viewportWidth  viewport width in CSS pixels
 * @param viewportHeight viewport height in CSS pixels
 * @param devicePixelRatio window.devicePixelRatio
 * @param internal the art resolution (in adaptive mode: its height, and the 16:9 fallback)
 * @param aspect `fixed` (exactly `internal`), `adaptive` (art width follows the screen),
 * or `fill` (both art dimensions follow the screen, with no letterbox)
 */
export function computeFraming(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  internal: Resolution,
  aspect: AspectMode = 'fixed',
): Framing {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const deviceRound = aspect === 'fill' ? Math.ceil : Math.floor;
  const deviceWidth = Math.max(1, deviceRound(viewportWidth * dpr));
  const deviceHeight = Math.max(1, deviceRound(viewportHeight * dpr));
  if (aspect === 'fill') {
    // Keep square, whole-device-pixel blocks. Grow the art target by the final partial
    // block instead of leaving the unused space around a fixed-height target black.
    const scale = Math.max(1, Math.round(deviceHeight / internal.height));
    const artWidth = Math.ceil(deviceWidth / scale);
    const artHeight = Math.ceil(deviceHeight / scale);
    const canvasWidth = artWidth * scale;
    const canvasHeight = artHeight * scale;
    return {
      artWidth,
      artHeight,
      scale,
      integer: true,
      canvasWidth,
      canvasHeight,
      cssWidth: canvasWidth / dpr,
      cssHeight: canvasHeight / dpr,
      // A sub-art-pixel overscan is clipped by the viewport; align it to device pixels.
      offsetX: Math.floor((deviceWidth - canvasWidth) / 2) / dpr,
      offsetY: Math.floor((deviceHeight - canvasHeight) / 2) / dpr,
    };
  }
  const artHeight = internal.height;
  let artWidth = internal.width;
  let fit = Math.min(deviceWidth / artWidth, deviceHeight / artHeight);
  if (aspect === 'adaptive') {
    // The art takes the screen's aspect (as many art columns as the screen shape allows at
    // this art height), then the largest integer scale that fits.
    artWidth = clampWidth(evenFloor((artHeight * deviceWidth) / deviceHeight), artHeight);
    fit = Math.min(deviceWidth / artWidth, deviceHeight / artHeight);
  }

  if (fit >= 1) {
    const scale = Math.floor(fit);
    const canvasWidth = artWidth * scale;
    const canvasHeight = artHeight * scale;
    const cssWidth = canvasWidth / dpr;
    const cssHeight = canvasHeight / dpr;
    return {
      artWidth,
      artHeight,
      scale,
      integer: true,
      canvasWidth,
      canvasHeight,
      cssWidth,
      cssHeight,
      // Offsets in whole *device* pixels so art pixels never straddle device pixels at fractional DPR.
      offsetX: Math.floor((deviceWidth - canvasWidth) / 2) / dpr,
      offsetY: Math.floor((deviceHeight - canvasHeight) / 2) / dpr,
    };
  }

  // Viewport smaller than one art pixel per device pixel: render at the internal
  // resolution and let the browser shrink it (nearest-neighbor via CSS), still letterboxed.
  const cssScale = Math.min(viewportWidth / artWidth, viewportHeight / artHeight);
  const cssWidth = artWidth * cssScale;
  const cssHeight = artHeight * cssScale;
  return {
    artWidth,
    artHeight,
    scale: 1,
    integer: false,
    canvasWidth: artWidth,
    canvasHeight: artHeight,
    cssWidth,
    cssHeight,
    offsetX: Math.floor((viewportWidth - cssWidth) / 2),
    offsetY: Math.floor((viewportHeight - cssHeight) / 2),
  };
}

/**
 * Size of one art pixel in world units for an orthographic camera whose visible
 * height is `viewHeight` world units. Used to snap the *camera* (never physics) to the
 * pixel grid so static geometry doesn't shimmer while the camera moves.
 */
export function worldUnitsPerPixel(viewHeight: number, internal: Resolution): number {
  return viewHeight / internal.height;
}

export function snapToGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}
