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
// V-HACD silently gave no hulls), while these run on 22 and 24 alike. An older Node says so
// (`registerHooksApi`) instead of failing on a missing export (package.json `engines`).
import * as nodeModule from 'node:module';

type RegisterHooks = typeof nodeModule.registerHooks;

/** `module.registerHooks`, or an error that names the Node the tools need (22.15 or newer). */
export function registerHooksApi(m: { readonly registerHooks?: unknown } = nodeModule, version = process.versions.node): RegisterHooks {
  if (typeof m.registerHooks === 'function') return m.registerHooks as RegisterHooks;
  throw new Error(`Node ${version} is too old for the repository's tools: they need Node 22.15 or newer (module.registerHooks, scripts/trace/hooks.ts; package.json "engines"). Use a current Node 22 or Node 24 (\`nvm install 24\`).`);
}

/** The glue module's `.wasm` import (as vite.config.ts matches it): it becomes an empty module. */
const GLUE = /@dimforge[\\/]rapier3d[\\/]rapier_wasm3d\.js$/;
const STUB = 'data:text/javascript,export%20%7B%7D%3B';

let registered = false;

/** Register the hooks once (later imports see them; earlier ones are unaffected). */
export function registerEngineHooks(): void {
  if (registered) return;
  const registerHooks = registerHooksApi();
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
