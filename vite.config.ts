import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
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
