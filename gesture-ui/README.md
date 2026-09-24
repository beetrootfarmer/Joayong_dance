# gesture-ui

곡선택/시작 화면. OBS의 Browser Source로 열거나(권장, 카메라 접근 안 되면 대체 필요),
현장에서 검증 안 되면 별도 브라우저 키오스크 창으로 띄웁니다.

## 실행

```bash
npm install
cp .env.local.example .env.local   # COMMAND_FILE_PATH 확인
npm run dev
```

`http://localhost:3000` 을 OBS Browser Source URL로 등록하거나, 키오스크 모드 브라우저로 엽니다.

## 구조

- `app/page.tsx` — 카메라 프리뷰(좌우 반전) + 버튼 dwell 판정 + 진행률 표시
- `lib/gesture.ts` — 픽셀 카운팅 기반 dwell 로직. **기존에 검증된 MediaPipe 구현이 있다면
  `sampleForegroundRatio()`만 교체**하면 나머지(히스테리시스, 타임아웃, 커맨드 전송)는 그대로 재사용 가능
- `app/api/command/route.ts` — 선택 확정 시 `../runtime/command.json`에 1회 기록 (obs-script가 폴링)

## 아직 안 된 것 (다음 단계)

- `SONGS` 하드코딩 목록을 `obs-script/songs.json`과 동기화 (지금은 수동 유지)
- 버튼 좌표(`x/y/w/h`)는 임시값 — 현장 화면 크기·거리 기준으로 재조정 필요
- OBS Browser Source에서 `getUserMedia` 동작 여부 미검증 (기술검증 단계 §7-1)
- 다인원 프레임 처리(대표 1인 안내)는 UI가 아니라 운영 절차(바닥 표시)로 해결하는 것을 전제로 함
