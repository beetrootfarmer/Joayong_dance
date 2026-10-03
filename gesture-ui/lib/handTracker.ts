// MediaPipe 손 인식 → 화면 커서 좌표.
// WASM 런타임은 public/mediapipe/wasm (scripts/copy-mediapipe.mjs가 복사), 모델은 아래 URL에서 받음.
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

const WASM_BASE = "/mediapipe/wasm";
const HAND_MODEL_URL =
  process.env.NEXT_PUBLIC_HAND_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * 카메라 화면(좌우 반전 후, 0~1 비율)에서 참여자 손이 실제로 닿는 범위.
 * 이 상자를 화면 전체로 확대해 커서로 쓰고, 실루엣도 같은 상자를 잘라 그려서 손과 커서가 겹쳐 보이게 함.
 * 크로마키 카메라는 전신을 찍으므로 손은 화면 가운데 일부에서만 움직임 — 현장에서 카메라 거리에 맞춰 조정.
 * 카메라와 화면이 둘 다 16:9라서 w와 h를 같게 둬야 실루엣이 찌그러지지 않음.
 */
export const REACH_BOX = { x: 0.18, y: 0.08, w: 0.64, h: 0.64 };

export type Cursor = { x: number; y: number }; // 화면 기준 0~1

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const create = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
    });
  try {
    return await create("GPU");
  } catch {
    // OBS Browser Source 등 WebGL을 못 쓰는 환경
    return create("CPU");
  }
}

// 손바닥 중심(손목·검지/중지/새끼 뿌리 평균). 손가락 모양(주먹·손바닥·가리키기)과 무관하게 안정적.
const PALM_POINTS = [0, 5, 9, 17];

function palmCenter(hand: NormalizedLandmark[]): Cursor {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 카메라 원본 좌표(반전 전) → 화면 커서 좌표. 좌우 반전 + REACH_BOX 확대. */
export function cameraToScreen(p: Cursor): Cursor {
  const mirroredX = 1 - p.x;
  return {
    x: clamp01((mirroredX - REACH_BOX.x) / REACH_BOX.w),
    y: clamp01((p.y - REACH_BOX.y) / REACH_BOX.h),
  };
}

const SMOOTHING = 0.45; // 0~1, 클수록 새 위치를 빨리 따라감 (작을수록 떨림↓ 반응↓)
const MATCH_DISTANCE = 0.25; // 이전 프레임 커서와 이 거리 안이면 같은 손으로 보고 평활

/**
 * 손 인식 결과를 커서로 바꾸면서 프레임 간 떨림을 줄임.
 * 손 순서가 프레임마다 바뀔 수 있어서, 이전 커서 중 가장 가까운 것과 짝지어 평활함.
 */
export class CursorSmoother {
  private prev: Cursor[] = [];

  update(hands: NormalizedLandmark[][]): Cursor[] {
    const next = hands.map((hand) => {
      const raw = cameraToScreen(palmCenter(hand));
      let best: Cursor | undefined;
      let bestDist = MATCH_DISTANCE;
      for (const p of this.prev) {
        const d = Math.hypot(p.x - raw.x, p.y - raw.y);
        if (d < bestDist) {
          best = p;
          bestDist = d;
        }
      }
      if (!best) return raw;
      return {
        x: best.x + (raw.x - best.x) * SMOOTHING,
        y: best.y + (raw.y - best.y) * SMOOTHING,
      };
    });
    this.prev = next;
    return next;
  }
}
