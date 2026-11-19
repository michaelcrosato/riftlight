/**
 * Pure layout math for pixel-perfect presentation. No DOM, no three.js: unit-tested.
 *
 * The canvas backing store is sized to `art × scale` device pixels with an integer
 * `scale`, and the scene renders at exactly the art resolution (pixelSize = scale). Every
 * art pixel therefore covers an integer block of device pixels, and the canvas is centered
 * inside the viewport. Fill framing (the default) crops only the excess device pixels at the
 * edges of the last art pixel; fixed/adaptive framing letterboxes.
 *
 * Three aspect modes:
 * - `fill` (default): the art width and height follow the viewport at the nearest integer
 *   scale to `internal.height`. The canvas covers every edge without stretching art pixels:
 *   the whole window at every shape, as 52in1 requires.
 * - `adaptive` (opt-in, letterboxes): the art *height* stays `internal.height` and the art
 *   width follows the screen's aspect (clamped to ADAPTIVE_ASPECT), integer-scaled: bars
 *   wherever the largest integer scale leaves room. On a 16:9 screen it is `fixed`.
 * - `fixed` (opt-in, letterboxes): the art resolution is exactly `internal` (16:9).
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

/** A page's viewport: its size in CSS pixels and the device pixel ratio (a recording keeps it: `Recording.view`). */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

/** A phone: a viewport whose short side is under this many CSS pixels (`touchScale`). */
export const PHONE_SHORT_SIDE = 500;

/**
 * The short side, CSS pixels, whose art rows at a game's touch density every phone keeps at least
 * (`touchRows`): a phone held sideways is laid out for 340 CSS px and more (a Pixel under Chrome's
 * bar, an iPhone in Safari), 170 rows at 2 CSS px an art pixel.
 */
export const TOUCH_ROWS_SIDE = 340;

/**
 * The least art rows on a phone's short side at `cssPerArt` CSS pixels per art pixel
 * (`EngineOptions.touchDensity`): those of a `TOUCH_ROWS_SIDE` side (170 at 2, 113 at 3); 0 for none.
 */
export function touchRows(cssPerArt: number): number {
  return cssPerArt > 0 ? Math.floor(TOUCH_ROWS_SIDE / cssPerArt + 1e-9) : 0;
}

/**
 * The least device pixels per art pixel a view keeps (`computeFraming`'s `minScale`) for about
 * `cssPerArt` CSS pixels per art pixel (`EngineOptions.touchDensity`, on a page with touch controls,
 * also while they step aside for a pad or the keyboard): on a phone (the viewport's short side under
 * `PHONE_SHORT_SIDE`) in either orientation, so text and targets stay thumb-sized; 1 (no minimum)
 * elsewhere, or when `cssPerArt` is 0. The whole number of device pixels nearest `cssPerArt` CSS
 * pixels (a tie takes the bigger): exactly that at DPR 1, 1.5, 2, 2.5, 3 or 3.5; at a fractional DPR
 * whose `cssPerArt` CSS pixels fall between two whole device pixels, the nearer, so the art keeps
 * about the rows the game was laid out for (a Pixel's DPR 2.625 takes 5 device pixels at 2, 1.9 CSS
 * pixels: 189 rows held sideways at 360 CSS px, where 6 (2.3 CSS px) left 158). Where that leaves
 * the short side fewer than `touchRows` rows (a phone held sideways under a browser's bar: a Pixel
 * 10's 303 CSS px would draw 160 at 5), the largest whole number of device pixels that keeps them
 * (4 there: 1.52 CSS px, 199 rows). A pure function of the viewport and the density, both recorded
 * (`Recording.view`, `Recording.density`): a replay frames the same way.
 */
export function touchScale(viewport: Viewport, cssPerArt: number): number {
  const side = Math.min(viewport.width, viewport.height);
  if (!(cssPerArt > 0) || side >= PHONE_SHORT_SIDE) return 1;
  const dpr = viewport.dpr > 0 ? viewport.dpr : 1;
  // the short side in device pixels as `computeFraming` rounds it under `fill`, and its rows
  const device = Math.max(1, Math.ceil(side * dpr));
  const rows = touchRows(cssPerArt);
  let scale = Math.max(1, Math.floor(cssPerArt * dpr + 0.5 + 1e-9));
  while (scale > 1 && Math.ceil(device / scale) < rows) scale--;
  return scale;
}

/**
 * The framing and art resolution of a view (PixelRenderer's canvas, or a HeadlessView's viewport):
 * `computeFraming`, and the art size as a resolution. Identity is kept where nothing changed: the
 * `current` object while the art size stays, else `base` itself when the art size equals it (a
 * fixed or 16:9 view reports the preset it was given), else a new one. `minScale`: the least
 * device pixels per art pixel under `fill` (`touchScale`).
 */
export function frameView(viewport: Viewport, base: Resolution, aspect: AspectMode, current: Resolution, minScale = 1): { framing: Framing; resolution: Resolution } {
  const framing = computeFraming(viewport.width, viewport.height, viewport.dpr, base, aspect, minScale);
  const { artWidth: width, artHeight: height } = framing;
  const resolution = current.width === width && current.height === height ? current : base.width === width && base.height === height ? base : { width, height };
  return { framing, resolution };
}

const evenFloor = (v: number) => Math.max(2, 2 * Math.floor(v / 2));
const clampWidth = (w: number, height: number) =>
  Math.min(Math.max(w, 2 * Math.ceil((height * ADAPTIVE_ASPECT.min) / 2)), evenFloor(height * ADAPTIVE_ASPECT.max));

/**
 * @param viewportWidth  viewport width in CSS pixels
 * @param viewportHeight viewport height in CSS pixels
 * @param devicePixelRatio window.devicePixelRatio
 * @param internal the art resolution (in adaptive mode: its height, and the 16:9 fallback)
 * @param aspect `fill` (default: both art dimensions follow the screen, with no letterbox),
 * `adaptive` (the art width follows the screen) or `fixed` (exactly `internal`); both letterbox
 * @param minScale `fill` only: at least this many device pixels per art pixel (fewer, bigger art
 * pixels: a phone's touch density, `touchScale`); the other modes keep their art size
 */
export function computeFraming(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
  internal: Resolution,
  aspect: AspectMode = 'fill',
  minScale = 1,
): Framing {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const deviceRound = aspect === 'fill' ? Math.ceil : Math.floor;
  const deviceWidth = Math.max(1, deviceRound(viewportWidth * dpr));
  const deviceHeight = Math.max(1, deviceRound(viewportHeight * dpr));
  if (aspect === 'fill') {
    // Keep square, whole-device-pixel blocks. Grow the art target by the final partial
    // block instead of leaving the unused space around a fixed-height target black.
    const scale = Math.max(1, Math.round(deviceHeight / internal.height), Math.floor(minScale));
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
