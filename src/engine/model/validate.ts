/**
 * Model checks (pure, no GPU): problems a model must not ship with, and warnings about what won't
 * read at 480×270. Every message names the part and the fix. `checkModel` runs them over the
 * params (each at its min and max, one at a time: 2k + 1 builds) and 3 seeds, as
 * `npm run model -- check` does.
 */
import { Vector3 } from 'three/webgpu';
import { bakeTexture, meanColour } from '../texture/bake';
import { TEXTURE_LIBRARY } from '../texture/library';
import type { ModelCatalog } from './catalog';
import { boundsOf, compileParts, type Bounds, type CompiledPart } from './compile';
import { expandDef, partLabel, type ModelOptions } from './expand';
import { layoutModel, modelDef } from './build';
import { MODEL_LIBRARY } from './library';
import { licenceProblem } from './packs/licences';
import { partExtents, readabilityWarnings } from './readability';
import { BOX_KINDS, SEG_RANGE } from './prims';
import type { ModelDef, Part, Vec3 } from './types';

/** Triangle budget by the model's largest dimension (docs/ASSETS.md *Checks*). */
export function triangleBudget(largest: number): number {
  return largest < 0.5 ? 300 : largest < 2 ? 1000 : 3000;
}
export const MAX_MATERIALS = 8;
/** Second-smallest extent below which a part is a rod that vanishes at 480×270 (m). */
export const MIN_THICKNESS = 0.06;
/** Gap (m) beyond which a part floats free of every other part (plus float slack). */
const TOUCH = 0.01 + 1e-9;

export interface ModelMetrics {
  readonly tris: number;
  readonly draws: number;
  readonly materials: number;
  readonly parts: number;
  readonly bounds: Bounds;
  readonly seeded: boolean;
}

export interface ModelCheck {
  readonly id: string;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  /** At the default params and seed (null when it can't be built). */
  readonly metrics: ModelMetrics | null;
}

export type CheckOptions = ModelOptions;

/** Texels per metre a model may set (`texel`). */
export const TEXEL_RANGE = [2, 64] as const;

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: Vec3) => v.map(r2).join(' × ');

function partBoxes(parts: readonly CompiledPart[]): { min: Vector3; max: Vector3 }[] {
  return parts.map((p) => {
    const b = boundsOf([p]);
    return { min: new Vector3(...b.min), max: new Vector3(...b.max) };
  });
}

function gap(a: { min: Vector3; max: Vector3 }, b: { min: Vector3; max: Vector3 }): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

/** Box sizes that aren't positive, and `seg` outside its range (the part would come out wrong). */
function sizeProblems(parts: readonly Part[], path: string, out: string[]): void {
  parts.forEach((p, i) => {
    const at = `${path}[${i}]`;
    if ('mirror' in p) return sizeProblems(p.mirror, `${at}.mirror`, out);
    if ('group' in p) return sizeProblems(p.group, `${at}.group`, out);
    const q = p as unknown as Record<string, unknown>;
    for (const k of BOX_KINDS) {
      const v = q[k] as readonly number[] | undefined;
      if (v && !(v.length === 3 && v.every((x) => x > 0))) out.push(`${partLabel(p, at)} has size ${JSON.stringify(v)}: a box kind takes [w, h, d], each above 0`);
    }
    const seg = q.seg as number | undefined;
    if (seg !== undefined && !(Number.isInteger(seg) && seg >= SEG_RANGE[0] && seg <= SEG_RANGE[1])) out.push(`${partLabel(p, at)} has seg ${seg}: use a whole number of sides from ${SEG_RANGE[0]} to ${SEG_RANGE[1]}`);
  });
}

/** One build's problems and warnings (and its metrics when it builds). */
export function validateModel(idOrDef: string | ModelDef, opts: CheckOptions = {}): ModelCheck {
  const catalog: ModelCatalog = opts.catalog ?? MODEL_LIBRARY;
  const def = modelDef(idOrDef, catalog);
  const problems: string[] = [];
  const warnings: string[] = [];
  const e = expandDef(def, opts, catalog);
  problems.push(...e.problems);
  const model = e.model;
  const compiled = compileParts(model.parts);
  problems.push(...compiled.problems);

  if (e.imports && !def.source) problems.push(`it has imported \`mesh\` parts but no \`source\`: record url, licence, author and sha256 (provenance is data)`);
  const licence = def.source ? licenceProblem(def.source) : null;
  if (licence) problems.push(licence);

  sizeProblems(model.parts, 'parts', problems);
  const parts = compiled.parts;
  // textures: each named one baked once, for its problems and its mean colour
  const textures = opts.textures ?? TEXTURE_LIBRARY;
  const baked = new Map<string, ReturnType<typeof bakeTexture> | null>();
  const bakeOf = (id: string) => {
    if (!baked.has(id)) baked.set(id, textures.has(id) ? bakeTexture(textures.get(id)) : null);
    return baked.get(id)!;
  };
  if (model.texel !== undefined && !(Number.isFinite(model.texel) && model.texel >= TEXEL_RANGE[0] && model.texel <= TEXEL_RANGE[1])) problems.push(`its texel ${model.texel} is outside ${TEXEL_RANGE[0]}–${TEXEL_RANGE[1]} texels per metre: use a number in that range (or leave it to the default)`);
  const untiled = new Set<string>();
  for (const p of parts) {
    if (p.tex) {
      const b = bakeOf(p.tex);
      if (!b) problems.push(`${p.label} names texture '${p.tex}', which no TextureDef declares: add the texture or drop \`tex\``);
      else if (b.problems.length) problems.push(`${p.label} names texture '${p.tex}', which has problems: fix it first (\`npm run tex -- check ${p.tex}\`; with the kit, \`node check.mjs --sheets ${p.tex}\`)`);
      else if (!textures.get(p.tex).tile) untiled.add(p.tex);
      if (p.glow) problems.push(`${p.label} glows and names a texture: glow draws one flat colour, so drop \`tex\` or \`glow\``);
    }
    if (!p.matrix.elements.every(Number.isFinite) || !p.tris.every(Number.isFinite)) problems.push(`${p.label} has a NaN or infinite number: check its at, rot, size and points`);
  }
  const layout = layoutModel(compiled, model.palette);
  const b = layout.bounds;
  if (!layout.tris && !compiled.problems.length) problems.push(`it is empty (no triangles): add parts`);
  if (layout.tris && !model.floats && b.min[1] < -0.01) {
    const low = parts.reduce((lo, p) => (boundsOf([p]).min[1] < boundsOf([lo]).min[1] ? p : lo));
    problems.push(`${low.label} reaches ${r2(-b.min[1])} m below the floor: raise it, or set \`floats: true\` if the model hangs or hovers`);
  }
  if (def.size && layout.tris) {
    const over = b.size.map((s, i) => s > def.size![i]! * 1.1);
    if (over.some(Boolean)) problems.push(`its bounds ${fmt(b.size)} m exceed the declared size ${fmt(def.size)} m by over 10%: shrink the parts or declare the real size`);
  }

  // ---- warnings
  if (parts.length > 1) {
    // Parts that touch (within 1 cm) form clusters, and so do parts standing on the floor
    // (unless the model floats). The floor's cluster, else the biggest, is the body; the rest float.
    const boxes = partBoxes(parts);
    const floor = parts.length;
    const root = [...parts.map((_, i) => i), floor];
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
    for (let i = 0; i < parts.length; i++) {
      if (!model.floats && boxes[i]!.min.y <= TOUCH) root[find(i)] = find(floor);
      for (let j = i + 1; j < parts.length; j++) if (parts[i]!.matrix === parts[j]!.matrix || gap(boxes[i]!, boxes[j]!) <= TOUCH) root[find(i)] = find(j);
    }
    const clusters = new Map<number, number[]>();
    parts.forEach((_, i) => {
      const r = find(i);
      clusters.set(r, [...(clusters.get(r) ?? []), i]);
    });
    const vol = (i: number) => (boxes[i]!.max.x - boxes[i]!.min.x) * (boxes[i]!.max.y - boxes[i]!.min.y) * (boxes[i]!.max.z - boxes[i]!.min.z);
    const grounded = clusters.get(find(floor));
    const groups = [...clusters.values()].sort((a, b) => Number(b === grounded) - Number(a === grounded) || b.reduce((s2, i) => s2 + vol(i), 0) - a.reduce((s2, i) => s2 + vol(i), 0));
    const body = groups[0]!;
    for (const g of groups.slice(1)) {
      let d = Infinity;
      for (const i of g) {
        for (const j of body) d = Math.min(d, gap(boxes[i]!, boxes[j]!));
        if (body === grounded) d = Math.min(d, boxes[i]!.min.y);
      }
      const labels = [...new Set(g.map((i) => parts[i]!.label))];
      const who = labels.length > 1 ? `${labels[0]} (and ${labels.length - 1} part${labels.length > 2 ? 's' : ''} touching it)` : labels[0]!;
      warnings.push(`${who} floats ${r2(d)} m from the rest of the model: move it to touch, or use \`on\``);
    }
  }
  // rods: one line per size, naming the first and counting the rest (a box frame is 12 alike)
  const thin = new Map<string, string[]>();
  for (const p of parts) {
    const ext = partExtents(p);
    if (ext[1]! >= MIN_THICKNESS) continue;
    const key = `${r2(ext[0]!)} × ${r2(ext[1]!)}`;
    const list = thin.get(key) ?? [];
    if (!list.includes(p.label)) list.push(p.label);
    thin.set(key, list);
  }
  for (const [size, labels] of thin) {
    const who = labels.length > 1 ? `${labels.length} parts are (${labels.slice(0, 4).join(', ')}${labels.length > 4 ? ', …' : ''})` : `${labels[0]} is`;
    warnings.push(`${who} ${size} m across: rods under ${MIN_THICKNESS} m vanish at 480×270; thicken to ${MIN_THICKNESS} m or more`);
  }
  for (const t of untiled) warnings.push(`texture '${t}' doesn't tile: on a model it shows once, at the model's origin, and its edge texels smear across the rest of the part (transparent texels draw black); use a tiling texture (\`tile: true\`)`);
  warnings.push(...readabilityWarnings(parts, model.palette, model.floats, (id) => {
    const b = bakeOf(id);
    return b ? meanColour(b) : 0xff00ff;
  }));
  const largest = Math.max(...b.size);
  const budget = triangleBudget(largest);
  if (layout.tris > budget) warnings.push(`${layout.tris} triangles is over the budget of ${budget} for a model ${r2(largest)} m across: fewer sides (seg) or fewer parts`);
  const materials = new Set(layout.meshes.map((m) => `${m.glow}|${m.hex}|${m.tex ?? ''}`)).size;
  if (materials > MAX_MATERIALS) warnings.push(`${materials} materials (over ${MAX_MATERIALS}): merge slots that share a colour, or drop accents`);

  const metrics: ModelMetrics | null = problems.length ? null : { tris: layout.tris, draws: layout.meshes.length, materials, parts: parts.length, bounds: b, seeded: e.seeded };
  return { id: def.id, problems, warnings, metrics };
}

/**
 * Every check over the model's range: the defaults, then each param at its min and at its max
 * (one at a time), each at seeds 1, 2 and 3 when the parts read the rng. Messages say which
 * build they came from unless every build agrees.
 */
export function checkModel(idOrDef: string | ModelDef, opts: CheckOptions = {}): ModelCheck {
  const def = modelDef(idOrDef, opts.catalog ?? MODEL_LIBRARY);
  const base = validateModel(def, opts);
  const configs: { label: string; params: Record<string, number> }[] = [];
  for (const [k, [, min, max]] of Object.entries(def.params ?? {})) {
    configs.push({ label: `${k}=${min}`, params: { ...opts.params, [k]: min } });
    configs.push({ label: `${k}=${max}`, params: { ...opts.params, [k]: max } });
  }
  const seeds = base.metrics?.seeded ? [2, 3] : [];
  const problems = [...base.problems];
  const warnings = [...base.warnings];
  const add = (into: string[], msgs: readonly string[], label: string) => {
    for (const m of msgs) if (!into.includes(m) && !into.some((x) => x.startsWith(`${m} (`))) into.push(`${m} (${label})`);
  };
  for (const s of seeds) {
    const r = validateModel(def, { ...opts, seed: s });
    add(problems, r.problems, `seed ${s}`);
    add(warnings, r.warnings, `seed ${s}`);
  }
  for (const c of configs) {
    for (const s of [opts.seed ?? 1, ...seeds]) {
      const r = validateModel(def, { ...opts, params: c.params, seed: s });
      const label = s === (opts.seed ?? 1) ? c.label : `${c.label}, seed ${s}`;
      add(problems, r.problems, label);
      add(warnings, r.warnings, label);
    }
  }
  return { id: def.id, problems, warnings, metrics: base.metrics };
}
