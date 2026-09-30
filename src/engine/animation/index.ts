// Animation authoring toolkit: data format, pose helpers, foot IK, gait generator,
// compiler to three.js clips, metrics and contact-sheet rendering. See docs/ANIMATION.md.
export type { ClipDef, Ease, Euler, FeetGoals, FeetKey, FootGoalDef, JointLimit, JointPose, Key, Layer, LegJoints, LegRig, Pose, RigSpec, Vec3 } from './types';
export { REST_JOINT, applyEase, blend, bracket, mirror, mirrorClip, offset, resolveJoint, sampleClip, validateClip, type ResolvedJoint } from './pose';
export { ankleFor, applyFeet, legIK, lerpGoal, placeFeet, twoBoneX, type FootGoal, type Side } from './ik';
export { footAt, gaitClip, gaitPose, type GaitSpec } from './gait';
export { compileClip, compileClips, restPoseOf, type RestPose } from './compile';
export { analyzeClip, sampleFrames, type ClipReport, type SampledFrame } from './metrics';
export { defaultFrames, renderSheet, type SheetImage, type SheetOptions, type ViewName } from './sheet';
