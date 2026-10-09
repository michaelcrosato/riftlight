/**
 * Engine World: the engine's tech demo. A hub (the Atrium) with a door for every room; each
 * room is one technique, built as data plus a little code, with a card (what it shows, what
 * to try), a station guide (how it works, live sliders, where games use it, what to ask
 * for, what it costs, the engine's code) and pads you step on to change things.
 *
 * Every room is a whole `Game` (`engine.loadGame`), so leaving one frees everything it built
 * and any room opens on its own: `?game=world&room=lights`.
 */
import type { CameraConfig, GameContext, Look, PaletteColor } from '../engine';
import type { Visitor } from '../riftlight/showcase/visitor';
import type { RoomKit } from './kit/RoomKit';

export type Vec3 = [number, number, number];

export type WingId = 'hub' | 'movement' | 'physics' | 'animation' | 'effects' | 'looks' | 'genres' | 'workshop' | 'procedural' | 'rendering';

export interface WingDef {
  readonly id: WingId;
  readonly title: string;
  /** One line: what the wing is about. */
  readonly about: string;
  readonly color: PaletteColor;
}

/** A live setting: a slider, a choice or a switch (the guide's "tweak it", the T panel, pads). */
export type Knob =
  | {
      readonly kind?: 'slider';
      readonly id: string;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      readonly get: () => number;
      readonly set: (v: number) => void;
      /** Value as text (default: the number). */
      readonly format?: (v: number) => string;
      /** The room's starting value (highlighted when changed). */
      readonly initial?: number;
      readonly hint?: string;
    }
  | {
      readonly kind: 'choice';
      readonly id: string;
      readonly label: string;
      readonly options: readonly string[];
      readonly get: () => number;
      readonly set: (i: number) => void;
      readonly hint?: string;
    }
  | {
      readonly kind: 'toggle';
      readonly id: string;
      readonly label: string;
      readonly get: () => boolean;
      readonly set: (v: boolean) => void;
      readonly hint?: string;
    };

/** A snippet of the engine's own code (the guide's last pages). */
export interface CodeRef {
  readonly title: string;
  /** Repo path. */
  readonly file: string;
  /** A few lines, the important ones. */
  readonly src: string;
}

/** The station guide (H): how the room's technique works. */
export interface Guide {
  /** What you are looking at, in the room's own words. */
  readonly what: string;
  /** How the engine does it, step by step. */
  readonly how: readonly string[];
  /** Where games use it (real games). */
  readonly uses: readonly string[];
  /** Phrases to ask an agent for it. */
  readonly ask: readonly string[];
  /** What it costs (CPU, GPU, memory). */
  readonly cost: string;
  /** The engine's code. */
  readonly code?: readonly CodeRef[];
  /** Field-guide words (terms in `glossary.ts`). */
  readonly words?: readonly string[];
}

/** A pad on the floor: step on it to change something. */
export interface PadDef {
  readonly label: string;
  readonly color?: PaletteColor;
  /** What it changed and why (a toast when stepped on, listed in the guide). */
  readonly note: string;
  /** Pads in one group are exclusive: the last one stepped on lights up. */
  readonly group?: string;
  /** Lit when the room opens. */
  readonly initial?: boolean;
  /** Ungrouped pads that switch something on and off light themselves (`room.kit.lightPad`). */
  readonly apply: (room: RoomRuntime, pad: import('./kit/RoomKit').Pad) => void;
  /** While this says false, stepping on the pad does nothing at all: no apply, no note, no sound. */
  readonly enabled?: () => boolean;
}

/** What a room's code gets back from the shell while it runs. */
export interface RoomRuntime {
  readonly ctx: GameContext;
  readonly kit: RoomKit;
  readonly def: RoomDef;
  /** The room the player came from (null on a fresh start or a reset). */
  readonly arrivedFrom: string | null;
  /** The hero (null in rooms without one, or before it spawns). */
  readonly hero: Visitor | null;
  /** Show a toast at the bottom of the screen. */
  toast(text: string, seconds?: number): void;
  /** Go to another room (a door): a transition, then that room. */
  goto(id: string): void;
  /** Where the hero starts (call from `build`; arrivals at the Atrium use it). */
  setSpawn(at: Vec3, facing?: number): void;
  /** Put the hero back at the spawn (a pit, a reset). */
  respawn(): void;
  /** Take the hero out of the world (into a vehicle): no body, not drawn, no input. */
  leaveWorld(): void;
  /** Put the hero back in the world at `at` (feet), with the room's settings (shove, weight, depth lock). */
  enterWorld(at: Vec3, facing?: number): void;
  /** False while a panel or a room change owns the keys: read input yourself only when true. */
  readonly inputFree: boolean;
}

/** What a room's `build` returns: its own per-frame logic and live settings. */
export interface RoomLogic {
  fixedUpdate?(dt: number): void;
  update?(dt: number): void;
  /** HUD drawn over the room (after the shell's own). */
  draw?(): void;
  /** Extra live settings for the guide and the T panel. */
  readonly knobs?: readonly Knob[];
  /** One line for the debug panel / `__WORLD__.state()`. */
  status?(): string;
  /** Called before the room unloads (the engine frees scene objects and physics itself). */
  dispose?(): void;
  /** The point the camera follows instead of the hero (a vehicle, a ship). */
  cameraTarget?(): import('three/webgpu').Vector3 | null;
  /** Agent / test hooks (`__WORLD__.room`). */
  readonly api?: Record<string, unknown>;
}

export interface RoomDef {
  readonly id: string;
  readonly title: string;
  readonly wing: WingId;
  /** One paragraph for the card. */
  readonly about: string;
  /** "Try this" lines for the card. */
  readonly try: readonly string[];
  readonly guide: Guide;
  /** Camera on entry (default iso). */
  readonly camera?: CameraConfig;
  /** Look on entry (a LOOK_PRESETS name or a Look); the player's own look comes back on leaving. */
  readonly look?: string | Look;
  /** Hero spawn (room coordinates, feet) and facing (radians, 0 = +Z, toward the camera). */
  readonly spawn?: Vec3;
  readonly facing?: number;
  /** Sky colour. */
  readonly background?: PaletteColor;
  /** Leave out the hero (rooms with their own player: a car, a ship). */
  readonly hero?: boolean;
  /** Models to start downloading before setup (GLB urls). */
  readonly assets?: readonly string[];
  /** Build the room. Returns its own logic (or nothing). */
  build(room: RoomRuntime): RoomLogic | void | Promise<RoomLogic | void>;
}
