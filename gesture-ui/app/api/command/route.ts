import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { commandFilePath } from "@/lib/commandFile";

// 상태 없는(stateless) 엔드포인트. 이 서버가 죽어도 obs-script 쪽 상태에는
// 영향이 없고, 운영자가 단축키로 즉시 우회할 수 있다는 전제가 여기서 나옵니다.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, song_id } = body as { action: string; song_id?: string };

  if (action !== "select_song" && action !== "start" && action !== "play_song") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const filePath = commandFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ action, song_id, seq: Date.now() }),
    "utf-8"
  );

  return NextResponse.json({ ok: true });
}
