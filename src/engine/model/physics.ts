import { type Physics, RAPIER } from '../physics/Physics';
import type { ModelBuild } from './build';
import type { Vec3 } from './types';

/**
 * Static Rapier colliders for a placed model (its `colliders` data), at `at` turned `yaw`
 * radians about Y: a box, an upright cylinder or a convex hull, with `addStaticBox`'s friction.
 */
export function addModelColliders(physics: Physics, build: Pick<ModelBuild, 'colliders'>, at: Vec3 = [0, 0, 0], yaw = 0): RAPIER.Collider[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // three's rotation about Y: x' = x cos + z sin, z' = −x sin + z cos
  const place = (v: Vec3): [number, number, number] => [at[0] + v[0] * c + v[2] * s, at[1] + v[1], at[2] - v[0] * s + v[2] * c];
  const out: RAPIER.Collider[] = [];
  for (const d of build.colliders) {
    if (d.kind === 'box') out.push(physics.addStaticBox({ position: place(d.center), halfExtents: [...d.half], rotationY: yaw }));
    else if (d.kind === 'cyl') {
      const c = physics.addStaticCylinder(place(d.center), d.halfHeight, d.radius);
      c.setFriction(0.8);
      out.push(c);
    }
    else {
      const pts = new Float32Array(d.points.length);
      for (let i = 0; i < d.points.length; i += 3) pts.set(place([d.points[i]!, d.points[i + 1]!, d.points[i + 2]!]), i);
      const desc = RAPIER.ColliderDesc.convexHull(pts)?.setFriction(0.8);
      if (!desc) continue;
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      out.push(physics.world.createCollider(desc, body));
    }
  }
  return out;
}
