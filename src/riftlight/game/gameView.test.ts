import { describe, expect, it } from 'vitest';
import { GAME_VIEW } from '../../engine/model/sheet';
import { RIFTLIGHT_OPTIONS } from '..';
import { CAMERA } from './Riftlight';

describe('model sheets', () => {
  it("draw their game-scale previews through Riftlight's own camera", () => {
    const cam = RIFTLIGHT_OPTIONS.camera as { preset: string; pitch: number; yaw: number; viewHeight: number };
    expect(cam.preset).toBe('iso');
    expect({ pitch: GAME_VIEW.pitch, yaw: GAME_VIEW.yaw, viewHeight: GAME_VIEW.viewHeight }).toEqual({ pitch: cam.pitch, yaw: cam.yaw, viewHeight: cam.viewHeight });
    expect(GAME_VIEW.zooms).toEqual({ level: CAMERA.level, town: CAMERA.town });
  });
});
