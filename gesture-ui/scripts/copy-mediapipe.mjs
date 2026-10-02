// MediaPipe WASM 런타임을 public/으로 복사 — 부스 PC에서 CDN 없이 로컬로 서빙하기 위함.
// predev/prebuild에서 자동 실행. 복사본은 .gitignore 대상 (node_modules에서 언제든 다시 만들 수 있음).
// 전부 복사하는 이유: MediaPipe가 브라우저의 WASM SIMD 지원 여부를 보고 파일을 고름
// (지원 안 하면 *_nosimd_*). OBS Browser Source(CEF)는 nosimd 쪽을 요청함.
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.resolve("node_modules/@mediapipe/tasks-vision/wasm");
const dest = path.resolve("public/mediapipe/wasm");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-mediapipe] ${src} -> ${dest}`);
