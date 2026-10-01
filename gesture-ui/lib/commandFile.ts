import path from "node:path";

// obs-script(joayong_control.py)와 공유하는 파일 경로.
// 두 런타임(Next.js, OBS 내장 Python)이 소켓 없이 상태를 주고받는 유일한 접점.
export function commandFilePath(): string {
  return (
    process.env.COMMAND_FILE_PATH ??
    path.resolve(process.cwd(), "../runtime/command.json")
  );
}

// 곡 목록은 obs-script/songs.json 하나만 원본으로 둠 (UI는 읽기만 함).
export function songsFilePath(): string {
  return (
    process.env.SONGS_FILE_PATH ??
    path.resolve(process.cwd(), "../obs-script/songs.json")
  );
}
