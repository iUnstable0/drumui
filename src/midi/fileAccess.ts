import {invoke} from "@tauri-apps/api/core";
import {open} from "@tauri-apps/plugin-dialog";

export function isTauriRuntime(): boolean {
	return (window as unknown as {__TAURI_INTERNALS__?: unknown}).__TAURI_INTERNALS__ !== undefined;
}

export async function pickMidiPath(): Promise<string | null> {
	if (!isTauriRuntime()) return null;

	const selected = await open({
		multiple: false,
		directory: false,
		filters: [{name: "MIDI", extensions: ["mid", "midi"]}],
	});

	return typeof selected === "string" ? selected : null;
}

export async function readMidiBytesFromPath(path: string): Promise<Uint8Array> {
	const bytes = await invoke<number[]>("read_midi_file", {path});
	return new Uint8Array(bytes);
}
