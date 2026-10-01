# OBS 세팅 기록 (기술 검증 1단계 완료)

이 문서는 2026-09-24~26에 macOS에서 진행한 OBS 세팅 기록입니다. 아래 경로(`/Users/heji/...`)는 이 Mac 기준입니다.
**새 PC(Windows)에 세팅할 때는 [`setup-new-machine.md`](setup-new-machine.md)를 따라하세요.** 이 문서는 설계 이유와 발견한 이슈 기록용입니다.

## 환경

| 항목 | 값 |
|---|---|
| OBS Studio | 32.2.2 (Homebrew cask로 설치: `brew install --cask obs`) |
| Python | 3.10 (framework 빌드, `/Library/Frameworks/Python.framework/Versions/3.10`) |
| OBS Python 지원 범위 | 3.8 이상 3.12 미만 (OBS 소스 `shared/obs-scripting/cmake/python.cmake` 기준, macOS는 Windows/Linux와 별도 범위) |

### Python 경로 설정

`~/Library/Application Support/obs-studio/user.ini`:

```ini
[Python]
Path64bit=/Library/Frameworks
```

값은 `Python.framework`가 들어있는 **상위 디렉터리**여야 합니다 (버전 하위 폴더까지 적지 않음). OBS가 내부적으로
`<이 경로>/Python.framework/Versions/3.X`를 순서대로 찾아서 로드합니다.

확인 방법: OBS 메뉴바 → OBS Studio → 이건 없고, **Tools → Scripts → Python Settings 탭**에서 경로와 "Python 3.10 loaded" 같은 문구 확인.

## 씬 구성

| 씬 이름 | 용도 |
|---|---|
| `idle` | 대기 화면. 텍스트 소스 3개 포함 |
| `dance` | 댄스 화면. 미디어 소스 + 텍스트 소스 3개(idle과 동일 소스 공유) 포함 |

> 기본 생성되는 `장면`(이름 없는 기본 씬)은 안 쓰지만 굳이 지울 필요는 없음.

## 소스 구성

| 소스 이름 | 타입 | 설정 | 비고 |
|---|---|---|---|
| `dance_media` | Media Source | Local File = 테스트 영상 경로, **Loop 끔**, **"Restart playback when source becomes active" 반드시 끔** | 아래 "발견한 이슈" 참고 |
| `overlay_title` | Text (FreeType 2) | 기본값 | `idle`에서 생성 후 `dance`에는 **기존 소스로 추가** (새로 만들지 않음) |
| `overlay_countdown` | Text (FreeType 2) | 기본값 | 위와 동일 |
| `overlay_status` | Text (FreeType 2) | 기본값 | 위와 동일 |

"기존 소스로 추가"가 중요한 이유: 같은 이름으로 씬마다 새로 만들면 서로 다른 소스 객체가 돼서, 스크립트가 하나만 갱신해도
다른 씬에는 반영되지 않습니다. 소스는 OBS에서 전역 객체이고 씬은 그 참조만 들고 있다는 점을 이용한 겁니다.

## joayong_control.py 속성 값

Tools → Scripts → `joayong_control.py` 에 입력한 값:

| 필드 | 값 |
|---|---|
| songs.json 경로 | `/Users/heji/Documents/Joayong_dance/obs-script/songs.json` |
| command.json 경로 | `/Users/heji/Documents/Joayong_dance/runtime/command.json` |
| 세션 로그 경로 | `/Users/heji/Documents/Joayong_dance/runtime/session.jsonl` |
| 대기 씬 이름 | `idle` |
| 댄스 씬 이름 | `dance` |
| 댄스 미디어 소스 이름 | `dance_media` |
| 곡 제목 텍스트 소스 이름 | `overlay_title` |
| 카운트다운 텍스트 소스 이름 | `overlay_countdown` |
| 상태 텍스트 소스 이름 | `overlay_status` |
| 카운트다운 초 | `3` |

`command.json`은 gesture-ui가 실행 중에만 만드는 파일이라, OBS 경로 선택 창(존재하는 파일만 선택 가능)에 걸리도록
빈 placeholder(`{"action": "noop", "seq": -1}`)를 미리 만들어 넣었습니다. `seq: -1`은 스크립트의 초기값과
같아서 아무 동작도 트리거하지 않는 안전한 값입니다.

`obs-script/songs.json`의 곡 1 `video_path`는 실제 존재하는 테스트 영상(`/Users/heji/Downloads/test_dance.MP4`)으로
바꿔뒀습니다. 곡 2는 아직 존재하지 않는 경로(`C:/Joayong/videos/song2.mp4`)를 그대로 둬서, "파일 없으면 검증에서
제외" 기능이 의도대로 로그를 남기고 건너뛰는지도 같이 확인했습니다 — 실제 두 번째 영상이 준비되면 그때 경로만 바꾸면 됩니다.

## 단축키 매핑 (OBS Settings → Hotkeys, "조아용" 검색)

| 동작 | 키 |
|---|---|
| 곡 1 선택 | `1` |
| 시작 | `Space` |
| 강제 정지 | `Esc` |
| 세션 초기화 | `R` |

## 발견한 이슈와 수정

**증상**: `Space`(시작)를 누르면 카운트다운이 표시되는 것과 동시에 영상이 바로 재생을 시작해버림 (카운트다운이 끝난 뒤
재생되어야 하는데 즉시 재생됨).

**원인**: OBS의 Media Source는 "Restart playback when source becomes active" 옵션이 **기본적으로 켜져** 있습니다.
`action_start()`가 `dance` 씬으로 전환하는 순간 `dance_media` 소스가 활성화되고, 이 옵션 때문에 OBS가 자체적으로
즉시 재생을 시작해버립니다. 스크립트가 카운트다운 종료 시점에 `restart_media()`를 호출하는 로직과는 별개로, OBS가
먼저 재생을 시작해서 둘이 겹쳐 보인 것입니다.

**수정**: `dance_media` 소스 속성에서 **"Restart playback when source becomes active" 체크 해제**. 코드 변경 없이
OBS 설정만으로 해결됨.

## 검증 결과

전체 사이클(동의 확인 → 곡 선택 → 시작 → 카운트다운 → 재생 → 종료 감지 → 자동 대기 복귀)이 단축키만으로 의도한 대로
동작하는 것을 확인했습니다 (2026-09-26).

> 2026-10-01: 프로그램 내 동의 잠금(`C` 단축키, `consent_ok` 상태)을 제거했습니다. 현장 동의는 스태프가 입장 시 받습니다.
> 사이클은 이제 곡 선택부터 시작하며, 변경 후 OBS에서 재검증이 필요합니다.

## 발견한 이슈 2: 스크립트 재로드 시 단축키 매핑이 풀림 (2026-10-01)

**증상**: 스크립트를 새로고침한 뒤 `R`(세션 초기화)을 눌러도 아무 반응이 없음. 세션 로그에 `session_reset`이 남지 않음.

**원인**: 스크립트가 단축키 매핑을 저장/복원(`obs_hotkey_save`/`obs_hotkey_load`)하지 않아, 재로드·OBS 재시작마다
Settings → Hotkeys의 `조아용:` 매핑이 초기화됨. 9/26 검증은 매핑 직후 같은 세션에서 해서 드러나지 않았음.

**같이 발견**: 재로드 직후 `command.json`에 남아 있던 지난 명령(`start`)이 한 번 다시 실행됨 (`last_command_seq` 초기값이
실제 파일의 seq와 달라서). 마지막 명령이 곡 선택이었다면 재로드만으로 곡이 선택됐을 것.

**수정**:
- `script_save`에서 매핑 저장, `script_load`에서 복원
- 재로드 후 첫 폴링은 현재 `command.json`의 seq를 기준으로만 잡고 실행하지 않음
- 로드 시 상태 텍스트(`overlay_status`) 비움 — 이전 버전이 남긴 "동의 대기/완료" 문구 정리
- 로드 시점에 `command.json`이 없으면 기준을 -1로 잡아, 나중에 처음 생기는 명령은 정상 실행되도록 함
- `command.json`/`songs.json`을 `utf-8-sig`로 읽어 Windows 메모장·PowerShell이 붙이는 BOM도 허용

**주의**: 이 수정 버전을 처음 로드할 때는 저장된 매핑이 없으므로 **한 번 더 매핑**해야 합니다. 이후부터는 유지됩니다.
제거된 `조아용: 동의 전환` 항목이 OBS 재시작 전까지 단축키 목록에 남아 있을 수 있으나, 눌러도 아무 동작 없음. 이걸로 기획안 §7 "1. 기술 검증" 중 OBS 쪽 검증은 완료입니다.

**아직 남은 기술 검증**: gesture-ui의 카메라 접근 및 OBS Browser Source 안에서의 `getUserMedia` 동작 여부.
