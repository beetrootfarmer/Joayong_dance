// 곡선택/시작 버튼의 dwell(호버 유지) 판정 로직.
// 1차 구현은 픽셀 카운팅. 팀에 기존 검증된 MediaPipe 구현이 있다면
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

/**
 * 버튼 영역 안에서 "전경(사람)" 픽셀 비율을 계산.
 * 그린스크린을 이미 쓰고 있으므로, 그린 범위에 속하지 않는 픽셀 = 전경으로 간주.
 * TODO: 실제 그린스크린 색상/조명에 맞게 임계값 튜닝 필요 (현장 검증 단계).
 */
export function sampleForegroundRatio(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number }
): number {
  const { data } = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  let foreground = 0;
  const total = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 아주 단순한 그린 판정: 초록이 빨강/파랑보다 확연히 크면 배경으로 간주.
    const isGreenish = g > 90 && g > r * 1.4 && g > b * 1.4;
    if (!isGreenish) foreground++;
  }

  return total === 0 ? 0 : foreground / total;
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
