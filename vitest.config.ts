import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // データ/IO/math 層は DOM 非依存のため node 環境で実行する
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
