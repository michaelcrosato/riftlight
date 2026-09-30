/**
 * Pure layout math for pixel-perfect presentation. No DOM, no three.js: unit-tested.
 *
 * The canvas backing store is sized to `internal × scale` device pixels with an integer
 * `scale`, and the pixelation pass renders the scene at exactly `internal` resolution
 * (pixelSize = scale). Every art pixel therefore covers an integer block of device
 * pixels, and the canvas is centered (letterboxed) inside the viewport.
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

export interface Framing {
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

/**
 * @param viewportWidth  viewport width in CSS pixels
 * @param viewportHeight viewport height in CSS pixels
 * @param devicePixelRatio window.devicePixelRatio
 * @param internal the art resolution
 */
export function computeFraming(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  internal: Resolution,
): Framing {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const deviceWidth = Math.max(1, Math.floor(viewportWidth * dpr));
  const deviceHeight = Math.max(1, Math.floor(viewportHeight * dpr));
  const fit = Math.min(deviceWidth / internal.width, deviceHeight / internal.height);

  if (fit >= 1) {
    const scale = Math.floor(fit);
    const canvasWidth = internal.width * scale;
    const canvasHeight = internal.height * scale;
    const cssWidth = canvasWidth / dpr;
    const cssHeight = canvasHeight / dpr;
    return {
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
  const cssScale = Math.min(viewportWidth / internal.width, viewportHeight / internal.height);
  const cssWidth = internal.width * cssScale;
  const cssHeight = internal.height * cssScale;
  return {
    scale: 1,
    integer: false,
    canvasWidth: internal.width,
    canvasHeight: internal.height,
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
