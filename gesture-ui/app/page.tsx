"use client";

import { useEffect, useRef, useState } from "react";
import {
  ButtonRect,
  DwellTracker,
  sampleForegroundRatio,
} from "@/lib/gesture";

// TODO: songs.json (obs-script와 공유) 내용과 맞춰서 채우거나, 별도 API로 fetch.
const SONGS = [
  { id: "1", title: "샘플 곡 1" },
  { id: "2", title: "샘플 곡 2" },
];

const GESTURE_TIMEOUT_MS = 8000;

function songButtons(): ButtonRect[] {
  return SONGS.map((song, i) => ({
    id: song.id,
    label: song.title,
    x: 0.1,
    y: 0.15 + i * 0.3,
    w: 0.35,
    h: 0.2,
  }));
}

const START_BUTTON: ButtonRect = {
  id: "start",
  label: "시작",
  x: 0.325,
  y: 0.4,
  w: 0.35,
  h: 0.2,
};

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
  const [mode, setMode] = useState<"songs" | "start">("songs");
  const modeRef = useRef(mode);
  modeRef.current = mode;

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

      const buttons = modeRef.current === "songs" ? songButtons() : [START_BUTTON];
      const now = Date.now();
      let anyProgress = false;

      for (const btn of buttons) {
        const rect = {
          x: Math.round(btn.x * w),
          y: Math.round(btn.y * h),
          w: Math.round(btn.w * w),
          h: Math.round(btn.h * h),
        };

        const ratio = sampleForegroundRatio(ctx, rect);

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
          if (modeRef.current === "songs") {
            postCommand("select_song", btn.id);
            setMode("start");
          } else {
            postCommand("start");
          }
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
