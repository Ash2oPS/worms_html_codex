import { defineConfig, type Plugin } from 'vite';

const RAPIER_WASM_SHIM_ID = '\0rapier-wasm-shim';

const rapierWasmShim = (): Plugin => ({
  name: 'rapier-wasm-shim',
  enforce: 'pre',
  resolveId(source, importer) {
    const normalizedImporter = importer?.replaceAll('\\', '/');
    if (
      source === './rapier_wasm2d'
      && normalizedImporter?.endsWith('/node_modules/@dimforge/rapier2d/raw.js')
    ) {
      return RAPIER_WASM_SHIM_ID;
    }

    return null;
  },
  load(id) {
    if (id !== RAPIER_WASM_SHIM_ID) {
      return null;
    }

    return `
      import wasmUrl from "@dimforge/rapier2d/rapier_wasm2d_bg.wasm?url";
      import * as wasmBindings from "@dimforge/rapier2d/rapier_wasm2d_bg.js";
      export * from "@dimforge/rapier2d/rapier_wasm2d_bg.js";
      import { __wbg_set_wasm } from "@dimforge/rapier2d/rapier_wasm2d_bg.js";

      const response = await fetch(wasmUrl);
      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {
        "./rapier_wasm2d_bg.js": wasmBindings,
      });
      __wbg_set_wasm(instance.exports);
    `;
  },
});

export default defineConfig({
  plugins: [rapierWasmShim()],
  build: {
    // The runtime code is now small; only the isolated Pixi vendor chunk remains slightly above the default warning threshold.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('@dimforge/rapier2d')) {
            return 'rapier';
          }

          if (id.includes('pixi.js') || id.includes('@pixi/')) {
            return 'pixi';
          }

          return 'vendor';
        },
      },
    },
  },
});
