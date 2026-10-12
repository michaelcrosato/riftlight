// Node module hooks that let a tsx script load what Vite resolves for the browser and vitest:
// `@dimforge/rapier3d` (it declares only "module", which Node's resolver ignores), its `.wasm`
// glue import (an empty stub: `initRapier()` hands the bindings the real instance, read from
// disk) and `?url` imports (the file's path). With them, tools can import the engine index
// (Riftlight's town builds on it) and run Rapier (V-HACD) headless. Register before importing.
//
// One way to load Rapier, mirrored for Node: this is Vite's `rapierWasm()` stub
// (vite.config.ts) plus its `?url` handling, and `src/engine/physics/rapierWasm.ts` does the
// instantiating in both. Change one, change the other.
//
// Synchronous, in-thread hooks (`module.registerHooks`, Node 22.15+): the off-thread ones that
// `module.register` installs never ran under tsx on Node 24 (measured: the town failed to load,
// V-HACD silently gave no hulls), while these run on 22 and 24 alike.
import { registerHooks } from 'node:module';

/** The glue module's `.wasm` import (as vite.config.ts matches it): it becomes an empty module. */
const GLUE = /@dimforge[\\/]rapier3d[\\/]rapier_wasm3d\.js$/;
const STUB = 'data:text/javascript,export%20%7B%7D%3B';

let registered = false;

/** Register the hooks once (later imports see them; earlier ones are unaffected). */
export function registerEngineHooks(): void {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec === '@dimforge/rapier3d') return next('@dimforge/rapier3d/rapier.js', ctx);
      if (spec.endsWith('rapier_wasm3d_bg.wasm') && ctx.parentURL && GLUE.test(ctx.parentURL)) return { url: STUB, format: 'module', shortCircuit: true };
      if (spec.endsWith('?url')) {
        const file = next(spec.slice(0, -4), ctx).url; // the file's own URL, as Vite's `?url` gives its path
        return { url: `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(file)};`)}`, format: 'module', shortCircuit: true };
      }
      return next(spec, ctx);
    },
  });
}
