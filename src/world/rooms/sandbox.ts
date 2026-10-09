/**
 * Sandbox: a yard to build in. Spawn crates, balls, planks and barrels from pads, grab
 * anything with the mouse and drag it (throw it by letting go while it moves), stack towers,
 * then save the layout and load it back. Agents build through `__WORLD__.room` as data.
 */
import { BoxGeometry, CylinderGeometry, Mesh, Quaternion, SphereGeometry, Vector3 } from 'three/webgpu';
import { PALETTE, RAPIER, setLookLayer, toonMaterial } from '../../engine';
import type { Knob, RoomDef } from '../types';

type V3 = [number, number, number];
type Kind = 'crate' | 'ball' | 'plank' | 'barrel';

/** What each prop is: its collider, its look, its weight. */
const KINDS: Record<Kind, { color: number; density: number; build: () => { desc: RAPIER.ColliderDesc; mesh: Mesh } }> = {
  crate: { color: PALETTE.orange, density: 1, build: () => ({ desc: RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4), mesh: new Mesh(new BoxGeometry(0.8, 0.8, 0.8), toonMaterial(PALETTE.orange)) }) },
  ball: { color: PALETTE.sky, density: 1.5, build: () => ({ desc: RAPIER.ColliderDesc.ball(0.35).setRestitution(0.5), mesh: new Mesh(new SphereGeometry(0.35, 14, 10), toonMaterial(PALETTE.sky)) }) },
  plank: { color: PALETTE.sand, density: 0.8, build: () => ({ desc: RAPIER.ColliderDesc.cuboid(1.2, 0.08, 0.3), mesh: new Mesh(new BoxGeometry(2.4, 0.16, 0.6), toonMaterial(PALETTE.sand)) }) },
  barrel: { color: PALETTE.red, density: 1.2, build: () => ({ desc: RAPIER.ColliderDesc.cylinder(0.45, 0.35), mesh: new Mesh(new CylinderGeometry(0.35, 0.35, 0.9, 12), toonMaterial(PALETTE.red)) }) },
};

interface Prop {
  kind: Kind;
  body: RAPIER.RigidBody;
  mesh: Mesh;
}

const STORE = 'pixel-engine:sandbox';
/** The most props a layout may hold (a bigger one is not loaded). */
const MAX_PROPS = 400;

export const SANDBOX: RoomDef = {
  id: 'sandbox',
  title: 'Sandbox',
  wing: 'workshop',
  about:
    'A yard to build in: spawn crates, balls, planks and barrels, grab anything with the mouse and drag it about (let go while it moves to throw it), stack a tower and knock it down. Save the layout and load it back later.',
  try: ['Spawn some CRATES and stack them with the mouse', 'Drag a ball and let go mid-swing: a throw', 'SAVE, wreck it all, LOAD'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'sand',
  guide: {
    what: 'A yard with a drop point, pads that spawn props, and pads that save, load and clear the layout.',
    how: [
      'Picking: the mouse position becomes a ray from the camera through that pixel; the physics engine casts it and returns the first collider it hits. A dynamic body there is grabbed at that point.',
      'Dragging: the grabbed point is pulled toward where the mouse ray meets a level plane at the height you grabbed it (a little higher, so it lifts off the floor); with the camera looking across instead of down (the side view), an upright plane facing the camera. It is a spring, not a teleport: the body gets a velocity toward its target every step, so it still collides, pushes others and swings.',
      'Throwing: let go and the body keeps the velocity the spring gave it.',
      'Saving: a layout is data, the kind, position and rotation of every prop, written as JSON to the browser\'s local storage (and given to agents as the same JSON).',
    ],
    uses: [
      'Level editors and sandboxes: Garry\'s Mod, Besiege, Teardown, Minecraft.',
      'Grab and throw: Half-Life 2\'s gravity gun, Zelda: Tears of the Kingdom\'s Ultrahand.',
    ],
    ask: ['pick up objects with the mouse', 'a level editor that saves to JSON', 'spawn physics props from a menu', 'throw what you grab'],
    cost: 'A ray cast when you click, a velocity set per step while you drag; saving walks the props once.',
    code: [
      {
        title: 'A drag is a spring toward the target, not a teleport',
        file: 'src/world/rooms/sandbox.ts',
        src: `body.setLinvel({ x: d.x * pull, y: d.y * pull, z: d.z * pull }, true);`,
      },
      {
        title: 'The mouse as a ray from the camera',
        file: 'src/engine/camera.ts',
        src: `rayAt(x: number, y: number, origin: Vector3, dir: Vector3): void {`,
      },
    ],
    words: ['raycast', 'rigid body', 'serialisation'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(26, 22, { floor: ['mist', 'white'], wall: { color: 'plum', side: 'ink' } });
    kit.cylinder([0, 0.02, -2], 1.2, 0.04, 'white', { ghost: true });
    kit.label([0, 1.5, -2], 'DROP POINT', { color: 'plum', range: 10 });
    const props: Prop[] = [];
    const spawn = (kind: Kind, at: V3 = [(Math.random() - 0.5) * 1.5, 4, -2 + (Math.random() - 0.5) * 1.5], rot?: [number, number, number, number]) => {
      // no more than a layout can hold, so whatever is saved loads back
      if (props.length >= MAX_PROPS) {
        room.toast(`The yard is full (${MAX_PROPS} props): CLEAR some first.`, 2);
        return null;
      }
      const k = KINDS[kind];
      const { desc, mesh } = k.build();
      const body = ctx.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...at)
          .setRotation(rot ? { x: rot[0], y: rot[1], z: rot[2], w: rot[3] } : { x: 0, y: 0, z: 0, w: 1 })
          .setCcdEnabled(true),
      );
      ctx.physics.world.createCollider(desc.setDensity(k.density).setFriction(0.7), body);
      mesh.castShadow = true;
      setLookLayer(mesh, 'actors');
      ctx.scene.add(mesh);
      ctx.physics.bind(body, mesh);
      const p = { kind, body, mesh };
      props.push(p);
      return p;
    };
    const clear = () => {
      for (const p of props) {
        ctx.physics.remove(p.body);
        ctx.physics.unbind(p.mesh);
        ctx.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
      }
      props.length = 0;
      grab = null;
    };
    const layout = () =>
      props.map((p) => {
        const t = p.body.translation();
        const r = p.body.rotation();
        const n = (v: number) => Math.round(v * 1000) / 1000;
        return { kind: p.kind, at: [n(t.x), n(t.y), n(t.z)] as V3, rot: [n(r.x), n(r.y), n(r.z), n(r.w)] as [number, number, number, number] };
      });
    type Item = ReturnType<typeof layout>[number];
    const finite = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    // a rotation is a unit quaternion: one far from that (all zeros) is no rotation at all, and
    // a body given it stops colliding
    const turn = (q: number[]) => Math.hypot(...q);
    /** A layout back, or false (and the yard untouched) if it is not one: data from storage or an agent is checked first. */
    const load = (items: unknown): boolean => {
      if (!Array.isArray(items) || items.length > MAX_PROPS) return false;
      const ok = items.every((it: Partial<Item> | null) => !!it && typeof it.kind === 'string' && Object.hasOwn(KINDS, it.kind) && finite(it.at, 3) && finite(it.rot, 4) && Math.abs(turn(it.rot) - 1) < 0.5);
      if (!ok) return false;
      clear();
      for (const it of items as Item[]) {
        const n = turn(it.rot);
        spawn(it.kind, it.at, [it.rot[0] / n, it.rot[1] / n, it.rot[2] / n, it.rot[3] / n]);
      }
      return true;
    };
    const save = () => {
      try {
        localStorage.setItem(STORE, JSON.stringify(layout()));
        return true;
      } catch {
        return false;
      }
    };
    const restore = () => {
      try {
        const raw = localStorage.getItem(STORE);
        return !!raw && load(JSON.parse(raw));
      } catch {
        return false;
      }
    };
    (['crate', 'ball', 'plank', 'barrel'] as const).forEach((kind, i) =>
      kit.pad([-6 + i * 2.4, 0, 6.5], { label: kind.toUpperCase(), color: 'orange', note: `A ${kind} drops onto the drop point.`, apply: () => spawn(kind) }),
    );
    kit.pad([4.5, 0, 6.5], { label: 'SAVE', color: 'lime', note: 'The layout (each prop\'s kind, position and rotation) saved as JSON in this browser.', apply: () => room.toast(save() ? `Saved ${props.length} props.` : 'Could not save here.', 2) });
    kit.pad([6.9, 0, 6.5], { label: 'LOAD', color: 'sky', note: 'The saved layout back, exactly as it was.', apply: () => room.toast(restore() ? `Loaded ${props.length} props.` : 'Nothing saved here (or it would not load).', 2) });
    kit.pad([9.3, 0, 6.5], { label: 'CLEAR', color: 'red', note: 'Every prop gone.', apply: clear });
    // a starting tower to wreck
    for (let y = 0; y < 5; y++) spawn('crate', [4, 0.4 + y * 0.8, -4]);

    // grabbing with the mouse
    let grab: { prop: Prop; local: Vector3; height: number } | null = null;
    let wasDown = false;
    const origin = new Vector3();
    const dir = new Vector3();
    const at = new Vector3();
    const target = new Vector3();
    const anchor = new Vector3();
    const normal = new Vector3();
    const q = new Quaternion();
    let pull = 12;
    let throws = 0;
    const knobs: Knob[] = [{ id: 'pull', label: 'Drag spring', min: 2, max: 30, step: 1, get: () => pull, set: (v) => (pull = v), initial: 12, hint: 'How hard a grabbed prop is pulled to the mouse: soft and swingy, or stiff.' }];
    const NOT_HERO = ['character'];
    const pointerRay = () => {
      ctx.camera.rayAt(e.input.pointer.x, e.input.pointer.y, origin, dir);
      return ctx.physics.castRay(origin, dir, 1000, NOT_HERO);
    };
    const tryGrab = () => {
      const hit = pointerRay();
      const prop = hit && props.find((p) => p.body.handle === hit.collider.parent()?.handle);
      if (!hit || !prop) return false;
      const t = prop.body.translation();
      const r = prop.body.rotation();
      q.set(r.x, r.y, r.z, r.w).invert();
      grab = { prop, local: hit.point.clone().sub(at.set(t.x, t.y, t.z)).applyQuaternion(q), height: hit.point.y + 0.6 };
      return true;
    };
    const drag = () => {
      if (!grab) return;
      const body = grab.prop.body;
      const t = body.translation();
      const r = body.rotation();
      anchor.copy(grab.local).applyQuaternion(q.set(r.x, r.y, r.z, r.w)).add(at.set(t.x, t.y, t.z));
      ctx.camera.rayAt(e.input.pointer.x, e.input.pointer.y, origin, dir);
      // the plane the grabbed point moves in: level, at the height it was grabbed, when the
      // camera looks down on it; upright and facing the camera, through the point, when it looks
      // across (a side view, a low angle), where a level plane would be met far off or never
      let s: number;
      if (Math.abs(dir.y) > 0.25) s = (grab.height - origin.y) / dir.y;
      else {
        normal.set(dir.x, 0, dir.z).normalize();
        s = normal.dot(target.copy(anchor).sub(origin)) / normal.dot(dir);
      }
      if (!(s > 0)) return;
      target.copy(origin).addScaledVector(dir, s);
      const d = target.sub(anchor);
      const len = d.length();
      if (len > 1) d.divideScalar(len); // past a metre away: full speed, no faster
      body.setLinvel({ x: d.x * pull, y: d.y * pull, z: d.z * pull }, true);
      const w = body.angvel();
      body.setAngvel({ x: w.x * 0.9, y: w.y * 0.9, z: w.z * 0.9 }, true);
    };
    return {
      knobs,
      fixedUpdate() {
        // not through a panel or the pause menu: only a click on the game itself grabs
        const down = room.inputFree && (e.input.mouseButtons & 1) === 1 && e.input.pointer.over;
        if (down && !wasDown) tryGrab();
        if (!down && grab) {
          const v = grab.prop.body.linvel();
          if (Math.hypot(v.x, v.y, v.z) > 4) throws++;
          grab = null;
        }
        wasDown = down;
        drag();
      },
      draw() {
        if (grab) ctx.hud.text(4, 18, `HOLDING A ${grab.prop.kind.toUpperCase()}`, { anchor: 'bottom-left', color: 'plum' });
      },
      status: () => `props ${props.length} holding ${grab?.prop.kind ?? 'nothing'}`,
      api: {
        /** Spawn a prop (at the drop point, or `at`): the props there are now, or -1 if `kind` is not one. */
        spawn: (kind: Kind, at?: V3) => (Object.hasOwn(KINDS, kind) ? (spawn(kind, at), props.length) : -1),
        layout,
        /** Load a layout (what `layout` returns): the props it made, or -1 (nothing changed) if it is not one. */
        load: (items: unknown) => (load(items) ? props.length : -1),
        save,
        restore,
        clear,
        count: () => props.length,
        holding: () => grab?.prop.kind ?? null,
        throws: () => throws,
        /** What the pointer ray at (x, y) (device coordinates) hits: a prop's kind, 'other', or null. */
        pick: (x: number, y: number) => {
          ctx.camera.rayAt(x, y, origin, dir);
          const hit = ctx.physics.castRay(origin, dir, 1000, NOT_HERO);
          if (!hit) return null;
          return props.find((p) => p.body.handle === hit.collider.parent()?.handle)?.kind ?? 'other';
        },
        ray: (x: number, y: number) => {
          ctx.camera.rayAt(x, y, origin, dir);
          return [origin.toArray(), dir.toArray()];
        },
      },
    };
  },
};
