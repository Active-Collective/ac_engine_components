import { mkdir, copyFile } from 'fs/promises';
import path from 'path';

async function copyWasm() {
  const src = path.resolve('node_modules/web-ifc/web-ifc.wasm');
  const destDir = path.resolve('packages/viewer/public/wasm');
  const dest = path.join(destDir, 'web-ifc.wasm');
  try {
    await mkdir(destDir, { recursive: true });
    await copyFile(src, dest);
    console.log(`Copied ${src} to ${dest}`);
  } catch (err) {
    console.error('Failed to copy web-ifc.wasm:', err);
    process.exit(1);
  }
}

copyWasm();
