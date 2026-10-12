// Plain data as TypeScript source, for the drafts the importers write (`npm run model -- import`,
// `npm run tex -- import`).
import type { Layer, PixelsLayer, TextureDef } from '../src/engine/texture/types';

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** A value as TypeScript source: bare keys where they can be, single quotes, short things on one line. */
export function tsValue(v: unknown, indent = '', inline = false): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    const flat = `[${v.map((x) => tsValue(x, indent, true)).join(', ')}]`;
    if (inline || (flat.length + indent.length <= 100 && !v.some((x) => x && typeof x === 'object'))) return flat;
    return `[\n${v.map((x) => `${inner}${tsValue(x, inner, true)},`).join('\n')}\n${indent}]`; // parts: one a line
  }
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    const key = (k: string) => (IDENT.test(k) ? k : tsValue(k));
    const flat = entries.length ? `{ ${entries.map(([k, x]) => `${key(k)}: ${tsValue(x, indent, true)}`).join(', ')} }` : '{}';
    if (inline || flat.length + indent.length <= 100) return flat;
    return `{\n${entries.map(([k, x]) => `${inner}${key(k)}: ${tsValue(x, inner)},`).join('\n')}\n${indent}}`;
  }
  return 'undefined';
}

/** A def as source: its keys one a line, each pixels layer's rows one a line (as the library writes them). */
function textureDefSource(def: TextureDef, name: string): string {
  const layer = (l: Layer) => {
    if (!('pixels' in l)) return `    ${tsValue(l, '    ')},`;
    const { pixels, ...rest } = l as PixelsLayer;
    return ['    {', '      pixels: [', ...pixels.map((r) => `        ${tsValue(r)},`), '      ],', ...Object.entries(rest).map(([k, v]) => `      ${k}: ${tsValue(v, '      ')},`), '    },'].join('\n');
  };
  const body = Object.entries(def).map(([k, v]) => (k === 'layers' ? ['  layers: [', ...(v as Layer[]).map(layer), '  ],'].join('\n') : `  ${k}: ${tsValue(v, '  ')},`));
  return `export const ${name} = textureDef({\n${body.join('\n')}\n});\n`;
}

/** Words an export can't be called. */
const RESERVED = new Set(
  'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '),
);

/**
 * TextureDefs as a module: `textureDef` imported from `lib` (the path to src/engine/texture from
 * the file), one `export const` per def, named after its id (`tiles-3` → `tiles3`).
 */
export function textureDefsSource(defs: readonly TextureDef[], lib: string): string {
  const names = new Set<string>();
  const nameOf = (id: string) => {
    const camel = id.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? '').toUpperCase());
    const base = /^[A-Za-z_]/.test(camel) && !RESERVED.has(camel) ? camel : `t${camel}`;
    let n = base;
    for (let k = 2; names.has(n); k++) n = `${base}${k}`;
    names.add(n);
    return n;
  };
  return [`import { textureDef } from '${lib}';`, '', ...defs.map((d) => textureDefSource(d, nameOf(d.id)))].join('\n');
}
