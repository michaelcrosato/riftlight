import { model } from '../..';

/**
 * Emberfall's smithy (src/riftlight/town/Town.ts) traced in primitives, in the trace's frame
 * (base on y = 0, footprint centred: the source's floor sits 4 mm up).
 *
 *   npm run model -- trace smithy --against town:smithy --reference
 *   npm run model -- trace src/engine/model/fixtures/trace/smithy.ts --against town:smithy
 *
 * The reference's 38 pieces were all exact boxes, prisms and a cone, pasted as given (the stump
 * `close`). The first scoring passed at ~1.0 but the check found the left post inside its wall,
 * z-fighting bottoms, a slate chimney 0.01 from the red roof in lightness and a slate block of
 * 42%; the fixes (floor 3 mm lower, an ink chimney and anvil) cost colour: the rest is the
 * source's slate wall tops and night forge top (its `top:` faces). Three scorings. ~1100 tokens.
 */
const RAFTER = { box: [0.08, 0.06, 2.79], rot: [-21.378, 0, 0], c: 'timber' } as const;
const tool = (x: number, c: string, lean: number) => ({ box: [0.07, 0.95, 0.05] as const, at: [x, 1.255, -1.667] as const, rot: [0, 0, lean] as const, c });

export default model({
  id: 'smithy',
  about: 'Open-fronted smithy: plaster walls under a lean-to red roof on timber posts, stone forge and chimney, anvil, quench tub, grindstone, tool rack',
  tags: ['town', 'building', 'stone', 'wood', 'traced'],
  palette: { stone: 'slate', plaster: 'mist', roof: 'red', timber: 'plum', fire: 'orange', steel: 'white', soot: 'ink', water: 'blue' },
  parts: [
    // floor, walls, posts, beam, roof and rafters
    { box: [6.19, 0.123, 4.593], at: [0, 0.0625, 0.1865], c: 'stone', name: 'floor' },
    { box: [6.2, 3.2, 0.5], at: [0, 1.604, -2.017], c: 'plaster', name: 'back-wall' },
    { box: [0.45, 2.6, 2.2], at: [-3, 1.304, -1.017], c: 'plaster' },
    { box: [0.45, 1.1, 2.2], at: [3, 0.554, -1.017], c: 'plaster' },
    { box: [0.26, 1.3, 0.26], at: [3, 1.654, -0.067], c: 'timber', name: 'post' }, // its twin is inside the left wall
    { box: [6.4, 0.2, 0.26], at: [0, 2.324, -0.067], c: 'timber', name: 'beam' },
    { box: [6.8, 0.14, 2.77], at: [0, 2.935, -1.167], rot: [-21.36, 0, 0], c: 'roof', name: 'roof' },
    { mirror: [0.56, 1.68, 2.8].map((x) => ({ ...RAFTER, at: [x, 2.975, -1.167] as const })) },
    // forge, chimney and bellows
    { box: [1.6, 0.94, 1.3], at: [-1.7, 0.534, -1.167], c: 'stone', name: 'forge' },
    { box: [1.1, 0.12, 0.8], at: [-1.7, 1.044, -1.117], c: 'fire' },
    { box: [0.6, 0.1, 0.45], at: [-1.7, 1.094, -1.117], c: 'steel' },
    { box: [0.8, 3.5, 0.8], at: [-1.7, 2.654, -1.617], c: 'soot', name: 'chimney' },
    { box: [0.9, 0.2, 0.9], at: [-1.7, 4.454, -1.617], c: 'soot' },
    { box: [0.8, 0.5, 0.6], at: [-0.65, 0.754, -1.217], rot: [0, 0, -15], c: 'timber', name: 'bellows' },
    // quench tub
    { cyl: [0.72, 0.85, 0.72], seg: 8, at: [2.3, 0.434, -1.117], c: 'timber', name: 'tub' },
    { cyl: [0.74, 0.07, 0.74], seg: 8, at: [2.3, 0.724, -1.117], c: 'stone' },
    { cyl: [0.6, 0.05, 0.6], seg: 8, at: [2.3, 0.864, -1.117], c: 'water' },
    // tool rack: a bar and five hanging tools
    { box: [2.2, 0.12, 0.18], at: [1.2, 1.604, -1.717], c: 'timber' },
    ...[2, 1.2, 0.4].map((x) => tool(x, 'steel', -4)),
    ...[0.8, 1.6].map((x) => tool(x, 'plaster', 6)),
    // anvil on its stump
    { cyl: [0.761, 0.5, 0.78], seg: 7, top: 0.85, at: [0.519, 0.254, 1.478], rot: [0, 12.8, 0], c: 'timber', name: 'stump' },
    { box: [0.42, 0.18, 0.3], at: [0.5, 0.604, 1.483], c: 'soot' },
    { box: [0.74, 0.16, 0.34], at: [0.5, 0.764, 1.483], c: 'soot', name: 'anvil' },
    { box: [0.22, 0.12, 0.2], at: [0.9, 0.764, 1.483], c: 'soot' },
    // grindstone, coal heap, a leaning slab and a dropped tool
    { box: [0.12, 0.7, 0.5], at: [-2.5, 0.354, 1.383], c: 'timber' },
    { cyl: [0.84, 0.14, 0.799], seg: 10, at: [-2.5, 0.754, 1.383], rot: [-17.9, 0, -90], c: 'plaster', name: 'grindstone' },
    { cone: [0.9, 0.35, 0.78], seg: 6, at: [1.9, 0.184, 0.083], rot: [0, -30, 0], c: 'soot', name: 'coal' },
    { box: [0.5, 0.5, 0.08], at: [1.2, 0.285, 1.833], rot: [15, 30, 0], c: 'stone' },
    { box: [0.07, 0.8, 0.05], at: [-0.05, 0.384, 1.733], rot: [20, 0.216, 10], c: 'steel' },
  ],
  source: { url: 'src/riftlight/town/Town.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.9992, iouClose: 0.9989, colour: 0.0319, bounds: [0, 0, 0] } },
});
