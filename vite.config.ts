import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesium';

export default defineConfig(({ command }) => ({
  base: './',
  // dev: serve Cesium's static assets straight from node_modules; build: copy them into dist/cesium
  define: { CESIUM_BASE_URL: JSON.stringify(command === 'serve' ? `/${cesiumSource}` : cesiumBaseUrl) },
  plugins: [
    viteStaticCopy({
      targets: ['ThirdParty', 'Workers', 'Assets', 'Widgets'].map(d => ({ src: `${cesiumSource}/${d}`, dest: cesiumBaseUrl })),
    }),
  ],
  optimizeDeps: { include: ['cesium'] },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 6000, target: 'es2022' },
}));
