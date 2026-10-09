/**
 * Game Feel Lab: the same punch with and without juice. Punching bags hang from a frame on
 * ball joints; hits freeze the game for a few frames (hitstop), shake the screen, flash,
 * burst particles and swing the bag. Pads switch each one on and off, and change the game
 * speed. A ground pound on the SLAM plate sends a shockwave.
 */
import { BoxGeometry, CapsuleGeometry, Mesh, Quaternion, Vector3 } from 'three/webgpu';
import { PALETTE, RAPIER, setLookLayer, toonMaterial } from '../../engine';
import type { Knob, RoomDef } from '../types';

const PUNCHES = new Set(['Punch', 'Punch2', 'Kick', 'SweepKick', 'JumpKick', 'Dive']);

export const FEEL: RoomDef = {
  id: 'feel',
  title: 'Game Feel Lab',
  wing: 'movement',
  about:
    'Why some hits feel heavy: a few frames of freeze (hitstop), a jolt of screen shake, a flash, a puff of particles, a sound. Punch the bags (J) with each of them on and off, slow the game down, and ground-pound the slam plate.',
  try: ['Punch a bag (J, three times for a combo) with everything ON, then step on JUICE OFF', 'SLOW-MO 0.25x, then punch: physics, animation and particles all slow down', 'Ground pound (jump, then C) on the SLAM plate'],
  spawn: [0, 0, 5],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'Four punching bags hanging from a frame, pads that switch each piece of "juice" on and off, pads for the game speed, and a slam plate for ground pounds.',
    how: [
      'A hit is detected when the hero\'s animation becomes a punch or kick while a bag is within reach in front of them. The bag gets an impulse at the hit point, so it swings on its ball joint.',
      'Hitstop: engine.hitstop(0.09) freezes game time for 0.09 s of real time. Physics, animation, particles and tweens stop; rendering, screen shake and transitions keep going.',
      'Screen shake: engine.shake.add(0.35) adds "trauma". Trauma drains over time, and the camera offset is trauma squared times smooth noise (sums of sines), moved by whole art pixels so the picture jumps like old hardware.',
      'Flash: engine.screen.flash() mixes a colour over the frame and fades it out in four steps.',
      'Game speed: engine.timeScale scales game time itself, so everything that runs on it (physics steps, animation, particles, tweens, the camera follow) slows down together.',
      'The slam: a ground pound landing on the plate sends engine.screen.shockwave(at) (a ring that pushes the picture outward), a shake, dust and an impulse to the bags.',
    ],
    uses: [
      'Hitstop: Street Fighter and Smash Bros freeze both fighters on every hit; Hollow Knight on nail hits.',
      'Screen shake with trauma: Vlambeer games (Nuclear Throne) made "juice" famous; the trauma-squared curve is from Squirrel Eiserloh\'s GDC talk.',
      'Slow motion: Max Payne\'s bullet time, the last kill of a round in many shooters.',
    ],
    ask: ['hitstop on hits, about 5 frames', 'screen shake that builds with bigger hits', 'a slow-motion button', 'a shockwave when the player ground-pounds'],
    cost: 'Nothing measurable: a timer, a few sines for the shake and four uniforms for the flash and the shockwave. The bags are four dynamic bodies and four joints.',
    code: [
      {
        title: 'Hitstop and time scale: game time per frame',
        file: 'src/engine/clock.ts',
        src: `delta(dt: number): number {
  if (this.stop > 0) {
    const frozen = Math.min(this.stop, dt);
    this.stop -= frozen;
    dt -= frozen;
  }
  return dt * this._scale;
}`,
      },
      {
        title: 'Trauma-squared shake',
        file: 'src/engine/shake.ts',
        src: `this.trauma = Math.max(0, this.trauma - this.decay * dt);
const k = this.maxOffset * this.trauma * this.trauma * this.strength;
...
k * (Math.sin(t * 41.3) * 0.6 + Math.sin(t * 73.7 + 1.3) * 0.4),`,
      },
    ],
    words: ['hitstop', 'screen shake', 'trauma', 'time scale', 'flash', 'shockwave', 'rigid body'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(24, 20, { floor: ['slate', 'night'], wall: { color: 'plum', side: 'night' } });
    const juice = { hitstop: true, shake: true, flash: true, particles: true };
    let hitstopTime = 0.09;
    let shakeAmount = 0.35;
    // the frame and the bags
    const bagMat = toonMaterial(PALETTE.red);
    kit.box([0, 3.4, -4], [12, 0.3, 0.4], 'night', { side: 'ink' });
    kit.box([-6, 1.7, -4], [0.3, 3.4, 0.3], 'night');
    kit.box([6, 1.7, -4], [0.3, 3.4, 0.3], 'night');
    const world = ctx.physics.world;
    const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 3.3, -4));
    const bags = [-4.2, -1.4, 1.4, 4.2].map((x) => {
      const mesh = new Mesh(new CapsuleGeometry(0.35, 0.9, 4, 10), bagMat);
      mesh.castShadow = true;
      setLookLayer(mesh, 'actors');
      ctx.scene.add(mesh);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 1.6, -4).setLinearDamping(0.3).setAngularDamping(1.2));
      world.createCollider(RAPIER.ColliderDesc.capsule(0.45, 0.35).setDensity(0.6), body);
      world.createImpulseJoint(RAPIER.JointData.spherical({ x, y: 0, z: 0 }, { x: 0, y: 1.7, z: 0 }), anchor, body, true); // hangs 1.7 m under the bar
      ctx.physics.bind(body, mesh);
      const rope = new Mesh(new BoxGeometry(0.05, 1, 0.05), toonMaterial(PALETTE.sand));
      ctx.scene.add(rope);
      return { body, mesh, rope, top: new Vector3(x, 3.3, -4), hits: 0 };
    });
    const up = new Vector3(0, 1, 0);
    const q = new Quaternion();
    const tip = new Vector3();
    /** Each rope runs from the bar to the top of its bag (drawn, not simulated: the joint holds the bag). */
    const ropes = () => {
      for (const b of bags) {
        tip.set(0, 0.8, 0).applyQuaternion(b.mesh.quaternion).add(b.mesh.position);
        const d = tip.clone().sub(b.top);
        const len = d.length();
        b.rope.position.copy(b.top).addScaledVector(d, 0.5);
        b.rope.scale.set(1, len, 1);
        b.rope.quaternion.copy(q.setFromUnitVectors(up, d.normalize()));
      }
    };
    kit.label([0, 4, -4], 'PUNCH THE BAGS · J', { color: 'sand', range: 10 });
    // juice switches
    const toggles: [keyof typeof juice, string, string][] = [
      ['hitstop', 'HITSTOP', 'The game freezes for a few frames when a hit lands.'],
      ['shake', 'SHAKE', 'Hits add trauma: the screen jolts by whole art pixels.'],
      ['flash', 'FLASH', 'A quick wash of colour on every hit.'],
      ['particles', 'PARTICLES', 'An impact burst where the fist lands.'],
    ];
    toggles.forEach(([key, label, note], i) => {
      const pad = kit.pad([-7.5 + i * 3, 0, 1.5], {
        label,
        color: 'lime',
        note,
        apply: (_r, p) => {
          juice[key] = !juice[key];
          kit.lightPad(p, juice[key]);
          room.toast(`${label} ${juice[key] ? 'ON' : 'OFF'}: ${note}`);
        },
      });
      kit.lightPad(pad, true);
    });
    kit.pad([5.5, 0, 1.5], {
      label: 'JUICE OFF',
      color: 'slate',
      note: 'Everything off: the same punch, the same physics, no feedback. It feels like hitting a cloud.',
      apply: () => {
        for (const k of Object.keys(juice) as (keyof typeof juice)[]) juice[k] = false;
        for (const p of kit.pads) if (toggles.some(([, l]) => l === p.def.label)) kit.lightPad(p, false);
      },
    });
    kit.pad([8.5, 0, 1.5], {
      label: 'JUICE ON',
      color: 'sand',
      note: 'Everything on.',
      apply: () => {
        for (const k of Object.keys(juice) as (keyof typeof juice)[]) juice[k] = true;
        for (const p of kit.pads) if (toggles.some(([, l]) => l === p.def.label)) kit.lightPad(p, true);
      },
    });
    // game speed
    const speeds: [string, number][] = [
      ['SLOW-MO 0.25X', 0.25],
      ['HALF 0.5X', 0.5],
      ['NORMAL 1X', 1],
      ['FAST 2X', 2],
    ];
    speeds.forEach(([label, v], i) =>
      kit.pad([-7.5 + i * 3, 0, 5], {
        label,
        color: 'sky',
        group: 'speed',
        initial: v === 1,
        note: `engine.timeScale = ${v}: physics, animation, particles and tweens run at ${v}x.`,
        apply: () => (e.timeScale = v),
      }),
    );
    // the slam plate
    kit.box([6, 0.05, 6.5], [3.2, 0.1, 3.2], 'orange', { side: 'red' });
    kit.label([6, 0.6, 6.5], 'SLAM · GROUND POUND HERE', { color: 'orange', range: 7 });
    const lamp = kit.light({ position: [0, 3, 0], color: PALETTE.sand, intensity: 7, radius: 12, flicker: 'none' });
    void lamp;
    kit.light({ position: [0, 2.6, -4], color: PALETTE.orange, intensity: 6, radius: 8, flicker: 'torch' });

    const fwd = new Vector3();
    const tmp = new Vector3();
    let lastAnim = '';
    let slams = 0;
    let hits = 0;
    let lastLandings = 0;
    const hit = (at: Vector3, dir: Vector3, strength: number) => {
      if (juice.hitstop) e.hitstop(hitstopTime * strength);
      if (juice.shake) e.shake.add(shakeAmount * strength);
      if (juice.flash) e.screen.flash(0xf4f4f4, { duration: 0.08, strength: 0.5 });
      if (juice.particles) ctx.particles.burst('impact', at, { direction: [dir.x, 0.3, dir.z] });
      ctx.audio.play('punch', { pitch: strength > 1 ? -3 : 0 });
    };
    const knobs: Knob[] = [
      { id: 'hitstop', label: 'Hitstop', min: 0, max: 0.4, step: 0.01, get: () => hitstopTime, set: (v) => (hitstopTime = v), format: (v) => `${Math.round(v * 60)} frames`, initial: 0.09 },
      { id: 'hit-shake', label: 'Shake per hit', min: 0, max: 1, step: 0.05, get: () => shakeAmount, set: (v) => (shakeAmount = v), initial: 0.35 },
    ];
    return {
      knobs,
      fixedUpdate() {
        const h = room.hero?.hero;
        if (!h) return;
        if (h.anim !== lastAnim && PUNCHES.has(h.anim)) {
          h.forwardInto(fwd);
          const feet = h.feetInto(tmp);
          for (const b of bags) {
            const p = b.body.translation();
            const dx = p.x - feet.x;
            const dz = p.z - feet.z;
            const d = Math.hypot(dx, dz);
            if (d > 1.5 || (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-3) < 0.3) continue;
            const strength = h.anim === 'Kick' || h.anim === 'Dive' ? 1.6 : 1;
            b.body.applyImpulseAtPoint({ x: fwd.x * 2.2 * strength, y: 0.4, z: fwd.z * 2.2 * strength }, { x: p.x, y: p.y + 0.2, z: p.z }, true);
            b.hits++;
            hits++;
            hit(new Vector3(p.x - fwd.x * 0.35, feet.y + 1.1, p.z - fwd.z * 0.35), fwd, strength);
            break;
          }
        }
        lastAnim = h.anim;
        if (h.stats.landings !== lastLandings) {
          lastLandings = h.stats.landings;
          const f = h.feetInto(tmp);
          if (h.state === 'groundPoundLand' && Math.abs(f.x - 6) < 1.8 && Math.abs(f.z - 6.5) < 1.8) {
            slams++;
            const at = f.clone();
            e.screen.shockwave(at, { radius: 0.55, strength: 1.4 });
            if (juice.shake) e.shake.add(0.7);
            if (juice.hitstop) e.hitstop(0.12);
            if (juice.flash) e.screen.flash(0xffcd75, { duration: 0.12, strength: 0.6 });
            if (juice.particles) ctx.particles.burst('dust', at, { count: 40, scale: 1.8, speed: 3 });
            for (const b of bags) b.body.applyImpulse({ x: (b.body.translation().x - at.x) * 0.4, y: 0.5, z: -1.5 }, true);
          }
        }
      },
      update: ropes,
      draw() {
        ctx.hud.text(4, 18, `HITS ${hits} · SPEED ${e.timeScale.toFixed(2)}X`, { anchor: 'bottom-left', color: 'sand' });
      },
      status: () => `hits ${hits} slams ${slams} juice ${Object.entries(juice).filter(([, v]) => v).map(([k]) => k).join(',')}`,
      api: { juice: () => ({ ...juice }), hits: () => hits, slams: () => slams, hit: () => hit(new Vector3(0, 1.5, -4), new Vector3(0, 0, -1), 1) },
    };
  },
};
