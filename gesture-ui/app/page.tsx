"use client";

import { useEffect, useRef } from "react";
import {
  ButtonRect,
  DEFAULT_GREEN_RANGE,
  DwellTracker,
  GreenRange,
  calibrateGreenRange,
  sampleForegroundRatio,
} from "@/lib/gesture";

type Song = { id: string; title: string };

const GESTURE_TIMEOUT_MS = 8000;

// 그린 판정 보정 단축키. 설치 시 1회용이라 OBS 전역 단축키가 아니라 이 페이지에서 받음
// (키오스크 창 또는 OBS Browser Source "상호작용" 창에 포커스된 상태에서 입력).
// Shift 조합으로 두어 오입력을 막음.
const CALIBRATE_KEY = "C"; // Shift+C: 버튼 영역을 비운 상태에서 현재 그린스크린으로 보정
const RESET_CALIBRATION_KEY = "D"; // Shift+D: 기본 범위로 되돌림
const GREEN_RANGE_STORAGE_KEY = "joayong.greenRange";
const NOTICE_MS = 3000;

function loadGreenRange(): GreenRange {
  try {
    const raw = localStorage.getItem(GREEN_RANGE_STORAGE_KEY);
    if (!raw) return DEFAULT_GREEN_RANGE;
    const r = JSON.parse(raw);
    const valid = ["hMin", "hMax", "sMin", "vMin"].every((k) => typeof r[k] === "number");
    return valid ? r : DEFAULT_GREEN_RANGE;
  } catch {
    return DEFAULT_GREEN_RANGE;
  }
}

function saveGreenRange(range: GreenRange | null) {
  try {
    if (range) localStorage.setItem(GREEN_RANGE_STORAGE_KEY, JSON.stringify(range));
    else localStorage.removeItem(GREEN_RANGE_STORAGE_KEY);
  } catch {
    // 저장 실패 시 이번 세션에서만 적용됨
  }
}

function toPixelRect(btn: ButtonRect, w: number, h: number) {
  return {
    x: Math.round(btn.x * w),
    y: Math.round(btn.y * h),
    w: Math.round(btn.w * w),
    h: Math.round(btn.h * h),
  };
}

// 버튼을 화면 좌우 가장자리 두 열에 나눠 배치. 가운데는 참여자가 서는 자리라
// 몸이 버튼을 가려 오발동하지 않도록 비워 둠 (손을 옆으로 뻗어 선택).
const COLUMN_X = [0.03, 0.72];
const BUTTON_W = 0.25;
const AREA_TOP = 0.04;
const AREA_HEIGHT = 0.92;

function songButtons(songs: Song[]): ButtonRect[] {
  const rows = Math.max(1, Math.ceil(songs.length / COLUMN_X.length));
  const rowH = AREA_HEIGHT / rows;
  return songs.map((song, i) => ({
    id: song.id,
    label: song.title,
    x: COLUMN_X[i % COLUMN_X.length],
    y: AREA_TOP + Math.floor(i / COLUMN_X.length) * rowH,
    w: BUTTON_W,
    h: rowH * 0.85,
  }));
}

async function postCommand(action: string, songId?: string) {
  await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, song_id: songId }),
  });
}

export default function GestureSelectPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackersRef = useRef<Map<string, DwellTracker>>(new Map());
  const lastProgressAtRef = useRef<number>(Date.now());
  const songsRef = useRef<Song[]>([]);
  const greenRangeRef = useRef<GreenRange>(DEFAULT_GREEN_RANGE);
  const calibrateRequestedRef = useRef(false);
  const noticeRef = useRef<{ text: string; until: number } | null>(null);

  useEffect(() => {
    greenRangeRef.current = loadGreenRange();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.repeat) return;
      const key = e.key.toUpperCase();
      if (key === CALIBRATE_KEY) {
        // 버튼을 그리기 전 프레임에서 샘플링해야 하므로 루프에 요청만 넘김
        calibrateRequestedRef.current = true;
      } else if (key === RESET_CALIBRATION_KEY) {
        greenRangeRef.current = DEFAULT_GREEN_RANGE;
        saveGreenRange(null);
        noticeRef.current = { text: "그린 판정: 기본값으로 초기화", until: Date.now() + NOTICE_MS };
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    fetch("/api/songs")
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.songs)) throw new Error(data.error ?? "invalid songs response");
        songsRef.current = data.songs;
      })
      .catch((err) => {
        console.error("songs load failed", err);
        noticeRef.current = { text: "곡 목록을 불러오지 못했습니다 (songs.json 확인)", until: Infinity };
      });
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
        }
      })
      .catch((err) => {
        // TODO: OBS Browser Source가 getUserMedia를 거부하는 경우 여기서 감지됨.
        // 기술검증 단계에서 확인하고, 실패 시 별도 브라우저 키오스크 창으로 대체.
        console.error("camera access failed", err);
      });

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      // 좌우 반전해서 그리기 (필수: 참여자 동작 방향과 화면이 일치해야 함)
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();

      const now = Date.now();

      if (calibrateRequestedRef.current) {
        calibrateRequestedRef.current = false;
        // 곡 버튼 영역 전체를 기준으로 보정
        const allRects = songButtons(songsRef.current).map((b) => toPixelRect(b, w, h));
        const range = calibrateGreenRange(ctx, allRects);
        if (range) {
          greenRangeRef.current = range;
          saveGreenRange(range);
          noticeRef.current = {
            text: `그린 판정 보정 완료: H ${range.hMin.toFixed(0)}~${range.hMax.toFixed(0)}°, S≥${range.sMin.toFixed(2)}, V≥${range.vMin.toFixed(2)}`,
            until: now + NOTICE_MS,
          };
        } else {
          noticeRef.current = {
            text: "보정 실패: 버튼 영역을 비우고 다시 시도하세요",
            until: now + NOTICE_MS,
          };
        }
      }

      const buttons = songButtons(songsRef.current);
      let anyProgress = false;

      for (const btn of buttons) {
        const rect = toPixelRect(btn, w, h);

        const ratio = sampleForegroundRatio(ctx, rect, greenRangeRef.current);

        if (!trackersRef.current.has(btn.id)) {
          trackersRef.current.set(btn.id, new DwellTracker());
        }
        const tracker = trackersRef.current.get(btn.id)!;
        const { progress, completed } = tracker.tick(ratio, now);
        if (progress > 0) anyProgress = true;

        // 버튼 테두리 + 진행률 표시
        ctx.strokeStyle = "white";
        ctx.lineWidth = 4;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = "rgba(80, 200, 120, 0.6)";
        ctx.fillRect(rect.x, rect.y, rect.w * progress, rect.h);
        ctx.fillStyle = "white";
        ctx.font = "28px sans-serif";
        ctx.fillText(btn.label, rect.x + 12, rect.y + 40);

        if (completed) {
          // 완료된 트래커는 지우지 않습니다 — 지우면 새 트래커(armed=true)가 다시
          // 생겨서 손을 떼지 않아도 즉시 재충전을 시작해버립니다. 손을 뗄 때까지
          // 잠그는 건 DwellTracker 내부의 armed 플래그가 담당합니다.
          lastProgressAtRef.current = now;
          // 선택 확정 = 곧바로 카운트다운→재생. 세션 진행 중 재선택은 obs-script가 막음.
          postCommand("play_song", btn.id);
        }
      }

      if (anyProgress) lastProgressAtRef.current = now;

      if (now - lastProgressAtRef.current > GESTURE_TIMEOUT_MS) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, h - 80, w, 80);
        ctx.fillStyle = "yellow";
        ctx.font = "32px sans-serif";
        ctx.fillText("운영자에게 말씀해주세요", 24, h - 30);
      }

      const notice = noticeRef.current;
      if (notice && now < notice.until) {
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(0, 0, w, 60);
        ctx.fillStyle = "white";
        ctx.font = "24px sans-serif";
        ctx.fillText(notice.text, 24, 40);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <video ref={videoRef} style={{ display: "none" }} muted playsInline />
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
