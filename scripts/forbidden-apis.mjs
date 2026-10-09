// Architecture guardrail, run as part of `npm run lint`. Fails on anything that would
// break the WebGPU-first / TSL-only pixel pipeline contract (see docs/ENGINE.md).
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const PINS = { three: '0.186.0', '@dimforge/rapier3d': '0.20.0', '@types/three': '0.186.0' };

const RULES = [
  { re: /\bEffectComposer\b/, why: 'use RenderPipeline + TSL nodes' },
  { re: /\bRenderPixelatedPass\b/, why: 'use pixelationPass (TSL)' },
  { re: /\bShaderPass\b/, why: 'write the effect as a TSL node' },
  { re: /\b(Raw)?ShaderMaterial\b/, why: 'use node materials + TSL' },
  { re: /\bonBeforeCompile\b/, why: 'use node materials + TSL' },
  { re: /\bWebGLRenderer\b/, why: 'WebGPURenderer only (its WebGL 2 backend is the fallback)' },
  { re: /\bgl_(FragColor|Position|FragCoord)\b|#version\s+\d+|precision\s+(high|medium|low)p/, why: 'no raw GLSL; write TSL' },
  { re: /from\s+['"]three['"]/, why: "import from 'three/webgpu' (and TSL from 'three/tsl')" },
  { re: /from\s+['"]three\/(examples\/jsm|addons)\/postprocessing\//, why: 'WebGL-only postprocessing; use three/addons/tsl/display/*' },
  { re: /from\s+['"](react|react-dom|@react-three\/[^'"]+|babylonjs|@babylonjs\/[^'"]+|phaser|pixi\.js|playcanvas)['"]/, why: 'no React or external engines' },
  // Determinism (docs/DOCTRINE.md, principle 1): randomness and time come from the game.
  {
    re: /\bMath\s*(\.\s*random\b|\[\s*['"`]random['"`]\s*\])|\bcrypto\s*\.\s*(getRandomValues|randomUUID)\b/,
    why: 'use ctx.random (a seeded Rng, src/engine/random.ts): the same seed must replay the same game',
    tools: true,
  },
  {
    re: /\b(Date|performance)\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)/,
    why: "game time is ctx.time; a measurement, UI clock or timestamp says so with a '// real time: <why>' comment on the line",
    allow: /^\/\/ real time: \S/,
    tools: true,
  },
];

/** Interactive tools (not games) may use real randomness and time (paths from the repo root). */
const TOOLS = /^src\/labs\//;

/**
 * A line split into its code and its `//` comment (strings and escapes skipped, so `'http://x'`
 * stays code). Lines inside a block comment (starting with `*` or `/*`) are all comment.
 */
function split(line) {
  const t = line.trimStart();
  if (t.startsWith('*') || t.startsWith('/*')) return { code: '', comment: '' };
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '/' && line[i + 1] === '/') return { code: line.slice(0, i), comment: line.slice(i) };
  }
  return { code: line, comment: '' };
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) yield p;
  }
}

const problems = [];

for await (const file of walk(join(ROOT, 'src'))) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  const rel = file.slice(ROOT.length);
  lines.forEach((line, i) => {
    const { code, comment } = split(line);
    for (const { re, why, allow, tools } of RULES) {
      if (tools && TOOLS.test(rel)) continue;
      if (allow?.test(comment)) continue;
      if (re.test(code)) problems.push(`${rel}:${i + 1}: ${line.trim()}\n    → ${why}`);
    }
  });
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
for (const [name, version] of Object.entries(PINS)) {
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (declared !== version) problems.push(`package.json: ${name} must be pinned to exactly ${version} (found ${declared})`);
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (locked !== version) problems.push(`package-lock.json: ${name} resolves to ${locked}, expected ${version}`);
}

if (problems.length) {
  console.error(`✘ forbidden-apis: ${problems.length} problem(s)\n\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('✔ forbidden-apis: WebGPU/TSL contract and version pins OK');
