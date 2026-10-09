import type { RagdollPart } from '../../engine/physics/ragdoll';

/**
 * The hero as a ragdoll (the joints of `hero.glb`, see rig.ts): pelvis, torso and head, upper
 * arms and legs on ball joints held in cones, elbows and knees as hinges bending the way the
 * clips bend them (Forearm −X, Shin +X). Hands and feet ride on their forearm and shin.
 */
export const HERO_RAGDOLL: readonly RagdollPart[] = [
  { bone: 'Pelvis', from: [-0.12, -0.04, 0], to: [0.12, -0.04, 0], radius: 0.13 },
  { bone: 'Torso', parent: 'Pelvis', from: [0, 0.16, 0], to: [0, 0.42, 0], radius: 0.2, cone: 35 },
  { bone: 'Head', parent: 'Torso', from: [0, 0.2, 0], to: [0, 0.34, 0], radius: 0.22, cone: 40, density: 0.7 },
  { bone: 'ArmR', parent: 'Torso', to: [0, -0.25, 0], radius: 0.07, cone: 100 },
  { bone: 'ForearmR', parent: 'ArmR', to: [0, -0.26, 0], radius: 0.07, hinge: [-150, 0] },
  { bone: 'ArmL', parent: 'Torso', to: [0, -0.25, 0], radius: 0.07, cone: 100 },
  { bone: 'ForearmL', parent: 'ArmL', to: [0, -0.26, 0], radius: 0.07, hinge: [-150, 0] },
  { bone: 'LegR', parent: 'Pelvis', to: [0, -0.3, 0], radius: 0.09, cone: 80 },
  { bone: 'ShinR', parent: 'LegR', to: [0, -0.28, 0], radius: 0.08, hinge: [0, 150] },
  { bone: 'LegL', parent: 'Pelvis', to: [0, -0.3, 0], radius: 0.09, cone: 80 },
  { bone: 'ShinL', parent: 'LegL', to: [0, -0.28, 0], radius: 0.08, hinge: [0, 150] },
];
