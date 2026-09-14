import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // esbuild's dep pre-bundling breaks @ffmpeg/ffmpeg's internal
      // `new Worker(new URL('./worker.js', import.meta.url))` reference
      // (the worker script 404s at runtime), so leave these unbundled.
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    build: {
      // Firebase is just over Vite's generic 500 kB raw threshold but compresses
      // to roughly 120 kB. Keep a realistic ceiling while splitting every other
      // large feature/vendor family into its own cacheable chunk.
      chunkSizeWarningLimit: 550,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const moduleId = id.replace(/\\/g, '/');
            if (!moduleId.includes('/node_modules/')) return undefined;
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return 'react-vendor';
            if (moduleId.includes('/node_modules/firebase/') || moduleId.includes('/node_modules/@firebase/')) return 'firebase-vendor';
            if (moduleId.includes('/node_modules/lucide-react/')) return 'icons-vendor';
            if (/\/node_modules\/(recharts|victory-vendor|@reduxjs\/toolkit|decimal\.js-light|es-toolkit|eventemitter3|immer|react-redux|reselect|tiny-invariant|use-sync-external-store|d3-[^/]+)\//.test(moduleId)) return 'charts-vendor';
            if (moduleId.includes('/node_modules/@ffmpeg/')) return 'media-vendor';
            if (moduleId.includes('/node_modules/read-excel-file/')) return 'spreadsheet-vendor';
            return 'vendor';
          },
        },
      },
    },
    test: {
      setupFiles: ['./tests/offline-network.mjs'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
