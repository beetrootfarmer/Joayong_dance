# runtime/

`gesture-ui`와 `obs-script`가 소켓 없이 상태를 주고받는 공유 디렉터리입니다.

- `command.json` — gesture-ui가 쓰고, obs-script가 200ms 주기로 폴링해서 읽음. 실행 중에만 존재하는 파일이라 커밋하지 않습니다.
- 세션 로그(`.jsonl`)도 원하면 이 디렉터리에 두되, obs-script 설정의 `log_path`와 일치시키세요.

이 디렉터리 자체는 저장소에 유지하되, 안의 `.json`/`.jsonl` 런타임 파일은 `.gitignore`로 제외합니다.
