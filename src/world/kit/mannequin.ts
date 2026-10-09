/**
 * Hero mannequins: clones of the hero model playing one of its clips on a loop (galleries,
 * townsfolk in the dioramas, dummies). Clips are compiled once per page and shared: they
 * address joints by name, so every clone plays the same AnimationClip objects.
 */
import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type Object3D } from 'three/webgpu';
import { compileClips, type GameContext, setLookLayer } from '../../engine';
import { HERO_CLIPS, HERO_MODEL, HERO_RIG } from '../../game/hero';

let compiled: AnimationClip[] | null = null;

export interface Mannequin {
  readonly root: Object3D;
  readonly mixer: AnimationMixer;
  /** The clip playing. */
  clip: string;
  play(name: string, o?: { once?: boolean; speed?: number; fade?: number }): AnimationAction | null;
}

/** Every hero clip name, in authoring order. */
export const HERO_CLIP_NAMES: readonly string[] = HERO_CLIPS.map((c) => c.name);

export async function mannequin(ctx: GameContext, clip: string, at: readonly [number, number, number], facing = 0): Promise<Mannequin> {
  const m = await ctx.loadModel(HERO_MODEL, { castShadow: false });
  compiled ??= compileClips(HERO_CLIPS, HERO_RIG, m.scene);
  const root = m.scene;
  root.position.set(at[0], at[1], at[2]);
  root.rotation.y = facing;
  setLookLayer(root, 'actors');
  ctx.scene.add(root);
  const mixer = new AnimationMixer(root);
  let current: AnimationAction | null = null;
  const man: Mannequin = {
    root,
    mixer,
    clip,
    play(name, o = {}) {
      const c = compiled!.find((x) => x.name === name);
      if (!c) return null;
      const action = mixer.clipAction(c);
      action.reset();
      action.setLoop(o.once ? LoopOnce : LoopRepeat, Infinity);
      action.clampWhenFinished = true;
      action.timeScale = o.speed ?? 1;
      action.play();
      if (current && current !== action) {
        if (o.fade) action.crossFadeFrom(current, o.fade, false);
        else current.stop();
      }
      current = action;
      man.clip = name;
      return action;
    },
  };
  man.play(clip);
  return man;
}
