// 곡선택/시작 버튼의 dwell(호버 유지) 판정 로직.
// 1차 구현은 픽셀 카운팅(그린스크린 HSV 판정). 팀에 기존 검증된 MediaPipe 구현이 있다면
// sampleForegroundRatio()만 교체하면 됩니다 (호출부는 그대로 재사용 가능).

export type ButtonRect = {
  id: string;
  label: string;
  // 0~1 사이 비율 좌표. 화면 해상도에 무관하게 동작.
  x: number;
  y: number;
  w: number;
  h: number;
};

// 히스테리시스: 두 임계값을 써서 경계에서 깜빡이는 것을 방지.
export const ENTER_THRESHOLD = 0.55;
export const EXIT_THRESHOLD = 0.4;
export const DWELL_MS = 1800;

// 그린스크린(배경) 판정용 HSV 범위. h는 0~360도, s·v는 0~1.
// RGB 절대값(g > 90) 대신 HSV를 쓰는 이유: 그림자·주름 진 그린스크린은 밝기(V)만 떨어지고
// 색상(H)은 유지되므로, 어두운 초록도 배경으로 판정되어 오발동이 줄어든다.
// 자세한 배경은 docs/gesture-detection.md 참고.
export type GreenRange = {
  hMin: number;
  hMax: number;
  sMin: number; // 이보다 채도가 낮으면(회색·흰색·피부) 전경
  vMin: number; // 이보다 어두우면 색상이 불안정하므로 전경
};

// TODO: 현장 그린스크린·조명 기준으로 calibrateGreenRange() 결과로 교체 (현장 검증 단계).
export const DEFAULT_GREEN_RANGE: GreenRange = {
  hMin: 80,
  hMax: 160,
  sMin: 0.25,
  vMin: 0.15,
};

// r,g,b(0~255) → h(0~360), s(0~1), v(0~1)
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : d / max;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

function isGreenPixel(r: number, g: number, b: number, range: GreenRange): boolean {
  const [h, s, v] = rgbToHsv(r, g, b);
  return h >= range.hMin && h <= range.hMax && s >= range.sMin && v >= range.vMin;
}

/**
 * 버튼 영역 안에서 "전경(사람)" 픽셀 비율을 계산.
 * 그린스크린을 이미 쓰고 있으므로, 그린 범위(HSV)에 속하지 않는 픽셀 = 전경으로 간주.
 */
export function sampleForegroundRatio(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  range: GreenRange = DEFAULT_GREEN_RANGE
): number {
  const { data } = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  let foreground = 0;
  const total = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    if (!isGreenPixel(data[i], data[i + 1], data[i + 2], range)) foreground++;
  }

  return total === 0 ? 0 : foreground / total;
}

/**
 * 설치 시 보정용: 버튼 영역이 비어 있는(그린스크린만 보이는) 상태에서 호출해
 * 현장 그린스크린 색에 맞는 HSV 범위를 만든다.
 * 색상은 평균 ± 3σ(최소 ±20도), 채도·밝기 하한은 관측 하위 2% 값에 여유를 둔다.
 * 아직 page.tsx에 연결하지 않음 — 보정 UI(운영자 단축키 등)와 함께 붙일 예정.
 */
export function calibrateGreenRange(
  ctx: CanvasRenderingContext2D,
  rects: { x: number; y: number; w: number; h: number }[]
): GreenRange {
  const hs: number[] = [];
  const ss: number[] = [];
  const vs: number[] = [];

  for (const rect of rects) {
    const { data } = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      hs.push(h);
      ss.push(s);
      vs.push(v);
    }
  }

  if (hs.length === 0) return DEFAULT_GREEN_RANGE;

  const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
  const std = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
  const spread = Math.max(20, 3 * std);
  const p2 = (arr: number[]) => arr.sort((a, b) => a - b)[Math.floor(arr.length * 0.02)];

  return {
    hMin: Math.max(0, mean - spread),
    hMax: Math.min(360, mean + spread),
    sMin: Math.max(0.1, p2(ss) * 0.8),
    vMin: Math.max(0.08, p2(vs) * 0.8),
  };
}

export class DwellTracker {
  private progress = 0; // 0~1
  private charging = false;
  private startedAt = 0;
  // 완료 직후에는 잠금. 손을 완전히 뗐다가(EXIT_THRESHOLD 아래) 다시 올려야
  // 재시작 가능 — 손을 계속 얹고 있다고 같은 버튼이 반복 완료되는 것을 막음.
  private armed = true;

  tick(ratio: number, now: number): { progress: number; completed: boolean } {
    if (!this.armed) {
      if (ratio < EXIT_THRESHOLD) this.armed = true;
      return { progress: 0, completed: false };
    }

    if (!this.charging && ratio >= ENTER_THRESHOLD) {
      this.charging = true;
      this.startedAt = now;
    } else if (this.charging && ratio < EXIT_THRESHOLD) {
      this.charging = false;
      this.progress = 0;
    }

    if (this.charging) {
      this.progress = Math.min(1, (now - this.startedAt) / DWELL_MS);
    }

    const completed = this.progress >= 1;
    if (completed) {
      this.charging = false;
      this.progress = 0;
      this.armed = false;
    }

    return { progress: this.progress, completed };
  }
}
