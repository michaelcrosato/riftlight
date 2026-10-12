/**
 * Def → plain data: params applied, the parts function called, every `use` replaced by a group
 * of the used model's parts (its slots mapped onto this model's), and every part's slot made
 * explicit. `expandModel` returns it as JSON-safe data (diffs, saves, exports); the compiler
 * and the checks work from the same expansion.
 */
import { isPaletteName, PALETTE, type PaletteColor } from '../palette';
import { hashString, Rng } from '../random';
import type { ModelCatalog } from './catalog';
import { primKind } from './prims';
import type { Anchor, ModelDef, ModelLight, Part, Provenance, Slot, UsePart, Vec3 } from './types';
import type { TextureCatalog } from '../texture/catalog';

/** What a slot is bound to at build time: a PALETTE name, or a computed colour (hex). */
export type Binding = PaletteColor | number;

export interface ModelOptions {
  /** Param values (unset ones take the def's default). */
  readonly params?: Readonly<Record<string, number>>;
  /** Seed for parts that read the rng (default 1). */
  readonly seed?: number;
  /** Re-bind slots: PALETTE names, or computed colours for game bindings (theme tints). */
  readonly palette?: Readonly<Record<Slot, Binding>>;
  /** Override the def's light (a theme's torch colour, a dimmer lamp). */
  readonly light?: Partial<ModelLight> & { readonly color?: number };
  /** Where `use` ids (and a string id passed to build) resolve; default `MODEL_LIBRARY`. */
  readonly catalog?: ModelCatalog;
  /** Where parts' `tex` ids resolve; default `TEXTURE_LIBRARY`. */
  readonly textures?: TextureCatalog;
}

/** A model as plain data: no functions, no `use`, every primitive with its slot. */
export interface ExpandedModel {
  readonly id: string;
  readonly about: string;
  readonly tags: readonly string[];
  readonly palette: Readonly<Record<Slot, Binding>>;
  readonly params: Readonly<Record<string, number>>;
  readonly seed: number;
  readonly parts: readonly Part[];
  readonly size?: Vec3;
  readonly anchors?: Readonly<Record<string, Anchor>>;
  readonly light?: ModelLight;
  readonly collider: 'box' | 'cyl' | 'hull' | 'parts' | 'none';
  readonly texel?: number;
  readonly floats?: boolean;
  readonly source?: Provenance;
}

export interface Expansion {
  readonly model: ExpandedModel;
  readonly problems: string[];
  /** Whether any parts function read its rng (then builds are per seed, not cached). */
  readonly seeded: boolean;
  /** Whether the def itself (not a model it uses) has imported `mesh` parts. */
  readonly imports: boolean;
}

/** The generator a model's parts function gets: its own stream per (model, seed). */
export function modelRng(id: string, seed: number): Rng {
  return new Rng(`model:${id}:${seed}`);
}

/** Drop undefined-valued keys, so the expansion is the same data as its JSON. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** A part's name for messages: its `name`, or its kind and where it sits in the def. */
export function partLabel(p: object, path: string): string {
  const name = (p as { name?: string }).name;
  if (name) return `'${name}'`;
  const kind = primKind(p) ?? ('group' in p ? 'group' : 'mirror' in p ? 'mirror' : 'use' in p ? 'use' : 'part');
  return `${kind} at ${path}`;
}

/** Records whether anything read the generator (a draw, a fork, its state: any property). */
function tracked(rng: Rng, onUse: () => void): Rng {
  return new Proxy(rng, {
    get(target, key) {
      onUse();
      const v = Reflect.get(target, key, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}


export function expandDef(def: ModelDef, opts: ModelOptions, catalog: ModelCatalog, stack: readonly string[] = []): Expansion {
  const problems: string[] = [];
  const slots = Object.keys(def.palette);
  const first = slots[0];
  if (!first) problems.push(`the palette declares no slots: add at least one, e.g. palette: { wood: 'orange' }`);
  for (const [slot, colour] of Object.entries(def.palette)) {
    if (!isPaletteName(colour)) problems.push(`palette slot '${slot}' is ${JSON.stringify(colour)}, not a PALETTE colour: use one of ${Object.keys(PALETTE).join(', ')}`);
  }

  // params: the def's defaults, then the build's values (checked against the ranges)
  const params: Record<string, number> = {};
  for (const [k, [d, lo, hi]] of Object.entries(def.params ?? {})) {
    params[k] = d;
    if (!(lo <= hi)) problems.push(`param '${k}' has min ${lo} above max ${hi}: write it [default, min, max]`);
    else if (!(d >= lo && d <= hi)) problems.push(`param '${k}' defaults to ${d}, outside its own range ${lo}..${hi}`);
  }
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    const spec = def.params?.[k];
    if (!spec) {
      problems.push(`param '${k}' is not one of the model's params (${Object.keys(def.params ?? {}).join(', ') || 'none'})`);
      continue;
    }
    if (!(v >= spec[1] && v <= spec[2])) problems.push(`param '${k}' = ${v} is outside its range ${spec[1]}..${spec[2]}`);
    params[k] = v;
  }

  const seed = opts.seed ?? 1;
  let seeded = false;
  let raw: readonly Part[] = [];
  if (typeof def.parts === 'function') {
    try {
      raw = def.parts(params, tracked(modelRng(def.id, seed), () => (seeded = true)));
    } catch (e) {
      problems.push(`the parts function threw: ${(e as Error).message}`);
    }
  } else raw = def.parts;

  const palette: Record<Slot, Binding> = { ...def.palette };
  const uses = new Map<string, number>();
  let imports = false;
  const undeclared = (p: object, at: string, c: Slot) => `${partLabel(p, at)} uses slot '${c}', which the palette does not declare: add it to \`palette\` or use one of ${slots.join(', ')}`;

  // `c` on a group is the default slot of the parts inside it
  const walk = (parts: readonly Part[], path: string, slot: Slot | undefined): Part[] => {
    const out: Part[] = [];
    parts.forEach((p, i) => {
      const at = `${path}[${i}]`;
      if (!p || typeof p !== 'object') {
        problems.push(`${at} is ${JSON.stringify(p)}, not a part`);
        return;
      }
      if ('mirror' in p) {
        if (p.axis !== undefined && p.axis !== 'x' && p.axis !== 'z') problems.push(`${partLabel(p, at)} mirrors across axis '${String(p.axis)}': use 'x' (the default) or 'z'`);
        out.push(clean({ ...p, mirror: walk(p.mirror, `${at}.mirror`, slot) }));
      } else if ('group' in p) {
        if (p.c !== undefined && !slots.includes(p.c)) problems.push(undeclared(p, at, p.c));
        const { c, ...rest } = p;
        out.push(clean({ ...rest, group: walk(p.group, `${at}.group`, c ?? slot) }));
      } else if ('use' in p) {
        const g = expandUse(p, at);
        if (g) out.push(g);
      } else {
        if (!primKind(p)) {
          problems.push(`${at} has no part kind (keys: ${Object.keys(p).join(', ')}): use box, cyl, cone, ball, lump, wedge, torus, lathe, slab, tube, mesh, group, mirror or use`);
          return;
        }
        if (p.c !== undefined && !slots.includes(p.c)) problems.push(undeclared(p, at, p.c));
        if ('mesh' in p) {
          imports = true;
          for (const s of Object.keys(p.mesh.f)) if (!slots.includes(s)) problems.push(`${partLabel(p, at)} has faces in slot '${s}', which the palette does not declare: add it to \`palette\``);
        }
        const c = p.c ?? slot ?? first;
        out.push(clean(c === undefined || 'mesh' in p ? p : { ...p, c }));
      }
    });
    return out;
  };

  const expandUse = (p: UsePart, at: string): Part | null => {
    if (stack.includes(p.use) || p.use === def.id) {
      problems.push(`use cycle: ${[...stack, def.id, p.use].join(' → ')}: a model can't contain itself`);
      return null;
    }
    if (!catalog.has(p.use)) {
      problems.push(`${partLabel(p, at)} uses model '${p.use}', which the catalog does not have: check the id (\`npm run model -- find\`; with the kit, LIBRARY.md)`);
      return null;
    }
    const n = (uses.get(p.use) ?? 0) + 1;
    uses.set(p.use, n);
    const scope = p.name ?? `${p.use}#${n}`;
    const child = expandDef(catalog.get(p.use), { params: p.params, seed: p.seed ?? hashString(`${seed}:${at}`), catalog }, catalog, [...stack, def.id]);
    for (const m of child.problems) problems.push(`in ${p.use} (${at}): ${m}`);
    if (child.seeded) seeded = true;
    // its slots → ours: mapped, else the same name, else its own colour under `<id>.<slot>`
    const map = new Map<Slot, Slot>();
    for (const [s, binding] of Object.entries(child.model.palette)) {
      const to = p.palette && Object.hasOwn(p.palette, s) ? p.palette[s] : undefined; // own keys: a slot may be called 'constructor'
      if (to !== undefined && !slots.includes(to)) problems.push(`${partLabel(p, at)} maps its slot '${s}' to '${to}', which this palette does not declare`);
      const target = to ?? (slots.includes(s) ? s : `${p.use}.${s}`);
      map.set(s, target);
      if (!Object.hasOwn(palette, target)) palette[target] = binding;
    }
    for (const s of Object.keys(p.palette ?? {})) if (!Object.hasOwn(child.model.palette, s)) problems.push(`${partLabel(p, at)} maps slot '${s}', which ${p.use} does not have (${Object.keys(child.model.palette).join(', ')})`);
    const group = renameParts(child.model.parts, scope, (s) => map.get(s) ?? s);
    return clean({ group, at: p.at, rot: p.rot, scale: p.scale, name: p.name, on: p.on });
  };

  const parts = walk(raw, 'parts', undefined);

  // the build's re-bindings: declared slots only
  for (const [slot, binding] of Object.entries(opts.palette ?? {})) {
    if (!Object.hasOwn(palette, slot)) problems.push(`the build re-binds slot '${slot}', which the model does not have (${Object.keys(palette).join(', ')})`);
    else if (typeof binding !== 'number' && !isPaletteName(binding)) problems.push(`the build binds slot '${slot}' to ${JSON.stringify(binding)}, not a PALETTE colour or a hex number`);
    else palette[slot] = binding;
  }
  if (def.light && !slots.includes(def.light.c)) problems.push(`the light's colour is slot '${def.light.c}', which the palette does not declare`);
  if (opts.light?.c !== undefined && !Object.hasOwn(palette, opts.light.c)) problems.push(`the build's light names slot '${opts.light.c}', which the model does not have: pass \`color\` for a colour`);
  const nums = (...vs: (readonly number[] | undefined)[]) => vs.every((v) => !v || v.every(Number.isFinite));
  if (!nums(def.light?.at, [def.light?.intensity ?? 0, def.light?.radius ?? 0], def.size, ...Object.values(def.anchors ?? {}).flatMap((a) => (Array.isArray(a) ? [a as readonly number[]] : [(a as { at: Vec3 }).at, (a as { rot: Vec3 }).rot]))))
    problems.push(`its light, size or anchors hold a NaN or infinite number`);
  if (typeof def.about !== 'string') problems.push(`it has no \`about\`: one line saying what it is (\`find\` searches it)`);
  if (!Array.isArray(def.tags)) problems.push(`it has no \`tags\`: a list of words for \`find\` and \`zoo\` (may be empty)`);

  const model: ExpandedModel = {
    id: def.id,
    about: typeof def.about === 'string' ? def.about : '',
    tags: Array.isArray(def.tags) ? def.tags : [],
    palette,
    params,
    seed,
    parts,
    ...(def.size ? { size: def.size } : {}),
    ...(def.anchors ? { anchors: def.anchors } : {}),
    ...(def.light ? { light: def.light } : {}),
    collider: def.collider ?? 'box',
    ...(def.texel !== undefined ? { texel: def.texel } : {}),
    ...(def.floats ? { floats: true } : {}),
    ...(def.source ? { source: def.source } : {}),
  };
  return { model, problems, seeded, imports };
}

/** A used model's parts inside its scope: names and `on` prefixed, slots mapped. */
function renameParts(parts: readonly Part[], scope: string, slot: (s: Slot) => Slot): Part[] {
  return parts.map((p): Part => {
    const named = (q: { name?: string; on?: string }) => ({
      ...(q.name ? { name: `${scope}/${q.name}` } : {}),
      ...(q.on ? { on: `${scope}/${q.on}` } : {}),
    });
    if ('mirror' in p) return { ...p, mirror: renameParts(p.mirror, scope, slot) };
    if ('group' in p) return { ...p, ...named(p), group: renameParts(p.group, scope, slot) };
    if ('use' in p) return p; // expanded already
    if ('mesh' in p) {
      // two of its slots may land on one of ours: their faces join (a Map: a slot may be called 'constructor')
      const f = new Map<Slot, string>();
      for (const [s, faces] of Object.entries(p.mesh.f)) f.set(slot(s), f.has(slot(s)) ? `${f.get(slot(s))},${faces}` : faces);
      return { ...p, ...named(p), mesh: { v: p.mesh.v, f: Object.fromEntries(f) } };
    }
    return { ...p, ...named(p), ...(p.c !== undefined ? { c: slot(p.c) } : {}) };
  });
}
