import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const KIB = 1024;
const limits = {
  // Three.js は vendor chunk として独立にキャッシュされる。r186 で約 525 KiB。
  maxVendorChunkBytes: 560 * KIB,
  // アプリ本体と遅延読込 chunk（YAML parser、出力機能など）の合計。
  maxApplicationJavaScriptBytes: 440 * KIB,
};

const files = await readdir(assetsDirectory);
const javascript = await Promise.all(
  files
    .filter((file) => file.endsWith('.js'))
    .map(async (file) => ({ file, bytes: (await stat(join(assetsDirectory.pathname, file))).size })),
);

const isVendor = (asset) => asset.file.startsWith('three-');
const vendor = javascript.filter(isVendor);
const application = javascript.filter((asset) => !isVendor(asset));
const oversizedVendor = vendor.filter((asset) => asset.bytes > limits.maxVendorChunkBytes);
const applicationBytes = application.reduce((sum, asset) => sum + asset.bytes, 0);
const total = javascript.reduce((sum, asset) => sum + asset.bytes, 0);

let failed = false;
if (vendor.length === 0) {
  console.error('No three-*.js vendor chunk was found; check build.rollupOptions.output.manualChunks.');
  failed = true;
}
for (const asset of oversizedVendor) {
  console.error(`Vendor chunk ${asset.file} is ${asset.bytes} bytes (limit ${limits.maxVendorChunkBytes}).`);
  failed = true;
}
if (applicationBytes > limits.maxApplicationJavaScriptBytes) {
  console.error(`Application JavaScript is ${applicationBytes} bytes (limit ${limits.maxApplicationJavaScriptBytes}).`);
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `Bundle budget passed: ${javascript.length} chunks, application ${applicationBytes} bytes, total ${total} bytes.`,
  );
}
