# obs-script

OBS 안에서 직접 도는 제어 스크립트입니다. 별도 프로세스나 소켓 서버가 아닙니다.

## 설치

1. OBS Studio > Tools > Scripts
2. Python 인터프리터 경로가 설정되어 있지 않다면 "Python Settings" 탭에서 지정 (OBS가 지원하는 Python 버전 확인 필요)
3. "+" 버튼으로 `joayong_control.py` 추가
4. 스크립트 속성 패널에서 다음 값을 채움:
   - `songs.json 경로`: `obs-script/songs.json` (또는 배포 시 절대경로)
   - `command.json 경로`: `../runtime/command.json` (gesture-ui와 공유하는 경로, 저장소 루트 `runtime/` 참고)
   - `세션 로그 경로`: 원하는 `.jsonl` 파일 경로
   - 씬 이름 2개(`대기`, `댄스`), 소스 이름 4개(미디어, 제목, 카운트다운, 상태)를 OBS에 실제로 만든 이름과 동일하게 입력

## OBS 씬/소스 준비 (스크립트가 기대하는 이름)

- 씬: 대기 씬, 댄스 씬 (씬 이름은 속성 패널에서 자유롭게 지정 가능)
- 댄스 씬 안에 미디어 소스(로컬 비디오 파일) 1개
- 오버레이용 텍스트(GDI+/FreeType2) 소스 3개: 곡 제목, 카운트다운, 상태

## 단축키

OBS Settings > Hotkeys 에서 `조아용:` 으로 시작하는 항목을 원하는 물리 키에 매핑하세요. 곡 선택은 1~9번 슬롯이 고정 등록되어 있습니다 (songs.json에 정의된 id와 일치시킬 것).

## 아직 안 된 것 (다음 단계)

- 오디오 트랙별 음소거 설정 (유튜브 송출 트랙 vs 부스 스피커 트랙) — OBS Advanced Audio Properties에서 1회 수동 설정 권장, 스크립트로 자동화하지 않음
- 재연결/에러 복구는 별도로 없음 — OBS 프로세스가 곧 이 스크립트의 생명주기이므로, OBS가 살아있는 한 상태는 항상 유지됨
- `countdown_tick`/`return_to_idle_once` 타이머는 매 세션마다 add/remove 되므로, 연속 운영 시험(§7 6단계)에서 타이머 누적/leak 여부를 반드시 확인할 것
