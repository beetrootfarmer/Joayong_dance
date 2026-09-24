import path from "node:path";

// obs-script(joayong_control.py)와 공유하는 파일 경로.
// 두 런타임(Next.js, OBS 내장 Python)이 소켓 없이 상태를 주고받는 유일한 접점.
export function commandFilePath(): string {
  return (
    process.env.COMMAND_FILE_PATH ??
    path.resolve(process.cwd(), "../runtime/command.json")
  );
}
