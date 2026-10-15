import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '../../engine/snapshot';
import { Rng } from '../core/rng';
import { Cat } from './critters';
import { Npc, NPCS } from './npcs';

// Save-states (docs/GAME.md): a townsperson and the cat saved while they walk, bark and flee,
// loaded into ones made the same way, go on exactly as the originals did.

const DT = 1 / 60;
const kept = <T>(v: T): T => decodeState(JSON.parse(JSON.stringify(encodeState(v)))) as T;
/** The hero walking a loop past them. */
const heroAt = (f: number) => new Vector3(Math.cos(f * 0.01) * 3, 0, Math.sin(f * 0.013) * 3);
const path = [new Vector3(0, 0, 0), new Vector3(4, 0, 0), new Vector3(4, 0, 4), new Vector3(0, 0, 4)];

describe('town save-states', () => {
  it('a walking villager: where, the waypoint and wait, the bark, the clip and its time', () => {
    const make = () => {
      const n = new Npc(NPCS.villager!, new Vector3(0, 0, 0), 0, new Rng('wren'));
      n.path = path;
      return n;
    };
    const look = (n: Npc) => ({ at: n.position.toArray(), yaw: n.yaw, bubble: n.bubble?.text ?? null, clip: n.player.name, t: +n.player.time.toFixed(6), save: kept(n.save()) });
    const a = make();
    for (let f = 0; f < 400; f++) a.update(DT, heroAt(f));
    const s = kept(a.save());
    for (let f = 400; f < 900; f++) a.update(DT, heroAt(f));
    const went = look(a);

    const b = make();
    for (let f = 0; f < 37; f++) b.update(DT, heroAt(f * 3)); // somewhere else entirely first: load replaces it
    b.load(s);
    expect(kept(b.save())).toEqual(s);
    for (let f = 400; f < 900; f++) b.update(DT, heroAt(f));
    expect(look(b)).toEqual(went);
  });

  it('the cat: its walk, sitting and fleeing, timers, meows and random stream', () => {
    const make = () => new Cat(new Rng('cat'), new Vector3(1, 0, 1), path);
    const a = make();
    for (let f = 0; f < 500; f++) a.update(DT, heroAt(f), []);
    const s = kept(a.save());
    for (let f = 500; f < 1200; f++) a.update(DT, heroAt(f), []);
    const went = { at: a.position.toArray(), save: kept(a.save()) };

    const b = make();
    b.load(s);
    expect(kept(b.save())).toEqual(s);
    for (let f = 500; f < 1200; f++) b.update(DT, heroAt(f), []);
    expect({ at: b.position.toArray(), save: kept(b.save()) }).toEqual(went);
  });
});
