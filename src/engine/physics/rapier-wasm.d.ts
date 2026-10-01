// wasm-bindgen's glue module of @dimforge/rapier3d (bundler target) ships without types.
declare module '@dimforge/rapier3d/rapier_wasm3d_bg.js' {
  /** Attach the instantiated wasm exports; every Rapier class calls into them. */
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
