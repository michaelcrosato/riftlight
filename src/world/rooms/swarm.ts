/**
 * GPU Swarm: tens of thousands of particles moved by a compute shader, written in TSL. Their
 * positions and velocities never leave the GPU: one compute dispatch moves them all each
 * frame, one instanced draw shows them. They swirl round an attractor, which can follow you.
 */
import { Vector3 } from 'three/webgpu';
import { GpuSwarm, PALETTE } from '../../engine';
import type { Knob, RoomDef } from '../types';

const COUNTS = [8192, 32768, 131072] as const;
const CENTER: [number, number, number] = [0, 2.5, -1];

export const SWARM: RoomDef = {
  id: 'swarm',
  title: 'GPU Swarm',
  wing: 'rendering',
  about:
    'Tens of thousands of particles, and the CPU never touches one. Their positions and speeds live in GPU memory; every frame one compute shader moves them all at once (pulled to a point, swirled round it, stirred by flowing noise) and one draw shows them. FOLLOW and they come after you.',
  try: ['Step on FOLLOW and run', 'SCATTER them, watch them gather', 'A hundred thousand of them (T)', 'More swirl, more turbulence (T)'],
  spawn: [0, 0, 5],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'A dark yard with a swarm of glowing particles swirling round a point; pads that make it follow you, scatter it, or calm it.',
    how: [
      'The particles\' positions and velocities are two storage buffers on the GPU: one vec3 per particle each. Nothing about them is in JavaScript.',
      'A compute shader (written in TSL, the same node language as the materials) runs once per particle each frame, all of them in parallel: it reads the particle\'s position and velocity, adds forces (a spring toward the attractor, harder the further out, a swirl round its vertical axis, a flow of 3D noise that drifts with time), takes away some speed (drag), moves it, and bounces it off the floor. Spring and swirl balance into an orbit, so the swarm holds together.',
      'The first dispatch scatters them in a ball: a hash of each particle\'s index gives its random point, so no data is uploaded at all.',
      'Drawing is one instanced sprite draw whose vertex stage reads the same position buffer (and colours by speed from the velocity buffer): the data goes from compute to the screen without a round trip.',
      'Only the uniforms change from the CPU each frame: the time, the step, the attractor and the sliders. On the WebGL 2 fallback, three runs the same compute shader through transform feedback.',
    ],
    uses: [
      'Sparks, embers, magic and swarms by the hundred thousand: Unreal\'s Niagara and Unity\'s VFX Graph run their particles on the GPU this way.',
      'Simulations that need numbers, not looks: fluids, crowds, cloth on the GPU; GPGPU work in general.',
    ],
    ask: ['GPU particles with a compute shader', 'a hundred thousand particles that follow the player', 'TSL compute shader for a simulation', 'particles that never touch the CPU'],
    cost: 'One compute dispatch and one draw per frame whatever the count. 131,072 particles is a few milliseconds of GPU on a laptop and nothing on the CPU. The WebGL 2 fallback does compute through transform feedback, which costs more: there it starts at 8,192.',
    code: [
      {
        title: 'Every particle, in parallel: forces, drag, move',
        file: 'src/engine/render/gpuSwarm.ts',
        src: `v.addAssign(acc.mul(dt));
v.mulAssign(float(1).sub(drag.mul(dt)).max(0));
p.addAssign(v.mul(dt));`,
      },
      {
        title: 'The draw reads the same buffer: no round trip',
        file: 'src/engine/render/gpuSwarm.ts',
        src: `material.positionNode = positions.toAttribute();`,
      },
    ],
    words: ['compute shader', 'storage buffer', 'TSL', 'instancing', 'particle'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(30, 24, { floor: ['night', 'ink'], wall: { color: 'navy', side: 'ink' } });
    kit.cylinder([CENTER[0], 0.05, CENTER[2]], 1, 0.1, 'navy', { ghost: true });
    // the WebGL 2 fallback runs compute through transform feedback, much heavier: it starts smaller
    const fallback = ctx.engine.renderer.backend !== 'WebGPU';
    let size = fallback ? 0 : 1; // index into COUNTS
    let swarm = new GpuSwarm({ count: COUNTS[size] ?? 32768, center: CENTER, colors: [PALETTE.sky, PALETTE.white] });
    ctx.scene.add(swarm.mesh);
    let follow = false;
    const settings = { pull: 2.5, swirl: 5, turbulence: 10 };
    const apply = () => {
      swarm.pull.value = settings.pull;
      swarm.swirl.value = settings.swirl;
      swarm.turbulence.value = settings.turbulence;
    };
    const remake = () => {
      swarm.dispose();
      swarm = new GpuSwarm({ count: COUNTS[size] ?? 32768, center: CENTER, colors: [PALETTE.sky, PALETTE.white] });
      ctx.scene.add(swarm.mesh);
      apply();
    };
    kit.pad([-4, 0, 8], {
      label: 'FOLLOW',
      color: 'sky',
      note: 'The attractor rides on your head: the swarm comes after you.',
      apply: (_r, pad) => {
        follow = !follow;
        kit.lightPad(pad, follow);
      },
    });
    kit.pad([0, 0, 8], { label: 'SCATTER', color: 'orange', note: 'Every particle back to a random point in the ball: a hash of its index, no data uploaded.', apply: () => swarm.reset() });
    kit.pad([4, 0, 8], { label: 'CALM', color: 'teal', note: 'No noise flow: only the pull and the swirl, a tidy vortex.', apply: (_r, pad) => ((settings.turbulence = settings.turbulence > 0 ? 0 : 10), apply(), kit.lightPad(pad, settings.turbulence === 0)) });
    const knobs: Knob[] = [
      { kind: 'choice', id: 'count', label: 'Particles', options: COUNTS.map((n) => n.toLocaleString('en')), get: () => size, set: (i) => ((size = i), remake()), hint: 'One dispatch, one draw, whatever the count.' },
      { id: 'pull', label: 'Pull', min: 0, max: 8, step: 0.25, get: () => settings.pull, set: (v) => ((settings.pull = v), apply()), initial: 2.5, hint: 'A spring to the middle: harder the further out. Against the swirl it sets how wide they circle.' },
      { id: 'swirl', label: 'Swirl', min: 0, max: 12, step: 0.5, get: () => settings.swirl, set: (v) => ((settings.swirl = v), apply()), initial: 5 },
      { id: 'turbulence', label: 'Turbulence', min: 0, max: 30, step: 1, get: () => settings.turbulence, set: (v) => ((settings.turbulence = v), apply()), initial: 10 },
    ];
    const feet = new Vector3();
    return {
      knobs,
      update(dt) {
        const h = room.hero?.hero;
        if (follow && h) {
          h.feetInto(feet);
          swarm.attractor.value.set(feet.x, feet.y + 1.6, feet.z);
        } else swarm.attractor.value.set(...CENTER);
        swarm.update(ctx.engine.renderer.renderer, dt);
      },
      draw() {
        ctx.hud.text(4, 18, `${swarm.count.toLocaleString('en')} PARTICLES · 1 COMPUTE DISPATCH + 1 DRAW PER FRAME`, { anchor: 'bottom-left', color: 'sky' });
      },
      dispose() {
        swarm.dispose();
      },
      status: () => `particles ${swarm.count} steps ${swarm.steps} follow ${follow}`,
      api: {
        count: () => swarm.count,
        steps: () => swarm.steps,
        follow: (on: boolean) => (follow = on),
        scatter: () => swarm.reset(),
        size: (i: number) => ((size = i), remake()),
        /** Read the positions back from the GPU (WebGPU only): how many moved off the origin, their mean distance to the attractor and height. */
        sample: async () => {
          const p = await swarm.read(ctx.engine.renderer.renderer);
          const a = swarm.attractor.value as Vector3;
          let placed = 0;
          let finite = 0;
          let dist = 0;
          let y = 0;
          let zs = 0;
          let xs = 0;
          let xx = 0;
          const n = swarm.count;
          const stride = Math.round(p.length / n); // 3, or 4 where a vec3 is padded to 16 bytes
          for (let i = 0; i < n; i++) {
            const x = p[i * stride]!;
            const yy = p[i * stride + 1]!;
            const z = p[i * stride + 2]!;
            if (!Number.isFinite(x + yy + z)) continue;
            finite++;
            if (x !== 0 || yy !== 0 || z !== 0) placed++;
            dist += Math.hypot(x - a.x, yy - a.y, z - a.z);
            y += yy;
            zs += z;
            xs += x;
            xx += x * x;
          }
          const k = Math.max(1, finite);
          // spread: the standard deviation of x (a swarm that never got placed moves as one point)
          return { n, finite, placed, dist: dist / k, y: y / k, z: zs / k, spread: Math.sqrt(Math.max(0, xx / k - (xs / k) ** 2)), stride };
        },
        /**
         * How many pixels of the frame the swarm covers: captured without it and with it,
         * compared. Works on both backends (no buffer read-back), so a swarm that never got
         * placed (all of it in one spot) shows up on the WebGL 2 fallback too.
         */
        coverage: async () => {
          const r = ctx.engine.renderer;
          swarm.mesh.visible = false;
          const without = await r.capture();
          swarm.mesh.visible = true;
          const withIt = await r.capture();
          let n = 0;
          for (let i = 0; i < without.pixels.length; i += 4) if (without.pixels[i] !== withIt.pixels[i] || without.pixels[i + 1] !== withIt.pixels[i + 1] || without.pixels[i + 2] !== withIt.pixels[i + 2]) n++;
          return { pixels: n, of: without.width * without.height };
        },
      },
    };
  },
};
