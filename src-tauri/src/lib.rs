mod audio;
mod dto;
mod kit;
mod midi;

use audio::AudioBackend;
use dto::{
    AudioDiagnosticsDto, CompiledSession, LaneStateMapDto, PieceId, PlaybackControlsDto,
    PlaybackControlsPatchDto, PlaybackStatusDto, SessionDto,
};
use tauri::{Manager, State};

const MAX_MIDI_BYTES: u64 = 8 * 1024 * 1024;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AudioBackend::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio_load_midi_file,
            audio_clear_session,
            audio_play,
            audio_pause,
            audio_stop,
            audio_seek,
            audio_set_controls,
            audio_set_lane_states,
            audio_audition,
            audio_get_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn audio_load_midi_file(
    state: State<'_, AudioBackend>,
    path: String,
) -> Result<SessionDto, String> {
    ensure_midi_path(&path)?;
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Could not stat the MIDI file: {error}"))?;
    if metadata.len() > MAX_MIDI_BYTES {
        return Err(format!(
            "MIDI file is too large ({} bytes; max {} bytes).",
            metadata.len(),
            MAX_MIDI_BYTES
        ));
    }
    let bytes =
        std::fs::read(&path).map_err(|error| format!("Could not read the MIDI file: {error}"))?;
    let dto = midi::parse_midi_bytes(&bytes, &path)?;
    state.insert_session(CompiledSession::from_dto(dto))
}

#[tauri::command]
fn audio_clear_session(state: State<'_, AudioBackend>, session_id: String) -> Result<(), String> {
    state.clear_session(session_id)
}

#[tauri::command]
fn audio_play(
    state: State<'_, AudioBackend>,
    session_id: String,
    from_ms: f64,
    controls: PlaybackControlsDto,
    lane_states: LaneStateMapDto,
) -> Result<PlaybackStatusDto, String> {
    state.play(session_id, from_ms, controls, lane_states)
}

#[tauri::command]
fn audio_pause(state: State<'_, AudioBackend>) -> Result<PlaybackStatusDto, String> {
    state.pause()
}

#[tauri::command]
fn audio_stop(
    state: State<'_, AudioBackend>,
    reset_position: Option<bool>,
) -> Result<PlaybackStatusDto, String> {
    state.stop(reset_position.unwrap_or(true))
}

#[tauri::command]
fn audio_seek(
    state: State<'_, AudioBackend>,
    position_ms: f64,
) -> Result<PlaybackStatusDto, String> {
    state.seek(position_ms)
}

#[tauri::command]
fn audio_set_controls(
    state: State<'_, AudioBackend>,
    patch: PlaybackControlsPatchDto,
) -> Result<PlaybackStatusDto, String> {
    state.set_controls(patch)
}

#[tauri::command]
fn audio_set_lane_states(
    state: State<'_, AudioBackend>,
    lane_states: LaneStateMapDto,
) -> Result<PlaybackStatusDto, String> {
    state.set_lane_states(lane_states)
}

#[tauri::command]
fn audio_audition(
    state: State<'_, AudioBackend>,
    piece_id: PieceId,
    velocity: Option<f32>,
) -> Result<(), String> {
    state.audition(piece_id, velocity.unwrap_or(1.0))
}

#[tauri::command]
fn audio_get_diagnostics(state: State<'_, AudioBackend>) -> AudioDiagnosticsDto {
    state.diagnostics()
}

fn ensure_midi_path(path: &str) -> Result<(), String> {
    let is_midi = std::path::Path::new(&path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "mid" | "midi"))
        .unwrap_or(false);

    if !is_midi {
        return Err("Choose a .mid or .midi file.".to_string());
    }

    Ok(())
}
