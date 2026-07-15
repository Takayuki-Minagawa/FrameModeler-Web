import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const packageVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [
    {
      name: 'framemodeler-version',
      transformIndexHtml: (html) => html.split('%APP_VERSION%').join(packageVersion),
    },
  ],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 525,
    rollupOptions: {
      output: {
        // Three.jsはアプリ更新と独立してキャッシュできるvendor chunkへ分離する。
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  publicDir: 'public',
});
