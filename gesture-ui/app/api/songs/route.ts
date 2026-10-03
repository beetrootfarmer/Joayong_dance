import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { songsFilePath } from "@/lib/commandFile";

type SongEntry = { id: string | number; title: string; thumbnail?: string };

// songs.json에서 화면에 필요한 값(id·제목·썸네일)만 내려줌. 영상 경로는 OBS 쪽에서만 씀.
export async function GET() {
  try {
    const raw = await fs.readFile(songsFilePath(), "utf-8");
    // Windows 메모장 등이 붙이는 BOM 제거
    const data = JSON.parse(raw.replace(/^﻿/, ""));
    const songs = (data.songs ?? []).map((s: SongEntry) => ({
      id: String(s.id),
      title: s.title,
      // public/ 기준 상대경로 → 브라우저 URL (파일명에 공백·한글이 있어 인코딩)
      thumbnail: s.thumbnail ? "/" + encodeURI(s.thumbnail.replace(/^\/+/, "")) : null,
    }));
    return NextResponse.json({ songs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
