import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { songsFilePath } from "@/lib/commandFile";

// songs.json에서 id·title만 내려줌. 영상 경로는 OBS 쪽에서만 씀.
export async function GET() {
  try {
    const raw = await fs.readFile(songsFilePath(), "utf-8");
    // Windows 메모장 등이 붙이는 BOM 제거
    const data = JSON.parse(raw.replace(/^﻿/, ""));
    const songs = (data.songs ?? []).map((s: { id: string | number; title: string }) => ({
      id: String(s.id),
      title: s.title,
    }));
    return NextResponse.json({ songs });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
