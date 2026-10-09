/**
 * Mirrors & Monitors: rendering the scene more than once a frame. Two security cameras draw
 * the room into small textures before the frame, shown on monitors (render to texture); the
 * wall mirror draws it again from a camera reflected in its plane. The screens and the mirror
 * sit on a layer the extra cameras never see, so nothing samples a texture it is drawing into.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are dynamically typed */
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3 } from 'three/webgpu';
import { dot, mix, screenUV, sin, texture, uniform, vec3 } from 'three/tsl';
import { Mirror, PALETTE, RenderView, setLookLayer, toonMaterial } from '../../engine';
import type { Knob, RoomDef } from '../types';

type V3 = [number, number, number];

const SIZES: readonly [number, number][] = [
  [64, 36],
  [160, 90],
  [320, 180],
];

/** Distinct colours in a read-back texture (8-bit or half-float channels, RGBA) and a hash of them all. */
function colours(px: ArrayLike<number>): { colours: number; hash: number } {
  const seen = new Set<string>();
  let hash = 0;
  for (let k = 0; k + 3 < px.length; k += 4) {
    seen.add(`${px[k]},${px[k + 1]},${px[k + 2]}`);
    for (let c = 0; c < 3; c++) hash = (Math.imul(hash, 31) + px[k + c]!) | 0;
  }
  return { colours: seen.size, hash };
}

export const VIEWS: RoomDef = {
  id: 'views',
  title: 'Mirrors & Monitors',
  wing: 'rendering',
  about:
    'The room drawn three more times every frame. Two security cameras render it into small textures shown on the monitors (render to texture: a minimap, a scope, a portal works the same way), and the mirror renders it again from a camera reflected in the glass. Walk about and watch yourself on all three.',
  try: ['Wave at the mirror', 'Walk where CAM 1 and CAM 2 can see you', 'NIGHT VISION on the monitors', 'Lower the refresh rate or the resolution (T)'],
  spawn: [-1, 0, 2],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A hall with a wall-sized mirror, two security cameras panning on poles, and a desk of monitors showing what they see.',
    how: [
      'Render to texture: a second camera draws the scene into a render target (a texture the GPU can draw into) instead of the screen. That happens before the frame, so the monitors show this frame, not the last.',
      'A monitor is just a plane whose material samples that texture. The pixel pass then pixelates it with everything else: a 160 x 90 feed on a screen a few art pixels wide.',
      'The mirror is a reflector: a camera mirrored in the glass plane (its position and direction reflected) renders the room into a texture the glass samples at each pixel\'s screen position (left and right swapped), so the reflection lines up from wherever you look. An oblique near plane, the glass itself, cuts away what is behind it; it works for this orthographic camera as well as perspective ones.',
      'The extra cameras never see the screens\' layer (the monitors and the mirror): a texture is never sampled while it is being drawn into, and the views don\'t recurse.',
      'Every view is another render of the scene: it costs about as much as the frame itself at its size. Rendering every second or fourth frame, or smaller, is the usual saving.',
    ],
    uses: [
      'Security monitors and cameras: Five Nights at Freddy\'s, Prey, Watch Dogs; scopes and rear-view mirrors in racing games.',
      'Portals (Portal, Prey 2006), minimaps drawn from above, mirrors in bathrooms everywhere (Hitman, Silent Hill).',
    ],
    ask: ['security camera monitors in the level', 'render a camera to a texture', 'a working mirror', 'a scope or picture-in-picture view'],
    cost: 'Each camera feed is one extra scene render at its size (160 x 90 by default, every frame) plus another render of the shadow map from its point of view; the mirror the same at about art resolution. Halving the refresh halves the cost.',
    code: [
      {
        title: 'A view: the scene drawn into a texture before the frame',
        file: 'src/engine/render/renderView.ts',
        src: `renderer.setRenderTarget(this.target);
renderer.render(scene, this.camera);
renderer.setRenderTarget(previous);`,
      },
      {
        title: 'The mirror: the camera reflected in the glass, the glass its near plane',
        file: 'src/engine/render/mirror.ts',
        src: `v.position.copy(_camPos);
v.lookAt(_target);
_clip.multiplyScalar(2 / _clip.dot(_q));`,
      },
      {
        title: 'Views never see the screens: nothing samples what it is drawing',
        file: 'src/engine/render/renderView.ts',
        src: `this.camera.layers.set(0); // never the screens' layer`,
      },
    ],
    words: ['render target', 'render to texture', 'reflector', 'look layer'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(22, 16, { floor: ['slate', 'night'], wall: { color: 'blue', side: 'navy', height: 4 } });
    // things to watch: two pillars and a turning sculpture
    for (const [x, z, c] of [
      [-7, -1, 'orange'],
      [4, 3, 'lime'],
    ] as const)
      kit.box([x, 1.25, z], [1, 2.5, 1], c, { side: 'night' });
    const sculpture = new Mesh(new BoxGeometry(1.2, 1.2, 1.2), toonMaterial(PALETTE.red));
    sculpture.position.set(-2, 1.5, -3);
    sculpture.castShadow = true;
    setLookLayer(sculpture, 'actors');
    ctx.scene.add(sculpture);
    kit.box([-2, 0.4, -3], [1.4, 0.8, 1.4], 'sand', { side: 'orange' });

    // the mirror on the north wall (whose inner face is at z = -7)
    const mirror = new Mirror({ size: [8, 3], tint: PALETTE.sky, tintAmount: 0.12 });
    mirror.mesh.position.set(-3.5, 1.8, -6.9);
    ctx.scene.add(mirror.mesh);
    const stopMirror = mirror.attach(ctx.engine.renderer, ctx.scene);
    kit.box([-3.5, 1.8, -6.98], [8.6, 3.6, 0.1], 'sand', { side: 'orange' }); // the frame
    let mirrorOn = true;

    // the security cameras: a body on a pole, panning; each a RenderView
    let size = 1;
    let every = 1;
    let pan = true;
    let night = false;
    const cams = [
      { at: [-10, 3.4, 6.5] as V3, look: [-1, 0.5, -2] as V3, phase: 0, name: 'CAM 1' },
      { at: [10, 2.8, -1] as V3, look: [-3, 0.8, 1] as V3, phase: 2, name: 'CAM 2' },
    ].map((c) => {
      const view = new RenderView({ size: SIZES[size], fov: 70, every });
      view.camera.position.set(...c.at);
      const body = new Group();
      body.position.set(...c.at);
      const box = new Mesh(new BoxGeometry(0.4, 0.35, 0.7), toonMaterial(PALETTE.white));
      const lens = new Mesh(new CylinderGeometry(0.12, 0.12, 0.15, 10).rotateX(Math.PI / 2).translate(0, 0, -0.42), toonMaterial(PALETTE.ink));
      body.add(box, lens);
      body.traverse((o) => setLookLayer(o, 'actors'));
      ctx.scene.add(body);
      kit.cylinder([c.at[0], c.at[1] / 2, c.at[2]], 0.08, c.at[1], 'slate');
      const stop = view.attach(ctx.engine.renderer, ctx.scene);
      return { ...c, view, body, stop, yaw: 0 };
    });

    // the monitor desk, facing the room
    const nightMix = uniform(0) as any;
    const time = uniform(0) as any;
    const monitor = (view: RenderView) => {
      const m = new MeshBasicNodeMaterial();
      const feed = texture(view.texture) as any;
      const luma = dot(feed.rgb, vec3(0.3, 0.59, 0.11));
      const scan = sin(screenUV.y.mul(400).add(time.mul(8))).mul(0.06).add(0.94);
      const green = vec3(0.25, 1, 0.35).mul(luma.mul(1.6)).mul(scan);
      m.colorNode = mix(feed.rgb, green, nightMix);
      return m;
    };
    // the monitor wall, beside the mirror on the north wall
    const screens = cams.map((c, i) => {
      const x = 3.2 + i * 3.4;
      const s = new Mesh(new PlaneGeometry(3, 1.6875), monitor(c.view));
      s.position.set(x, 2, -6.9);
      RenderView.screen(s);
      ctx.scene.add(s);
      kit.box([x, 2, -6.98], [3.3, 2, 0.1], 'ink');
      kit.label([x, 3.3, -6.9], c.name, { color: 'lime', range: 14 });
      return s;
    });
    kit.box([4.9, 0.45, -6.3], [7, 0.9, 1.2], 'night', { side: 'ink' }); // the desk under them

    const remake = () => {
      for (const c of cams) {
        c.view.setSize(...SIZES[size]!);
        c.view.every = every;
      }
    };
    kit.pad([-4, 0, 5], { label: 'PAN', color: 'sky', note: 'The cameras sweep back and forth (or hold still).', initial: true, apply: (_r, pad) => ((pan = !pan), kit.lightPad(pad, pan)) });
    kit.pad([-1.5, 0, 5], { label: 'NIGHT VISION', color: 'lime', note: 'The monitors\' shader: the feed\'s brightness in green, with scanlines. The views are the same, only how they are shown changes.', apply: (_r, pad) => ((night = !night), (nightMix.value = night ? 1 : 0), kit.lightPad(pad, night)) });
    kit.pad([1, 0, 5], {
      label: 'MIRROR',
      color: 'white',
      note: 'The mirror off: plain glass, and one scene render a frame saved.',
      initial: true,
      apply: (_r, pad) => {
        mirrorOn = mirror.enabled = !mirrorOn;
        kit.lightPad(pad, mirrorOn);
      },
    });
    const knobs: Knob[] = [
      { kind: 'choice', id: 'size', label: 'Feed size', options: SIZES.map(([w, h]) => `${w} x ${h}`), get: () => size, set: (i) => ((size = i), remake()), hint: 'The textures the cameras draw into: smaller is cheaper and blockier.' },
      { id: 'every', label: 'Refresh', min: 1, max: 8, step: 1, get: () => every, set: (v) => ((every = v), remake()), format: (v) => (v === 1 ? 'every frame' : `every ${v} frames`), initial: 1, hint: 'Drawing a feed less often is the usual saving: security footage at 15 fps looks right anyway.' },
    ];
    const look = new Vector3();
    let t = 0;
    return {
      knobs,
      update(dt) {
        t += dt;
        time.value = t;
        sculpture.rotation.set(t * 0.4, t * 0.7, 0);
        for (const c of cams) {
          c.yaw = pan ? Math.sin(t * 0.5 + c.phase) * 0.6 : c.yaw;
          look.set(...c.look).sub(c.view.camera.position);
          const base = Math.atan2(look.x, look.z);
          const pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
          c.view.camera.rotation.set(0, 0, 0);
          c.view.camera.rotation.order = 'YXZ';
          c.view.camera.rotation.y = base + Math.PI + c.yaw;
          c.view.camera.rotation.x = pitch; // (YXZ: a positive x turn tips a camera up)
          c.body.rotation.set(pitch, base + Math.PI + c.yaw, 0, 'YXZ');
        }
      },
      draw() {
        const feeds = cams.map((c) => `${c.name} ${c.view.renders}`).join(' · ');
        ctx.hud.text(4, 18, `${mirrorOn ? 'MIRROR ON' : 'MIRROR OFF'} · ${feeds} RENDERS`, { anchor: 'bottom-left', color: 'sky' });
      },
      dispose() {
        for (const c of cams) {
          c.stop();
          c.view.dispose();
        }
        for (const s of screens) (s.material as MeshBasicNodeMaterial).dispose();
        stopMirror();
        mirror.dispose();
      },
      status: () => `mirror ${mirrorOn} ${mirror.renders} feeds ${cams.map((c) => c.view.renders).join(',')}`,
      api: {
        renders: () => cams.map((c) => c.view.renders),
        mirrorRenders: () => mirror.renders,
        /** Put the hero at (x, z) facing the mirror (tests). */
        stand: (x: number, z: number) => room.hero?.teleport([x, 0, z], Math.PI),
        mirror: (on: boolean) => (mirrorOn = mirror.enabled = on),
        /** Read the mirror's texture back: how many distinct colours (an empty one has one or two). */
        reflection: async () => {
          const { width: w, height: h } = mirror.target;
          return { w, h, ...colours(await ctx.engine.renderer.renderer.readRenderTargetPixelsAsync(mirror.target, 0, 0, w, h)) };
        },
        night: (on: boolean) => ((night = on), (nightMix.value = on ? 1 : 0)),
        size: (i: number) => ((size = i), remake()),
        every: (n: number) => ((every = n), remake()),
        /** Read a feed's texture back: its size and how many distinct colours it holds (an empty one has one). */
        feed: async (i: number) => {
          const v = cams[i]!.view;
          const { width: w, height: h } = v.target;
          return { w, h, ...colours(await ctx.engine.renderer.renderer.readRenderTargetPixelsAsync(v.target, 0, 0, w, h)) };
        },
      },
    };
  },
};
