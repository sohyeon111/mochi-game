// node_modules의 MediaPipe wasm을 public/mediapipe/wasm 으로 복사한다 (외부 CDN 의존 없이 자체 포함).
// wasm은 용량이 커서 Git에 올리지 않고(.gitignore) dev/build 전에 항상 복사한다.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dst = resolve(root, 'public/mediapipe/wasm');

if (!existsSync(src)) {
  console.error('MediaPipe wasm을 찾을 수 없습니다. `npm install`을 먼저 실행하세요:', src);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
// Worker(public/mediapipe/face-worker.js)가 importScripts로 읽는 IIFE 번들(전역 Vision)도 함께 복사한다
cpSync(resolve(root, 'node_modules/@mediapipe/tasks-vision/vision_bundle.js'), resolve(root, 'public/mediapipe/vision_bundle.js'));
console.log('MediaPipe wasm·번들 복사 완료 →', dst);
