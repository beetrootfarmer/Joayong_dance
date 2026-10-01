"""
조아용 크로마키 체험 - OBS 제어 스크립트

OBS의 Tools > Scripts 패널에 이 파일을 직접 로드해서 사용합니다.
별도 프로세스나 소켓 없이, obspython을 통해 OBS 프로세스 내부에서 직접 동작합니다.

상태 흐름: idle -> song_ready -> countdown -> playing -> ended -> idle

초상권 송출 동의는 입장 시 스태프가 종이/태블릿으로 받으며, 프로그램에서는 동의 상태를 관리하지 않습니다.
"""

import json
import os
import time

import obspython as obs

# ---------------------------------------------------------------------------
# 설정 (Tools > Scripts 패널에서 값 입력)
# ---------------------------------------------------------------------------

CFG = {
    "songs_path": "",
    "command_path": "",
    "log_path": "",
    "scene_idle": "idle",
    "scene_dance": "dance",
    "source_media": "dance_media",
    "source_text_title": "overlay_title",
    "source_text_countdown": "overlay_countdown",
    "source_text_status": "overlay_status",
    "countdown_seconds": 3,
    "gesture_timeout_seconds": 8,
}

COMMAND_POLL_INTERVAL_MS = 200
STATUS_TICK_INTERVAL_MS = 1000

STATE_IDLE = "idle"
STATE_SONG_READY = "song_ready"
STATE_COUNTDOWN = "countdown"
STATE_PLAYING = "playing"
STATE_ENDED = "ended"

# ---------------------------------------------------------------------------
# 세션 상태 (이 스크립트가 유일한 상태 소유자)
# ---------------------------------------------------------------------------

session = {
    "state": STATE_IDLE,
    "song_id": None,
    "song_started_at": None,
    "countdown_remaining": 0,
    # None = 스크립트 (재)로드 직후 아직 기준을 잡지 않음 (poll_command 참고)
    "last_command_seq": None,
}

songs_by_id = {}
hotkey_ids = {}

# ---------------------------------------------------------------------------
# 곡 목록
# ---------------------------------------------------------------------------

def load_songs():
    songs_by_id.clear()
    path = CFG["songs_path"]
    if not path or not os.path.isfile(path):
        log_event("error", {"msg": "songs.json not found", "path": path})
        return

    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    for song in data.get("songs", []):
        video_path = song.get("video_path", "")
        if not os.path.isfile(video_path):
            log_event("error", {"msg": "video file missing", "song_id": song.get("id"), "path": video_path})
            continue
        songs_by_id[str(song["id"])] = song

    obs.script_log(obs.LOG_INFO, f"[joayong] loaded {len(songs_by_id)} valid song(s)")


# ---------------------------------------------------------------------------
# 세션 로그 (JSONL, 개인 식별 정보 없음)
# ---------------------------------------------------------------------------

def log_event(event_type, payload=None):
    path = CFG["log_path"]
    if not path:
        return
    entry = {"ts": time.time(), "type": event_type}
    if payload:
        entry.update(payload)
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as e:
        obs.script_log(obs.LOG_WARNING, f"[joayong] log write failed: {e}")


# ---------------------------------------------------------------------------
# OBS 소스/씬 헬퍼
# ---------------------------------------------------------------------------

def set_scene(scene_name):
    scene_source = obs.obs_get_source_by_name(scene_name)
    if scene_source is None:
        log_event("error", {"msg": "scene not found", "scene": scene_name})
        return
    obs.obs_frontend_set_current_scene(scene_source)
    obs.obs_source_release(scene_source)


def set_text(source_name, text):
    source = obs.obs_get_source_by_name(source_name)
    if source is None:
        return
    settings = obs.obs_data_create()
    obs.obs_data_set_string(settings, "text", text)
    obs.obs_source_update(source, settings)
    obs.obs_data_release(settings)
    obs.obs_source_release(source)


def set_media_file(source_name, file_path):
    source = obs.obs_get_source_by_name(source_name)
    if source is None:
        log_event("error", {"msg": "media source not found", "source": source_name})
        return
    settings = obs.obs_source_get_settings(source)
    obs.obs_data_set_string(settings, "local_file", file_path)
    obs.obs_source_update(source, settings)
    obs.obs_data_release(settings)
    obs.obs_source_release(source)


def restart_media(source_name):
    source = obs.obs_get_source_by_name(source_name)
    if source is None:
        return
    obs.obs_source_media_restart(source)
    obs.obs_source_release(source)


# ---------------------------------------------------------------------------
# 상태 전이 액션 (제스처와 단축키가 동일하게 호출하는 지점)
# ---------------------------------------------------------------------------

def action_select_song(song_id):
    # 대기 또는 곡 재선택 상태에서만 허용 — 카운트다운·재생 중 영상이 바뀌지 않도록
    if session["state"] not in (STATE_IDLE, STATE_SONG_READY):
        log_event("blocked", {"msg": "song select during session", "state": session["state"], "song_id": song_id})
        return
    song = songs_by_id.get(str(song_id))
    if song is None:
        log_event("error", {"msg": "unknown song_id", "song_id": song_id})
        return

    session["song_id"] = str(song_id)
    session["state"] = STATE_SONG_READY
    set_media_file(CFG["source_media"], song["video_path"])
    set_text(CFG["source_text_title"], song["title"])
    log_event("song_selected", {"song_id": song_id, "title": song["title"]})


def action_start():
    if session["state"] != STATE_SONG_READY:
        log_event("blocked", {"msg": "start without song_ready", "state": session["state"]})
        return

    session["state"] = STATE_COUNTDOWN
    session["countdown_remaining"] = CFG["countdown_seconds"]
    set_scene(CFG["scene_dance"])
    obs.timer_add(countdown_tick, 1000)
    log_event("countdown_start", {"song_id": session["song_id"]})


def countdown_tick():
    session["countdown_remaining"] -= 1
    if session["countdown_remaining"] > 0:
        set_text(CFG["source_text_countdown"], str(session["countdown_remaining"]))
        return

    set_text(CFG["source_text_countdown"], "")
    obs.timer_remove(countdown_tick)
    session["state"] = STATE_PLAYING
    session["song_started_at"] = time.time()
    restart_media(CFG["source_media"])
    log_event("play_start", {"song_id": session["song_id"]})


def action_force_stop():
    action_force_idle()
    log_event("force_stop", {})


def action_force_idle():
    session["state"] = STATE_IDLE
    session["song_id"] = None
    set_scene(CFG["scene_idle"])
    set_text(CFG["source_text_title"], "")
    set_text(CFG["source_text_countdown"], "")
    set_text(CFG["source_text_status"], "")
    try:
        obs.timer_remove(countdown_tick)
    except Exception:
        pass


def action_reset_session():
    action_force_idle()
    log_event("session_reset", {})


def on_media_ended(calldata):
    if session["state"] != STATE_PLAYING:
        return
    session["state"] = STATE_ENDED
    set_text(CFG["source_text_status"], "종료")
    log_event("play_end", {"song_id": session["song_id"]})
    obs.timer_add(return_to_idle_once, 3000)


def return_to_idle_once():
    obs.timer_remove(return_to_idle_once)
    action_reset_session()


# ---------------------------------------------------------------------------
# command.json 폴링 — gesture-ui(Next.js)가 남긴 이벤트를 단축키와 동일하게 처리
# ---------------------------------------------------------------------------

def read_command():
    path = CFG["command_path"]
    if not path or not os.path.isfile(path):
        return None
    try:
        # utf-8-sig: Windows 메모장/PowerShell이 붙이는 BOM도 허용
        with open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def poll_command():
    cmd = read_command()
    seq = cmd.get("seq", -1) if cmd else -1

    if session["last_command_seq"] is None:
        # (재)로드 직후 첫 폴링: 이전 실행에서 남은 명령을 다시 실행하지 않도록 기준만 잡음.
        # 파일이 없으면 기준은 -1 — 나중에 처음 생기는 명령은 정상 실행됨
        session["last_command_seq"] = seq
        return
    if cmd is None or seq == session["last_command_seq"]:
        return
    session["last_command_seq"] = seq

    action = cmd.get("action")
    if action == "select_song":
        action_select_song(cmd.get("song_id"))
    elif action == "start":
        action_start()
    else:
        log_event("error", {"msg": "unknown command action", "action": action})


# ---------------------------------------------------------------------------
# 단축키 등록
# ---------------------------------------------------------------------------

def register_hotkey(name, description, callback, settings):
    hotkey_id = obs.obs_hotkey_register_frontend(name, description, callback)
    hotkey_ids[name] = hotkey_id
    # 스크립트 설정에 저장해둔 키 매핑 복원 — 없으면 재로드/OBS 재시작 시 매핑이 풀림
    saved = obs.obs_data_get_array(settings, name)
    obs.obs_hotkey_load(hotkey_id, saved)
    obs.obs_data_array_release(saved)


def hotkey_callback(action_fn):
    def _cb(pressed):
        if pressed:
            action_fn()
    return _cb


def register_all_hotkeys(settings):
    register_hotkey("joayong.start", "조아용: 시작", hotkey_callback(action_start), settings)
    register_hotkey("joayong.force_stop", "조아용: 강제 정지", hotkey_callback(action_force_stop), settings)
    register_hotkey("joayong.force_idle", "조아용: 대기 화면 전환", hotkey_callback(action_force_idle), settings)
    register_hotkey("joayong.reset", "조아용: 세션 초기화", hotkey_callback(action_reset_session), settings)

    # 곡 선택 단축키 1~9. 실제 운영 시 OBS Settings > Hotkeys 에서 숫자 키에 매핑.
    for i in range(1, 10):
        song_id = str(i)
        register_hotkey(
            f"joayong.select_song_{song_id}",
            f"조아용: 곡 {song_id} 선택",
            hotkey_callback(lambda sid=song_id: action_select_song(sid)),
            settings,
        )


# ---------------------------------------------------------------------------
# OBS 스크립트 표준 콜백
# ---------------------------------------------------------------------------

def script_description():
    return (
        "조아용 크로마키 체험 제어 스크립트\n"
        "songs.json, command.json, 로그 경로를 아래에 설정하세요."
    )


def script_properties():
    props = obs.obs_properties_create()
    obs.obs_properties_add_path(props, "songs_path", "songs.json 경로", obs.OBS_PATH_FILE, "*.json", None)
    obs.obs_properties_add_path(props, "command_path", "command.json 경로", obs.OBS_PATH_FILE, "*.json", None)
    obs.obs_properties_add_path(props, "log_path", "세션 로그 경로 (.jsonl)", obs.OBS_PATH_FILE_SAVE, "*.jsonl", None)
    obs.obs_properties_add_text(props, "scene_idle", "대기 씬 이름", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "scene_dance", "댄스 씬 이름", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "source_media", "댄스 미디어 소스 이름", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "source_text_title", "곡 제목 텍스트 소스 이름", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "source_text_countdown", "카운트다운 텍스트 소스 이름", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_text(props, "source_text_status", "상태 텍스트 소스 이름", obs.OBS_TEXT_DEFAULT)
    obs.obs_properties_add_int(props, "countdown_seconds", "카운트다운 초", 1, 10, 1)
    return props


def script_update(settings):
    for key in CFG:
        if isinstance(CFG[key], int):
            CFG[key] = obs.obs_data_get_int(settings, key) or CFG[key]
        else:
            CFG[key] = obs.obs_data_get_string(settings, key) or CFG[key]
    load_songs()


def script_save(settings):
    for name, hotkey_id in hotkey_ids.items():
        arr = obs.obs_hotkey_save(hotkey_id)
        obs.obs_data_set_array(settings, name, arr)
        obs.obs_data_array_release(arr)


def script_load(settings):
    register_all_hotkeys(settings)
    # 이전 실행에서 텍스트 소스에 남은 문구(예: 제거된 "동의 대기/완료") 정리
    set_text(CFG["source_text_status"], "")
    obs.timer_add(poll_command, COMMAND_POLL_INTERVAL_MS)

    media_source = obs.obs_get_source_by_name(CFG["source_media"])
    if media_source is not None:
        sh = obs.obs_source_get_signal_handler(media_source)
        obs.signal_handler_connect(sh, "media_ended", on_media_ended)
        obs.obs_source_release(media_source)


def script_unload():
    obs.timer_remove(poll_command)
    try:
        obs.timer_remove(countdown_tick)
        obs.timer_remove(return_to_idle_once)
    except Exception:
        pass
