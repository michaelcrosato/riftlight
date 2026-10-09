/**
 * Bullet Hell: a top-down arena where a turret cycles through bullet patterns (aimed streams,
 * fans, rings, spirals, sweeping waves, bursts) and you dodge, graze and shoot back. Hundreds
 * of bullets are plain numbers in a pool, drawn as one instanced mesh.
 */
import { Color, InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu';
import { BulletPool, emitter, type Emitter, FIXED_DT, PALETTE, type PatternDef, setLookLayer, toonMaterial } from '../../engine';
import type { Knob, RoomDef } from '../types';

const ARENA = 9; // half size
const PATTERNS: (PatternDef & { label: string; count: number; speed: number })[] = [
  { label: 'AIMED', pattern: 'aimed', every: 0.5, count: 5, speed: 7 },
  { label: 'FAN', pattern: 'fan', every: 0.6, count: 9, speed: 5, spread: 80 },
  { label: 'RING', pattern: 'ring', every: 0.7, count: 24, speed: 4, turn: 7 },
  { label: 'SPIRAL', pattern: 'spiral', every: 0.06, count: 3, speed: 4.5, turn: 11 },
  { label: 'WAVE', pattern: 'wave', every: 0.05, count: 3, speed: 6, sweep: 60, period: 2.5 },
  { label: 'BURST', pattern: 'burst', every: 0.9, count: 40, speed: 5, spread: 360 },
];
const ORIGIN: [number, number] = [0, 0];
/** Eight pads in a row under the arena. */
const padX = (i: number) => -8.4 + i * 2.4;
const ARENA_CENTER = new Vector3(0, 0, 1.5); // the arena and the pad strip below it
const KIND_COLORS = [PALETTE.red, PALETTE.orange, PALETTE.sand, PALETTE.lime, PALETTE.sky, PALETTE.plum, PALETTE.white];

export const BULLETS: RoomDef = {
  id: 'bullets',
  title: 'Bullet Hell',
  wing: 'genres',
  about:
    'A shoot-\'em-up arena from above: the turret in the middle fires patterns (aimed streams, fans, rings, spirals, sweeping waves and bursts) while you weave through them. Shoot back with J, graze bullets for points, slow time down. Hundreds of bullets at once (the pool holds 6000) are just numbers, drawn in one draw call.',
  try: ['Survive the SPIRAL and the WAVE', 'Graze: pass close without being hit', 'Shoot back (J) and empty its bar', 'ALL patterns at once, then SLOW-MO'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'ink',
  camera: { preset: 'topdown', viewHeight: 27, pitch: 70, stiffness: 6 },
  guide: {
    what: 'A walled arena seen from above, a turret with six bullet patterns, the hero who can shoot back, a graze counter and the turret\'s health bar.',
    how: [
      'Bullets are not objects: a pool keeps each one\'s position, velocity, life, radius and team in flat typed arrays. Firing writes the next slot; a dead bullet is swapped with the last live one, so the live ones are always packed at the front and nothing is allocated.',
      'A pattern is a timer and a rule: every volley it fires n bullets at angles that depend on the pattern (spread evenly in a ring, turned a little more each volley for a spiral, aimed at the hero for a fan, swept back and forth for a wave). The same seed gives the same volleys every run.',
      'Hits are circle tests on the ground plane (distance under the two radii added), against a hit circle smaller than the hero, as the genre expects. A graze is an enemy bullet inside a bigger circle that never hits: each counts once.',
      'Each frame the live bullets\' positions go into one instanced mesh, drawn between the last two physics steps (a bullet flies straight, so it is backed off along its velocity): thousands of bullets would still cost one draw call and a matrix each.',
    ],
    uses: [
      'Danmaku: Touhou, DoDonPachi, Ikaruga; bullet patterns in Enter the Gungeon, Nier: Automata and Undertale.',
      'Any game with lots of projectiles: twin-stick shooters, tower defence, spell effects.',
    ],
    ask: ['a boss that fires spiral bullet patterns', 'thousands of bullets that don\'t lag', 'a graze mechanic', 'a hitbox smaller than the sprite'],
    cost: 'CPU: a few multiplies per bullet per step and one circle test per bullet against the hero. GPU: one instanced draw. 3000 bullets are well under a millisecond.',
    code: [
      {
        title: 'A dead bullet swaps with the last live one: no gaps, no allocations',
        file: 'src/engine/ai/bullets.ts',
        src: `const last = --this.alive;
this.state.copyWithin(i * 4, last * 4, last * 4 + 4);`,
      },
      {
        title: 'A spiral: a ring that turns a little more every volley',
        file: 'src/engine/ai/bullets.ts',
        src: `angle += (def.turn ?? 12) * deg;
for (let i = 0; i < n; i++) shoot(pool, at, angle + (i / n) * Math.PI * 2, speed);`,
      },
    ],
    words: ['bullet pool', 'hitbox', 'instancing', 'draw call'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    // the arena (bullets live inside ±ARENA) and a strip below it for the pads, out of the fire
    kit.room(ARENA * 2 + 2, ARENA * 2 + 6, { floor: ['night', 'ink'], wall: { color: 'plum', side: 'navy', height: 1 } });
    kit.box([0, 0.03, ARENA + 0.1], [ARENA * 2, 0.06, 0.2], 'plum', { ghost: true });
    const turret = new Mesh(new SphereGeometry(0.8, 14, 10), toonMaterial(PALETTE.red));
    turret.position.set(0, 0.8, 0);
    turret.castShadow = true;
    setLookLayer(turret, 'actors');
    ctx.scene.add(turret);
    kit.solid([0, 0.8, 0], [1.4, 1.6, 1.4]);
    const pool = new BulletPool(6000);
    const mesh = new InstancedMesh(new SphereGeometry(0.13, 6, 4), new MeshBasicNodeMaterial(), pool.capacity);
    mesh.setColorAt(0, new Color(PALETTE.white)); // the colour attribute exists before the first draw, so the material uses it
    mesh.count = 0;
    mesh.frustumCulled = false;
    ctx.scene.add(mesh);
    // each emitter gets its own copy of the pattern, so the speed knob can change it live
    const defs: PatternDef[] = PATTERNS.map((p, i) => ({ ...p, kind: i, seed: 11 + i, life: 7 }));
    const emitters: Emitter[] = defs.map((d) => emitter(d));
    let active = new Set([3]); // SPIRAL first
    PATTERNS.forEach((p, i) =>
      kit.pad([padX(i), 0, ARENA + 1.4], { label: p.label, color: 'red', group: 'pattern', initial: i === 3, note: `${p.label}: ${p.count} bullets every ${p.every} s at ${p.speed} m/s.`, apply: () => ((active = new Set([i])), pool.clear()) }),
    );
    kit.pad([padX(6), 0, ARENA + 1.4], { label: 'ALL', color: 'plum', group: 'pattern', note: 'Every pattern together: hundreds of bullets, one draw call.', apply: () => (active = new Set(PATTERNS.map((_, i) => i))) });
    kit.pad([padX(7), 0, ARENA + 1.4], {
      label: 'SLOW-MO',
      color: 'sky',
      note: 'Game time at 0.35x: the bullets, the turret and you.',
      apply: (_r, p) => {
        e.timeScale = e.timeScale < 1 ? 1 : 0.35;
        kit.lightPad(p, e.timeScale < 1);
      },
    });
    let hp = 100;
    let hits = 0;
    let grazes = 0;
    let shots = 0;
    let lastAnim = '';
    const out: number[] = [];
    const m = new Matrix4();
    const c = new Color();
    const tmp = new Vector3();
    const fwd = new Vector3();
    const target: [number, number] = [0, 0];
    const knobs: Knob[] = [
      { id: 'speed', label: 'Bullet speed', min: 0.3, max: 2, step: 0.1, get: () => speedK, set: (v) => (speedK = v), format: (v) => `${v}x`, initial: 1 },
      { id: 'hitbox', label: 'Hero hitbox', min: 0.05, max: 0.6, step: 0.01, get: () => hitbox, set: (v) => (hitbox = v), format: (v) => `${v} m`, initial: 0.15 },
    ];
    let speedK = 1;
    let hitbox = 0.15;
    return {
      knobs,
      fixedUpdate(dt) {
        const h = room.hero?.hero;
        const feet = h ? h.feetInto(tmp) : null;
        const aim = feet ? ((target[0] = feet.x), (target[1] = feet.z), target) : null;
        emitters.forEach((em, i) => {
          if (!active.has(i)) return;
          defs[i]!.speed = PATTERNS[i]!.speed * speedK;
          em.update(pool, dt, ORIGIN, aim);
        });
        pool.step(dt, (x, z) => Math.abs(x) < ARENA && Math.abs(z) < ARENA);
        if (h && feet) {
          // the hero shoots back with punches: a little fan of player bullets
          if (h.anim !== lastAnim && (h.anim === 'Punch' || h.anim === 'Punch2' || h.anim === 'Kick')) {
            const f = h.forwardInto(fwd);
            for (const a of [-0.15, 0, 0.15]) {
              const ca = Math.cos(a);
              const sa = Math.sin(a);
              pool.fire(feet.x + f.x * 0.5, feet.z + f.z * 0.5, (f.x * ca - f.z * sa) * 14, (f.x * sa + f.z * ca) * 14, { team: 'player', kind: 6, life: 1.5, radius: 0.15 });
              shots++;
            }
          }
          lastAnim = h.anim;
          // a hit counts only when it hurts (not while the hero is still invulnerable from the last)
          if (pool.hits(feet.x, feet.z, hitbox, 'enemy', out).length && h.hurt(fwd.set(-feet.x, 0, -feet.z), 0.6)) {
            hits++;
            pool.killAll(out); // the hit came from the turret, at the origin
            e.screen.flash(0xb13e53, { duration: 0.12, strength: 0.6 });
            e.shake.add(0.4);
            ctx.audio.play('hurt');
          }
          // grazes: enemy bullets that came close and missed, each once
          grazes += pool.graze(feet.x, feet.z, 0.7, 'enemy');
        }
        // player bullets hit the turret
        const struck = pool.hits(0, 0, 0.8, 'player', out).length;
        if (struck) {
          pool.killAll(out);
          hp = Math.max(0, hp - struck);
          ctx.particles.burst('impact', [0, 1, 0], { count: 6 });
          if (hp === 0) {
            hp = 100;
            e.screen.flash(0xffcd75, { duration: 0.2, strength: 0.8 });
            ctx.particles.burst('sparkle', [0, 1.4, 0], { count: 40, scale: 2 });
            ctx.audio.play('fanfare');
            pool.clear();
          }
        }
      },
      update() {
        mesh.count = pool.alive;
        // drawn between the last two physics steps: bullets fly straight, so back off along their velocity
        const back = (1 - ctx.physics.alpha) * FIXED_DT;
        for (let i = 0; i < pool.alive; i++) {
          const k = i * 4;
          m.makeTranslation(pool.state[k]! - pool.state[k + 2]! * back, 0.5, pool.state[k + 1]! - pool.state[k + 3]! * back);
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, c.setHex(KIND_COLORS[pool.kind[i]!]!));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        turret.rotation.y += 0.02;
      },
      draw() {
        ctx.hud.text(4, 18, `BULLETS ${pool.alive} · HITS ${hits} · GRAZE ${grazes} · TURRET ${hp}%`, { anchor: 'bottom-left', color: 'sand' });
      },
      // the camera holds the whole arena, wherever you are in it
      cameraTarget: () => ARENA_CENTER,
      dispose() {
        e.timeScale = 1;
      },
      status: () => `bullets ${pool.alive} hits ${hits} hp ${hp}`,
      api: { bullets: () => pool.alive, hits: () => hits, hp: () => hp, fired: () => pool.fired, shots: () => shots, patterns: (ids: number[]) => (active = new Set(ids)) },
    };
  },
};
