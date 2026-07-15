import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const limits = {
  maxJavaScriptChunkBytes: 525 * 1024,
  maxTotalJavaScriptBytes: 850 * 1024,
};

const files = await readdir(assetsDirectory);
const javascript = await Promise.all(
  files
    .filter((file) => file.endsWith('.js'))
    .map(async (file) => ({ file, bytes: (await stat(join(assetsDirectory.pathname, file))).size })),
);

const oversized = javascript.filter((asset) => asset.bytes > limits.maxJavaScriptChunkBytes);
const total = javascript.reduce((sum, asset) => sum + asset.bytes, 0);

if (oversized.length > 0 || total > limits.maxTotalJavaScriptBytes) {
  for (const asset of oversized) {
    console.error(`Bundle chunk ${asset.file} is ${asset.bytes} bytes (limit ${limits.maxJavaScriptChunkBytes}).`);
  }
  if (total > limits.maxTotalJavaScriptBytes) {
    console.error(`Total JavaScript is ${total} bytes (limit ${limits.maxTotalJavaScriptBytes}).`);
  }
  process.exitCode = 1;
} else {
  console.log(`Bundle budget passed: ${javascript.length} chunks, ${total} total bytes.`);
}
