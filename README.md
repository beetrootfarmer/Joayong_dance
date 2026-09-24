# 춤추자! 조아용~ — 크로마키 실시간 합성·송출 체험

기획안: [`docs/기획안_v2.md`](docs/기획안_v2.md) (v1은 `조아용_크로마키_체험_기획안.pdf`)

## 구조

```
obs-script/     OBS 안에서 직접 도는 제어 스크립트 (Python, obspython). 소켓/서버 아님.
gesture-ui/     곡선택·시작 화면 (Next.js). OBS Browser Source로 표시.
runtime/        위 둘이 소켓 없이 상태를 주고받는 공유 파일 (command.json)
docs/           기획안, 설계 문서
```

## 아키텍처 한 줄 요약

OBS 프로세스 안에서 `obs-script`가 상태·씬전환·로그를 전부 관리합니다. `gesture-ui`는 곡선택 화면 표시와
카메라 기반 dwell 판정만 담당하고, 선택이 확정될 때만 `runtime/command.json`에 한 번 기록합니다. 서버는
`gesture-ui`(상태 없는 정적 서버) 하나뿐이며, 이게 죽어도 진행 상태·카운트다운·로그는 영향받지 않고
운영자가 단축키로 바로 우회할 수 있습니다.

자세한 설계 판단 근거는 `docs/기획안_v2.md`의 3장을 참고하세요.

## 시작하기

```bash
# 1. OBS 쪽
#    obs-script/README.md 참고 — OBS Scripts 패널에 joayong_control.py 로드

# 2. 곡선택 화면
cd gesture-ui
npm install
npm run dev
```

## 다음 단계 (기술 검증, 기획안 §7-1)

- [ ] obspython으로 영상 교체·재생·`media_ended` 감지가 의도대로 동작하는지 확인
- [ ] OBS Browser Source에서 `getUserMedia`(카메라) 접근이 되는지 확인 — 안 되면 별도 브라우저 키오스크 창으로 전환
- [ ] 전용 웹캠으로 픽셀 카운팅 dwell 프로토타입이 현장 조명에서 안정적인지 확인
