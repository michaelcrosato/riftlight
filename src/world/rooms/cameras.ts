/**
 * Camera Bench: one little course under every camera preset. Pads switch the preset (the
 * world, the hero and physics stay exactly as they are) and the zoom; movement is always
 * relative to the camera, so the same stick works in all of them.
 */
import type { CameraConfig } from '../../engine';
import type { RoomDef } from '../types';
import { WORLD_CAMERA } from '../shell';

const PRESETS: { label: string; note: string; camera: CameraConfig }[] = [
  { label: 'ISO', note: 'Orthographic, 35 degrees down and 45 around: the classic 3/4 view. Pixel-snapped.', camera: { ...WORLD_CAMERA } },
  { label: 'HIGH ISO', note: 'Steeper (55 degrees): more floor, less wall. Good for busy rooms.', camera: { ...WORLD_CAMERA, pitch: 55 } },
  { label: 'TOP-DOWN', note: 'Straight down, screen-up is north: Zelda, twin-stick shooters, strategy.', camera: { preset: 'topdown', viewHeight: 17 } },
  { label: 'SIDE', note: 'Straight side-on: a side-scroller. The hero is locked to their depth lane.', camera: { preset: 'side', viewHeight: 12 } },
  { label: 'THIRD', note: 'Perspective orbit behind the hero; drag or Q / E to orbit; it pulls in when walls block the view.', camera: { preset: 'third', distance: 7, pitch: 22 } },
  { label: 'FIRST', note: 'Through the hero\'s eyes: click to lock the mouse, Q / E to turn. The hero model hides.', camera: { preset: 'first', fov: 72 } },
  { label: 'CINEMATIC', note: 'A fixed perspective shot of the course (what the free camera\'s Enter key gives you).', camera: { preset: 'fixed', projection: 'perspective', position: [9, 7, 13], target: [0, 0.5, -1], fov: 50 } },
];

export const CAMERAS: RoomDef = {
  id: 'cameras',
  title: 'Camera Bench',
  wing: 'movement',
  about: 'Seven cameras over one course: isometric, a high isometric, top-down, side-on, third and first person and a fixed cinematic shot. Swapping never touches the world: the hero stays exactly where they are.',
  try: ['SIDE, then run across the course: the lane lock keeps you on a line', 'THIRD, then walk into the tunnel: the camera pulls in', 'FIRST, then climb the steps: zoom pads do nothing there'],
  spawn: [0, 0, 8.6],
  facing: Math.PI,
  guide: {
    what: 'A short course (crates, steps, a gap, a tunnel, a wall to climb) and pads for seven camera presets and two zoom levels.',
    how: [
      'A camera preset is a "rig": it owns a three.js camera and decides where it goes each frame from the point it follows (the hero\'s chest) and the input (zoom, orbit).',
      'Swapping (engine.setCamera) builds the new rig and points the render passes at its camera. The scene, physics, the hero and the pipeline are untouched; the game is told (onCameraChange) so it can lock the side lane or hide the model in first person.',
      'Orthographic rigs (iso, top-down, side) snap their position to whole art pixels in the view plane, so the picture never swims; physics is never snapped.',
      'Movement is camera-relative: the stick is turned into world directions through camera.groundBasis(), so "up" is always "away from the camera".',
      'The third-person rig casts a ray from the hero to where it wants to be and pulls in in front of anything in the way (colliders tagged noCamera are ignored).',
    ],
    uses: [
      'Isometric: Diablo, Hades, Final Fantasy Tactics. Top-down: Zelda: A Link to the Past, Hotline Miami.',
      'Side-on 3D: Trine, Little Nightmares, New Super Mario Bros.',
      'Third person: Mario 64\'s Lakitu camera; first person: every shooter; fixed angles: Resident Evil.',
    ],
    ask: ['an isometric camera that snaps to pixels', 'a side-scroller camera with a depth lane', 'a third-person camera that avoids walls', 'a fixed cinematic camera angle'],
    cost: 'A few vector operations per frame; the third-person rig adds one ray cast.',
    code: [
      {
        title: 'Pixel snapping in the view plane',
        file: 'src/engine/camera.ts',
        src: `this.pixel = worldUnitsPerPixel(this.viewHeight, u.resolution);
...
const r = snapToGrid(pos.dot(this.right), px);
const up = snapToGrid(pos.dot(this.up), px);
pos.copy(this.right).multiplyScalar(r).addScaledVector(this.up, up)
  .addScaledVector(this.forward, f);`,
      },
    ],
    words: ['camera preset', 'orthographic', 'perspective', 'pixel snapping', 'raycast'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(24, 20, { floor: ['lime', 'green'] });
    // the course, west to east
    kit.box([-8, 0.5, -3], [1, 1, 1], 'orange', { side: 'red' });
    kit.box([-6.5, 0.75, -3], [1, 1.5, 1], 'orange', { side: 'red' });
    for (let i = 0; i < 4; i++) kit.box([-4.5 + i * 0.6, 0.2 + i * 0.2, -3], [0.6, 0.4 + i * 0.4, 2], 'mist', { side: 'slate' });
    kit.box([-1.6, 0.8, -3], [1.8, 1.6, 2], 'mist', { side: 'slate' });
    kit.box([2.2, 0.8, -3], [1.8, 1.6, 2], 'mist', { side: 'slate' });
    // a tunnel
    kit.box([5.5, 1.2, -3], [3, 0.3, 2.4], 'night', { side: 'slate' });
    kit.box([5.5, 0.5, -1.95], [3, 1, 0.3], 'night', { side: 'slate' });
    kit.box([5.5, 0.5, -4.05], [3, 1, 0.3], 'night', { side: 'slate' });
    // a climbing wall
    kit.box([9, 1.75, -3], [1.2, 3.5, 2], 'lime', { side: 'green', tags: ['climbable'] });
    kit.label([0, 2.4, -3], 'THE COURSE', { color: 'sand', range: 9 });
    PRESETS.forEach((p, i) =>
      kit.pad([-9 + i * 3, 0, 3], {
        label: p.label,
        color: 'sky',
        group: 'camera',
        initial: i === 0,
        note: p.note,
        apply: () => e.setCamera(p.camera, { syncUrl: false }),
      }),
    );
    kit.pad([-3, 0, 6.5], { label: 'ZOOM IN', color: 'teal', note: 'camera.setZoom(zoom x 1.5) (the wheel and + / - do the same).', apply: () => e.camera.setZoom(e.camera.zoom * 1.5) });
    kit.pad([0, 0, 6.5], { label: 'ZOOM OUT', color: 'teal', note: 'camera.setZoom(zoom / 1.5).', apply: () => e.camera.setZoom(e.camera.zoom / 1.5) });
    kit.pad([3, 0, 6.5], { label: 'SHAKE', color: 'red', note: 'engine.shake.add(0.8): the same shake in every preset (by whole art pixels in the ortho ones).', apply: () => e.shake.add(0.8) });
    return {
      status: () => `camera ${e.camera.preset} zoom ${e.camera.zoom.toFixed(2)}`,
      api: { camera: () => e.camera.describe() },
    };
  },
};
