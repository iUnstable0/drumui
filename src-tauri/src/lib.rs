#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_midi_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn read_midi_file(path: String) -> Result<Vec<u8>, String> {
    let is_midi = std::path::Path::new(&path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "mid" | "midi"))
        .unwrap_or(false);

    if !is_midi {
        return Err("Choose a .mid or .midi file.".to_string());
    }

    std::fs::read(path).map_err(|error| format!("Could not read the MIDI file: {error}"))
}
