import { Color, CylinderGeometry, Group, Mesh, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { MODEL_LIBRARY } from '../../engine/model';
import { toonMaterial } from '../../engine/render/toon';
import { Rng } from '../core/rng';
import type { ShellServices } from '../game/ports';
import { buildProp, propModels, PROPS } from '../levels/themes/props';
import { THEMES } from '../levels/themes/themes';
import { Town } from './Town';

// A pack that fails to load (`loadRiftlightPacks` warns and goes on): this file never loads them,
// so the town is built without its pack models and the level props wear their own.

describe('without the packs', () => {
  it('the town still builds, and its interactables are still reachable', () => {
    expect(MODEL_LIBRARY.has('kenney-nature/tree-oak')).toBe(false);
    const tree = new Group();
    tree.add(new Mesh(new CylinderGeometry(0.15, 0.2, 1.2, 6), toonMaterial(0x5d275d)));
    const lights = { acquire: () => ({ intensity: 0, position: new Vector3() }), release: () => {} };
    const engine = { sun: { color: new Color(), intensity: 0 }, ambient: { color: new Color(), intensity: 0 }, scene: {} };
    const town = new Town({ rng: new Rng(1), lights, ctx: { engine, particles: { burst() {} }, audio: { play() {} } } } as unknown as ShellServices);
    town.build(tree);
    const reach = town.nav().reachable(town.spawn, town.interactables.map((i) => i.position));
    expect(reach.every(Boolean)).toBe(true);
  });

  it('a level prop whose variant is a pack model wears its own', () => {
    const forge = THEMES.get('ember-forge');
    const barrel = PROPS.get('barrel');
    const models = propModels(barrel, forge);
    const variant = models.findIndex((m) => m.model.startsWith('kenney-'));
    expect(variant).toBeGreaterThan(0);
    const p = buildProp('barrel', { theme: forge, rng: new Rng(3).fork('barrel'), variant }, 0, 0);
    expect(p.root.children.length).toBeGreaterThan(0);
  });
});
