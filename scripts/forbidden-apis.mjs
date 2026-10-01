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
];

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
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const { re, why } of RULES) {
      if (re.test(code)) problems.push(`${file.slice(ROOT.length)}:${i + 1}: ${line.trim()}\n    → ${why}`);
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
