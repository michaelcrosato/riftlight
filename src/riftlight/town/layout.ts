/**
 * Emberfall's layout as data, in screen-space metres (`sx` right, `sy` up the screen) for the iso
 * camera at 45° yaw: `iso()` turns them into world (x, z), so the data reads like the picture.
 * The plaza and its ring (the first 15 m) are the hub; `districts` and the pieces after it are the
 * outskirts (town/outskirts.ts) out to the walkable edge, `radius`, and the forest beyond it.
 */
const S2 = Math.SQRT1_2;

/** Screen-space (sx right, sy up) → world (x, z) for the iso camera at yaw 45°. */
export const iso = (sx: number, sy: number): [number, number] => [(sx - sy) * S2, (-sx - sy) * S2];

/** World (x, z) → screen-space (sx, sy): the inverse of `iso`. */
export const screenOf = (x: number, z: number): [number, number] => [(x - z) * S2, (-x - z) * S2];

export const TOWN_LAYOUT = {
  /** The walkable circle around the plaza (m); the forest starts past it. */
  radius: 31,
  /** The iso camera the game is seen with (degrees; `RIFTLIGHT_OPTIONS.camera` takes it): what stands taller than the hero hides the ground behind it. */
  view: { yaw: 45, pitch: 42 },
  plaza: 5.2,
  fountain: [0, 0.4] as const,
  obelisk: [0, 8.6] as const,
  /** Buildings with a keeper face between the plaza and the camera, so nobody stands under a roof. */
  smithy: [-9.4, 3.0, 88] as const,
  market: [9.4, 3.0, 2] as const,
  tent: [8.4, -4.4, 10] as const,
  stash: [-4.9, -3.9, 80] as const,
  vex: [2.8, 6.4] as const,
  houses: [
    [-11.5, 10, 'red'],
    [11.5, 10.5, 'teal'],
    [-14, -4, 'plum'],
  ] as const,
  lanterns: [
    [-4.6, 3.2],
    [4.6, 3.2],
    [-3.6, -4.6],
    [3.6, -4.6],
    // the outskirts: the watch's colonnade, the tavern's patio, the bridge, the farm gate, the pond, the south gate, the graves
    [-5.4, 13.8],
    [13.2, 13.2],
    [20.2, -0.6],
    [-18.6, 8.2],
    [-7.4, -15.4],
    [-2.2, -26.4],
    [8.6, -16.6],
  ] as const,
  spawn: [0, -2.9] as const,
  portalSpawn: [0, 5.1] as const,
  /**
   * The outskirts' districts, each by a spot a visitor walks to (the tests walk there from the
   * spawn): the Old Watch's courtyard behind the obelisk, the tavern's patio, the bridge's west end,
   * the hunter's camp across the stream, the watchmen's graves, the south gate on the road out, the
   * willow pond and the farmyard. Each is a spot the camera shows the hero at, feet to head: nothing
   * stands between it and the camera.
   */
  districts: {
    watch: [-2.9, 19.5],
    tavern: [14.6, 15.2],
    bridge: [19.6, 1.5],
    camp: [25.9, 1.6],
    graves: [9.8, -17.6],
    gate: [0, -23.7],
    pond: [-8.2, -16.8],
    farm: [-17.8, 1.5],
  } as const,
  /**
   * The Old Watch: a curtain wall on an arc of this radius, from `from` to `to` degrees (screen
   * angle, 90 = north), its gate at `gate` degrees (off the obelisk's axis, so the colonnade up to it
   * never runs behind the obelisk).
   */
  watch: { wall: 28, from: 66, to: 120, gate: 96 } as const,
  /** The stream runs north–south at `sx`; the bridge crosses it at `bridge` (sy). */
  stream: { sx: 23, bridge: 1.5 } as const,
  tavern: [18, 19.6] as const,
  /** The farm's field (centre and size), the barn and the well. */
  field: [-24.2, 1, 7.2, 12] as const,
  barn: [-22.6, 13.4] as const,
  well: [-17.4, 5.2] as const,
  camp: [27.2, -0.8] as const,
  /** The pond's centre and its tile's scale (a 3 m tile drawn `scale` times as big). */
  pond: [-12.6, -20.4, 2.4] as const,
  graves: [12.2, -21.8] as const,
  /** The south gate: a timber gate over the road, a watch tower each side off the road. */
  gate: [0, -28.6] as const,
};
