# 새 PC 세팅 가이드 (Windows)

다른 PC(부스 송출 PC 등)에서 처음부터 띄워서 테스트하기 위한 순서입니다. 위에서부터 차례대로 따라하세요.

> 전제: 이 PC에서 **카메라 입력, 크로마키, 유튜브 송출은 이미 OBS에서 테스트 완료**된 상태. 이 문서는 그 위에
> 이 프로젝트(제어 스크립트 + 곡선택 화면)를 얹는 과정만 다룹니다.
>
> 원본 세팅 기록(macOS, 2026-09-26)은 [`obs-setup.md`](obs-setup.md) — 씬/소스 구성의 이유와 발견한 이슈가 자세히 있습니다.

## 0. 설치할 것

| 항목 | 버전 | 비고 |
|---|---|---|
| Git for Windows | 최신 | 코드 내려받기용 |
| Node.js | **18.18 이상** (LTS 22 권장) | gesture-ui(Next.js 15) 실행용. https://nodejs.org |
| Python | **64비트 3.11 권장** | OBS 스크립트용. **python.org 설치본** 사용 (Microsoft Store 버전은 OBS가 못 찾는 경우가 많음) |
| OBS Studio | 30 이상 | 이미 설치되어 있음 |
| 제스처 전용 USB 웹캠 | — | OBS 송출 카메라와 **별도 장치**. Windows는 한 카메라를 두 프로그램이 동시에 못 여는 경우가 많음 |

> OBS가 지원하는 Python 버전은 OBS 버전·OS마다 다릅니다. 3.11이 로드되지 않으면 아래 2-1의 "loaded" 문구를 보며
> 다른 3.x 버전(64비트)으로 바꿔보세요.

## 1. 코드와 파일 준비

### 1-1. 코드 내려받기

```powershell
cd C:\
git clone https://github.com/beetrootfarmer/Joayong_dance.git
cd Joayong_dance
```

이하 경로는 `C:\Joayong_dance`에 받았다고 가정합니다. 다른 곳에 받았다면 경로를 바꿔 읽으세요.

### 1-2. 댄스 영상 배치

영상은 저장소에 들어 있지 않습니다. 영상 파일을 이 PC로 복사하세요 (예: `C:\Joayong\videos\`).

### 1-3. `obs-script/songs.json` 수정

이 PC의 실제 영상 경로로 바꿉니다. **경로 구분자는 `/`(슬래시)로** 쓰세요 — JSON에서 `\`는 이스케이프 문자라 `\\`로 두 번 써야 해서 실수하기 쉽습니다.

```json
{
  "songs": [
    { "id": "1", "title": "곡 제목 1", "video_path": "C:/Joayong/videos/song1.mp4" },
    { "id": "2", "title": "곡 제목 2", "video_path": "C:/Joayong/videos/song2.mp4" }
  ]
}
```

- `id`는 `"1"`~`"9"` (OBS 곡 선택 단축키 슬롯과 일치)
- 경로에 파일이 없는 곡은 스크립트 로드 시 자동 제외되고 세션 로그에 `video file missing`이 남습니다

### 1-4. 곡선택 화면의 곡 목록 맞추기

`gesture-ui/app/page.tsx` 상단 `SONGS`의 `id`·`title`을 `songs.json`과 **똑같이** 맞추세요. (아직 자동 동기화 안 됨)

### 1-5. `runtime/command.json` 빈 파일 만들기

OBS 경로 선택 창은 **존재하는 파일만** 고를 수 있는데, 이 파일은 `.gitignore` 대상이라 clone하면 없습니다.
PowerShell에서 (인코딩을 `ascii`로 지정해야 BOM 없이 저장됩니다):

```powershell
Set-Content -Path C:\Joayong_dance\runtime\command.json -Value '{"action": "noop", "seq": -1}' -Encoding ascii
```

`seq: -1`은 아무 동작도 일으키지 않는 안전한 값입니다.

## 2. OBS 세팅

### 2-1. Python 연결

1. 도구(Tools) → 스크립트(Scripts) → **Python 설정(Python Settings)** 탭
2. Python 설치 경로 지정 — `python.exe`가 있는 폴더. 예: `C:\Users\<사용자>\AppData\Local\Programs\Python\Python311`
3. 탭 하단에 **"Loaded Python Version: 3.11"** 같은 문구가 보이면 성공

### 2-2. 씬과 소스 만들기

이름이 정확히 일치해야 합니다 (스크립트 속성에서 바꿀 수는 있음).

| 씬 | 넣을 소스 (아래가 뒤, 위가 앞) |
|---|---|
| `idle` | 곡선택 화면 `gesture_ui` (Browser Source, 2-3 참고) / `overlay_title` / `overlay_countdown` / `overlay_status` |
| `dance` | `dance_media` (Media Source) / **테스트해 둔 카메라 소스 + 크로마키 필터** / `overlay_title` / `overlay_countdown` / `overlay_status` |

- `dance`에서 카메라(크로마키) 소스는 `dance_media` **위**에 둬야 사람이 영상 앞에 합성됩니다.
- `overlay_*` 텍스트 3개(Text (GDI+))는 `idle`에서 만든 뒤 `dance`에는 **"기존 소스 추가"**로 넣으세요. 새로 만들면 다른 객체가 돼서 스크립트가 한쪽만 갱신합니다.
- `dance_media` 속성: 로컬 파일 체크, 파일은 아무 영상이나 지정(스크립트가 바꿈), **반복 끔**, **"소스가 활성화될 때 재생 다시 시작" 반드시 끔** — 켜져 있으면 카운트다운 전에 영상이 먼저 재생됩니다 ([`obs-setup.md`](obs-setup.md) "발견한 이슈").

### 2-3. 곡선택 화면(Browser Source) — 3-1에서 gesture-ui를 띄운 뒤

| 항목 | 값 |
|---|---|
| URL | `http://localhost:3000` |
| 너비 × 높이 | `1280` × `720` |
| 보이지 않을 때 소스 종료 | **끔** (켜면 dance 씬에 갔다 올 때마다 카메라를 다시 엶) |

**카메라 접근 (미검증 항목)**: OBS Browser Source는 기본적으로 웹캠 접근(`getUserMedia`)이 막혀 있을 수 있습니다.
화면이 검게 나오면:

1. OBS 바로가기 우클릭 → 속성 → 대상 끝에 ` --enable-media-stream` 추가 후 OBS 재시작
2. 그래도 안 되면 대안: Chrome을 키오스크로 띄우고(`chrome --kiosk http://localhost:3000`) OBS에 **창 캡처**로 넣기

어느 쪽이 됐는지 결과를 기록해 주세요 (기획안 §7 기술 검증 항목).

### 2-4. 스크립트 로드

1. 도구 → 스크립트 → **스크립트** 탭 → `+` → `C:\Joayong_dance\obs-script\joayong_control.py`
2. 속성 값 입력:

| 필드 | 값 |
|---|---|
| songs.json 경로 | `C:/Joayong_dance/obs-script/songs.json` |
| command.json 경로 | `C:/Joayong_dance/runtime/command.json` |
| 세션 로그 경로 | `C:/Joayong_dance/runtime/session.jsonl` (새 파일 이름으로 지정) |
| 대기 / 댄스 씬 이름 | `idle` / `dance` |
| 댄스 미디어 소스 이름 | `dance_media` |
| 곡 제목 / 카운트다운 / 상태 텍스트 소스 | `overlay_title` / `overlay_countdown` / `overlay_status` |
| 카운트다운 초 | `3` |

3. 스크립트 창의 **스크립트 로그** 버튼 → `[joayong] loaded N valid song(s)`에서 N이 준비한 영상 수와 맞는지 확인

### 2-5. 단축키 매핑

설정 → 단축키 → "조아용" 검색:

| 항목 | 키 |
|---|---|
| 조아용: 곡 1 선택 (2, 3 … 곡 수만큼) | `1` (`2`, `3` …) |
| 조아용: 시작 | `Space` |
| 조아용: 강제 정지 | `Esc` |
| 조아용: 세션 초기화 | `R` |
| 조아용: 대기 화면 전환 | (선택) |

한 키를 두 항목에 넣지 마세요. **적용**을 눌러야 저장됩니다. 매핑은 스크립트 설정에 저장되어 재로드·재시작 후에도 유지됩니다.

## 3. 곡선택 화면(gesture-ui) 실행

### 3-1. 실행

```powershell
cd C:\Joayong_dance\gesture-ui
npm install
copy .env.local.example .env.local
npm run dev
```

- `.env.local`의 `COMMAND_FILE_PATH=../runtime/command.json`은 그대로 두면 됩니다 (2-4의 command.json과 같은 파일).
- Windows 방화벽 허용 창이 뜨면 **허용 안 해도 됩니다** — 모든 통신이 이 PC 안(localhost)입니다.
- 이 터미널 창은 테스트 내내 켜둬야 합니다. 꺼져도 OBS 단축키 운영은 그대로 가능합니다.

### 3-2. 그린 판정 보정 (설치 시 1회)

1. 행사 조명을 켜고, 제스처 웹캠 화면의 **버튼 영역에 아무도 없게** 비움
2. OBS에서 `gesture_ui` 소스 우클릭 → **상호작용** 창을 연 상태로 `Shift+C` (키오스크 창이면 그 창에서)
3. 화면 상단에 `그린 판정 보정 완료: H …` 표시 확인. "보정 실패"면 영역을 비우고 다시

조명·카메라 위치를 바꾸면 다시 보정하세요. 자세한 내용: [`gesture-detection.md`](gesture-detection.md) 3장.

## 4. 테스트 체크리스트

결과 확인은 화면 + `runtime/session.jsonl`(세션 로그)로 합니다.

### A. 단축키만으로 한 사이클 (gesture-ui 없이도 되는지)

- [ ] `1` → `overlay_title`에 곡 제목 표시 (로그 `song_selected`)
- [ ] `Space` → `dance` 씬 전환, 카운트다운 3→2→1 **후에** 영상 재생 (로그 `countdown_start`, `play_start`)
- [ ] 크로마키 합성된 사람이 영상 앞에 보임
- [ ] 영상 끝 → "종료" 표시 → 3초 뒤 `idle` 복귀, 텍스트 비워짐 (로그 `play_end`, `session_reset`)
- [ ] 재생 중 `1` → 영상 안 바뀜 (로그 `blocked` / `song select during session`)
- [ ] 재생 중 `Esc` → 즉시 `idle` 복귀
- [ ] 스크립트 새로고침(↻) 후에도 단축키 그대로 동작, 저절로 곡이 선택되거나 시작되지 않음

### B. 제스처

- [ ] `idle` 씬에 웹캠 화면(좌우 반전) + 곡 버튼 표시
- [ ] 버튼에 손 올려 약 1.8초 → 곡 선택, 시작 버튼으로 바뀜 (로그 `song_selected`)
- [ ] 시작 버튼 dwell → 카운트다운 시작
- [ ] 버튼 근처에 서 있기만 할 때(손 안 올림) 오발동 없는지
- [ ] 8초간 아무것도 안 하면 "운영자에게 말씀해주세요" 표시
- [ ] gesture-ui 터미널 종료(Ctrl+C) 상태에서도 단축키 사이클(A) 정상

### C. 송출

- [ ] 유튜브(비공개)로 송출하며 A 사이클 1회 — 송출 화면에서 전환·합성 확인

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 단축키 눌러도 반응 없음 | 2-5 매핑 후 **적용** 눌렀는지. 로그에 이벤트가 찍히는지 |
| `loaded 0 valid song(s)` | `songs.json`의 `video_path`가 실제 파일인지 (로그 `video file missing`) |
| 제스처로 선택해도 OBS가 반응 없음 | `.env.local`의 경로와 스크립트의 command.json 경로가 같은 파일인지. `runtime/command.json` 내용이 바뀌는지 |
| 카운트다운 전에 영상이 먼저 재생 | `dance_media`의 "활성화될 때 재생 다시 시작" 끄기 |
| 곡선택 화면이 검게 나옴 | 2-3 카메라 접근 항목. 제스처 웹캠을 다른 프로그램이 쓰고 있지 않은지 |
| 텍스트가 한 씬에서만 바뀜 | `dance`의 텍스트 소스를 "기존 소스 추가"로 넣었는지 |
