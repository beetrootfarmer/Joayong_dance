"use client";

import { useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import styles from "./page.module.css";
import {
  DEFAULT_GREEN_RANGE,
  DwellTracker,
  GreenRange,
  calibrateGreenRange,
  keyOutGreen,
} from "@/lib/gesture";
import { CursorSmoother, Cursor, REACH_BOX, createHandLandmarker } from "@/lib/handTracker";

type Song = { id: string; title: string; thumbnail: string | null };

const STAGE_W = 1280;
const STAGE_H = 720;
const PAGE_SIZE = 4;

const CARD_DWELL_MS = 1800;
const ARROW_DWELL_MS = 1000; // 넘기기는 되돌릴 수 있는 동작이라 짧게
// 커서가 버튼 위에 있는 정도를 프레임 간 평활(0~1)해서 DwellTracker에 넣음.
// 경계에서 커서가 살짝 떨리거나 손 인식이 한두 프레임 끊겨도 진행률이 리셋되지 않게 함.
const HOVER_SMOOTHING = 0.35;
const SELECT_LOCK_MS = 5000; // 곡 확정 후 OBS가 댄스 화면으로 넘어가는 동안 추가 입력 무시
const GESTURE_TIMEOUT_MS = 8000; // 손이 보이는데 이만큼 아무 진행이 없으면 운영자 안내

// 참여자 실루엣(그린 배경 제거) 표시. 처리 해상도는 낮게 잡고 화면 크기로 늘려 그림.
const SILHOUETTE_ALPHA = 0.45;
const SIL_W = 320;
const SIL_H = 180;

// 제스처 판정에 쓸 카메라 이름(일부만 일치해도 됨). 크로마키 카메라는 OBS가 이미 열고 있어서
// 직접 못 열므로, OBS 가상 카메라(출력: 필터 없는 카메라 소스)를 받아 씀. 빈 값이면 기본 카메라.
const CAMERA_LABEL = process.env.NEXT_PUBLIC_CAMERA_LABEL ?? "OBS Virtual Camera";
const CAMERA_CONSTRAINTS = { width: 1280, height: 720 };

async function findCamera(): Promise<{ target?: MediaDeviceInfo; labels: string[] }> {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  return {
    target: inputs.find((d) => d.label.includes(CAMERA_LABEL)),
    labels: inputs.map((d) => d.label),
  };
}

async function openCamera(): Promise<MediaStream> {
  const defaultCamera = () => navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS, audio: false });
  if (!CAMERA_LABEL) return defaultCamera();

  let { target, labels } = await findCamera();
  if (!target && labels.every((l) => !l)) {
    // 권한을 받기 전에는 장치 이름이 비어 있음 → 기본 카메라로 권한만 받고 다시 찾음.
    // 기본 카메라가 OBS가 쥔 크로마키 카메라라 열기에 실패해도 권한은 생겼을 수 있으니 계속 진행
    const probe = await defaultCamera().catch(() => null);
    probe?.getTracks().forEach((t) => t.stop());
    ({ target, labels } = await findCamera());
  }
  if (!target) {
    throw new Error(`"${CAMERA_LABEL}" 카메라 없음 (발견: ${labels.filter(Boolean).join(", ") || "없음"})`);
  }
  return navigator.mediaDevices.getUserMedia({
    video: { ...CAMERA_CONSTRAINTS, deviceId: { exact: target.deviceId } },
    audio: false,
  });
}

// 그린 판정 보정 단축키 (실루엣 배경 제거용). 설치 시 1회용이라 OBS 전역 단축키가 아니라 이 페이지에서 받음
// (키오스크 창 또는 OBS Browser Source "상호작용" 창에 포커스된 상태에서 입력).
// Shift 조합으로 두어 오입력을 막음.
const CALIBRATE_KEY = "C"; // Shift+C: 카메라 앞을 비운 상태에서 현재 그린스크린으로 보정
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

async function postCommand(action: string, songId?: string) {
  await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, song_id: songId }),
  });
}

// 화면 표시용 오류 문구. 스크립트 로드 실패는 Error가 아니라 Event로 오고, 카메라 거부는 DOMException으로 옴.
function describeError(err: unknown): string {
  if (err instanceof Event) {
    const src = (err.target as HTMLScriptElement | null)?.src;
    return src ? `파일을 불러오지 못함 (${src})` : `이벤트 오류 (${err.type})`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

// 손으로 고를 수 있는 대상: "song:<id>", "prev", "next"
type TargetState = { tracker: DwellTracker; hover: number };
const PREV = "prev";
const NEXT = "next";
const SONG_PREFIX = "song:";

function drawCursor(ctx: CanvasRenderingContext2D, c: Cursor, progress: number) {
  const x = c.x * STAGE_W;
  const y = c.y * STAGE_H;
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#1576d1";
  ctx.stroke();
  if (progress > 0) {
    ctx.beginPath();
    ctx.arc(x, y, 36, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#ffd93b";
    ctx.stroke();
  }
}

export default function GestureSelectPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [songs, setSongs] = useState<Song[]>([]);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [handStatus, setHandStatus] = useState<string | null>("손 인식 준비 중…");

  // rAF 루프에서 읽는 값은 ref로 (렌더마다 루프를 다시 만들지 않기 위해)
  const songsRef = useRef<Song[]>([]);
  songsRef.current = songs;
  const pageRef = useRef(0);
  pageRef.current = page;
  const targetElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const targetStatesRef = useRef<Map<string, TargetState>>(new Map());
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const cursorsRef = useRef<Cursor[]>([]);
  const mouseRef = useRef<Cursor | null>(null);
  const greenRangeRef = useRef<GreenRange>(DEFAULT_GREEN_RANGE);
  const calibrateRequestedRef = useRef(false);

  const pageCount = Math.max(1, Math.ceil(songs.length / PAGE_SIZE));
  const visibleSongs = songs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const showNotice = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((cur) => (cur === text ? null : cur)), NOTICE_MS);
  };

  const targetRef = (id: string) => (el: HTMLElement | null) => {
    if (el) targetElsRef.current.set(id, el);
    else targetElsRef.current.delete(id);
  };

  // 1280×720 무대를 창 크기에 맞춤 (OBS Browser Source 크기를 바꿔도 비율 유지)
  useEffect(() => {
    const fitStage = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
      const left = (window.innerWidth - STAGE_W * scale) / 2;
      const top = (window.innerHeight - STAGE_H * scale) / 2;
      stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    };
    fitStage();
    window.addEventListener("resize", fitStage);
    return () => window.removeEventListener("resize", fitStage);
  }, []);

  useEffect(() => {
    greenRangeRef.current = loadGreenRange();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.repeat) return;
      const key = e.key.toUpperCase();
      if (key === CALIBRATE_KEY) {
        calibrateRequestedRef.current = true;
      } else if (key === RESET_CALIBRATION_KEY) {
        greenRangeRef.current = DEFAULT_GREEN_RANGE;
        saveGreenRange(null);
        showNotice("그린 판정: 기본값으로 초기화");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 테스트용: 주소 끝에 ?mouse=1 을 붙이면 마우스 포인터도 손 커서처럼 동작
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mouse") !== "1") return;
    const stage = stageRef.current;
    if (!stage) return;
    const onMove = (e: MouseEvent) => {
      const r = stage.getBoundingClientRect();
      mouseRef.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    const onLeave = () => {
      mouseRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  useEffect(() => {
    fetch("/api/songs")
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.songs)) throw new Error(data.error ?? "invalid songs response");
        setSongs(data.songs);
      })
      .catch((err) => {
        console.error("songs load failed", err);
        setNotice("곡 목록을 불러오지 못했습니다 (songs.json 확인)");
      });
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    openCamera()
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
        }
      })
      .catch((err) => {
        // OBS Browser Source가 getUserMedia를 거부하는 경우도 여기서 감지됨
        // (OBS를 --enable-media-stream 으로 실행하거나, 별도 브라우저 키오스크 창으로 대체).
        console.error("camera access failed", describeError(err));
        setCameraError(`카메라 열기 실패: ${describeError(err)}`);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    createHandLandmarker()
      .then((lm) => {
        if (cancelled) {
          lm.close();
          return;
        }
        landmarkerRef.current = lm;
        setHandStatus(null);
      })
      .catch((err) => {
        console.error("hand landmarker load failed", describeError(err));
        setHandStatus(`손 인식을 불러오지 못했습니다: ${describeError(err)}`);
      });
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const silCanvas = document.createElement("canvas");
    silCanvas.width = SIL_W;
    silCanvas.height = SIL_H;
    const silCtx = silCanvas.getContext("2d", { willReadFrequently: true });
    const smoother = new CursorSmoother();
    let lastVideoTime = -1;
    let lockedUntil = 0;
    let lastActiveAt = performance.now();
    let helpShown = false;
    let raf = 0;

    const stateFor = (id: string): TargetState => {
      let s = targetStatesRef.current.get(id);
      if (!s) {
        const dwell = id.startsWith(SONG_PREFIX) ? CARD_DWELL_MS : ARROW_DWELL_MS;
        s = { tracker: new DwellTracker(dwell), hover: 0 };
        targetStatesRef.current.set(id, s);
      }
      return s;
    };

    const onComplete = (id: string, now: number) => {
      const pages = Math.max(1, Math.ceil(songsRef.current.length / PAGE_SIZE));
      if (id === PREV) {
        setPage((pageRef.current - 1 + pages) % pages);
      } else if (id === NEXT) {
        setPage((pageRef.current + 1) % pages);
      } else if (id.startsWith(SONG_PREFIX)) {
        const songId = id.slice(SONG_PREFIX.length);
        // 선택 확정 = 곧바로 카운트다운→재생. 세션 진행 중 재선택은 obs-script가 막음.
        postCommand("play_song", songId).catch((err) => console.error("command failed", err));
        lockedUntil = now + SELECT_LOCK_MS;
        setSelectedId(songId);
        setTimeout(() => setSelectedId(null), SELECT_LOCK_MS);
      }
    };

    const drawSilhouette = (ctx: CanvasRenderingContext2D, video: HTMLVideoElement) => {
      if (!silCtx) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      // REACH_BOX는 반전 후 좌표 → 원본에서 자를 x 시작점은 1 - (x + w)
      silCtx.save();
      silCtx.translate(SIL_W, 0);
      silCtx.scale(-1, 1);
      silCtx.drawImage(
        video,
        (1 - REACH_BOX.x - REACH_BOX.w) * vw,
        REACH_BOX.y * vh,
        REACH_BOX.w * vw,
        REACH_BOX.h * vh,
        0,
        0,
        SIL_W,
        SIL_H
      );
      silCtx.restore();

      if (calibrateRequestedRef.current) {
        calibrateRequestedRef.current = false;
        const range = calibrateGreenRange(silCtx, [{ x: 0, y: 0, w: SIL_W, h: SIL_H }]);
        if (range) {
          greenRangeRef.current = range;
          saveGreenRange(range);
          showNotice(
            `그린 판정 보정 완료: H ${range.hMin.toFixed(0)}~${range.hMax.toFixed(0)}°, S≥${range.sMin.toFixed(2)}, V≥${range.vMin.toFixed(2)}`
          );
        } else {
          showNotice("보정 실패: 카메라 앞을 비우고 다시 시도하세요");
        }
      }

      const image = silCtx.getImageData(0, 0, SIL_W, SIL_H);
      keyOutGreen(image, greenRangeRef.current);
      silCtx.putImageData(image, 0, 0);
      ctx.globalAlpha = SILHOUETTE_ALPHA;
      ctx.drawImage(silCanvas, 0, 0, STAGE_W, STAGE_H);
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      const video = videoRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !stage || !ctx) return;

      const now = performance.now();
      const videoReady = !!video && video.readyState >= 2 && video.videoWidth > 0;

      // 1. 손 인식 (새 프레임이 들어왔을 때만)
      const landmarker = landmarkerRef.current;
      if (videoReady && landmarker && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        try {
          cursorsRef.current = smoother.update(landmarker.detectForVideo(video, now).landmarks);
        } catch (err) {
          // 프레임 하나 실패로 루프 전체가 멈추지 않게
          console.error("hand detection failed", err);
        }
      }
      const cursors = mouseRef.current ? [...cursorsRef.current, mouseRef.current] : cursorsRef.current;

      // 2. 실루엣
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      if (videoReady) drawSilhouette(ctx, video);

      // 3. 커서 ↔ 버튼 판정
      const stageRect = stage.getBoundingClientRect();
      const scale = stageRect.width / STAGE_W;
      const locked = now < lockedUntil;
      const cursorProgress = cursors.map(() => 0);
      let anyProgress = false;

      for (const [id, el] of targetElsRef.current) {
        const r = el.getBoundingClientRect();
        const left = (r.left - stageRect.left) / scale;
        const top = (r.top - stageRect.top) / scale;
        const right = left + r.width / scale;
        const bottom = top + r.height / scale;
        const hit = cursors.findIndex((c) => {
          const x = c.x * STAGE_W;
          const y = c.y * STAGE_H;
          return x >= left && x <= right && y >= top && y <= bottom;
        });

        const state = stateFor(id);
        state.hover += ((hit >= 0 ? 1 : 0) - state.hover) * HOVER_SMOOTHING;
        const { progress, completed } = locked
          ? { progress: 0, completed: false }
          : state.tracker.tick(state.hover, now);

        el.dataset.hover = hit >= 0 && !locked ? "1" : "0";
        el.style.setProperty("--progress", String(progress));
        if (progress > 0) {
          anyProgress = true;
          if (hit >= 0) cursorProgress[hit] = Math.max(cursorProgress[hit], progress);
        }
        if (completed) onComplete(id, now);
      }

      // 4. 손 커서
      cursors.forEach((c, i) => drawCursor(ctx, c, cursorProgress[i]));

      // 5. 손이 보이는데 한참 진행이 없으면 운영자 안내 (아무도 없을 때는 띄우지 않음)
      if (anyProgress || locked || cursors.length === 0) lastActiveAt = now;
      const help = now - lastActiveAt > GESTURE_TIMEOUT_MS;
      if (help !== helpShown) {
        helpShown = help;
        setShowHelp(help);
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={styles.viewport}>
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.tab}>곡 선택</div>
        <div className={styles.panel}>
          {pageCount > 1 && (
            <div ref={targetRef(PREV)} className={`${styles.arrow} ${styles.arrowPrev}`}>
              <div className={styles.triangle} />
            </div>
          )}

          <div className={styles.cards}>
            {visibleSongs.map((song) => (
              <div key={song.id} ref={targetRef(SONG_PREFIX + song.id)} className={styles.card}>
                {song.thumbnail && <img className={styles.thumb} src={song.thumbnail} alt="" />}
                <div className={styles.label}>{song.title}</div>
                <div className={styles.progress} />
                {selectedId === song.id && <div className={styles.selected}>곧 시작해요!</div>}
              </div>
            ))}
            {/* 마지막 페이지가 덜 차도 카드 위치가 바뀌지 않게 빈 칸 유지 */}
            {Array.from({ length: PAGE_SIZE - visibleSongs.length }, (_, i) => (
              <div key={`empty-${i}`} className={styles.cardEmpty} />
            ))}
          </div>

          {pageCount > 1 && (
            <div ref={targetRef(NEXT)} className={`${styles.arrow} ${styles.arrowNext}`}>
              <div className={styles.triangle} />
            </div>
          )}

          {pageCount > 1 && (
            <div className={styles.dots}>
              {Array.from({ length: pageCount }, (_, i) => (
                <div key={i} className={i === page ? styles.dotActive : styles.dot} />
              ))}
            </div>
          )}
          <div className={styles.hint}>손을 원하는 곡 위에 잠시 올려 두세요</div>
        </div>

        <canvas ref={canvasRef} className={styles.overlay} width={STAGE_W} height={STAGE_H} />

        {showHelp && <div className={styles.help}>운영자에게 말씀해주세요</div>}
        {notice && <div className={styles.notice}>{notice}</div>}
        {(cameraError || handStatus) && (
          <div className={styles.status}>{[cameraError, handStatus].filter(Boolean).join(" / ")}</div>
        )}
      </div>
      <video ref={videoRef} style={{ display: "none" }} muted playsInline />
    </div>
  );
}
