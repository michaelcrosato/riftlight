// Gate A harness (docs/plans/asset-system.md §12): the token benchmark's tooling.
// Run through tsx:  npx tsx scripts/gate-a.ts <command> <file.ts>
//
//   kit <file.ts>      arm (a): the file exports `build(kit: Kit): void`, which builds one object
//                      at the origin on the town Kit (src/riftlight/town/kit.ts; floor y = 0,
//                      +Z front). Writes <file>.png: a turntable and the game-scale previews,
//                      and prints inspectObject's warnings (exit 1 while there are any).
//   judge <file.ts>    the judge image for either arm (a kit `build` or an exported ModelDef):
//                      turntable + game-scale previews, nothing else, so the arms look alike.
//                      Writes <file>.judge.png.
//
// Arm (b) uses `npm run model -- check <file.ts>` and `sheet <file.ts> --out <its folder>` on its
// exported ModelDef.
// The briefs, the prompts both arms and the judge get, and how runs are scored:
// docs/plans/gate-a.md.
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Group, type Object3D } from 'three/webgpu';
import { column, inspectObject, row, textBox, titleBar } from '../src/engine/inspect';
import { buildModel, ModelCatalog, MODEL_LIBRARY, type ModelDef } from '../src/engine/model';
import { renderJudge } from '../src/engine/model/sheet';
import { Kit } from '../src/riftlight/town/kit';
import { encodePng } from './png';

const [cmd, target] = process.argv.slice(2);
if (!cmd || !target || !existsSync(resolve(target))) {
  console.error('usage: npx tsx scripts/gate-a.ts kit|judge <file.ts>');
  process.exit(2);
}
const file = resolve(target);
const mod = (await import(pathToFileURL(file).href)) as { build?: (kit: Kit) => void; default?: ModelDef } & Record<string, unknown>;

function kitObject(): Object3D {
  const kit = new Kit();
  mod.build!(kit);
  const g = new Group();
  g.add(kit.build());
  return g;
}

const isDef = (v: unknown): v is ModelDef => !!v && typeof v === 'object' && 'id' in v && 'parts' in v && 'palette' in v;
/** The file's default export (or first ModelDef), built with its sibling defs in the catalog. */
function defObject(): Object3D {
  const defs = [...new Set([mod.default, ...Object.values(mod)].filter(isDef))];
  if (!defs.length) {
    console.error(`${target} exports neither build(kit) nor a ModelDef`);
    process.exit(2);
  }
  const catalog = new ModelCatalog([...MODEL_LIBRARY.all().filter((d) => !defs.some((x) => x.id === d.id)), ...defs]);
  return buildModel(defs[0]!, { catalog }).object;
}

let object: Object3D;
try {
  object = typeof mod.build === 'function' ? kitObject() : defObject();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

if (cmd === 'judge') {
  writeFileSync(file.replace(/\.ts$/, '.judge.png'), encodePng(renderJudge(object)));
  console.log(`wrote ${target.replace(/\.ts$/, '.judge.png')}`);
} else if (cmd === 'kit') {
  if (typeof mod.build !== 'function') {
    console.error(`${target} must export build(kit: Kit)`);
    process.exit(2);
  }
  const r = inspectObject(object, { name: target });
  const judge = renderJudge(object);
  const lines = [{ text: `${r.triangles} triangles, ${r.drawCalls} draws, ${r.colours} colours, bounds ${r.bounds.size.join(' x ')} m` }, ...(r.warnings.length ? r.warnings.map((w) => ({ text: `! ${w}` })) : [{ text: 'no warnings' }])];
  const img = column([titleBar(target, judge.width), judge, row([textBox(lines, judge.width - 8, 0, 'INSPECT')])]);
  writeFileSync(file.replace(/\.ts$/, '.png'), encodePng(img));
  console.log(lines.map((l) => l.text).join('\n'));
  console.log(`wrote ${target.replace(/\.ts$/, '.png')}`);
  if (r.warnings.length) process.exitCode = 1;
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
